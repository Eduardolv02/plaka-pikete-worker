import test from 'node:test';
import assert from 'node:assert/strict';
import {licensedEntry,testArtistApproved,prepareLicensedItem,sweepLicensedItems} from '../src/studio-auto-archive.mjs';
const cfg={PIKETE_AUTO_ARCHIVE_ENABLED:'true'};
test('Unidentified recording has no licensed source',()=>assert.equal(licensedEntry({artist:'Aurora',title:'Runaway'},cfg),null));
test('Metadata URL without explicit redistribution permission is rejected',()=>{
  assert.equal(licensedEntry({artist:'Demo',title:'Song'},{PIKETE_LICENSED_AUDIO_CATALOG_JSON:JSON.stringify({'demo:song':{audio_url:'https://media.example/test.mp3',mime:'audio/mpeg',download_authorized:true}})}),null);
});
test('Only operator-curated licensed source is selected',()=>{
  const entry={audio_url:'https://media.example/test.mp3',mime:'audio/mpeg',download_authorized:true,redistribution_authorized:true};
  assert.deepEqual(licensedEntry({artist:'Demo',title:'Song'},{PIKETE_LICENSED_AUDIO_CATALOG_JSON:JSON.stringify({'demo:song':entry})}),entry);
});
test('Explicit opt-in gate prevents accidental network/archive',async()=>{
  await assert.rejects(()=>prepareLicensedItem({node:'B',item_id:'11111111-1111-4111-8111-111111111111'},{env:{}}),{code:'auto_archive_disabled'});
  await assert.rejects(()=>sweepLicensedItems({node:'both'},{env:{}}),{code:'auto_archive_disabled'});
});
test('Sweep input is bounded and validated before making HTTP calls',async()=>{
  await assert.rejects(()=>sweepLicensedItems({node:'both',limit:999},{env:cfg}),{code:'invalid_auto_sweep'});
  await assert.rejects(()=>prepareLicensedItem({node:'B',item_id:'bad'},{env:cfg}),{code:'invalid_auto_archive_item'});
});

test('Testing artist allowlist needs BOTH server flags and exact artist',()=>{
  const entry={audio_url:'https://media.example/test.mp3',mime:'audio/mpeg'};
  const catalog=JSON.stringify({'demo:song':entry});
  const base={PIKETE_LICENSED_AUDIO_CATALOG_JSON:catalog,PIKETE_TEST_APPROVED_ARTISTS:'Demo,Otro'};
  assert.equal(licensedEntry({artist:'Demo',title:'Song'},base),null);
  assert.equal(licensedEntry({artist:'Demo',title:'Song'},{...base,PIKETE_TEST_MODE:'true'}),null);
  assert.deepEqual(licensedEntry({artist:'DEMO',title:'Song'},{...base,PIKETE_TEST_MODE:'true',PIKETE_TEST_RIGHTS_ATTESTED:'true'}),entry);
  assert.equal(licensedEntry({artist:'Aurora',title:'Runaway'},{...base,PIKETE_TEST_MODE:'true',PIKETE_TEST_RIGHTS_ATTESTED:'true',PIKETE_LICENSED_AUDIO_CATALOG_JSON:JSON.stringify({'aurora:runaway':entry})}),null);
  assert.equal(testArtistApproved('Another',{...base,PIKETE_TEST_MODE:'true',PIKETE_TEST_RIGHTS_ATTESTED:'true'}),false);
});

test('Batch can process up to 100 jobs per sweep, with no cumulative total quota',async()=>{
  await assert.rejects(()=>sweepLicensedItems({node:'both',limit:101},{env:cfg}),{code:'invalid_auto_sweep'});
  await assert.rejects(()=>sweepLicensedItems({node:'both',limit:0},{env:cfg}),{code:'invalid_auto_sweep'});
  // An allowed 100-job batch proceeds to database access, not the validator.
  await assert.rejects(()=>sweepLicensedItems({node:'B',limit:100},{env:cfg,fetchImpl:async()=>{throw Error('offline')}}),{code:'node_not_configured'});
});
