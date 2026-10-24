/**
 * Pikete one-click path for operator-authorized recordings only.
 * Reuses the existing search, normalization, Telegram ingest and archive index.
 * NEVER equates an identified YouTube video with distribution permission.
 * A user does not submit a URL or pick a new server executable.
 */
import {getNodeConfig} from './pikete-queue.mjs';
import {enqueueYoutubeItem} from './youtube-archive.mjs';
import {isPrivateTestGrantActive} from './test-grant.mjs';

const VIDEO=/^[A-Za-z0-9_-]{11}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function choosePreapprovedRecording(metadata, env = {}) {
  // Do not require yet another Render variable for the existing approved-source workflow.
  // These are the established archive gates and the per-video operator allowlist.
  if (env.PIKETE_YOUTUBE_INGEST_ENABLED !== 'true' ||
      env.PIKETE_ARCHIVE_UPLOADS_ENABLED !== 'true') return null;
  const search=metadata?.youtube_search;
  if (search?.status !== 'candidates_for_review' || !Array.isArray(search.candidates)) return null;
  const candidates=search.candidates;
  const first=candidates[0];
  const score=Number(first?.score);
  if (!VIDEO.test(first?.video_id||'') || !Number.isFinite(score) || score<0.80 ||
      first.version_mismatch===true) return null;
  // Ambiguous candidate? Keep the existing manual review screen available.
  const secondScore=Number(candidates[1]?.score);
  if (Number.isFinite(secondScore) && score-secondScore<0.12) return null;
  const approved=new Set(String(env.PIKETE_APPROVED_YOUTUBE_VIDEO_IDS||'')
    .split(',').map(v=>v.trim()).filter(v=>VIDEO.test(v)));
  // An operator's one-time test-environment attestation applies to all private
  // QA recordings across B/C, phones and Panitas. Confidence checks remain.
  return (approved.has(first.video_id) || isPrivateTestGrantActive(env)) ? first.video_id : null;
}

export async function autoArchivePreapproved(node,itemId,metadata,options={}){
  const env=options.env||process.env;
  if (!['B','C'].includes(node) || !UUID.test(itemId||''))
    return {ok:false,status:'invalid_identity'};
  const videoId=choosePreapprovedRecording(metadata,env);
  if (!videoId) return {ok:true,status:'review_or_license_required'};
  const {origin,secret}=getNodeConfig(node,env);
  const api=options.fetchImpl||fetch;
  const params=new URLSearchParams({
    id:`eq.${itemId}`,source_type:'eq.local',normalization_status:'eq.normalized',
    preparation_status:'eq.needs_confirmation',archive_status:'neq.ready',
    metadata_confirmed_at:'not.is.null',selected_youtube_video_id:'is.null',
    select:'id'
  });
  const response=await api(`${origin}/rest/v1/pikete_playlist_items?${params}`,{
    method:'PATCH',redirect:'manual',cache:'no-store',
    headers:{apikey:secret,'Content-Type':'application/json',Accept:'application/json',Prefer:'return=representation'},
    body:JSON.stringify({selected_youtube_video_id:videoId,youtube_confirmed_at:new Date().toISOString(),
      preparation_status:'awaiting_audio',updated_at:new Date().toISOString()}),
    signal:AbortSignal.timeout(10000)
  });
  if (!response.ok) return {ok:false,status:'confirmation_write_failed'};
  const rows=await response.json();
  if (!Array.isArray(rows) || rows.length!==1) return {ok:true,status:'already_handled'};
  // Starts the existing allowlisted yt-dlp -> FFmpeg -> Telegram SHA pipeline.
  // Acceptance != publication. DB archive_status is the source of truth.
  const kick=options.enqueueYoutubeItem||enqueueYoutubeItem;
  const started=await kick({node,item_id:itemId},options);
  return {ok:started?.ok===true,status:started?.status||'archive_start_failed'};
}
