import test from 'node:test';
import assert from 'node:assert/strict';
import { processQueueTick,getItemForNormalization } from '../src/pikete-processor.mjs';
const env={PIKETE_SUPABASE_B_URL:'https://cpdklixfmiibrcptleir.supabase.co',
 PIKETE_SUPABASE_B_SECRET_KEY:'sb_secret_' + 'A'.repeat(32),
 PIKETE_QUEUE_MUTATIONS_ENABLED:'true',PIKETE_PROCESSOR_ENABLED:'true'};
test('processor refuses to mutate when feature disabled',async()=>{
 await assert.rejects(processQueueTick({node:'B',limit:1},{env:{...env,PIKETE_PROCESSOR_ENABLED:'false'}}),
  e=>e.code==='processor_disabled');
});
test('processor requires mutation flag separately',async()=>{
 await assert.rejects(processQueueTick({node:'B',limit:1},{env:{...env,PIKETE_QUEUE_MUTATIONS_ENABLED:'false'}}),
  e=>e.code==='queue_mutations_disabled');
});
test('processor validates node and batch size',async()=>{
 for(const invalid of [{node:'A'}, {node:'B',limit:0}, {node:'both',limit:11},{}])
  await assert.rejects(processQueueTick(invalid,{env}),e=>e.code==='invalid_processor_arguments');
});
test('item lookup uses private key, GET and bounded fields',async()=>{
 let seen;
 const id='a1234567-1234-4234-a234-123456789abc';
 const row={id,source_type:'external',artist:'A',title:'B'};
 const result=await getItemForNormalization('B',id,{env,fetchImpl:async (url,options)=>{
  seen={url,options};return {ok:true,json:async()=>[row]};
 }});
 assert.deepEqual(result,row);
 assert.equal(seen.options.method,'GET');
 assert.equal(seen.options.headers.apikey,env.PIKETE_SUPABASE_B_SECRET_KEY);
 assert.match(seen.url,/pikete_playlist_items/);
});
