import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { normalizeMetadata } from './src/normalize.mjs';
import { inspectRecording } from './src/normalization-service.mjs';
import { searchCatalog, getCatalogTrack } from './src/plaka-catalog.mjs';
import { processQueueTick } from './src/pikete-processor.mjs';
import { ingestOwnerAudio, MAX_AUDIO_BYTES } from './src/telegram-archive.mjs';
import { checkBothSupabaseNodes } from './src/supabase-probe.mjs';
import { checkAuthenticatedNodes } from './src/supabase-authenticated.mjs';
import { QueueError, getQueueSummary, claimQueueJobs, heartbeatQueueJob, finishQueueJob } from './src/pikete-queue.mjs';

const port = Number(process.env.PORT || 10000);
const key = process.env.PIKETE_WORKER_KEY || '';
const version = 'pikete-render-b-0.9.0';
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
        mode: 'owner-audio-telegram-archive',
        note: 'Solo propietarios administran pistas; YouTube como busqueda de metadatos; archivo de audios autorizados mediante bots Telegram.'
      });
    }
    if (req.method === 'GET' && path === '/api/supabase/check') {
      if (!authorizeOrReply(req, res)) return;
      const result = await checkAuthenticatedNodes();
      return reply(res, result.ok ? 200 : 503, result);
    }
    if (req.method === 'GET' && path === '/api/supabase/network') {
      if (!authorizeOrReply(req, res)) return;
      const result = await checkBothSupabaseNodes();
      const reachable = result.checks.every(x => x.state === 'reachable' || x.state === 'reachable_auth_restricted');
      return reply(res, reachable ? 200 : 503, {...result, ok:reachable});
    }
    if (req.method === 'GET' && path === '/api/queue/status') {
      if (!authorizeOrReply(req, res)) return;
      const result = await getQueueSummary();
      return reply(res, result.ok ? 200 : 503, result);
    }
    const queueActions = {
      '/api/queue/claim': claimQueueJobs,
      '/api/queue/heartbeat': heartbeatQueueJob,
      '/api/queue/finish': finishQueueJob,
    };
    if (req.method === 'POST' && Object.hasOwn(queueActions, path)) {
      if (!authorizeOrReply(req, res)) return;
      const body = await readJson(req);
      const result = await queueActions[path](body);
      return reply(res, 200, result);
    }
    if (req.method === 'POST' && path === '/api/archive/ingest') {
      if (!authorizeOrReply(req, res)) return;
      if (req.headers['x-pikete-rights-confirm'] !== 'true')
        return reply(res, 403, {ok:false,code:'archive_rights_confirmation_required'});
      const contentType=(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
      const length=Number(req.headers['x-pikete-audio-length']||req.headers['content-length']||0);
      if(!Number.isInteger(length)||length<512||length>MAX_AUDIO_BYTES)
        return reply(res,413,{ok:false,code:'invalid_archive_audio_size'});
      const result=await ingestOwnerAudio({
        node:req.headers['x-pikete-node'],
        playlistId:req.headers['x-pikete-playlist-id'],
        itemId:req.headers['x-pikete-item-id'],
        ownerId:req.headers['x-pikete-owner-user-id'],
        mime:contentType,length,stream:req
      });
      return reply(res,200,result);
    }
    if (req.method === 'POST' && path === '/api/queue/process-once') {
      if (!authorizeOrReply(req, res)) return;
      const body = await readJson(req);
      const result = await processQueueTick(body);
      return reply(res, 200, result);
    }
    if (req.method === 'POST' && path === '/api/catalog/search') {
      if (!authorizeOrReply(req, res)) return;
      const body = await readJson(req);
      return reply(res, 200, await searchCatalog(body));
    }
    if (req.method === 'POST' && path === '/api/catalog/track') {
      if (!authorizeOrReply(req, res)) return;
      const body = await readJson(req);
      const result = await getCatalogTrack(body?.track_id);
      return reply(res, result.ok ? 200 : 404, result);
    }
    if (req.method === 'POST' && path === '/api/normalize/inspect') {
      if (!authorizeOrReply(req, res)) return;
      const body = await readJson(req);
      const result = await inspectRecording(body);
      return reply(res, result.ok ? 200 : 400, result);
    }
    if (req.method === 'POST' && path === '/api/normalize') {
      if (!authorizeOrReply(req, res)) return;
      const body = await readJson(req);
      const result = normalizeMetadata(body);
      return reply(res, result.ok ? 200 : 400, result);
    }
    return reply(res, 404, {ok:false,code:'not_found'});
  } catch (err) {
    if (err instanceof QueueError) return reply(res, err.status, {ok:false,code:err.code});
    if (err?.status === 400 || err?.status === 413) return reply(res, err.status, {ok:false,code:err.message});
    console.error('request_failed', err?.name || 'unexpected');
    if (!res.headersSent && !res.destroyed) reply(res, 500, {ok:false,code:'internal_error'});
  }
});
server.requestTimeout = 120000;
server.headersTimeout = 10000;
server.listen(port, '0.0.0.0', () => console.log(`${version} listening on ${port}`));
