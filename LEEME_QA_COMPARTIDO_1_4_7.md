# PLAKA PIKETE — Render B 1.4.7 — Pruebas compartidas B/C/Panitas

## Qué se cambió

El modo de pruebas ahora interpreta **una única declaración del operador para el entorno de pruebas**. No se exige una nueva autorización por vídeo, teléfono, socio Panitas o elemento de lista. La concesión funciona en ambas particiones B/C y solo en listas privadas activas.

Render B conserva `yt-dlp` (1.4.6), FFmpeg y el archivador existente Telegram → SHA-256 → `pikete_attach_verified_audio`.
No se tocó el frontend Android, ni Cloudflare, ni carátulas, ni letras, ni Plaka Studio.

- Los candidatos de alta confianza no ambiguos pueden incorporarse automáticamente.
- Los candidatos dudosos siguen requiriendo **elegir la grabación correcta**; elegir el vídeo ya no equivale a aprobar el permiso en cada prueba.
- Un vídeo que ya fue elegido se recupera de `awaiting_audio` con barridos limitados al iniciar Render y periódicamente mientras esté activo.
- No se permite saltar `rights_status=revoked/blocked`, las listas privadas activas ni los controles contra cargas duplicadas.
- Fuera de la modalidad de prueba persiste la aprobación por ID individual.
- La activación es intencional y del lado del servidor, no controlable desde Android ni por sus usuarios.

## Publicar manualmente

1. Haz una copia de la versión actual 1.4.6 / conserva su commit para rollback.
2. Sustituye los archivos de **Render B** por los del ZIP completo y realiza commit/push en `Eduardolv02/plaka-pikete-worker`.
3. En las variables **Render B**, activa **una sola vez** estos dos controles ya previstos por versiones anteriores:

   `PIKETE_TEST_MODE=true`

   `PIKETE_TEST_RIGHTS_ATTESTED=true`

   Mantén activos los controles ya existentes:

   `PIKETE_YOUTUBE_INGEST_ENABLED=true`

   `PIKETE_ARCHIVE_UPLOADS_ENABLED=true`

   `PIKETE_YTDLP_SEARCH_ENABLED=true`

   Usa estos valores **solamente en un entorno de pruebas aislado y para grabaciones sobre las que tengas permiso de descarga y redistribución**. El modo de pruebas no equivale a obtener permiso de terceros.

4. Render debería iniciar normalmente en Node sin cambios en Build/Start Commands. Abre `/health` y comprueba:

   `version: pikete-render-b-1.4.7-shared-qa-grant`

   `discovery.bootstrap: ready`

   `discovery.private_test_grant_active: true`

   `youtube_archive_policy: shared_private_qa_grant`

5. **No dupliques «Tormenta».** Ya está en `awaiting_audio`. Cuando el servicio esté activo, se barrerán las canciones seleccionadas pendientes de B y C. Si quieres acelerar una canción, el endpoint autenticado existente `POST /api/archive/youtube-item` con `node` e `item_id` sigue operativo; no hace falta añadir permisos.
6. Confirma que la fila cambia a `archive_status=ready` y obtiene `archive_file_id`, y reproduce desde el segundo teléfono/Panitas. `processing` en el endpoint significa trabajo aceptado, **no archivo completado**.

## Diagnóstico si no sube

- `private_test_grant_active=false`: uno o más de los cuatro controles del servidor están desactivados.
- `bootstrap=failed`: ejecutar instalador/diagnóstico previo; todavía no existe un ejecutable funcional.
- `awaiting_audio` sin `archive_file_id`: la subida no ha terminado. Consulta el log `licensed_youtube_archive_failed` de Render B y el `code` desde `/api/archive/youtube-status` (autenticado).
- `archive_video_not_in_candidates`: fue elegido un ID distinto a los candidatos; **no se salta** esta validación.
- `archive_source_missing` o `ytdlp_execution_failed`: fallo de extracción de origen, no del permiso de pruebas.
- `telegram_upload_failed`: investigar bot Telegram y chat de destino.
- `archive_attach_failed`: la subida pudo ocurrir pero falló la asociación de base de datos; no borrar el archivo ni marcar listo falsamente.

## Cuando termine la fase de pruebas

Pon `PIKETE_TEST_MODE=false` una sola vez en Render B. El sistema volverá a exigir aprobación específica por grabación. Los archivos ya archivados no se borran automáticamente. **No actives la concesión global en un entorno que sirva música sin licencia o que mezcle participantes fuera del grupo de pruebas autorizado.**

## Pruebas técnicas

`node --test`

Casos cubiertos: persistencia conceptual del grant en servidor, B/C, listas privadas, revocación, candidato ambiguo, `awaiting_audio`, ingestión a Telegram simulada, límite equitativo B/C, pruebas previas de yt-dlp y salud Node. **La subida real a Telegram desde YouTube en Render no se ha probado en este entorno.**
