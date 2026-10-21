import test from 'node:test';
import assert from 'node:assert/strict';
import {searchCatalog,getCatalogTrack,matchCatalogMetadata,_test} from '../src/plaka-catalog.mjs';
import {analyzeRecording} from '../src/normalization-engine.mjs';
const ENV={PIKETE_SUPABASE_A_SECRET_KEY:'sb_secret_'+'z'.repeat(25)};
const ID='c1234567-1234-4234-a234-123456789abc';
const ID2='d1234567-1234-4234-a234-123456789abc';
const row=(id,title='One More Time',artist='Daft Punk')=>({id,title,artist_name:artist,album_title:'Discovery',duration_ms:320000,
  mime_type:'audio/mpeg',status:'published',rights_attested:true,
  telegram_file_id:'f-abc',telegram_bot_key:'bot-1',audio_sha256:'a'.repeat(64)});
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
test('reject missing main secret',async()=>{
 await assert.rejects(searchCatalog({query:'punk'},{env:{},fetchImpl:()=>{throw Error('must not fetch');}}),e=>e.code==='catalog_a_secret_not_configured');
});
test('safe query strips PostgREST grammar, never interpolates URL or raw input',async()=>{
 assert.equal(_test.cleanQuery('one%),status.eq.queued*  more'), 'one status eq queued more');
 let requestUrl='';
 const res=await searchCatalog({query:'Daft Punk',page:2},{env:ENV,fetchImpl:async url=>{requestUrl=url;return json([row(ID)]);}});
 assert.equal(res.tracks.length,1);assert.equal(res.page,2);
 const url=new URL(requestUrl);assert.equal(url.searchParams.get('offset'),'50');assert.equal(url.searchParams.get('limit'),'26');
 assert.equal(url.searchParams.get('status'),'eq.published');
 assert.equal(url.searchParams.get('or'),'(title.ilike.*Daft Punk*,artist_name.ilike.*Daft Punk*)');
 assert.equal(url.pathname,'/rest/v1/plaka_tracks');
});
test('no audio token or file ID escapes catalog response, SHA deduplicates only exact hash',async()=>{
 const result=await searchCatalog({query:'daft'},{env:ENV,fetchImpl:async()=>json([row(ID),row(ID2)])});
 assert.equal(result.tracks[1].same_audio_as,ID);
 assert.equal(JSON.stringify(result).includes('f-abc'),false);
 assert.equal(JSON.stringify(result).includes('sb_secret'),false);
});
test('published track must have rights attestation and Telegram archive before eligible',async()=>{
 const good=await getCatalogTrack(ID,{env:ENV,fetchImpl:async()=>json([row(ID)])});
 assert.equal(good.eligible,true);assert.equal(good.playback_track_id,ID);
 const noRights=await getCatalogTrack(ID,{env:ENV,fetchImpl:async()=>json([{...row(ID),rights_attested:false}])});
 assert.equal(noRights.eligible,false);assert.equal(noRights.playback_track_id,null);
 const emptyArchive=await getCatalogTrack(ID,{env:ENV,fetchImpl:async()=>json([{...row(ID),telegram_file_id:null}])});
 assert.equal(emptyArchive.eligible,false);
});
test('metadata matching returns candidates but never enables playback by title',async()=>{
 const normalized=analyzeRecording({artist:'Daft Punk',title:'One More Time'});
 const result=await matchCatalogMetadata(normalized,{env:ENV,fetchImpl:async()=>json([row(ID)])});
 assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].direct_playback_eligible,false);
 assert.equal(result.requires_confirmation,true);assert.equal(result.metadata_only,true);
});
test('metadata matching requires artist and title',async()=>{
 const normalized=analyzeRecording({title:'One More Time'});
 const result=await matchCatalogMetadata(normalized,{env:ENV,fetchImpl:async()=>{throw Error('network should not be queried');}});
 assert.equal(result.status,'insufficient_metadata');
});
test('pagination returns 26th item as has_more, only first 25',async()=>{
 const result=await searchCatalog({query:'one'},{env:ENV,fetchImpl:async()=>json(Array.from({length:26},(_,i)=>row(ID,String(i))))});
 assert.equal(result.tracks.length,25);assert.equal(result.has_more,true);
});
