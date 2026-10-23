# PLAKA · Pikete — reparación dirigida, 23 octubre 2026

## Alcance
Solo Render B y Cloudflare Gateway B. No toca Plaka Studio, Render A, Cloudflare A, Supabase A ni datos de usuario.

## Comprobaciones demostradas
- Supabase B: `Last One Standing` fue normalizada y terminó con `normalized_metadata.youtube_search.status=not_configured`.
- El código de Render B 1.4.0 devuelve `not_configured` si falta `PIKETE_YTDLP_SEARCH_ENABLED=true`.
- La normalización marcada `done` **no se repite automáticamente**; el código de Render B dispone de recuperación `POST /api/youtube/refresh-stale` pero Gateway B 1.9.1 no la llamaba en su cron.
- La búsqueda de candidatos no garantiza derechos ni es una subida de audio. La preparación autorizada exige permiso verificado y almacenamiento Telegram real.

## Despliegue controlado (sin cambios automáticos de producción)
1. Respaldar el Worker B publicado y configuración; verificar `/health` del Render B REAL y del Gateway B REAL. Confirmar origen, rama y commit.
2. Verificar que Render B use `Dockerfile` (Docker runtime) y que yt-dlp/ffmpeg estén instalados en ese contenedor. Solo después desplegar `render_b/` al repositorio Render B. Si continúa en Node runtime, el Dockerfile no se ejecuta; configurar Docker en un servicio compatible sin apagar el antiguo hasta validar rutas.
3. En Render B, poner `PIKETE_YTDLP_SEARCH_ENABLED=true`. Mantener `PIKETE_PROCESSOR_ENABLED=true` y `PIKETE_QUEUE_MUTATIONS_ENABLED=true` según arquitectura existente. No publicar secretos.
4. Verificar `/health` de Render B nuevo: versión `pikete-render-b-1.4.1-discovery-recovery`, `discovery.search_enabled=true` (declara configuración, no valida una búsqueda en red). Ejecutar una búsqueda autorizada de **metadatos** a través de un endpoint privado y observar el resultado real.
5. En Cloudflare B, sustituir solamente el Worker B (copia previa obligatoria). Si el servicio Docker nuevo tiene URL distinta, establecer `PIKETE_RENDER_B_ORIGIN=https://nombre-real.onrender.com`; por defecto mantiene la URL anterior. Conservar secreto `PIKETE_RENDER_B_WORKER_KEY` existente. Confirmar que coincida con `PIKETE_WORKER_KEY` de Render B.
6. En Cloudflare B activar `PIKETE_PROCESSOR_CRON_ENABLED=true`, `PIKETE_PROCESSOR_AUTOTRIGGER_ENABLED=true`, `PIKETE_YOUTUBE_REFRESH_ENABLED=true`. Mantener trigger Cron activo cada ~10 min; no se crean registros duplicados, se buscan pendientes ya normalizados. El cron llama por separado a `process-once` y `refresh-stale`.
7. Después de ejecutar el cron, abrir Pikete: la app existente recarga periódicamente. Verificar que el viejo `not_configured` pasa a `candidates_for_review` o error explícito; confirmar canción y verificar derechos de fuente **antes** de archivar.
8. Archivo: esta versión NO archiva YouTube automáticamente tras confirmación; el servidor solo archiva IDs individualmente autorizados y con las opciones correspondientes. Nunca habilitar descargas indiscriminadas.

## Opcional: archivado de grabaciones expresamente autorizadas

La confirmación del candidato no otorga permiso de descarga ni redistribución. Para una grabación **verificada y autorizada** se puede configurar la allowlist de Render B `PIKETE_APPROVED_YOUTUBE_VIDEO_IDS` y activar `PIKETE_YOUTUBE_INGEST_ENABLED=true`, `PIKETE_ARCHIVE_UPLOADS_ENABLED=true`; solo entonces habilitar en Cloudflare B `PIKETE_LICENSED_ARCHIVE_AUTOTRIGGER_ENABLED=true` (intento al confirmar) y `PIKETE_LICENSED_ARCHIVE_SWEEP_ENABLED=true` (reintento periódico de los autorizados). Si no se dispone de autorización, dejar ambos en falso. Telegram debe devolver un archivo y Supabase registrar el SHA-256 antes de marcarlo reproducible.

## Validación y limitaciones
- `npm test` y `node --check` de los directorios completos.
- Pruebas mock: no prueban yt-dlp en contenedor Docker ni Telegram real.
- No se ha podido leer Render B en la cuenta Render conectada. No afirmar que su servicio está actualizado ni que la búsqueda funciona en producción hasta verificarlo.
- El ZIP de Cloudflare es candidato sobre B 1.9.1; si el Worker publicado evolucionó respecto de esa versión, hacer diff antes del reemplazo.
