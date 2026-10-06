<!-- CONTEXT: scope=adr | dependencias=adr/ADR-131-El-Actualizador-Es-La-Primera-Salida-De-Red.md,adr/ADR-132-El-Shell-Tiene-Su-Propio-Modelo-De-Seguridad.md,adr/ADR-188-La-Busqueda-De-Actualizaciones-Se-Puede-Apagar.md,ui/Components.md,ui/React_Client.md | audiencia=humanos+IA | fase=11.5 -->

# ADR-206 — Una búsqueda omitida no confirma la versión

- **Estado:** Adoptado por el planificador para corregir el caso de desarrollo
  reportado por el mantenedor el 2026-10-06.
- **Alcance:** actualizador Windows, IPC existente y Configuración React.

## Contexto

`desktop-shell start` ejecuta Electron sin empaquetar. La versión instalada
de `electron-updater` resuelve `checkForUpdates()` con `null` cuando
`isUpdaterActive()` es falso, sin emitir checking ni update-not-available.
El renderer queda esperando una respuesta inexistente. El resultado omitido
no acredita que se haya consultado GitHub ni que la versión esté vigente.

## Decisión

1. Al resolver la búsqueda manual Windows con `null`, el shell emite
   `{ type: "check-unavailable" }` por `updater:event`, pasando por la lista
   blanca existente. No agrega campos, canales, mensajes IPC ni contratos
   del Core. `checkWindowsUpdates` recibe el callback de emisión del main;
   no mantiene un emisor global. No emitir update-not-available en este caso.
2. El diálogo consume el evento solo si espera una búsqueda manual. Muestra
   debajo de Versión instalada, en tono secundario y con ícono informativo:
   «Para buscar actualizaciones, abrí la app instalada.» Sin check de éxito.
   Reservar espacio para este texto y la confirmación, incluso si requiere
   más de un renglón en la ventana mínima; no desplazar el formulario.
3. Una búsqueda real sin novedades conserva la confirmación existente con
   círculo/check. Una nueva búsqueda o cierre del diálogo limpia el estado.
   Un evento automático con estado idle no muestra el aviso manual.
4. Mantener la configuración de producción y las firmas existentes. No
   forzar forceDevUpdateConfig ni agregar dev-app-update.yml para simular
   una consulta. Los rechazos de la promesa no quedan sin manejar: conservar
   la señal de error del actualizador y evitar duplicarla si ya la emitió.
   La búsqueda automática mantiene ADR-188; no convierte una omisión en éxito.

## Validación

Shell: retorno null produce el evento terminal de omisión; una búsqueda
real no lo produce; rechazo no queda unhandled ni informa éxito. Renderer:
omisión manual muestra aviso, omisión automática no, nueva búsqueda limpia,
y update-not-available real sigue mostrando confirmación. Electron: probar
el botón en el shell sin empaquetar sin inyectar eventos para ese caso;
el recorrido de éxito usa el doble de frontera existente, separado y sin
consulta/descarga real. Los payloads conservan lista blanca sin rutas.
