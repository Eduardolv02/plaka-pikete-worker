import test from 'node:test';
import assert from 'node:assert/strict';
import {decideRecordingIdentity} from '../src/recording-identity.mjs';
const id='36ddaaa5-8c55-4db4-959f-c5a9a834ff33';
test('musicbrainz identity alone never grants audio availability',()=>{
 const r=decideRecordingIdentity({musicbrainz:{status:'identified',recording_id:id}});
 assert.equal(r.musicbrainz_recording_id,id);assert.equal(r.audio_source_verified,false);
 assert.equal(r.next_step,'obtain_authorized_audio');
});
test('published Plaka metadata requires explicit track selection',()=>{
 const r=decideRecordingIdentity({catalog_match:{best:id,candidates:[{ref:id,archive_available:true}]}});
 assert.equal(r.plaka_track_candidate_id,id);
 assert.equal(r.plaka_track_requires_confirmation,true);
 assert.equal(r.audio_source_verified,false);
 assert.equal(r.next_step,'confirm_plaka_track');
});
test('archive metadata collision never claims same bytes',()=>{
 const r=decideRecordingIdentity({archive_lookup:{status:'possible_existing_copy'}});
 assert.equal(r.archive_may_exist,true);assert.equal(r.exact_archive_match,false);
 assert.equal(r.next_step,'verify_existing_audio');
});
