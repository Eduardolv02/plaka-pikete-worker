# Pikete Render B 0.8.0 — Local-first

El procesador acepta `source_type=local` y `external`.
- Para local lee `local_duration_ms` de Supabase B/C y exige que `artist` y `title` existan según el Gateway y el CHECK SQL.
- Normaliza texto, marca versiones (`live`, `remix`, etc.), utiliza la duración para el cotejo y consulta los candidatos del catálogo A cuando está configurado. Guarda la coincidencia en `normalized_metadata.catalog_match` sin habilitar `ready`.
- Si el catálogo temporalmente falla, almacena metadatos normalizados y `catalog_match.status=temporarily_unavailable`.
- Reproduce solamente cuando un usuario selecciona un ID publicado y elegible, gestionado por Cloudflare B/Android. Nunca lee/sube bytes de audio local.

Despliegue: sobrescribir todo el repo GitHub del servidor actual y conservar variables. Nuevo `/health`: `pikete-render-b-0.8.0`.
SQL ya aplicado en B y C: `sql/005_pikete_local_library.sql`.
