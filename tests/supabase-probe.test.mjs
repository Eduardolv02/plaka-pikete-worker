import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSupabaseProjectUrl, checkSupabaseNode, checkBothSupabaseNodes} from '../src/supabase-probe.mjs';

const base='https://abc123.supabase.co';
test('accepts Supabase project origins only', () => {
  assert.equal(parseSupabaseProjectUrl(base), base);
  assert.equal(parseSupabaseProjectUrl(base + '/'), base);
  for(const url of ['http://abc123.supabase.co','https://x.supabase.co.evil.tld',
    'https://x.supabase.co@evil.tld', 'https://x.supabase.co:444',
    'https://x.supabase.co/evil', 'https://x.supabase.co?x=1',
    'https://127.0.0.1', 'https://x.supabase.com', '']) {
    assert.equal(parseSupabaseProjectUrl(url), null, url);
  }
});
test('probe checks exact auth health path and never follows redirects', async () => {
  let called=false;
  const result=await checkSupabaseNode('B', base, {fetchImpl:async(url,opts)=>{
    called=true;
    assert.equal(url,base+'/auth/v1/health');
    assert.equal(opts.redirect,'manual');
    assert.equal(opts.method,'GET');
    return {status:200};
  }});
  assert.equal(called,true);
  assert.deepEqual(result, {node:'B',state:'reachable',http_status:200});
});
test('private diagnostic returns no project URLs or credentials',async()=>{
  const env={PIKETE_SUPABASE_B_URL:base, PIKETE_SUPABASE_C_URL:'https://xyz.supabase.co',PIKETE_WORKER_KEY:'s'.repeat(64)};
  const result=await checkBothSupabaseNodes(env,{fetchImpl:async()=>({status:200})});
  assert.equal(result.ok,true);
  assert.deepEqual(result.checks.map(x=>x.node),['B','C']);
  const json=JSON.stringify(result);
  assert.ok(!json.includes('xyz.supabase.co'));
  assert.ok(!json.includes(env.PIKETE_WORKER_KEY));
});
test('misconfiguration, blocked auth, HTTP failure and network error are classified', async()=>{
  assert.equal((await checkSupabaseNode('B','')).state,'not_configured');
  assert.equal((await checkSupabaseNode('B','http://localhost')).state,'invalid_configuration');
  assert.equal((await checkSupabaseNode('B',base,{fetchImpl:async()=>({status:401})})).state,'reachable_auth_restricted');
  assert.equal((await checkSupabaseNode('B',base,{fetchImpl:async()=>({status:500})})).state,'unexpected_http');
  assert.equal((await checkSupabaseNode('B',base,{fetchImpl:async()=>{throw new Error('token should not leak')}})).state,'network_error');
});
