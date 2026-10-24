# PLAKA Pikete — ciclo de reparación Render B 1.4.5

Este paquete corrige el motor de búsqueda de **Render B solamente**. Se construyó desde el paquete Render B 1.4.4 (Node), conservando los módulos del archivador de Telegram, el contrato de Cloudflare B y Android.

## Instalación manual (sin nuevas variables ni comandos)

1. Guarda una copia del estado actual del repositorio `Eduardolv02/plaka-pikete-worker` y del Render B antes de sustituirlo.
2. Desde GitHub Desktop, clona o abre **ese mismo repositorio** (no Render A). Copia **el contenido interior de `render_b/`** a la raíz del repositorio, conserva `.git` y realiza Commit/Push. No subas este documento ni archivos `.env` que contengan claves.
3. Render B (runtime Node) debe mantener el **mismo** Build Command y Start Command existentes. `npm start` inicia el instalador automático para `yt-dlp` si el ejecutable no está disponible. Si el sistema tiene `yt-dlp` ya instalado, lo reutiliza. El binario descargado es la versión oficial 2026.10.21 con comprobación SHA-256. No se añaden variables.
4. Abre `/health`: comprueba versión `pikete-render-b-1.4.5-self-healing`, `discovery.bootstrap=ready`, `discovery.ytdlp_binary_detected=true`, `discovery.ffmpeg_binary_detected=true` y `discovery.search_enabled=true`. `search_enabled` sigue la variable que *ya* existía `PIKETE_YTDLP_SEARCH_ENABLED`.
5. Si `bootstrap=failed`, **no vuelvas a subir canciones**. Mira `bootstrap_error_code` y los Logs de Render B. El servidor reintentará automáticamente con esperas crecientes (30 s, 90 s, 3 min, 6 min y luego 10 min). Si `bootstrap=ready`, aún falta comprobar que una búsqueda devuelve candidatos.
6. En Cloudflare B conserva Gateway 1.9.2 con su cron y enlace actual a Render B. El reparador reintenta canciones que tengan `youtube_search.status=not_configured` o `temporarily_unavailable`; no elimina ni modifica las ya archivadas.
7. En Android verifica que la canción pasa de «Buscando versión» a «Candidatos» o «En preparación» y luego «Lista para escuchar», siempre que el backend tenga acceso y permiso para archivar esa fuente.

## Fuente de audio y permisos

La búsqueda de candidatos y la transferencia de audio son procesos distintos. **El código NO convierte resultados de YouTube en permiso para descargar y redistribuir una grabación**. El archivado automático continúa limitado por los controles existentes `PIKETE_YOUTUBE_INGEST_ENABLED`, `PIKETE_ARCHIVE_UPLOADS_ENABLED` y la allowlist por video `PIKETE_APPROVED_YOUTUBE_VIDEO_IDS` (si ya estaban definidos), sin ningún interruptor adicional `PIKETE_ONE_CLICK_LICENSED_ENABLED`. Si estos controles no están configurados para una fuente autorizada, la canción puede aparecer en candidatos sin descargarse a Telegram. En esos casos Android conserva el flujo manual y la subida de una copia local sobre la que el usuario tenga derechos.

Telegram conserva los bytes; Supabase B/C las referencias, colas y permisos. No se incorpora Realtime Database al streaming, no se cambia el Gateway ni las carátulas/ letras del cliente.

## Pruebas y criterios de aceptación

- `cd render_b && npm test` — pruebas de arranque, SHA de instalador, rutas privadas, flujo de normalización, captura de fallos de descarga/Telegram y autorizar grabación antes de archivarla.
- `node --check server.mjs` y `find src scripts test tests -name '*.mjs' ... node --check` — sintaxis.
- `cd gateway_b && npm test` — regresión de proxy autenticado, lista y streaming.
- Un Android emulator no está disponible en el entorno actual (`adb` y Android SDK ausentes). Compila la app que ya utilizas en Android Studio y prueba tu escenario real en el móvil. Ningún archivo Android se modificó en este parche.
- Sin acceso al Render B en producción ni a credenciales privadas, **no se validó en vivo** el recorrido YouTube → Telegram. El ZIP pasa pruebas locales, no equivale a una subida real.

## Matriz de recuperación

| Situación | Resultado esperado |
| --- | --- |
| Ejecutable de yt-dlp ya existe en Node PATH | Se usa directamente, sin volver a descargar |
| Variable antigua señala una ruta Docker inexistente | Se intenta yt-dlp en Node PATH y, si no existe, se instala localmente |
| Descarga de instalador falla por red/CDN | Estado `failed`, código de diagnóstico, reintento gradual sin reinicio |
| Instalador descargó datos corruptos | Error por SHA-256, no se ejecuta el binario |
| Instala pero no ejecuta en Render | No declara `ready`; informa `yt_dlp_not_executable` |
| Render disponible antes de completar instalación | `/health` muestra `installing`; no declara éxito falso |
| Canción guardada con `not_configured` | Búsqueda recuperable tras 1 min, no 6 h |
| YouTube falla temporalmente | Reintento tras 90 s, con cron/temporizador de respaldo |
| YouTube no encuentra candidato | No se repite antes de 6 h ni se marca audio `ready` |
| Candidato ambiguo o no autorizado | Se requiere revisión o fuente autorizada; no se descarga automáticamente |
| Candidato único fuerte y operador lo autorizó previamente | Encola la canalización existente para descarga, FFmpeg, Telegram y verificación |
| Telegram falla o se interrumpe | No se marca la canción reproducible; permite reintento por barrido |
| Canción ya archivada | Se mantiene intacta y no se intenta reemplazar audio |
| Miembro ajeno a lista | El Gateway continúa exigiendo autenticación/ticket; no abre streaming público |

## Cambios (Render B)

- `server.mjs`: versión, arranque de instalación tolerante a fallos, informe de progreso y uso del ejecutable ya disponible.
- `src/ytdlp-bootstrap.mjs`: coordinador de instalación/reintento con backoff, una sola ejecución simultánea y refresco de entradas antiguas.
- `src/ytdlp-path.mjs`: detecta y evita rutas Docker obsoletas en el servicio Node.
- `src/youtube-refresh.mjs`: ventana corta para fallos temporales y recupera registros sin estado.
- `src/one-click-licensed.mjs`: reutiliza las verificaciones de autorización existentes sin requerir una variable adicional.
- `tests/...`, `test/...`: regresiones de escenarios; prueba de proceso Node HTTP real con yt-dlp simulado (no YouTube real).
