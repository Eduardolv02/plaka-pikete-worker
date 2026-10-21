/** Strict URL allowlist metadata lookup. NEVER download user-provided audio or arbitrary URLs. */
import { cleanText } from './normalization-engine.mjs';
export function supportedSource(raw) {
  if(typeof raw!=='string' || raw.length>2048) return {ok:false,code:'invalid_source_url'};
  let u;
  try{u=new URL(raw);}catch{return {ok:false,code:'invalid_source_url'};}
  if(u.protocol!=='https:' || u.username || u.password || u.port) return {ok:false,code:'unsupported_source_url'};
  const host=u.hostname.toLowerCase();
  if(host==='youtu.be'){
    const id=u.pathname.split('/').filter(Boolean)[0];
    return /^[a-zA-Z0-9_-]{11}$/.test(id||'')?{ok:true,provider:'youtube',canonical:`https://www.youtube.com/watch?v=${id}`}: {ok:false,code:'invalid_source_id'};
  }
  if(['www.youtube.com','youtube.com','m.youtube.com'].includes(host)) {
    let id=u.searchParams.get('v');
    if(u.pathname.startsWith('/shorts/')||u.pathname.startsWith('/live/')) id=u.pathname.split('/')[2];
    return /^[a-zA-Z0-9_-]{11}$/.test(id||'')?{ok:true,provider:'youtube',canonical:`https://www.youtube.com/watch?v=${id}`}: {ok:false,code:'invalid_source_id'};
  }
  if(host==='open.spotify.com'){
    const seg=u.pathname.split('/').filter(Boolean);
    const i=seg.findIndex(x=>x==='track');
    const id=seg[i+1];
    return i>=0 && /^[a-zA-Z0-9]{22}$/.test(id||'')?{ok:true,provider:'spotify',canonical:`https://open.spotify.com/track/${id}`}: {ok:false,code:'invalid_source_id'};
  }
  if(['soundcloud.com','www.soundcloud.com'].includes(host)){
    const seg=u.pathname.split('/').filter(Boolean);
    if(seg.length!==2 || seg.some(s=>!/^[-\w]{1,120}$/.test(s))) return {ok:false,code:'invalid_source_id'};
    return {ok:true,provider:'soundcloud',canonical:`https://soundcloud.com/${seg[0]}/${seg[1]}`};
  }
  return {ok:false,code:'unsupported_source_provider'};
}
export function metadataEndpoint(source) {
  if(source.provider==='youtube')return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(source.canonical)}`;
  if(source.provider==='spotify')return `https://open.spotify.com/oembed?url=${encodeURIComponent(source.canonical)}`;
  if(source.provider==='soundcloud')return `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(source.canonical)}`;
  return null;
}
export async function fetchProviderMetadata(rawUrl,{fetchImpl=fetch,timeoutMs=6500}={}) {
  const source=supportedSource(rawUrl);
  if(!source.ok)return source;
  let response;
  try{response=await fetchImpl(metadataEndpoint(source),{
    method:'GET',redirect:'error',cache:'no-store',headers:{Accept:'application/json'},
    signal:AbortSignal.timeout(timeoutMs),
  });}catch(e){return {ok:false,code:e?.name==='TimeoutError'?'metadata_timeout':'metadata_unavailable',provider:source.provider};}
  if(!response.ok)return {ok:false,code:'provider_metadata_unavailable',provider:source.provider,http_status:response.status};
  const length=Number(response.headers?.get?.('content-length')||0);
  if(length>32768)return {ok:false,code:'metadata_too_large',provider:source.provider};
  let json;
  try{const raw=await response.text();if(raw.length>32768)throw Error('large');json=JSON.parse(raw);}catch{return {ok:false,code:'metadata_invalid_response',provider:source.provider};}
  const title=cleanText(json?.title,240);
  if(!title)return {ok:false,code:'metadata_missing_title',provider:source.provider};
  return {ok:true,provider:source.provider,canonical_url:source.canonical,
    source_title:title,source_author:cleanText(json?.author_name,180),
    note:'El autor del canal/cuenta NO prueba el artista ni los derechos del audio.'};
}
