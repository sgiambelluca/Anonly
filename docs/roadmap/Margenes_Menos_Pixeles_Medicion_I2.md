<!-- CONTEXT: scope=medicion-i2 | dependencias=roadmap/Margenes_Menos_Pixeles_Plan.md,roadmap/Margenes_Menos_Pixeles_Medicion_I1.md,adr/ADR-165-Una-Franja-Ya-Explicada-No-Se-Reconoce.md | audiencia=planificador+humano | fase=11 -->

# I-2 — medición del recorte vertical de franjas supervivientes

Fecha: 2026-09-17. **Decisión: no implementar I-2 en esta fase.** El recorte
con 64 px de padding mantuvo la calidad del único fixture con franjas activas,
pero I-2 no aporta ahorro en P2, el benchmark del piso de 20 % del plan §5.
Los recortes de 0 y 32 px sí cambiaron la salida OCR, aunque
conservaron las 15 palabras reales del sello y el folio. P2, el caso
que justificó I-1, ya no ejecuta ninguna pasada de margen: I-2 ahorra 0 allí.

## Protocolo y evidencia

Se partió del producto con I-1 (`b76d18c`, árbol actual en `0017f8c`) y de
los cuatro PDF congelados de la campaña M-1/M-2. Un patch experimental de
6.666 bytes (`tests/perf/support/margin-i2-instrument.patch`, copia idéntica en
`.measure/margenes-i2/20260917-probe/instrument.patch`, SHA-256
`2000e95a76076d0a5262aae760da287f5b6a2827c5aa40c130e0d311197c3e7e`)
analizó las franjas que I-1 **no** salta. Para cada una calculó la primera y
última fila con algún píxel presente fuera de las cajas explicadas. Reutilizó
literalmente el predicado exacto de I-1 (`isPixelPresent`), su proyección y su
dilatación de 1 px. El control hizo el mismo análisis y entregó a Tesseract
la franja completa. Las variantes recortaron las filas residuales con padding
de 0, 32, 64 o 128 px, sin redimensionar ni alterar los píxeles conservados;
al mapear las palabras de vuelta sumaron el desplazamiento vertical del
recorte. Si el análisis no daba una caja válida, conservaron la franja entera.

El patch solo vivió durante cada corrida. El runner
`tests/perf/run-margin-i2-probe.sh` guardó `build.log`, `playwright.log`,
`manifest.json` y `session.json` por condición en
`.measure/margenes-i2/20260917-probe/`. Los manifiestos fijan SHA-256 de
fixture, fuentes instrumentadas, lockfiles y artefactos `dist/assets`. El
runner restauró por `trap` los dos archivos de producto y los verificó byte a
byte contra sus snapshots. La configuración fue Electron real, build fresco
con `VITE_E2E=1`, usuario nuevo, frío→caliente, un worker de Playwright,
retries 0 y el mismo pool 4/2/2/4 de I-1. No hubo cambios de contrato ni de
dependencias.

La huella compara la secuencia completa de palabras OCR: texto, fuente,
página, confianza, caja y rotación. Se exige igualdad exacta con I-1, no solo
un conteo igual. El fixture qa-stamp tiene 79 palabras en total, de las
cuales 21 fueron aportadas por las franjas (15 rotadas esperadas y 6 sobrantes
ya presentes en ADR-121).

## Geometría exacta del residuo

En qa-stamp sobreviven dos franjas de 357 × 2.526 px. El residuo **exacto**
ocupó filas `[428,1361)` a la izquierda y `[379,2166)` a la derecha, idénticas
en frío y caliente. La medición anterior basada en brillo estimaba
`[428,746)` a la izquierda: para I-2 era demasiado optimista porque ignoraba
píxeles tenues que I-1 sí considera presentes. Con el padding de 64 px se
entregaron a Tesseract `[364,1425)` y `[315,2230)`, una reducción conjunta
de **41,1 % de área**. P2, T5 rotado y márgenes blancos registraron cero
franjas supervivientes después de I-1.

| Padding | Área eliminada en qa-stamp | Palabras OCR | Huella frente al control |
| ---: | ---: | ---: | --- |
| Control | 0 % | 79 | Igual a I-1 |
| 0 px | 46,2 % | 77 | Distinta: desaparecieron `olO4`, `TIAID`, `OAY9ZAF`; apareció `ING` |
| 32 px | 43,6 % | 78 | Distinta: desapareció `olO4` |
| 64 px | 41,1 % | 79 | **Idéntica**, frío y caliente |
| 128 px | 36,0 % | 79 | **Idéntica**, frío y caliente |

Los textos que desaparecieron son **sobrantes** del OCR actual: el
multiconjunto de las 15 palabras reales del sello y folio se conservó en las
cinco condiciones. El cambio se reprodujo en frío y caliente y confirma que
el análisis de Tesseract depende del contexto blanco. No es evidencia de
pérdida de una palabra real en este fixture. Sin embargo, 0 y 32 px incumplen
la huella completa exigida por el plan §5/§6; no se relaja ese gate después
de ver el resultado. La igualdad de 64 y 128 px prueba solo este PDF sintético.

## Tres parejas alternadas, 64 px

Se midió `control → 64`, `64 → control`, `control → 64`, cada sesión en frío y
caliente. La resta es control − recorte; `ocrDurationMs` es el tiempo neto de
OCR completo, incluido el costo del análisis y del recorte. Los archivos
crudos son `qastamp-control/`, `qastamp-pad64/`, `qastamp-pad64-b2/`,
`qastamp-control-a2/`, `qastamp-control-a3/` y `qastamp-pad64-b3/` bajo el
directorio de evidencia anterior.

| Pareja | Δ OCR frío | Δ OCR caliente | Δ de las cuatro pasadas, frío | Δ de las cuatro pasadas, caliente |
| --- | ---: | ---: | ---: | ---: |
| 1 | 253 ms | 151 ms | 102,2 ms | 100,6 ms |
| 2 | 105 ms | 80 ms | 91,8 ms | 101,3 ms |
| 3 | 148 ms | 145 ms | 93,7 ms | 144,1 ms |

Las seis comparaciones conservaron la huella
`866a3bccd239326a7e4122c1611153f8f2ac6c4c612c8df385a606fd2c737c9e`
(79 palabras). El ahorro neto medio de OCR completo fue **147 ms por página**,
**6,0 %** de los 2.455 ms medios del control qa-stamp. La suma de los tramos
`rotateImageData` + `toTesseractImage` + `recognizeWithTimeout` de las cuatro
pasadas bajó **105,6 ms**, de 586,6 a 481,0 ms medios: **18,0 %**. El resto
de la franja (decodificación, compuertas, búsqueda de residuo y copia del
recorte) queda fuera de ese cronómetro interior, pero dentro de
`ocrDurationMs`. El 18,0 % describe solo el tramo cronometrado dentro de las
pasadas, no el costo total de margen: no se usa como sustituto del criterio
de §5. La ganancia neta de 147 ms se observó solo en el documento que todavía
tenía franjas activas.

El control P2 con padding de 64 px conservó 50 páginas, 1.038 palabras y
huella `c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49`,
con **cero** franjas recortadas. T5 rotado conservó cuatro páginas, 660
palabras y huella `534505a170185c2687a47cabce2ba772d0a380222efe0d32734caf9799707fa0`;
márgenes blancos conservó 30 palabras y huella
`41c1c9d600f3b598f8c92c2825891019b5fde82891459140bb824093f1082957`.
También tuvieron cero franjas recortadas y coincidieron con sus controles
históricos.

## Decisión y límite

**I-2 se cierra sin ADR ni cambio de producto.** El padding que conservó la
huella en qa-stamp no reduce P2 en absoluto: en ese benchmark el ahorro de
I-2 es cero frente al piso de ≥20 % fijado antes de medir.
El hecho de que 0 y 32 px alteraran la salida confirma que el layout de
Tesseract es sensible al recorte, aunque las 15 palabras verdaderas
sobrevivieron. Hay solo **dos franjas positivas de un único PDF sintético**;
eso no autoriza a declarar seguro ningún padding para sellos
de documentos reales. Si un corpus representativo futuro muestra muchas
franjas supervivientes y ahorro suficiente, I-2 requerirá una nueva medición
de calidad sobre ese corpus antes de reabrirse.

No se implementó I-2, no se hizo commit ni push. El producto quedó idéntico
a los snapshots de entrada. El spec `tests/perf/margin-i2-probe.spec.ts` y su
runner son solo arnés de medición opt-in; no se ejecutan en los gates comunes.
