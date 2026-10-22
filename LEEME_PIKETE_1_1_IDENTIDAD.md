# Pikete — Render B 1.1 · identidad musical y deduplicación

## Incluido y probado
- Búsqueda en el catálogo publicado de PLAKA A (existía en 1.0).
- Búsqueda en MusicBrainz de **metadatos de grabación**, con título, artista, duración y registro MBID; no descarga audio.
- Identidad sugerida en `normalized_metadata.recording_identity`: candidato Plaka A, MBID, indicio de archivo en Pikete.
- SHA-256 sigue siendo la única prueba de **identidad exacta de bytes**: la función de archivo existente reutiliza los archivos de ambos shards B/C cuando su hash es idéntico.
- No se confunde portada/letras encontradas con audio reproducible.
- `sql/009_pikete_recording_identity.sql`: campos de MBID y Plaka, índices y tabla privada `pikete_play_events` preparada para eventos idempotentes.

## PENDIENTE (NO afirmar que funciona hoy)
- MusicBrainz identifica grabaciones, pero NO autoriza descargas ni el uso de una copia ajena. No se activa la descarga automática de canciones de YouTube en producción. Para audio nuevo sigue siendo necesaria una fuente legalmente descargable o el archivo que el propietario está autorizado a distribuir.
- El catálogo de PLAKA solo se reutiliza directamente cuando se confirma expresamente el ID de la pista publicada; una coincidencia por texto no basta.
- `pikete_play_events` es infraestructura SQL, todavía falta conectar a ella los heartbeats reales firmados del reproductor y agregar contadores de «escuchando ahora», con deduplicación de sesiones y expiración; no simular estadísticas.
- La identificación global B/C por MusicBrainz requiere una política de canonicalización y verificación cruzada. Un MBID coincidente sin hash/fuente certificada no permite tomar un archivo como exacto.
- MusicBrainz exige que el cliente respete su tasa de acceso, política de User-Agent y condiciones de uso; configurar `PIKETE_MUSICBRAINZ_USER_AGENT` con contacto apropiado y ajustar el disparo de los jobs según límites del servicio.
- Este paquete NO modifica Android, Cloudflare o producción. Instalar SQL 009 manualmente en ambos shards B/C antes de explotar nuevos campos en APIs.

## Instalación
1. Subir el contenido de este ZIP al repositorio utilizado por **Render B** (no al Worker de Cloudflare).
2. Ejecutar `npm test` (en este paquete: 70/70) y desplegar cuando corresponda.
3. Revisar y aplicar `sql/009_pikete_recording_identity.sql` en Supabase B y C, separadamente, cuando se habiliten las siguientes rutas de playback analytics.
4. Conectar el registro de escucha firmado en el Gateway y el reproductor en una entrega posterior; la tabla por sí sola no registra nada.
