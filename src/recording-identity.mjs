/** Identity hints for canonical music catalog, with no unauthorized audio reuse.
 * Strict content dedupe is based on SHA-256, while a recording ID only groups metadata.
 */
// Correct UUID regex (kept separate so bad provider input never reaches database).
const MBID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function decideRecordingIdentity(metadata){
  const catalog=metadata?.catalog_match;
  const musicbrainz=metadata?.musicbrainz;
  const archive=metadata?.archive_lookup;
  // Never promote matched catalog metadata to published audio; explicit track ID confirmation is required.
  const plakaCandidate=catalog?.candidates?.find(c=>c.ref===catalog.best && c.archive_available===true);
  const mbid=musicbrainz?.status==='identified' && MBID.test(musicbrainz.recording_id||'')
    ?musicbrainz.recording_id.toLowerCase():null;
  const possibleExisting=archive?.status==='possible_existing_copy';
  return {
    musicbrainz_recording_id:mbid,
    plaka_track_candidate_id:plakaCandidate?.ref||null,
    plaka_track_requires_confirmation:!!plakaCandidate,
    archive_may_exist:possibleExisting,
    exact_archive_match:false,
    audio_source_verified:false,
    next_step:plakaCandidate?'confirm_plaka_track':possibleExisting?'verify_existing_audio':'obtain_authorized_audio',
  };
}
