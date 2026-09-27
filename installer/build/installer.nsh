; El script de electron-builder hace SetOutPath $INSTDIR antes de copiar
; archivos, y SetOutPath crea la ruta completa. Esta macro lo repite al
; terminar la copia: si el usuario eligió D:\Algo y no existía, queda creada.
!macro customInstall
  CreateDirectory "$INSTDIR"
!macroend
