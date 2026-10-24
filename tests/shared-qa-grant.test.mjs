import test from 'node:test';
import assert from 'node:assert/strict';
import {isPrivateTestGrantActive} from '../src/test-grant.mjs';
import {choosePreapprovedRecording} from '../src/one-click-licensed.mjs';
import {verifyConfirmedVideo,archiveYoutubeItem,sweepYoutubeItems,youtubeJobStatus} from '../src/youtube-archive.mjs';

const ITEM='a1234567-1234-4234-a234-123456789abc';
const PLAYLIST='f1234567-1234-4234-a234-123456789abc';
const OWNER='12345678-1234-4234-a234-123456789abc';
const VIDEO='zdRsY9rO9Jg';
const env={
  PIKETE_YOUTUBE_INGEST_ENABLED:'true', PIKETE_ARCHIVE_UPLOADS_ENABLED:'true',
  PIKETE_TEST_MODE:'true', PIKETE_TEST_RIGHTS_ATTESTED:'true',
  PIKETE_APPROVED_YOUTUBE_VIDEO_IDS:'',
  PIKETE_SUPABASE_B_URL:'https://cpdklixfmiibrcptleir.supabase.co',
  PIKETE_SUPABASE_B_SECRET_KEY:'sb_secret_'+'a'.repeat(32),
  PIKETE_SUPABASE_C_URL:'https://wxleseokrzltkuyjmjev.supabase.co',
  PIKETE_SUPABASE_C_SECRET_KEY:'sb_secret_'+'b'.repeat(32),
};
const song={id:ITEM, playlist_id:PLAYLIST, source_type:'local',artist:'K1ZA',title:'Tormenta',
  local_duration_ms:122064, metadata_confirmed_at:'2026-10-23T12:00:00Z',
  youtube_confirmed_at:'2026-10-23T12:01:00Z',
  selected_youtube_video_id:VIDEO,preparation_status:'awaiting_audio', archive_status:'none',
  normalization_status:'normalized',rights_status:'unknown',
  normalized_metadata:{youtube_search:{candidates:[{video_id:VIDEO,score:0.96}]}}};
const metadata={youtube_search:{status:'candidates_for_review',candidates:[{video_id:VIDEO,score:.96,version_mismatch:false}]}};
function json(value){return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});}
function fakeDatabase(item=song,{privatePlaylist=true,onGet=null}={}){
 return async(url,request={})=>{
  const parsed=new URL(url);
  const table=parsed.pathname.split('/').pop();
  onGet?.(table,parsed,request);
  if(table==='pikete_playlists'){
   assert.equal(parsed.searchParams.get('kind'),'eq.private');
   assert.equal(parsed.searchParams.get('status'),'eq.active');
   return json(privatePlaylist?[{owner_user_id:OWNER}]:[]);
  }
  if(table==='pikete_playlist_items')return json(request.method==='PATCH'?[{id:ITEM}]:[item]);
  throw Error('Unexpected request '+table);
 };
}

test('one persistent operator attestation covers B, C, second phone and Panitas without per-song allowlist',()=>{
 assert.equal(isPrivateTestGrantActive(env),true);
 assert.equal(choosePreapprovedRecording(metadata,env),VIDEO);
 assert.equal(isPrivateTestGrantActive({...env,PIKETE_TEST_RIGHTS_ATTESTED:'false'}),false);
 assert.equal(isPrivateTestGrantActive({...env,PIKETE_TEST_MODE:'false'}),false);
 assert.equal(isPrivateTestGrantActive({...env,PIKETE_ARCHIVE_UPLOADS_ENABLED:'false'}),false);
 assert.equal(isPrivateTestGrantActive({...env,PIKETE_YOUTUBE_INGEST_ENABLED:'false'}),false);
 // A standalone client claim must never activate a backend test grant.
 assert.equal(choosePreapprovedRecording(metadata,{...env,PIKETE_TEST_RIGHTS_ATTESTED:'false'}),null);
});

test('both private shards B/C accept one authorized test batch while production denies the same video',async()=>{
 for(const node of ['B','C']){
  const allowed=await verifyConfirmedVideo(node,ITEM,{env,fetchImpl:fakeDatabase()});
  assert.equal(allowed.ownerId,OWNER);
  await assert.rejects(()=>verifyConfirmedVideo(node,ITEM,{env:{...env,PIKETE_TEST_MODE:'false'},fetchImpl:fakeDatabase()}),
    e=>e.code==='archive_video_not_licensed');
 }
});

test('test grant does not bypass private playlist, revoked rights or unconfirmed video',async()=>{
 await assert.rejects(()=>verifyConfirmedVideo('B',ITEM,{env,fetchImpl:fakeDatabase(song,{privatePlaylist:false})}),
   e=>e.code==='archive_owner_required');
 for(const rights_status of ['revoked','blocked']){
  await assert.rejects(()=>verifyConfirmedVideo('B',ITEM,{env,fetchImpl:fakeDatabase({...song,rights_status})}),
    e=>e.code==='archive_item_not_confirmed');
 }
 await assert.rejects(()=>verifyConfirmedVideo('B',ITEM,{env,fetchImpl:fakeDatabase({...song,youtube_confirmed_at:null})}),
   e=>e.code==='archive_item_not_confirmed');
 await assert.rejects(()=>verifyConfirmedVideo('B',ITEM,{env,fetchImpl:fakeDatabase({...song,selected_youtube_video_id:'abcdefghijk'})}),
   e=>e.code==='archive_video_not_in_candidates');
});

test('video matching still refuses low confidence and ambiguous automatic choices',()=>{
 assert.equal(choosePreapprovedRecording({youtube_search:{status:'candidates_for_review',candidates:[{video_id:VIDEO,score:.3}]}},env),null);
 assert.equal(choosePreapprovedRecording({youtube_search:{status:'candidates_for_review',candidates:[{video_id:VIDEO,score:.95},{video_id:'abcdefghijk',score:.91}]}},env),null);
});

test('standing grant reaches Telegram ingest without setting rights on every request',async()=>{
 const effects=[];
 const result=await archiveYoutubeItem('C',ITEM,{
  env,fetchImpl:fakeDatabase(),
  downloadLicensedVideo:async id=>{effects.push('download');assert.equal(id,VIDEO);return Buffer.from('ID3'+'.'.repeat(1000));},
  ingestOwnerAudio:async params=>{
   effects.push('telegram_archive');assert.equal(params.ownerId,OWNER);assert.equal(params.node,'C');
   assert.equal(params.length,1003);assert.equal(params.mime,'audio/mpeg');
   return {ok:true,archive_status:'ready'};
  }
 });
 assert.equal(result.status,'ready');
 assert.deepEqual(effects,['download','telegram_archive']);
});

test('recovery sweep picks a previously confirmed awaiting_audio item even without an individual allowlist',async()=>{
 let archiveCalled;
 const archiveDone=new Promise(resolve=>archiveCalled=resolve);
 const fetchImpl=async(url,request={})=>{
  const p=new URL(url);
  const table=p.pathname.split('/').pop();
  if(table==='pikete_playlist_items')return json([song]);
  if(table==='pikete_playlists')return json([{owner_user_id:OWNER}]);
  throw Error(`unexpected ${table}`);
 };
 const response=await sweepYoutubeItems({node:'B',limit:1},{env,fetchImpl,
  archiveYoutubeItem:async (node,id)=>{archiveCalled({node,id});return {ok:true,status:'ready'};}});
 assert.equal(response.ok,true);
 assert.equal(response.results[0].status,'processing');
 const completed=await archiveDone;
 assert.deepEqual(completed,{node:'B',id:ITEM});
});

test('recovery never lets a busy B shard starve Panitas on C',async()=>{
 const completed=[];
 let finish;
 const done=new Promise(resolve=>finish=resolve);
 const ids=['a1234567-1234-4234-a234-123456789abc','b1234567-1234-4234-a234-123456789abc'];
 const response=await sweepYoutubeItems({node:'both',limit:1},{env,
  fetchImpl:async url=>{
   const parsed=new URL(url);const isB=parsed.hostname.startsWith('cpd');
   const table=parsed.pathname.split('/').pop();
   if(table==='pikete_playlists')return json([{owner_user_id:OWNER}]);
   return json(table==='pikete_playlist_items' ? (parsed.searchParams.get('select')==='id,selected_youtube_video_id'
     ? [{id:ITEM,selected_youtube_video_id:VIDEO},{id:ids[1],selected_youtube_video_id:VIDEO}]
     : [{...song,id:isB?ITEM:ids[1]}]) : []);
  },
  archiveYoutubeItem:async(node,itemId)=>{
   completed.push(node);
   if(completed.length===2)finish();
   return {ok:true,status:'ready'};
  }});
 assert.deepEqual(response.results.map(x=>x.node),['B','C']);
 await done;
 assert.deepEqual(completed.sort(),['B','C']);
});
