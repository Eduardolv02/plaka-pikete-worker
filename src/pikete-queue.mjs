/**
 * Pikete B/C SQL queue RPC client. No automatic polling or music processing.
 * Uses only the existing Supabase secret API key in the `apikey` header.
 */
import { parseSupabaseProjectUrl } from './supabase-probe.mjs';
import { secretConfig } from './supabase-authenticated.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_RE = /^sb_secret_[a-zA-Z0-9_-]{20,}$/;

export class QueueError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

function intBetween(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}
function workerOk(v) {
  return typeof v === 'string' && v.trim().length >= 3 && v.trim().length <= 80;
}
export function getNodeConfig(node, env = process.env) {
  if (node !== 'B' && node !== 'C') throw new QueueError('invalid_node');
  const {url, secret} = secretConfig(env).find(v => v.node === node);
  const origin = parseSupabaseProjectUrl(url);
  if (!origin || !SECRET_RE.test(secret)) throw new QueueError('node_not_configured', 503);
  return {origin, secret};
}

export function requireMutationsEnabled(env = process.env) {
  if (env.PIKETE_QUEUE_MUTATIONS_ENABLED !== 'true')
    throw new QueueError('queue_mutations_disabled', 403);
}

export async function callQueueRpc(node, functionName, payload, options = {}) {
  if (!['pikete_queue_status', 'pikete_queue_claim', 'pikete_queue_finish', 'pikete_queue_heartbeat', 'pikete_queue_record_normalization'].includes(functionName))
    throw new QueueError('unknown_queue_rpc');
  const {origin, secret} = getNodeConfig(node, options.env);
  const fetchImpl = options.fetchImpl || fetch;
  let response;
  try {
    response = await fetchImpl(`${origin}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      redirect: 'manual',
      cache: 'no-store',
      headers: {
        apikey: secret,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'plaka-pikete-render-b/0.5.0',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new QueueError('queue_timeout', 504);
    throw new QueueError('queue_network_error', 502);
  }
  if (response.status !== 200 && response.status !== 201 && response.status !== 204)
    throw new QueueError(response.status === 401 || response.status === 403 ? 'queue_supabase_unauthorized' : 'queue_supabase_http_error', 502);
  try { return response.status === 204 ? null : await response.json(); }
  catch { throw new QueueError('queue_invalid_response', 502); }
}

export async function getQueueSummary(options = {}) {
  const checks = await Promise.all(['B', 'C'].map(async node => {
    try {
      const counts = await callQueueRpc(node, 'pikete_queue_status', {}, options);
      if (!counts || typeof counts !== 'object' || !Number.isInteger(counts.total))
        return {node, state:'invalid_response'};
      return {node, state:'ready', counts};
    } catch (e) {
      return {node, state: e instanceof QueueError ? e.code : 'unexpected_error'};
    }
  }));
  return {ok: checks.every(v => v.state === 'ready'), checks, polling: 'disabled'};
}

export async function claimQueueJobs(body, options = {}) {
  requireMutationsEnabled(options.env);
  if (!body || typeof body !== 'object' || !workerOk(body.worker) || !intBetween(body.limit ?? 1, 1, 10) || !intBetween(body.lease_seconds ?? 120, 30, 900))
    throw new QueueError('invalid_claim_arguments');
  const jobs = await callQueueRpc(body.node, 'pikete_queue_claim', {
    p_worker: body.worker,
    p_batch_size: body.limit ?? 1,
    p_lease_seconds: body.lease_seconds ?? 120,
  }, options);
  if (!Array.isArray(jobs)) throw new QueueError('queue_invalid_response', 502);
  return {ok: true, node: body.node, count: jobs.length, jobs};
}

export async function heartbeatQueueJob(body, options = {}) {
  requireMutationsEnabled(options.env);
  if (!body || !UUID_RE.test(body.job_id || '') || !workerOk(body.worker) ||
      !intBetween(body.progress ?? 0, 0, 99) || !intBetween(body.lease_seconds ?? 120, 30, 900))
    throw new QueueError('invalid_heartbeat_arguments');
  const jobs = await callQueueRpc(body.node, 'pikete_queue_heartbeat', {
    p_job_id: body.job_id,
    p_worker: body.worker,
    p_progress: body.progress ?? 0,
    p_lease_seconds: body.lease_seconds ?? 120,
  }, options);
  if (!Array.isArray(jobs)) throw new QueueError('queue_invalid_response', 502);
  return {ok: jobs.length === 1, node: body.node, changed: jobs.length};
}

export async function finishQueueJob(body, options = {}) {
  requireMutationsEnabled(options.env);
  if (!body || !UUID_RE.test(body.job_id || '') || !workerOk(body.worker) ||
      !['done','retry','failed','manual_review'].includes(body.outcome) ||
      !intBetween(body.retry_seconds ?? 30, 1, 3600) ||
      (body.error_code != null && (typeof body.error_code !== 'string' || body.error_code.length > 120)))
    throw new QueueError('invalid_finish_arguments');
  const jobs = await callQueueRpc(body.node, 'pikete_queue_finish', {
    p_job_id: body.job_id,
    p_worker: body.worker,
    p_outcome: body.outcome,
    p_error_code: body.error_code ?? null,
    p_retry_seconds: body.retry_seconds ?? 30,
  }, options);
  if (!Array.isArray(jobs)) throw new QueueError('queue_invalid_response', 502);
  return {ok: jobs.length === 1, node: body.node, changed: jobs.length, status: jobs[0]?.status ?? null};
}
