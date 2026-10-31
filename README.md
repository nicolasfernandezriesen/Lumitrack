# Lumitrack

Visualizador de audio con barras de luz audiorrítmicas e iluminación dinámica
según la portada de la canción. Buscás un tema/artista/album/video/playlist, se reproduce
solo el audio, y el fondo/las barras toman los colores de la
portada.

Pensado para dejarlo de fondo en una PC o TV.

## Uso en Windows

### App de escritorio, desde el código

1. Instalá **Node.js** (22 o superior) desde https://nodejs.org si todavía
   no lo tenés. Hace falta para desarrollar y para generar el instalador.
   La app ya instalada no lo necesita.
2. Hacé **doble clic en `Lumitrack.bat`**.

La primera vez instala dependencias (incluye Electron) y, si faltan,
descarga **yt-dlp** y **ffmpeg** en `bin/`. Después abre una ventana
propia: el servidor queda en `127.0.0.1` y no se abre el navegador.

### Probar la misma interfaz en el navegador

```bash
npm start
```

Levanta el servidor en `http://127.0.0.1:3000` y abre el navegador. Útil
para tocar la interfaz sin pasar por Electron.

### Instalador

Desde `lumitrack/`:

```bash
npm run dist
```

El setup de Windows queda en `installer/dist/` (en la raíz del repo).
Esa carpeta no se versiona. Para generar el `.exe` local: `npm run dist`.
Para publicar Release + `latest.yml` (actualizaciones): `npm run dist:publish`
con `GH_TOKEN`. Quien lo instala no necesita Node. La ruta por defecto es
`C:\Program Files\Lumitrack` (en Windows en español, Archivos de programa).
El asistente deja cambiarla —otro disco, por ejemplo `D:\`— y crea esa
carpeta si todavía no existe. Después pregunta si crear un icono de
acceso directo en el escritorio y otro en el menú Inicio. Los dos
casilleros vienen marcados: si se desmarca uno, ese acceso no se crea.
Hace falta permiso
de administrador porque Program Files no es escribible para un usuario
normal.

El ícono de la app y del setup está en `installer/build/icon.ico`.
La app instalada puede chequear actualizaciones en segundo plano contra
GitHub Releases; muestra un modal con la versión disponible y espera la
confirmación del usuario antes de descargarla e instalarla.

yt-dlp y ffmpeg van dentro del instalador y, al primer arranque, se copian
a `%APPDATA%\Lumitrack\bin`. Esa carpeta es la `userData` de Electron
(AppData\Roaming\Lumitrack): binarios, caché de la ventana y, cuando
existan, configuración y bases de datos locales. Program Files no se
puede actualizar sin administrador, así que lo del usuario no va ahí.
Al iniciar, Lumitrack también comprueba en GitHub si hay una versión más
nueva de yt-dlp y actualiza el binario local automáticamente. Si no hay
conexión o falla esa actualización, conserva el binario instalado y
continúa con el arranque.

Al desinstalar se borra `%APPDATA%\Lumitrack` completo. El desinstalador
pregunta antes si mantener la información personal; el casillero viene
desmarcado. Si se marca, esa carpeta se conserva. Una actualización de
la app no la borra.

## Uso en Mac / Linux

`ffmpeg` no se descarga automáticamente — instalalo antes:

```bash
# Mac
brew install ffmpeg

# Linux (Debian/Ubuntu)
sudo apt install ffmpeg
```

```bash
npm run desktop   # ventana Electron
npm start         # navegador, para probar la interfaz
```

## Arquitectura

El proyecto separa responsabilidades en capas, tanto en el backend como
en el frontend, para que cada archivo tenga un único motivo para cambiar.

```
Lumitrack/
├── installer/                    → config del instalador (raíz del repo)
│   ├── electron-builder.yml
│   └── build/
│       ├── installer.nsh         carpeta, acceso directo y datos de usuario
│       ├── icon.ico              ícono Windows (app + setup)
│       └── icon.png              master del ícono
│
└── lumitrack/                    → código de la app
    ├── Lumitrack.bat              → abre la ventana de escritorio
    ├── start.js                   → modo navegador: setup → servidor → browser
    ├── setup.js                   → descarga yt-dlp/ffmpeg si faltan
    ├── desktop/                   → proceso principal de Electron
    │   ├── main.js
    │   └── splash.html
    ├── bin/                       → en desarrollo, yt-dlp y ffmpeg locales (no se versiona)
    │
    ├── server/
    │   ├── index.js                 → Express; startServer() escucha en 127.0.0.1
    │   ├── routes/                  → capa HTTP, sin lógica propia
    │   │   ├── searchRoutes.js        (búsqueda y canciones relacionadas)
    │   │   └── streamRoutes.js        (audio, caché y ventana de playlist)
    │   ├── services/
    │   │   ├── searchService.js       búsqueda en YouTube Music vía ytmusic-api
    │   │   ├── directUrlService.js    resuelve la URL del CDN antes del clic
    │   │   └── streamService.js       audio desde caché, CDN o yt-dlp
    │   └── infrastructure/
    │       ├── binaries.js            rutas a yt-dlp/ffmpeg
    │       ├── youtubeAudio.js        formato y vencimiento de la URL directa
    │       ├── streamUrlCache.js      URLs del CDN ya resueltas
    │       ├── playlistUrlCache.js    URLs de la ventana de playlist
    │       └── audioCache.js          audio en RAM: actual, historial y siguiente
    │
    ├── index.html                     → entry de Vite
    ├── vite.config.js
    ├── public/                        → estáticos de Vite (fonts/)
    ├── dist/                          → build del front (servido por Express)
    └── src/                           → frontend Vue 3
        ├── main.js / App.vue
        ├── composables/               → orquestación (playback, paneles UI)
        ├── services/                  → audio, playlist, API, colores, media keys
        ├── views/                     → componentes de interfaz
        └── styles/                    → CSS global + un archivo por vista
```

**Backend — flujo de una request:** `routes/` recibe el HTTP, llama a la
función correspondiente en `services/`, y esa función usa
`infrastructure/binaries.js` solo para saber qué ejecutable invocar. Las
rutas no saben cómo se arma el comando de yt-dlp, y los services no saben
nada de Express.

- **Búsqueda:** `GET /api/search?q=texto&filter=song` → busca en YouTube Music vía
  el paquete npm `ytmusic-api` (cliente Innertube no oficial, instalado
  solo en `node_modules` del proyecto). `filter` acepta `song` (por defecto),
  `artist`, `album`, `playlist` o `video` y devuelve hasta 12 resultados del
  tipo solicitado. Para canciones y videos, al responder el servidor empieza
  a resolver en segundo plano las URLs directas de audio de los resultados.
- **Detalles de artistas, álbumes y playlists:** `GET /api/artist/:artistId`,
  `GET /api/album/:albumId` y `GET /api/playlist/:playlistId` obtienen los
  metadatos y canciones desde YouTube Music. Para artistas se usan las canciones
  destacadas que entrega la librería (hasta diez); si la lista está vacía,
  Lumitrack consulta el catálogo de canciones del artista y muestra hasta diez.
  La respuesta de artista también inicia el prefetch de audio de esas canciones.
  La API no proporciona biografía ni audiencia mensual. Para álbumes, la
  librería no entrega una duración agregada; Lumitrack suma las duraciones
  individuales y muestra el total solo si todas están disponibles.
- **URLs de audio:** `directUrlService.js` resuelve las URLs del CDN
  mediante yt-dlp y limita a dos las resoluciones simultáneas. Las URLs
  vencen, así que la caché solo evita volver a resolverlas mientras
  sigan vigentes. Al sincronizar la playlist, la canción actual y la
  primera próxima se priorizan sobre las demás pistas pendientes.
- **Streaming y caché de audio:** `GET /api/stream/:videoId` sirve
  primero el audio completo que ya esté en RAM. Si no está cacheado,
  reenvía el audio del CDN a medida que llega; si aún no hay una URL
  válida o el CDN falla, usa yt-dlp como alternativa. El audio se
  acumula en paralelo y solo se conserva cuando la descarga termina
  correctamente. Las respuestas cacheadas admiten `Range`, lo que
  permite buscar posiciones de la pista sin volver a descargarla. El
  frontend consulta el estado con `GET /api/cached/:videoId` y puede
  esperar a que termine una descarga con `GET /api/cached/:videoId/wait`.
- **Prefetch de audio:** cuando hay una pista siguiente, el servidor la
  descarga en segundo plano para dejarla lista en RAM. Puede empezar
  cuando ya se recibieron 256 KiB de la pista actual; si la actual ya
  estaba cacheada, puede empezar enseguida. Si cambia la siguiente, se
  cancela el prefetch anterior. Al reproducirla se reutiliza la descarga
  o la caché existente en vez de iniciar una segunda.
- **Cachés en RAM:** `audioCache.js` mantiene la pista actual, hasta dos
  pistas del historial reciente y una siguiente prefetched; se descartan
  las entradas que salen de esa ventana. `playlistUrlCache.js` conserva
  las URLs vigentes de la actual, hasta dos pistas del historial y
  hasta veinte próximas. Ambas viven solo mientras corre el proceso: no
  persisten en disco y se vacían al cerrar la app. La caché general de
  URLs resueltas tiene un límite separado de 24 entradas.
- **Binarios:** `infrastructure/binaries.js` busca primero yt-dlp y
  ffmpeg en la carpeta de binarios (en desarrollo `lumitrack/bin/`; en
  la app instalada `%APPDATA%\Lumitrack\bin`) y, si no están, cae al
  PATH del sistema. El proceso de Electron setea esa carpeta antes de
  cargar el servidor, porque dentro del paquete de solo lectura no se
  puede ejecutar ni actualizar un binario.

**Frontend — flujo de una interacción:** Vue 3 + Vite. `App.vue` y los
composables (`usePlayback`, `useUiShell`) orquestan services y views.
Los módulos de `services/` (`audioEngine.js`, `colorExtractor.js`,
`searchApi.js`, `playlist.js`) no tocan el DOM de la UI. Las `views/`
son componentes Vue con su CSS en `styles/views/`; reciben datos y
emiten eventos. El build queda en `dist/` y Express lo sirve.

- **Visualización:** `audioEngine.js` conecta el `<audio>` a un
  `AnalyserNode`, hace FFT del audio en tiempo real, y entrega niveles ya
  mapeados a la cantidad de barras. `Visualizer.vue` los pinta por DOM
  directo (sin pasar por el virtual DOM).
- **Controles de reproducción:** `audioEngine.js` expone `play`,
  `pause`, `resume`, `replay` y `seek`, y notifica cambios de estado
  (`idle`/`playing`/`paused`/`ended`) y de progreso (tiempo actual /
  duración). `PlayerControls.vue` traduce eso a un único botón cuyo
  ícono y tooltip cambian según el estado, más el timer y la barra de
  progreso — clickeable para saltar a un punto de la canción, coloreada
  con el mismo acento dinámico que el título.
- **Filtros de búsqueda:** el filtro **Artista** reproduce con clic
  izquierdo las canciones más populares disponibles del artista (hasta
  diez); con clic derecho muestra **Ver detalle**, que abre un modal con
  su imagen, nombre y canciones destacadas, reproducibles individualmente.
  Los filtros **Álbum** y **Playlist** reproducen su contenido con clic
  izquierdo y ofrecen **Ver detalle** con clic derecho. **Video** reproduce
  el resultado seleccionado; las canciones y videos también ofrecen
  **Reproducir a continuación** desde el menú contextual.
- **Modales de detalle:** los detalles de artista, álbum y playlist cargan
  los datos bajo demanda y muestran estados de carga, errores o una lista
  vacía cuando corresponda. Al seleccionar una canción, se cierra el modal
  y comienza la reproducción desde esa posición con las demás canciones
  disponibles en la playlist. Se pueden cerrar con el botón, clic fuera del
  contenido o la tecla Escape.
- **Playlist:** `playlist.js` gestiona la canción actual, hasta diez
  canciones escuchadas y una cola de hasta veinte próximas. Al elegir
  una pista para reproducir, la playlist pide canciones relacionadas a
  `GET /api/related/:videoId`; el servidor consulta el "Up next" de
  YouTube Music, excluye canciones que ya están en la playlist y, si no
  alcanza, prueba una búsqueda por artista y título. Las relacionadas
  se agregan a la cola automáticamente. Desde los resultados se puede
  elegir **Reproducir a continuación**, que pone esa pista al principio
  de la cola sin quitar las demás; desde la playlist se puede reproducir
  una pista o quitarla del historial o de la cola.
- **Navegación de playlist:** el botón anterior reinicia la pista si ya
  pasaron más de diez segundos; al comienzo, retrocede al historial. El
  botón siguiente y el fin de la pista avanzan por la cola. Si la cola
  está vacía, intenta cargar relacionadas antes de detenerse. La ventana
  de playlist se sincroniza con el backend mediante
  `POST /api/playlist/window` para mantener precargadas las URLs y el
  audio de la siguiente pista.
- **Reposición de playlist:** al avanzar a la siguiente canción o quitar
  una de las próximas, solicita relacionadas para reponer la cola hasta
  veinte. La reposición excluye la canción quitada para que no reaparezca
  inmediatamente.
- **Volumen:** `volumeControl.js` abre un control de nivel y silencio.
  `audioEngine.setVolume` aplica el valor; con el audio silenciado, las
  barras quedan en un mínimo.
- **Pantalla completa:** `fullscreenToggle.js` entra y sale, también con
  F11. En Electron es el fullscreen nativo de la ventana y, al salir,
  vuelve al tamaño que tenía.
- **Color dinámico:** `colorExtractor.js` muestrea los píxeles de la
  portada en un canvas oculto y calcula un color dominante; `main.js` se
  lo pasa a `visualizer.applyPalette()`, que actualiza las variables CSS.

## Problemas comunes

- **"No se encontró Node.js instalado"** (al correr el `.bat`) → instalá
  Node desde https://nodejs.org y volvé a hacer doble clic.
- **La descarga de yt-dlp/ffmpeg falla** → normalmente es la conexión a
  internet en ese momento. Volvé a correr `Lumitrack.bat` (o `npm start`),
  retoma solo lo que falte.
- **"yt-dlp no está instalado o no se encuentra"** → en desarrollo,
  borrá `lumitrack/bin/` y volvé a abrir la app. En la app instalada,
  borrá `%APPDATA%\Lumitrack\bin` y abrila de nuevo.
- **La búsqueda no devuelve resultados o tarda mucho** → la búsqueda
  usa `ytmusic-api` (npm). Probá borrar `node_modules` y correr de
  nuevo `Lumitrack.bat` / `npm start` para reinstalar deps.
- **El audio corta o no carga** → al abrir, la app comprueba y actualiza
  yt-dlp automáticamente si hay conexión a internet. Si persiste, cerrá
  la app y borrá `bin/yt-dlp.exe` (o `bin/yt-dlp` en Mac/Linux) para que
  se descargue una copia nueva al próximo arranque.
- **Al hacer click en la barra de progreso la primera vez que suena una
  canción no salta bien (o tarda rato)** → la primera reproducción
  streaméa en vivo mientras cachea en RAM; apenas termina de bajar,
  el seek pasa a funcionar (y si clickeás antes, la app espera a que
  termine el cacheo y entonces salta).

## Instalador

La config vive en `installer/electron-builder.yml` y el setup generado
en `installer/dist/`. Esa salida no se versiona: se publica como GitHub
Release. El código no se mueve ahí: Electron necesita el `package.json`
y `node_modules` de `lumitrack/`.