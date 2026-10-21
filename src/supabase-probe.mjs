/**
 * Read-only, on-demand connectivity probe for Supabase B and C.
 * Never exposes keys or project URLs in responses; never reads tables.
 */
const DEFAULT_TIMEOUT_MS = 6500;

export function parseSupabaseProjectUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const value = raw.trim();
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/' || url.search || url.hash ||
      !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}

export function supabaseConfig(env = process.env) {
  return [
    { node: 'B', url: env.PIKETE_SUPABASE_B_URL || '' },
    { node: 'C', url: env.PIKETE_SUPABASE_C_URL || '' },
  ];
}

export async function checkSupabaseNode(node, rawUrl, options = {}) {
  const origin = parseSupabaseProjectUrl(rawUrl);
  if (!rawUrl) return { node, state: 'not_configured' };
  if (!origin) return { node, state: 'invalid_configuration' };

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl || fetch;
  try {
    const response = await fetchImpl(`${origin}/auth/v1/health`, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      headers: { 'Accept': 'application/json', 'User-Agent': 'plaka-pikete-render-b/0.2.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 200 && response.status < 300) return { node, state: 'reachable', http_status: response.status };
    // 401/403 still prove network connectivity, but not service readiness.
    if (response.status === 401 || response.status === 403)
      return { node, state: 'reachable_auth_restricted', http_status: response.status };
    return { node, state: 'unexpected_http', http_status: response.status };
  } catch (e) {
    // Never return upstream request details or raw error messages.
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return { node, state: isTimeout ? 'timeout' : 'network_error' };
  }
}

export async function checkBothSupabaseNodes(env = process.env, options = {}) {
  const results = await Promise.all(supabaseConfig(env).map(({node, url}) =>
    checkSupabaseNode(node, url, options)));
  return {
    ok: results.every(r => r.state === 'reachable'),
    checks: results,
    note: 'Solo verifica conectividad de Supabase Auth. No consulta tablas, colas ni permisos.',
  };
}
