/** Non-blocking probe for the known server-side yt-dlp executable.
 * Standalone PyInstaller builds may take longer than four seconds to launch
 * on a low-resource Node instance. A slow launch is not an invalid binary.
 * All diagnostics are finite codes, never stdout/stderr or environment data.
 */
import {spawn} from 'node:child_process';

export async function probeYtDlpBinary(command,{timeoutMs=30000,spawnImpl=spawn}={}) {
 return await new Promise(resolve=>{
  let done=false,child,handle=null,output='';
  const finish=result=>{
   if(done)return;
   done=true;
   if(handle!==null)clearTimeout(handle);
   resolve(result);
  };
  try {
   child=spawnImpl(command,['--version'],{
    shell:false,windowsHide:true,stdio:['ignore','pipe','ignore'],
   });
  }catch(e){return finish({ok:false,code:mapError(e)});}
  child.stdout?.on('data',chunk=>{if(output.length<256)output+=chunk.toString('utf8').slice(0,256-output.length)});
  child.once('error',err=>finish({ok:false,code:mapError(err)}));
  child.once('close',(code,signal)=>{
   if(code!==0)return finish({ok:false,code:signal?'yt_dlp_interrupted':'yt_dlp_execution_failed'});
   if(!/^\d{4}\.\d{1,2}\.\d{1,2}(?:\s|$)/.test(output.trim()))
    return finish({ok:false,code:'yt_dlp_unexpected_version'});
   return finish({ok:true,code:null});
  });
  handle=setTimeout(()=>{
   try{child.kill('SIGKILL')}catch{}
   finish({ok:false,code:'yt_dlp_probe_timeout'});
  },timeoutMs);
  handle.unref?.();
 });
}
function mapError(err){
 if(err?.code==='ENOENT')return 'yt_dlp_binary_missing';
 if(err?.code==='EACCES')return 'yt_dlp_permission_denied';
 if(err?.code==='ETIMEDOUT')return 'yt_dlp_probe_timeout';
 if(err?.code==='ENOEXEC')return 'yt_dlp_exec_format_error';
 return 'yt_dlp_execution_failed';
}
