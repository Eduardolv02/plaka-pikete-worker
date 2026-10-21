-- ACTIVATE ONLY AFTER Render B is on v0.7.0 and PIKETE_SUPABASE_A_SECRET_KEY is configured.
BEGIN;
CREATE OR REPLACE FUNCTION public.pikete_enqueue_catalog_match()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF NEW.source_type='external' AND NEW.normalization_status='normalized'
    AND (OLD.normalization_status IS DISTINCT FROM 'normalized') THEN
  INSERT INTO public.pikete_jobs(dedupe_key,playlist_item_id,job_type,status,priority)
    VALUES ('match:'||NEW.id::text, NEW.id,'match','queued',4)
  ON CONFLICT(dedupe_key) DO NOTHING;
 END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS pikete_items_enqueue_match_v1 ON public.pikete_playlist_items;
CREATE TRIGGER pikete_items_enqueue_match_v1
 AFTER UPDATE OF normalization_status ON public.pikete_playlist_items
 FOR EACH ROW EXECUTE FUNCTION public.pikete_enqueue_catalog_match();
-- Retry already-normalized external references, without modifying the audio or main catalog.
INSERT INTO public.pikete_jobs(dedupe_key,playlist_item_id,job_type,status,priority)
 SELECT 'match:'||i.id::text,i.id,'match','queued',4
 FROM public.pikete_playlist_items i
 WHERE i.source_type='external' AND i.normalization_status='normalized'
 ON CONFLICT(dedupe_key) DO NOTHING;
REVOKE ALL ON FUNCTION public.pikete_enqueue_catalog_match() FROM PUBLIC,anon,authenticated;
COMMIT;
