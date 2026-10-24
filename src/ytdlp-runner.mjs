/** Run pinned yt-dlp without a shell, using Render's existing Node runtime.
 * yt-dlp standalone releases bundle the EJS solver, but Node must be enabled
 * explicitly. Error codes are classified from bounded stderr; never log raw
 * subprocess output, URLs, cookies, tokenized URLs or credentials.
 */
import {spawn} from 'node:child_process';
import {QueueError} from './pikete-queue.mjs';
import {selectYtDlpBinary} from './ytdlp-path.mjs';

export const YTDLP_JS_RUNTIME_ARGS = Object.freeze(['--js-runtimes','node']);

export function classifyYtDlpFailure(stderr='',namespace='ytdlp') {
  if(namespace==='ffmpeg')return 'ffmpeg_execution_failed';
  const s=String(stderr).toLowerCase();
  if(/sign in to confirm|not a bot|login required|sign in to confirm your age|authentication required|this video is private|members.only/.test(s))return 'ytdlp_auth_required';
  if(/(?:http (?:error )?429|\b429 too many requests\b|rate.limit|too many requests)/.test(s))return 'ytdlp_rate_limited';
  if(/(?:http (?:error )?403|\b403 forbidden\b|access denied)/.test(s))return 'ytdlp_http_403';
  if(/(?:no supported javascript runtime|javascript runtime could not be found|javascript challenge|js challenge|challenge solver|ejs.*(?:missing|failed)|nsig extraction failed|signature solving failed)/.test(s))return 'ytdlp_js_challenge';
  if(/(?:requested format is not available|no video formats found|no formats found|only images are available)/.test(s))return 'ytdlp_formats_unavailable';
  if(/(?:video unavailable|video is unavailable|this video is not available|video has been removed|video has been deleted|http error 404)/.test(s))return 'ytdlp_video_unavailable';
  if(/(?:not available in your country|not available in your region|geo.restricted)/.test(s))return 'ytdlp_region_restricted';
  if(/(?:network is unreachable|temporary failure in name resolution|connection timed out|connection reset|unable to establish ssl|http error 50[0-9])/i.test(s))return 'ytdlp_network_error';
  return 'ytdlp_execution_failed';
}

export async function runProcess(command, args, {
  timeoutMs=45000,maxOutput=524288,cwd,spawnImpl=spawn,errorNamespace='ytdlp'
}={}) {
  return await new Promise((resolve,reject)=>{
    let settled=false, output='',total=0,stderrTail='',timer;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
    let child;
    try {child=spawnImpl(command,args,{cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});}
    catch {return finish(new QueueError(errorNamespace==='ffmpeg'?'ffmpeg_unavailable':'ytdlp_unavailable',503));}
    timer=setTimeout(()=>{
      try{child.kill('SIGKILL');}catch{}
      finish(new QueueError(errorNamespace==='ffmpeg'?'ffmpeg_timeout':'ytdlp_timeout',504));
    },timeoutMs);
    child.stdout?.on('data',chunk=>{
      total+=chunk.length;
      if(total>maxOutput){try{child.kill('SIGKILL');}catch{};return finish(new QueueError(errorNamespace==='ffmpeg'?'ffmpeg_output_limit':'ytdlp_output_limit',502));}
      output+=chunk.toString('utf8');
    });
    child.stderr?.on('data',chunk=>{
      // Keep only a short tail for classification (yt-dlp errors are at the end).
      // Never return it to the HTTP client or print it in Render logs.
      stderrTail=(stderrTail+chunk.toString('utf8')).slice(-8192);
    });
    child.on('error',()=>finish(new QueueError(errorNamespace==='ffmpeg'?'ffmpeg_unavailable':'ytdlp_unavailable',503)));
    child.on('close',code=>finish(code===0?null:new QueueError(classifyYtDlpFailure(stderrTail,errorNamespace),502),output));
  });
}

export async function runYtDlpJson(args,options={}){
  const env=options.env||process.env;
  let command;
  try { command=selectYtDlpBinary(env); }
  catch { throw new QueueError('ytdlp_binary_not_allowed',503); }
  const exec=options.runProcess||runProcess;
  const raw=await exec(command,['--ignore-config',...YTDLP_JS_RUNTIME_ARGS,'--no-playlist',
    '--no-cache-dir','--socket-timeout','12','--retries','1','--extractor-retries','1',...args],
    {timeoutMs:options.timeoutMs||45000,maxOutput:524288,errorNamespace:'ytdlp'});
  try{return JSON.parse(raw);}catch{throw new QueueError('ytdlp_invalid_json',502);}
}
