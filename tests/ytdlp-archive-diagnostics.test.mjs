import test from 'node:test';
import assert from 'node:assert/strict';
import {runProcess,runYtDlpJson} from '../src/ytdlp-runner.mjs';
import {downloadLicensedVideo,enqueueYoutubeItem,youtubeJobStatus} from '../src/youtube-archive.mjs';

const YT='zdRsY9rO9Jg';

// Reproduces production's blind ytdlp_execution_failed while the extractor's
// useful problem description exists only on stderr.
test('yt-dlp failures are classified without echoing sensitive stderr', async()=>{
  const cases=[
    ['Sign in to confirm you are not a bot. cookie ABCDEFG and /tmp/privatefile', 'ytdlp_auth_required'],
    ['ERROR HTTP Error 403: Forbidden', 'ytdlp_http_403'],
    ['ERROR: HTTP Error 429: Too Many Requests', 'ytdlp_rate_limited'],
    ['ERROR: No supported JavaScript runtime could be found', 'ytdlp_js_challenge'],
    ['ERROR: Requested format is not available', 'ytdlp_formats_unavailable'],
    ['ERROR: This video is unavailable', 'ytdlp_video_unavailable'],
  ];
  for(const [message,code] of cases){
    const base64=Buffer.from(message).toString('base64');
    await assert.rejects(()=>runProcess(process.execPath,['-e',`process.stderr.write(Buffer.from('${base64}','base64'));process.exit(1)`]),
      e=> e.code===code && !String(e.message).includes('ABCDEFG') && !JSON.stringify(e).includes('privatefile'),code);
  }
});

test('yt-dlp JSON calls enable bundled EJS through Node without new env vars',async()=>{
  let received=null;
  await runYtDlpJson(['--dump-single-json','ytsearch1:test'],{
    runProcess:async(command,args)=>{received=args;return '{}';},env:{PIKETE_YTDLP_BIN:'yt-dlp'}});
  assert.deepEqual(received.slice(0,2),['--ignore-config','--js-runtimes']);
  assert.equal(received[2],'node');
});

test('a failed metadata phase is visible without starting a download',async()=>{
  await assert.rejects(()=>downloadLicensedVideo(YT,'Artista','Título',{
    runYtDlpJson:async()=>{const e=new Error('ytdlp_http_403');e.code='ytdlp_http_403';throw e;},
    runProcess:async()=>{throw new Error('download must not run');}
  }),e=>e.code==='ytdlp_http_403' && e.phase==='metadata');
});

test('licensed video download passes the JS runtime to yt-dlp',async()=>{
  const commands=[];
  await assert.rejects(()=>downloadLicensedVideo(YT,'Artista','Título',{
    runYtDlpJson:async()=>({id:YT,duration:100,is_live:false}),
    runProcess:async(command,args)=>{commands.push([command,args]); const e=new Error('ytdlp_http_403');e.code='ytdlp_http_403';throw e;}
  }),e=>e.code==='ytdlp_http_403' && e.phase==='download');
  assert.equal(commands.length,1);
  assert.ok(commands[0][1].includes('--js-runtimes'));
  assert.equal(commands[0][1][commands[0][1].indexOf('--js-runtimes')+1],'node');
});

// Spawn an actual child; byte-limited stderr must not hang and stdout must be valid.
test('normal child output unaffected and stderr flood remains bounded',async()=>{
 const output=await runProcess(process.execPath,['-e','process.stderr.write("x".repeat(100000));console.log("ok")'],{timeoutMs:15000});
 assert.equal(output.trim(),'ok');
});


test('failed archive status exposes stage and safe code, not raw extractor stderr',async()=>{
  const IID='c1234567-1234-4234-a234-123456789abc';
  const PID='f1234567-1234-4234-a234-123456789abc';
  const OWNER='12345678-1234-4234-a234-123456789abc';
  const env={PIKETE_YOUTUBE_INGEST_ENABLED:'true',PIKETE_ARCHIVE_UPLOADS_ENABLED:'true',
    PIKETE_TEST_MODE:'true',PIKETE_TEST_RIGHTS_ATTESTED:'true',
    PIKETE_SUPABASE_C_URL:'https://wxleseokrzltkuyjmjev.supabase.co',
    PIKETE_SUPABASE_C_SECRET_KEY:'sb_secret_'+'a'.repeat(32)};
  const fetchImpl=async url=>new Response(JSON.stringify(new URL(url).pathname.endsWith('pikete_playlists')
    ? [{owner_user_id:OWNER}] : [{id:IID,playlist_id:PID,source_type:'local',title:'Prueba',artist:'Artista',
      normalization_status:'normalized',metadata_confirmed_at:'2026-10-23T00:00:00Z',
      youtube_confirmed_at:'2026-10-23T01:00:00Z',selected_youtube_video_id:YT,
      archive_status:'none',preparation_status:'awaiting_audio',rights_status:'unknown',
      normalized_metadata:{youtube_search:{candidates:[{video_id:YT}]}}}]),
    {headers:{'Content-Type':'application/json'}});
  const queued=await enqueueYoutubeItem({node:'C',item_id:IID},{env,fetchImpl,
    archiveYoutubeItem:async()=>{const err=new Error('Forbidden secret cookie');err.code='ytdlp_http_403';err.phase='download';throw err;}});
  assert.equal(queued.status,'processing');
  // The task is scheduled with setImmediate: await two event-loop turns.
  await new Promise(resolve=>setImmediate(()=>setImmediate(resolve)));
  const status=youtubeJobStatus('C',IID);
  assert.deepEqual(status,{ok:true,status:'failed',code:'ytdlp_http_403',phase:'download'});
  const retried=await enqueueYoutubeItem({node:'C',item_id:IID},{env,fetchImpl});
  assert.equal(retried.status,'retry_cooldown');
  assert.equal(retried.code,'ytdlp_http_403');
  assert.equal(retried.phase,'download');
  assert.ok(!JSON.stringify(status).includes('cookie'));
});
