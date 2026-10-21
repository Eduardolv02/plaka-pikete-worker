/**
 * Supabase B/C authenticated REST API probe (read-only).
 * The secret key is sent ONLY through the apikey request header.
 * Only checks /rest/v1/; does not read rows or write any data.
 */
import { parseSupabaseProjectUrl } from './supabase-probe.mjs';

const DEFAULT_TIMEOUT_MS = 8000;

export function secretConfig(env = process.env) {
  return [
    {node: 'B', url: env.PIKETE_SUPABASE_B_URL || '', secret: env.PIKETE_SUPABASE_B_SECRET_KEY || ''},
    {node: 'C', url: env.PIKETE_SUPABASE_C_URL || '', secret: env.PIKETE_SUPABASE_C_SECRET_KEY || ''},
  ];
}

export async function checkAuthenticatedNode(node, rawUrl, rawSecret, options = {}) {
  const origin = parseSupabaseProjectUrl(rawUrl);
  if (!rawUrl || !rawSecret) return {node, state: 'not_configured'};
  if (!origin) return {node, state: 'invalid_url'};
  // The backend is designed for new Supabase secret keys, not JWTs/anon keys.
  if (typeof rawSecret !== 'string' || !/^sb_secret_[a-zA-Z0-9_-]{20,}$/.test(rawSecret)) {
    return {node, state: 'invalid_key_format'};
  }

  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  try {
    const response = await fetchImpl(`${origin}/rest/v1/`, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      headers: {
        apikey: rawSecret,
        Accept: 'application/openapi+json',
        'User-Agent': 'plaka-pikete-render-b/0.3.0',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // OpenAPI root is a metadata endpoint, never return its body to callers.
    if (response.body?.cancel) await response.body.cancel().catch(() => {});
    if (response.status === 200) return {node, state: 'authenticated_rest_api', http_status: 200};
    if (response.status === 401) return {node, state: 'unauthorized_key', http_status: 401};
    if (response.status === 403) return {node, state: 'forbidden', http_status: 403};
    if (response.status >= 300 && response.status < 400) return {node, state: 'unexpected_redirect', http_status: response.status};
    return {node, state: 'unexpected_http', http_status: response.status};
  } catch (error) {
    const state = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network_error';
    return {node, state};
  }
}

export async function checkAuthenticatedNodes(env = process.env, options = {}) {
  const checks = await Promise.all(secretConfig(env).map(({node, url, secret}) =>
    checkAuthenticatedNode(node, url, secret, options)));
  return {
    ok: checks.every(check => check.state === 'authenticated_rest_api'),
    checks,
    note: 'Verifica credenciales de la API REST; no prueba tablas, permisos por usuario ni colas.',
  };
}
