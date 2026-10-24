# Plaka Pikete — Render B 1.4.6: diagnóstico de arranque yt-dlp

## Para qué sirve

Corrige el falso negativo de Render B 1.4.5: el instalador concedía 12 segundos a `yt-dlp --version`, pero el servidor volvía a probar el ejecutable usando `spawnSync` y **solo 4 segundos**, incluso dos veces por cada consulta `/health`. Los ejecutables PyInstaller tardan en arrancar y descomprimirse en algunos servidores. Un primer chequeo válido podía coexistir con el fallo `yt_dlp_not_executable`.

El diagnóstico del usuario confirma que 1.4.5 arranca con Node, búsqueda habilitada y FFmpeg detectado, pero NO prueba cuál fue la causa exacta del fallo. Este cambio elimina una inconsistencia concreta y expone nuevos errores si la causa real es otra.

## Instalación manual sin cambiar variables

1. Haz una copia del repositorio actual de **Render B** `Eduardolv02/plaka-pikete-worker`.
2. Descomprime este ZIP; copia los archivos y carpetas **de dentro** a la raíz del repositorio Render B (conserva su `.git`), revisa los cambios y haz commit/push.
3. **No** cambies Runtime Node, Build Command, Start Command ni variables existentes. **No** modifiques Render A, Cloudflare B, Supabase B/C o Android.
4. Comprueba el despliegue y abre la URL pública `/health` de **Render B**. Debe mostrar `version: pikete-render-b-1.4.6-async-probe`. Después del arranque debería aparecer `bootstrap: ready`, `ytdlp_binary_detected: true`, `search_enabled: true`.
5. Si `bootstrap: failed`, **no crees otra canción**. Copia `bootstrap_error_code`, `bootstrap_retry_attempts` y los mensajes `[pikete]` de **Render B → Logs**. Ya se diferencian: `yt_dlp_probe_timeout`, `yt_dlp_binary_missing`, `yt_dlp_permission_denied`, `yt_dlp_exec_format_error`, `yt_dlp_execution_failed`, `yt_dlp_unexpected_version`, etc. El servicio mantiene su backoff automático.
6. Si `ready`, prueba **una búsqueda de candidatos** en la lista Pikete que ya tienes pendiente. No vuelvas a subir ese audio de inmediato. Un `ready` solo demuestra que el ejecutable arranca, no que YouTube permita buscar ni que Telegram haya recibido audio.
7. Si el despliegue empeora las cosas, restaura el último commit de Render B desde GitHub. No cambies credenciales.

## Qué se cambió

- `src/ytdlp-probe.mjs` (nuevo): comprobación asíncrona, límite 30 segundos, códigos de fallo seguros y sin bloquear Node.
- `scripts/install-ytdlp.mjs`: la instalación y validación del ejecutable usan el **mismo** comprobador; siguen fijados la versión oficial y el SHA-256.
- `src/ytdlp-bootstrap.mjs`: permite comprobaciones asíncronas y conserva el código de error detallado.
- `server.mjs`: `/health` utiliza el resultado ya verificado al iniciar; **no ejecuta `yt-dlp` dos veces en cada consulta**. Sigue arrancando con `npm start`.
- `tests/ytdlp-probe.test.mjs`, `tests/runtime-smoke.test.mjs`, `tests/ytdlp-bootstrap.test.mjs`: regresiones para arranque lento, diagnóstico específico y servidor HTTP accesible durante la comprobación.

No se modifican la cola, el archivador de Telegram, carátulas, letras ni las políticas de autorización de archivos; la extracción de audio continúa sujeta a la autorización de la fuente y a los mecanismos existentes.

## Pruebas realizadas

- `npm test`: 117 pruebas, 117 superadas (incluye HTTP local y ejecutable simulado que tarda en arrancar).
- `node --check server.mjs` y verificación de todos los módulos `src/`, `scripts/`, `test/`, `tests/`: sin errores.
- ZIP: comprobación de integridad `testzip()`.

**No verificado:** búsqueda real de YouTube, FFmpeg + Telegram en Render B de producción, conexión de Cloudflare ni compilación Android. No se han cambiado servicios reales.
