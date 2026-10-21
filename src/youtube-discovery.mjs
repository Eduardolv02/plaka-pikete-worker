/** YouTube Data API discovery ONLY: never downloads/re-hosts YouTube media. */
import { analyzeRecording, rankCatalogCandidates, compareKey } from './normalization-engine.mjs';

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
    const ranked=rankYoutubeCandidates(normalized,candidates);
    const best=ranked[0],runner=ranked[1];
    // Metadata confidence is NOT proof of audio identity, upload rights or ownership.
    const exact=best && best.score>=0.92 && best.duration_delta_ms!==null &&
      best.duration_delta_ms<=2000 && !best.version_mismatch &&
      (!runner || best.score-runner.score>=0.1);
    return {status:exact?'high_confidence_metadata':'candidates_for_review',
      best_video_id:best?.video_id??null,
      candidates:ranked.slice(0,5).map(c=>({...c,warning:'metadata_only_not_download_permission'})),
      requires_confirmation:!exact, can_download:false};
  }catch{return {status:'temporarily_unavailable',candidates:[],requires_confirmation:true};}
}
/** YouTube channels often contain label names, not performing artist names.
 * Prefer explicit 'Artist - Title' in the video title, while treating a named
 * channel as a weaker clue. Penalize mismatched versions and durations.
 */
export function rankYoutubeCandidates(normalized,candidates){
  const wantedArtist=compareKey(normalized.artist_candidate||'');
  const wantedTitle=compareKey(normalized.title_candidate||'');
  const wantedDuration=Number.isInteger(normalized.duration_ms)?normalized.duration_ms:null;
  const wantedVersions=Array.isArray(normalized.versions)?normalized.versions:[];
  return candidates.map(candidate=>{
    const parsed=analyzeRecording({title:candidate.title,artist:''});
    const raw=compareKey(candidate.title);
    const parsedTitle=compareKey(parsed.title_candidate||'');
    const parsedArtist=compareKey(parsed.artist_candidate||'');
    const channel=compareKey(candidate.channel||'');
    const directArtist=!!wantedArtist && (parsedArtist===wantedArtist || raw.startsWith(wantedArtist+' '));
    const channelArtist=!!wantedArtist && (channel===wantedArtist || channel.startsWith(wantedArtist+' '));
    const titleEqual=!!wantedTitle && (parsedTitle===wantedTitle || raw.includes(wantedTitle));
    const titlePartial=!!wantedTitle && raw.split(' ').filter(x=>wantedTitle.split(' ').includes(x)).length>=Math.max(1,Math.ceil(wantedTitle.split(' ').length*.7));
    const versions=parsed.ok?parsed.versions:[];
    const versionMismatch=!!wantedVersions.length && wantedVersions.some(x=>!versions.includes(x)) ||
      !!versions.length && versions.some(x=>!wantedVersions.includes(x));
    const delta=wantedDuration!==null && Number.isInteger(candidate.duration_ms)?
      Math.abs(wantedDuration-candidate.duration_ms):null;
    let score=(titleEqual?.46:titlePartial?.20:0)+(directArtist?.31:channelArtist?.23:0);
    if(delta!==null){score+=delta<=2000?.23:delta<=5000?.17:delta<=12000?.09:delta<=30000?.02:-.20;}
    else score+=.03;
    if(versionMismatch)score=Math.min(score,.5);
    return {...candidate,score:Math.max(0,Math.min(1,Number(score.toFixed(3)))),
      duration_delta_ms:delta,version_mismatch:versionMismatch};
  }).sort((a,b)=>b.score-a.score || (a.duration_delta_ms??Infinity)-(b.duration_delta_ms??Infinity));
}
export const _test={toDurationMs};
