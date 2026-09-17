<!-- CONTEXT: scope=handoff-medicion | dependencias=roadmap/Margenes_Menos_Pixeles_Plan.md,roadmap/ImageData_Perfilado_Resultados.md,roadmap/ImageData_Perfilado_Handoff.md,adr/ADR-121-El-Sello-Rotado-Vive-En-El-Margen.md,adr/ADR-162-Solo-Una-Franja-Visualmente-Blanca-Se-Saltea.md,adr/ADR-164-Un-OSD-Compartido-Por-Core.md | audiencia=implementador+revisor+humano | fase=11 -->

# Márgenes — handoff de M-1 + M-2 (tinta residual y su caja)

Fecha: 2026-09-16. Lo escribe el planificador para que
[`Margenes_Menos_Pixeles_Plan.md`](Margenes_Menos_Pixeles_Plan.md) §4 sea
ejecutable sin que el implementador tenga que inventar la arquitectura del
análisis. El plan fija el porqué; esto fija el cómo.

## 0. Alcance

**Se ejecuta M-1 + M-2 en una sola corrida por fixture: medir cuánta tinta
del margen queda sin explicar tras proyectar las palabras ya reconocidas, y
dónde está.** El entregable es un histograma con su interpretación, no una
optimización.

**No se implementa I-1, I-2 ni I-3.** No se cambia la compuerta de ADR-162,
ni el número de pasadas, ni el DPI, ni el recorte de franja, ni ningún
umbral. No se mide la variante de I-1 que le entrega píxeles enmascarados a
Tesseract. **No se commitea ni se pushea** (I-9): la fase termina con el
árbol entregable idéntico al de §1, verificado por hash.

Esto **no es una campaña de tiempo.** El análisis es determinista sobre
píxeles: no hay pares alternados, ni orden I/C, ni frío contra caliente como
diseño estadístico. Ese protocolo pertenecía a la fase anterior y no aplica
acá. Lo único que se repite es una segunda corrida de P2 para confirmar que
el análisis da idéntico (§4.3).

## 1. Referencia congelada

Campaña nueva, directorio nuevo: `.measure/margenes-tinta/<AAAAMMDD>-<slug>/`.
Se congela igual que en la fase anterior, porque el árbol volvió a moverse:
ahora incluye los entregables del perfilado.

- `git rev-parse HEAD` (control: `4896151`) y `git status --porcelain`.
- `git diff HEAD > reference.patch` + SHA-256, y copia de los archivos sin
  trackear con su listado.
- SHA-256 de `ocr-engine/src/worker/kernel.ts`, `ocr.engine.ts`,
  `orientation-kernel.ts`, `apps/react-client/src/core-adapter/index.ts`,
  `tests/perf/support/memoryProfile.ts`, `imageDataProfile.ts`,
  `pnpm-lock.yaml`, `assets.lock.json` y de `dist/assets`.
- Versiones, hardware y configuración efectiva, en `manifest.json`.

**Fixtures: los cuatro ya congelados de la fase anterior, sin regenerar
ninguno.** Verificar sus SHA-256 antes de usarlos:

| Caso | Archivo | Para qué |
| --- | --- | --- |
| P2 | `.measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf` | La distribución que decide (100 tiras) |
| qa-stamp | `.measure/fixtures/qa-stamp-scanned-4ce6e18e6411309f.pdf` | El sello **tiene que sobrevivir** |
| T5 rotado | `.measure/fixtures/t5-rotated-0-90-180-270-1df5651d37c2b15d.pdf` | Ejercita orientación ≠ 0 y la transformación inversa |
| Márgenes blancos | `.measure/fixtures/white-margins-848789ae0cc9e3d9.pdf` | Control: tinta 0 y residuo 0 |

## 2. Instrumento

### 2.1 Arquitectura

**La misma que ya funcionó**: diff descartable sobre el kernel, preservado
como `instrument.patch` con su SHA-256, revertido al terminar, nunca
commiteado. Análisis dentro de `recognizeRotatedMargins`, que es el único
punto donde conviven los píxeles de la tira y las palabras de la pasada
derecha.

Canal de salida: registro por tira adjunto al resultado del job →
`globalThis.__anonlyMarginInkAnalysis` en el host → leído por el spec con
`page.evaluate`. **Reutilizar `extraCollectors`/`postRunCapture` de
`memoryProfile.ts`**, que la fase anterior agregó justamente para esto; no
construir un segundo mecanismo.

Código entregable en `tests/`: `tests/perf/support/marginInk.ts` con sus
tipos, agregación e invariantes, `marginInk.test.ts`, y
`tests/perf/margin-ink.spec.ts`.

**Cómo se captura el patch, y por qué no con `git diff` a secas.** La
referencia de §1 **ya difiere de HEAD**: la implementación de T5 vive sin
commitear. Un `git diff HEAD -- <archivos>` sobre un archivo instrumentado
captura entonces el delta acumulado —referencia **más** instrumento— y
revertir ese patch con `git apply -R` no deja el archivo en la referencia:
lo deja en HEAD puro, borrando trabajo aceptado que no está commiteado en
ninguna parte.

Esto ya ocurrió una vez en esta fase, el 2026-09-16, sobre `kernel.ts` y
`ocr.engine.ts`. Se detectó por hash contra `key-files.sha256`, se restauró
reaplicando `reference.patch` filtrado a esos archivos, y se verificó que el
build reconstruido daba chunks bit a bit idénticos.

La regla, válida para cualquier campaña instrumentada mientras el árbol
diverja de HEAD: **copiar los archivos que se van a instrumentar a un
snapshot propio antes de tocarlos, y generar el patch con `diff -u` contra
ese snapshot**, nunca contra HEAD. Verificar por hash después de revertir,
siempre, aunque el revert no haya dado error.

### 2.2 Qué se mide, por tira

Dos tiras por página (izquierda y derecha), **antes** de la compuerta de
ADR-162 y de cualquier rotación. El análisis es de solo lectura: no altera
los píxeles que el motor usa después.

| Campo | Definición |
| --- | --- |
| `inkPixels` | Píxeles de tinta de la tira |
| `inkBox` | Caja de esa tinta (x0,y0,x1,y1 en píxeles de la tira) |
| `maskedWordBoxes` | Cantidad de cajas de palabra proyectadas que intersecan la tira |
| `residualInkPixels[d]` | Tinta que queda tras tapar esas cajas dilatadas `d` píxeles, para **d = 0, 1, 2, 3** |
| `residualBox[d]` | Caja de ese residuo |
| `wouldSkipByWhiteGate` | Lo que `isVisuallyWhiteStrip` decide hoy sobre esta tira |
| `wordsAddedByThisStrip` | Palabras que las dos pasadas de esta tira efectivamente aportaron |
| `projectionMismatches` | Cajas cuya proyección no sobrevive el viaje de ida y vuelta (§2.3); tiene que ser 0 |

**Definición de tinta**: la composición sobre blanco de ADR-164 §5.1 —
`v = a*(r+g+b)/3 + (1-a)*255`, tinta si `v < 128`. Es el criterio de tinta
que ya existe en el repo; no inventar un segundo. Declarar en el reporte que
discrimina texto negro sintético y no tinta tenue de escaneo real.

**Por qué cuatro dilataciones.** Una caja de palabra de Tesseract puede ser
ajustada y dejar afuera el antialiasing del glifo; ese borde contaría como
residuo y ensuciaría un cero que en realidad es cero. Medir la curva `d = 0..3`
dice si el "residuo exactamente cero" es real o un artefacto de cajas
ajustadas. **Medir la curva está autorizado; elegir un `d` no.** Esa elección
es una decisión de ADR posterior, y si la respuesta necesita `d > 0`, entonces
no estamos en el mundo de la regla exacta — así hay que reportarlo.

### 2.3 La transformación inversa, que es el riesgo técnico de esta fase

Las palabras vienen en **puntos de página**; las tiras están en **píxeles del
raster enderezado**. Hay que llevar cada caja de palabra al espacio de la
tira, que es la inversa exacta de lo que `recognizeRotatedMargins` ya hace
hacia adelante: `unrotateBbox(inUpright, orientation, …)` seguido de
`toPagePoints(…, dpi)`.

Construir la inversa **con las piezas que ya existen**: la escala px↔pt con
el mismo `dpi`, y `unrotateBbox` con el ángulo complementario (`360 - degrees`
módulo 360) para volver del raster original al enderezado. No escribir una
segunda aritmética de rotación en paralelo a la del kernel.

**Probarla antes de confiar en un solo número**, y con una salvedad práctica:
`toPagePoints` es privada de `worker/kernel.ts`, así que el camino de ida
completo **no es importable desde `tests/`**. No intentes exportarla: eso
sería tocar producto para acomodar una medición.

La verificación va **adentro del propio instrumento**, y es más fuerte que un
test sintético porque corre sobre los datos reales: por cada caja de palabra
proyectada, volver a llevarla hacia adelante con la cadena que el kernel ya
usa y comparar contra el punto de partida, con tolerancia de redondeo
declarada. Contar los desajustes en un campo `projectionMismatches` del
registro. **Ese contador tiene que dar 0 en las cuatro corridas**, y va en el
reporte aunque dé 0 — si da distinto de 0, el histograma no se publica.

Una conversión mal hecha no tira error: da un residuo equivocado, y el
histograma entero queda inservible sin que nada avise. En `marginInk.ts` sí
va test unitario de todo lo que sea expresable como función pura sobre los
registros ya emitidos (agregación, invariantes, dilatación, cajas).

### 2.4 Invariantes del agregador

Con su test que los rompe a propósito, como en la fase anterior — incluido
desde el principio el de unicidad, que la vez pasada hubo que agregar después
de que un duplicado silencioso costara ocho corridas:

1. `residualInkPixels[d] <= inkPixels` para todo `d`, y monótono no creciente
   en `d`.
2. `residualBox[d]` contenida en `inkBox`; `inkBox` contenida en la tira.
3. Unicidad de registros por `(documentId, pageIndex, stripIndex)`.
4. `wouldSkipByWhiteGate === true` implica `inkPixels === 0`. Si aparece una
   tira que la compuerta saltea con tinta > 0, eso es un hallazgo sobre
   ADR-162 y se reporta; no se ajusta el invariante para que pase.

## 3. La correlación que decide, y que es el verdadero resultado

El histograma solo, sin esto, no alcanza. **Por cada tira hay que cruzar
`residualInkPixels[0] === 0` contra `wordsAddedByThisStrip`:**

| Residuo 0 | Palabras aportadas | Qué significa |
| --- | --- | --- |
| Sí | 0 | La regla de I-1 habría evitado esa lectura sin perder nada |
| Sí | **> 0** | **Descalifica I-1 en su forma exacta**: la regla habría perdido texto real |
| No | 0 | Se pagó la lectura y no aportó; I-1 no la evita, I-2 quizás la abarate |
| No | > 0 | Se pagó y sirvió |

**Una sola tira en la segunda fila invalida la idea tal como está planteada**,
y es un resultado tan publicable como el contrario. Reportarla con su página,
su lado y las palabras concretas que aportó. No promediar esto ni presentarlo
como porcentaje sin el conteo crudo.

## 4. Protocolo

### 4.1 Variables fijas

Electron real vía `playwright.perf.config.ts`, un worker, retries 0. Config
por el canal de overrides: `pdfPoolSize: 4`, `ocrPoolSize: 2`, `nerPoolSize: 2`,
`renderPoolSize: 4`, NER habilitado, `spa`+`eng`, DPI 300,
`maxLiveImageBytes = 128 * 1024 * 1024`. Build fresco con `VITE_E2E=1`,
`userData` nuevo por sesión.

```bash
VITE_E2E=1 pnpm --filter @anonly/react-client build
pnpm --filter @anonly/desktop-shell build
pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/margin-ink.spec.ts --workers=1 --retries=0
```

### 4.2 Higiene

`pgrep -f '[p]laywright test --config'` con corchete antes de cada corrida —
sin él el patrón se matchea a sí mismo y la espera cuelga. Una sola medición
Electron a la vez. Nada de `vitest` en paralelo: `generate.test.ts` da rojo
falso por colisión. **Si dejás una corrida en background y cortás turno,
cerrá el turno con el estado completo**: qué quedó hecho, qué está bloqueado y
qué sigue. Mejor todavía: encadená las corridas restantes en un único script
con `trap` de revert y un log por sesión.

### 4.3 Corridas

Cuatro fixtures, una corrida cada uno, más **una segunda corrida de P2** para
confirmar determinismo: los registros de las 100 tiras tienen que dar
idénticos entre las dos. Si difieren, eso es un defecto del análisis y se
reporta antes que cualquier histograma.

**Control de que el instrumento no cambió el reconocimiento**: la huella de
calidad de P2 tiene que seguir dando `c723dace…`, 50 páginas, 1038 palabras.

## 5. Salida y reporte

`.measure/margenes-tinta/<campaña>/<caso>/analysis.json` con el manifiesto de
identidad, el fixture y los registros por tira.

Reporte en `docs/roadmap/Margenes_Menos_Pixeles_Resultados.md`, en este orden:

1. **La correlación de §3**, con el conteo crudo. Va primero porque es lo que
   decide, y porque una fila de la segunda categoría cambia todo lo demás.
2. **Distribución del residuo en P2**: histograma completo sobre las 100
   tiras para `d = 0`, con los extremos, no solo la mediana. Después la curva
   `d = 0..3` como diagnóstico.
3. **Cajas**: qué fracción del alto de la tira ocupa `inkBox` y qué fracción
   ocupa `residualBox[0]`, con su distribución.
4. **qa-stamp**: el sello sobrevive o no al enmascarado, y cuánto residuo
   deja. Si no sobrevive, la idea está mal planteada y se dice así.
5. **T5 rotado y márgenes blancos**: controles estructurales, incluida la
   validación de la transformación inversa en orientación ≠ 0.
6. **Ahorro proyectado** de I-1 y de I-2 por separado, aplicando los costos
   por etapa de `ImageData_Perfilado_Resultados.md` §11.3 a las pasadas
   evitadas y a los píxeles recortados. **Rotulado como proyección, no como
   medición**: el ahorro real solo se sabe implementando y midiendo.
7. Corridas inválidas con su causa, y las limitaciones del análisis.

**Sin elegir idea ni recomendar implementación**: el criterio de §5 del plan
lo aplica el planificador con los histogramas sobre la mesa.

## 6. Gates y entrega

Con el patch revertido:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract
```

`marginInk.ts` lleva sus tests unitarios: invariantes rotos a propósito,
dilatación y cajas sobre registros construidos, y parseo de registros
malformados que **lanza** en vez de asumir un default. La transformación
inversa se valida con el contador de §2.3, no con un test en `tests/`. Verificar por hash que `packages/**`
y `apps/**` quedaron como en §1. Borrar los scripts scratch. Sin commit.

## 7. Ambigüedad

Si un caso no está cubierto acá, dos documentos se contradicen, o un tipo o
helper referenciado no existe: **detener y reportar** archivo, sección, cita
textual y pregunta concreta.

Y una lección cara de la fase anterior: **antes de declarar que un número
propio contradice un ADR, leer la fila completa de la tabla que se está
citando.** Un "esto no coincide con el spec" mal leído manda a alguien a
investigar un fantasma.

## 8. M-1b — el mismo residuo, con el criterio exacto de ADR-162

Agregado el 2026-09-16 por el planificador, **corrigiendo un error propio de
§2.2 de este handoff**.

### 8.1 Qué estuvo mal

§2.2 fijó como definición de tinta la composición de ADR-164 §5.1 —`v < 128`—
por venir ya del repo. **Es un umbral de brillo**, y el motor tiene al lado
un criterio **exacto** para lo mismo: `isVisuallyWhiteStrip` (ADR-162) cuenta
un píxel como no blanco si no es transparente y no tiene los tres canales en
255, sin umbral y a propósito.

La consecuencia, que §2.2 no siguió hasta el final aunque advirtiera que el
criterio no sirve para tinta tenue real: el resultado de M-1 —residuo
exactamente cero en las 100 franjas de P2— **está medido con el umbral**.
Llevarlo al producto tal cual introduciría el umbral de blanco aproximado que
§6 del plan prohíbe sin resolver T-4b. Y bajo el criterio exacto no hay dato:
en P2 la compuerta de ADR-162 no saltearía ninguna de las 100 franjas, así que
todas tienen píxeles no blancos, y nunca se midió si esos píxeles quedan
cubiertos por las cajas de las palabras ya leídas.

### 8.2 Qué se mide

**Los dos criterios en la misma corrida**, no una campaña nueva. Medirlos
juntos elimina la varianza entre corridas y hace la comparación pareada
exacta, franja por franja.

Por cada franja, además de lo que ya registra §2.2:

| Campo | Definición |
| --- | --- |
| `inkPixelsExact` | Píxeles **no blancos** según el predicado de `isVisuallyWhiteStrip`: `alpha !== 0 && !(r === 255 && g === 255 && b === 255)` |
| `residualExact[d]` | Los de arriba que no quedan bajo ninguna caja de palabra dilatada `d` |
| `smallestZeroDilation` | El `d` más chico con `residualExact[d] === 0`, o `null` si ninguno |

**Escalera de dilatación para el criterio exacto: `d = 0, 1, 2, 3, 4, 6, 8`.**
Más larga que la de §2.2 a propósito: bajo el criterio exacto los bordes
suavizados de un glifo cuentan como tinta, y hay que ver **dónde** se apaga el
residuo, no solo si se apaga en 3. La escalera corta original se conserva para
el criterio de brillo, para que M-1 siga siendo comparable consigo mismo.

**Reutilizar el predicado del producto, no reescribirlo.** El criterio exacto
tiene que ser literalmente la misma condición que usa `isVisuallyWhiteStrip`;
si el instrumento escribe su propia versión, mide otra cosa y no nos enteramos.

### 8.3 Invariante nuevo

`residualExact[d] >= residualInkPixels[d]` para todo `d`, y lo mismo para los
totales de tinta. Un píxel oscuro (`v < 128`) nunca es blanco puro, así que el
criterio exacto cuenta un **superconjunto**. Si esa desigualdad se rompe, uno
de los dos predicados está mal aplicado y la corrida no vale. Con su test que
lo rompe a propósito, como los otros cuatro.

### 8.4 Qué tiene que contestar el reporte

La correlación de §3, **repetida bajo el criterio exacto**: por cada franja,
`residualExact[0] === 0` contra `wordsAddedByThisStrip`, con el conteo crudo.
Y la distribución de `smallestZeroDilation` sobre las 100 franjas de P2.

Eso ubica el resultado en uno de tres mundos, y el reporte dice cuál **sin
elegir ninguno**:

| Mundo | Qué se observa | Qué significa |
| --- | --- | --- |
| A | `residualExact[0] === 0` en buena parte de P2 | I-1 sale exacta, sin un solo parámetro nuevo |
| B | Cero recién con `d > 0` | La regla necesita una tolerancia **geométrica**; es un parámetro, distinto de un umbral de brillo, y lo decide el humano con la distribución a la vista |
| C | Nunca llega a cero | I-1 no funciona como regla exacta y queda condicionada a T-4b |

El sello de qa-stamp tiene que sobrevivir en los tres mundos: el criterio
exacto cuenta más tinta, no menos, así que un residuo que ya era de 9.651
píxeles solo puede crecer. Si no sobrevive, hay un error de implementación.

### 8.5 Alcance

Mismos cuatro fixtures congelados, misma segunda corrida de P2, mismo
protocolo de §4, misma entrega de §6. No se implementa nada de I-1, no se toca
la compuerta de ADR-162 ni ningún otro comportamiento del producto.
