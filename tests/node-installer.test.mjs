import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureYtDlpInstalled,RELEASE,RELEASE_SHA256,RELEASE_URL} from '../scripts/install-ytdlp.mjs';
import {selectYtDlpBinary} from '../src/ytdlp-path.mjs';

test('pin official release instead of latest and require checksum',()=>{
 assert.match(RELEASE,/^\d{4}\.\d+\.\d+$/);
 assert.ok(RELEASE_URL.includes(`/${RELEASE}/yt-dlp_linux`));
 assert.match(RELEASE_SHA256,/^[a-f0-9]{64}$/);
});
test('allow only configured fixed commands, reject injection',()=>{
 assert.equal(selectYtDlpBinary({PIKETE_YTDLP_BIN:'yt-dlp'}),'yt-dlp');
 assert.equal(selectYtDlpBinary({PIKETE_YTDLP_BIN:'/app/.venv/bin/yt-dlp'}), 'yt-dlp', 'a stale Docker path must not block Node PATH');
 assert.throws(()=>selectYtDlpBinary({PIKETE_YTDLP_BIN:'; rm -rf /'}),/ytdlp_binary_not_allowed/);
});
test('test binary install verifies sha256, executable, cached state and no network on reuse', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pikete-node-installer-test-'));
 const target=join(dir,'yt-dlp');
 const bytes=Buffer.from('#!/bin/sh\necho 2026.10.21\n');
 const sha=createHash('sha256').update(bytes).digest('hex');
 let calls=0;
 const fetchImpl=async()=>{calls++;return new Response(bytes,{status:200});};
 try {
  const first=await ensureYtDlpInstalled({target,expectedHash:sha,fetchImpl});
  assert.equal(first.installed,true);
  assert.deepEqual(await readFile(target),bytes);
  const second=await ensureYtDlpInstalled({target,expectedHash:sha,fetchImpl});
  assert.equal(second.installed,false);
  assert.equal(calls,1);
 }finally {await rm(dir,{recursive:true,force:true});}
});
test('incorrect digest fails closed without leaving executable behind', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pikete-node-bad-checksum-'));
 const target=join(dir,'yt-dlp');
 try {
  await assert.rejects(ensureYtDlpInstalled({target,fetchImpl:async()=>new Response('#!/bin/sh\necho bad\n',{status:200})}),/sha256_mismatch/);
  await assert.rejects(access(target));
 }finally {await rm(dir,{recursive:true,force:true});}
});

test('Render start entrypoint installs automatically without requiring build or env changes',async()=>{
 const fs=await import('node:fs/promises');
 const server=await fs.readFile(new URL('../server.mjs',import.meta.url),'utf8');
 const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.scripts.start,'node server.mjs');
 assert.match(server,/setImmediate\(\(\)=>void bootstrap\.run\(\)\)/);
 assert.match(server,/install:installYtDlpIfMissing/);
 assert.match(server,/if\(\(await ytDlpProbeStatus\(\)\)\.ok\)return/);
 assert.match(server,/enqueueYoutubeRefreshSweep\(\{node:'both',limit:2\}\)/);
});
