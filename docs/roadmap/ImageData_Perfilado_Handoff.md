<!-- CONTEXT: scope=handoff-perfilado | dependencias=roadmap/ImageData_Perfilado_Plan.md,roadmap/T5_ImageData_Investigacion.md,roadmap/T5_OSD_Compartido_Cierre_Final.md,roadmap/T5_OSD_Compartido_Handoff.md,adr/ADR-121-El-Sello-Rotado-Vive-En-El-Margen.md,adr/ADR-159-La-Medicion-Es-Del-Heap-No-Del-RSS.md,adr/ADR-160-El-Worker-De-OCR-No-Decodifica-La-Pagina.md,adr/ADR-162-Solo-Una-Franja-Visualmente-Blanca-Se-Saltea.md | audiencia=implementador+revisor+humano | fase=11 -->

# ImageData — handoff de perfilado (pasos 1-4 del plan)

Fecha: 2026-09-15. Lo escribe el planificador para cerrar el hueco que el
propio [`ImageData_Perfilado_Plan.md`](ImageData_Perfilado_Plan.md) declara en
«Límites y roles»: *el instrumento y los criterios faltantes los diseña el
planificador, y este plan no autoriza al implementador a improvisar una
arquitectura de instrumentación*. Acá está esa arquitectura, ya decidida.

## 0. Alcance — qué se hace y qué NO

**Se ejecutan los pasos 1 a 4 del plan: congelar la referencia, perfilar,
casos mínimos y medición.** El entregable es evidencia, no una optimización.

No se implementa ninguna de las dos candidatas (copia RGBA redundante,
transposición por bloques). Esa elección es el paso 5 y la hace el planificador
**con el perfil en la mano**, con su ADR y sus filas de `OCR_Engine.md` §14
antes de que nadie toque el kernel entregable (R-2, R-19, R-21).

No se cambia PNG, DPI, heurísticas, cantidad de pasadas, `MARGIN_STRIP_RATIO`,
`ROTATED_MIN_CONFIDENCE` ni la compuerta exacta de ADR-162. No se abre T-4b.
No se agrega telemetría permanente ni dependencias (R-12). **No se commitea ni
se pushea nada** (I-9): la fase termina con el árbol entregable byte a byte
igual al de §1 y la evidencia en `.measure/`.

Decisiones del humano que fijan este handoff (2026-09-15): instrumento en
build instrumentado descartable; caso positivo por rasterizado de
`qa-stamp.pdf`; perfil completo antes de cualquier implementación.

## 1. Referencia funcional congelada

La referencia es **el árbol de trabajo actual**, que es el estado aceptado en
[`T5_OSD_Compartido_Cierre_Final.md`](T5_OSD_Compartido_Cierre_Final.md) y que
todavía **no está commiteado**. Antes de tocar nada, materializar su identidad:

- `git rev-parse HEAD` (control: `4896151`) y `git status --porcelain` completo.
- `git diff HEAD > .measure/imagedata-profile/<campaña>/reference.patch`, más
  los archivos sin trackear relevantes copiados aparte, y el SHA-256 del patch.
- SHA-256 de `ocr-engine/src/worker/kernel.ts`, `orientation-kernel.ts`,
  `ocr.engine.ts`, `apps/react-client/src/core-adapter/index.ts`,
  `pnpm-lock.yaml`, `assets.lock.json` y de cada archivo de `dist/assets`.
- Versiones de Node/pnpm/Electron/Tesseract, SO/CPU/RAM, y configuración
  efectiva (§4). Todo esto va en el `manifest` de cada JSON de salida.

Fixture P2 congelado: `.measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf`,
SHA-256 `26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f`.
**No regenerarlo**: la metadata de los generadores acaba de estabilizarse y un
PDF nuevo no compara contra el historial de la campaña A/B/C.

Al terminar la campaña, verificar por hash que `packages/**` y `apps/**`
quedaron idénticos a este punto. Un hash distinto invalida la entrega.

## 2. Instrumento — arquitectura decidida

### 2.1 Dónde vive

Un **diff descartable** sobre el kernel, igual que las condiciones A/B/C de
T5: se aplica, se hace build, se mide, se revierte. Se conserva como
`.measure/imagedata-profile/<campaña>/instrument.patch` con su SHA-256, y
**nunca** entra a un commit. El árbol entregable no gana marcas, ni flags, ni
campos de config, ni `console.*` (P-4).

El código que **sí** es entregable vive en `tests/`:
`tests/perf/imagedata-profile.spec.ts` y `tests/perf/support/imageDataProfile.ts`,
con su `imageDataProfile.test.ts` propio. Ese módulo tipa los registros, agrega
por etapa y **falla** si los invariantes no se cumplen (§5). Un instrumento que
mide mal no tira error, devuelve un número: probarlo ejecutable con casos
sintéticos de entrada antes de confiar en una sola corrida de Electron.

### 2.2 Qué se cronometra

Todos los intervalos con `performance.now()` **del propio worker de OCR**, un
solo origen de reloj, sin mezclar con relojes del host. Por cada pasada de
franja y por cada página principal:

| Etapa | Qué encierra |
| --- | --- |
| `stripDecode` | `decodeStrip` (camino común) o `cropImageData` (orientación ≠ 0) |
| `whiteGate` | `isVisuallyWhiteStrip` |
| `rotate` | `rotateImageData` completo |
| `copy` | **anidado en `rotate`**: solo `createImageDataResult` |
| `canvas` | `toTesseractImage`: `new OffscreenCanvas` + `putImageData` |
| `encode` | `convertToBlob()` explícito del canvas (ver 2.3) |
| `recognizeCall` | `recognizeWithTimeout` entera — incluye serialización y espera |
| `merge` | filtrado por confianza, `unrotateBbox`, solape y armado de `Word` |
| `fullDecode` | `decodeEncodedImage` del camino orientación ≠ 0 |
| `pageRotate` | `rotateImageData` de página entera (orientación ≠ 0) |

Contadores por página: pasadas ejecutadas, franjas salteadas por blanco,
candidatas crudas, descartadas por confianza, descartadas por solape y
**palabras efectivamente añadidas**, discriminadas por franja y por rotación.
Ese último número es el que separa beneficio funcional de trabajo que solo
produce candidatos descartados.

`recognizeCall` **no** es tiempo de inferencia: nombrarla así en el reporte.
El OSD corre en otro worker y no se perfila acá.

### 2.3 El PNG, que hoy no es observable

Verificado en la fuente de tesseract.js 6.0.1 (`src/worker/browser/loadImage.js`,
llamado desde `createWorker.js:174`): `loadImage` corre en **nuestro** hilo y
hace `await image.convertToBlob()` seguido de un `FileReader`. El encode PNG ya
está adentro de `recognizeCall`, invisible.

El instrumento lo hace visible **pre-encodeando en el kernel**: el canvas se
convierte a `Blob` con `convertToBlob()` (PNG, el mismo default) y a
`recognize()` se le pasa ese Blob. Son los mismos bytes que tesseract.js
produciría, y la rama `image instanceof Blob` de `loadImage` ya está soportada.

**Esto cambia el camino del instrumento**, y por eso el control de §4.3 es
obligatorio y su resultado se reporta **antes** que cualquier número por etapa.
Si el control muestra que el instrumento mueve el total más allá de su propia
dispersión, el reparto por etapa se informa como orientativo, no como medición.

### 2.4 Cómo salen los números del worker

El kernel acumula un registro por job en su propio scope y lo adjunta al
resultado del job. El host instrumentado lo empuja a
`globalThis.__anonlyImageDataProfile`, que el spec lee con `page.evaluate` —
el mismo patrón que `__anonlyMemoryRun` de `memoryProfile.ts`, que ya funciona
con `VITE_E2E=1`. No se agrega un `WorkerJobType`, ni un canal de eventos, ni
correlación nueva: cualquiera de esas cosas cambiaría el scheduling que se está
midiendo. Fallback único autorizado si el sobre resulta inviable:
`Runtime.consoleAPICalled` por sesión de worker sobre el cliente CDP existente
de `cdpHeap.ts`; declararlo en el reporte si se usa.

## 3. Casos mínimos

1. **P2 congelado, 50 páginas** (§1). Costo sin ganancia de texto esperada.
   Sus 100 franjas están activas: 4 pasadas por página, 200 en el documento.
2. **Fixture T5 de páginas 0/90/180/270.** Ejercita el camino lento:
   `fullDecode` + `pageRotate` + franjas sobre el raster enderezado.
3. **Caso positivo — `qa-stamp.pdf` rasterizado.** Producirlo con
   `tests/e2e/support/scannedPdf.ts` a partir de `tests/fixtures/qa-stamp.pdf`,
   congelarlo en `.measure/fixtures/` con su SHA-256 y usar siempre ese archivo.
   Ground truth de ADR-121: **15 palabras rotadas**, de las cuales la pasada
   derecha sola recupera **2**. El perfil debe mostrar cuántas aporta cada
   pasada de margen y a qué costo. Es un sintético limpio: no extrapolar a
   tinta tenue ni a ruido de escaneo real.
4. **Márgenes exactamente blancos.** Comprueba la omisión ya existente de
   ADR-162: el conteo de franjas salteadas tiene que dar el esperado y las
   pasadas correspondientes no deben aparecer en el perfil. Es un control de
   que el instrumento cuenta lo que pasa, no lo que el código promete.

## 4. Protocolo de medición

### 4.1 Variables fijas

Electron real vía `playwright.perf.config.ts`, un worker, retries 0, sin
screenshots/video/trace. Misma máquina y alimentación en toda la campaña.
Por el canal de overrides (ADR-155): `pdfPoolSize: 4`, `ocrPoolSize: 2`,
`nerPoolSize: 2`, `renderPoolSize: 4`, NER habilitado, idiomas `spa`+`eng`,
DPI 300, `maxLiveImageBytes = 128 * 1024 * 1024`. T-6a vigente. Tres
consumidores, que es el AFTER aceptado de ADR-164 §2.3.

Directorio `userData` nuevo por sesión. Cada sesión hace frío → cerrar →
caliente, como `measureProfile`. Comparar frío con frío y caliente con caliente.

```bash
VITE_E2E=1 pnpm --filter @anonly/react-client build
pnpm --filter @anonly/desktop-shell build
pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/imagedata-profile.spec.ts --workers=1 --retries=0
```

### 4.2 Higiene de corridas

- Antes de lanzar, `pgrep -f '[p]laywright test --config'` — con el corchete,
  o el patrón se matchea a sí mismo y la espera cuelga. Dos mediciones
  simultáneas arruinan las dos; ya costó una tanda entera.
- No correr `vitest` mientras hay una medición: `generate.test.ts` verifica
  determinismo del generador y da rojo falso por colisión.
- No hacer build de una condición mientras se mide otra.

### 4.3 Orden y control del instrumento

Por cada uno de los casos 1 y 3: **tres pares alternados** —
`I1/C1, C2/I2, I3/C3`— donde `I` es build instrumentado y `C` build limpio.
`C` mide solo tiempo OCR/Ready y RSS; el delta `I − C` es el sobrecosto del
instrumento. Casos 2 y 4: **un par**, y sus números son estructurales
(conteos, presencia de etapas), no estadísticos.

Cada directorio de corrida es nuevo y se niega a sobrescribir uno existente.
Una corrida inválida se conserva rotulada con su causa. Se repite **a lo sumo
una vez** el par afectado, por fallo operativo o
`hotBaselineSettled=false`/`peakWithinPhases=false`; se guardan los dos
intentos. No se repite selectivamente por una cifra que no gustó, ni se elige
el mínimo.

### 4.4 Memoria

RSS por proceso y pico de la suma simultánea en ventana OCR, con serie cruda y
dispersión, reutilizando `memoryProfile.ts`. Vale el límite de ADR-159:
`Runtime.getHeapUsage` no ve la memoria lineal WASM, y el ruido de RSS no es
ahorro ni equivalencia. Esta fase **no** promete una cifra de memoria.

## 5. Salida, invariantes y reporte

`.measure/imagedata-profile/<AAAAMMDD>-<slug>/case-<n>/pair-<k>-<instrumented|clean>.json`,
con: `manifest` de identidad (§1), `fixture` (path, bytes, SHA-256), registros
por página y por pasada, agregados por etapa (**mediana y p10/p90 con su n**,
nunca solo el promedio), tiempos OCR/Ready, muestras de RSS y la huella de
calidad por `qualityFingerprint`.

Invariantes que el agregador verifica y que hacen fallar la corrida:

- `copy` ⊆ `rotate`: se reporta aparte y **no se suma** al total de etapas.
- Ningún par de intervalos hermanos se solapa; la suma de etapas no se
  presenta como duración de pared de la sesión, que tiene dos reconocedores
  concurrentes.
- Pasadas contadas = franjas activas × 2 rotaciones, y franjas salteadas +
  activas = franjas inspeccionadas.
- La huella de calidad de P2 coincide con la histórica de la campaña A/B/C.

Reporte final en `docs/roadmap/ImageData_Perfilado_Resultados.md`: sobrecosto
del instrumento primero, después el reparto por etapa con sus límites, el
aporte de palabras por pasada del caso positivo, los conteos estructurales de
los casos 2 y 4, y las corridas inválidas con su causa. **Sin recomendación de
implementación y sin elegir candidata**: eso es del planificador.

Un resultado que contradiga lo esperado se reporta tal cual. Si el perfil
muestra que las dos candidatas autorizadas son una fracción chica del costo,
eso **es** el hallazgo y no se compensa ampliando el alcance por cuenta propia.

## 6. Gates y entrega

Con el patch del instrumento **revertido**:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract
```

El módulo nuevo de `tests/perf/support/` lleva sus tests unitarios (agregación,
invariantes, parseo de registros malformados). Verificar por hash que
`packages/**` y `apps/**` quedaron como en §1. Sin commit, sin push.

La entrega es: los JSON crudos, los dos patches con sus hashes, el reporte de
§5 y la lista explícita de lo que quedó sin medir.

## 7. Ambigüedad

Si un caso no está cubierto acá, dos documentos se contradicen, o un tipo,
evento o helper referenciado no existe: **detener y reportar** archivo, sección,
cita textual y pregunta concreta. No inventar una arquitectura de
instrumentación alternativa, no ajustar un umbral para que dé verde, y no
implementar una candidata «ya que estamos».
