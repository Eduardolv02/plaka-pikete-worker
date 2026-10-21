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
test('local audio normalizes name + artist + duration and suggests Plaka, without auto-sharing',async()=>{
 const requests=[];
 const fetchImpl=async(url,opt)=>{
  requests.push({url,body:opt.body?JSON.parse(opt.body):undefined});
  if(url.includes('/pikete_playlist_items?'))return json([{id:ID,source_type:'local',source_ref:null,
   artist:'Daft Punk',title:'One More Time (Live)',local_duration_ms:334567,
   normalization_status:'not_started',state:'pending'}]);
  if(url.includes('/plaka_tracks?'))return json([{id:CAT,status:'published',title:'One More Time',artist_name:'Daft Punk',
   duration_ms:321000,rights_attested:true,telegram_file_id:'existing-file',telegram_bot_key:'archive-A'}]);
  if(url.includes('/rpc/pikete_queue_record_normalization'))return json({ok:true,outcome:'done'});
  throw Error('unexpected '+url);
 };
 const result=await processOneJob('B','test-worker',{id:JOB,job_type:'normalize',playlist_item_id:ID},{env,fetchImpl});
 assert.equal(result.outcome,'done');
 const payload=requests.find(x=>x.url.includes('/rpc/pikete_queue_record_normalization'))?.body;
 assert.equal(payload.p_metadata.source_origin,'device_library');
 assert.equal(payload.p_metadata.duration_ms,334567);
 assert.deepEqual(payload.p_metadata.versions,['live']);
 assert.equal(payload.p_metadata.ready_to_share,false);
 assert.equal(payload.p_metadata.rights_status,'not_checked');
 assert.equal(payload.p_metadata.catalog_match.requires_confirmation,true);
 assert.equal(payload.p_metadata.catalog_match.candidates[0].direct_playback_eligible,false);
 assert.equal(payload.p_metadata.catalog_match.candidates[0].version_mismatch,true);
 assert.equal(payload.p_metadata.catalog_match.candidates[0].archive_available,true);
 assert.equal(requests.some(x=>x.url.includes('/telegram')),false);
});
test('catalog offline does NOT drop validated local metadata or incorrectly mark it playable',async()=>{
 let saved;
 const fetchImpl=async(url,opt)=>{
  if(url.includes('/pikete_playlist_items?'))return json([{id:ID,source_type:'local',artist:'Artista',title:'Un tema',local_duration_ms:60000}]);
  if(url.includes('/plaka_tracks?'))return json({message:'offline'},503);
  if(url.includes('/rpc/pikete_queue_record_normalization')){saved=JSON.parse(opt.body);return json({ok:true,outcome:'done'});}
  throw Error('unexpected '+url);
 };
 const result=await processOneJob('B','test-worker',{id:JOB,job_type:'normalize',playlist_item_id:ID},{env,fetchImpl});
 assert.equal(result.outcome,'done');
 assert.equal(saved.p_metadata.catalog_match.status,'temporarily_unavailable');
 assert.equal(saved.p_metadata.ready_to_share,false);
});
test('legacy external URL metadata normalization remains supported',async()=>{
 let saved;
 const fetchImpl=async(url,opt)=>{
  if(url.includes('/pikete_playlist_items?'))return json([{id:ID,source_type:'external',source_ref:null,artist:'Artista',title:'Tema'}]);
  if(url.includes('/plaka_tracks?'))return json([]);
  if(url.includes('/rpc/pikete_queue_record_normalization')){saved=JSON.parse(opt.body);return json({ok:true,outcome:'done'});}
  throw Error('unexpected '+url);
 };
 const result=await processOneJob('B','test-worker',{id:JOB,job_type:'normalize',playlist_item_id:ID},{env,fetchImpl});
 assert.equal(result.outcome,'done');
 assert.equal(saved.p_metadata.source_origin,'external_reference');
});
