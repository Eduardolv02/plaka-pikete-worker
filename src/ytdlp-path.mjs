/** Resolve ONLY vetted server-side yt-dlp executables. Never a user-provided path. */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const NODE_BIN = fileURLToPath(new URL('../bin/yt-dlp', import.meta.url));
export const DOCKER_BIN = '/app/.venv/bin/yt-dlp';
export function selectYtDlpBinary(env = process.env) {
  const requested = env.PIKETE_YTDLP_BIN || 'yt-dlp';
  // A previously configured Windows/Node path cannot override the verified local binary.
  if (existsSync(NODE_BIN)) return NODE_BIN;
  if (!['yt-dlp', DOCKER_BIN].includes(requested)) {
    const error = new Error('ytdlp_binary_not_allowed');
    error.code = 'ytdlp_binary_not_allowed';
    throw error;
  }
  // The Node build's local pinned binary wins over a stale Docker path from an old env.
  if (requested === DOCKER_BIN && existsSync(DOCKER_BIN)) return DOCKER_BIN;
  // An obsolete Docker path in Render's existing environment must not mask
  // a working Node PATH executable. The verified Node-local asset still wins.
  return 'yt-dlp';
}
