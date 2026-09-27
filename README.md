# Lumitrack

Visualizador de audio con barras de luz audiorrítmicas e iluminación dinámica
según la portada de la canción. Buscás un tema por YouTube, se reproduce
solo el audio (sin video), y el fondo/las barras toman los colores de la
portada.

Pensado para dejarlo de fondo en una PC o TV.

## ⚠️ Antes de usarlo — léelo

- Este proyecto es **de uso personal y no comercial**. Cada persona que lo
  descarga lo corre **en su propia máquina**, contra su propia conexión.
  No es un servicio hosteado ni algo pensado para que terceros se conecten
  a una instancia tuya.
- La **búsqueda usa `ytmusic-api`** (npm, solo en el proyecto) y la
  **reproducción usa yt-dlp**, ambos por fuera de la API oficial de
  YouTube. Esto está en una zona gris respecto a los Términos de
  Servicio de YouTube (no está permitido explícitamente, pero es una
  práctica extendida y tolerada de hecho para uso personal). **No
  redistribuyas el audio.** La app mantiene en RAM (nunca en disco) la
  última canción reproducida, para poder repetirla o saltar dentro de
  ella sin volver a pedírsela a YouTube — esa caché se pierde apenas
  cerrás la app (ver "Arquitectura" más abajo).
- No se necesita ninguna API key ni cuenta de Google.
- Si en algún momento pensás monetizar o publicar esto en una tienda de
  apps, la situación legal cambia completamente y necesitás asesoramiento
  legal real antes de hacerlo. Este README no es asesoramiento legal.

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
Esa carpeta y el `.exe` no entran al repositorio: el instalador se
publica como GitHub Release. Quien lo instala no necesita Node. La ruta por defecto es
`C:\Program Files\Lumitrack` (en Windows en español, Archivos de programa).
El asistente deja cambiarla —otro disco, por ejemplo `D:\`— y crea esa
carpeta si todavía no existe. Hace falta permiso de administrador porque
Program Files no es escribible para un usuario normal.

yt-dlp y ffmpeg van dentro del instalador y, al primer arranque, se copian
a `%APPDATA%\Lumitrack\bin`. Eso sí es dato de usuario: Program Files no
se puede actualizar sin administrador. Al desinstalar, esa carpeta
(`%APPDATA%\Lumitrack`, binarios, caché de la ventana y cualquier dato
local de la app) se borra.

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
│       ├── installer.nsh         crea la carpeta de instalación si falta
│       └── icon.ico              (opcional)
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
    │   │   ├── searchRoutes.js        (GET /api/search)
    │   │   └── streamRoutes.js        (stream y estado de la caché)
    │   ├── services/
    │   │   ├── searchService.js       búsqueda en YouTube Music vía ytmusic-api
    │   │   └── streamService.js       audio desde caché o yt-dlp
    │   └── infrastructure/
    │       ├── binaries.js            rutas a yt-dlp/ffmpeg
    │       └── audioCache.js          caché en RAM de la última canción
    │
    └── public/
        ├── index.html
        ├── fonts/                     → Space Grotesk local
        ├── styles/
        └── scripts/
            ├── main.js                → conecta services y views
            ├── services/
            │   ├── audioEngine.js
            │   ├── colorExtractor.js
            │   └── searchApi.js         cliente de /api/search, /api/stream y /api/cached
            └── views/
                ├── visualizer.js
                ├── searchPanel.js
                ├── nowPlaying.js
                ├── playerControls.js
                ├── volumeControl.js
                └── fullscreenToggle.js
```

**Backend — flujo de una request:** `routes/` recibe el HTTP, llama a la
función correspondiente en `services/`, y esa función usa
`infrastructure/binaries.js` solo para saber qué ejecutable invocar. Las
rutas no saben cómo se arma el comando de yt-dlp, y los services no saben
nada de Express.

- **Búsqueda:** `GET /api/search?q=texto` → busca en YouTube Music vía
  el paquete npm `ytmusic-api` (cliente Innertube no oficial, instalado
  solo en `node_modules` del proyecto). Devuelve título, artista,
  portada y duración de hasta 12 resultados, ya filtrados a canciones.
- **Streaming de audio:** `GET /api/stream/:videoId` → si la canción
  pedida es la que está cacheada en RAM (ver más abajo), se sirve el
  buffer directo, con soporte de `Range` para saltar sin re-descargar.
  Si no, yt-dlp extrae la pista de audio y la pipea en vivo a la
  respuesta HTTP mientras en paralelo se van juntando los bytes; si la
  descarga termina bien, esa canción queda cacheada para la próxima vez.
  Si cerrás la canción antes de que termine, el proceso de yt-dlp se
  mata automáticamente y no se cachea una descarga a medias.
- **Caché en RAM:** `infrastructure/audioCache.js` guarda un único slot
  en memoria del proceso — la última canción reproducida completa. Vive
  solo mientras la app está corriendo: no toca disco, y se pierde por
  completo al cerrarla. Pedir la misma canción de nuevo (repetir,
  volver atrás) la sirve al instante desde RAM en vez de re-invocar
  yt-dlp; cambiar a una canción distinta reemplaza ese único slot.
  El frontend lo consulta con `GET /api/cached/:videoId` y, si la
  descarga sigue en curso, con `GET /api/cached/:videoId/wait`.
- **Binarios:** `infrastructure/binaries.js` busca primero yt-dlp y
  ffmpeg en la carpeta de binarios (en desarrollo `lumitrack/bin/`; en
  la app instalada `%APPDATA%\Lumitrack\bin`) y, si no están, cae al
  PATH del sistema. El proceso de Electron setea esa carpeta antes de
  cargar el servidor, porque dentro del paquete de solo lectura no se
  puede ejecutar ni actualizar un binario.

**Frontend — flujo de una interacción:** `main.js` es el único archivo
que conoce tanto a `services/` como a `views/`; los conecta pero no
contiene lógica propia. Los módulos de `services/` (`audioEngine.js`,
`colorExtractor.js`, `searchApi.js`) no tocan el DOM. Los módulos de
`views/` (`visualizer`, `searchPanel`, `nowPlaying`, `playerControls`,
`volumeControl`, `fullscreenToggle`) sí tocan el DOM, pero no hacen
fetch ni usan Web Audio directamente — reciben datos ya procesados y
los pintan.

- **Visualización:** `audioEngine.js` conecta el `<audio>` a un
  `AnalyserNode`, hace FFT del audio en tiempo real, y entrega niveles ya
  mapeados a la cantidad de barras. `visualizer.js` solo los pinta.
- **Controles de reproducción:** `audioEngine.js` expone `play`,
  `pause`, `resume`, `replay` y `seek`, y notifica cambios de estado
  (`idle`/`playing`/`paused`/`ended`) y de progreso (tiempo actual /
  duración). `playerControls.js` traduce eso a un único botón cuyo
  ícono y tooltip cambian según el estado, más el timer y la barra de
  progreso — clickeable para saltar a un punto de la canción, coloreada
  con el mismo acento dinámico que el título.
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
  nuevo `Lumitrack.bat` / `npm start` para reinstalar deps. Si el
  problema es el audio (no la búsqueda), actualizá yt-dlp borrando
  `bin/` como arriba.
- **El audio corta o no carga** → mismo motivo que arriba: actualizá
  yt-dlp borrando `bin/yt-dlp.exe` (o `bin/yt-dlp` en Mac/Linux) y
  corriendo la app de nuevo.
- **Al hacer click en la barra de progreso la primera vez que suena una
  canción no salta bien (o tarda rato)** → la primera reproducción
  streaméa en vivo mientras cachea en RAM; apenas termina de bajar,
  el seek pasa a funcionar (y si clickeás antes, la app espera a que
  termine el cacheo y entonces salta). Si nunca salta, borrá `bin/` y
  actualizá yt-dlp.

## Instalador

La config vive en `installer/electron-builder.yml` y el setup generado
en `installer/dist/`. Esa salida no se versiona: se publica como GitHub
Release. El código no se mueve ahí: Electron necesita el `package.json`
y `node_modules` de `lumitrack/`.

Si más adelante hay un ícono, dejalo como `installer/build/icon.ico`.
electron-builder lo toma solo, con ese nombre, desde la carpeta de build.
