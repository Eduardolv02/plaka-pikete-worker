# PLAKA PIKETE — Render B v0.5.0 · Motor de normalización (primera fase)

## Objetivo

Dejar de tratar las referencias externas como títulos libres. Separa la limpieza de metadatos, la identificación de versiones, las coincidencias con candidatos del catálogo y la comprobación de derechos. **No descarga, reproduce ni publica audio.**

## Instalación

1. Descomprimir ZIP y subir todos sus archivos al repositorio GitHub `Eduardolv02/plaka-pikete-worker` manteniendo las carpetas.
2. Render realiza el despliegue automático (mismo servicio `plaka-pikete-worker`).
3. Las variables existentes son suficientes. NO activar `PIKETE_QUEUE_MUTATIONS_ENABLED` todavía.
4. Comprobar `https://plaka-pikete-worker.onrender.com/health`: versión `pikete-render-b-0.5.0` y modo `normalization-engine-preview`.

## Endpoint privado nuevo

`POST /api/normalize/inspect`, encabezado `Authorization: Bearer <PIKETE_WORKER_KEY>`, `Content-Type: application/json`.

### Ejemplo

```json
{
  "source_url": "https://youtu.be/dQw4w9WgXcQ",
  "catalog_candidates": [
    {"id":"track-1", "artist":"Rick Astley", "title":"Never Gonna Give You Up"},
    {"id":"track-2", "artist":"Rick Astley", "title":"Never Gonna Give You Up (Live)"}
  ]
}
```

- Admite links HTTPS de YouTube, Spotify y SoundCloud; consulta **solo** metadatos oEmbed en dominios predefinidos.
- Analiza variaciones: *live, remix, slowed, sped up, instrumental, acoustic, cover, remaster, demo, karaoke, radio edit*.
- Distingue coincidencia por nombre, ambigüedad y conflicto de versión.
- `catalog_candidates` es temporal y de **demostración**: todavía falta conectarlo a la búsqueda paginada del catálogo real, sin el límite del feed de 30 canciones.
- **NUNCA** interpreta un título coincidente como confirmación de versión oficial o autorización de compartir.
- `ready_to_share` siempre `false` hasta que tengamos procedencia comprobada y derechos.

## Próximo bloque integrado

1. Producir `pikete_jobs` al añadir una referencia a la lista (Gateway B).
2. Consumir trabajos bajo reserva y reintentos de RPC actuales (Render B), guardar `normalized_metadata` y estado de coincidencia.
3. Buscar de verdad en el catálogo completo y fuentes musicales de metadatos (búsqueda paginada/ISRC/huellas).
4. Validar permisos de audio y evitar duplicados en Telegram cuando el material esté autorizado.
5. Exponer el estado del trabajo en Android y permitir revisión manual cuando haya ambigüedad.

No hay cambios en Supabase ni en Android en este ZIP. El endpoint `/api/normalize` original sigue disponible.
