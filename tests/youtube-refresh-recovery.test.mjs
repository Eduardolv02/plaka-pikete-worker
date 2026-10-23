import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshYoutubeStale,refreshYoutubeItem} from '../src/youtube-refresh.mjs';
const uuid='2c8a0ca0-a18e-4a7f-91ae-2285eaa22301';
test('disabled yt-dlp never modifies previous normalization',async()=>{
 let requests=0;
 const result=await refreshYoutubeStale({node:'both',limit:2},{env:{PIKETE_YTDLP_SEARCH_ENABLED:'false'},fetchImpl:async()=>{requests++;throw Error('unexpected')}});
 assert.equal(result.status,'search_disabled');assert.deepEqual(result.results,[]);assert.equal(requests,0);
});
test('refresh skips already confirmed/archived track and never calls search',async()=>{
 let searched=0;const data={id:uuid,source_type:'local',normalization_status:'normalized',archive_status:'none',selected_youtube_video_id:null,preparation_status:'awaiting_audio'};
 const result=await refreshYoutubeItem({node:'B',item_id:uuid},{env:{PIKETE_SUPABASE_B_URL:'https://cpdklixfmiibrcptleir.supabase.co',PIKETE_SUPABASE_B_SECRET_KEY:'sb_secret_'+('a'.repeat(26))},fetchImpl:async()=>({ok:true,json:async()=>[data]}),findYoutubeCandidates:async()=>{searched++}});
 assert.equal(result.status,'skipped');assert.equal(searched,0);
});
