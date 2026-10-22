import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupMusicBrainz} from '../src/musicbrainz-discovery.mjs';
const meta={ok:true,title_candidate:'Runaway',artist_candidate:'Aurora',duration_ms:250000};
const m='36ddaaa5-8c55-4db4-959f-c5a9a834ff33';
const recording=(title='Runaway',artist='Aurora',length=250400)=>({id:m,title,length,'artist-credit':[{artist:{name:artist}}]});
test('recording identity is reported when title artist and duration match',async()=>{
 const result=await lookupMusicBrainz(meta,{fetchImpl:async url=>{
  assert.match(url,/musicbrainz.org\/ws\/2\/recording/);
  return new Response(JSON.stringify({recordings:[recording()]}),{status:200});
 }});
 assert.equal(result.status,'identified');assert.equal(result.recording_id,m);
 assert.equal(result.metadata_only,true);
});
test('nearby title alone does not infer exact recording',async()=>{
 const result=await lookupMusicBrainz(meta,{fetchImpl:async()=>new Response(JSON.stringify({recordings:[recording('Runaway','Another Artist',267000)]}))});
 assert.equal(result.recording_id,null);assert.equal(result.status,'candidates_for_review');
});
test('API failures do not pretend song is unidentified',async()=>{
 const result=await lookupMusicBrainz(meta,{fetchImpl:async()=>{throw Error('offline')}});
 assert.equal(result.status,'temporarily_unavailable');
});
