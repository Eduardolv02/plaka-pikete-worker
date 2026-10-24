# PIKETE Render B 1.4.4 – recuperación del laboratorio Windows, sin cambiar variables

## Qué recuperamos
El laboratorio Windows 1.7.1 utilizaba `python -m yt_dlp`, FFmpeg, sendAudio de Telegram y SHA-256. Funcionaba porque `yt_dlp` estaba instalado **en Windows**. No puede ejecutarse mágicamente desde un Render Node remoto. Esta versión conserva el motor Render B existente y descarga el ejecutable Linux oficial de yt-dlp al iniciar, verifica SHA-256 y lo usa para buscar candidatos.

## Lo que NO se pide
- NO nuevas variables de entorno.
- NO cambio de Runtime Node a Docker.
- NO cambio de Build Command.
- NO cambio de Start Command: funciona con `node server.mjs` o `npm start`.
- NO nuevos scripts SQL, bots, cuentas ni modificaciones a Android/Cloudflare.

## Única acción inevitable
La corrección es código; debe publicarse el contenido de este repositorio en GitHub/Render B, conservando las variables y secretos actuales. No subas archivos `.env` ni sustituyas el repositorio de Render A. Si GitHub está vinculado con auto-deploy, basta el commit.

## Comprobación
1. `/health` debe informar `version: pikete-render-b-1.4.4-no-config-restore`, `bootstrap: ready`, `ytdlp_binary_detected: true` y `search_enabled: true` (este último ya estaba en true).
2. Los registros deben indicar `[pikete] yt-dlp disponible`.
3. El servidor solicita automáticamente la recuperación de coincidencias pendientes en B/C después de instalarse; no es necesario volver a agregar la canción.
4. Los candidatos encontrados aparecerán con estado `candidates_for_review`. Esto NO asegura reproducción ni archivado: Telegram sigue dependiendo de la habilitación existente y de derechos de uso válidos para el audio.

El `/health` muestra `bootstrap_error_code` si falla la descarga; no contiene tokens ni secretos.

## Integridad del ejecutable
Versión: 2026.10.21
Fuente: https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp_linux
SHA-256 oficial: d8bd33fca9d5b23bd5b9952b3fca36db5c46331933fda9f598a3da14ce2c243f

## Pruebas
`npm test` verifica código y simulaciones. Se necesita una prueba en Render B de la búsqueda real y el flujo autorizado a Telegram para afirmar que Pikete está reparado de punta a punta.
