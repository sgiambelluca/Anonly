; ADR-197 5.c: borra la entrada RunOnce de recuperacion cuando la instalacion termina bien.
; Si el instalador se corta antes de llegar aca, el valor queda y Windows vuelve a correr
; el instalador en el proximo inicio de sesion. ASCII a proposito: NSIS lee este archivo sin BOM.
!macro customInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\RunOnce" "AnonlyUpdateRecovery"
!macroend
