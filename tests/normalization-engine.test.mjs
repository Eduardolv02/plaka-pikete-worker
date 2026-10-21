import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeRecording,rankCatalogCandidates,classifyMatch} from '../src/normalization-engine.mjs';
import {supportedSource,fetchProviderMetadata} from '../src/provider-metadata.mjs';
import {inspectRecording} from '../src/normalization-service.mjs';

test('parses artist and title from uploader video text',()=>{
 const a=analyzeRecording({source_title:'Daft Punk - One More Time (Official Audio)'});
 assert.equal(a.artist_candidate,'Daft Punk'); assert.equal(a.title_candidate,'One More Time');
 assert.deepEqual(a.versions,[]);
});
test('retains meaningful bracket content',()=>{
 assert.equal(analyzeRecording({artist:'Guns N Roses',title:'Sweet Child (Of Mine)'}).title_candidate,'Sweet Child (Of Mine)');
});
test('retains song titles with non-variant live word',()=>{
 assert.deepEqual(analyzeRecording({artist:'Paul McCartney',title:'Live and Let Die'}).versions,[]);
});
test('normalizes accent punctuation for matching but preserves display',()=>{
 const a=analyzeRecording({artist:'Beyoncé',title:'Canción!'});
 assert.equal(a.artist_candidate,'Beyoncé'); assert.equal(a.artist_key,'beyonce'); assert.equal(a.title_key,'cancion');
});
test('prevents live version matching studio version',()=>{
 const a=analyzeRecording({artist:'Queen',title:'Bohemian Rhapsody (Live at Wembley)'});
 const c=rankCatalogCandidates(a,[{id:'original',artist:'Queen',title:'Bohemian Rhapsody'}]);
 assert.equal(c[0].version_mismatch,true);assert.ok(c[0].score<0.5);
});
test('prevents slowed/sped up mismatch',()=>{
 const a=analyzeRecording({artist:'A',title:'Song (Slowed + Reverb)'});
 const c=rankCatalogCandidates(a,[{artist:'A',title:'Song (Sped Up)'}]);
 assert.equal(c[0].version_mismatch,true);
});
test('exact metadata leads only to high confidence metadata, never ready to share',async()=>{
 const r=await inspectRecording({title:'One More Time',artist:'Daft Punk',catalog_candidates:[{id:'abc',title:'One More Time',artist:'Daft Punk'}]});
 assert.equal(r.match.status,'high_confidence_metadata');assert.equal(r.ready_to_share,false);
});
test('ambiguous same-named candidates require manual review',async()=>{
 const r=await inspectRecording({title:'Hello',artist:'Adele',catalog_candidates:[{title:'Hello',artist:'Adele'},{title:'Hello',artist:'Adele'}]});
 assert.equal(r.match.status,'ambiguous_manual_review');
});
test('extracts feat from bracket group',()=>{
 const a=analyzeRecording({artist:'Singer',title:'Hit (feat. Guest) [Official Video]'});
 assert.equal(a.title_candidate,'Hit');assert.ok(a.featuring.includes('Guest'));
});
test('rejects SSRF, HTTP, localhost, arbitrary domains',()=>{
 for(const url of ['http://youtube.com/watch?v=abcdefghijk','https://localhost/audio.mp3','https://evil.com','https://www.youtube.com.evil.org/watch?v=abcdefghijk','https://127.0.0.1'])assert.equal(supportedSource(url).ok,false);
});
test('validates known source URL IDs and canonicalizes trackers',()=>{
 assert.equal(supportedSource('https://youtu.be/dQw4w9WgXcQ?si=abc').canonical,'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
 assert.equal(supportedSource('https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8?si=foo').provider,'spotify');
});
test('fetch oEmbed title without mistaking channel for recording artist',async()=>{
 const r=await inspectRecording({source_url:'https://youtu.be/dQw4w9WgXcQ'}, {
 fetchImpl:async()=>({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({title:'Rick Astley - Never Gonna Give You Up (Official Video)',author_name:'Different Channel'})})
 });
 assert.equal(r.normalized.artist_candidate,'Rick Astley');assert.equal(r.normalized.title_candidate,'Never Gonna Give You Up');
 assert.equal(r.source_metadata.source_author,'Different Channel');assert.equal(r.ready_to_share,false);
});
test('provider failure can fallback to explicit text',async()=>{
 const r=await inspectRecording({title:'My song',artist:'My artist',source_url:'https://youtu.be/dQw4w9WgXcQ'}, {fetchImpl:async()=>{throw Error('network');}});
 assert.equal(r.ok,true);assert.equal(r.source_metadata.code,'metadata_unavailable');
});
test('provider failure without text fails closed',async()=>{
 const r=await inspectRecording({source_url:'https://evil.com/track'},{});
 assert.equal(r.ok,false);
});
test('old normalization endpoint contract preserved',async()=>{
 const { normalizeMetadata } = await import('../src/normalize.mjs');
 assert.equal(normalizeMetadata({artist:'Daft Punk',title:'One More Time.mp3'}).title_candidate,'One More Time');
});
