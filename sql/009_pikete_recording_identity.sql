-- PLAKA PIKETE 1.1: identifiers for metadata dedupe / play event grouping.
-- Run on B and C AFTER 008. No automatic trust in third-party identification.
BEGIN;
ALTER TABLE public.pikete_playlist_items
 ADD COLUMN IF NOT EXISTS musicbrainz_recording_id uuid,
 ADD COLUMN IF NOT EXISTS resolved_plaka_track_id uuid;
-- Cache is local to shard; application explicitly selects Plaka published track ID.
ALTER TABLE public.pikete_audio_archive
 ADD COLUMN IF NOT EXISTS musicbrainz_recording_id uuid,
 ADD COLUMN IF NOT EXISTS plaka_track_id uuid;
CREATE INDEX IF NOT EXISTS pikete_audio_mb_recording_idx
 ON public.pikete_audio_archive(musicbrainz_recording_id)
 WHERE musicbrainz_recording_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pikete_audio_plaka_track_idx
 ON public.pikete_audio_archive(plaka_track_id)
 WHERE plaka_track_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pikete_playlist_items_mb_recording_idx
 ON public.pikete_playlist_items(musicbrainz_recording_id)
 WHERE musicbrainz_recording_id IS NOT NULL;
-- One event ID per shard guarantees retry idempotency. The same listening event must
-- never be written to both shards. Server validates signed playback session separately.
CREATE TABLE IF NOT EXISTS public.pikete_play_events (
 event_id uuid PRIMARY KEY,
 listener_user_id uuid NOT NULL,
 playlist_id uuid NOT NULL,
 playlist_item_id uuid NOT NULL,
 plaka_track_id uuid,
 musicbrainz_recording_id uuid,
 archive_sha256 text,
 event_type text NOT NULL CHECK (event_type IN ('play_start','heartbeat','play_finish')),
 played_ms integer NOT NULL DEFAULT 0 CHECK (played_ms BETWEEN 0 AND 86400000),
 event_time timestamptz NOT NULL DEFAULT now(),
 inserted_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT pikete_play_events_archive_hash_check CHECK (
 archive_sha256 IS NULL OR archive_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS pikete_play_events_song_idx
 ON public.pikete_play_events (plaka_track_id,musicbrainz_recording_id,event_time DESC);
CREATE INDEX IF NOT EXISTS pikete_play_events_listener_idx
 ON public.pikete_play_events (listener_user_id,event_time DESC);
ALTER TABLE public.pikete_play_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pikete_play_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON TABLE public.pikete_play_events TO service_role;
-- Writes must be limited to the authorized playback session in server code,
-- never accepted from arbitrary client-generated identity claims.
COMMIT;
