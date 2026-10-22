# Pikete — Modo de prueba con artistas autorizados

Esta variante **no pregunta por derechos en cada canción**. El operador certifica de una vez los artistas permitidos y suministra el audio desde un dominio HTTPS aprobado.

## Variables en Render (solo entorno de pruebas)

```dotenv
PIKETE_TEST_MODE=true
PIKETE_TEST_RIGHTS_ATTESTED=true
PIKETE_TEST_APPROVED_ARTISTS=Artista de prueba,Otro artista autorizado
PIKETE_APPROVED_AUDIO_HOSTS=audio-autorizado.ejemplo.com
PIKETE_APPROVED_INGEST_ENABLED=true
PIKETE_AUTO_ARCHIVE_ENABLED=true
PIKETE_LICENSED_AUDIO_CATALOG_JSON={"artista de prueba:cancion de prueba":{"audio_url":"https://audio-autorizado.ejemplo.com/cancion.mp3","mime":"audio/mpeg"}}
```

`PIKETE_TEST_RIGHTS_ATTESTED=true` solo debe activarse cuando el operador haya confirmado permiso de descarga y distribución para los artistas de esa lista. Este ajuste no concede derechos ni descarga audio de YouTube. MusicBrainz y YouTube continúan siendo fuentes de metadatos; se necesita un MP3/MP4 en el dominio permitido. En producción dejar `PIKETE_TEST_MODE=false` y exigir `download_authorized` y `redistribution_authorized` por archivo en el catálogo.

No publicar esta prueba sobre el servicio actual sin validar los demás componentes y permisos.
