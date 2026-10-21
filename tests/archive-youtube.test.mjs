import test from 'node:test';
import assert from 'node:assert/strict';
import {findYoutubeCandidates,_test as yt} from '../src/youtube-discovery.mjs';
import {ingestOwnerAudio,_test as tg} from '../src/telegram-archive.mjs';
import {Readable} from 'node:stream';
const PID='f1234567-1234-4234-a234-123456789abc';
const IID='a1234567-1234-4234-a234-123456789abc';
const UID='12345678-1234-4234-a234-123456789abc';
const FILE_ID='TGfileIDabcdefghijklmnopqrstuvwxyz';
const botToken='123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefg123456789';
const env={PIKETE_ARCHIVE_UPLOADS_ENABLED:'true',PIKETE_TG_BOT_1_TOKEN:botToken,
 PIKETE_TG_BOT_1_CHAT_ID:'-1001234567890',
 PIKETE_SUPABASE_B_URL:'https://cpdklixfmiibrcptleir.supabase.co',
 PIKETE_SUPABASE_B_SECRET_KEY:'sb_secret_'+'a'.repeat(32),
 PIKETE_SUPABASE_C_URL:'https://wxleseokrzltkuyjmjev.supabase.co',
 PIKETE_SUPABASE_C_SECRET_KEY:'sb_secret_'+'b'.repeat(32)};
function json(v,status=200){return new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});}
test('YouTube discovery uses official API for metadata only and validates duration',async()=>{
 const seen=[];
 const result=await findYoutubeCandidates({ok:true,artist_candidate:'Daft Punk',title_candidate:'One More Time',duration_ms:320000},
  {env:{PIKETE_YOUTUBE_DATA_API_KEY:'x'.repeat(40)},fetchImpl:async url=>{
   seen.push(new URL(url));
   if(url.includes('/search?'))return json({items:[{id:{videoId:'abcdefghijk'},snippet:{title:'Daft Punk - One More Time',channelTitle:'Daft Punk'}}]});
   return json({items:[{id:'abcdefghijk',contentDetails:{duration:'PT5M20S'}}]});
  }});
 assert.equal(result.status,'high_confidence_metadata');assert.equal(result.can_download,false);
 assert.equal(result.candidates[0].duration_ms,320000);
 assert.equal(result.candidates[0].url,'https://www.youtube.com/watch?v=abcdefghijk');
 assert.equal(yt.toDurationMs('PT5M20S'),320000);
 assert.equal(seen.length,2);
});
test('not configured: no YouTube calls and no permitted download',async()=>{
 const result=await findYoutubeCandidates({ok:true,artist_candidate:'A',title_candidate:'B'},
  {env:{},fetchImpl:()=>{throw Error('must not fetch')}});
 assert.equal(result.status,'not_configured');assert.deepEqual(result.candidates,[]);
});
function fakeBot(trace){return async (url,req)=>{
 const u=new URL(url);
 if(u.hostname==='api.telegram.org') {
  trace.push('telegram_send');
  assert.equal(req.method,'POST');
  return json({ok:true,result:{audio:{file_id:FILE_ID,file_unique_id:'unique1'}}});
 }
 const table=u.pathname.split('/').pop();
 if(table==='pikete_playlists')return json([{id:PID}]);
 if(table==='pikete_playlist_items')return json([{id:IID,source_type:'local',artist:'Artista',title:'Tema',
  normalization_status:'normalized',metadata_confirmed_at:'2026-10-21T12:00:00Z',rights_status:'unknown'}]);
 if(table==='pikete_audio_archive') {
  if(req.method==='GET')return json(trace.some(x=>x==='archive_insert') ? [{sha256:trace.hash,bot_slot:1,telegram_file_id:FILE_ID,mime_type:'audio/mpeg'}] : []);
  trace.push('archive_insert');const body=JSON.parse(req.body);trace.hash=body.sha256;
  return json([body]);
 }
 if(table==='pikete_attach_verified_audio') {
  trace.push('finalize');return json({ok:true,item_id:IID,archive_status:'ready'});
 }
 throw Error(`unexpected ${url}`);
};}
test('authorized owner MP3 stored via Telegram bot, then attached through scoped RPC',async()=>{
 const audio=Buffer.alloc(2048);audio.set([73,68,51]);const trace=[];
 const result=await ingestOwnerAudio({node:'B',playlistId:PID,itemId:IID,ownerId:UID,mime:'audio/mpeg',length:audio.length,stream:Readable.from([audio])},
  {env,fetchImpl:fakeBot(trace)});
 assert.equal(result.ok,true);assert.equal(result.archive_status,'ready');
 assert.deepEqual(trace.filter(x=>typeof x==='string'),['telegram_send','archive_insert','finalize']);
});
test('ingest requires owner flag, valid audio, and the configured bots',async()=>{
 const audio=Buffer.alloc(1024);audio.set([73,68,51]);
 await assert.rejects(()=>ingestOwnerAudio({node:'B',playlistId:PID,itemId:IID,ownerId:UID,
   mime:'audio/mpeg',length:1024,stream:Readable.from([audio])},
  {env:{...env,PIKETE_ARCHIVE_UPLOADS_ENABLED:'false'},fetchImpl:fakeBot([])}),/archive_uploads_disabled/);
 assert.equal(tg.assertFormat(audio,'audio/mpeg'),true);
 assert.equal(tg.assertFormat(Buffer.alloc(1024),'audio/mpeg'),false);
 assert.equal(tg.botConfig(env).length,1);
});
