import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {probeYtDlpBinary} from '../src/ytdlp-probe.mjs';

async function withScript(script,fn){
 const dir=await mkdtemp(join(tmpdir(),'pikete-probe-'));
 const p=join(dir,'yt-dlp');
 try{await writeFile(p,'#!/bin/sh\n'+script+'\n');await chmod(p,0o755);return await fn(p)}
 finally{await rm(dir,{recursive:true,force:true})}
}
test('a slow but valid yt-dlp is considered executable (the old four second probe rejected it)',async()=>{
 await withScript('sleep 0.35; echo 2026.10.21',async path=>{
  const timedOut=await probeYtDlpBinary(path,{timeoutMs:100});
  assert.equal(timedOut.ok,false);
  assert.equal(timedOut.code,'yt_dlp_probe_timeout');
  const success=await probeYtDlpBinary(path,{timeoutMs:1500});
  assert.equal(success.ok,true);
 });
});
test('missing, non-executable and wrong-output binaries have distinct safe diagnostics',async()=>{
 const missing=await probeYtDlpBinary('/no/such/pikete-binary');
 assert.equal(missing.ok,false);assert.equal(missing.code,'yt_dlp_binary_missing');
 await withScript('echo Not-a-version',async path=>{
  const wrong=await probeYtDlpBinary(path);
  assert.equal(wrong.ok,false);assert.equal(wrong.code,'yt_dlp_unexpected_version');
 });
});
test('yt-dlp probe never blocks the Node event loop',async()=>{
 await withScript('sleep 0.3; echo 2026.10.21',async path=>{
  const future=probeYtDlpBinary(path,{timeoutMs:1500});
  let beat=false;
  await new Promise(resolve=>setImmediate(()=>{beat=true;resolve()}));
  assert.equal(beat,true);
  assert.equal((await future).ok,true);
 });
});
