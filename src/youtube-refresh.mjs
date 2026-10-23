/** Re-search normalized items stranded by the previous YouTube Data API requirement.
 * Does not change already playable audio, owner info, track identity or Telegram references.
 */
import {QueueError,getNodeConfig} from './pikete-queue.mjs';
import {findYoutubeCandidates} from './youtube-discovery.mjs';
import {autoArchivePreapproved} from './one-click-licensed.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const busy=new Set();
async function rows(node,params,options={}){
  const {origin,secret}=getNodeConfig(node,options.env||process.env);
  const f=options.fetchImpl||fetch;
  let r;try{r=await f(`${origin}/rest/v1/pikete_playlist_items?${new URLSearchParams(params)}`,{
    method:'GET',redirect:'manual',cache:'no-store',headers:{apikey:secret,Accept:'application/json'},signal:AbortSignal.timeout(9000)
  });}catch{throw new QueueError('refresh_database_unreachable',503);}
  if(!r.ok)throw new QueueError('refresh_database_failed',502);
  let d;try{d=await r.json();}catch{throw new QueueError('refresh_bad_json',502);}
  if(!Array.isArray(d))throw new QueueError('refresh_bad_json',502);
  return d;
}
export async function refreshYoutubeItem(input,options={}){
  const {node,item_id:itemId}=input||{};
  if(!['B','C'].includes(node)||!UUID.test(itemId||''))throw new QueueError('invalid_refresh_identity',400);
  const found=await rows(node,{select:'id,playlist_id,source_type,artist,title,local_duration_ms,normalized_metadata,normalization_status,preparation_status,archive_status,selected_youtube_video_id',id:`eq.${itemId}`,limit:'1'},options);
  const item=found[0];
  if(!item)return {ok:false,status:'not_found'};
  if(item.archive_status==='ready'||item.selected_youtube_video_id||item.normalization_status!=='normalized'||item.source_type!=='local'||item.preparation_status!=='needs_confirmation')
    return {ok:true,status:'skipped',reason:'already_ready_or_not_eligible'};
  const normalized=item.normalized_metadata;
  if(!normalized||typeof normalized!=='object')return {ok:false,status:'missing_normalization'};
  const finder=options.findYoutubeCandidates||findYoutubeCandidates;
  const result=await finder({...normalized,ok:true,
    artist_candidate:normalized.artist_candidate||item.artist,
    title_candidate:normalized.title_candidate||item.title,
    duration_ms:normalized.duration_ms??item.local_duration_ms},options);
  const updated={...normalized,youtube_search:{...result,refreshed_at:new Date().toISOString()}};
  const foundCandidates=Array.isArray(result.candidates)&&result.candidates.length>0;
  const patch={normalized_metadata:updated,updated_at:new Date().toISOString()};
  if(foundCandidates)patch.preparation_status='needs_confirmation';
  const {origin,secret}=getNodeConfig(node,options.env||process.env);
  const params=new URLSearchParams({id:`eq.${itemId}`,source_type:'eq.local',normalization_status:'eq.normalized',
    archive_status:'neq.ready',preparation_status:'eq.needs_confirmation',selected_youtube_video_id:'is.null',select:'id,preparation_status'});
  const f=options.fetchImpl||fetch;
  let response;
  try{response=await f(`${origin}/rest/v1/pikete_playlist_items?${params}`,{
    method:'PATCH',redirect:'manual',cache:'no-store',headers:{apikey:secret,Accept:'application/json',
      'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(patch),signal:AbortSignal.timeout(10000)
  });}catch{throw new QueueError('refresh_write_unreachable',503);}
  if(!response.ok)throw new QueueError('refresh_write_failed',502);
  const saved=await response.json();
  // Recover already-normalized songs without opening an Android confirmation form.
  if (Array.isArray(saved) && saved.length===1 && foundCandidates) {
    try {await autoArchivePreapproved(node,itemId,updated,options);}
    catch(e) {console.warn('pikete_one_click_recovery_unavailable',typeof e?.code==='string'?e.code:'archive_service_error');}
  }
  return {ok:true,status:Array.isArray(saved)&&saved.length===1?result.status:'skipped_concurrent_update',
    candidates:foundCandidates?result.candidates.length:0};
}
export async function refreshYoutubeStale(input={},options={}){
  // When disabled, leave existing metadata intact; a later enabled sweep can recover it.
  if ((options.env||process.env).PIKETE_YTDLP_SEARCH_ENABLED !== 'true')
    return {ok:true,status:'search_disabled',results:[]};
  const nodes=input.node==='both'?['B','C']:[input.node];
  const limit=input.limit??2;
  if(nodes.some(n=>!['B','C'].includes(n))||!Number.isInteger(limit)||limit<1||limit>3)
    throw new QueueError('invalid_refresh_sweep',400);
  const candidates=[];
  for(const node of nodes){
    const list=await rows(node,{select:'id,normalized_metadata,selected_youtube_video_id',source_type:'eq.local',
      normalization_status:'eq.normalized',preparation_status:'eq.needs_confirmation',archive_status:'neq.ready',selected_youtube_video_id:'is.null',
      order:'updated_at.asc',limit:'30'},options);
    for(const item of list){
      const search=item.normalized_metadata?.youtube_search||{};
      const age=Date.now()-Date.parse(search.refreshed_at||0);
      if(['not_configured','temporarily_unavailable','no_candidates','disabled'].includes(search.status) &&
         (!Number.isFinite(age)||age>6*3600000))candidates.push({node,item_id:item.id});
      if(candidates.filter(x=>x.node===node).length>=limit)break;
    }
  }
  const results=[];
  for(const candidate of candidates){
    const key=`${candidate.node}:${candidate.item_id}`;
    if(busy.has(key))continue;
    busy.add(key);
    try{results.push({...candidate,...await refreshYoutubeItem(candidate,options)});}
    catch(e){results.push({...candidate,ok:false,code:e instanceof QueueError?e.code:'refresh_failed'});}
    finally{busy.delete(key);}
  }
  return {ok:true,results};
}

let sweepRunning=false;
/** Cloudflare cron request must return before the extractor's 50-second limit. */
export function enqueueYoutubeRefreshSweep(input={},options={}){
  if(sweepRunning)return {ok:true,status:'already_processing'};
  sweepRunning=true;
  setImmediate(()=>{
    Promise.resolve().then(()=>refreshYoutubeStale(input,options))
      .then(r=>{console.info('youtube_refresh_sweep_completed',r.results.length);})
      .catch(e=>{console.error('youtube_refresh_sweep_failed',e instanceof QueueError?e.code:'unexpected');})
      .finally(()=>{sweepRunning=false;});
  });
  return {ok:true,status:'processing'};
}
