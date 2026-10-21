-- PLAKA PIKETE Phase 5: additive schema, queue producer and atomic normalization results
-- Apply independently to Supabase B and C. Does not touch Supabase A.
BEGIN;
ALTER TABLE public.pikete_playlist_items
  ADD COLUMN IF NOT EXISTS normalized_metadata jsonb,
  ADD COLUMN IF NOT EXISTS normalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS normalization_status text NOT NULL DEFAULT 'not_started';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pikete_playlist_items'::regclass AND conname='pikete_items_normalization_status_check') THEN
    ALTER TABLE public.pikete_playlist_items
      ADD CONSTRAINT pikete_items_normalization_status_check
      CHECK (normalization_status IN ('not_started','normalized','needs_review'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.pikete_enqueue_normalization()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $fn$
BEGIN
  IF NEW.source_type = 'external' THEN
    INSERT INTO public.pikete_jobs(dedupe_key,playlist_item_id,job_type,status,priority)
    VALUES ('normalize:'||NEW.id::text,NEW.id,'normalize','queued',5)
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS pikete_items_enqueue_normalization_v1 ON public.pikete_playlist_items;
CREATE TRIGGER pikete_items_enqueue_normalization_v1
AFTER INSERT ON public.pikete_playlist_items
FOR EACH ROW EXECUTE FUNCTION public.pikete_enqueue_normalization();

-- Called ONLY by the backend service key, after claiming the job with a valid lease.
-- Both the item mutation and job completion happen in one Postgres transaction.
CREATE OR REPLACE FUNCTION public.pikete_queue_record_normalization(
    p_job_id uuid,p_worker text,p_outcome text,p_metadata jsonb DEFAULT NULL,
    p_error_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
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

  SELECT * INTO j FROM public.pikete_jobs
  WHERE id=p_job_id AND job_type='normalize' AND status='leased'
    AND leased_by=p_worker AND lease_until>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_current_lease'); END IF;

  IF j.playlist_item_id IS NOT NULL THEN
    UPDATE public.pikete_playlist_items AS i
       SET normalized_metadata=CASE WHEN p_outcome='done' THEN p_metadata ELSE NULL END,
           normalized_at=CASE WHEN p_outcome='done' THEN clock_timestamp() ELSE NULL END,
           normalization_status=CASE WHEN p_outcome='done' THEN 'normalized' ELSE 'needs_review' END,
           state=CASE WHEN p_outcome='done' THEN 'matching' ELSE 'pending' END,
           updated_at=clock_timestamp()
     WHERE i.id=j.playlist_item_id AND i.source_type='external'
       AND i.state<>'ready'
     RETURNING i.id INTO changed;
  END IF;
  IF changed IS NULL THEN
    p_outcome:='manual_review';
    p_error_code:='item_missing_or_not_external';
  END IF;

  UPDATE public.pikete_jobs
     SET status=p_outcome,progress=CASE WHEN p_outcome='done' THEN 100 ELSE progress END,
         last_error_code=CASE WHEN p_outcome='done' THEN NULL ELSE NULLIF(btrim(p_error_code),'') END,
         leased_by=NULL,lease_until=NULL,updated_at=clock_timestamp()
   WHERE id=p_job_id;
  RETURN jsonb_build_object('ok',true,'job_id',p_job_id,
          'playlist_item_id',j.playlist_item_id,'outcome',p_outcome);
END;
$fn$;
REVOKE ALL ON FUNCTION public.pikete_enqueue_normalization() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pikete_queue_record_normalization(uuid,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pikete_queue_record_normalization(uuid,text,text,jsonb,text) TO service_role;
COMMIT;
