# T-5 — Cierre funcional pendiente

> **Historial cerrado:** T5 aceptada el 2026-09-15. Las instrucciones,
> pendientes y resultados de este documento reflejan sus etapas anteriores;
> el estado vigente está en [el cierre final](T5_OSD_Compartido_Cierre_Final.md).
> No reanudar encargos históricos ni repetir mediciones por estas notas.

Fecha: 2026-09-15. Evidencia factual posterior a la campaña A/B/C. Este
documento no declara T5 cerrada; deja separadas las correcciones funcionales y
los límites que debe revisar el planificador.

## Requisito → assert → resultado (evidencia histórica previa a ADR-164 §5.1)

| Requisito | Assert/evidencia | Resultado |
| --- | --- | --- |
| `dispose` espera todas las ramas | `t5-shared-osd.test.ts`: `dispose waits for rejected-session branches before releasing or accepting new OCR` | Pasa. Tras rechazo temprano de una rama, `dispose` queda pendiente; no libera pools ni despacha OCR hasta resolver el productor superviviente. |
| Drenaje de ramas activas | `waitForNoActivePages` y `resolveActiveDrains` exigen `activeProcessBranches === 0`; `runBranch` decrementa en `finally` | Pasa en suite OCR. La guarda cubre fast path, rechazo de sesión y liberación durante producción. |
| Regiones repetidas por `pageIndex` | `t5-shared-osd.test.ts`: dos requests concurrentes del mismo documento y página, imágenes distintas, OSD serializado y reconocimiento desordenado | Pasa. Cada job conserva su imagen/orientación y la salida mantiene ambos `pageIndex=4`. |
| Aislamiento de motores | Dos `OcrEngine` con mapas de orientación dependientes de ancho; se libera A y se procesa B con una segunda imagen | Pasa. B conserva su estado y responde 180/270 después de liberar A. |
| Fixture independiente de OCR | `t5PixelOrientationGroundTruth()` calcula texto, DNI, 18 regiones sensibles por página y una región externa desde el PDF fuente y la fuente Helvetica | Pasa; las 90 regiones sensibles tienen tinta en el PDF de entrada. |
| Giros físicos y geometría | `t5-orientation-pixel.spec.ts`, rotaciones `[0,90,180,0,270]`; cada página contiene texto esperado y una caja con el ángulo OCR esperado (90 físico → 270 en `BoundingBox`, 270 físico → 90) | Pasa en Electron real. |
| Entidades normalizadas | Eventos `regex/ENTITY_FOUND`, conjunto esperado completo `18445212`, `34567891`, `42998103` | Pasa antes y después del reanálisis. |
| Redact explícito | Selección UI `Tapar con negro` para los tres grupos DNI después del reanálisis | Pasa; se verifica el nombre accesible del modo para cada grupo. |
| Censura por región | 40 muestras interiores por cada una de las 90 regiones; `blackFraction >= 0.6` en el PDF exportado | Pasa para todas las regiones, incluyendo páginas enteras giradas. |
| Conservación externa | Cinco regiones del texto `Pagina sintetica N`, fuera de regiones sensibles; tinta presente y fracción oscura ≥20% de la fuente | Pasa. |
| Reanálisis real/reconstrucción | Cambia idiomas, confirma diálogo, espera `OCR_FINISHED` posterior y compara texto, fuente, pageIndex y bbox antes/después | Pasa; segunda sesión observada y cinco páginas conservadas. |

## Validación adicional de los cinco pendientes de revisión (2026-09-15)

| Requisito | Assert | Resultado |
| --- | --- | --- |
| Conservación externa con control negativo | ADR-164 §5.1: 144 DPI, recorte floor/ceil, máscara `v < 128`, correspondencia Chebyshev 1 bidireccional, precision/recall ≥0,95 por región; controles fuente consigo misma, negro y blanco | Pasa en E2E Electron; cinco regiones y controles ejecutados. JSON: `.measure/t5-e2e/orientation-1789502705338/external-regions-144dpi.json`. |
| Reanálisis por generación | Se vacían las colecciones antes de la segunda sesión; se exigen exactamente las páginas `[0,1,2,3,4]` y el conjunto `(pageIndex,tipo,valor)` esperado, con igual cardinalidad y sin fallos nuevos | Pasa; las cinco páginas y ocurrencias normalizadas se observan en la generación nueva. |
| Reconstrucción observable | Dos sesiones separadas por `releaseIdleWorkers`; se observan cuatro llamadas a `createWorker` y los recursos de ambas generaciones | Pasa; la segunda sesión crea servicios nuevos. |
| Aislamiento de recursos OSD | Dos `OrientationKernel` usan workers Tesseract simulados distintos; liberar A termina A y B sigue detectando con su worker | Pasa; `terminate(A)` ocurre una vez y B completa dos detecciones. |
| Orden de regiones con pageIndex repetido | Reconocimiento devuelve palabras `region-100`/`region-200`, completa 200 antes que 100 y se exige salida en orden descriptor `[100,200]` con payloads y orientaciones correctas | Pasa; outputs distintos, orden exacto y payloads verificados. |

## Ejecución y artefactos

Prerrequisitos de infraestructura verificados: ESLint ignora exactamente
`.measure/**` y `.agents/skills/**`, mantiene los nueve archivos explícitos y
fija `maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 9`;
Prettier ignora los mismos dos directorios. El helper exclusivo de 200 páginas
fija CreationDate/ModDate a `2026-01-01T00:00:00.000Z`. Los cuatro tests de
determinismo (`text-50p`, `text-50p-dense`, `text-50p-small-page` y `text-200p`)
fuerzan relojes 2030/2040 y confirman bytes idénticos y ambas fechas con
`updateMetadata: false`. Typecheck y ESLint scoped pasan; los seis tests
dirigidos de determinismo pasan. Se conservaron los generadores, APIs,
contenido y dimensiones.

Comandos efectivos: `pnpm exec vitest run packages/anonymization-core/ocr-engine/src/__tests__/t5-shared-osd.test.ts packages/anonymization-core/ocr-engine/src/__tests__/orientation-kernel.test.ts --coverage=false`; `pnpm exec tsc -p tests/e2e/tsconfig.json --noEmit`; build fresco `VITE_E2E=1 pnpm --filter @anonly/react-client build && pnpm --filter @anonly/desktop-shell build`; y `ANONLY_T5_E2E=1 pnpm exec playwright test --config=playwright.electron.config.ts tests/e2e/t5-orientation-pixel.spec.ts --workers=1 --retries=0`.

Resultado última ejecución: **1 passed (32.2 s)**. PDF exportado:
`.measure/t5-e2e/orientation-1789502705338/anonymizado.pdf`.

La implementación de drenaje está en
`packages/anonymization-core/ocr-engine/src/ocr.engine.ts`; su repro permanente
y las pruebas de lookahead, presupuesto, cancelación, identidad y aislamiento
están en `packages/anonymization-core/ocr-engine/src/__tests__/t5-shared-osd.test.ts`.
El fixture y los muestreos están en `tests/e2e/support/fixtures.ts`,
`tests/e2e/support/scannedPdf.ts` y
`tests/e2e/t5-orientation-pixel.spec.ts`.

El snapshot funcional final, conservando el snapshot anterior de C, es
`.measure/t5-osd/t5-20260915-separated-20260915-105519/snapshots/final-C-functional-20260915-1229/`;
su manifiesto SHA-256 es
`.measure/t5-osd/t5-20260915-separated-20260915-105519/manifests/final-C-functional-20260915-1229-sha256.txt`.
Los artefactos de campaña y los PDFs E2E previos permanecen en sus directorios
originales.

Artefactos E2E de la última ejecución: PDF exportado
`.measure/t5-e2e/orientation-1789493391136/anonymizado.pdf` y JSON de regiones
`.measure/t5-e2e/orientation-1789502705338/external-regions-144dpi.json`.

## Gates

- Suite OCR: 166 tests pasan; cobertura scoped: 96.07% de líneas (incluye el
  repro permanente de drenaje tras rechazo temprano y la finalización OCR
  desordenada con `pageIndex` repetido).
- Test de soporte de instrumento: 27 tests pasan.
- Typecheck OCR y E2E, build OCR, ESLint scoped, Prettier y `git diff --check`
  pasan tras la corrección.
- No se ejecutó A/B/C nuevamente ni se modificó ImageData, DPI, franjas o
  configuración de pools.

La comprobación por región prueba cobertura sensible y conservación de una
zona externa del fixture, pero no constituye un oráculo independiente de cada
palabra OCR posible ni de documentos arbitrarios. La aceptación final y el
cierre de T5 quedan pendientes de revisión; no se hizo commit ni push.
