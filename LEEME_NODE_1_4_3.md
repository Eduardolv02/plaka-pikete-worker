# PIKETE Render B 1.4.3 — solución para Render Runtime Node (NO Docker)

## Por qué mostraba "Búsqueda indisponible"

`search_enabled=true` solo activa la bandera. Render B seguía como **Node**, por lo que el `Dockerfile` no se ejecutaba y `yt-dlp` no estaba instalado. El programa anterior buscaba el comando y devolvía `temporarily_unavailable`.

Este paquete mantiene toda la estructura 1.4.2, añade un instalador con Node **sin Python, pip, sudo ni Docker** para el ejecutable Linux oficial `yt-dlp_linux` de la versión 2026.10.21 y verifica su SHA-256 antes de permitir su ejecución. Usa una ruta local fija `bin/yt-dlp` (no acepta rutas proporcionadas por usuarios). Se instala durante el build de Render y también se comprueba al arrancar como respaldo. No contiene binarios ni credenciales.

## Instrucciones EXACTAS (en el servicio de Render B, no Render A)

1. Sube **el contenido de esta carpeta** (server.mjs, src/, scripts/, bin/, package.json, etc.) a la raíz del repo que utiliza Render B; conserva las variables actuales de Render.
2. **Runtime: Node** (no lo cambies).
3. Settings > Build Command:

   `npm install --ignore-scripts --no-audit --no-fund && npm run build:yt-dlp`

4. Settings > Start Command: `npm start`.
5. Environment: `PIKETE_YTDLP_SEARCH_ENABLED=true`; no añadas una ruta a `PIKETE_YTDLP_BIN`. Si habías configurado `/app/.venv/bin/yt-dlp`, el nuevo programa prefiere automáticamente el binario local instalado. **No cambies secretos de Telegram o Supabase ni otras variables existentes.**
6. Deploy y revisa el log de BUILD: `[pikete] yt-dlp 2026.10.21 ready (installed)`; luego `/health` debe indicar `pikete-render-b-1.4.3-node-ytdlp-ready`, `search_enabled=true`, `ytdlp_binary_detected=true`, `ffmpeg_binary_detected=true`. Si no puede instalarlo, el build fallará con razón explícita en logs en lugar de ocultarla tras "Búsqueda indisponible".
7. Prueba la recuperación de un registro de Pikete ya existente con el cron de Cloudflare B 1.9.2. Buscar metadatos no descarga audio. Para archivar material, sigue siendo necesaria la autorización de descarga y redistribución de la grabación.

## Sin cambios

Android, Cloudflare Gateway B, Plaka Studio, portadas, letras y acceso autenticado a listas. **No cambies esos servicios** para resolver este error de instalación.

## Seguridad y pruebas

Descarga solo desde `github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp_linux`; SHA-256 fijado y comprobado. Esta descarga de build se ejecuta en el servidor Render, no en Android. La prueba local de checksum usa datos sintéticos. La disponibilidad de YouTube y de Telegram en Render NO queda validada por estas pruebas.
