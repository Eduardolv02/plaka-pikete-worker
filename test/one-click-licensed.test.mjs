import test from 'node:test';
import assert from 'node:assert/strict';
import {choosePreapprovedRecording,autoArchivePreapproved} from '../src/one-click-licensed.mjs';
const env={PIKETE_ONE_CLICK_LICENSED_ENABLED:'true',PIKETE_YOUTUBE_INGEST_ENABLED:'true',
  PIKETE_ARCHIVE_UPLOADS_ENABLED:'true',PIKETE_APPROVED_YOUTUBE_VIDEO_IDS:'abcdefghijk',
  PIKETE_SUPABASE_B_URL:'https://example.supabase.co',PIKETE_SUPABASE_B_SECRET_KEY:'sb_secret_abcdefghijklmnopqrstuvwxyz123456'};
const meta={youtube_search:{status:'candidates_for_review',candidates:[{video_id:'abcdefghijk',score:0.95,version_mismatch:false}]}};
test('selects uniquely strong and preapproved candidate',()=>assert.equal(choosePreapprovedRecording(meta,env),'abcdefghijk'));
test('no authorization or flag blocks automatic selection',()=>{
  assert.equal(choosePreapprovedRecording(meta,{...env,PIKETE_ONE_CLICK_LICENSED_ENABLED:'false'}),null);
  assert.equal(choosePreapprovedRecording(meta,{...env,PIKETE_APPROVED_YOUTUBE_VIDEO_IDS:''}),null);
});
test('no auto selection of ambiguous candidates or weak scores',()=>{
 assert.equal(choosePreapprovedRecording({youtube_search:{...meta.youtube_search,candidates:[...meta.youtube_search.candidates,{video_id:'lmnopqrstuv',score:.92}]}},env),null);
 assert.equal(choosePreapprovedRecording({youtube_search:{...meta.youtube_search,candidates:[{video_id:'abcdefghijk',score:.6}]}},env),null);
});
test('only marked ready by Telegram pipeline, not request acceptance',async()=>{
 let saved=null;let invoked=0;
 const r=await autoArchivePreapproved('B','12345678-1234-4123-8123-123456789012',meta,{
 env,fetchImpl:async(url,opts)=>{saved=JSON.parse(opts.body);return {ok:true,json:async()=>[{id:'valid'}]};},
 enqueueYoutubeItem:async()=>{invoked++;return {ok:true,status:'processing'}}});
 assert.equal(r.status,'processing');assert.equal(saved.preparation_status,'awaiting_audio');
 assert.equal(Object.hasOwn(saved,'archive_status'),false);assert.equal(invoked,1);
});
