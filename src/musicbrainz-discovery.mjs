/** MusicBrainz recording metadata only. No audio files, artwork or lyrics are downloaded here.
 * MB recording IDs are stable identifiers for a recording; not proof of byte identity or licensing.
 */
import { compareKey } from './normalization-engine.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safe=s=>String(s||'').replace(/[\\"():*?~^\[\]{}!+\-]/g,' ').replace(/\s+/g,' ').trim().slice(0,100);
export function rankMusicBrainzRecording(recording,metadata){
  const title=compareKey(recording.title||'');
  const wantedTitle=compareKey(metadata.title_candidate||'');
  const artist=compareKey((recording['artist-credit']||[]).map(x=>typeof x==='string'?x:(x?.artist?.name||x?.name||'')).join(' '));
  const wantedArtist=compareKey(metadata.artist_candidate||'');
  const actualDuration=Number(recording.length);
  const durationDiff=Number.isFinite(actualDuration)&&actualDuration>0&&Number.isInteger(metadata.duration_ms)
    ?Math.abs(actualDuration-metadata.duration_ms):null;
  const score=(title===wantedTitle?.48:0)+(artist===wantedArtist?.38:0)+
    (durationDiff===null?0:durationDiff<=2000?.14:durationDiff<=5000?.09:0);
  return {recording_id:recording.id,title:recording.title||null,artist:artist||null,
    duration_ms:Number.isFinite(actualDuration)&&actualDuration>0?actualDuration:null,
    duration_delta_ms:durationDiff,score:Number(score.toFixed(2)),
    reliable:score>=.94 && durationDiff!==null && durationDiff<=2000};
}
export async function lookupMusicBrainz(metadata,options={}){
  if(metadata?.ok!==true || !safe(metadata.title_candidate) || !safe(metadata.artist_candidate))
    return {status:'insufficient_metadata',candidates:[],recording_id:null};
  const query=`recording:"${safe(metadata.title_candidate)}" AND artist:"${safe(metadata.artist_candidate)}"`;
  const url=`https://musicbrainz.org/ws/2/recording/?${new URLSearchParams({query,fmt:'json',limit:'5'})}`;
  try{
    const response=await (options.fetchImpl||fetch)(url,{method:'GET',redirect:'manual',cache:'no-store',
      headers:{Accept:'application/json','User-Agent':(options.env||process.env).PIKETE_MUSICBRAINZ_USER_AGENT || 'PlakaPlayer-Pikete/1.1 (metadata identification)'},
      signal:AbortSignal.timeout(7500)});
    if(!response.ok)return {status:'temporarily_unavailable',candidates:[],recording_id:null};
    const data=await response.json();
    const scored=(Array.isArray(data.recordings)?data.recordings:[])
      .filter(x=>UUID.test(x?.id||''))
      .map(x=>rankMusicBrainzRecording(x,metadata))
      .sort((a,b)=>b.score-a.score);
    const best=scored[0];const runner=scored[1];
    const selected=best?.reliable && (!runner || best.score-runner.score>=.08)?best.recording_id:null;
    return {status:selected?'identified':'candidates_for_review',recording_id:selected,
      candidates:scored.slice(0,5),metadata_only:true};
  }catch{return {status:'temporarily_unavailable',candidates:[],recording_id:null};}
}
