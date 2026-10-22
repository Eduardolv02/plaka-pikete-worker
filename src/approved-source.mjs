/** Server-controlled source adapter. Never fetch arbitrary user-supplied URLs.
 * Configure exact HTTPS hostnames belonging to providers where PLAKA is licensed
 * to fetch and redistribute the audio. No redirects, no YouTube media URLs.
 */
import {Readable} from 'node:stream';
import {QueueError} from './pikete-queue.mjs';
import {ingestOwnerAudio, MAX_AUDIO_BYTES} from './telegram-archive.mjs';

export function allowedSource(url,env=process.env){
  if(typeof url!=='string'||url.length>2048)return null;
  let parsed;try{parsed=new URL(url);}catch{return null;}
  const hosts=(env.PIKETE_APPROVED_AUDIO_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(parsed.protocol!=='https:'||parsed.port||parsed.username||parsed.password||parsed.hash||!hosts.includes(parsed.hostname.toLowerCase()))return null;
  // URL restrictions are deliberately exact host matching, not suffix matching.
  if(parsed.hostname==='youtube.com'||parsed.hostname.endsWith('.youtube.com')||parsed.hostname==='youtu.be')return null;
  return parsed.toString();
}

export async function ingestApprovedSource(body,options={}){
  const env=options.env||process.env;
  if(env.PIKETE_APPROVED_INGEST_ENABLED!=='true')throw new QueueError('approved_ingest_disabled',403);
  if(!body||body.owner_confirmed_rights!==true||body.provider_download_authorized!==true)
    throw new QueueError('source_rights_required',403);
  const url=allowedSource(body.audio_url,env);
  if(!url)throw new QueueError('source_not_allowlisted',403);
  if(!['audio/mpeg','audio/mp4'].includes(body.mime))throw new QueueError('invalid_source_mime',415);
  const fetchImpl=options.sourceFetch||fetch;
  let response;
  try{response=await fetchImpl(url,{method:'GET',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(75000)});}
  catch{throw new QueueError('source_unreachable',503);}
  if(response.status!==200||!response.body)throw new QueueError('source_bad_http',502);
  const contentType=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(contentType!==body.mime){await response.body.cancel();throw new QueueError('source_mime_mismatch',415);}
  const declared=Number(response.headers.get('content-length'));
  if(!Number.isInteger(declared)||declared<512||declared>MAX_AUDIO_BYTES){await response.body.cancel();throw new QueueError('source_length_invalid',413);}
  // Verify owner, normalized metadata, rights, bytes, SHA256, cross-shard reuse,
  // Telegram upload and DB association through the existing trusted implementation.
  return ingestOwnerAudio({node:body.node,playlistId:body.playlist_id,itemId:body.item_id,
    ownerId:body.owner_id,mime:body.mime,length:declared,stream:Readable.fromWeb(response.body)},options);
}
