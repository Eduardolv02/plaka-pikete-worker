# PLAKA PIKETE · Render B v0.7.0 — Identificación + catálogo completo

**Actualización integral sobre v0.6.0.** Mantiene el normalizador, las colas, las invitaciones (gestionadas por Cloudflare B), las listas y el procesamiento por tick. No descarga música externa ni sube a Telegram. Reutiliza los IDs publicados de Plaka A.

## Nuevas funciones

- Búsqueda **paginada** del catálogo de `plaka_tracks` publicado, sin depender de las primeras 30 publicaciones del feed de Cloudflare A.
- Resolución por **ID exacto de Plaka**. Solo devuelve `eligible=true` cuando el registro sigue publicado, tiene `rights_attested=true` y está vinculado al archivo Telegram de Plaka existente. Un enlace de reproducción real lo resuelve el reproductor Android por el Gateway A.
- Detección de duplicados **solo por hash SHA-256 idéntico** cuando existe; títulos iguales NO prueban que dos audios sean iguales.
- Un trabajo `match` adicional por referencia externa normalizada. Compara candidato artista/título, variantes (`live`, `remix`, etc.), duración y puntúa coincidencias. Nunca activa el audio únicamente por texto.
- `POST /api/catalog/search` privado, body `{"query":"Daft Punk","page":0}`; respuesta incluye 25 canciones por página y `has_more`.
- `POST /api/catalog/track` privado, body `{"track_id":"uuid-de-plaka"}`; verifica publicación, archivo y atestación del artista.

## Variable nueva OBLIGATORIA para buscar el catálogo completo

Render → `plaka-pikete-worker` → Environment:

`PIKETE_SUPABASE_A_SECRET_KEY=sb_secret_...`

Obtenerla en el Supabase **PRINCIPAL**, proyecto `nfmdkhmjjmkhlyhkgfow`, **Project Settings → API Keys → Secret keys**. Esta variable se configura exclusivamente en Render, **NUNCA se introduce en Android ni en el repositorio GitHub**. Las variables existentes para Supabase B/C y `PIKETE_WORKER_KEY` se conservan.

> Las tablas del Supabase principal no se cambian. Esta consulta requiere un acceso de backend a su API REST porque el rol `anon` no tiene permisos de SELECT sobre `plaka_tracks`.

## Orden de publicación

1. Configurar `PIKETE_SUPABASE_A_SECRET_KEY` en Render.
2. Subir todo este ZIP descomprimido al GitHub `Eduardolv02/plaka-pikete-worker`, sobre el contenido existente. Render despliega v0.7.0.
3. Actualizar Cloudflare Gateway B con su paquete v1.4.0.
4. Instalar Android Plaka 2.4.8 para la interfaz de búsqueda y escucha compartida.
5. **Tras confirmar que Render está en v0.7.0 y la nueva clave funciona**, aplicar a Supabase B y C la migración **`sql/006_pikete_catalog_match_activate.sql`**, una sola vez, para empezar a crear trabajos `match` automáticamente. ChatGPT puede aplicarla directamente, sin que tengas que copiar SQL.

La migración `sql/005_pikete_catalog_match.sql` **YA ESTÁ INSTALADA en B y C**: índice parcial y RPC para registrar candidatos. NO volver a ejecutarla.

La migración `006` todavía no se ha aplicado, deliberadamente: v0.6.0 marca los trabajos de tipo `match` como no soportados. Se activa solamente después del despliegue nuevo.

## Comprobaciones

- `GET https://plaka-pikete-worker.onrender.com/health` → `pikete-render-b-0.7.0`, `catalog-identification`.
- `GET https://plaka-pikete-gateway.plakaplayeroficial.workers.dev/health` → `pikete-gateway-b-1.4.0`, `catalog-linking`.
- Busca un título real en la pantalla Android: debe aparecer el catálogo publicado.
- Una referencia externa seguirá en `matching` hasta elegir el ID exacto si hay ambigüedad o coincidencia por metadatos.
- Un ID publicado elegible genera item `source_type=plaka`, `state=ready`, `rights_status=cleared`. La app usa el mismo `PlakaCloudConfig.playUri` y Media3 que la biblioteca.

## Limitaciones honestas

1. `rights_attested` refleja la declaración del artista en Plaka, no una revisión jurídica independiente.
2. Los metadatos de una URL externa no son una huella de audio. Nunca damos por identificado un remix, directo u otra grabación distinta solo por título.
3. La búsqueda online por página funciona desde el servidor y requiere conexión, no es catálogo offline.
4. La búsqueda de **candidatos automáticos** recupera hasta 600 títulos por búsqueda y marca `incomplete_search=true` si alcanza ese límite. La búsqueda interactiva del catálogo es paginada.
5. La reproducción de temas de Plaka utiliza el archivo Telegram ya asociado al ID; si está temporalmente inaccesible, Media3 mostrará el error normal del reproductor.

## Tests

`npm test` (Node 20+). En esta entrega han pasado 53 pruebas del servidor Render, más 44 del Gateway B.
