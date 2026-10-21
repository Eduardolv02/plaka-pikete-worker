import test from 'node:test';
import assert from 'node:assert/strict';
import {processOneJob} from '../src/pikete-processor.mjs';
const ID='a1234567-1234-4234-a234-123456789abc';
const JOB='b1234567-1234-4234-a234-123456789abc';
const CAT='c1234567-1234-4234-a234-123456789abc';
const env={
 PIKETE_SUPABASE_B_URL:'https://cpdklixfmiibrcptleir.supabase.co',
 PIKETE_SUPABASE_B_SECRET_KEY:'sb_secret_'+'b'.repeat(32),
 PIKETE_SUPABASE_A_SECRET_KEY:'sb_secret_'+'a'.repeat(32),
};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
test('match job queries A, stores candidate in B transaction and never marks audio ready',async()=>{
 const calls=[];
 const fetchImpl=async(url,opts)=>{
   calls.push({url,body:opts.body?JSON.parse(opts.body):null});
   if(url.includes('/pikete_playlist_items?'))return json([{id:ID,source_type:'external',artist:'Daft Punk',title:'One More Time',normalization_status:'normalized',
     normalized_metadata:{ok:true,title_key:'one more time',artist_key:'daft punk',title_candidate:'One More Time',artist_candidate:'Daft Punk',versions:[],isrc:null}}]);
   if(url.includes('/plaka_tracks?'))return json([{id:CAT,status:'published',title:'One More Time',artist_name:'Daft Punk',rights_attested:true,telegram_file_id:'some-file',telegram_bot_key:'slot-A'}]);
   if(url.includes('/rpc/pikete_queue_record_match'))return json({ok:true,outcome:'done'});
   throw Error(`unexpected URL ${url}`);
 };
 const res=await processOneJob('B','worker-smoke',{id:JOB,job_type:'match',playlist_item_id:ID},{env,fetchImpl});
 assert.equal(res.outcome,'done');
 assert.equal(res.candidates,1);
 const recorded=calls.find(c=>c.url.includes('/rpc/pikete_queue_record_match'));
 assert.equal(recorded.body.p_result.candidates[0].ref,CAT);
 assert.equal(recorded.body.p_result.candidates[0].direct_playback_eligible,false);
 assert.equal(calls.filter(c=>c.url.includes('/rest/v1/plaka_tracks?')).length,1);
});
test('catalog failure retries matching rather than claiming same recording',async()=>{
 const calls=[];
 const fetchImpl=async(url,opts)=>{
   calls.push(url);
   if(url.includes('/pikete_playlist_items?'))return json([{id:ID,source_type:'external',normalization_status:'normalized',normalized_metadata:{ok:true,artist_candidate:'Daft Punk',title_candidate:'One More Time',artist_key:'daft punk',title_key:'one more time',versions:[]}}]);
   if(url.includes('/rpc/pikete_queue_finish'))return json([{status:'retry'}]);
   if(url.includes('/plaka_tracks?'))return json({message:'error'},503);
   throw Error(`unexpected url ${url}`);
 };
 const res=await processOneJob('B','worker-smoke',{id:JOB,job_type:'match',playlist_item_id:ID},{env,fetchImpl});
 assert.equal(res.outcome,'retry_or_expired');assert.equal(calls.some(x=>x.includes('/rpc/pikete_queue_record_match')),false);
 assert.equal(calls.some(x=>x.includes('/rpc/pikete_queue_finish')),true);
});
