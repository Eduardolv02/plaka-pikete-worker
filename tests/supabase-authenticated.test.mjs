import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAuthenticatedNode, checkAuthenticatedNodes } from '../src/supabase-authenticated.mjs';

const url = 'https://cpdklixfmiibrcptleir.supabase.co';
const key = 'sb_secret_' + 'x'.repeat(35);

test('uses secret in apikey ONLY; never as bearer or URL; no redirects', async () => {
  const result = await checkAuthenticatedNode('B', url, key, {fetchImpl: async (u,opts) => {
    assert.equal(u,url+'/rest/v1/');
    assert.equal(opts.headers.apikey,key);
    assert.equal(opts.headers.Authorization,undefined);
    assert.equal(opts.redirect,'manual');
    assert.equal(opts.method,'GET');
    return {status:200};
  }});
  assert.deepEqual(result, {node:'B',state:'authenticated_rest_api',http_status:200});
});

test('missing or malformed credentials never call external services',async()=>{
  const fail=async()=>{throw Error('unexpected fetch')};
  assert.equal((await checkAuthenticatedNode('B',url,'',{fetchImpl:fail})).state,'not_configured');
  assert.equal((await checkAuthenticatedNode('B','http://localhost',key,{fetchImpl:fail})).state,'invalid_url');
  assert.equal((await checkAuthenticatedNode('B',url,'sb_publishable_123',{fetchImpl:fail})).state,'invalid_key_format');
});

test('categorizes HTTP and network failures without leaking response',async()=>{
  for (const [code,state] of [[401,'unauthorized_key'],[403,'forbidden'],[302,'unexpected_redirect'],[500,'unexpected_http']]) {
    const r = await checkAuthenticatedNode('B',url,key,{fetchImpl:async()=>({status:code})});
    assert.equal(r.state,state);
    assert.equal(r.http_status,code);
  }
  const r=await checkAuthenticatedNode('B',url,key,{fetchImpl:async()=>{throw new Error('private api key leak '+key)}});
  assert.equal(r.state,'network_error');
  assert.ok(!JSON.stringify(r).includes(key));
});

test('checks both nodes and returns only minimal metadata',async()=>{
  const env={
    PIKETE_SUPABASE_B_URL:url,PIKETE_SUPABASE_B_SECRET_KEY:key,
    PIKETE_SUPABASE_C_URL:'https://wxleseokrzltkuyjmjev.supabase.co',PIKETE_SUPABASE_C_SECRET_KEY:'sb_secret_'+'a'.repeat(33),
  };
  const r=await checkAuthenticatedNodes(env,{fetchImpl:async()=>({status:200})});
  assert.equal(r.ok,true);
  assert.deepEqual(r.checks.map(x=>x.node),['B','C']);
  assert.ok(!JSON.stringify(r).includes(key));
  assert.ok(!JSON.stringify(r).includes('supabase.co'));
});

test('partial failure sets ok false',async()=>{
  const env={PIKETE_SUPABASE_B_URL:url,PIKETE_SUPABASE_B_SECRET_KEY:key};
  const r=await checkAuthenticatedNodes(env,{fetchImpl:async()=>({status:200})});
  assert.equal(r.ok,false);
  assert.equal(r.checks[1].state,'not_configured');
});
