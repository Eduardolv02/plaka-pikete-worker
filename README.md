# PLAKA PIKETE · Render B · Arranque mínimo 0.1.0

**Objetivo de esta versión:** comprobar que el Render de un compañero arranca independientemente de Plaka Studio. No modifica Supabase, Cloudflare ni Telegram. No descarga música, no ejecuta yt-dlp y todavía no recoge trabajos de las colas. Ese será el siguiente módulo después de verificar el despliegue.

## A. Crear repositorio GitHub público (desde navegador)

1. Entrar a https://github.com/new desde una cuenta GitHub que pueda administrar el repositorio.
2. Nombre sugerido: `plaka-pikete-worker`.
3. Elegir **Public** y pulsar **Create repository**.
4. Descomprimir este ZIP en tu PC; en el repositorio pulsar **Add file → Upload files**.
5. Subir **el contenido de la carpeta**, no el ZIP ni una carpeta adicional. Asegúrate de que `package.json`, `server.mjs` y `src/normalize.mjs` estén en la raíz o sus rutas indicadas.
6. Pulsar **Commit changes**. **NUNCA subir tokens, contraseñas, service_role o archivos `.env`.**

## B. Desplegar en Render Free

1. Tu compañero inicia sesión en https://dashboard.render.com.
2. **New → Web Service → Public Git Repository** (la etiqueta puede variar).
3. Pegar la URL del repositorio público y conectar.
4. Elegir `Node` como runtime (si aparece), plan **Free**, nombre `plaka-pikete-worker`.
5. Root Directory: en blanco, Build Command: `npm install`, Start Command: `npm start`.
6. **Environment**: añadir `PIKETE_WORKER_KEY` con un valor aleatorio de mínimo 32 caracteres, solamente en Render. No compartirlo en capturas o GitHub. Render configura `PORT` automáticamente.
7. Crear el servicio y esperar el deploy; abrir `https://TU-SERVICIO.onrender.com/health`.

Salida esperada: JSON con `"ok":true`, `"service":"plaka-pikete-render-b"`, `"mode":"bootstrap"`.

## C. Prueba privada (opcional; después del health)

Desde PowerShell, sustituyendo la URL y leyendo el secreto sin mostrarlo en pantalla:

```powershell
$base = 'https://TU-SERVICIO.onrender.com'
$secret = Read-Host 'PIKETE_WORKER_KEY'
$headers = @{Authorization = "Bearer $secret"}
$body = @{artist='Daft Punk';title='One More Time.mp3'} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/api/normalize" -Headers $headers -Body $body -ContentType 'application/json'
```

Debe devolver `identification_status: pending_external_match` y `ready_to_share: false`: se limpian metadatos, **NO se identifica aún la versión oficial ni se concede permiso de distribuir audio**.

## D. Próximos módulos (NO incluidos)

1. Verificar acceso de Render B a Supabase B/C con claves exclusivamente en variables de entorno.
2. Implementar cola persistente y leasing atómico; gestión de reintentos y límites.
3. Identificación mediante fuentes musicales y confirmación de versiones.
4. Integración Telegram únicamente para archivos con autorización de distribución.
5. Endpoints de estado y progreso a Cloudflare B, autenticados y con límites.

**Seguridad:** el repositorio es público; nunca publiques claves de Supabase, Telegram, Cloudflare ni de `PIKETE_WORKER_KEY`. El endpoint de normalización rechaza llamadas sin secreto. `/health` es público deliberadamente.
