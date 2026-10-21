/** YouTube Data API discovery ONLY: never downloads/re-hosts YouTube media. */
import { rankCatalogCandidates,compareKey } from './normalization-engine.mjs';

const VID=/^[A-Za-z0-9_-]{11}$/;
function toDurationMs(iso) {
  if(typeof iso!=='string')return null;
  const m=/^P(?:([0-9]+)D)?T?(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+)S)?$/.exec(iso);
  if(!m)return null;
  const [d,h,mi,s]=m.slice(1).map(x=>Number(x||0));
  const ms=((d*24+h)*3600+mi*60+s)*1000;
  return ms>0 && ms<43200000?ms:null;
}
async function youtubeGet(path,params,fetchImpl,key) {
  const p=new URLSearchParams({...params,key});
  const response=await fetchImpl(`https://www.googleapis.com/youtube/v3/${path}?${p}`,{
    redirect:'manual',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(7500)
  });
  if(!response.ok)throw new Error('youtube_api_unavailable');
  return response.json();
}
export async function findYoutubeCandidates(normalized,options={}) {
  const env=options.env||process.env;
  const key=env.PIKETE_YOUTUBE_DATA_API_KEY;
  if(typeof key!=='string'||key.length<16)return {status:'not_configured',candidates:[],requires_confirmation:true};
  if(normalized?.ok!==true || typeof normalized.title_candidate!=='string' || typeof normalized.artist_candidate!=='string')
    return {status:'missing_metadata',candidates:[],requires_confirmation:true};
  const query=`${normalized.artist_candidate} ${normalized.title_candidate}`.slice(0,150);
  const fetchImpl=options.fetchImpl||fetch;
  try{
    const result=await youtubeGet('search',{part:'snippet',type:'video',maxResults:'8',safeSearch:'moderate',q:query},fetchImpl,key);
    const videos=(Array.isArray(result.items)?result.items:[]).filter(x=>VID.test(x?.id?.videoId||''));
    if(!videos.length)return {status:'no_candidates',candidates:[],requires_confirmation:true};
    const info=await youtubeGet('videos',{part:'contentDetails,snippet',id:videos.map(x=>x.id.videoId).join(',')},fetchImpl,key);
    const durations=new Map((Array.isArray(info.items)?info.items:[]).map(x=>[x.id,toDurationMs(x?.contentDetails?.duration)]));
    const candidates=videos.map(v=>({
      id:v.id.videoId, video_id:v.id.videoId,source:'youtube',
      title:String(v?.snippet?.title||'').slice(0,180),
      artist:normalized.artist_candidate, // Not a claim of channel's artist identity.
      channel:String(v?.snippet?.channelTitle||'').slice(0,120),
      duration_ms:durations.get(v.id.videoId)??null,
      url:`https://www.youtube.com/watch?v=${v.id.videoId}`
    }));
    const scoreInput={...normalized,versions:Array.isArray(normalized.versions)?normalized.versions:[],
      title_key:normalized.title_key||compareKey(normalized.title_candidate),
      artist_key:normalized.artist_key||compareKey(normalized.artist_candidate)};
    const ranked=rankCatalogCandidates(scoreInput,candidates.map(c=>({id:c.id,artist:c.channel,title:c.title,duration_ms:c.duration_ms})))
      .filter(x=>typeof x.ref==='string');
    const byId=new Map(candidates.map(c=>[c.id,c]));
    return {status:'candidates_for_review',candidates:ranked.slice(0,5).map(x=>({
      ...byId.get(x.ref),score:x.score,warning:'metadata_only_not_download_permission'
    })),requires_confirmation:true,can_download:false};
  }catch{return {status:'temporarily_unavailable',candidates:[],requires_confirmation:true};}
}
export const _test={toDurationMs};
