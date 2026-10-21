# PLAKA PIKETE · Render B v0.4.0 · Fase 4: motor de colas

## Estado de esta fase

- **Supabase B** (`cpdklixfmiibrcptleir`): las cuatro RPC de esta fase fueron instaladas y verificadas.
- **Supabase C** (`wxleseokrzltkuyjmjev`): las cuatro RPC de esta fase fueron instaladas y verificadas.
- La app Plaka, Gateway A, Supabase A y Render A no se modificaron.
- **Procesamiento automático desactivado**. No se descargan canciones, no se consulta Telegram, no se normalizan automáticamente trabajos.

## ¿Qué se instala?

En `sql/003_pikete_queue_rpc.sql`:

| RPC | Función |
| --- | --- |
| `pikete_queue_status()` | Conteo por estado, colas listas y reservas vencidas |
| `pikete_queue_claim(worker, batch_size, lease_seconds)` | Reserva atómica de hasta 10 trabajos con `FOR UPDATE SKIP LOCKED` |
| `pikete_queue_heartbeat(job_id, worker, progress, lease_seconds)` | Renueva una reserva válida y actualiza progreso |
| `pikete_queue_finish(job_id, worker, outcome, error_code, retry_seconds)` | Cierra o reprograma trabajo bajo propiedad de la reserva |

**Seguridad de las RPC:** se ejecutan como invocador (`SECURITY INVOKER`) y `EXECUTE` está concedido solo a `service_role`. Se comprueba la propiedad y vigencia de cada reserva antes de renovarla o terminarla.

## Paso 1: actualizar el mismo repositorio de GitHub

1. Descarga y descomprime este ZIP.
2. Abre https://github.com/Eduardolv02/plaka-pikete-worker.
3. Usa **Add file → Upload files** y sube todos los archivos descomprimidos, manteniendo las carpetas `src`, `tests` y `sql`.
4. GitHub debe reemplazar `server.mjs`, `package.json` y `README.md`, y añadir `src/pikete-queue.mjs`, `tests/pikete-queue.test.mjs` y el SQL de migración.
5. Pulsa **Commit changes** y espera el despliegue automático en Render.

**No hace falta ejecutar el SQL de la carpeta `sql`: ya se aplicó a B y C.** Lo incluimos para mantener la migración documentada en el repositorio y para poder reproducirla en el futuro.

## Paso 2: verificar Render B

Abre https://plaka-pikete-worker.onrender.com/health.

Debes ver la versión `pikete-render-b-0.4.0` y modo `queue-rpc-ready`.

## Paso 3: diagnóstico privado de las colas

Con la misma clave `PIKETE_WORKER_KEY` ya configurada en Render, llama a:

`GET https://plaka-pikete-worker.onrender.com/api/queue/status`

Usa el encabezado `Authorization: Bearer <PIKETE_WORKER_KEY>`.

Resultado esperado para ambas colas recién creadas: `state: ready`, `counts.total: 0`, `polling: disabled`.

**No se requiere ninguna variable nueva para este paso.** `PIKETE_QUEUE_MUTATIONS_ENABLED` permanece desactivada por defecto.

## Rutas privadas añadidas

- `GET /api/queue/status`: resumen de B y C (no muta datos).
- `POST /api/queue/claim`: reserva trabajos (bloqueada por defecto).
- `POST /api/queue/heartbeat`: renueva reserva (bloqueada por defecto).
- `POST /api/queue/finish`: finaliza o reintenta (bloqueada por defecto).

Para habilitar **más adelante** las operaciones de escritura desde el backend, configura **`PIKETE_QUEUE_MUTATIONS_ENABLED=true`** solo cuando el Gateway y el procesador estén preparados y hayamos probado los flujos. No activar ahora.

## Qué falta para reproducir canciones compartidas

1. Gateway B: comprobar JWT del Supabase A, autorización y asignación estable de usuario/playlist al nodo B o C.
2. Productor de trabajos desde app/Gateway, con deduplicación.
3. Procesador efectivo que haga normalización, coincidencia de catálogo y revisión de derechos; nunca marcar un audio como compartible sin comprobaciones.
4. Archivado y enlaces de reproducción con autorización.
5. Pruebas de concurrencia, capacidad y funcionamiento desde Cuba.

## Tests

`npm test` (Node 20+).
