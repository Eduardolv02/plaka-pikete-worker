-- PLAKA / PIKETE | Fase 4 | Ejecutar por separado en Supabase B y C.
-- No modifica registros, no altera tablas: define RPCs privadas de cola.
-- Las RPC operan SOLO con los privilegios del invocador (SECURITY INVOKER).
BEGIN;

CREATE OR REPLACE FUNCTION public.pikete_queue_status()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $fn$
  SELECT jsonb_build_object(
    'total', count(*),
    'queued', count(*) FILTER (WHERE status = 'queued'),
    'retry', count(*) FILTER (WHERE status = 'retry'),
    'leased', count(*) FILTER (WHERE status = 'leased'),
    'done', count(*) FILTER (WHERE status = 'done'),
    'failed', count(*) FILTER (WHERE status = 'failed'),
    'manual_review', count(*) FILTER (WHERE status = 'manual_review'),
    'expired_leases', count(*) FILTER (WHERE status = 'leased' AND lease_until <= now()),
    'runnable', count(*) FILTER (WHERE status IN ('queued','retry') AND available_at <= now() AND attempts < max_attempts)
  )
  FROM public.pikete_jobs;
$fn$;

CREATE OR REPLACE FUNCTION public.pikete_queue_claim(
  p_worker text,
  p_batch_size integer DEFAULT 1,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF public.pikete_jobs
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $fn$
BEGIN
  IF p_worker IS NULL OR char_length(btrim(p_worker)) NOT BETWEEN 3 AND 80
     OR p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 10
     OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'invalid_queue_claim_arguments' USING ERRCODE = '22023';
  END IF;

  -- Las reservas vencidas que agotaron intentos se marcan como fallidas.
  UPDATE public.pikete_jobs
     SET status = 'failed', leased_by = NULL, lease_until = NULL,
         last_error_code = 'max_attempts_exhausted', updated_at = clock_timestamp()
   WHERE status = 'leased'
     AND lease_until <= clock_timestamp()
     AND attempts >= max_attempts;

  RETURN QUERY
  WITH picked AS (
    SELECT j.id
      FROM public.pikete_jobs AS j
     WHERE (
       (j.status IN ('queued','retry') AND j.available_at <= clock_timestamp())
       OR (j.status = 'leased' AND j.lease_until <= clock_timestamp())
     )
       AND j.attempts < j.max_attempts
     ORDER BY j.priority DESC, j.available_at ASC, j.created_at ASC, j.id ASC
     LIMIT p_batch_size
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.pikete_jobs AS j
     SET status = 'leased',
         attempts = j.attempts + 1,
         leased_by = p_worker,
         lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
         progress = 0,
         updated_at = clock_timestamp()
    FROM picked
   WHERE j.id = picked.id
  RETURNING j.*;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.pikete_queue_heartbeat(
  p_job_id uuid,
  p_worker text,
  p_progress integer DEFAULT 0,
  p_lease_seconds integer DEFAULT 120
)
RETURNS SETOF public.pikete_jobs
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $fn$
BEGIN
  IF p_job_id IS NULL OR p_worker IS NULL
     OR char_length(btrim(p_worker)) NOT BETWEEN 3 AND 80
     OR p_progress IS NULL OR p_progress NOT BETWEEN 0 AND 99
     OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'invalid_queue_heartbeat_arguments' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  UPDATE public.pikete_jobs AS j
     SET progress = p_progress,
         lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
         updated_at = clock_timestamp()
   WHERE j.id = p_job_id AND j.status = 'leased'
     AND j.leased_by = p_worker AND j.lease_until > clock_timestamp()
  RETURNING j.*;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.pikete_queue_finish(
  p_job_id uuid,
  p_worker text,
  p_outcome text,
  p_error_code text DEFAULT NULL,
  p_retry_seconds integer DEFAULT 30
)
RETURNS SETOF public.pikete_jobs
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $fn$
BEGIN
  IF p_job_id IS NULL OR p_worker IS NULL
     OR char_length(btrim(p_worker)) NOT BETWEEN 3 AND 80
     OR p_outcome NOT IN ('done','retry','failed','manual_review')
     OR p_outcome IS NULL
     OR p_retry_seconds IS NULL OR p_retry_seconds NOT BETWEEN 1 AND 3600
     OR char_length(coalesce(p_error_code,'')) > 120 THEN
    RAISE EXCEPTION 'invalid_queue_finish_arguments' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  UPDATE public.pikete_jobs AS j
     SET status = CASE WHEN p_outcome = 'retry' AND j.attempts >= j.max_attempts
                          THEN 'failed' ELSE p_outcome END,
         available_at = CASE WHEN p_outcome = 'retry'
                             THEN clock_timestamp() + make_interval(secs => p_retry_seconds)
                             ELSE j.available_at END,
         progress = CASE WHEN p_outcome = 'done' THEN 100 ELSE j.progress END,
         last_error_code = CASE WHEN p_outcome = 'done' THEN NULL
                               WHEN p_outcome = 'retry' AND j.attempts >= j.max_attempts THEN 'max_attempts_exhausted'
                               ELSE NULLIF(btrim(p_error_code), '') END,
         leased_by = NULL,
         lease_until = NULL,
         updated_at = clock_timestamp()
   WHERE j.id = p_job_id AND j.status = 'leased'
     AND j.leased_by = p_worker AND j.lease_until > clock_timestamp()
  RETURNING j.*;
END;
$fn$;

-- PostgreSQL concede EXECUTE a PUBLIC por defecto; anularlo explícitamente.
REVOKE ALL ON FUNCTION public.pikete_queue_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pikete_queue_claim(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pikete_queue_heartbeat(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pikete_queue_finish(uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pikete_queue_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.pikete_queue_claim(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pikete_queue_heartbeat(uuid, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pikete_queue_finish(uuid, text, text, text, integer) TO service_role;
COMMIT;
