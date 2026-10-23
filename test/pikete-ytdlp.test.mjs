import test from 'node:test';
import assert from 'node:assert/strict';
import {findYoutubeCandidates,rankYoutubeCandidates} from '../src/youtube-discovery.mjs';
import {runYtDlpJson} from '../src/ytdlp-runner.mjs';
const wanted={ok:true,title_candidate:'Cobarde',artist_candidate:'K1ZA',duration_ms:187000,versions:[]};
const good={id:'abcdefghijk',title:'K1ZA - Cobarde (Official Audio)',channel:'K1ZA',duration:188};

test('yt-dlp metadata discovery does not require YouTube Data API key',async()=>{
 let args;
 const r=await findYoutubeCandidates(wanted,{env:{PIKETE_YTDLP_SEARCH_ENABLED:'true'},
   searchImpl:async a=>{args=a;return {entries:[good]};}});
 assert.match(args.at(-1),/^ytsearch8:/);
 assert.equal(r.status,'candidates_for_review');
 assert.equal(r.candidates[0].video_id,'abcdefghijk');
 assert.equal(r.candidates[0].duration_ms,188000);
 assert.equal(r.requires_confirmation,true);
 assert.equal(r.can_download,false);
 assert.equal(r.provider,'yt-dlp');
});
test('unrelated videos score lower and duplicate IDs are removed',async()=>{
 const r=await findYoutubeCandidates(wanted,{env:{PIKETE_YTDLP_SEARCH_ENABLED:'true'},searchImpl:async()=>({entries:[
  {id:'zzzzzzzzzzz',title:'Live cooking show',channel:'Cooking',duration:180},good,good]})});
 assert.equal(r.candidates.length,2);
 assert.equal(r.candidates[0].video_id,'abcdefghijk');
 assert.ok(r.candidates[0].score>r.candidates[1].score);
});
test('missing metadata stops before subprocess search',async()=>{
 let invoked=false;
 const r=await findYoutubeCandidates({ok:true,title_candidate:'Cobarde',artist_candidate:''},
  {env:{PIKETE_YTDLP_SEARCH_ENABLED:'true'},searchImpl:async()=>{invoked=true;return {};}});
 assert.equal(r.status,'missing_metadata');assert.equal(invoked,false);
});
test('safe error status on missing yt-dlp and no raw stderr leakage',async()=>{
 const r=await findYoutubeCandidates(wanted,{env:{PIKETE_YTDLP_SEARCH_ENABLED:'true'},searchImpl:async()=>{throw Object.assign(Error('secret-url'),{code:'ytdlp_unavailable'});}});
 assert.equal(r.status,'temporarily_unavailable');
 assert.equal(r.code,'ytdlp_unavailable');
 assert.equal(JSON.stringify(r).includes('secret-url'),false);
});
test('executable allowlist blocks arbitrary binary injection',async()=>{
 await assert.rejects(runYtDlpJson(['--help'],{env:{PIKETE_YTDLP_BIN:'/bin/sh'}}),e=>e.code==='ytdlp_binary_not_allowed');
});
test('version differences are penalized',()=>{
 const ranked=rankYoutubeCandidates({...wanted,versions:['acoustic']},[
  {video_id:'abcdefghijk',title:'K1ZA - Cobarde (Remix)',channel:'K1ZA',duration_ms:187000}
 ]);
 assert.equal(ranked[0].version_mismatch,true);
 assert.ok(ranked[0].score<=0.5);
});
