# PLAKA PIKETE · Render B v0.9.0 — búsqueda de grabaciones y archivo Telegram

Entrega integrada con Cloudflare B v1.6.0 y Android Plaka 2.5.0.

## Funcionalidad

- Solo el **propietario** de la lista cambia canciones (validación real en Cloudflare B). Los participantes siguen pudiendo aceptar invitaciones, leer la lista y vincular una copia local privada.
- Android exige confirmar explícitamente **título y artista** al incorporar un tema local. El Gateway almacena `metadata_confirmed_at` y el normalizador verifica título, artista, variantes y duración.
- Render B busca candidatos musicales mediante el **YouTube Data API v3** (`search.list` y `videos.list`); guarda título, canal y duración en metadatos, para revisión. **No descarga audio de YouTube.**
- Si el propietario dispone de una copia MP3/M4A que puede distribuir, la autoriza expresamente y puede cargarla al archivo privado de Telegram. Render B calcula SHA-256, reutiliza copias idénticas, asigna hasta 4 bots de almacenamiento y guarda solamente el `file_id` y el slot en Supabase B/C.
- Cloudflare B genera enlaces de reproducción firmados para propietarios e invitados activos. El Gateway transmite los bytes desde Telegram sin filtrar el token del bot. Media3 reproduce usando una URI estable que se resuelve justo al empezar.

## Dependencias de la implementación

Supabase B y C deben tener aplicada `sql/007_pikete_owner_audio_archive.sql` (la migración se aplicó a ambas durante la preparación). No es necesario ejecutar SQL otra vez.

Variables nuevas de **Render**:

- `PIKETE_YOUTUBE_DATA_API_KEY`: clave del YouTube Data API v3, opcional para búsqueda; si falta, las canciones siguen normalizándose.
- `PIKETE_TG_BOT_1_TOKEN`: token del primer bot creado en @BotFather.
- `PIKETE_TG_BOT_1_CHAT_ID`: ID de un canal/chat privado donde el bot tenga permisos de publicar audio.
- Repite con los sufijos `_2_`, `_3_`, `_4_` si agregas más bots; cada bot tiene su propio canal o acceso a un canal común.
- `PIKETE_ARCHIVE_UPLOADS_ENABLED=true`: habilita subir copias autorizadas. Mantén `false` hasta configurar bots/canales.

Mantén las variables existentes `PIKETE_WORKER_KEY`, `PIKETE_SUPABASE_B_URL`, `PIKETE_SUPABASE_B_SECRET_KEY`, `PIKETE_SUPABASE_C_URL`, `PIKETE_SUPABASE_C_SECRET_KEY`, `PIKETE_SUPABASE_A_SECRET_KEY`, `PIKETE_QUEUE_MUTATIONS_ENABLED=true`, `PIKETE_PROCESSOR_ENABLED=true`.

En Cloudflare B configura `PIKETE_TG_BOT_1_TOKEN` (y los demás tokens usados en Render), más `PIKETE_PLAYBACK_SIGNING_KEY`: cadena aleatoria de 32 caracteres o más. También conserva las variables existentes del Gateway.

## Endpoints internos

`POST /api/archive/ingest` solo para Cloudflare B, con `Authorization: Bearer <PIKETE_WORKER_KEY>`, tipo MP3 o MP4-audio, longitud explícita (`X-Pikete-Audio-Length`) e identidad del propietario y de la lista verificados previamente en el Gateway. Render vuelve a comprobar la propiedad en Supabase antes de subir nada a Telegram.

`POST /api/queue/process-once` sigue procesando normalizaciones y coincidencias. En metadata normalizada aparece `youtube_search`, siempre con `requires_confirmation=true`.

## Límites

- 19 MiB por archivo, MP3 o M4A: el bot estándar permite más al enviar, pero `getFile` en Bot API estándar tiene límite de descarga de 20 MB, por eso se guarda margen.
- No se hace modificación de volumen ni transcodificación del audio; «normalización» significa identificar y validar metadatos. No se garantiza equivalencia acústica usando solo títulos.
- La búsqueda de YouTube no es autorización de descarga. El propietario proporciona un archivo distribuible y confirma su permiso antes del archivo.
- El servicio no crea bots/canales ni configura Google Cloud Console automáticamente: esas acciones se realizan en las cuentas correspondientes.

## Pruebas

`npm test`, `node --check server.mjs`.
