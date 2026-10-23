/** yt-dlp metadata search, without a YouTube Data API key.
 * A candidate is never proof of identity, source ownership, or redistribution rights.
 */
import {analyzeRecording, compareKey} from './normalization-engine.mjs';
import {runYtDlpJson} from './ytdlp-runner.mjs';
const VID=/^[A-Za-z0-9_-]{11}$/;
const TITLE_MAX=180;

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
    const versionMismatch=wantedVersions.some(x=>!versions.includes(x)) || versions.some(x=>!wantedVersions.includes(x));
    const delta=wantedDuration!==null && Number.isInteger(candidate.duration_ms)?Math.abs(wantedDuration-candidate.duration_ms):null;
    let score=(titleEqual?.46:titlePartial?.20:0)+(directArtist?.31:channelArtist?.23:0);
    if(delta!==null)score+=delta<=2000?.23:delta<=5000?.17:delta<=12000?.09:delta<=30000?.02:-.20;
    else score+=.03;
    if(versionMismatch)score=Math.min(score,.5);
    return {...candidate,score:Math.max(0,Math.min(1,Number(score.toFixed(3)))),
      duration_delta_ms:delta,version_mismatch:versionMismatch};
  }).sort((a,b)=>b.score-a.score || (a.duration_delta_ms??Infinity)-(b.duration_delta_ms??Infinity));
}

export async function findYoutubeCandidates(normalized,options={}){
  const env=options.env||process.env;
  if(env.PIKETE_YTDLP_SEARCH_ENABLED!=='true')return {status:'not_configured',candidates:[],requires_confirmation:true};
  if(normalized?.ok!==true || typeof normalized.title_candidate!=='string'||!normalized.title_candidate.trim()||
     typeof normalized.artist_candidate!=='string'||!normalized.artist_candidate.trim())
    return {status:'missing_metadata',candidates:[],requires_confirmation:true};
  const query=`${normalized.artist_candidate} ${normalized.title_candidate}`.slice(0,TITLE_MAX).replace(/[\r\n]/g,' ');
  try{
    const search=options.searchImpl||runYtDlpJson;
    const result=await search(['--flat-playlist','--dump-single-json','--skip-download',
      `ytsearch8:${query}`], {...options,timeoutMs:50000});
    const seen=new Set(), videos=[];
    for(const row of Array.isArray(result?.entries)?result.entries:[]){
      const videoId=String(row?.id||'');
      if(!VID.test(videoId)||seen.has(videoId))continue;
      seen.add(videoId);
      const seconds=Number(row?.duration);
      videos.push({id:videoId,video_id:videoId,source:'youtube',
        title:String(row.title||'').slice(0,TITLE_MAX),
        artist:normalized.artist_candidate,
        channel:String(row.channel||row.uploader||'').slice(0,120),
        duration_ms:Number.isFinite(seconds)&&seconds>0&&seconds<43200?Math.round(seconds*1000):null,
        url:`https://www.youtube.com/watch?v=${videoId}`});
    }
    const ranked=rankYoutubeCandidates(normalized,videos);
    if(!ranked.length)return {status:'no_candidates',candidates:[],requires_confirmation:true,can_download:false};
    // Even high-scoring metadata must be manually confirmed; never auto-download on match.
    return {status:'candidates_for_review',best_video_id:ranked[0].video_id,
      candidates:ranked.slice(0,5).map(c=>({...c,warning:'metadata_only_not_download_permission'})),
      requires_confirmation:true,can_download:false,provider:'yt-dlp'};
  }catch(e){
    const safe=['ytdlp_unavailable','ytdlp_timeout','ytdlp_execution_failed','ytdlp_invalid_json','ytdlp_output_limit'];
    return {status:'temporarily_unavailable',code:safe.includes(e?.code)?e.code:'ytdlp_search_failed',
      candidates:[],requires_confirmation:true,can_download:false};
  }
}
