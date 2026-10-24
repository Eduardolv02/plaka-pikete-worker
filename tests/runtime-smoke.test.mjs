import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,writeFile,chmod,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';

async function freePort(){
 const server=net.createServer();
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const {port}=server.address();
 await new Promise(resolve=>server.close(resolve));
 return port;
}

test('Node service boots with an existing yt-dlp command and protects privileged routes',
  {skip:process.platform!=='linux',timeout:18000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pikete-smoke-'));
 const original=dirname(dirname(fileURLToPath(import.meta.url)));
 let child;
 try{
  for(const entry of ['server.mjs','package.json','src','scripts'])
   await cp(join(original,entry),join(dir,entry),{recursive:true});
  await mkdir(join(dir,'bin'));
  await writeFile(join(dir,'bin','yt-dlp'),'#!/bin/sh\nprintf "2026.10.21\\n"\n');
  await chmod(join(dir,'bin','yt-dlp'),0o755);
  const port=await freePort();
  child=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{...process.env,PORT:String(port),
    PIKETE_YTDLP_SEARCH_ENABLED:'false',PIKETE_WORKER_KEY:''},stdio:['ignore','pipe','pipe']});
  let health=null;
  for(let i=0;i<80;i++){
   await new Promise(resolve=>setTimeout(resolve,65));
   if(child.exitCode!==null)throw Error(`Render exited ${child.exitCode}`);
   try{
    const r=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(400)});
    if(!r.ok)continue;
    health=await r.json();
    if(health.discovery.bootstrap==='ready')break;
   }catch{} 
  }
  assert.equal(health?.discovery?.bootstrap,'ready');
  assert.equal(health.discovery.ytdlp_binary_detected,true);
  assert.equal(health.discovery.search_enabled,false);
  assert.equal(health.discovery.bootstrap_retry_attempts,0);
  const denied=await fetch(`http://127.0.0.1:${port}/api/queue/status`);
  assert.equal(denied.status,503);
  assert.equal((await denied.json()).code,'worker_key_not_configured');
 }finally{
  if(child){child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',resolve)});}
  await rm(dir,{recursive:true,force:true});
 }
});


test('health remains responsive while a slow yt-dlp executable initializes',
  {skip:process.platform!=='linux',timeout:18000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pikete-slow-boot-'));
 const original=dirname(dirname(fileURLToPath(import.meta.url)));
 let child;
 try{
  for(const entry of ['server.mjs','package.json','src','scripts'])
   await cp(join(original,entry),join(dir,entry),{recursive:true});
  await mkdir(join(dir,'bin'));
  await writeFile(join(dir,'bin','yt-dlp'),'#!/bin/sh\nsleep 0.6\nprintf "2026.10.21\\n"\n');
  await chmod(join(dir,'bin','yt-dlp'),0o755);
  const port=await freePort();
  child=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{...process.env,PORT:String(port),
   PIKETE_YTDLP_SEARCH_ENABLED:'false',PIKETE_WORKER_KEY:''},stdio:['ignore','pipe','pipe']});
  let first=null,last=null;
  for(let i=0;i<80;i++){
   await new Promise(resolve=>setTimeout(resolve,55));
   if(child.exitCode!==null)throw Error(`Render exited ${child.exitCode}`);
   try{
    const response=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(550)});
    const data=await response.json();
    first ||= data;
    last=data;
   }catch{}
   // The response body is read only once; don't turn an early response into a failure.
   if(last?.discovery?.bootstrap==='ready')break;
  }
  assert.ok(first,'health must be reachable during installation');
  assert.ok(['installing','pending','ready'].includes(first.discovery.bootstrap));
  // Poll independently after the executable has had enough time to start.
  let ready=false;
  for(let i=0;i<40;i++){
   await new Promise(resolve=>setTimeout(resolve,60));
   const data=await (await fetch(`http://127.0.0.1:${port}/health`)).json();
   if(data.discovery.bootstrap==='ready'){ready=data.discovery.ytdlp_binary_detected;break;}
  }
  assert.equal(ready,true);
 }finally{
  if(child){child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',resolve)});}
  await rm(dir,{recursive:true,force:true});
 }
});
