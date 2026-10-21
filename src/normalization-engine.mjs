/** Pikete deterministic recording identity candidate normalizer.
 * This module NEVER certifies recording identity or redistribution rights.
 */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\uFEFF]/g;
const NOISE = /^(?:official\s+(?:music\s+)?(?:video|audio|lyric(?:s)?\s+video)|visuali[sz]er|lyric(?:s)?\s+video|audio\s+only|full\s+hd|hd|hq|4k|1080p|video\s+oficial|audio\s+oficial|letra\s+oficial|official|audio)$/i;
const VARIANTS = [
 ['live', /\b(?:live|en\s+vivo|directo|live\s+at|concert|concierto)\b/i],
 ['remix', /\b(?:remix|rework|r[eé]mix|rmx)\b/i],
 ['sped_up', /\b(?:sped\s*up|speed\s*up|nightcore)\b/i],
 ['slowed', /\b(?:slowed|slowed\s*\+?\s*reverb)\b/i],
 ['acoustic', /\b(?:acoustic|ac[uú]stic[oa])\b/i],
 ['instrumental', /\b(?:instrumental|instrumento\s+solo)\b/i],
 ['cover', /\bcover\b/i],
 ['remaster', /\bremaster(?:ed|izado)?\b/i],
 ['demo', /\bdemo\b/i],
 ['radio_edit', /\bradio\s*edit\b/i],
 ['karaoke', /\bkaraoke\b/i],
];
const PROMO_SUFFIX = /\s*(?:\[(?:official\s+)?(?:video|audio|lyrics?|visuali[sz]er)(?:\s+video)?\]|\((?:official\s+)?(?:video|audio|lyrics?|visuali[sz]er)(?:\s+video)?\))\s*$/i;
const FILE_SUFFIX = /\.(?:mp3|m4a|flac|wav|ogg|opus|aac|mp4|webm)$/i;
export function cleanText(input, max = 180) {
  return typeof input === 'string' ? input.normalize('NFKC').replace(CONTROL, ' ')
    .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'")
    .replace(/[\u2013\u2014]/g,'-').replace(/\s+/g, ' ').trim().slice(0,max) : '';
}
export function compareKey(input) {
  return cleanText(input,240).normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/\b(?:the|el|la|los|las)\b/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ')
    .replace(/\s+/g,' ').trim();
}
function variantTokens(part) {
  return VARIANTS.filter(([,re])=>re.test(part)).map(([name])=>name);
}
function stripMarkers(raw) {
  let title=cleanText(raw,240).replace(FILE_SUFFIX,'').trim();
  const variants=new Set(); const featuring=new Set(); const notes=[];
  const ft = /\s*(?:\(|\[)?(?:feat\.?|ft\.?|featuring|con)\s+([^\])]+)(?:\)|\])?/ig;
  title=title.replace(ft,(_,value)=>{ const f=cleanText(value,100); if(f) featuring.add(f);return ' '; }).trim();
  title=title.replace(/\s*[([]([^()[\]]+)[)\]]/g,(all,part)=>{
    const p=cleanText(part);
    if(NOISE.test(p)) {notes.push('removed_promotional_label');return ' ';}
    const tags=variantTokens(p);
    if(tags.length) { tags.forEach(v=>variants.add(v)); return ' '; }
    return all;
  });
  const segments=title.split(/\s+-\s+/);
  if(segments.length>1){
    while(segments.length>1){
      const last=segments[segments.length-1];
      const tags=variantTokens(last);
      if(NOISE.test(last)) {notes.push('removed_promotional_label');segments.pop();continue;}
      if(tags.length){tags.forEach(v=>variants.add(v));segments.pop();continue;}
      break;
    }
    title=segments.join(' - ');
  }
  title=title.replace(PROMO_SUFFIX,'').replace(/\s+/g,' ').trim();
  return {title,variants:[...variants].sort(),featuring:[...featuring],notes};
}
export function analyzeRecording(data) {
  if(!data || typeof data!=='object' || Array.isArray(data)) return {ok:false,code:'invalid_payload'};
  const source=cleanText(data.source_title,240);
  const original=cleanText(data.title,240) || source || cleanText(data.filename,240);
  if(!original) return {ok:false,code:'title_required'};
  let artist=cleanText(data.artist,180);
  let rawTitle=original;
  if(!artist) {
    const idx=original.indexOf(' - ');
    if(idx>0){
      const left=cleanText(original.slice(0,idx));
      const right=cleanText(original.slice(idx+3));
      if(left && right && !variantTokens(right).some(v=>right.toLowerCase()===v)) {
        artist=left.slice(0,180);rawTitle=right;
      }
    }
  }
  const parsed=stripMarkers(rawTitle);
  if(!parsed.title) return {ok:false,code:'title_required'};
  const explicitVersion=cleanText(data.version,100);
  if(explicitVersion) variantTokens(explicitVersion).forEach(v=>{if(!parsed.variants.includes(v))parsed.variants.push(v);});
  return {
    ok:true,
    artist_candidate:artist,
    title_candidate:parsed.title,
    artist_key:compareKey(artist),
    title_key:compareKey(parsed.title),
    versions:parsed.variants.sort(),
    featuring:parsed.featuring,
    notes:parsed.notes,
    duration_ms:Number.isInteger(data.duration_ms) && data.duration_ms>=0 && data.duration_ms<43200000?data.duration_ms:null,
    isrc:typeof data.isrc==='string' && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(data.isrc)?data.isrc.toUpperCase():null,
    identification_status:'unverified_candidate',
    rights_status:'not_checked',
    ready_to_share:false,
  };
}
function overlap(a,b){
  if(!a||!b) return 0;
  if(a===b) return 1;
  const x=new Set(a.split(' ')), y=new Set(b.split(' '));
  const union=new Set([...x,...y]);
  return [...x].filter(v=>y.has(v)).length/union.size;
}
function durationScore(a,b){
  if(a==null||b==null) return null;
  const diff=Math.abs(a-b);
  return Math.max(0,1-diff/15000);
}
const VERSION_FAMILIES=['live','remix','sped_up','slowed','acoustic','instrumental','cover','demo','karaoke','radio_edit','remaster'];
function versionConflict(a,b){return VERSION_FAMILIES.some(v=>a.includes(v)!==b.includes(v));}
/** Score a *metadata* candidate; never certify same audio without audio fingerprint/ISRC check. */
export function rankCatalogCandidates(normalized, catalog) {
  if(!normalized?.ok || !Array.isArray(catalog)) return [];
  return catalog.slice(0,150).filter(row=>row && typeof row==='object' && !Array.isArray(row))
    .map(row=>{
      const v=analyzeRecording(row);
      if(!v.ok) return null;
      const titleScore=overlap(normalized.title_key,v.title_key);
      const artistScore=normalized.artist_key && v.artist_key ? overlap(normalized.artist_key,v.artist_key):null;
      const time=durationScore(normalized.duration_ms,v.duration_ms);
      const mismatch=versionConflict(normalized.versions,v.versions);
      const isrcMatch=Boolean(normalized.isrc && v.isrc && normalized.isrc===v.isrc);
      let score=0.75*titleScore+0.25*(artistScore ?? 0.45);
      if(time!==null) score=score*0.9+0.1*time;
      if(isrcMatch) score=Math.max(score,0.99);
      if(mismatch) score=Math.min(score,0.49);
      if(artistScore!==null && artistScore<0.25 && !isrcMatch) score=Math.min(score,0.54);
      if(normalized.isrc && v.isrc && normalized.isrc!==v.isrc) score=Math.min(score,0.55);
      return {ref:typeof row.id==='string'?row.id:null,artist:v.artist_candidate,title:v.title_candidate,
        score:Number(score.toFixed(3)),version_mismatch:mismatch,isrc_match:isrcMatch,
        duration_delta_ms:time===null?null:Math.abs(normalized.duration_ms-v.duration_ms),
        version:v.versions};
    }).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,5);
}
export function classifyMatch(ranked) {
  const first=ranked[0];
  if(!first || first.score<0.62) return {status:'no_reliable_candidate',best:null};
  const margin=ranked.length>1?first.score-ranked[1].score:1;
  if(first.version_mismatch) return {status:'version_conflict',best:first};
  if(first.score>=0.9 && margin>=0.12) return {status:'high_confidence_metadata',best:first};
  if(first.score>=0.72 && margin>=0.10) return {status:'possible_metadata_match',best:first};
  return {status:'ambiguous_manual_review',best:first};
}
