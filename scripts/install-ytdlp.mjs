/** Pinned, verified official yt-dlp Linux binary for Render Node runtime.
 * No Python, pip, sudo or Docker required. Never accepts arbitrary download URLs.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, rename, rm } from 'node:fs/promises';
import { probeYtDlpBinary } from '../src/ytdlp-probe.mjs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';

export const RELEASE = '2026.10.21';
export const RELEASE_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${RELEASE}/yt-dlp_linux`;
// Official release 2026.10.21 SHA256 (yt-dlp_linux for x86_64 glibc Linux).
export const RELEASE_SHA256 = 'd8bd33fca9d5b23bd5b9952b3fca36db5c46331933fda9f598a3da14ce2c243f';
export const TARGET = fileURLToPath(new URL('../bin/yt-dlp', import.meta.url));

export async function ensureYtDlpInstalled({
  target=TARGET, fetchImpl=fetch, url=RELEASE_URL, expectedHash=RELEASE_SHA256,
  allowTestPlatform=false
}={}) {
  if (!allowTestPlatform && (process.platform!=='linux' || process.arch!=='x64')) {
    throw new Error(`unsupported_native_runtime_${process.platform}_${process.arch}`);
  }
  if (existsSync(target) && (await probeYtDlpBinary(target)).ok) return {installed:false,version:RELEASE};
  await mkdir(dirname(target),{recursive:true});
  const tmp=`${target}.${process.pid}.download`;
  try {
    const response=await fetchImpl(url,{redirect:'follow',signal:AbortSignal.timeout(120000)});
    if(!response.ok || !response.body) throw new Error(`yt_dlp_download_http_${response.status}`);
    let count=0;
    const sha=createHash('sha256');
    const hashing=new Transform({transform(chunk,enc,callback){
      count+=chunk.length;
      if(count>85*1024*1024) return callback(new Error('yt_dlp_too_large'));
      sha.update(chunk);callback(null,chunk);
    }});
    await pipeline(Readable.fromWeb(response.body),hashing,createWriteStream(tmp,{mode:0o700}));
    if(sha.digest('hex')!==expectedHash) throw new Error('yt_dlp_sha256_mismatch');
    await chmod(tmp,0o755);
    const probe=await probeYtDlpBinary(tmp);
    if(!probe.ok) throw Object.assign(new Error(probe.code),{code:probe.code});
    await rename(tmp,target);
    return {installed:true,version:RELEASE};
  } finally { await rm(tmp,{force:true}).catch(()=>{}); }
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  try{ const state=await ensureYtDlpInstalled();console.log(`[pikete] yt-dlp ${state.version} ready (${state.installed?'installed':'cached'})`); }
  catch(error){console.error(`[pikete] yt-dlp build failed: ${String(error.message).slice(0,160)}`);process.exitCode=1;}
}
