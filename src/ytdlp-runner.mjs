/** Server-side yt-dlp runner adapted from Plaka Pikete lab 1.7.1.
 * No secrets are passed as CLI arguments; no shell interpolation or raw stderr returned.
 */
import {spawn} from 'node:child_process';
import {QueueError} from './pikete-queue.mjs';
import {selectYtDlpBinary} from './ytdlp-path.mjs';

export async function runProcess(command, args, {timeoutMs=45000,maxOutput=524288,cwd,spawnImpl=spawn}={}) {
  return await new Promise((resolve,reject)=>{
    let settled=false, output='', total=0, timer;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
    let child;
    try {child=spawnImpl(command,args,{cwd, shell:false, windowsHide:true, stdio:['ignore','pipe','ignore']});}
    catch {return finish(new QueueError('ytdlp_unavailable',503));}
    timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{} finish(new QueueError('ytdlp_timeout',504));},timeoutMs);
    child.stdout?.on('data',chunk=>{
      total+=chunk.length;
      if(total>maxOutput){try{child.kill('SIGKILL');}catch{};return finish(new QueueError('ytdlp_output_limit',502));}
      output+=chunk.toString('utf8');
    });
    child.on('error',()=>finish(new QueueError('ytdlp_unavailable',503)));
    child.on('close',code=>finish(code===0?null:new QueueError('ytdlp_execution_failed',502),output));
  });
}

export async function runYtDlpJson(args,options={}){
  const env=options.env||process.env;
  // No user can choose the executable or pass arbitrary yt-dlp options.
  let command;
  try { command=selectYtDlpBinary(env); }
  catch { throw new QueueError('ytdlp_binary_not_allowed',503); }
  const exec=options.runProcess||runProcess;
  const raw=await exec(command,['--ignore-config','--no-playlist','--no-warnings',
    '--no-cache-dir','--socket-timeout','12','--retries','1','--extractor-retries','1',...args],
    {timeoutMs:options.timeoutMs||45000,maxOutput:524288});
  try{return JSON.parse(raw);}catch{throw new QueueError('ytdlp_invalid_json',502);}
}
