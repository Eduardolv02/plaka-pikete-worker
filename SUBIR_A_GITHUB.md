# PLAKA PIKETE · Render B 1.4.0 — Cómo subir el repositorio completo a GitHub

Este ZIP contiene el **repositorio Render B completo**: todos los archivos que ya estaban en `Eduardolv02/plaka-pikete-worker` más el parche 1.4.0 de búsqueda mediante yt-dlp. **No es el repositorio de Android ni el código del Worker de Cloudflare B.**

Repositorio de destino: https://github.com/Eduardolv02/plaka-pikete-worker  
Rama: `main`  
Versión esperada en `/health` después del despliegue: `pikete-render-b-1.4.0-ytdlp`

## Opción A — GitHub Desktop (recomendada si no usas Git por consola)

1. **Descomprime** `PLAKA_PIKETE_RENDER_B_GITHUB_COMPLETO_1_4_0.zip`. Se creará la carpeta `plaka-pikete-worker-main`.
2. En **GitHub Desktop** → **File → Clone repository...** → selecciona `Eduardolv02/plaka-pikete-worker` → **Clone**. Se descargará una copia con el historial Git.
3. Abre **Repository → Show in Explorer** para abrir la carpeta clonada.
4. Copia **el contenido interno** de `plaka-pikete-worker-main` (por ejemplo `server.mjs`, `Dockerfile`, las carpetas `src`, `sql`, `test` y `tests`) **dentro de la carpeta clonada**, sobrescribiendo los archivos que Windows pregunte. **NO** pongas una carpeta `plaka-pikete-worker-main` dentro del repositorio ni borres la carpeta oculta `.git`.
5. GitHub Desktop mostrará los archivos modificados y añadidos. Revisa que no haya `.env`, tokens, archivos de audio ni `.bak`.
6. En **Summary** escribe: `Plaka Pikete: Render B 1.4.0 yt-dlp` → pulsa **Commit to main** → **Push origin**.
7. Abre el repositorio en GitHub y comprueba que `Dockerfile`, `src/youtube-discovery.mjs`, `src/youtube-archive.mjs`, `src/ytdlp-runner.mjs`, `src/youtube-refresh.mjs` y `server.mjs` están en la **raíz/rutas correctas**, no dentro de una carpeta adicional.

Si no tienes permisos para hacer Push en ese repositorio, GitHub te lo indicará: hay que usar una cuenta con acceso de escritura o crear una propuesta de cambios desde un fork.

## Opción B — Git en PowerShell (Windows)

Abre PowerShell en la carpeta donde quieras clonar el proyecto y ejecuta:

```powershell
git clone https://github.com/Eduardolv02/plaka-pikete-worker.git
cd plaka-pikete-worker
```

Ahora, usando el Explorador de Windows, copia **el contenido** de la carpeta descomprimida `plaka-pikete-worker-main` dentro de `plaka-pikete-worker`, sobrescribiendo archivos; conserva `.git`.

Después, en PowerShell dentro de `plaka-pikete-worker`:

```powershell
node --check server.mjs
npm test
git status --short
git add -A
git commit -m "Plaka Pikete: Render B 1.4.0 yt-dlp"
git push origin main
```

`npm test` requiere Node.js instalado en tu PC, pero GitHub Actions también ejecutará la suite de pruebas en cada Push.

## Opción C — Web de GitHub

Desde el repositorio → **Add file → Upload files**, arrastra los **archivos y carpetas interiores** del ZIP ya descomprimido, no el ZIP mismo. Comprueba que las rutas finales comienzan por `src/`, `tests/`, etc. Haz commit en la rama `main` si tienes permiso. GitHub puede imponer límites a la subida web; si falla, usa GitHub Desktop.

## Render: paso imprescindible después del Push

**La subida a GitHub no instala yt-dlp en un servicio Render creado originalmente con Runtime Node.** Para usar este parche:

1. Render → servicio `plaka-pikete-worker` → comprueba si puedes configurarlo para desplegar desde el `Dockerfile` (Runtime Docker). En muchos servicios existentes no se puede cambiar el runtime: entonces crea **un nuevo Web Service** vinculado al **mismo repositorio** y elige **Docker**, rama `main` y ruta del Dockerfile `./Dockerfile`.
2. Conserva las variables de entorno actuales configuradas **solo en Render**: `PIKETE_WORKER_KEY`, Supabase B/C, bots de Telegram, etc. Si creaste un servicio nuevo, añade allí sus mismas variables **manualmente desde el panel**, nunca en GitHub.
3. Para activar la **búsqueda de candidatos** (no la descarga):

```text
PIKETE_YTDLP_SEARCH_ENABLED=true
PIKETE_PROCESSOR_ENABLED=true
PIKETE_QUEUE_MUTATIONS_ENABLED=true
```

4. Comprueba el `/health` del servicio Docker nuevo. Debe devolver `pikete-render-b-1.4.0-ytdlp` y `youtube_discovery: yt-dlp`.
5. Si cambió el dominio Render, actualiza **Cloudflare Gateway B** usando el parche Cloudflare 2.7.2; configura `PIKETE_RENDER_B_ORIGIN=https://NUEVO-SERVICIO.onrender.com` allí **solamente después** de validar el servicio nuevo. No desactives el Render original antes de comprobar el nuevo.
6. El Gateway B **también tiene que actualizarse a 2.7.2** para la confirmación/archivo automático y la recuperación de candidatas antiguas; esto no se resuelve subiendo solamente este repositorio.

### Archivado autorizado (no necesario para buscar coincidencias)

Deja `PIKETE_YOUTUBE_INGEST_ENABLED=false` hasta disponer de permiso verificado de la fuente **y** de redistribución de cada grabación. Para cada vídeo autorizado, el servidor comprueba una allowlist privada (`PIKETE_APPROVED_YOUTUBE_VIDEO_IDS`) y mantiene los permisos existentes de archivado (`PIKETE_ARCHIVE_UPLOADS_ENABLED=true`). Confirmar el título/artista en Android por sí solo no concede derechos.

## Comprobaciones y limitaciones

- Se ejecutó `node --check server.mjs` y `npm test`: **93/93 pruebas superadas** sobre el repositorio combinado. Son pruebas locales con simulaciones; no acreditan descargas ni subidas reales.
- El ZIP no contiene credenciales, `.env`, tokens de Telegram ni copia de música.
- No se modificaron datos de Supabase, Telegram, GitHub ni Render al crear este ZIP.
- Si en Render la red bloquea YouTube, yt-dlp puede devolver `temporarily_unavailable`; los resultados no están garantizados.
- Los endpoints privados necesitan `PIKETE_WORKER_KEY`; no los llames desde Android.
