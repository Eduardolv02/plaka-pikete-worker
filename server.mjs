import http from 'node:http';
import {probeYtDlpBinary} from './src/ytdlp-probe.mjs';
import { existsSync } from 'node:fs';
import { selectYtDlpBinary, NODE_BIN } from './src/ytdlp-path.mjs';
import { ensureYtDlpInstalled } from './scripts/install-ytdlp.mjs';
import { createYtDlpBootstrap } from './src/ytdlp-bootstrap.mjs';
import { isPrivateTestGrantActive } from './src/test-grant.mjs';
import { timingSafeEqual } from 'node:crypto';
import { normalizeMetadata } from './src/normalize.mjs';
import { inspectRecording } from './src/normalization-service.mjs';
import { enqueueYoutubeItem, sweepYoutubeItems, youtubeJobStatus } from './src/youtube-archive.mjs';
import { refreshYoutubeItem, enqueueYoutubeRefreshSweep } from './src/youtube-refresh.mjs';
import { searchCatalog, getCatalogTrack } from './src/plaka-catalog.mjs';
import { processQueueTick } from './src/pikete-processor.mjs';
import { ingestOwnerAudio, MAX_AUDIO_BYTES } from './src/telegram-archive.mjs';
import { ingestApprovedSource } from './src/approved-source.mjs';
import { prepareLicensedItem, sweepLicensedItems } from './src/studio-auto-archive.mjs';
import { checkBothSupabaseNodes } from './src/supabase-probe.mjs';
import { checkAuthenticatedNodes } from './src/supabase-authenticated.mjs';
import { QueueError, getQueueSummary, claimQueueJobs, heartbeatQueueJob, finishQueueJob } from './src/pikete-queue.mjs';

const port = Number(process.env.PORT || 10000);
const key = process.env.PIKETE_WORKER_KEY || '';
const version = 'pikete-render-b-1.4.7-shared-qa-grant';
const maxBodyBytes = 8192;
async function ytDlpProbeStatus(){
  let cmd;
  try{cmd=selectYtDlpBinary();}
  catch{return {ok:false,code:'yt_dlp_binary_missing'};}
  return probeYtDlpBinary(cmd);
}
async function installYtDlpIfMissing(){
  // Reuse a valid Node PATH executable. Do not require Docker or new env vars.
  if((await ytDlpProbeStatus()).ok)return {installed:false,source:'existing_path'};
  return ensureYtDlpInstalled();
}

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
      // Never run a blocking 38MB PyInstaller binary inside a health request.
      const verified = bootstrap.state.status === 'ready';
      return reply(res, 200, {
        ok: true,
        service: 'plaka-pikete-render-b',
        version,
        mode: 'queue-priority-ytdlp-search-licensed-telegram-archive',
        youtube_discovery: 'yt-dlp',
        discovery: {
          search_enabled: process.env.PIKETE_YTDLP_SEARCH_ENABLED === 'true',
          docker_ytdlp_binary_detected: verified,
          ytdlp_binary_detected: verified,
          ytdlp_installation: existsSync(NODE_BIN) ? 'node_local' : 'external_or_missing',
          bootstrap: bootstrap.state.status,
          bootstrap_error_code: bootstrap.state.code,
          bootstrap_retry_attempts: bootstrap.state.attempts,
          bootstrap_last_success_at: bootstrap.state.last_success_at,
          ffmpeg_binary_detected: existsSync('/usr/bin/ffmpeg'),
          processor_enabled: process.env.PIKETE_PROCESSOR_ENABLED === 'true',
          queue_mutations_enabled: process.env.PIKETE_QUEUE_MUTATIONS_ENABLED === 'true',
          youtube_ingest_enabled: process.env.PIKETE_YOUTUBE_INGEST_ENABLED === 'true',
          archive_uploads_enabled: process.env.PIKETE_ARCHIVE_UPLOADS_ENABLED === 'true',
          private_test_grant_active: isPrivateTestGrantActive()
        },
        youtube_archive_policy: isPrivateTestGrantActive() ? 'shared_private_qa_grant' : 'operator_allowlist',
        note: 'Normaliza por pista, compara candidatos de YouTube, busca archivo indexado B/C y prioriza cuenta verificada.'
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
    if (req.method === 'POST' && path === '/api/youtube/refresh-item') {
      if (!authorizeOrReply(req,res)) return;
      const body=await readJson(req);
      const result=await refreshYoutubeItem(body);
      return reply(res,200,result);
    }
    if (req.method === 'POST' && path === '/api/youtube/refresh-stale') {
      if (!authorizeOrReply(req,res)) return;
      const body=await readJson(req);
      const result=enqueueYoutubeRefreshSweep(body);
      return reply(res,200,result);
    }
    if (req.method === 'POST' && path === '/api/archive/youtube-item') {
      if (!authorizeOrReply(req,res)) return;
      const body=await readJson(req);
      const result=await enqueueYoutubeItem(body);
      return reply(res,result.status==='processing'?202:200,result);
    }
    if (req.method === 'POST' && path === '/api/archive/youtube-sweep') {
      if (!authorizeOrReply(req,res)) return;
      const body=await readJson(req);
      const result=await sweepYoutubeItems(body);
      return reply(res,200,result);
    }
    if (req.method === 'GET' && path === '/api/archive/youtube-status') {
      if (!authorizeOrReply(req,res)) return;
      const p=new URL(req.url,'http://localhost').searchParams;
      return reply(res,200,youtubeJobStatus(p.get('node'),p.get('item_id')));
    }
    if (req.method === 'POST' && path === '/api/archive/auto-item') {
      if (!authorizeOrReply(req,res)) return;
      const data=await readJson(req);
      return reply(res,200,await prepareLicensedItem(data));
    }
    if (req.method === 'POST' && path === '/api/archive/auto-sweep') {
      if (!authorizeOrReply(req,res)) return;
      const data=await readJson(req);
      return reply(res,200,await sweepLicensedItems(data));
    }
    if (req.method === 'POST' && path === '/api/archive/ingest-approved-source') {
      if (!authorizeOrReply(req, res)) return;
      const body = await readJson(req);
      const result = await ingestApprovedSource(body);
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
// Preserve both existing Render Node entrypoints (`node server.mjs`, `npm start`).
// Install the official pinned executable without extra Render env/build commands.
// If GitHub or the server network is transiently unavailable, retry while running.
// Every already-confirmed QA item is recovered without a new Android action.
// Limited sweeps and in-flight dedupe prevent concurrent repeated downloads.
let qaSweepBusy = false;
async function recoverTestArchives() {
  if (!isPrivateTestGrantActive() || qaSweepBusy || bootstrap.state.status !== 'ready') return;
  qaSweepBusy = true;
  try {
    const run = await sweepYoutubeItems({node:'both',limit:2});
    if (run.results.length) console.info('[pikete] qa_archive_sweep',run.results.map(x => ({node:x.node,status:x.status,code:x.code})));
  } catch (e) {
    console.warn('[pikete] qa_archive_sweep_failed',e?.code||'unavailable');
  } finally {qaSweepBusy = false;}
}
function triggerStaleSearch() {
  try { enqueueYoutubeRefreshSweep({node:'both',limit:2}); }
  catch(e) { console.error('[pikete] youtube_refresh_launch_failed',e?.code||'unexpected'); }
}
const bootstrap=createYtDlpBootstrap({
  install:installYtDlpIfMissing,
  isAvailable:ytDlpProbeStatus,
  enabled:()=>process.env.PIKETE_YTDLP_SEARCH_ENABLED==='true',
  refresh:triggerStaleSearch,
  onReady:()=>{
    console.log('[pikete] yt-dlp installed and executable; refreshing stale Pikete matches');
    setImmediate(()=>void recoverTestArchives());
  },
  onFailure:(code)=>console.error('[pikete] yt-dlp bootstrap/recovery:',code),
});
// Best-effort recovery while awake; after a Render sleep the startup sweep
// picks up pending songs again. Cloudflare's existing triggers remain valid.
const qaTimer = setInterval(()=>void recoverTestArchives(),120_000);
qaTimer.unref();
server.listen(port, '0.0.0.0', () => {
  console.log(`${version} listening on ${port}`);
  setImmediate(()=>void bootstrap.run());
});
