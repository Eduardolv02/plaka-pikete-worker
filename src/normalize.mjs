/** Text cleanup only; never pretends to identify the official recording. */
export function normalizeMetadata(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {ok:false,code:'invalid_payload'};
  const tidy = (v, max) => typeof v === 'string' ? v.normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max) : '';
  let artist = tidy(input.artist, 180);
  let title = tidy(input.title, 180);
  if (!title) return {ok:false,code:'title_required'};
  title = title.replace(/\.(mp3|m4a|flac|ogg|opus|wav)$/i, '').trim();
  // Do NOT infer artist/version from filenames; metadata may be ambiguous.
  return {ok:true,artist_candidate:artist,title_candidate:title,
    identification_status:'pending_external_match',
    rights_status:'not_checked',
    ready_to_share:false};
}
