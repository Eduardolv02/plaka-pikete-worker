import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QueueError, getNodeConfig, requireMutationsEnabled, callQueueRpc,
  getQueueSummary, claimQueueJobs, heartbeatQueueJob, finishQueueJob
} from '../src/pikete-queue.mjs';
const config={
  PIKETE_SUPABASE_B_URL:'https://cpdklixfmiibrcptleir.supabase.co',
  PIKETE_SUPABASE_B_SECRET_KEY: 'sb_secret_'+'b'.repeat(32),
  PIKETE_SUPABASE_C_URL:'https://wxleseokrzltkuyjmjev.supabase.co',
  PIKETE_SUPABASE_C_SECRET_KEY: 'sb_secret_'+'c'.repeat(32),
};
const allowed={...config,PIKETE_QUEUE_MUTATIONS_ENABLED:'true'};
const uuid='9de565c2-ae45-4f01-9fa3-abaf1a584eed';

test('only B and C accepted as target nodes',()=>{
  assert.equal(getNodeConfig('B',config).origin,'https://cpdklixfmiibrcptleir.supabase.co');
  assert.equal(getNodeConfig('C',config).origin,'https://wxleseokrzltkuyjmjev.supabase.co');
  assert.throws(()=>getNodeConfig('A',config),/invalid_node/);
});
test('no secret available never dispatches a request',async()=>{
  let used=false;
  await assert.rejects(callQueueRpc('B','pikete_queue_status',{}, {env:{},fetchImpl:async()=>{used=true;}}),/node_not_configured/);
  assert.equal(used,false);
});
test('RPC sends secret only as API key, no redirect, no bearer',async()=>{
  const status={total:0,queued:0};
  const r=await callQueueRpc('B','pikete_queue_status',{}, {env:config,fetchImpl:async(url,opts)=>{
    assert.equal(url,'https://cpdklixfmiibrcptleir.supabase.co/rest/v1/rpc/pikete_queue_status');
    assert.equal(opts.headers.apikey,config.PIKETE_SUPABASE_B_SECRET_KEY);
    assert.equal(opts.headers.Authorization,undefined);
    assert.equal(opts.redirect,'manual');
    assert.deepEqual(JSON.parse(opts.body),{});
    return {status:200,json:async()=>status};
  }});
  assert.deepEqual(r,status);
});
test('mutations disabled by default',async()=>{
  assert.throws(()=>requireMutationsEnabled(config),e=>e.code==='queue_mutations_disabled' && e.status===403);
  await assert.rejects(claimQueueJobs({node:'B',worker:'render-worker'},{env:config,fetchImpl:async()=>{throw Error('should not call')}}),/queue_mutations_disabled/);
});
test('cannot select non-shard node for RPC',async()=>{
  await assert.rejects(callQueueRpc('A','pikete_queue_status',{}, {env:config,fetchImpl:async()=>{throw Error('unexpected')}}),/invalid_node/);
});
test('claim validates batch/worker/lease and calls correct RPC',async()=>{
  const called=[];
  const fetchImpl=async (url,opts)=>{called.push([url,JSON.parse(opts.body)]);return {status:200,json:async()=>[{id:uuid}]};};
  const out=await claimQueueJobs({node:'B',worker:'test-worker',limit:2,lease_seconds:90},{env:allowed,fetchImpl});
  assert.equal(out.count,1);
  assert.equal(called[0][1].p_batch_size,2);
  assert.equal(called[0][1].p_worker,'test-worker');
  assert.equal(called[0][1].p_lease_seconds,90);
  await assert.rejects(claimQueueJobs({node:'B',worker:'test-worker',limit:100},{env:allowed,fetchImpl}),/invalid_claim_arguments/);
});
test('heartbeat validates UUID and progress',async()=>{
  await assert.rejects(heartbeatQueueJob({node:'B',job_id:'bad',worker:'test-worker'},{env:allowed}),/invalid_heartbeat_arguments/);
  const r=await heartbeatQueueJob({node:'C',job_id:uuid,worker:'test-worker',progress:40},{env:allowed,fetchImpl:async()=>({status:200,json:async()=>[{id:uuid}]})});
  assert.equal(r.changed,1);
});
test('finish returns no-change if lease is lost',async()=>{
  const r=await finishQueueJob({node:'B',job_id:uuid,worker:'test-worker',outcome:'retry'},{env:allowed,fetchImpl:async()=>({status:200,json:async()=>[]})});
  assert.equal(r.ok,false);
  assert.equal(r.changed,0);
});
test('rejects malformed finish values',async()=>{
  await assert.rejects(finishQueueJob({node:'C',job_id:uuid,worker:'test-worker',outcome:'finished'},{env:allowed}),/invalid_finish_arguments/);
  await assert.rejects(finishQueueJob({node:'C',job_id:uuid,worker:'test-worker',outcome:'retry',retry_seconds:100000},{env:allowed}),/invalid_finish_arguments/);
});
test('status shows two nodes with counts only',async()=>{
  const data={total:0,queued:0,retry:0,leased:0,done:0,failed:0,manual_review:0,runnable:0,expired_leases:0};
  const r=await getQueueSummary({env:config,fetchImpl:async()=>({status:200,json:async()=>data})});
  assert.equal(r.ok,true);
  assert.equal(r.checks.length,2);
  assert.equal(r.polling,'disabled');
  assert.equal(r.checks[0].counts.total,0);
});
test('status tolerates failure of one node without exposing secrets',async()=>{
  const r=await getQueueSummary({env:config,fetchImpl:async(u)=>u.includes('cpdklix') ? ({status:401}) : ({status:200,json:async()=>({total:2})})});
  assert.equal(r.ok,false);
  assert.equal(r.checks[0].state,'queue_supabase_unauthorized');
  assert.equal(r.checks[1].state,'ready');
  assert.ok(!JSON.stringify(r).includes('sb_secret_'));
});
test('network and timeout errors map to sanitized codes',async()=>{
  await assert.rejects(callQueueRpc('B','pikete_queue_status',{}, {env:config,fetchImpl:async()=>{throw Error('contains secret')}}),e=>e.code==='queue_network_error');
  await assert.rejects(callQueueRpc('B','pikete_queue_status',{}, {env:config,fetchImpl:async()=>{throw Object.assign(Error('timeout'),{name:'TimeoutError'})}}),e=>e.code==='queue_timeout');
});
test('unexpected rpc forbidden',async()=>{
  await assert.rejects(callQueueRpc('B','any_rpc',{}, {env:config}),/unknown_queue_rpc/);
});
