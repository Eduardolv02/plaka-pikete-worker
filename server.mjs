import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { normalizeMetadata } from './src/normalize.mjs';
import { checkBothSupabaseNodes } from './src/supabase-probe.mjs';

const port = Number(process.env.PORT || 10000);
const key = process.env.PIKETE_WORKER_KEY || '';
const version = 'pikete-render-b-0.2.0';
const maxBodyBytes = 8192;

function reply(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}
function isAuthorized(req) {
  if (!key || key.length < 32) return false;
  const auth = req.headers.authorization || '';
  const expected = `Bearer ${key}`;
  if (auth.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
}
function authorizeOrReply(req, res) {
  if (!key || key.length < 32) {
    reply(res, 503, {ok:false,code:'worker_key_not_configured'});
    return false;
  }
  if (!isAuthorized(req)) {
    reply(res, 401, {ok:false,code:'unauthorized'});
    return false;
  }
  return true;
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let len = 0;
    const parts = [];
    req.on('data', chunk => {
      len += chunk.length;
      if (len > maxBodyBytes) {
        reject(Object.assign(new Error('body_too_large'), { status: 413 }));
        req.destroy();
        return;
      }
      parts.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); }
      catch { reject(Object.assign(new Error('invalid_json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && (path === '/' || path === '/health')) {
      return reply(res, 200, {
        ok: true,
        service: 'plaka-pikete-render-b',
        version,
        mode: 'supabase-connectivity',
        note: 'Supabase B/C: comprobacion de conectividad bajo autenticacion. Sin colas activas.'
      });
    }
    if (req.method === 'GET' && path === '/api/supabase/check') {
      if (!authorizeOrReply(req, res)) return;
      const result = await checkBothSupabaseNodes();
      return reply(res, result.ok ? 200 : 503, result);
    }
    if (req.method === 'POST' && path === '/api/normalize') {
      if (!authorizeOrReply(req, res)) return;
      const body = await readJson(req);
      const result = normalizeMetadata(body);
      return reply(res, result.ok ? 200 : 400, result);
    }
    return reply(res, 404, {ok:false,code:'not_found'});
  } catch (err) {
    if (err?.status === 400 || err?.status === 413) return reply(res, err.status, {ok:false,code:err.message});
    console.error('request_failed', err?.name || 'unexpected');
    if (!res.headersSent && !res.destroyed) reply(res, 500, {ok:false,code:'internal_error'});
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, '0.0.0.0', () => console.log(`${version} listening on ${port}`));
