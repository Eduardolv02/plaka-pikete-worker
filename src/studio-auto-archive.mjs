/** Server-side catalogue of *licensed downloadable audio*, not search snippets.
 * A YouTube URL / MusicBrainz identifier is never treated as a media license.
 * Operator controls PIKETE_LICENSED_AUDIO_CATALOG_JSON. Every entry must
 * explicitly attest platform download and redistribution permission.
 */
import { QueueError, getNodeConfig } from './pikete-queue.mjs';
import { recordingKey } from './archive-lookup.mjs';
import { ingestApprovedSource } from './approved-source.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const busy=new Set();
/** In controlled staging, the operator may attest an allowlisted artist once.
 * Never infer permission from public YouTube/MusicBrainz metadata or a username.
 * Production continues requiring explicit per-recording source permissions.
 */
export function testArtistApproved(artist,env=process.env){
  if(env.PIKETE_TEST_MODE!=='true'||env.PIKETE_TEST_RIGHTS_ATTESTED!=='true')return false;
  if(typeof artist!=='string')return false;
  const list=(env.PIKETE_TEST_APPROVED_ARTISTS||'').split(',').map(x=>x.trim().toLocaleLowerCase('es')).filter(Boolean);
  return list.includes(artist.trim().toLocaleLowerCase('es'));
}
export function licensedEntry(item,env=process.env){
  if(!item || typeof item.artist!=='string'||typeof item.title!=='string')return null;
  let map;try{map=JSON.parse(env.PIKETE_LICENSED_AUDIO_CATALOG_JSON||'{}');}catch{return null;}
  if(!map||typeof map!=='object'||Array.isArray(map))return null;
  const entry=map[recordingKey(item.artist,item.title)];
  if(!entry || typeof entry.audio_url!=='string'||!['audio/mpeg','audio/mp4'].includes(entry.mime))return null;
  const individuallyApproved=entry.download_authorized===true&&entry.redistribution_authorized===true;
  if(!individuallyApproved && !testArtistApproved(item.artist,env))return null;
  return entry;
}
async function dbGet(node,table,params,options={}){
  const {origin,secret}=getNodeConfig(node,options.env||process.env);
  const f=options.fetchImpl||fetch;
  let r;try{r=await f(`${origin}/rest/v1/${table}?${new URLSearchParams(params)}`,{
    method:'GET',redirect:'manual',cache:'no-store',headers:{apikey:secret,Accept:'application/json'},signal:AbortSignal.timeout(9000)
  });}catch{throw new QueueError('auto_archive_database_network',503);}
  if(!r.ok)throw new QueueError('auto_archive_database_http',502);
  const rows=await r.json();if(!Array.isArray(rows))throw new QueueError('auto_archive_database_payload',502);
  return rows;
}
export async function prepareLicensedItem(input,options={}){
  const env=options.env||process.env;
  if(env.PIKETE_AUTO_ARCHIVE_ENABLED!=='true')throw new QueueError('auto_archive_disabled',403);
  const {node,item_id:itemId}=input||{};
  if(!['B','C'].includes(node)||!UUID.test(itemId||''))throw new QueueError('invalid_auto_archive_item',400);
  const items=await dbGet(node,'pikete_playlist_items',{
    select:'id,playlist_id,source_type,artist,title,metadata_confirmed_at,normalization_status,preparation_status,archive_status,rights_status',
    id:`eq.${itemId}`,limit:'1'
  },options);
  const item=items[0];
  if(!item)return {ok:false,status:'not_found'};
  if(item.archive_status==='ready')return {ok:true,status:'ready',reused:true};
  if(item.source_type!=='local'||!item.metadata_confirmed_at||item.normalization_status!=='normalized'||item.preparation_status!=='awaiting_audio')
    return {ok:false,status:'not_eligible'};
  const entry=licensedEntry(item,env);
  if(!entry)return {ok:false,status:'awaiting_licensed_audio'};
  const playlists=await dbGet(node,'pikete_playlists',{
    select:'owner_user_id',id:`eq.${item.playlist_id}`,kind:'eq.private',status:'eq.active',limit:'1'
  },options);
  const ownerId=playlists[0]?.owner_user_id;
  if(!UUID.test(ownerId||''))return {ok:false,status:'owner_unavailable'};
  const lock=`${node}:${itemId}`;
  if(busy.has(lock))return {ok:false,status:'already_processing'};
  busy.add(lock);
  try{
    const result=await ingestApprovedSource({
      node,playlist_id:item.playlist_id,item_id:itemId,owner_id:ownerId,
      audio_url:entry.audio_url,mime:entry.mime,
      owner_confirmed_rights:true,provider_download_authorized:true
    },options);
    return {ok:true,status:'ready',reused:result.reused_audio===true,item_id:itemId};
  }finally{busy.delete(lock);}
}
export async function sweepLicensedItems(body={},options={}){
  const env=options.env||process.env;
  if(env.PIKETE_AUTO_ARCHIVE_ENABLED!=='true')throw new QueueError('auto_archive_disabled',403);
  if(!body||typeof body!=='object')throw new QueueError('invalid_auto_sweep',400);
  const nodes=body.node==='both'?['B','C']:[body.node];
  if(nodes.some(n=>!['B','C'].includes(n))||!Number.isInteger(body.limit??25)||(body.limit??25)<1||(body.limit??25)>100)
    throw new QueueError('invalid_auto_sweep',400);
  const results=[];
  for(const node of nodes){
    const items=await dbGet(node,'pikete_playlist_items',{
      select:'id,artist,title',source_type:'eq.local',preparation_status:'eq.awaiting_audio',archive_status:'neq.ready',
      order:'updated_at.asc',limit:String(body.limit??25)
    },options);
    for(const item of items){
      if(!licensedEntry(item,env))continue;
      try{results.push({node,item_id:item.id,...await prepareLicensedItem({node,item_id:item.id},options)});}
      catch(e){results.push({node,item_id:item.id,ok:false,status:e instanceof QueueError?e.code:'processing_failed'});}
    }
  }
  return {ok:true,results,processed:results.filter(r=>r.status==='ready').length};
}
