<!-- CONTEXT: scope=adr-aceptado | dependencias=adr/ADR-052-Blob-Urls-Tardios-Tras-Cerrar-Documento.md,adr/ADR-172-Deshacer-Y-Rehacer-Exactos.md,core/Contracts.md,core/Orchestrator.md,ui/React_Client.md,ui/Components.md | audiencia=humanos+IA | fase=11 -->

# ADR-205 — El resultado exportado pertenece a una revisión

- **Estado:** Aceptado por el mantenedor el 2026-10-05.
- **Fecha:** 2026-10-05.
- **Alcance:** reabrir Exportar después de modificar el documento.
- **Implementación autorizada:** seguimiento local del cliente con los eventos
  existentes, sin nuevos contratos del Core para exportar.

## Contexto

`ExportDialog.shouldReopenOnResult` solo comprueba que exista `exportResult`.
Ese resultado tiene `blobUrl` y `sizeBytes`, pero no identifica la versión
del contenido que se exportó. Al editar después de descargar, el diálogo
reabre el resultado anterior. El humano pide volver al formulario normal
con un aviso bajo el campo de nombre que recuerde la exportación previa.

La retención del resultado evita perder el acceso a una exportación ya hecha.
No se debe arreglar el defecto reseteando el resultado cada vez que se abre
el diálogo: eso también pierde el archivo cuando no hubo ninguna edición.

## Decisión

1. **Simplificación propuesta por el humano:** un contador local del cliente
   alcanza. No se comparan documentos, hashes ni clases de edición, y no se
   intenta recuperar la vigencia de un PDF por equivalencia del contenido.
   `currentVersion` aumenta cuando cambia el documento; `exportedVersion`
   empieza en `null` y registra el contador del último export exitoso.
2. Capturar `exportingVersion = currentVersion` inmediatamente antes de
   solicitar exportar. Con `EXPORT_FINISHED` guardar
   `exportedVersion = exportingVersion`. Ese es el evento de éxito existente
   en el proyecto; no existe `EXPORT_SUCCESS`. Un fallo no modifica la
   versión exportada. El resultado debe ser del documento activo.
3. Comparar `currentVersion` con `exportedVersion`. Si coinciden,
   reabrir la exportación existente, con el nombre usado para descargar.
   Si difieren, mostrar el formulario normal y debajo del nombre:
   «Ya exportaste este documento anteriormente. Hay cambios pendientes de
   exportar.» Mantener un dato independiente de exportación previa aunque
   se descarte el blob antiguo; resetearlo al cambiar/cerrar documento.
   `exportedVersion !== null` ya permite saber que hubo un export previo;
   no hace falta otro boolean mientras se conserve ese dato.
4. No poner el contador a cero incondicionalmente al terminar. Si se
   exportaba la versión 5 y hubo una edición que produjo la 6 durante la
   generación, el éxito corresponde a la 5: la 6 sigue pendiente. Mantener
   los contadores evita perder ese cambio sin identificar qué edición fue.
   Una alternativa equivalente es un contador de cambios pendientes que se
   limpia solo si no cambió desde el inicio del export.
5. El cliente admite una sola solicitud activa de export por documento y
   captura su versión antes de emitir el pedido; impedir submits duplicados.
   El Core toma el snapshot de grupos en `runExport` antes de su primer
   `await`, lo que permite conservar sus contratos existentes. La cola del
   Core sigue existiendo para sus otros consumidores; exponer exports
   concurrentes en la UI requeriría otra asociación de solicitudes/resultados.
6. El seguimiento debe cubrir las rutas ya existentes: ediciones de grupos,
   reglas, conflictos, undo/redo y reanálisis. No hace falta que una acción
   compleja incremente exactamente una vez: importa que haya cambiado el
   contador. Zoom, búsqueda y orden de lista son presentación y no lo alteran.
   Observar en el bridge los cambios efectivos de grupos y conflictos del
   documento activo; observar reglas en sus acciones, que no tienen evento
   de vuelta. Incrementar también tras una restauración exitosa de historia.
   Al iniciar un reanálisis efectivo, invalidar conservadoramente el resultado:
   puede producir cambios parciales incluso si termina cancelado o fallido.
   Un patch vacío/idéntico detectado como no-op no incrementa por sí solo.
7. El Orchestrator mantiene la propiedad de las blob URLs. El bridge/UI no
   revoca por su cuenta un blob que el Core administra. El cierre y los
   resultados tardíos mantienen ADR-052. La descarga previa no se modifica.

## Política de deshacer indicada por el humano

El humano indica que no importa qué cambios se hicieron. Deshacer y rehacer
también cuentan como cambios, aunque se vuelva al contenido anterior. Se
vuelve a exportar; no se busca equivalencia ni se necesita otra decisión sobre
hashes. No se exige un incremento exacto por operación compuesta.

## Alternativas

- **Limpiar el blob en los botones de edición:** omite otras rutas, undo/redo
  y reanálisis; no maneja resultados tardíos.
- **Invalidar al abrir siempre:** pierde el acceso al resultado sin cambios.
- **Comparar referencias del store:** cambian por notificaciones y orden,
  y no garantizan que se cubra todo el contenido exportable.
- **Identidad del contenido:** puede reconocer un undo exacto, pero requiere
  normalización completa y pruebas de todos los datos que alteran el PDF.

## Plan y validación

El store, adapter y diálogo se especifican en React_Client y Components.
Reutilizar `EXPORT_REQUESTED` y `EXPORT_FINISHED`, sin un evento nuevo. El alcance
es cliente React. `exportingVersion` se captura antes de emitir y se limpia
en éxito, fallo o cancelación. Los resultados de otro documento o sin una
solicitud local pendiente no se asocian al contador. El resultado anterior se
descarta al iniciar una nueva solicitud, conservando `exportedVersion`.

Pruebas: exportar/descargar/reabrir sin cambios conserva resultado y nombre;
cada edición efectiva reabre formulario con aviso; no-op, zoom y búsqueda
conservan vigencia; undo/redo siguen la política elegida; reanálisis, error,
export en cola, edición durante generación y resultado tardío no declaran
vigente un archivo obsoleto; documento nuevo no hereda avisos ni URLs.
