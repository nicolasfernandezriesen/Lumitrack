; Asistente de Lumitrack.
; Los accesos directos del escritorio y del menú Inicio son opcionales
; (ambos marcados por defecto).
; Al desinstalar, los datos de usuario se borran salvo que el usuario
; pida conservarlos. Viven en la carpeta userData de Electron:
; %APPDATA%\Lumitrack (en Windows, AppData\Roaming\Lumitrack).

!ifndef BUILD_UNINSTALLER
  Var LumitrackCreateDesktopShortcut
  Var LumitrackDesktopCheckbox
  Var LumitrackCreateStartMenuShortcut
  Var LumitrackStartMenuCheckbox
!else
  Var LumitrackKeepUserData
  Var LumitrackKeepDataCheckbox
!endif

!macro customInit
  StrCpy $LumitrackCreateDesktopShortcut "1"
  StrCpy $LumitrackCreateStartMenuShortcut "1"
!macroend

!macro customPageAfterChangeDir
  !include nsDialogs.nsh

  Function LumitrackDesktopPageCreate
    ${If} ${Silent}
    ${OrIf} ${isUpdated}
      Abort
    ${EndIf}

    ; El idioma del asistente ya está elegido: esta página sigue ese idioma.
    IntOp $R0 $LANGUAGE & 0x3FF
    ${If} $R0 == 10
      !insertmacro MUI_HEADER_TEXT "Accesos directos" "Elegí dónde querés un icono de Lumitrack."
      StrCpy $R9 "Crear un icono de acceso directo en el escritorio"
      StrCpy $R7 "Crear un icono de acceso directo en el menú Inicio"
    ${Else}
      !insertmacro MUI_HEADER_TEXT "Shortcuts" "Choose where to place a Lumitrack icon."
      StrCpy $R9 "Create a desktop shortcut"
      StrCpy $R7 "Create a Start menu shortcut"
    ${EndIf}

    nsDialogs::Create 1018
    Pop $R8
    ${If} $R8 == error
      Abort
    ${EndIf}

    ${NSD_CreateCheckbox} 0 12u 100% 12u $R9
    Pop $LumitrackDesktopCheckbox
    ${If} $LumitrackCreateDesktopShortcut == "0"
      ${NSD_Uncheck} $LumitrackDesktopCheckbox
    ${Else}
      ${NSD_Check} $LumitrackDesktopCheckbox
    ${EndIf}

    ${NSD_CreateCheckbox} 0 28u 100% 12u $R7
    Pop $LumitrackStartMenuCheckbox
    ${If} $LumitrackCreateStartMenuShortcut == "0"
      ${NSD_Uncheck} $LumitrackStartMenuCheckbox
    ${Else}
      ${NSD_Check} $LumitrackStartMenuCheckbox
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function LumitrackDesktopPageLeave
    ${NSD_GetState} $LumitrackDesktopCheckbox $R9
    ${If} $R9 == ${BST_CHECKED}
      StrCpy $LumitrackCreateDesktopShortcut "1"
    ${Else}
      StrCpy $LumitrackCreateDesktopShortcut "0"
    ${EndIf}

    ${NSD_GetState} $LumitrackStartMenuCheckbox $R9
    ${If} $R9 == ${BST_CHECKED}
      StrCpy $LumitrackCreateStartMenuShortcut "1"
    ${Else}
      StrCpy $LumitrackCreateStartMenuShortcut "0"
    ${EndIf}
  FunctionEnd

  Page custom LumitrackDesktopPageCreate LumitrackDesktopPageLeave
!macroend

!macro customInstall
  CreateDirectory "$INSTDIR"

  ; electron-builder ya creó los accesos. Si el usuario desmarcó uno,
  ; se borra. En instalación silenciosa los dos casilleros quedan marcados.
  StrCpy $R9 "0"
  ${If} $LumitrackCreateDesktopShortcut == "0"
  ${AndIf} ${FileExists} "$newDesktopLink"
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
    StrCpy $R9 "1"
  ${EndIf}
  ${If} $LumitrackCreateStartMenuShortcut == "0"
  ${AndIf} ${FileExists} "$newStartMenuLink"
    WinShell::UninstShortcut "$newStartMenuLink"
    Delete "$newStartMenuLink"
    !ifdef MENU_FILENAME
      RMDir "$SMPROGRAMS\${MENU_FILENAME}"
    !endif
    StrCpy $R9 "1"
  ${EndIf}
  ${If} $R9 == "1"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend

!macro customUnInit
  StrCpy $LumitrackKeepUserData "0"
!macroend

!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME

  !include nsDialogs.nsh

  Function un.LumitrackKeepDataCreate
    ${If} ${Silent}
    ${OrIf} ${isUpdated}
      Abort
    ${EndIf}

    IntOp $R0 $LANGUAGE & 0x3FF
    ${If} $R0 == 10
      !insertmacro MUI_HEADER_TEXT "Información personal" "Elegí si querés conservar los datos de usuario."
      StrCpy $R9 "Mantener mi información personal"
      StrCpy $R7 "Por defecto se borra todo, incluso la configuración y las bases de datos locales. Si marcás esta opción, se conserva AppData\Roaming\Lumitrack para una instalación futura."
    ${Else}
      !insertmacro MUI_HEADER_TEXT "Personal data" "Choose whether to keep your user data."
      StrCpy $R9 "Keep my personal information"
      StrCpy $R7 "By default everything is removed, including settings and local databases. Check this to keep AppData\Roaming\Lumitrack for a future installation."
    ${EndIf}

    nsDialogs::Create 1018
    Pop $R8
    ${If} $R8 == error
      Abort
    ${EndIf}

    ${NSD_CreateCheckbox} 0 8u 100% 12u $R9
    Pop $LumitrackKeepDataCheckbox
    ${If} $LumitrackKeepUserData == "1"
      ${NSD_Check} $LumitrackKeepDataCheckbox
    ${Else}
      ${NSD_Uncheck} $LumitrackKeepDataCheckbox
    ${EndIf}

    ${NSD_CreateLabel} 0 28u 100% 40u $R7
    Pop $R8

    nsDialogs::Show
  FunctionEnd

  Function un.LumitrackKeepDataLeave
    ${NSD_GetState} $LumitrackKeepDataCheckbox $R9
    ${If} $R9 == ${BST_CHECKED}
      StrCpy $LumitrackKeepUserData "1"
    ${Else}
      StrCpy $LumitrackKeepUserData "0"
    ${EndIf}
  FunctionEnd

  UninstPage custom un.LumitrackKeepDataCreate un.LumitrackKeepDataLeave
!macroend

; Corre antes de borrar los archivos del programa. Las actualizaciones
; llegan con --updated y tienen que dejar intacta la carpeta de usuario.
!macro customUnInstall
  ${IfNot} ${isUpdated}
  ${AndIf} $LumitrackKeepUserData != "1"
    ${If} $installMode == "all"
      SetShellVarContext current
    ${EndIf}

    RMDir /r "$APPDATA\${APP_FILENAME}"
    !ifdef APP_PRODUCT_FILENAME
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
    !endif
    !ifdef APP_PACKAGE_NAME
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    !endif

    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  ${EndIf}
!macroend
