import { analyzeRecording, rankCatalogCandidates, classifyMatch } from './normalization-engine.mjs';
import { fetchProviderMetadata } from './provider-metadata.mjs';
export async function inspectRecording(body,options={}) {
  if(!body || typeof body!=='object' || Array.isArray(body)) return {ok:false,code:'invalid_payload'};
  let fetched=null;
  if(body.source_url){
    fetched=await fetchProviderMetadata(body.source_url,options);
    if(!fetched.ok && !body.title && !body.filename) return {ok:false,code:fetched.code,source_metadata:fetched};
  }
  const normalized=analyzeRecording({...body,source_title:body.source_title || (fetched?.ok?fetched.source_title:null)});
  if(!normalized.ok) return normalized;
  const candidates=rankCatalogCandidates(normalized,body.catalog_candidates);
  const classification=classifyMatch(candidates);
  return {
    ok:true,normalized,
    source_metadata:fetched,
    match:classification,
    candidates,
    decision:'manual_confirmation_or_verified_fingerprint_required',
    rights_status:'not_checked',
    ready_to_share:false,
    ingestion:'metadata_only',
    note:'Una coincidencia de título no identifica el archivo exacto ni concede permiso de distribución.',
  };
}
