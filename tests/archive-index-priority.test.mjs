import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupArchiveMetadata,lookupArchiveHash,recordingKey} from '../src/archive-lookup.mjs';
import {rankYoutubeCandidates} from '../src/youtube-discovery.mjs';
const env={PIKETE_SUPABASE_B_URL:'https://cpdklixfmiibrcptleir.supabase.co',
 PIKETE_SUPABASE_B_SECRET_KEY:'sb_secret_'+'a'.repeat(32),
 PIKETE_SUPABASE_C_URL:'https://wxleseokrzltkuyjmjev.supabase.co',
 PIKETE_SUPABASE_C_SECRET_KEY:'sb_secret_'+'b'.repeat(32)};
const sha='f'.repeat(64);
const response=(v)=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
test('index looks in BOTH shards and reports only possible duplicates from title/duration',async()=>{
 const seen=[];
 const result=await lookupArchiveMetadata({artist:'AURÓRA',title:'Runaway',durationMs:250000},{env,fetchImpl:async(url)=>{
  seen.push(url);
  return response(url.includes('cpdklix')?[]:[{sha256:sha,normalized_key:'aurora:runaway',duration_ms:251200,source_video_id:'abcdefghijk'}]);
 }});
 assert.equal(result.status,'possible_existing_copy');
 assert.equal(result.exact_audio,false);
 assert.equal(result.candidates[0].duration_delta_ms,1200);
 assert.equal(result.candidates[0].node,'C');
 assert.equal(seen.length,2);
 assert.equal(seen.every(u=>!u.includes('sb_secret_')),true);
});
test('SHA-256 identifies exact archived bytes independent of title and can reuse node C',async()=>{
 const found=await lookupArchiveHash(sha,{env,fetchImpl:async url=>response(url.includes('cpdklix')?[]:[{sha256:sha,bot_slot:2,telegram_file_id:'tgFileId1234567890123',mime_type:'audio/mpeg'}])});
 assert.equal(found.node,'C');
 assert.equal(found.sha256,sha);
 assert.equal(await lookupArchiveHash('invalid',{env,fetchImpl:()=>{throw Error('unexpected fetch')}}),null);
});
test('YouTube duration mismatch or live/studio conflict requires user review',()=>{
 const wanted={artist_candidate:'Aurora',title_candidate:'Runaway',duration_ms:250000,versions:[]};
 const scored=rankYoutubeCandidates(wanted,[
  {id:'aaaaaaaaaaa',title:'Aurora - Runaway (Live)',channel:'AURORA',duration_ms:260000},
  {id:'bbbbbbbbbbb',title:'Aurora - Runaway (Official Audio)',channel:'AURORA',duration_ms:250800},
  {id:'ccccccccccc',title:'Aurora - Runaway',channel:'Someone else',duration_ms:850000},
 ]);
 assert.equal(scored[0].id,'bbbbbbbbbbb');
 assert.equal(scored.find(x=>x.id==='aaaaaaaaaaa').version_mismatch,true);
 assert.ok(scored[2].score<scored[0].score);
 assert.equal(recordingKey('AURÓRA','Runaway'),'aurora:runaway');
});

test('a malformed archive index row is never treated as verified bytes',async()=>{
 const malformed=await lookupArchiveHash(sha,{env,fetchImpl:async()=>response([{sha256:'0'.repeat(64),bot_slot:1,telegram_file_id:'x'}])});
 assert.equal(malformed,null);
});
