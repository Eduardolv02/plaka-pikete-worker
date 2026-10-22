# Pikete — modo de pruebas continuas sin límite acumulado

Esta variante permite ejecutar repetidamente el autoarchivo con la misma configuración de Render: **sin cuota acumulada de canciones ni reinicios de configuración por prueba**. Cada barrido procesa hasta 100 solicitudes (25 por defecto), y los siguientes barridos siguen procesando el resto. Este límite por petición evita saturar Render y Telegram; **no limita el número total de canciones**.

No altera las condiciones de permisos ni convierte un resultado de YouTube en audio descargable. Mantén en Render una lista persistente de artistas autorizados y un catálogo de enlaces HTTPS con permiso de descarga/distribución comprobado. La configuración se realiza una vez; puedes seguir haciendo pruebas con esas grabaciones sin tocarla de nuevo.

Variables de ejemplo (no publicar credenciales):

```dotenv
PIKETE_TEST_MODE=true
PIKETE_TEST_RIGHTS_ATTESTED=true
PIKETE_TEST_APPROVED_ARTISTS=Nombre del artista autorizado
PIKETE_APPROVED_AUDIO_HOSTS=audio.ejemplo.org
PIKETE_APPROVED_INGEST_ENABLED=true
PIKETE_AUTO_ARCHIVE_ENABLED=true
PIKETE_LICENSED_AUDIO_CATALOG_JSON={"artista autorizado:tema":{"audio_url":"https://audio.ejemplo.org/tema.mp3","mime":"audio/mpeg"}}
```

Requisitos para terminar la cadena: audio existente en la fuente autorizada, canción normalizada y confirmada, worker de Render y Gateway configurados y desplegados, bots y canal con permisos de publicación, y vinculación a la lista. No equivale a un servicio que descarga automáticamente cualquier video de YouTube.

**Decisión de proyecto pendiente:** implementar el registro verificado de artistas/grabaciones y sus licencias (identidad estable, alcance territorial, permiso de descarga, copia, distribución y expiración). No sustituirlo por una coincidencia de nombre ni por un interruptor global de derechos.
