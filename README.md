# PLAKA PIKETE · Render B · Fase 1 · v0.2.0

**Objetivo:** confirmar desde Render B la conexión de red con los dos proyectos Supabase secundarios **sin acceder a datos, alterar bases, ni subir secretos al repositorio**. Esta versión mantiene el normalizador anterior.

## Proyectos
- Nodo B / plaka 2: `https://cpdklixfmiibrcptleir.supabase.co`
- Nodo C / plaka 3: `https://wxleseokrzltkuyjmjev.supabase.co`

## Actualizar el GitHub público
1. Abrir `https://github.com/Eduardolv02/plaka-pikete-worker`.
2. Subir todos los archivos y carpetas descomprimidos de este ZIP en la **raíz** del repositorio (reemplazando los existentes).
3. Hacer **Commit changes**. Render debe redesplegar el servicio desde `main`.
4. Si no hubo redeploy automático, pulsar **Manual Deploy → Deploy latest commit** en Render.

## Variables de entorno (Render → plaka-pikete-worker → Environment)
- `PIKETE_WORKER_KEY`: clave aleatoria de al menos 32 caracteres; **rota la anterior, que fue compartida en el chat.** No publicar ni enviarla.
- `PIKETE_SUPABASE_B_URL` = `https://cpdklixfmiibrcptleir.supabase.co`
- `PIKETE_SUPABASE_C_URL` = `https://wxleseokrzltkuyjmjev.supabase.co`

Las URL no son secretos. En esta fase **no necesitas ni debes añadir service_role, anon key, bot tokens o credenciales de Google.** El diagnóstico accede únicamente al endpoint de salud de Supabase Auth, sin consultar ninguna tabla.

## Comprobaciones
### Pública
`https://plaka-pikete-worker.onrender.com/health`

Debe mostrar `version: pikete-render-b-0.2.0` y `mode: supabase-connectivity`.

### Privada: diagnóstico B y C
Desde **PowerShell** en un ordenador, pega las cuatro líneas y escribe la **clave nueva** cuando te la solicite (no aparece en pantalla):

```powershell
$secret = Read-Host 'Clave nueva de PIKETE_WORKER_KEY'
$headers = @{ Authorization = "Bearer $secret" }
try { Invoke-RestMethod -Uri 'https://plaka-pikete-worker.onrender.com/api/supabase/check' -Headers $headers -Method Get | ConvertTo-Json -Depth 5 } catch { if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message } }
Remove-Variable secret, headers
```

**Resultado ideal:** `"ok": true` y nodos B/C `"state":"reachable"`. Si retorna `reachable_auth_restricted`, Render llegó al servidor pero el servicio Auth rechazó la comprobación sin credenciales; no significa necesariamente que la base esté rota. Si `network_error` o `timeout`, necesitamos revisar conexión y reglas de red. La respuesta HTTP 503 indica que uno o ambos nodos aún no alcanzan `reachable`.

También se puede ejecutar `npm test` localmente: no consume red y valida el parser anti-SSRF y los estados.

## Lo que esta fase NO hace
- No conecta credenciales SQL ni inspecciona datos o colas.
- No crea tablas ni RPCs; el esquema diseñado previamente para la base principal referencia `auth.users` y **no se puede copiar sin adaptación a Supabase B/C**.
- No descarga música, no usa Telegram, no sube audio ni da acceso a playlists.

**Siguiente fase prevista:** migración mínima en B/C con `user_id uuid` canónico del proyecto principal sin claves foráneas a `auth.users` local, y RPCs de cola de privilegios mínimos. Render B reclamará trabajos solo tras validar identidad y autorización a través del gateway.
