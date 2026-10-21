# PLAKA PIKETE 1.8 — Normalización individual, búsqueda por duración y cola de 24 h

## Paquete y estado de verificación

- **Render B 1.0.0**: 64 tests locales superados y `/health` probado en un servidor Node local.
- **Cloudflare B 1.8.0**: 59 tests locales superados.
- **Android 2.5.1**: revisión estática; **APK NO compilado** en este entorno. Compilar desde Android Studio y enviar el error si aparece alguno.
- **Supabase B y C**: migraciones de esquema y RPC ya instaladas en la infraestructura conectada. Comprobación transaccional positiva en B, esquema confirmado en ambos. No ejecutar SQL otra vez sin comprobar historial.
- Las versiones nuevas **todavía NO están publicadas** en GitHub/Render/Cloudflare ni instaladas en Android hasta realizar los pasos indicados.

## Comportamiento

1. Solo el propietario añade canciones desde su biblioteca local, con título y artista confirmados. Cada pista crea un trabajo `normalize` en la cola de su nodo B/C.
2. Render normaliza nombre, artista, variantes y duración. Busca en el catálogo Plaka y mediante la API oficial de YouTube (si está configurada).
3. Ordena los primeros candidatos según artista, título, diferencia de duración y conflicto de versiones.
4. Si existe una coincidencia fuerte (incluido margen ante segundos resultados) y duración compatible (hasta 2 segundos), se pasa a `awaiting_audio` sin preguntar. **Esto no certifica que el audio sea idéntico**.
5. Si no hay coincidencia fiable, o el índice de Telegram detecta una posible copia por metadatos, la canción pasa a `needs_confirmation`. Android pregunta "¿Tu canción es ...?" y muestra hasta 4 candidatos con duración y enlace; también existe "Ninguna coincide".
6. El índice de audio se consulta en Supabase **B y C**, ya que Telegram no ofrece búsqueda general del historial de los canales a los bots. La coincidencia artista/título/duración es **solo una sugerencia**; el mismo SHA-256 de los bytes sí identifica una copia exacta. Cuando se envía una copia autorizada, Render primero busca esa huella en **ambos nodos** y reutiliza el bot + `file_id` si existe, sin volver a subir a Telegram.
7. `ready` solo cuando el archivo está efectivamente archivado o se ha vinculado una publicación real de Plaka. Los invitados siguen siendo de solo lectura.

## Prioridad de silverdry

**La prioridad se reconoce mediante UUID verificado de Supabase Auth, nunca por nombre ni correo visible.**

En **Cloudflare B → Variables and Secrets** añadir:

`PIKETE_PRIORITY_USER_ID=UUID_DE_LA_CUENTA_SILVERDRY`

Se obtiene entrando desde esa cuenta a **Plaka → Círculo → Pikete → Copiar mi código**.

El Gateway valida la identidad con Supabase A; solo los ítems creados por el propietario con ese UUID obtienen `processing_tier='priority'`, y su `pikete_jobs.priority=9` (frente a 5 estándar). Si `PIKETE_PROCESSOR_AUTOTRIGGER_ENABLED=true`, además de la cola Cron, pide un tick inmediato para esa cuenta. Esto da prioridad real **en metadatos y detección**, pero no supone que una copia de audio no existente aparezca sin una fuente autorizada.

## Cuentas estándar: ventana de preparación

Cada nueva canción local tiene `preparation_due_at=creación + 24 horas` para el **objetivo operativo**, sin obligar a esperar 24 horas si se completa antes. Android y los invitados mostrarán "Preparando tu Pikete, puede tardar varias horas; objetivo: dentro de 24 horas" mientras alguna pista carezca de audio. **No es una garantía automática de 24 horas**: se necesita suficiente capacidad de procesamiento y una copia autorizada para archivar. Si falla la API de YouTube, no se inventa un candidato.

## Publicar (en este orden)

1. **Render B**: reemplazar archivos de `PLAKA_PIKETE_RENDER_B_V1_0_GITHUB.zip` en el repositorio `plaka-pikete-worker`. Conservar las variables actuales (Supabase B/C secret, A secret, worker key, Telegram bots 1/2). Para candidatos YouTube requiere `PIKETE_YOUTUBE_DATA_API_KEY` (YouTube Data API v3). Comprobar `/health` versión `pikete-render-b-1.0.0`.
2. **Cloudflare B**: pegar `worker.mjs` del paquete Gateway v1.8 en `plaka-pikete-gateway` y **Deploy**. Agregar `PIKETE_PRIORITY_USER_ID` con el UUID de silverdry. Conservar `PIKETE_RENDER_B_WORKER_KEY`, secretos Supabase B/C y Cron `*/10 * * * *`. Comprobar `/health` versión `pikete-gateway-b-1.8.0`.
3. **Android**: sustituir carpeta `app` del proyecto original por Android 2.5.1 o aplicar el parche de 2.5.0 a 2.5.1. Compilar e instalar. La navegación Pikete dentro de Círculo se mantiene.
4. **Prueba**: cuenta normal añade una canción local con título, artista y duración. Comprobar `queued → needs_confirmation → awaiting_audio → ready` (seleccionando o descartando candidatos y archivando después la copia autorizada). En la cuenta silverdry repetir y verificar prioridad; con otra cuenta invitada confirmar que puede escuchar el archivo `ready`, pero no alterar la lista.

## Importante sobre YouTube y Telegram

El buscador de YouTube identifica **candidatos de metadatos**; **no descarga ni convierte automáticamente vídeos comerciales de YouTube**. El archivo actual se obtiene de la copia local que el propietario pueda distribuir y autorice explícitamente. El laboratorio de Windows 1.7, para vídeos con permiso de descarga, sigue siendo independiente de la cola de producción. La integración de extracción automática autorizada requiere un procesador asíncrono con capacidad de FFmpeg, fuente con derechos verificados, y controles de reintento/tiempo; esta versión no lo promete.

Las canciones subidas anteriormente por el laboratorio de Windows a Telegram **no están automáticamente indexadas** en las tablas B/C; las nuevas copias archivadas desde Pikete sí se indexan.

## Cambios de esquema

Incluido `sql/008_pikete_preparation_queue_priority.sql` para documentar las migraciones ya aplicadas a B y C. Las funciones SQL incluyen una condición transitoria que permite seguir archivando con la versión 2.5.0 para pistas creadas por el Gateway antiguo (`preparation_due_at` nulo), a fin de no interrumpir el uso mientras se despliega la nueva app.
