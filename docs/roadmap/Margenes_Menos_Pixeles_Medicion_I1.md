<!-- CONTEXT: scope=medicion-i1 | dependencias=roadmap/Margenes_Menos_Pixeles_Implementacion_Handoff.md,roadmap/Margenes_Menos_Pixeles_Handoff.md,roadmap/Margenes_Menos_Pixeles_Plan.md,roadmap/Margenes_Menos_Pixeles_Resultados.md | audiencia=planificador+humano | fase=11 -->

# I-1 — medición A/B real (campaña reproducible v2)

Fecha de ejecución v2: 2026-09-17. Se midió el árbol anterior a I-1
(`3650ce7`, BEFORE) contra el árbol con I-1 (`b76d18c`, AFTER). No se tomó
decisión de conservación en este documento.

La campaña anterior bajo `.measure/margenes-i1/20260916-*` queda conservada
como evidencia preliminar histórica, **inválida para la aceptación
metodológica** de esta entrega porque no tenía manifiestos, logs ni runner
único. Los resultados de este documento usan exclusivamente
`.measure/margenes-i1-v2/20260917-reproducible/`.

## Identidad y precondiciones

El fixture P2 es `.measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf`,
1.714.563 bytes, SHA-256
`26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f`.
El fixture qa-stamp es
`.measure/fixtures/qa-stamp-scanned-4ce6e18e6411309f.pdf`, SHA-256
`4ce6e18e6411309f93bd59fc0f15b3816d689ab763fc3917791f09742d41c381`.
También se verificaron las huellas congeladas de T5 rotado
(`1df5651d37c2b15d498418477ff8b0a315c13e1647e88b1e7eeaddc6ff60e083`) y
márgenes blancos
(`848789ae0cc9e3d9011789ea42ee85fa81fce3b5a8ea63557ef3cf08b023add7`).

La precondición estructural se comprobó con el contador descartable de
pasadas: BEFORE produjo `200` pasadas en cada sesión P2 (100 franjas × 2
rotaciones) y AFTER produjo `0`. La primera pareja completa fue instrumentada
en ambos estados; las corridas posteriores conservaron la misma configuración
y huella de build. No se modificó el árbol entregable de `packages/**` al
cerrar la campaña.

Configuración fija: Electron real, un worker de Playwright, retries 0,
`pdfPoolSize=4`, `ocrPoolSize=2`, `nerPoolSize=2`, `renderPoolSize=4`, NER
habilitado, idiomas `spa`+`eng`, DPI 300 y `maxLiveImageBytes=128 MiB`.
Cada sesión fue build fresco con `VITE_E2E=1`, `userData` nuevo, frío → cerrar
→ caliente.

El runner reproducible es `tests/perf/run-margin-i1-campaign-v2.sh` (acepta
`ANONLY_MARGIN_I1_V2_OUTPUT_DIR` para elegir un directorio nuevo y rechaza
cualquier directorio existente antes de escribir). Usa
`set -euo pipefail`, un `trap` de restauración, copia y hash del snapshot,
verificación de que no hay Playwright activo antes de cada corrida, build
fresco por sesión y logs independientes (`build.log` y `playwright.log`). Cada
sesión tiene además un `manifest.json` con commit base, hashes de fuentes
instrumentadas, fixture, `pnpm-lock.yaml`, `assets.lock.json` y hashes
individuales y agregado de `dist/assets`. Se verificó el ciclo de instrumento
AFTER y BEFORE por comparación byte a byte antes de iniciar la campaña.

## Tres pares alternados sobre P2

El orden fue `B1/A1, A2/B2, B3/A3`, donde B = AFTER y A = BEFORE. El valor
es `ocrDurationMs`; la resta es BEFORE − AFTER. El ahorro informado ya incluye
el costo de la compuerta de I-1 porque se mide sobre la duración neta del OCR.

| Par | BEFORE frío | AFTER frío | Δ frío | BEFORE caliente | AFTER caliente | Δ caliente |
|---|---:|---:|---:|---:|---:|---:|
| B1/A1 | 17.874 ms | 11.616 ms | 6.258 ms | 18.015 ms | 11.250 ms | 6.765 ms |
| A2/B2 | 17.719 ms | 11.581 ms | 6.138 ms | 18.111 ms | 13.285 ms | 4.826 ms |
| B3/A3 | 17.916 ms | 11.475 ms | 6.441 ms | 18.652 ms | 11.674 ms | 6.978 ms |

Delta medio de las seis comparaciones: **6.2343 s** (37.406 s acumulados en
las seis comparaciones). Las medias por pareja fueron 6.5115 s, 5.482 s y
6.7095 s. La reducción observada es positiva en los tres pares; el valor
bruto no se presenta como ahorro porque el costo de la inspección ya está
dentro de cada `ocrDurationMs` AFTER.

Evidencia cruda:

- `.measure/margenes-i1-v2/20260917-reproducible/before-p2-a1/`
- `.measure/margenes-i1-v2/20260917-reproducible/after-p2-b1/`
- `.measure/margenes-i1-v2/20260917-reproducible/before-p2-a2/`
- `.measure/margenes-i1-v2/20260917-reproducible/after-p2-b2/`
- `.measure/margenes-i1-v2/20260917-reproducible/before-p2-a3/`
- `.measure/margenes-i1-v2/20260917-reproducible/after-p2-b3/`

## Calidad y qa-stamp

Las seis sesiones P2 dieron la huella idéntica
`c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49`, 50
páginas y 1.038 palabras, tanto en frío como en caliente. No hubo pipeline
fallido.

qa-stamp conservó la misma huella AFTER y BEFORE, 79 palabras OCR totales en
la sesión, y el contador A/B registró 4 pasadas en ambos estados. El conteo
específico del sello es **21 palabras** (7 en la tira izquierda y 14 en la
derecha: 15 rotadas más 6 sobrantes), según la evidencia previa de la misma
fixture en
`.measure/margenes-tinta/20260916-351fc4d3/m1b/case-qastamp/analysis.json`.
El A/B no vuelve a emitir un contador por tira: su arnés registra el total de
pasadas y la huella completa de `Word[]`. La huella canónica incluye cada
palabra, texto, fuente, geometría y confianza; al ser idéntica a BEFORE, y
conservarse las 79 palabras totales, las 21 palabras de margen ya observadas
en la medición específica también se conservaron. La evidencia específica
previa aporta la atribución izquierda/derecha; el A/B aporta la regresión
contra el árbol BEFORE. Evidencia reproducible de la sesión A/B:

- `.measure/margenes-i1-v2/20260917-reproducible/before-qastamp/`
- `.measure/margenes-i1-v2/20260917-reproducible/after-qastamp/`

## Corridas inválidas y restore

Las nueve salidas de la campaña v1 siguen archivadas, pero quedan rotuladas
preliminares/inválidas para aceptación metodológica. En v2 no hubo corridas
inválidas de pipeline, calidad o fixture. El runner restauró exactamente el
árbol AFTER de `b76d18c` por hashes del snapshot, incluyendo todos los
archivos afectados del motor y sus tests. No se ejecutó `git commit` ni
`git push`.

## Instrumentación entregada

El arnés queda en `tests/perf/margin-i1-campaign.spec.ts`, el runner
reproducible en `tests/perf/run-margin-i1-campaign-v2.sh` y el contador
descartable del host en `tests/perf/support/marginPassCount.ts`, con su test
unitario. El contador de kernel usado para confirmar la precondición fue
revertido después de las corridas; no forma parte del producto.

La medición deja los datos para que el planificador y el humano decidan si
conservar I-1. Este documento no toma esa decisión.
