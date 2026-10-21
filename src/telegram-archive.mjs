/** Pikete authenticated server-to-server ingestion of owner-authorized MP3/M4A.
 * Only metadata-confirmed LOCAL items owned by the target user can be archived.
 * Telegram bots never receive credentials from Android. No YouTube downloads.
 */
import { createHash } from 'node:crypto';
import { QueueError, getNodeConfig, callQueueRpc } from './pikete-queue.mjs';
import { recordingKey, lookupArchiveHash } from './archive-lookup.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_AUDIO_BYTES = 19*1024*1024;
const mediaTypes = new Set(['audio/mpeg','audio/mp4']);

function botConfig(env=process.env){
  const bots=[];
  for(let slot=1;slot<=4;slot++){
    const token=env[`PIKETE_TG_BOT_${slot}_TOKEN`],chat=env[`PIKETE_TG_BOT_${slot}_CHAT_ID`];
    if(typeof token==='string' && /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token) &&
       typeof chat==='string' && /^(?:-?\d{5,}|@[A-Za-z][A-Za-z0-9_]{4,})$/.test(chat))
      bots.push({slot,token,chat});
  }
  return bots;
}
async function rest(node,table,params,method,body,options={}){
  const {origin,secret}=getNodeConfig(node,options.env), f=options.fetchImpl||fetch;
  const headers={apikey:secret,Accept:'application/json'};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(method!=='GET')headers.Prefer='return=representation';
  let r;
  try{r=await f(`${origin}/rest/v1/${table}?${params}`,{
    method,headers,redirect:'manual',cache:'no-store',
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(12000)
  });}catch{throw new QueueError('archive_database_unreachable',503);}
  if(!r.ok)throw new QueueError(r.status===409?'archive_collision':'archive_database_failed',502);
  let rows;try{rows=await r.json();}catch{throw new QueueError('archive_database_invalid',502);}
  if(!Array.isArray(rows))throw new QueueError('archive_database_invalid',502);
  return rows;
}
export async function verifyArchiveOwner(node,playlistId,itemId,ownerId,options={}){
  if(!['B','C'].includes(node)||![playlistId,itemId,ownerId].every(x=>UUID.test(x||'')))
    throw new QueueError('invalid_archive_identity',400);
  const playlist=await rest(node,'pikete_playlists',new URLSearchParams({
    select:'id',id:`eq.${playlistId}`,owner_user_id:`eq.${ownerId}`,kind:'eq.private',status:'eq.active',limit:'1'
  }), 'GET',undefined,options);
  if(playlist.length!==1)throw new QueueError('archive_owner_required',403);
  const items=await rest(node,'pikete_playlist_items',new URLSearchParams({
    select:'id,source_type,artist,title,local_duration_ms,selected_youtube_video_id,metadata_confirmed_at,normalization_status,archive_status,rights_status',
    id:`eq.${itemId}`,playlist_id:`eq.${playlistId}`,limit:'1'
  }), 'GET',undefined,options);
  const item=items[0];
  if(!item || item.source_type!=='local' || !item.metadata_confirmed_at || item.normalization_status!=='normalized' ||
    ['blocked','revoked'].includes(item.rights_status))throw new QueueError('archive_item_not_eligible',409);
  return item;
}
function assertFormat(bytes,mime){
  if(mime==='audio/mpeg')return bytes.length>512 && (
    (bytes[0]===73&&bytes[1]===68&&bytes[2]===51) ||
    (bytes[0]===255&&(bytes[1]&224)===224));
  if(mime==='audio/mp4')return bytes.length>512 &&
    Buffer.from(bytes.subarray(4,8)).toString('ascii')==='ftyp';
  return false;
}
async function readInput(stream,declaredLength){
  if(!Number.isInteger(declaredLength)||declaredLength<512||declaredLength>MAX_AUDIO_BYTES)
    throw new QueueError('invalid_archive_audio_size',413);
  const chunks=[];let total=0;
  for await(const chunk of stream){
    total+=chunk.length;
    if(total>MAX_AUDIO_BYTES)throw new QueueError('archive_too_large',413);
    chunks.push(chunk);
  }
  if(total!==declaredLength)throw new QueueError('archive_length_mismatch',400);
  return Buffer.concat(chunks,total);
}
async function saveToTelegram(bot,audio,mime,item,options){
  const form=new FormData();
  form.set('chat_id',bot.chat);
  form.set('title',item.title.slice(0,180));
  form.set('performer',item.artist.slice(0,180));
  form.set('disable_notification','true');
  form.set('audio',new Blob([audio],{type:mime}),mime==='audio/mpeg'?'pikete.mp3':'pikete.m4a');
  const f=options.fetchImpl||fetch;
  let response;
  try {response=await f(`https://api.telegram.org/bot${bot.token}/sendAudio`,{
    method:'POST',body:form,redirect:'manual',signal:AbortSignal.timeout(90000)
  });} catch {throw new QueueError('telegram_upload_unreachable',503);}
  let data;try{data=await response.json();}catch{throw new QueueError('telegram_invalid_response',502);}
  if(!response.ok||data?.ok!==true || !data?.result?.audio?.file_id)
    throw new QueueError('telegram_upload_failed',502);
  return {telegram_file_id:data.result.audio.file_id,
    telegram_file_unique_id:data.result.audio.file_unique_id??null};
}
export async function ingestOwnerAudio({node,playlistId,itemId,ownerId,mime,length,stream},options={}){
  const env=options.env||process.env;
  if(env.PIKETE_ARCHIVE_UPLOADS_ENABLED!=='true')throw new QueueError('archive_uploads_disabled',403);
  if(!mediaTypes.has(mime))throw new QueueError('unsupported_archive_audio_type',415);
  const item=await verifyArchiveOwner(node,playlistId,itemId,ownerId,options);
  const bytes=await readInput(stream,length);
  if(!assertFormat(bytes,mime))throw new QueueError('invalid_audio_signature',400);
  const hash=createHash('sha256').update(bytes).digest('hex');
  let archive=(await rest(node,'pikete_audio_archive',new URLSearchParams({
    select:'sha256,bot_slot,telegram_file_id,mime_type',sha256:`eq.${hash}`,limit:'1'
  }),'GET',undefined,options))[0];
  // Global exact-byte reuse across B and C. NEVER reuse on title alone.
  if(!archive){
    const shared=await lookupArchiveHash(hash,options);
    if(shared)archive=shared;
  }
  let reused=true;
  if(!archive){
    const bots=botConfig(env);
    if(!bots.length)throw new QueueError('telegram_bots_not_configured',503);
    const bot=bots[parseInt(hash.slice(0,2),16)%bots.length];
    const telegram=await saveToTelegram(bot,bytes,mime,item,options);
    const entry={sha256:hash,bot_slot:bot.slot,telegram_file_id:telegram.telegram_file_id,
      telegram_file_unique_id:telegram.telegram_file_unique_id,mime_type:mime,bytes:bytes.length,
      normalized_key:recordingKey(item.artist,item.title),
      duration_ms:Number.isInteger(item.local_duration_ms)?item.local_duration_ms:null,
      source_video_id:item.selected_youtube_video_id||null};
    try{
      archive=(await rest(node,'pikete_audio_archive',new URLSearchParams({select:'sha256,bot_slot,telegram_file_id,mime_type'}),
        'POST',entry,options))[0];
    }catch(e){
      if(e.code!=='archive_collision')throw e;
      archive=(await rest(node,'pikete_audio_archive',new URLSearchParams({
        select:'sha256,bot_slot,telegram_file_id,mime_type',sha256:`eq.${hash}`,limit:'1'
      }),'GET',undefined,options))[0];
    }
    if(!archive)throw new QueueError('archive_store_failed',502);
    reused=false;
  }
  // Keep the global archive locator local to the playlist's shard if reused from the other shard.
  // This is best-effort; the item itself still stores the exact bot slot + Telegram file_id.
  if(archive.node && archive.node!==node){
    try{
      await rest(node,'pikete_audio_archive',new URLSearchParams({select:'sha256'}),'POST',{
        sha256:hash,bot_slot:archive.bot_slot,telegram_file_id:archive.telegram_file_id,
        mime_type:archive.mime_type,bytes:bytes.length,
        normalized_key:recordingKey(item.artist,item.title),
        duration_ms:Number.isInteger(item.local_duration_ms)?item.local_duration_ms:null,
        source_video_id:item.selected_youtube_video_id||null
      },options);
    }catch(e){if(e.code!=='archive_collision')throw e;}
  }
  const attached=await callQueueRpc(node,'pikete_attach_verified_audio',{ 
    p_playlist_id:playlistId,p_item_id:itemId,p_owner_user_id:ownerId,
    p_bot_slot:archive.bot_slot,p_file_id:archive.telegram_file_id,p_sha256:archive.sha256,
    p_mime_type:archive.mime_type
  },options);
  if(attached?.ok!==true)throw new QueueError('archive_attach_failed',409);
  return {ok:true,archive_status:'ready',item_id:itemId,reused_audio:reused,
    mime_type:archive.mime_type,telegram_bot_slot:archive.bot_slot};
}
export const _test={botConfig,assertFormat};
