/** Optional server-side extraction of OPERATOR-LICENSED YouTube recordings.
 * Default is DENY. Never infer permission from search results, a YouTube URL,
 * or a user's title/artist confirmation. Reuses existing Telegram ingest/RPC.
 */
import {mkdtemp,readdir,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {QueueError,getNodeConfig} from './pikete-queue.mjs';
import {ingestOwnerAudio,MAX_AUDIO_BYTES} from './telegram-archive.mjs';
import {runYtDlpJson,runProcess} from './ytdlp-runner.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VID=/^[A-Za-z0-9_-]{11}$/;
const inflight=new Set();
const recent=new Map();
function safeError(e){return typeof e?.code==='string'&&/^[a-z_]{3,80}$/.test(e.code)?e.code:'archive_processing_failed';}
function videoAllowlist(env){return new Set(String(env.PIKETE_APPROVED_YOUTUBE_VIDEO_IDS||'').split(',').map(x=>x.trim()).filter(x=>VID.test(x)));}
function checkEnabled(env){
  if(env.PIKETE_YOUTUBE_INGEST_ENABLED!=='true')throw new QueueError('youtube_archive_disabled',403);
  if(env.PIKETE_ARCHIVE_UPLOADS_ENABLED!=='true')throw new QueueError('archive_uploads_disabled',403);
}
async function dbRows(node,table,params,options={}) {
  const {origin,secret}=getNodeConfig(node,options.env||process.env);
  const f=options.fetchImpl||fetch;
  let response;
  try{response=await f(`${origin}/rest/v1/${table}?${new URLSearchParams(params)}`,{
    method:'GET',redirect:'manual',cache:'no-store',
    headers:{apikey:secret,Accept:'application/json'},signal:AbortSignal.timeout(9000)});
  }catch{throw new QueueError('archive_database_unreachable',503);}
  if(!response.ok)throw new QueueError('archive_database_failed',502);
  let rows;try{rows=await response.json();}catch{throw new QueueError('archive_database_invalid',502);}
  if(!Array.isArray(rows))throw new QueueError('archive_database_invalid',502);
  return rows;
}
export async function verifyConfirmedVideo(node,itemId,options={}){
  const env=options.env||process.env;
  checkEnabled(env);
  if(!['B','C'].includes(node)||!UUID.test(itemId||''))throw new QueueError('invalid_archive_identity',400);
  const items=await dbRows(node,'pikete_playlist_items',{
    select:'id,playlist_id,source_type,artist,title,local_duration_ms,metadata_confirmed_at,youtube_confirmed_at,selected_youtube_video_id,normalization_status,normalized_metadata,preparation_status,archive_status,rights_status',
    id:`eq.${itemId}`,limit:'1'
  },options);
  const item=items[0];
  if(!item)throw new QueueError('archive_item_missing',404);
  if(item.archive_status==='ready')return {alreadyReady:true,item};
  if(item.source_type!=='local'||item.normalization_status!=='normalized'||!item.metadata_confirmed_at||
     !item.youtube_confirmed_at||item.preparation_status!=='awaiting_audio'||
     ['revoked','blocked'].includes(item.rights_status))
    throw new QueueError('archive_item_not_confirmed',409);
  const id=item.selected_youtube_video_id;
  const choices=item.normalized_metadata?.youtube_search?.candidates;
  if(!VID.test(id||'')||!Array.isArray(choices)||!choices.some(c=>c.video_id===id))
    throw new QueueError('archive_video_not_in_candidates',409);
  // Only individually operator-cleared recordings, never generic catalog videos.
  if(!videoAllowlist(env).has(id))throw new QueueError('archive_video_not_licensed',403);
  const playlists=await dbRows(node,'pikete_playlists',{
    select:'id,owner_user_id',id:`eq.${item.playlist_id}`,kind:'eq.private',status:'eq.active',limit:'1'
  },options);
  const playlist=playlists[0];
  if(!UUID.test(playlist?.owner_user_id||''))throw new QueueError('archive_owner_required',403);
  return {alreadyReady:false,item,ownerId:playlist.owner_user_id};
}

export async function downloadLicensedVideo(videoId,artist,title,options={}) {
  if(!VID.test(videoId))throw new QueueError('invalid_video_id',400);
  const env=options.env||process.env;
  const runJson=options.runYtDlpJson||runYtDlpJson;
  const run=options.runProcess||runProcess;
  const url=`https://www.youtube.com/watch?v=${videoId}`;
  // No arbitrary media URL and no live/long streams.
  const info=await runJson(['--dump-single-json','--skip-download',url],options);
  if(info?.id!==videoId||!Number.isFinite(info.duration)||info.duration<2||info.duration>900||
     info.is_live===true||['is_live','is_upcoming'].includes(info.live_status))
    throw new QueueError('archive_video_unsuitable',409);
  const work=await mkdtemp(join(tmpdir(),'plaka-ytdlp-'));
  try{
    const command=env.PIKETE_YTDLP_BIN||'yt-dlp';
    if(!/^(?:yt-dlp|\/app\/\.venv\/bin\/yt-dlp)$/.test(command))throw new QueueError('ytdlp_binary_not_allowed',503);
    await run(command,['--ignore-config','--no-playlist','--no-warnings','--no-cache-dir',
      '--quiet','--no-progress','--no-part','--no-continue','--no-write-info-json','--no-write-thumbnail',
      '--no-write-subs','--no-write-auto-subs','--socket-timeout','15','--retries','1',
      '--format','bestaudio/best','--max-filesize','45M','--output',join(work,'source.%(ext)s'),url],
      {timeoutMs:160000,maxOutput:2048,cwd:work});
    const files=(await readdir(work)).filter(n=>/^source\.[a-zA-Z0-9]+$/.test(n));
    if(files.length!==1)throw new QueueError('archive_source_missing',502);
    const source=join(work,files[0]);
    const inputStat=await stat(source);
    if(!inputStat.isFile()||inputStat.size<512||inputStat.size>45*1024*1024)
      throw new QueueError('archive_source_size_invalid',413);
    const output=join(work,'normalized.mp3');
    await run('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-y',
      '-i',source,'-vn','-map_metadata','-1','-map','0:a:0',
      '-af','loudnorm=I=-16:TP=-1.5:LRA=11','-ar','44100','-ac','2',
      '-c:a','libmp3lame','-b:a','128k',
      '-metadata',`artist=${String(artist||'').slice(0,180)}`,
      '-metadata',`title=${String(title||'').slice(0,180)}`,'-f','mp3',output],
      {timeoutMs:120000,maxOutput:2048,cwd:work});
    const bytes=await readFile(output);
    if(bytes.length<512||bytes.length>MAX_AUDIO_BYTES||!((bytes[0]===73&&bytes[1]===68&&bytes[2]===51)||(bytes[0]===255&&(bytes[1]&224)===224)))
      throw new QueueError('archive_mp3_invalid',413);
    return bytes;
  }finally{await rm(work,{recursive:true,force:true});}
}

export async function archiveYoutubeItem(node,itemId,options={}){
  const ready=await verifyConfirmedVideo(node,itemId,options);
  if(ready.alreadyReady)return {ok:true,status:'ready',reused:true};
  const {item,ownerId}=ready;
  const download=options.downloadLicensedVideo||downloadLicensedVideo;
  const ingest=options.ingestOwnerAudio||ingestOwnerAudio;
  const bytes=await download(item.selected_youtube_video_id,item.artist,item.title,options);
  const result=await ingest({node,playlistId:item.playlist_id,itemId,ownerId,
    mime:'audio/mpeg',length:bytes.length,stream:Readable.from([bytes])},options);
  if(!result?.ok||result.archive_status!=='ready')throw new QueueError('archive_ingest_not_ready',502);
  return {ok:true,status:'ready',reused:result.reused_audio===true};
}

// Return quickly to Cloudflare B; no 3-minute Worker-to-Render request.
// Render's memory is not a durable queue: schedule periodic sweeps as well.
export async function enqueueYoutubeItem(input,options={}){
  const {node,item_id:itemId}=input||{};
  const env=options.env||process.env;
  const verified=await verifyConfirmedVideo(node,itemId,options);
  if(verified.alreadyReady)return {ok:true,status:'ready',reused:true};
  const key=`${node}:${itemId}`;
  if(inflight.has(key))return {ok:true,status:'processing'};
  const previous=recent.get(key);
  if(previous?.status==='failed'&&Date.now()-previous.time<5*60*1000)
    return {ok:false,status:'retry_cooldown',code:previous.code};
  inflight.add(key);
  recent.set(key,{status:'processing',time:Date.now()});
  const run=options.archiveYoutubeItem||archiveYoutubeItem;
  setImmediate(()=>{
    Promise.resolve().then(()=>run(node,itemId,options)).then(result=>{
      recent.set(key,{status:'ready',time:Date.now(),result});
    }).catch(e=>{
      const code=safeError(e);
      recent.set(key,{status:'failed',code,time:Date.now()});
      console.error('licensed_youtube_archive_failed',node,code);
    }).finally(()=>{inflight.delete(key);if(recent.size>250)recent.delete(recent.keys().next().value);});
  });
  return {ok:true,status:'processing',item_id:itemId};
}

export function youtubeJobStatus(node,itemId){
  const status=recent.get(`${node}:${itemId}`);
  return status?{ok:true,status:status.status,code:status.code??null}:
    {ok:true,status:'not_started'};
}
export async function sweepYoutubeItems(input={},options={}){
  const env=options.env||process.env;
  checkEnabled(env);
  const nodes=input.node==='both'?['B','C']:[input.node];
  const limit=input.limit??2;
  if(nodes.some(n=>!['B','C'].includes(n))||!Number.isInteger(limit)||limit<1||limit>5)
    throw new QueueError('invalid_archive_sweep',400);
  const allowed=videoAllowlist(env),results=[];
  for(const node of nodes){
    const rows=await dbRows(node,'pikete_playlist_items',{
      select:'id,selected_youtube_video_id',source_type:'eq.local',
      preparation_status:'eq.awaiting_audio',archive_status:'neq.ready',
      selected_youtube_video_id:'not.is.null',order:'updated_at.asc',limit:'30'
    },options);
    for(const item of rows){
      if(results.length>=limit*nodes.length)break;
      if(!allowed.has(item.selected_youtube_video_id))continue;
      try{results.push({node,item_id:item.id,...await enqueueYoutubeItem({node,item_id:item.id},options)});}
      catch(e){results.push({node,item_id:item.id,ok:false,code:safeError(e)});}
    }
  }
  return {ok:true,results};
}
export const _test={videoAllowlist,safeError};
