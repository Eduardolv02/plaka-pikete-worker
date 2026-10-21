-- Pikete 1.8: preparación por canción y cola con prioridad por cuenta.
-- Ejecutar en Supabase B y C. Compatible con los datos anteriores.
BEGIN;
ALTER TABLE public.pikete_playlist_items
 ADD COLUMN IF NOT EXISTS processing_tier text NOT NULL DEFAULT 'standard',
 ADD COLUMN IF NOT EXISTS preparation_status text NOT NULL DEFAULT 'queued',
 ADD COLUMN IF NOT EXISTS preparation_due_at timestamptz,
 ADD COLUMN IF NOT EXISTS selected_youtube_video_id text,
 ADD COLUMN IF NOT EXISTS youtube_confirmed_at timestamptz;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.pikete_playlist_items'::regclass AND conname='pikete_preparation_tier_check') THEN
  ALTER TABLE public.pikete_playlist_items ADD CONSTRAINT pikete_preparation_tier_check CHECK (processing_tier IN ('standard','priority'));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.pikete_playlist_items'::regclass AND conname='pikete_preparation_status_check') THEN
  ALTER TABLE public.pikete_playlist_items ADD CONSTRAINT pikete_preparation_status_check CHECK (preparation_status IN ('queued','needs_confirmation','awaiting_audio','ready','failed'));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.pikete_playlist_items'::regclass AND conname='pikete_selected_video_id_check') THEN
  ALTER TABLE public.pikete_playlist_items ADD CONSTRAINT pikete_selected_video_id_check CHECK (selected_youtube_video_id IS NULL OR selected_youtube_video_id ~ '^[A-Za-z0-9_-]{11}$');
 END IF;
END $$;
UPDATE public.pikete_playlist_items SET preparation_status='ready' WHERE (archive_status='ready' AND state='ready') OR (source_type='plaka' AND state='ready');
UPDATE public.pikete_playlist_items SET preparation_status='needs_confirmation'
 WHERE source_type IN ('local','external') AND normalization_status='normalized'
 AND archive_status<>'ready';
-- Migration intentionally does not retroactively impose a 24h deadline on old entries.

ALTER TABLE public.pikete_audio_archive
 ADD COLUMN IF NOT EXISTS normalized_key text,
 ADD COLUMN IF NOT EXISTS duration_ms integer,
 ADD COLUMN IF NOT EXISTS source_video_id text;
CREATE INDEX IF NOT EXISTS pikete_archive_normalized_key_idx ON public.pikete_audio_archive(normalized_key)
 WHERE normalized_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.pikete_enqueue_normalization()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF NEW.source_type IN ('external','local') THEN
  INSERT INTO public.pikete_jobs(dedupe_key,playlist_item_id,job_type,status,priority)
  VALUES('normalize:'||NEW.id::text,NEW.id,'normalize','queued',
   CASE WHEN NEW.processing_tier='priority' THEN 9 ELSE 5 END)
  ON CONFLICT(dedupe_key) DO NOTHING;
 END IF;
 RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.pikete_queue_record_normalization(p_job_id uuid,p_worker text,p_outcome text,p_metadata jsonb DEFAULT NULL,p_error_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE j public.pikete_jobs%ROWTYPE;
DECLARE changed uuid;
BEGIN
 IF p_job_id IS NULL OR p_worker IS NULL OR char_length(btrim(p_worker)) NOT BETWEEN 3 AND 80
 OR p_outcome IS NULL OR p_outcome NOT IN ('done','manual_review')
 OR char_length(coalesce(p_error_code,''))>120
 OR (p_outcome='done' AND (p_metadata IS NULL OR jsonb_typeof(p_metadata)<>'object'))
 OR (p_metadata IS NOT NULL AND (jsonb_typeof(p_metadata)<>'object' OR pg_catalog.octet_length(p_metadata::text)>12000))
 THEN RAISE EXCEPTION 'invalid_normalization_arguments' USING ERRCODE='22023'; END IF;
 SELECT * INTO j FROM public.pikete_jobs WHERE id=p_job_id AND job_type='normalize' AND status='leased' AND leased_by=p_worker AND lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_current_lease'); END IF;
 IF j.playlist_item_id IS NOT NULL THEN
  UPDATE public.pikete_playlist_items AS i
  SET normalized_metadata=CASE WHEN p_outcome='done' THEN p_metadata ELSE NULL END,
   normalized_at=CASE WHEN p_outcome='done' THEN clock_timestamp() ELSE NULL END,
   normalization_status=CASE WHEN p_outcome='done' THEN 'normalized' ELSE 'needs_review' END,
   state=CASE WHEN p_outcome='done' THEN 'matching' ELSE 'pending' END,
   preparation_status=CASE WHEN p_outcome<>'done' THEN 'needs_confirmation'
     WHEN p_metadata->'archive_lookup'->>'status'='possible_existing_copy' THEN 'needs_confirmation'
     WHEN p_metadata->'youtube_search'->>'status'='high_confidence_metadata' THEN 'awaiting_audio'
     ELSE 'needs_confirmation' END,
   selected_youtube_video_id=CASE WHEN p_outcome='done' AND p_metadata->'youtube_search'->>'status'='high_confidence_metadata'
    AND p_metadata->'youtube_search'->>'best_video_id' ~ '^[A-Za-z0-9_-]{11}$'
    THEN p_metadata->'youtube_search'->>'best_video_id' ELSE i.selected_youtube_video_id END,
   updated_at=clock_timestamp()
  WHERE i.id=j.playlist_item_id AND i.source_type IN ('external','local') AND i.state<>'ready'
  RETURNING i.id INTO changed;
 END IF;
 IF changed IS NULL THEN p_outcome:='manual_review'; p_error_code:='item_missing_or_not_normalizable'; END IF;
 UPDATE public.pikete_jobs
 SET status=p_outcome,progress=CASE WHEN p_outcome='done' THEN 100 ELSE progress END,
  last_error_code=CASE WHEN p_outcome='done' THEN NULL ELSE NULLIF(btrim(p_error_code),'') END,
  leased_by=NULL,lease_until=NULL,updated_at=clock_timestamp()
 WHERE id=p_job_id;
 RETURN jsonb_build_object('ok',true,'job_id',p_job_id,'playlist_item_id',j.playlist_item_id,'outcome',p_outcome);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.pikete_attach_verified_audio(
 p_playlist_id uuid,p_item_id uuid,p_owner_user_id uuid,p_bot_slot smallint,
 p_file_id text,p_sha256 text,p_mime_type text)
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
 OR (v_row.preparation_status<>'awaiting_audio' AND v_row.preparation_due_at IS NOT NULL)
 THEN RETURN jsonb_build_object('ok',false,'code','item_not_confirmed'); END IF;
 UPDATE public.pikete_playlist_items SET
   archive_status='ready',archive_bot_slot=p_bot_slot,archive_file_id=p_file_id,
   archive_sha256=p_sha256,archive_mime_type=p_mime_type,
   archive_uploaded_at=clock_timestamp(),rights_status='cleared',state='ready',
   preparation_status='ready',updated_at=clock_timestamp()
 WHERE id=p_item_id AND playlist_id=p_playlist_id;
 RETURN jsonb_build_object('ok',true,'item_id',p_item_id,'archive_status','ready');
END;
$fn$;

REVOKE ALL ON FUNCTION public.pikete_enqueue_normalization() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pikete_queue_record_normalization(uuid,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pikete_attach_verified_audio(uuid,uuid,uuid,smallint,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pikete_queue_record_normalization(uuid,text,text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pikete_attach_verified_audio(uuid,uuid,uuid,smallint,text,text,text) TO service_role;
COMMIT;
