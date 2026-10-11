<!-- CONTEXT: scope=correccion-arnes-export | dependencias=adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-210-El-Repintado-De-Linea-Desplaza-Los-Pixeles-Del-Renglon.md,architecture/07_Performance_Strategy.md,roadmap/hardening/Confianza_Cierre_2026-10-08.md | audiencia=humanos+IA | fase=12 -->

# Export verification — incidente de CI del 2026-10-11

## Evidencia y estado

El [CI del PR #63](https://github.com/sgiambelluca/Anonly/actions/runs/38156497984)
pasó antes del merge. El [CI posterior en develop](https://github.com/sgiambelluca/Anonly/actions/runs/38157610082),
commit `59bd9b2a3bb33632a5883c7ed2b6cb4584d801c7`, falló en macOS:
21/23 casos del gate pasaron. Sol revisó logs y artifacts sintéticos y
emitió **REJECTED** para el arnés el 2026-10-11. Corrección implementada y
revisión local **APPROVED**; CI/macOS sobre el HEAD publicable pendiente.

- `ADR-148 mixed E2E redact JPEG 150 DPI`: `openApp` falló en la recarga con
  `net::ERR_ABORTED`, antes de importar el documento. Los estados de carga
  existentes no verifican que la navegación inicial corresponda a la URL
  de la aplicación. La carrera de arranque es una hipótesis; los artifacts
  no permiten probar su causa retrospectivamente.
- `ADR-148 E2E renglón repintado, placeholder largo, PDF final`: desplazamiento
  exacto cero donde se exige uno positivo. El arnés verifica el grupo editado,
  pero puede leer la imagen anterior: el reemplazo corto también cambia el
  DNI y satisface la espera actual. Los artifacts no conservan la secuencia
  de renders ni la geometría anterior a la assertion. El caso falla antes
  de generar su PDF final; no demuestra una regresión del PDF exportado.

Los crudos están fuera del material publicable, en `.measure/export-ci-20261011/`.
No se modifica retrospectivamente la evidencia ni se declara éxito con un rerun.

## Plan del planificador para Luna

Alcance: helpers y pruebas de `tests/e2e`; sin cambios de producto ni contratos.

1. Asegurar la URL inicial `app://local/index.html` y la finalización de esa
   navegación antes de una única recarga que ejecute los init scripts.
   Comprobar readiness y conservar diagnóstico acotado de URL y eventos de
   navegación/carga ante un error. No ignorar errores ni repetir recargas.
2. Marcar la edición antes de guardarla. Esperar el render anonimizado y su
   dibujo efectivo posterior, vinculando imagen/evento con la edición a escala
   uno. Utilizar los observadores existentes cuando sea posible. La existencia
   de la imagen o el cambio del DNI no acreditan la revisión editada.
3. Adjuntar mediciones, geometría y secuencia antes de las assertions que
   puedan fallar. Conservar el fixture, la etiqueta, las tolerancias, la
   exigencia de único desplazamiento positivo, los vecinos idénticos, el mapa
   concordante, los controles discriminantes y el OCR del PDF final.
4. Agregar regresiones relevantes para las barreras del arnés; validar los dos
   casos afectados y luego el gate completo, 23/23, sin fallos ni salteados.
   Sol aplica R-16 y revisa el lote completo. La aprobación requiere además
   CI/macOS verde sobre el HEAD publicable.

No se agregan sleeps, retries, cambios de fixture para facilitar el resultado
ni dependencias. Si el diagnóstico encuentra un defecto de producto, Luna
lo informa al planificador antes de ampliar el alcance. M2 conserva su
validez si solo cambian helpers de pruebas. SV + CP sigue diferido y
«Validar muestra» cancelado; este incidente no agrega una función al roadmap.

## Validación local de la corrección

El gate canónico `pnpm test:export-verification` completó **23/23** en
Windows nativo, cero fallos y cero casos omitidos, con builds frescos y la
assertion final de ejecución efectiva. El reporte nuevo y su log están
en `.measure/export-ci-20261011/local-gate-v1.json` y
`local-gate-v1.log`; no sustituyen el rojo de CI preservado.

La espera vincula la edición con la revisión del preview, su escala y el
blob efectivamente dibujado. Se abre la vista Anonimizada antes de esperar
su dibujo: la primera corrida del diagnóstico quedó fallida y preservada
porque la vista activa aún era Original. Las corridas aisladas finales del
renglón y tinta tenue pasaron, así como el caso mixto dentro del gate completo.
Se conservan los fixtures y las exigencias originales del oráculo.

La barrera de navegación espera la URL exacta de la aplicación, carga y
readiness antes de una sola recarga. El fallo de macOS original no dejó
traza suficiente para demostrar retrospectivamente su causa. No se afirma
que su origen haya quedado reproducido en Windows.

Sol verificó la cadena edición/revisión/escala/blob/dibujo en los artifacts
de ambos casos y aprobó los diez archivos publicables: dos documentos y
ocho archivos de pruebas, sin datos sensibles. Ejecutó personalmente lint,
typecheck, 4413 tests verdes (un fallo esperado y 77 omitidos), 347/347
contratos, formato y diff-check. Las cinco regresiones nuevas del arnés
pasaron. No repitió la suite pesada ya acreditada por el reporte 23/23.
Su aprobación autoriza commit, push y PR; el merge queda condicionado al
CI/macOS verde sobre el HEAD final. No cambió el producto ni los contratos.

## Publicación

Rama `codex/fix-export-verification-ci`, desde el commit integrado en develop.
Se mantiene el flujo autorizado: Sol → Luna → Sol hasta APPROVED; commits
por módulo, auditoría de datos sensibles, push y PR a develop. El merge
queda condicionado a la aprobación y los checks verdes. No hay release,
versión ni tag en esta corrección.
