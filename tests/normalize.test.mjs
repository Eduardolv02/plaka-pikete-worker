import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMetadata } from '../src/normalize.mjs';
test('requires title', () => assert.equal(normalizeMetadata({artist:'X'}).code, 'title_required'));
test('cleans metadata but does not claim official match', () => {
  const x = normalizeMetadata({artist:'  Daft    Punk ', title:' One More Time.mp3 '});
  assert.equal(x.artist_candidate, 'Daft Punk');
  assert.equal(x.title_candidate, 'One More Time');
  assert.equal(x.identification_status, 'pending_external_match');
  assert.equal(x.ready_to_share, false);
});
test('invalid payload', () => assert.equal(normalizeMetadata(null).code,'invalid_payload'));
