<!-- CONTEXT: scope=gate-export-ampliacion-23 | dependencias=adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-203-El-Gate-De-Export-Cubre-La-Politica-OCR-Vigente.md,adr/ADR-210-El-Repintado-De-Linea-Desplaza-Los-Pixeles-Del-Renglon.md,roadmap/hardening/Confianza_Cierre_2026-10-08.md,architecture/07_Performance_Strategy.md | audiencia=humanos+IA | fase=12 -->

# Gate del export — ampliación de 21 a 23 casos

**Estado: implementación, pruebas focalizadas y gate integral completos;
23/23 aprobados localmente, revisión del lote pendiente.** Continúa el Frente 5 de
[Confianza](Confianza_Cierre_2026-10-08.md). No cambia fuentes de producto,
las 21 filas previas, sus fixtures ni el comparador del gate.

La ampliación vive en `tests/e2e/export-verification.spec.ts`, con el helper
`tests/e2e/support/exportVerificationClosure.ts`. El runner dedicado
`scripts/ci/run-export-verification.ts` exige al menos 23 pruebas ejecutadas
y cero salteadas; conserva el rechazo de filtros y el exit rojo de Playwright.
La evidencia histórica de 21 queda en
[el cierre ADR-203](ADR148_Cierre_ADR203_2026-10-05.md) y no se presenta como
una ejecución de los 23 actuales.

## Dos casos, fixtures fijados antes de ejecutar

Ambos son A4, Helvetica 12, una página y datos inventados. El primero usa
«Consta DNI 38.471.629 PERICIA CONTABLE PUBLICA», con la etiqueta
`[IDENTIFICADOR PERSONAL 01]`. El segundo, «Acta DNI 56.284.713 INFORME
PUBLICO GENERAL», raster a 216 dpi con receta `adr148-faint-ink-v1`:
sigma gaussiano 1,2 px, negro 32, blanco 255, ruido cero y semilla 148203;
etiqueta `[DNI-01]`.

Cada caso importa por UI, conserva la detección real y cambia el reemplazo
mediante el diálogo. Comprueba el camino en el preview con imágenes originales
y anonimizadas de 595 × 842 píxeles, escala 1 y mismas dimensiones. Después
exporta por UI a JPEG 150 dpi, calidad 0,92 y sin leyenda, descarga el PDF
sintético real y lo lee con el OCR independiente del gate.

El control integra una copia de los mismos bytes originales sin tapar:
debe ser `NO CUMPLE` por los fragmentos prohibidos, nunca `INCONCLUSO`.
El PDF final debe conservar los vecinos públicos y excluir identificador
completo, prefijo y sufijo. No se cambió receta, comparación ni producto
para facilitar una lectura.

## Resultados individuales auditados por el planificador

Cada fila pasó sola con mirror, renderer `VITE_E2E=1` y shell construidos,
un worker, cero salteados, fallos o flaky. Sus reportes con agregados y
artefactos sintéticos se conservaron en
`.measure/preparacion-export-gate/evidence/line-repaint/` y
`.measure/preparacion-export-gate/evidence/faint-ink/`.

| Criterio | Renglón repintado | Tinta tenue |
| --- | --- | --- |
| Avance de etiqueta / ancho de caja | 118,758 / 60,048 pt | 35,188 / 59,333 pt |
| Desplazamiento exacto de píxeles | Único, 59 px | Único, 0 px |
| Desplazamiento del mapa visible | 59,004 px | No requerido en el camino sin desplazamiento |
| Vecinos en preview | Regiones RGBA idénticas tras el desplazamiento | Regiones RGBA idénticas sin desplazamiento |
| PDF final | `CUMPLE`, vecinos presentes y sin fragmentos prohibidos | `CUMPLE`, vecinos presentes y sin fragmentos prohibidos |
| Control sin tapar | `NO CUMPLE`: `38471629`, `3847`, `1629` | `NO CUMPLE`: `56284713`, `5628`, `4713` |
| Fuente y PDF final | Una página cada uno | Una página cada uno |
| Hashes de assets producto/verificador | Coinciden | Coinciden |

En el tenue, el probe acreditó el orden observado: `PAGE_PARSED` con cero
palabras y `requiresOCR=true`, luego `OCR_PAGE_FINISHED` con seis palabras,
y después el grupo del identificador. La actualización posterior del grupo
por la edición no sustituye esa primera observación. No se deduce el origen OCR
del valor `DetectionSource.Regex`.

El diagnóstico de borde conserva un anillo exterior de 2 pt, escala 4
(288 dpi), 4672 píxeles RGBA por imagen: cero tonos oscuros y 338 tenues
en el original, cero oscuros y 476 tenues en el export. Estos conteos no
son un criterio de cero tinta ni una prueba por sí solos de legibilidad.
El criterio de seguridad es la lectura del PDF final por el OCR independiente.

## Gate integral y revisión que falta

Formato, ESLint y tipos focalizados de E2E/scripts pasaron. El comando
`pnpm test:export-verification` terminó con **23/23, cero fallos, salteados
o flaky**. El planificador auditó `test-results/export-verification.json`:
23 casos esperados y ejecutados, todos aprobados, sin errores del reporte.
La ejecución comenzó el 2026-10-10 a las 22:45:12,635 UTC y duró
171,483 segundos. Corrió en serie, sin mediciones simultáneas.

La identidad del diff de producto fue
`6e91c9f66cfc341af8aa5137756b02c009dddfeb768371565342dc6cf018aa44`,
la misma de M-V1. Es evidencia local sobre cambios sin commit: no acredita
CI de los 23 ni aprobación del lote. Sol revisará el conjunto cuando
terminen los demás frentes.

Esta ampliación verifica dos fixtures concretos; no cubre todos los escaneos
borrosos ni reemplaza la caracterización de orientación. RC sigue su validación
y SV/CP permanece [pendiente de desarrollo](../ocr/Orientacion_SV_CP_Retoma_2026-10-10.md).
No autoriza commit, push, tag ni publicación.
