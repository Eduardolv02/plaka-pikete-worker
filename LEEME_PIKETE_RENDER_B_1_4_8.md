# PLAKA PIKETE — Render B 1.4.8: EJS/Node + diagnóstico de extracción

## Qué ocurrió en tu Render B 1.4.7

El arranque e instalación de `yt-dlp` funcionaron y los barridos encontraron a «Tormenta». Los registros indicaron:

    [pikete] qa_archive_sweep [ { node: 'B', status: 'processing' } ]
    licensed_youtube_archive_failed B ytdlp_execution_failed

Ese código anterior ocultaba el error real. La búsqueda (`ytsearch`) y la descarga de un vídeo completo son operaciones distintas; que una funcione no prueba que la otra vaya a funcionar.

## Cambios concretos

1. `src/ytdlp-runner.mjs`: activa `--js-runtimes node`, compatible con el runtime Node de Render y los ejecutables oficiales de `yt-dlp` que incluyen EJS. No instala Python ni Deno. Habilita esa opción tanto para metadatos como para extracción.
2. El ejecutor clasifica **internamente** una cola limitada de stderr (sin imprimir datos potencialmente privados), emitiendo códigos conocidos: `ytdlp_js_challenge`, `ytdlp_auth_required`, `ytdlp_http_403`, `ytdlp_rate_limited`, `ytdlp_formats_unavailable`, `ytdlp_video_unavailable`, `ytdlp_region_restricted`, `ytdlp_network_error` o `ytdlp_execution_failed`.
3. `src/youtube-archive.mjs`: identifica la fase exacta del fallo: `metadata`, `download`, `convert`, `telegram`. El endpoint autenticado `/api/archive/youtube-status?node=B&item_id=...` devuelve `status`, `code` y `phase`.
4. `server.mjs`: muestra los códigos diagnósticos en el barrido de QA, sin exponer tokens ni enlaces internos. Conserva cola, Telegram, Supabase B/C, QA, búsqueda y persistencia de `file_id`.
5. Añadidas pruebas de regresión para EJS/Node, errores 403/429, autenticación, formato, etapa y privacidad de los logs.

## Instalación manual

Descomprime el ZIP **como raíz del repositorio** `Eduardolv02/plaka-pikete-worker`, reemplaza archivos, haz commit/push. Conserva tu servicio de Render en **Node**, las variables actuales y los comandos existentes. No actualices Android ni Cloudflare.

Abre `/health`; debe decir `pikete-render-b-1.4.8-js-runtime-diagnostics`, `bootstrap:ready`, `youtube_ingest_enabled:true` y `private_test_grant_active:true`.

El barrido automático que ya existe en 1.4.7 intentará de nuevo la canción **sin añadirla otra vez**. Busca en Render Logs:

    [pikete] qa_archive_sweep ...
    licensed_youtube_archive_failed B metadata <codigo>
    licensed_youtube_archive_failed B download <codigo>
    licensed_youtube_archive_failed B convert <codigo>
    licensed_youtube_archive_failed B telegram <codigo>

Si no aparece `licensed_youtube_archive_failed`, comprueba en Supabase si `archive_status=ready` y `archive_file_id` no es nulo. Solo eso confirma archivo asociado a Telegram; `/health` no lo demuestra.

### Si vuelve a fallar

- `metadata ytdlp_js_challenge`: el desafío JS sigue sin resolverse; comprobar disponibilidad de EJS en la versión del binario y el runtime.
- `metadata ytdlp_auth_required` o `download ytdlp_auth_required`: YouTube requiere acceso de cuenta o verifica el tráfico; **no es un fallo de Telegram ni de Supabase**. Usar una fuente propia/licenciada con acceso válido, no insistir con reintentos.
- `download ytdlp_http_403` / `ytdlp_rate_limited`: rechazo del servidor de origen. No intentes reinicios o bucles de descarga indefinidos.
- `download ytdlp_formats_unavailable`: el vídeo se encontró pero no expone un formato utilizable.
- `convert ffmpeg_execution_failed`: fallo de conversión.
- `telegram telegram_upload_failed` u otro error: examinar archivador, bot y permisos de escritura.

## Estado de verificación

Las pruebas son locales y simulan las fallas de subprocess. No se realizó una descarga real del vídeo ni una subida de audio a Telegram desde este entorno. No hay cambios a producción ni a cuentas. No se modifican la biblioteca Android, las carátulas ni las letras.

Fuentes oficiales yt-dlp: https://github.com/yt-dlp/yt-dlp/wiki/EJS y https://github.com/yt-dlp/yt-dlp/issues/15012
