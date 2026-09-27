@echo off
setlocal

title Lumitrack

REM Se posiciona en la carpeta donde está este .bat, sin importar desde
REM dónde lo hayan ejecutado (doble clic, acceso directo, etc.)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo No se encontro Node.js instalado.
    echo Descargalo de https://nodejs.org ^(version 22 o superior^) y volve a correr este archivo.
    echo.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo No se encontro npm. Reinstala Node.js desde https://nodejs.org.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\express\package.json" goto install_dependencies
if not exist "node_modules\ytmusic-api\package.json" goto install_dependencies
if not exist "node_modules\electron\package.json" goto install_dependencies
goto start_app

:install_dependencies
echo Instalando dependencias del proyecto...
call npm install --no-fund --no-audit
if errorlevel 1 (
    echo.
    echo No se pudieron instalar las dependencias de npm.
    echo Revisa el mensaje de arriba y volve a ejecutar este archivo.
    pause
    exit /b 1
)

:start_app
node "node_modules\electron\install.js"
if errorlevel 1 (
    echo.
    echo No se pudo preparar Electron.
    pause
    exit /b 1
)

start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
