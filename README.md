# Plaka Pikete · Render B · v0.3.0 — Comprobación de claves Supabase B y C

## Qué hace
- Mantiene `/health` y `/api/normalize` de versiones anteriores.
- **GET `/api/supabase/check`** (Bearer `PIKETE_WORKER_KEY`): envía cada clave secreta con cabecera `apikey` a la **raíz de PostgREST** `/rest/v1/` de su Supabase. Un HTTP 200 confirma que la **API REST reconoce la clave**; nunca se descarga ni devuelve el esquema a quien llama.
- **GET `/api/supabase/network`**: conserva el test de alcance de red anterior, con estados `reachable_auth_restricted` considerados alcanzables.
- No lee filas ni escribe en Supabase; NO activa colas, NO crea tablas, NO conecta Telegram.
- **No incluye secretos** en los archivos que subirás al GitHub público.

## Actualización en GitHub
1. Descomprime el ZIP.
2. Abre https://github.com/Eduardolv02/plaka-pikete-worker
3. Sube **el contenido** de la carpeta descomprimida a la raíz del repo, reemplazando archivos. Comprueba que `src/supabase-authenticated.mjs` y `tests/supabase-authenticated.test.mjs` se hayan incluido.
4. Haz `Commit changes`. Render desplegará el nuevo commit automáticamente o usa `Manual Deploy`.

## Variables en Render > plaka-pikete-worker > Environment
Debes tener estas **cinco variables** (las configuradas antes se conservan):

| Key | Dónde obtenerla |
| --- | --- |
| `PIKETE_WORKER_KEY` | La existente, para autorizar diagnósticos internos |
| `PIKETE_SUPABASE_B_URL` | `https://cpdklixfmiibrcptleir.supabase.co` |
| `PIKETE_SUPABASE_B_SECRET_KEY` | Supabase plaka 2 > Settings > API Keys > Secret keys |
| `PIKETE_SUPABASE_C_URL` | `https://wxleseokrzltkuyjmjev.supabase.co` |
| `PIKETE_SUPABASE_C_SECRET_KEY` | Supabase plaka 3 > Settings > API Keys > Secret keys |

Si pegaste ya el `.env` desde Render, no necesitas repetirlo. **No subir el `.env` real a GitHub**; `.env.example` es una plantilla inocua.

## Verificar
1. Abre https://plaka-pikete-worker.onrender.com/health ; debe mostrar la versión `pikete-render-b-0.3.0` y modo `supabase-auth-check`.
2. PowerShell: sustituye `WORKER_KEY_ACTUAL` por la clave de tu variable `PIKETE_WORKER_KEY` si deseas probar las conexiones:

```powershell
$headers = @{ Authorization = 'Bearer WORKER_KEY_ACTUAL' }
try {
  Invoke-RestMethod 'https://plaka-pikete-worker.onrender.com/api/supabase/check' -Headers $headers | ConvertTo-Json -Depth 5
} catch {
  if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message }
  else { $_.Exception.Message }
}
```

Respuesta esperada: `"ok":true` y **B** y **C** con `"state":"authenticated_rest_api"` y `"http_status":200`.
- `not_configured`: Render no ve la URL o clave de ese nodo.
- `invalid_key_format`: valor que no comienza con `sb_secret_` o se pegó cortado.
- `unauthorized_key` (401): proyecto/clave no coinciden, fue deshabilitada o faltan permisos de autenticación.
- `forbidden` (403): la clave no tiene acceso al endpoint.
- `timeout` / `network_error`: problema de red.

## Límite de este hito
Este resultado verifica **autenticación del proyecto y comunicación con su REST API**, pero NO garantiza que existan tablas de Pikete ni prueba lectura de filas. Las colas y sus permisos llegarán en el siguiente hito, mediante migración SQL específica para bases secundarias. No copiar las referencias a `auth.users` del esquema principal a los proyectos B/C.

Ejecuta `npm test` desde Node.js 20+ para las pruebas automáticas.
