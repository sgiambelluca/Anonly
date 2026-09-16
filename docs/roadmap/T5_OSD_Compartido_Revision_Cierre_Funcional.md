# T5 — Revisión del cierre funcional entregado por Luna

> **Historial cerrado:** T5 aceptada el 2026-09-15. Las instrucciones,
> pendientes y resultados de este documento reflejan sus etapas anteriores;
> el estado vigente está en [el cierre final](T5_OSD_Compartido_Cierre_Final.md).
> No reanudar encargos históricos ni repetir mediciones por estas notas.

Fecha: 2026-09-15. Revisión del planificador y del revisor OCR sobre la entrega
registrada en `T5_OSD_Compartido_Cierre_Funcional.md`.

**Veredicto: pendiente de aceptación final por cobertura insuficiente.** El
defecto conocido de dispose está corregido. No se encontró una nueva regresión
de producto en esta revisión. OSD compartido + una página de adelanto se
conserva por decisión del humano; esta revisión no reabre esa decisión.

## Evidencia independiente

- Revisor: 26/26 tests de orientación/T5 pasan. Repro de sesión rechazada con
  productor superviviente: dispose permanece pendiente, no libera servicios;
  al terminar el productor libera ambos y termina, sin nuevos despachos OCR.
- Planificador: build nuevo del renderer con VITE_E2E=1 y del shell;
  ANONLY_T5_E2E=1, E2E Electron con un worker y cero reintentos: **1 passed
  (25,7 s)**. Ese tiempo es duración del test, no un benchmark del paso OCR.
- Los SHA-256 actuales de host y kernel coinciden con el manifiesto funcional
  final de Luna. ImageData conserva el mismo hash C de la campaña separada.
- `git diff --check` pasa. No se repitieron métricas A/B/C ni gates globales:
  quedan requisitos explícitos de pruebas antes de considerar listo el diff.
- Los 164 tests y 94,18 % de cobertura corresponden al reporte scoped de Luna;
  esta revisión independiente repitió el subconjunto indicado arriba.

## Avances aceptados

La guarda de drenaje cuenta páginas, sesiones y ramas en todos sus puntos de
resolución. Se agregó el repro permanente de dispose. Las regiones de la
misma página ahora se ejecutan concurrentemente, terminan fuera de orden y
conservan la asociación imagen/orientación en los payloads de reconocimiento.

El E2E usa geometría independiente del OCR, giros físicos 0/90/180/0/270,
selecciona Redact explícitamente y comprueba muestras interiores de cada una
de las 90 regiones DNI. Es un avance sustancial frente a aceptar cualquier
píxel cambiado de todo el documento. Hay un reanálisis real por cambio de
idiomas. NER está desactivado: las entidades verificadas proceden de Regex.

## Pendientes concretos de validación

1. **Conservación externa:** `t5-orientation-pixel.spec.ts:315–319` solo exige
   una fracción oscura mínima. Una región enteramente negra satisface ambas
   condiciones aunque destruya el texto. Comparar imagen fuente/exportada en
   la región externa con tolerancia justificada y hacer fallar un control
   negativo que la ennegrezca. No basta comprobar que siga habiendo tinta.
2. **Separar generaciones del reanálisis:** las colecciones de palabras y
   entidades se acumulan; el contador solo exige crecer, no cinco páginas
   nuevas. La comparación de entidades de `:271–279` acepta cero entidades
   nuevas si siguen almacenadas las anteriores. Vaciar o identificar por
   generación, esperar cinco páginas nuevas y comparar ocurrencias por
   página/tipo/valor, incluyendo fallos nuevos. El conjunto global actual
   tampoco distingue si faltan ocurrencias en una página.
3. **Reconstrucción:** `t5-shared-osd.test.ts:481–498` sigue ejecutando una sola
   operación y release. Ejecutar otra sesión y observar nueva creación de
   recursos. El nombre del test no prueba esa reconstrucción.
4. **Aislamiento de recursos:** `:698–757` consulta mapas independientes en
   pools fake y release no tiene efectos. Usar dos servicios de orientación
   reales con la fábrica Tesseract simulada; verificar dos recursos distintos,
   terminar A y demostrar que B conserva y utiliza el suyo.
5. **Orden de resultados de regiones:** `:350–427` devuelve dos resultados
   vacíos idénticos y solo afirma pageIndex `[4,4]`. Devolver palabras distintas
   y comprobar su orden por descriptor aunque terminen en orden inverso.

Contraejemplos de los predicados E2E, reproducidos sin modificar el producto:
`.measure/t5-functional-review/assertion-counterexamples.json`. Muestran que
una zona negra y cero entidades nuevas pueden aprobar esos asserts; **no**
demuestran que la exportación observada esté ennegrecida ni que el reanálisis
real haya perdido entidades.

## Conclusiones sobre rendimiento y siguiente paso

Esta entrega aporta corrección de ciclo de vida y evidencia funcional. No
incluye una nueva optimización ImageData ni una nueva medición temporal/RSS.
Siguen vigentes los resultados y límites de la revisión A/B/C: beneficio
temporal de OSD/adelanto sobre el comportamiento histórico, costo adicional
al restituir las rotaciones y ahorro de RAM no demostrado.

Completar los cinco discriminantes anteriores y luego ejecutar los gates
finales que correspondan. Después congelar la versión funcional para perfilar
preparación de imágenes y reconocimiento, comparar tiempo/memoria y probar
optimizaciones individualmente. Incluir un margen con texto realmente rotado:
el nuevo E2E verifica páginas completas giradas, no mide el beneficio de leer
un sello vertical dentro de una página derecha. El plan de investigación se
mantiene en `T5_ImageData_Investigacion.md`.
