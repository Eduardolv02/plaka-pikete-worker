# PLAKA Pikete — Diagnóstico y reparación dirigida

**Fecha:** 23-10-2026  
**Ámbito:** Render B y Cloudflare B. **No** se modificaron Render A, Cloudflare A, Supabase A, Plaka Studio ni la APK.

## Evidencia de producción (lecturas de Supabase B y C)

- Supabase B: `Last One Standing` (Simple Plan) existe, `normalization_status=normalized`, `preparation_status=needs_confirmation`, `archive_status=none`, `youtube_search.status=not_configured`. Trabajo `normalize=done`, 1 intento.
- Supabase C: hay entradas con `not_configured` y dos registros con `archive_status=ready`. El estado `ready` en BD no equivale, por sí solo, a una comprobación de reproducción de Telegram en este diagnóstico.
- `not_configured` se genera expresamente en Render B 1.4.0 cuando `PIKETE_YTDLP_SEARCH_ENABLED` no es exactamente `true`. No se puede asegurar desde la cuenta Render conectada qué runtime, despliegue y variables tiene Render B; la cuenta conectada contiene Render A, no Render B.
- El Gateway B 1.9.1 que se facilitó anteriormente lanza normalización inmediata si la marca de entorno correspondiente está activa, pero su `scheduled()` no ejecutaba `POST /api/youtube/refresh-stale` para los trabajos ya normalizados. Por tanto, activar una bandera por sí sola no recuperaría esas canciones automáticamente.
- Código Render B de GitHub `Eduardolv02/plaka-pikete-worker` en rama `main` contenía `server.mjs` versión 1.4.0 y `src/youtube-refresh.mjs` con recuperación disponible pero no conectada al cron del Gateway.

## Archivos modificados

### Render B — repositorio completo, versión de diagnóstico 1.4.1

- `server.mjs`: añade identificación de configuración de búsqueda en `/health`, y presencia de las rutas binarias esperadas en Docker; nunca expone claves. Versión `pikete-render-b-1.4.1-discovery-recovery`.
- `src/youtube-refresh.mjs`: evita que la recuperación altere canciones ya confirmadas o que esté deshabilitada la búsqueda. Restringe actualizaciones a `preparation_status=needs_confirmation`; no toca entradas archivadas.
- `test/pikete-youtube-archive.test.mjs`: actualiza una fixture para reproducir el estado válido de recuperación.
- `tests/youtube-refresh-recovery.test.mjs`: pruebas de bloqueo de recuperación con búsqueda desactivada y preservación de confirmaciones previas.
- `tests/pikete-processor.test.mjs`: elimina un literal parecido a una credencial y lo sustituye por clave ficticia generada para tests.

### Cloudflare B — Gateway completo sobre el candidato 1.9.1 previamente entregado

- `worker.mjs`: versión `pikete-gateway-b-1.9.2-youtube-recovery`; conserva el disparo inmediato ya publicado y añade `scheduledYoutubeRefreshTick()` para recuperar canciones ya normalizadas cuando se habilite **explícitamente** `PIKETE_YOUTUBE_REFRESH_ENABLED=true`. El cron normal no deja de ejecutarse.
- `worker.mjs`: admite `PIKETE_RENDER_B_ORIGIN=https://<nombre>.onrender.com` si Render B Docker se publica con nuevo hostname; valida protocolo HTTPS y host `*.onrender.com` para evitar destinos arbitrarios. Valor por defecto conserva la URL antigua.
- `worker.mjs`: una confirmación puede solicitar de forma opt-in `POST /api/archive/youtube-item` exclusivamente con el ID de canción; Render verifica licencia/autorización individual y sube el audio únicamente si está autorizado. Respaldo mediante cron `POST /api/archive/youtube-sweep`. Ambas opciones están desactivadas por defecto.
- `tests/recovery-integration.test.mjs`: verifica que el disparo privado utilice el token y carga acotada, que orígenes inseguros sean rechazados, y que archivo automático respete su configuración cerrada.
- `tests/gateway.test.mjs`: actualiza la versión esperada en el health.

## Pruebas ejecutadas localmente

| Prueba | Resultado |
|---|---|
| `node --check server.mjs` (Render B) | Correcta |
| `npm test` (Render B) | **95/95** |
| `node --check worker.mjs` (Cloudflare B) | Correcta |
| `npm test` (Gateway B) | **84/84** |
| Integridad ZIP | Verificación de CRC en empaquetado |
| Credenciales | No se incluyen ficheros `.env`, claves reales ni tokens de Telegram |

**Sin confirmar en producción**: versión Docker realmente ejecutada en Render B, ejecución real de `yt-dlp`, respuesta de YouTube desde Render, acceso al nuevo `/health`, invocación del cron Cloudflare publicado, respuesta de candidatos de `Last One Standing`, derechos de audio descargable, archivado Telegram y reproducción en Android. Estas pruebas simuladas no equivalen a validación E2E.

## Orden seguro de despliegue

1. Respaldar las versiones reales desplegadas en Render B y Cloudflare B. Verificar que Render B corresponde a `plaka-pikete-worker` y su `/health` devuelve una versión relacionada con 1.4.x. No sobrescribir código más reciente ajeno al ZIP.
2. Crear/usar servicio **Docker** para Render B desde el repositorio completo si el servicio existente sigue en runtime Node. Docker debe instalar yt-dlp y FFmpeg. Mantener el servicio anterior hasta verificar el nuevo.
3. En Render B activar `PIKETE_YTDLP_SEARCH_ENABLED=true` y mantener claves y permisos de cola existentes. Confirmar `/health`: `discovery.search_enabled=true`, `discovery.docker_ytdlp_binary_detected=true`, `discovery.ffmpeg_binary_detected=true`; estos campos prueban bandera y existencia, no que YouTube funcione.
4. Tras comprobar Render B, desplegar el Worker completo B **comparándolo antes** con la versión publicada. Si cambió URL Render B, definir `PIKETE_RENDER_B_ORIGIN=https://servicio-real.onrender.com`. Conservar `PIKETE_RENDER_B_WORKER_KEY` configurado y consistente con `PIKETE_WORKER_KEY` privado de Render B.
5. Confirmar que el Worker B tiene Cron Triggers y variables `PIKETE_PROCESSOR_CRON_ENABLED=true`, `PIKETE_PROCESSOR_AUTOTRIGGER_ENABLED=true`, `PIKETE_YOUTUBE_REFRESH_ENABLED=true`. El cron solicita normalización y rescate de candidatos anteriores. Nunca poner las claves privadas en Android.
6. Consultar `/health` del Gateway: `pikete-gateway-b-1.9.2-youtube-recovery`; verificar logs sin errores `pikete_cron_refresh_failed`. Abrir Pikete y comprobar el paso `not_configured → candidates_for_review` (o un error técnico explícito), sin salir de la pantalla. Si la red bloquea YouTube, la respuesta puede ser `temporarily_unavailable`.
7. Para terminar archivando **audio**, se necesita fuente con licencia de descarga y redistribución. El módulo existente de Render solo admite grabaciones individualmente autorizadas por el operador (`PIKETE_APPROVED_YOUTUBE_VIDEO_IDS`, `PIKETE_YOUTUBE_INGEST_ENABLED=true`, `PIKETE_ARCHIVE_UPLOADS_ENABLED=true`). Únicamente en ese caso se pueden habilitar en Cloudflare B `PIKETE_LICENSED_ARCHIVE_AUTOTRIGGER_ENABLED=true` y `PIKETE_LICENSED_ARCHIVE_SWEEP_ENABLED=true`. Confirmar una coincidencia visual **no** constituye permiso; no habilitar extracción general. La aceptación del trabajo tampoco equivale a archivo listo: verificar `archive_status=ready` + referencia Telegram y reproducción.

## Recuperación y reversión

- No eliminar trabajos ni canciones ya existentes. El nuevo refresco conserva las entradas archivadas y confirmadas.
- Si las versiones publicadas eran posteriores, NO reemplazarlas sin comparar. Volver al código guardado si hay regresiones.
- Dejar `PIKETE_YOUTUBE_REFRESH_ENABLED=false` detiene solo las búsquedas de recuperación, no la normalización habitual de la cola.
- Toda mutación sobre los registros de Supabase B/C en producción requiere validación y no se ha realizado en este trabajo.
