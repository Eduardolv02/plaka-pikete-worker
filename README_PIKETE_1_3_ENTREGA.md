# PLAKA PIKETE — entrega integrada 1.3 (NO DESPLEGADA)

## Incluye
- Render B 1.3: `POST /api/archive/auto-item` y `/api/archive/auto-sweep`; ambos privados tras `PIKETE_WORKER_KEY`.
- Cloudflare Gateway B 2.0: después de confirmar coincidencia avisa a Render, y en Cron revisa las canciones pendientes.
- Reutiliza el archivador 1.2: SHA-256 global B/C, subida a bot autorizado, vinculación del archivo, estado `ready`.
- No cambia app Android: Plaka Player 2.5.7 ya puede reproducir las canciones con `archive_status=ready` y usa Plaka Studio como marca visible.

## Importante: catálogo de fuentes licenciadas
La búsqueda de YouTube y MusicBrainz identifica grabaciones pero NO otorga derecho a descargar y redistribuir la grabación. Por eso esta versión automática solo toma audio de fuentes HTTPS con licencia explícita de descarga y redistribución. No admite como fuente URLs de vídeos de YouTube. Si no hay archivo licenciado, la canción permanece esperando copia: no se marca como lista.

## Variables Render (además de las anteriores)
- `PIKETE_AUTO_ARCHIVE_ENABLED=true`
- `PIKETE_APPROVED_INGEST_ENABLED=true`
- `PIKETE_ARCHIVE_UPLOADS_ENABLED=true`
- `PIKETE_APPROVED_AUDIO_HOSTS=cdn.tu-dominio-autorizado.example`
- `PIKETE_LICENSED_AUDIO_CATALOG_JSON={"demo:song":{"audio_url":"https://cdn.tu-dominio-autorizado.example/demo.mp3","mime":"audio/mpeg","download_authorized":true,"redistribution_authorized":true}}`

Las claves del catálogo están normalizadas como `artista:titulo`, sin signos ni acentos relevantes. Es un catálogo administrado por el servidor, nunca recibido del usuario. Ejemplo ilustrativo, no una fuente real. Los archivos deben ser MP3/M4A válidos de entre 512 bytes y 19 MiB y tener Content-Length.

## Variables Gateway B
- `PIKETE_AUTO_ARCHIVE_ENABLED=true`
- `PIKETE_RENDER_B_WORKER_KEY=<mismo secreto de Render PIKETE_WORKER_KEY>`
- Configurar Cron Trigger en Cloudflare (por ejemplo cada 5 minutos) o cualquier cadencia disponible para su plan.

## Orden de prueba
1. Mantener despliegue anterior hasta confirmar contrato y licencia de una canción de prueba.
2. Desplegar Render B 1.3 con variables y verificar `/health`.
3. Desplegar Gateway B 2.0 y habilitar Cron Trigger; verificar `/health`.
4. Añadir **una canción propia y autorizada** cuyo artista/título esté en el catálogo. Confirmar coincidencia en la app.
5. Verificar que el item llega a `archive_status=ready` y `preparation_status=ready`, y se reproduce desde otro teléfono sin audio local.
6. Repetir con los mismos bytes: se debería reutilizar el SHA-256.

## Limitaciones pendientes para validación en producción
- Ninguna prueba de red real a Telegram/Supabase o móvil se ha realizado en este paquete.
- La deduplicación SHA-256 se aplica al buscar en B/C, pero envíos simultáneos desde instancias distintas aún pueden generar una subida duplicada antes de quedar indexada. Se requiere bloqueo distribuido global para garantizar exactamente una subida bajo concurrencia.
- No existe extracción automática de vídeos arbitrarios de YouTube ni conversión de formatos que no sean MP3/M4A autorizados.
- El catálogo Plaka A se busca durante normalización; la conversión automática de un candidato a `source_type=plaka` exige selección/confirmación del ID para evitar coincidencias equivocadas.
- Los eventos «escuchando ahora» y reproducciones de Pikete no se completan por estos cambios. Se deben conectar los eventos del reproductor por sesión autenticada antes de declarar esa métrica lista.
