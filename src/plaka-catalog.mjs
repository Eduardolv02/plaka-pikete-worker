/** Private Plaka A catalog bridge. Only published, artist-attested and archived tracks
 * may be eligible for direct playback. Search is metadata-only and paginated;
 * no Telegram token, bot ID or URL is sent to the app or Gateway B.
 */
import { compareKey, analyzeRecording, rankCatalogCandidates, classifyMatch } from './normalization-engine.mjs';
import { QueueError } from './pikete-queue.mjs';

const MAIN_URL = 'https://nfmdkhmjjmkhlyhkgfow.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^sb_secret_[A-Za-z0-9_-]{20,}$/;
const FIELDS = 'id,title,artist_name,album_title,duration_ms,mime_type,status,rights_attested,telegram_file_id,telegram_bot_key,audio_sha256,published_at';
const cleanQuery = q => typeof q === 'string' ? q.normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim().slice(0,80) : '';

function config(env=process.env) {
  const key=env.PIKETE_SUPABASE_A_SECRET_KEY;
  if(typeof key!=='string'||!KEY.test(key)) throw new QueueError('catalog_a_secret_not_configured',503);
  return {base:MAIN_URL,key};
}
function available(row) {
  return Boolean(row?.status==='published' && row.rights_attested===true &&
    typeof row.telegram_file_id==='string' && row.telegram_file_id.trim() &&
    typeof row.telegram_bot_key==='string' && row.telegram_bot_key.trim());
}
function publicTrack(row) {
  return {id:row.id,title:row.title,artist:row.artist_name,album:row.album_title??null,
    duration_ms:row.duration_ms??null,published_at:row.published_at??null,
    archive_available:available(row)};
}
function safeIndex(q) { // PostgREST filter: strip all filter grammar and wildcard metacharacters.
  return cleanQuery(q).slice(0,80);
}
export async function catalogRows(params, options={}) {
  const {base,key}=config(options.env);
  const fetchImpl=options.fetchImpl||fetch;
  const p=new URLSearchParams({select:FIELDS,status:'eq.published',order:'published_at.desc,id.desc',limit:String(params.limit??60),offset:String(params.offset??0)});
  if (params.search) {
    const q=safeIndex(params.search);
    if(q.length>=2) p.set('or',`(title.ilike.*${q}*,artist_name.ilike.*${q}*)`);
  }
  let response;
  try {
    response=await fetchImpl(`${base}/rest/v1/plaka_tracks?${p.toString()}`,{
      method:'GET',redirect:'manual',cache:'no-store',
      headers:{apikey:key,Accept:'application/json'},signal:AbortSignal.timeout(9000),
    });
  } catch {throw new QueueError('catalog_network_error',502);}
  if(!response.ok) throw new QueueError(response.status===401||response.status===403?'catalog_a_auth_failed':'catalog_query_failed',502);
  let data;
  try{data=await response.json();}catch{throw new QueueError('catalog_invalid_response',502);}
  if(!Array.isArray(data))throw new QueueError('catalog_invalid_response',502);
  return data;
}
export async function searchCatalog(body,options={}) {
  const q=safeIndex(body?.query);
  const page=body?.page??0;
  if(q.length<2 || !Number.isInteger(page)||page<0||page>4000)
    throw new QueueError('invalid_catalog_search',400);
  const limit=25;
  const rows=await catalogRows({search:q,limit:limit+1,offset:page*limit},options);
  const pageRows=rows.slice(0,limit);
  // Deduplication by actual SHA256, not by title. Track IDs stay unchanged.
  const knownByHash=new Map();
  const tracks=pageRows.map(row=>{
    const entry=publicTrack(row);
    if(typeof row.audio_sha256==='string' && /^[0-9a-f]{64}$/i.test(row.audio_sha256)) {
      const hash=row.audio_sha256.toLowerCase();
      if(knownByHash.has(hash))entry.same_audio_as=knownByHash.get(hash);
      else knownByHash.set(hash,row.id);
    }
    return entry;
  });
  return {ok:true,query:q,page,has_more:rows.length>limit,tracks,limit};
}
export async function getCatalogTrack(id,options={}) {
  if(typeof id!=='string'||!UUID.test(id)) throw new QueueError('invalid_catalog_track_id',400);
  const {base,key}=config(options.env);
  const fetchImpl=options.fetchImpl||fetch;
  const p=new URLSearchParams({select:FIELDS,id:`eq.${id}`,status:'eq.published',limit:'1'});
  let response;
  try {response=await fetchImpl(`${base}/rest/v1/plaka_tracks?${p.toString()}`,{
      method:'GET',redirect:'manual',cache:'no-store',headers:{apikey:key,Accept:'application/json'},signal:AbortSignal.timeout(9000)
  });}catch{throw new QueueError('catalog_network_error',502);}
  if(!response.ok)throw new QueueError('catalog_query_failed',502);
  let rows;try{rows=await response.json();}catch{throw new QueueError('catalog_invalid_response',502);}
  if(!Array.isArray(rows))throw new QueueError('catalog_invalid_response',502);
  if(rows.length!==1)return {ok:false,code:'catalog_track_unavailable'};
  const track=publicTrack(rows[0]);
  return {ok:true,track,eligible:track.archive_available,
    reason:track.archive_available?'published_archive_present':'archive_or_rights_unavailable',
    playback_track_id:track.archive_available?track.id:null};
}
export async function matchCatalogMetadata(normalized,options={}) {
  if(!normalized?.ok)return {status:'insufficient_metadata',candidates:[],best:null};
  const title=cleanQuery(normalized.title_candidate);
  const artist=cleanQuery(normalized.artist_candidate);
  if(title.length<2 || artist.length<2)return {status:'insufficient_metadata',candidates:[],best:null};
  // Narrow by title, then rank by artist/version/duration; paginate every matched row
  // up to 600 candidates. No arbitrary 'first 30 tracks' catalog feed.
  const pool=[];
  for(let offset=0;offset<600;offset+=100){
    const page=await catalogRows({search:title,offset,limit:100},options);
    pool.push(...page);
    if(page.length<100)break;
  }
  const mapped=pool.map(row=>({
    id:row.id,title:row.title,artist:row.artist_name,duration_ms:row.duration_ms,
    album:row.album_title,
  }));
  // The normalizer intentionally scores at most 150 rows per call. Rank all chunks
  // and merge their winners to prevent page/order bias in large catalogs.
  const ranked=[];
  for(let i=0;i<mapped.length;i+=150)ranked.push(...rankCatalogCandidates(normalized,mapped.slice(i,i+150)));
  ranked.sort((a,b)=>b.score-a.score);
  const winners=ranked.slice(0,5);
  const byId=new Map(pool.map(row=>[row.id,row]));
  const candidates=winners.map(candidate=>({...candidate,
    archive_available:available(byId.get(candidate.ref)),
    direct_playback_eligible:false, // Metadata match NEVER authorizes a track without explicit ID selection.
  }));
  const decision=classifyMatch(winners);
  return {status:decision.status,best:decision.best?.ref??null,candidates,
    requires_confirmation:true,metadata_only:true,checked_candidates:pool.length,
    incomplete_search:pool.length>=600};
}
export const _test={available,cleanQuery};
