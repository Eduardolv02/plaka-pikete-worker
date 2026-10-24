import test from 'node:test';
import assert from 'node:assert/strict';
import {createYtDlpBootstrap} from '../src/ytdlp-bootstrap.mjs';

function fakeClock() {
 const scheduled=new Map();let next=1;
 const add=(kind,fn,ms)=>{let id=next++;scheduled.set(id,{kind,fn,ms});return id;};
 return {scheduled,
  setTimeoutImpl:(fn,ms)=>add('timeout',fn,ms),
  setIntervalImpl:(fn,ms)=>add('interval',fn,ms),
  clearTimeoutImpl:(id)=>scheduled.delete(id),
  clearIntervalImpl:(id)=>scheduled.delete(id),
  fire:async(kind)=>{
   const found=[...scheduled].find(([,x])=>x.kind===kind);
   assert.ok(found,`expected ${kind}`);
   const [id,{fn}]=found;
   if(kind==='timeout')scheduled.delete(id);
   fn();await new Promise(resolve=>setImmediate(resolve));
  }
 };
}

test('successful bootstrap installs once, refreshes old items and schedules a single periodic refresh', async()=>{
 const clock=fakeClock();let installed=0, refreshed=0;
 const bootstrap=createYtDlpBootstrap({install:async()=>{installed++},isAvailable:()=>true,
  refresh:()=>{refreshed++},enabled:()=>true,...clock});
 await Promise.all([bootstrap.run(),bootstrap.run()]);
 assert.equal(installed,1);assert.equal(refreshed,1);
 assert.equal(bootstrap.state.status,'ready');assert.equal(bootstrap.state.attempts,0);
 assert.ok(bootstrap.state.last_success_at);
 await bootstrap.run();assert.equal(installed,1);
 await clock.fire('interval');assert.equal(refreshed,2);
 assert.equal([...clock.scheduled.values()].filter(x=>x.kind==='interval').length,1);
 bootstrap.stop();assert.equal(clock.scheduled.size,0);
});

test('failure retries with bounded backoff without restarting Render or spinning',async()=>{
 const clock=fakeClock();let calls=0,refreshed=0;
 const bootstrap=createYtDlpBootstrap({install:async()=>{calls++;if(calls<3)throw Error('CDN timeout')},
  isAvailable:()=>true,refresh:()=>{refreshed++},enabled:()=>true,
  retryDelaysMs:[40,80,160],...clock});
 await bootstrap.run();
 assert.equal(bootstrap.state.status,'failed');assert.equal(bootstrap.state.code,'yt_dlp_install_failed');
 assert.equal([...clock.scheduled.values()][0].ms,40);
 await clock.fire('timeout');
 assert.equal(calls,2);assert.equal([...clock.scheduled.values()][0].ms,80);
 await clock.fire('timeout');
 assert.equal(calls,3);assert.equal(bootstrap.state.status,'ready');
 assert.equal(refreshed,1);
 bootstrap.stop();
});

test('binary that installs but cannot run is not called ready',async()=>{
 const clock=fakeClock();const errors=[];
 const bootstrap=createYtDlpBootstrap({install:async()=>{},isAvailable:()=>false,
  refresh:()=>{throw Error('not expected')},enabled:()=>true,onFailure:c=>errors.push(c),...clock});
 await bootstrap.run();
 assert.equal(bootstrap.state.status,'failed');
 assert.equal(bootstrap.state.code,'yt_dlp_not_executable');
 assert.deepEqual(errors,['yt_dlp_not_executable']);
 bootstrap.stop();
});

test('search disabled leaves archived data intact; refresh exceptions do not invalidate binary',async()=>{
 const clock=fakeClock();let refreshed=0;
 const bootstrap=createYtDlpBootstrap({install:async()=>{},isAvailable:()=>true,
  refresh:()=>{refreshed++;throw Error('offline')},enabled:()=>false,...clock});
 await bootstrap.run();assert.equal(bootstrap.state.status,'ready');assert.equal(refreshed,0);
 assert.equal(clock.scheduled.size,0);bootstrap.stop();
 const active=createYtDlpBootstrap({install:async()=>{},isAvailable:()=>true,
  refresh:()=>{refreshed++;throw Error('db offline')},enabled:()=>true,...clock});
 await active.run();assert.equal(active.state.status,'ready');assert.equal(refreshed,1);
 active.stop();
});

test('stopping cancels further retries',async()=>{
 const clock=fakeClock();const bootstrap=createYtDlpBootstrap({install:async()=>{throw Error('offline')},
  isAvailable:()=>false,refresh:()=>{},enabled:()=>true,...clock});
 await bootstrap.run();assert.equal(clock.scheduled.size,1);
 bootstrap.stop();assert.equal(clock.scheduled.size,0);
 await bootstrap.run();assert.equal(clock.scheduled.size,0);
});

test('a timed-out or permission-denied binary keeps a specific diagnostic code in health state',async()=>{
 const clock=fakeClock();let code='yt_dlp_probe_timeout';
 const bootstrap=createYtDlpBootstrap({install:async()=>{},isAvailable:async()=>({ok:false,code}),
  refresh:()=>{},enabled:()=>true,...clock});
 await bootstrap.run();
 assert.equal(bootstrap.state.code,'yt_dlp_probe_timeout');
 code='yt_dlp_permission_denied';
 await clock.fire('timeout');
 assert.equal(bootstrap.state.code,'yt_dlp_permission_denied');
 bootstrap.stop();
});
