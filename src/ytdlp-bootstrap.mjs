/** Keep the already-configured yt-dlp search recoverable on Render Node.
 * No new environment variables, untrusted commands or background promises.
 * Installer only fetches an official pinned and SHA-256-verified release.
 */
export function createYtDlpBootstrap({
  install, isAvailable, refresh, enabled,
  onReady = () => {}, onFailure = () => {},
  setTimeoutImpl = setTimeout, setIntervalImpl = setInterval,
  clearTimeoutImpl = clearTimeout, clearIntervalImpl = clearInterval,
  retryDelaysMs = [30_000, 90_000, 180_000, 360_000, 600_000],
  refreshEveryMs = 600_000,
} = {}) {
  if ([install,isAvailable,refresh,enabled].some(x => typeof x !== 'function'))
    throw new TypeError('bootstrap_functions_required');
  const state = {status:'pending',code:null,attempts:0,last_success_at:null};
  let retryHandle=null,refreshHandle=null,pending=null,stopped=false;

  async function run() {
    if(stopped) return state;
    if(pending) return pending;
    if(state.status==='ready') return state;
    pending=(async()=>{
      state.status='installing';
      state.code=null;
      try {
        await install();
        if(!isAvailable()) throw Object.assign(new Error('yt_dlp_not_executable'),{code:'yt_dlp_not_executable'});
        state.status='ready';
        state.attempts=0;
        state.last_success_at=new Date().toISOString();
        onReady();
        if(enabled()) {
          // A failed search must not prevent the installed binary from being ready.
          try {refresh();} catch(e) {onFailure('refresh_launch_failed');}
          if(!refreshHandle) refreshHandle=setIntervalImpl(()=>{
            if(!enabled()) return;
            try {refresh();} catch {onFailure('refresh_launch_failed');}
          },refreshEveryMs);
          refreshHandle?.unref?.();
        }
      } catch(e) {
        state.status='failed';
        const code=String(e?.code||e?.message||'yt_dlp_install_failed');
        state.code=/^yt_dlp_[a-z0-9_]+$/.test(code)?code:'yt_dlp_install_failed';
        onFailure(state.code);
        const delay=retryDelaysMs[Math.min(state.attempts,retryDelaysMs.length-1)];
        state.attempts++;
        // Retry with capped backoff for temporary GitHub/CDN/network failures,
        // not a busy loop. A Render restart is not required to recover.
        if(!stopped && retryHandle===null){
          retryHandle=setTimeoutImpl(()=>{
            retryHandle=null;
            void run();
          },delay);
          retryHandle?.unref?.();
        }
      } finally {pending=null;}
      return state;
    })();
    return pending;
  }

  function stop() {
    stopped=true;
    if(retryHandle!==null)clearTimeoutImpl(retryHandle);
    if(refreshHandle!==null)clearIntervalImpl(refreshHandle);
    retryHandle=null;refreshHandle=null;
  }
  return {state,run,stop};
}
