/** Fast lookup of Telegram archive index on BOTH Supabase shards.
 * Only SHA-256 proves byte identity. Text/duration matches are suggestions.
 * Telegram Bot API does not offer full channel-history search.
 */
import { compareKey } from './normalization-engine.mjs';
import { getNodeConfig } from './pikete-queue.mjs';

const SHA=/^[a-f0-9]{64}$/;
export function recordingKey(artist,title){
  const a=compareKey(artist||''),t=compareKey(title||'');
  return a&&t?`${a}:${t}`.slice(0,360):null;
}
export async function lookupArchiveHash(hash,options={}){
  if(!SHA.test(hash||''))return null;
  const fetchImpl=options.fetchImpl||fetch;
  for(const node of ['B','C']){
    let config;
    try{config=getNodeConfig(node,options.env||process.env);}catch{continue;}
    const params=new URLSearchParams({select:'sha256,bot_slot,telegram_file_id,mime_type,normalized_key,duration_ms',sha256:`eq.${hash}`,limit:'1'});
    try{
      const r=await fetchImpl(`${config.origin}/rest/v1/pikete_audio_archive?${params}`,{
        method:'GET',redirect:'manual',cache:'no-store',
        headers:{apikey:config.secret,Accept:'application/json'},signal:AbortSignal.timeout(7000)});
      if(!r.ok)continue;
      const rows=await r.json();
      if(Array.isArray(rows)&&rows[0]?.sha256===hash&&typeof rows[0].telegram_file_id==='string')
        return {...rows[0],node};
    }catch{ /* fail open to permitted new upload; never infer identity */ }
  }
  return null;
}
export async function lookupArchiveMetadata({artist,title,durationMs},options={}){
  const key=recordingKey(artist,title);
  if(!key)return {status:'insufficient_metadata',candidates:[],exact_audio:false};
  const fetchImpl=options.fetchImpl||fetch;
  const results=[];
  let reachable=0;
  for(const node of ['B','C']){
    let cfg;
    try{cfg=getNodeConfig(node,options.env||process.env);}catch{continue;}
    const p=new URLSearchParams({select:'sha256,normalized_key,duration_ms,source_video_id',normalized_key:`eq.${key}`,limit:'12'});
    try{
      const r=await fetchImpl(`${cfg.origin}/rest/v1/pikete_audio_archive?${p}`,{
        method:'GET',redirect:'manual',cache:'no-store',headers:{apikey:cfg.secret,Accept:'application/json'},
        signal:AbortSignal.timeout(7000)});
      if(!r.ok)continue;
      reachable++;
      const rows=await r.json();
      if(!Array.isArray(rows))continue;
      for(const row of rows){
        const delta=Number.isInteger(durationMs)&&Number.isInteger(row.duration_ms)?Math.abs(durationMs-row.duration_ms):null;
        if(delta===null||delta<=5000)results.push({node,sha256_prefix:String(row.sha256||'').slice(0,12),
          duration_delta_ms:delta,source_video_id:row.source_video_id||null});
      }
    }catch{/* skip transient shard outage */}
  }
  return {status:results.length?'possible_existing_copy':reachable?'not_indexed':'temporarily_unavailable',
    candidates:results.slice(0,4),exact_audio:false,
    requires_confirmation:results.length>0};
}
