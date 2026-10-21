-- PLAKA Pikete 1.6: archive metadata per-item; bots only through authorized backends.
BEGIN;
ALTER TABLE public.pikete_playlist_items
 ADD COLUMN IF NOT EXISTS metadata_confirmed_at timestamptz,
 ADD COLUMN IF NOT EXISTS archive_status text NOT NULL DEFAULT 'none',
 ADD COLUMN IF NOT EXISTS archive_bot_slot smallint,
 ADD COLUMN IF NOT EXISTS archive_file_id text,
 ADD COLUMN IF NOT EXISTS archive_sha256 text,
 ADD COLUMN IF NOT EXISTS archive_mime_type text,
 ADD COLUMN IF NOT EXISTS archive_uploaded_at timestamptz;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.pikete_playlist_items'::regclass AND conname='pikete_archive_status_check') THEN
  ALTER TABLE public.pikete_playlist_items ADD CONSTRAINT pikete_archive_status_check CHECK (archive_status IN ('none','ready','failed'));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.pikete_playlist_items'::regclass AND conname='pikete_archive_consistency_check') THEN
  ALTER TABLE public.pikete_playlist_items ADD CONSTRAINT pikete_archive_consistency_check CHECK (
    archive_status <> 'ready' OR
    (archive_bot_slot BETWEEN 1 AND 4 AND nullif(btrim(archive_file_id),'') IS NOT NULL
     AND archive_sha256 ~ '^[a-f0-9]{64}$' AND rights_status='cleared' AND state='ready'));
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.pikete_audio_archive (
 sha256 text PRIMARY KEY CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bot_slot smallint NOT NULL CHECK(bot_slot BETWEEN 1 AND 4),
 telegram_file_id text NOT NULL CHECK(char_length(telegram_file_id) BETWEEN 10 AND 400),
 telegram_file_unique_id text,
 mime_type text NOT NULL CHECK(mime_type IN ('audio/mpeg','audio/mp4')),
 bytes integer NOT NULL CHECK(bytes BETWEEN 512 AND 19922944),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pikete_audio_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pikete_audio_archive FROM anon,authenticated;
GRANT SELECT,INSERT ON TABLE public.pikete_audio_archive TO service_role;

CREATE OR REPLACE FUNCTION public.pikete_attach_verified_audio(
 p_playlist_id uuid, p_item_id uuid, p_owner_user_id uuid, p_bot_slot smallint,
 p_file_id text, p_sha256 text, p_mime_type text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE v_row public.pikete_playlist_items%ROWTYPE;
BEGIN
 IF p_bot_slot IS NULL OR p_bot_slot NOT BETWEEN 1 AND 4 OR p_file_id IS NULL OR char_length(p_file_id) NOT BETWEEN 10 AND 400
 OR p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$'
 OR p_mime_type IS NULL OR p_mime_type NOT IN ('audio/mpeg','audio/mp4')
 THEN RAISE EXCEPTION 'invalid_archive_metadata' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.pikete_playlists WHERE id=p_playlist_id AND owner_user_id=p_owner_user_id
       AND kind='private' AND status='active') THEN
  RETURN jsonb_build_object('ok',false,'code','not_owner');
 END IF;
 SELECT * INTO v_row FROM public.pikete_playlist_items
 WHERE id=p_item_id AND playlist_id=p_playlist_id FOR UPDATE;
 IF NOT FOUND OR v_row.source_type<>'local' OR v_row.metadata_confirmed_at IS NULL
 OR v_row.normalization_status<>'normalized'
 THEN RETURN jsonb_build_object('ok',false,'code','item_not_confirmed'); END IF;
 -- A previous archive can be replaced by its owner; archived bots are bound to a fixed slot.
 UPDATE public.pikete_playlist_items SET
   archive_status='ready', archive_bot_slot=p_bot_slot,archive_file_id=p_file_id,
   archive_sha256=p_sha256, archive_mime_type=p_mime_type,
   archive_uploaded_at=clock_timestamp(), rights_status='cleared',state='ready',updated_at=clock_timestamp()
 WHERE id=p_item_id AND playlist_id=p_playlist_id;
 RETURN jsonb_build_object('ok',true,'item_id',p_item_id,'archive_status','ready');
END;
$fn$;
REVOKE ALL ON FUNCTION public.pikete_attach_verified_audio(uuid,uuid,uuid,smallint,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pikete_attach_verified_audio(uuid,uuid,uuid,smallint,text,text,text) TO service_role;
COMMIT;
