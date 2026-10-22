# PIKETE — Render B 1.2 (candidato, NO desplegado)

## Cambio real

Nuevo endpoint autenticado `POST /api/archive/ingest-approved-source`.

Recibe una URL HTTPS de un proveedor **expresamente autorizado y configurado por PLAKA** y ejecuta la ruta existente `ingestOwnerAudio`: comprobacion de propiedad, consentimiento, MIME y firma binaria, SHA-256, deduplicacion en B/C, Telegram `sendAudio`, indice Supabase y asociacion a la cancion para streaming de Plaka Studio.

El endpoint exige header `Authorization: Bearer <PIKETE_WORKER_KEY>`; la clave solo debe existir entre servicios, nunca en Android.

## Configuracion (Render B)

```
PIKETE_APPROVED_INGEST_ENABLED=true
PIKETE_APPROVED_AUDIO_HOSTS=media.tu-dominio-autorizado.example
PIKETE_ARCHIVE_UPLOADS_ENABLED=true
```

Tambien requiere las variables Supabase B/C y tokens del bot de la instalacion actual.

La URL de audio debe estar en uno de los dominios exactos aprobados. Solo HTTPS, sin redireccion, audio/mpeg o audio/mp4; longitud declarada entre 512 B y 19 MiB. Se valida la firma real del archivo. Sin URL aprobada y consentimientos, se rechaza.

### Peticion interna (ejemplo, sin credenciales)

```http
POST /api/archive/ingest-approved-source
Authorization: Bearer <SERVER_WORKER_KEY>
Content-Type: application/json

{
  "node": "B",
  "playlist_id": "<UUID>",
  "item_id": "<UUID>",
  "owner_id": "<UUID>",
  "audio_url": "https://media.tu-dominio-autorizado.example/audio/authorized.mp3",
  "mime": "audio/mpeg",
  "owner_confirmed_rights": true,
  "provider_download_authorized": true
}
```

## Limitaciones IMPORTANTES (pendientes para automatizacion completa)

- Este endpoint **no obtiene audio de videos de YouTube**, ni convierte automaticamente sus coincidencias en archivos.
- MusicBrainz y YouTube son fuentes de **identificacion**, no de audios redistribuibles por defecto.
- Aun falta conectar `confirm-video` / confirmacion de tema con una **cola de archivo** y un proveedor licenciado que produzca la URL de audio aprobada. Esta version prepara el adaptador de entrada, no completa esa conexion.
- El origen debe controlar los derechos y proporcionar URL de audio valida; la clave de Render nunca debe exponerse al cliente.
- No hay procesador FFmpeg en Render para fuentes que no sean MP3/M4A ya admitidos. La normalizacion transcoding se realiza antes de la entrada.
- Idempotencia concurrente de dos subidas simultaneas necesita un bloqueo distribuido/registro unico para evitar dos mensajes Telegram ante carreras simultaneas; el SHA-256 evita duplicados secuenciales ya indexados.
- No publicar sin integrar prueba de descarga autorizada, insercion y reproduccion real cross-device.

## Comprobacion realizada

`npm test`: 74/74, incluidas pruebas de listas de permitidos, derechos, MIME, redirecciones y circuito simulado source→bot→indice→item.

No se han cambiado servicios ni datos en produccion.
