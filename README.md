# PLAKA PIKETE · Render B 0.6.0 · Pipeline de normalización

## Qué hace
- Conecta las referencias externas de `pikete_playlist_items` con trabajos `pikete_jobs` creados por trigger SQL.
- Un procesador HTTP de un solo lote reclama el trabajo mediante RPC atómica, lee el ítem, normaliza artista/título/versión, registra JSON estructurado y finaliza en la MISMA transacción SQL (sin marcar audio como compartible).
- Reintenta fallos transitorios, envía entradas inválidas a revisión manual y respeta el lease.
- Mantiene los endpoints previos y los dos nodos B y C.

## Instalación
1. Subir este ZIP descomprimido a `Eduardolv02/plaka-pikete-worker`, sobrescribiendo los archivos y conservando la estructura `src`, `sql`, `tests`.
2. Render desplegará automáticamente. Abrir `https://plaka-pikete-worker.onrender.com/health`: `pikete-render-b-0.6.0`.
3. En Render **Environment** agregar `PIKETE_QUEUE_MUTATIONS_ENABLED=true` y `PIKETE_PROCESSOR_ENABLED=true` solo cuando estés listo para activar el procesamiento de metadatos. Las claves y URLs existentes se mantienen.

## Migraciones SQL
El archivo `sql/004_pikete_normalization_pipeline.sql` ya se aplicó a los Supabase B y C durante la preparación. **NO lo ejecutes otra vez.** La instalación fue aditiva y no modificó Supabase A.

## Ruta nueva
`POST /api/queue/process-once`

Autenticación: `Authorization: Bearer <PIKETE_WORKER_KEY>`

Ejemplo body: `{"node":"both","limit":2}` (máximo 3 por nodo por tick; colas consultadas B y C).

Retorna `nodes` con trabajos reclamados y sus resultados. **No descarga audio, no publica música, no genera enlaces de Telegram y no marca `ready`**. Los ítems normalizados quedan en `state='matching'`, `normalization_status='normalized'`, a la espera del cotejo de catálogo real y revisión de derechos.

## Automatización
Render Free puede suspenderse tras periodos de inactividad. El paquete separado de Cloudflare Gateway 1.3 incorpora un disparador puntual al añadir una referencia y compatibilidad con **Cron Trigger**, a configurar manualmente en Cloudflare. Con la automatización desactivada, puedes invocar esta ruta para procesar una tanda.

## Qué NO hace todavía
- Búsqueda exhaustiva de tracks publicados en Supabase A, huellas de audio o comparación de ISRC con fuentes reales.
- Descargar audio de enlaces externos, determinar derechos automáticamente o archivarlo en Telegram.
- Marcar pistas como listas para la reproducción. Eso requiere validar archivo y permisos.

## Tests
`npm test` (44 pruebas verificadas).
