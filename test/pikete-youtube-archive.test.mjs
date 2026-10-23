import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyConfirmedVideo,archiveYoutubeItem,enqueueYoutubeItem,_test} from '../src/youtube-archive.mjs';
import {refreshYoutubeItem} from '../src/youtube-refresh.mjs';
const PID='f1234567-1234-4234-a234-123456789abc';
const IID='a1234567-1234-4234-a234-123456789abc';
const UID='12345678-1234-4234-a234-123456789abc';
const env={PIKETE_YOUTUBE_INGEST_ENABLED:'true',PIKETE_ARCHIVE_UPLOADS_ENABLED:'true',
 PIKETE_APPROVED_YOUTUBE_VIDEO_IDS:'abcdefghijk',
 PIKETE_SUPABASE_B_URL:'https://cpdklixfmiibrcptleir.supabase.co',
 PIKETE_SUPABASE_B_SECRET_KEY:'sb_secret_'+'a'.repeat(32),
 PIKETE_SUPABASE_C_URL:'https://wxleseokrzltkuyjmjev.supabase.co',
 PIKETE_SUPABASE_C_SECRET_KEY:'sb_secret_'+'b'.repeat(32)};
const norm={ok:true,artist_candidate:'K1ZA',title_candidate:'Cobarde',duration_ms:187000,
 youtube_search:{status:'candidates_for_review',candidates:[{video_id:'abcdefghijk'}]}};
const eligible={id:IID,playlist_id:PID,source_type:'local',artist:'K1ZA',title:'Cobarde',
 local_duration_ms:187000,metadata_confirmed_at:'2026-10-23T01:00:00Z',
 youtube_confirmed_at:'2026-10-23T02:00:00Z',selected_youtube_video_id:'abcdefghijk',
 normalization_status:'normalized',preparation_status:'awaiting_audio',archive_status:'none',
 rights_status:'unknown',normalized_metadata:norm};
function fetchDb(item=eligible,tracker=[]){return async(url,opts={})=>{
 const table=new URL(url).pathname.split('/').pop();
 tracker.push({table,method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):null});
 if(table==='pikete_playlists')return new Response(JSON.stringify([{id:PID,owner_user_id:UID}]));
 if(table==='pikete_playlist_items')return new Response(JSON.stringify(opts.method==='PATCH'?[{id:IID}]:[item]));
 throw Error('unexpected table');
};}
test('video ID must have operator-cleared download + redistribution rights',async()=>{
 await assert.rejects(verifyConfirmedVideo('B',IID,{env:{...env,PIKETE_APPROVED_YOUTUBE_VIDEO_IDS:''},fetchImpl:fetchDb()}),
 e=>e.code==='archive_video_not_licensed');
});
test('rejected or unconfirmed video never starts download',async()=>{
 await assert.rejects(verifyConfirmedVideo('B',IID,{env,fetchImpl:fetchDb({...eligible,youtube_confirmed_at:null})}),
 e=>e.code==='archive_item_not_confirmed');
 await assert.rejects(verifyConfirmedVideo('B',IID,{env,fetchImpl:fetchDb({...eligible,selected_youtube_video_id:'zzzzzzzzzzz'})}),
 e=>e.code==='archive_video_not_in_candidates');
});
test('valid licensed video archives via existing Telegram ingestion function',async()=>{
 let called=0;
 const r=await archiveYoutubeItem('B',IID,{env,fetchImpl:fetchDb(),
 downloadLicensedVideo:async id=>{assert.equal(id,'abcdefghijk');called++;return Buffer.from('ID3'+'.'.repeat(1000));},
 ingestOwnerAudio:async params=>{assert.equal(params.ownerId,UID);assert.equal(params.itemId,IID);
  assert.equal(params.mime,'audio/mpeg');assert.equal(params.length,1003);called++;
  return {ok:true,archive_status:'ready',reused_audio:false};}});
 assert.equal(r.status,'ready');assert.equal(called,2);
});
test('scheduling responds promptly and runs a single work item',async()=>{
 let complete;
 const done=new Promise(r=>complete=r);
 const r=await enqueueYoutubeItem({node:'B',item_id:IID},{env,fetchImpl:fetchDb(),
 archiveYoutubeItem:async()=>{complete();return {ok:true,status:'ready'};}});
 assert.equal(r.status,'processing');
 await done;
});
test('malicious IDs and denied environment flags fail closed',async()=>{
 await assert.rejects(verifyConfirmedVideo('B','../../../../',{env,fetchImpl:fetchDb()}),e=>e.code==='invalid_archive_identity');
 await assert.rejects(verifyConfirmedVideo('B',IID,{env:{...env,PIKETE_YOUTUBE_INGEST_ENABLED:'false'},fetchImpl:fetchDb()}),e=>e.code==='youtube_archive_disabled');
 assert.equal(_test.videoAllowlist({PIKETE_APPROVED_YOUTUBE_VIDEO_IDS:'abcdefghijk,invalid'}).size,1);
});
test('recover stale candidates and restore needs_confirmation without touching ready items',async()=>{
 const trace=[];
 const item={...eligible,selected_youtube_video_id:null,archive_status:'none',normalized_metadata:{...norm,youtube_search:{status:'not_configured',candidates:[]}}};
 const r=await refreshYoutubeItem({node:'B',item_id:IID},{env,fetchImpl:fetchDb(item,trace),
 findYoutubeCandidates:async()=>({status:'candidates_for_review',candidates:[{video_id:'abcdefghijk'}]})});
 assert.equal(r.status,'candidates_for_review');
 const update=trace.find(x=>x.method==='PATCH');
 assert.equal(update.body.preparation_status,'needs_confirmation');
 assert.equal(update.body.normalized_metadata.youtube_search.candidates[0].video_id,'abcdefghijk');
});
