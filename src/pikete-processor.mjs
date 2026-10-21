/** Single-tick deterministic metadata worker for Pikete. No audio downloads or publishing.
 * Future Cloudflare cron invokes /api/queue/process-once. Render Free has no guaranteed always-on loop.
 */
import { randomUUID } from 'node:crypto';
import { getNodeConfig, callQueueRpc, requireMutationsEnabled, QueueError } from './pikete-queue.mjs';
import { inspectRecording } from './normalization-service.mjs';
import { matchCatalogMetadata } from './plaka-catalog.mjs';
import { findYoutubeCandidates } from './youtube-discovery.mjs';

function validateInput(body, env) {
  requireMutationsEnabled(env);
  if (env.PIKETE_PROCESSOR_ENABLED !== 'true') throw new QueueError('processor_disabled',403);
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      !['B','C','both'].includes(body.node) ||
      !Number.isInteger(body.limit ?? 1) || (body.limit ?? 1)<1 || (body.limit ?? 1)>3)
    throw new QueueError('invalid_processor_arguments',400);
}

export async function getItemForNormalization(node, itemId, options={}) {
  const {origin,secret}=getNodeConfig(node,options.env);
  const fetchImpl=options.fetchImpl||fetch;
  const params=new URLSearchParams({id:`eq.${itemId}`,select:'id,source_type,source_ref,artist,title,local_duration_ms,state,normalization_status,normalized_metadata',limit:'1'});
  let response;
  try {
    response=await fetchImpl(`${origin}/rest/v1/pikete_playlist_items?${params.toString()}`,{
      method:'GET',redirect:'manual',cache:'no-store',
      headers:{apikey:secret,Accept:'application/json'},signal:AbortSignal.timeout(8000)
    });
  } catch {throw new QueueError('item_lookup_network_error',502);}
  if (!response.ok) throw new QueueError('item_lookup_http_error',502);
  let rows;
  try {rows=await response.json();}catch{throw new QueueError('item_lookup_bad_json',502);}
  if(!Array.isArray(rows)) throw new QueueError('item_lookup_bad_json',502);
  return rows[0]??null;
}

export async function processOneJob(node,worker,job,options={}) {
  const opts={...options};
  if (job.job_type==='match') {
    try {
      const item=job.playlist_item_id ? await getItemForNormalization(node,job.playlist_item_id,opts) : null;
      if(!item || !['external','local'].includes(item.source_type) || item.normalization_status!=='normalized') {
        await callQueueRpc(node,'pikete_queue_finish',{
          p_job_id:job.id,p_worker:worker,p_outcome:'manual_review',
          p_error_code:'item_not_ready_for_match',p_retry_seconds:30
        },opts);
        return {job_id:job.id,outcome:'manual_review',reason:'item_not_ready_for_match'};
      }
      const normalized=item.normalized_metadata;
      const match=await matchCatalogMetadata(normalized,opts);
      const outcome=await callQueueRpc(node,'pikete_queue_record_match',{
        p_job_id:job.id,p_worker:worker,p_result:match
      },opts);
      if(!outcome?.ok)throw new QueueError('lease_lost',409);
      return {job_id:job.id,outcome:outcome.outcome,match_status:match.status,candidates:match.candidates.length};
    } catch(e) {
      if(!(e instanceof QueueError)||e.code!=='lease_lost') {
        try {await callQueueRpc(node,'pikete_queue_finish',{
          p_job_id:job.id,p_worker:worker,p_outcome:'retry',
          p_error_code:e instanceof QueueError?e.code:'catalog_match_failed',p_retry_seconds:180
        },opts);}catch{/* Lease can expire and be reclaimed */}
      }
      return {job_id:job.id,outcome:'retry_or_expired',reason:e instanceof QueueError?e.code:'catalog_match_failed'};
    }
  }
  if (job.job_type!=='normalize') {
    // Other queue types must not be silently treated as normalized.
    await callQueueRpc(node,'pikete_queue_finish',{
      p_job_id:job.id,p_worker:worker,p_outcome:'manual_review',p_error_code:'unsupported_job_type',p_retry_seconds:30
    },opts);
    return {job_id:job.id,outcome:'manual_review',reason:'unsupported_job_type'};
  }
  try {
    const item=job.playlist_item_id ? await getItemForNormalization(node,job.playlist_item_id,opts) : null;
    if(!item || !['external','local'].includes(item.source_type)) {
      const outcome=await callQueueRpc(node,'pikete_queue_record_normalization',{
        p_job_id:job.id,p_worker:worker,p_outcome:'manual_review',p_metadata:null,
        p_error_code:'item_missing_or_not_external'
      },opts);
      return {job_id:job.id,outcome:outcome?.outcome??'manual_review'};
    }
    const input={artist:item.artist,title:item.title};
    if(item.source_type==='local' && Number.isInteger(item.local_duration_ms))
      input.duration_ms=item.local_duration_ms;
    // Only fetch trusted HTTPS provider metadata if a URL is stored in the item.
    if(typeof item.source_ref==='string' && /^https:\/\//i.test(item.source_ref)) input.source_url=item.source_ref;
    const result=await inspectRecording(input,opts);
    if(!result.ok) {
      const outcome=await callQueueRpc(node,'pikete_queue_record_normalization',{
        p_job_id:job.id,p_worker:worker,p_outcome:'manual_review',p_metadata:null,
        p_error_code:typeof result.code==='string'?result.code.slice(0,120):'cannot_normalize'
      },opts);
      return {job_id:job.id,outcome:outcome?.outcome??'manual_review'};
    }
    // Store candidates and normalized text; explicitly no verified match, audio, or rights.
    const metadata={...result.normalized,
      source_origin:item.source_type==='local'?'device_library':'external_reference',
      source_metadata:result.source_metadata?.ok?{
        provider:result.source_metadata.provider,
        source_title:result.source_metadata.source_title,
      }:null,
      match_status:result.match?.status??'no_reliable_candidate',
      rights_status:'not_checked',ready_to_share:false};
    // Catalog lookup is a best-effort step: a temporary A outage must not
    // discard valid local metadata. Never mark matched metadata as playable.
    try {
      const match=await matchCatalogMetadata(metadata,opts);
      metadata.catalog_match=match;
    } catch(e) {
      metadata.catalog_match={status:'temporarily_unavailable',candidates:[],requires_confirmation:true};
    }
    // Official YouTube API: search and compare, never infer a right to download from a title.
    if (item.source_type === 'local') {
      metadata.youtube_search=await findYoutubeCandidates(metadata,opts);
    }
    const outcome=await callQueueRpc(node,'pikete_queue_record_normalization',{
      p_job_id:job.id,p_worker:worker,p_outcome:'done',p_metadata:metadata,p_error_code:null
    },opts);
    if(!outcome || outcome.ok!==true) throw new QueueError('lease_lost',409);
    return {job_id:job.id,outcome:'done',item_id:job.playlist_item_id,
      match_status:metadata.match_status,ready_to_share:false};
  } catch(e) {
    // Transient failures are retried by PostgreSQL; repeated failures exhaust max_attempts.
    if(!(e instanceof QueueError) || e.code!=='lease_lost') {
      try { await callQueueRpc(node,'pikete_queue_finish',{
        p_job_id:job.id,p_worker:worker,p_outcome:'retry',
        p_error_code:e instanceof QueueError?e.code:'processor_error',p_retry_seconds:60
      },opts); }
      catch {/* lease expires; a future claim can recover it */}
    }
    return {job_id:job.id,outcome:'retry_or_expired',reason:e instanceof QueueError?e.code:'processor_error'};
  }
}

export async function processQueueTick(body,options={}) {
  const env=options.env||process.env;
  validateInput(body,env);
  const nodes=body.node==='both'?['B','C']:[body.node];
  const worker=`renderb-${randomUUID()}`;
  const result=[];
  for(const node of nodes){
    const jobs=await callQueueRpc(node,'pikete_queue_claim',{
      p_worker:worker,p_batch_size:body.limit??1,p_lease_seconds:120
    },options);
    if(!Array.isArray(jobs)) throw new QueueError('queue_invalid_response',502);
    const processed=[];
    for(const job of jobs) processed.push(await processOneJob(node,worker,job,options));
    result.push({node,claimed:jobs.length,processed});
  }
  return {ok:true,worker_run:'single_tick',nodes:result,
    audio_downloads:false,audio_published:false,polling:'external_trigger_required'};
}
