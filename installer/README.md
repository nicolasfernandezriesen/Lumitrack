# Instalador de Lumitrack

Acá queda la configuración de electron-builder y el setup que genera.
El código de la app sigue en `lumitrack/`: el instalador no es un
segundo proyecto, porque Electron se empaqueta desde el `package.json`
que ya tiene las dependencias.

## Generar el setup de Windows

Desde `lumitrack/`, con Node 22 o superior y con `bin/yt-dlp.exe` y
`bin/ffmpeg.exe` ya descargados (un arranque de la app alcanza):

```bash
npm install
npm run dist
```

El instalador sale en `installer/dist/Lumitrack-Setup-<versión>.exe`.
Ese `.exe` y el resto de `dist/` no se suben al repositorio: se publican
como GitHub Release.

Ese `.exe` instala la ventana de escritorio. No le pide Node a quien
lo usa. La ruta por defecto es `C:\Program Files\Lumitrack`. En el
asistente se puede cambiar (incluso a otro disco). Si esa carpeta no
existe, el instalador la crea. Después de la ruta pregunta si crear un
icono de acceso directo en el escritorio y otro en el menú Inicio. Los
dos casilleros vienen marcados. Si se desmarca uno, ese acceso no se
crea. La instalación pide permisos de administrador.

Los binarios de yt-dlp y ffmpeg viajan junto al instalador y se copian
a `%APPDATA%\Lumitrack\bin` la primera vez que se abre: son archivos de
usuario, y Program Files no se puede escribir sin administrador.

Esa carpeta (`%APPDATA%\Lumitrack`, AppData\Roaming) es la `userData`
de Electron. Ahí van los binarios, la caché de la ventana y, más
adelante, la configuración y las bases de datos locales. No van en
Program Files: esa ruta no es del usuario y no se puede escribir sin
administrador.

Al desinstalar, esa carpeta se borra completa. El asistente muestra
antes la opción "Mantener mi información personal", desmarcada. Si se
marca, la carpeta queda para una instalación futura. Una actualización
de la app no la toca.

## Ícono

Si existe `installer/build/icon.ico`, electron-builder lo usa como
ícono de la app y del setup.
