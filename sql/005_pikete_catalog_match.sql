-- FASE 1.4: Private, additive RPC + dedup, no public grants and no changes in Supabase A.
-- Install this on BOTH B and C BEFORE deploying Render v0.7.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS pikete_unique_catalog_track_per_list
  ON public.pikete_playlist_items(playlist_id, source_ref)
  WHERE source_type='plaka' AND source_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.pikete_queue_record_match(
 p_job_id uuid, p_worker text, p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE j public.pikete_jobs%ROWTYPE;
DECLARE changed uuid;
BEGIN
 IF p_job_id IS NULL OR p_worker IS NULL OR length(btrim(p_worker)) NOT BETWEEN 3 AND 80
    OR p_result IS NULL OR jsonb_typeof(p_result)<>'object'
    OR pg_catalog.octet_length(p_result::text)>9000
 THEN RAISE EXCEPTION 'invalid_match_result' USING ERRCODE='22023'; END IF;
 SELECT * INTO j FROM public.pikete_jobs
  WHERE id=p_job_id AND job_type='match' AND status='leased'
  AND leased_by=p_worker AND lease_until>clock_timestamp()
  FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_current_lease'); END IF;
 IF j.playlist_item_id IS NOT NULL THEN
  UPDATE public.pikete_playlist_items i SET
   normalized_metadata=jsonb_set(coalesce(i.normalized_metadata,'{}'::jsonb),'{catalog_match}',p_result,true),
   updated_at=clock_timestamp()
  WHERE i.id=j.playlist_item_id AND i.source_type='external'
    AND i.normalization_status='normalized' AND i.state<>'ready'
  RETURNING i.id INTO changed;
 END IF;
 UPDATE public.pikete_jobs SET
  status=CASE WHEN changed IS NULL THEN 'manual_review' ELSE 'done' END,
  progress=CASE WHEN changed IS NULL THEN progress ELSE 100 END,
  last_error_code=CASE WHEN changed IS NULL THEN 'matching_item_missing' ELSE NULL END,
  leased_by=NULL,lease_until=NULL,updated_at=clock_timestamp()
 WHERE id=p_job_id;
 RETURN jsonb_build_object('ok',true,'outcome',CASE WHEN changed IS NULL THEN 'manual_review' ELSE 'done' END,'item_id',changed);
END;
$fn$;
REVOKE ALL ON FUNCTION public.pikete_queue_record_match(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pikete_queue_record_match(uuid,text,jsonb) TO service_role;
COMMIT;
