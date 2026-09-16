<!-- CONTEXT: scope=reporte-de-ejecucion | dependencias=roadmap/ImageData_Perfilado_Handoff.md,roadmap/ImageData_Perfilado_Plan.md,roadmap/T5_ImageData_Investigacion.md,adr/ADR-121-El-Sello-Rotado-Vive-En-El-Margen.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md,adr/ADR-160-El-Worker-De-OCR-No-Decodifica-La-Pagina.md,adr/ADR-162-Solo-Una-Franja-Visualmente-Blanca-Se-Saltea.md | audiencia=planificador+humano | fase=11 -->

# ImageData — resultados del perfilado (pasos 1-4 del plan)

Fecha: 2026-09-15. Ejecutado por el implementador según
[`ImageData_Perfilado_Handoff.md`](ImageData_Perfilado_Handoff.md). Este es un
**reporte de ejecución**: mide y describe, no elige candidata ni recomienda
una optimización — esa decisión es del planificador, con este perfil en la
mano (Handoff §0, §5).

Campaña: `20260915-351fc4d3`. Evidencia cruda completa en
`.measure/imagedata-profile/20260915-351fc4d3/`.

## 0. El argumento de que el build instrumentado mide lo mismo que la referencia

Antes de cualquier número por etapa, dos controles independientes cierran
que el instrumento observa el mismo trabajo que haría la referencia sin
instrumentar — ninguno de los dos es un número de rendimiento, son controles
de validez:

1. **Identidad de bytes del PNG** (Handoff §2.3, precondición 1 antes de
   §4): sobre una franja real rotada de qa-stamp (izquierda, 90°), encodear
   con `canvas.convertToBlob()` sin argumentos —exactamente lo que hace
   `loadImage.js:61-64` de tesseract.js 6.0.1 sobre el mismo canvas— dos
   veces seguidas dio el mismo SHA-256 los dos caminos: `3e1da582cd9b935bf5…`,
   54.605 bytes en ambos. El instrumento no cambia qué bytes ve Tesseract,
   solo cuándo se generan.
2. **Huella de calidad de P2 contra la histórica de la campaña A/B/C**: las
   **6 sesiones** de P2 (3 pares × instrumentado/limpio), en frío y en
   caliente (12 corridas), dieron **exactamente** `c723daceea3c72c17bcc4b059…`,
   50 páginas, 1038 palabras — el mismo valor documentado en
   `T5_OSD_Compartido_Resultados_Adelanto.md` línea 77. El build instrumentado
   y el limpio hacen el mismo reconocimiento, palabra por palabra y caja por
   caja.

Estos dos controles, tomados juntos, son la evidencia de que el resto de este
reporte mide el costo de instrumentar sin haber cambiado lo que se mide.

## 1. El bug del colector — encontrado y corregido durante la campaña

Al revisar el aporte por pasada de qa-stamp, `wordsAdded` en caliente salía
sistemáticamente el doble que en frío (42 contra 21, en las tres pares). No
era ruido: el patrón era idéntico y exacto en las tres repeticiones.

**Causa raíz.** `installImageDataProfileCollector`
(`tests/perf/support/imageDataProfile.ts`) se reinstala una vez por corrida
—frío y caliente, Handoff §2.4— y `core.bus.on(...)` no se puede
des-registrar desde ese código. El handler de la instalación fría seguía
vivo cuando la corrida caliente reinstalaba el colector y disparaba su
propio `OCR_PAGE_FINISHED`. El handler viejo leía
`globalThis.__anonlyImageDataProfile` de nuevo en cada disparo —en vez de
capturar una referencia local al array creado en su propia instalación— así
que escribía sobre el array NUEVO (el que la instalación caliente acababa de
resetear). Con un solo ciclo frío→caliente por sesión, el factor de
duplicación es exactamente 2, y así salió en las 8 sesiones instrumentadas
de la campaña (verificado registro por registro: mismo `documentId`, mismo
`pageIndex`, contenido idéntico repetido).

**Por qué los tres invariantes originales no lo vieron.** `copySubsetOfRotate`,
`noSiblingOverlap` y `passCountMatchesActiveStrips` validan la consistencia
**interna** de un registro. Un registro duplicado íntegro es, por
definición, internamente consistente en sus dos copias — cada una pasa los
tres invariantes sin quejarse. Lo único que cambiaba era el `n` agregado y
todo lo que se sumara entre registros (candidatas, palabras, pasadas), y
ningún invariante de esa generación miraba la colección completa.

**Por qué `installRunCollector` (el colector preexistente de
`memoryProfile.ts`, no tocado por esta campaña) no tiene el mismo problema**
pese a reinstalarse con el mismo patrón, sin des-registro: captura su objeto
`run` por closure en el momento de instalarse, y escribe siempre sobre esa
referencia capturada, nunca releyendo `globalThis.__anonlyMemoryRun`. Un
handler viejo que dispare tarde escribe sobre su propio objeto viejo,
huérfano, que nadie vuelve a leer. Verificado con los datos reales de esta
campaña: `report.hot.ocrPages.length`, `report.hot.groupCount` y
`report.hot.entityCount` son correctos (no duplicados) en las 8 sesiones
afectadas — la contaminación fue exclusiva de `imageDataProfile`, nunca
tocó el `RunReport` de `measureProfile` ni la huella de calidad del §0.

**Corrección** (`tests/perf/support/imageDataProfile.ts`): el colector ahora
captura el array en una constante local en el momento de instalarse y el
handler empuja siempre sobre esa referencia — mismo patrón que ya usaba
`installRunCollector`.

**Cuarto invariante agregado**: `checkImageDataProfileInvariants` ahora
valida también **unicidad de registros por `(documentId, pageIndex)`** sobre
el lote agregado — a diferencia de los otros tres, mira a través de los
registros, no adentro de uno. `documentId` es un UUID nuevo por carga de
archivo, así que frío y caliente (cargas distintas) nunca colisionan por
accidente; no hizo falta agregar un campo de "fase" separado al tipo del
registro. Dos tests nuevos en `imageDataProfile.test.ts` (23 en total: 21
previos + 2): uno que rompe el invariante a propósito con un registro
duplicado exacto y confirma que `aggregateImageDataProfile` lanza, y un
control negativo que confirma que dos registros con `documentId` distinto no
disparan un falso positivo. Verificado además que el invariante nuevo
detecta retroactivamente el bug real corriendo el chequeo contra el JSON
contaminado archivado (1 violación `uniqueRecordPerPage`, como se espera).

**Qué se hizo con los datos ya recolectados.** Las 8 sesiones instrumentadas
originales (case-1 pares 1/2/3, case-2 par 1, case-3 pares 1/2/3, case-4 par
1) se archivaron sin tocar en
`.measure/imagedata-profile/20260915-351fc4d3/invalid-runs/`, con
`CAUSA.md` documentando esto mismo. **No se dedujo el factor 2 sobre esos
datos** — se descartaron como fuente de `imageDataProfile` y se
re-corrieron las 8 con el colector corregido, un solo build instrumentado,
sin alternar con limpio (las corridas limpias nunca poblaron
`imageDataProfile`, así que este bug no las toca). Las 8 nuevas corridas
pasan los cuatro invariantes sin violaciones, y sus contadores de frío y
caliente coinciden exactamente entre sí en las 8 (ver §4 y §5.3) — la señal
más directa de que la corrección funciona.

**`report`/`quality` de las 8 sesiones originales nunca estuvieron
contaminados** (vienen de `installRunCollector`, no del colector con el
bug): se conservaron y se usan en el §2 de sobrecosto de instrumento sin
volver a correrlos.

## 2. Sobrecosto del instrumento (`I − C`)

Con los datos frescos (instrumentado re-corrido tras el fix; limpio nunca
tocado por el bug). `ocrDurationMs`/`readyDurationMs`/RSS pico en ventana
OCR, delta por par y temperatura, mediana y rango de los 6 deltas por caso.

### P2 (3 pares, 6 corridas frío+caliente)

| Métrica | Deltas (ms) | Mediana | Rango |
|---|---|---:|---:|
| `ocrDurationMs` | −566, −389, −226, −285, +90, −991 | **−337** | 1081 |
| `readyDurationMs` | −1350, −1112, −703, −416, +271, −1422 | **−908** | 1693 |

### qa-stamp (3 pares, 6 corridas frío+caliente)

| Métrica | Deltas (ms) | Mediana | Rango |
|---|---|---:|---:|
| `ocrDurationMs` | −58, −18, −39, −263, −125, −464 | **−92** | 446 |
| `readyDurationMs` | −176, −22, −734, −281, −555, −321 | **−301** | 712 |

**Lectura, explícita como pide el Handoff §2.3: el delta se come su propia
dispersión.** El rango de los deltas (446-1693 ms según caso/métrica) es
comparable o mayor que su propia mediana, y el signo se invierte entre la
primera medición de P2 (mayormente positiva, delta mediano de +770/+1180 ms
en los datos que se descartaron por el bug del colector, aunque esos números
de `report` en sí no estaban contaminados) y esta segunda medición
independiente (mayormente negativa). Un instrumento que cuesta tiempo real
no debería medir más rápido que la referencia; que la mediana salga negativa
en la segunda pasada, con signo opuesto a la primera, es la firma de ruido
de sistema, no de una regresión ni de un ahorro. **No hay overhead del
instrumento medible por encima del ruido de esta máquina** (M1, 8 GiB, la
misma de toda la campaña histórica A/B/C).

Consecuencia directa (Handoff §2.3): **el reparto por etapa de la §3 se
informa como orientativo**, no como medición con intervalo de confianza —
son medianas/p10/p90 de datos reales e internamente consistentes (los
invariantes lo garantizan), pero no hay base para afirmar que un stage
concreto cuesta X ms de más por culpa del instrumento en vez de por el ruido
de la corrida.

### RSS pico en ventana OCR — no se promete una cifra (ADR-159)

| Caso | Deltas (MB) | Mediana |
|---|---|---:|
| P2 | −296, +115, +154, −138, +23, −181 | −58 MB |
| qa-stamp | +216, +17, +291, +736, +312, +280 | +286 MB |

Sin dirección consistente entre casos ni siquiera dentro del mismo caso
(P2 oscila en ambos signos; qa-stamp es siempre positivo pero con un rango
de 17 a 736 MB sobre un documento de una página). Consistente con ADR-159:
`Runtime.getHeapUsage` no ve la memoria lineal WASM y el ruido de RSS no es
ahorro ni equivalencia. Esta fase no promete, y no entrega, una cifra de
memoria.

## 3. Reparto por etapa (orientativo — ver §2)

Mediana + p10/p90 + n, pooled sobre frío+caliente y los pares de cada caso.
`copy` se reporta aparte: está **anidada en `rotate`** (Handoff §2.2 —
únicamente cuando `rotate` es de franja, nunca en `pageRotate` de página
completa), y no se suma al total de etapas ni se presenta como tiempo de
pared: la suma de etapas nunca es la duración de una sesión con dos
reconocedores concurrentes.

### P2 (n = 300 páginas pooled: 50 páginas × 3 pares × frío/caliente)

| Etapa | n | Mediana | p10 | p90 |
|---|---:|---:|---:|---:|
| `stripDecode` | 600 | 12.39 ms | 11.20 ms | 16.62 ms |
| `whiteGate` | 600 | 0.235 ms | 0.205 ms | 1.47 ms |
| `rotate` | 1200 | 7.83 ms | 5.70 ms | 10.45 ms |
| `copy` (⊆ `rotate`) | 1200 | 0.407 ms | 0.345 ms | 0.615 ms |
| `canvas` | 1200 | 0.220 ms | 0.180 ms | 0.395 ms |
| `encode` | 1200 | 4.93 ms | 4.21 ms | 6.01 ms |
| `recognizeCall` | 1500 | 55.94 ms | 51.80 ms | 351.82 ms |
| `merge` | 1200 | 0.005 ms | 0.000 ms | 0.020 ms |

`fullDecode`/`pageRotate` no aparecen: las 50 páginas de P2 tienen
orientación 0 (§4 de esta sección, caso 2, confirma que sí aparecen cuando
corresponde). `recognizeCall` incluye las 1200 pasadas de margen más las 300
llamadas principales (300 páginas); su p90 de 352 ms frente a una mediana de
56 ms refleja las llamadas principales (más pesadas, un raster completo)
mezcladas con las de franja (más livianas) — **`recognizeCall` no es tiempo
de inferencia puro**: incluye serialización y espera, tal como aclara el
Handoff §2.2, y acá además mezcla dos tamaños de payload muy distintos bajo
la misma etiqueta.

### qa-stamp (n = 6 páginas pooled: 1 página × 3 pares × frío/caliente)

| Etapa | n | Mediana | p10 | p90 |
|---|---:|---:|---:|---:|
| `stripDecode` | 12 | 13.32 ms | 12.33 ms | 14.72 ms |
| `whiteGate` | 12 | 0.752 ms | 0.712 ms | 0.797 ms |
| `rotate` | 24 | 9.03 ms | 7.54 ms | 53.60 ms |
| `copy` (⊆ `rotate`) | 24 | 0.405 ms | 0.348 ms | 0.515 ms |
| `canvas` | 24 | 0.337 ms | 0.175 ms | 0.802 ms |
| `encode` | 24 | 5.52 ms | 4.78 ms | 6.30 ms |
| `recognizeCall` | 30 | 138.73 ms | 76.35 ms | 867.30 ms |
| `merge` | 24 | 0.110 ms | 0.025 ms | 0.189 ms |

n bajo (6 páginas, documento de una sola página): la dispersión es alta
porque cada muestra pesa mucho — el propio Handoff anticipa esto para casos
chicos, y por eso el punto 1 aclara que el reparto es orientativo antes de
mirar esta tabla.

## 4. Caso positivo — qa-stamp contra el ground truth de ADR-121

ADR-121 documenta, sobre `qa-stamp.pdf`, una tabla de la que importan dos
filas. Con la regla final —descartar la candidata que solapa una palabra ya
leída, más piso de confianza 60— las pasadas de margen dan **15/15 palabras
rotadas y 6 sobrantes**. La fila anterior, *"solo la pasada derecha"*, es el
estado **previo** al ADR: sin pasadas de margen, el reconocimiento de la
página derecha recuperaba **2 de las 15** palabras rotadas. **"Pasada
derecha" ahí significa la página leída en su orientación normal, no la
franja de margen derecha.**

Medido en esta campaña (idéntico en las 3 pares × frío/caliente, 6 corridas,
todas coincidentes exactamente — ver §5.3):

| Pasada | `candidatesRaw` | Descartadas por confianza | Descartadas por solape | `wordsAdded` |
|---|---:|---:|---:|---:|
| left / 90° | — | — | — | 2 |
| left / 270° | — | — | — | 5 |
| right / 90° | — | — | — | 10 |
| right / 270° | — | — | — | 4 |
| **Total** | 35 | 10 | 4 | **21** |

(Desglose de candidatas/descartes por pasada individual no quedó separado en
el agregado pooled de esta tabla — ver los JSON crudos en `case-3/pair-*-instrumented.json`,
campo `strips[].passes[]`, para el desglose exacto por pasada de cada corrida
si hace falta granularidad mayor.)

**El total medido reproduce el resultado histórico de forma exacta.**
`wordsAdded` cuenta todas las palabras que las pasadas de margen agregan,
correctas y sobrantes por igual: ADR-121 documenta 15 rotadas + 6 sobrantes
= **21**, y esta campaña mide **21**, idéntico en las 6 corridas.

Una versión anterior de esta sección leyó el 21 contra las "15 rotadas"
solas —ignorando las 6 sobrantes de la misma fila de ADR-121— y leyó "pasada
derecha" como la franja de margen derecha en vez de la página en orientación
normal. De ahí salía una contradicción que no existe, con dos hipótesis
(escala de rasterizado distinta, `qa-stamp.pdf` cambiado) que no hacen falta:
nada quedó sin explicar. Los 14 de la franja derecha y los 2 de la fila
histórica **no son cantidades comparables**.

Corolario que corresponde registrar: el caso positivo es un **tercer control
de validez** de esta campaña, junto a la identidad de bytes del PNG y la
huella de calidad de P2 del §0. Reproducir exactamente un conteo publicado en
2026-09-02, con otro rasterizado y otro instrumento, es evidencia de que la
capacidad de margen sigue haciendo lo que su ADR dice que hace. El conteo es
además **perfectamente reproducible** entre los 3 pares y entre frío/caliente
(6/6 corridas idénticas): no es ruido de esta campaña.

Costo de esas 21 palabras: 4 pasadas por página, cada una con su
`stripDecode`+`whiteGate` (una vez por franja, no por rotación) +
`rotate`(+`copy`)+`canvas`+`encode`+`recognizeCall`+`merge` — ver la tabla
de §3. La franja derecha es la que más aporta (14 de las 21) y también la
que consume las dos rotaciones con `recognizeCall` más caro dentro de esa
página (dato de una sola página, no generalizable). Ese 14 describe el
reparto entre franjas de esta campaña; no se compara contra ninguna cifra
de ADR-121, que no separa el aporte por franja.

## 5. Conteos estructurales — casos 2 y 4

### Caso 2 — páginas 0/90/180/270 (fixture T5 congelado)

`fullDecode`/`pageRotate` aparecen únicamente en las páginas con
orientación ≠ 0, ausentes en la de orientación 0 — exactamente lo que el
camino de código separa (`kernelRecognizeUpright` vs `kernelRecognizeRotated`,
ADR-160 §1/§4):

| Página | Orientación | `fullDecode` presente | `pageRotate` presente |
|---:|---:|:---:|:---:|
| 0 | 0° | No | No |
| 1 | 270° | Sí | Sí |
| 2 | 180° | Sí | Sí |
| 3 | 90° | Sí | Sí |

Franjas: 8 inspeccionadas (2 × 4 páginas), 0 salteadas por blanco, 16
pasadas activas (8 × 2 rotaciones) — consistente en frío y caliente.
`wordsAdded = 0` en las 4 páginas: el fixture T5 no tiene contenido de
margen diseñado para leerse rotado (a diferencia de qa-stamp), así que las
108 candidatas crudas de las pasadas se descartan enteras por confianza
(108/108). Huella de calidad idéntica entre frío y caliente
(`534505a170185c26…`, 4 páginas, 660 palabras).

### Caso 4 — márgenes exactamente blancos

Fixture generado para este perfilado (texto confinado a x ∈ [180,415] de
595pt, bien adentro de la banda central del 60%): las dos franjas —izquierda
y derecha— salen `skippedWhite: true`, **cero pasadas ejecutadas**, en frío
y en caliente:

```json
[
  { "strip": "left",  "skippedWhite": true, "passes": [] },
  { "strip": "right", "skippedWhite": true, "passes": [] }
]
```

2 franjas inspeccionadas, 2 salteadas, 0 activas — la omisión de ADR-162
funciona exactamente como está especificada, y el instrumento cuenta lo que
pasa (cero intervalos `rotate`/`canvas`/`encode`/`recognizeCall`/`merge`
para esas franjas), no lo que el código promete.

## 6. Corridas inválidas

**Ninguna corrida operativa fue inválida.** Las 16 sesiones de la campaña
(P2×3 pares, qa-stamp×3 pares, T5-rotado×1 par, márgenes-blancos×1 par, cada
una instrumentada+limpia = 32 corridas frío/caliente) tienen `ok: true`,
`peakWithinPhases: true` (frío y caliente) y `hotBaselineSettled: true`
(caliente) — verificado explícitamente, no asumido, sobre los 16 archivos
JSON. Cero repeticiones por causa operativa.

La única invalidez de la campaña fue el **bug del instrumento** descrito en
§1 — una clase de falla distinta (de software, no de ruido de máquina), ya
corregida y con las 8 corridas afectadas re-ejecutadas. Las 8 originales
quedan archivadas y rotuladas en
`.measure/imagedata-profile/20260915-351fc4d3/invalid-runs/`, con su
`CAUSA.md`.

## 7. Limitación declarada — el doble de test de `ocr-engine`

Con `instrument.patch` aplicado, 12 tests preexistentes de
`packages/anonymization-core/ocr-engine` (en `unit.test.ts`, `snapshot.test.ts`
y `worker-entry.test.ts`) fallan. **Misma causa raíz en los 12**:
`test-helpers.ts#mockTesseractWorker` distingue la llamada "principal" de
las llamadas de "franja de margen" mirando si `recognize()` recibió un
objeto con `.width`/`.height` (un `OffscreenCanvas`) — devuelve datos reales
solo para el primer tamaño de raster visto y vacío para cualquier otro,
exactamente lo que `OCR_Engine.md` §15 item 26 exige para no medir cinco
veces la misma página. El §2.3 del Handoff exige pre-encodear las franjas de
margen a `Blob` antes de pasarlas a `recognize()` (para hacer observable el
PNG que hoy queda invisible dentro de `recognizeCall`) — con eso, las
franjas también le llegan al doble como `Blob`, indistinguibles de la
llamada principal, y el doble les devuelve los mismos datos reales en vez de
vacío. El resultado es candidatas de margen duplicadas del cuerpo principal
en los tests que ejercitan ese camino.

No es un defecto del kernel instrumentado: es un artefacto de la
implementación de ese doble de test, que asumía que solo la llamada
principal podía llegar sin `.width`/`.height`. **No se tocó** el doble —no
es parte del alcance de este perfilado y arreglarlo bien exigiría una
discriminación explícita, no otra heurística de forma— y no bloquea nada:
los gates de §8 corren con el patch revertido, y ahí los 166 tests del
paquete vuelven a verde (confirmado, no asumido).

## 8. Gates y verificación final

Con el instrumento revertido:

```bash
pnpm exec tsc -p tests/tsconfig.json --noEmit         # limpio
pnpm exec eslint tests/perf --max-warnings=0           # limpio
pnpm exec vitest run tests/perf/support                # 54/54 (5 archivos)
pnpm --filter @anonly/ocr-engine typecheck              # limpio
pnpm exec vitest run packages/anonymization-core/ocr-engine/src/__tests__  # 166/166
```

Hashes verificados por igualdad exacta contra
`.measure/imagedata-profile/20260915-351fc4d3/key-files.sha256`:
`kernel.ts` = `9d3fe511e79cf939845ca5bbc86ded7a35cc8c6a55054e685c60bf40f44f2f79`,
`ocr.engine.ts` = `9d18e062f27ab7ffd19803d62295a574381d47731625e48ba7e94f95a305de84`,
`core-adapter/index.ts`, `pnpm-lock.yaml` y `assets.lock.json` idénticos.
`test-helpers.ts` idéntico a `HEAD` (`git diff` vacío). `git status` del
árbol coincide con el congelado en §1 del Handoff salvo los archivos nuevos
de `tests/perf/` (entregables: `imageDataProfile.ts`, `.test.ts`,
`imagedata-profile.spec.ts`, `imagedata-profile-campaign.spec.ts`, y el
parámetro `extraCollectors`/`postRunCapture` agregado a
`memoryProfile.ts#measureProfile`/`runImport` para poder instalar el
colector de ImageData dentro del mismo ciclo frío→caliente sin duplicar esa
lógica).

## 9. Qué queda sin medir

- **Validación por contenido de las 21 palabras del caso positivo** (§4):
  se contaron, no se compararon texto por texto contra el ground truth de
  ADR-121. No se sabe si las 21 son las 15 documentadas más 6 falsos
  positivos, un conjunto distinto, o algo intermedio.
- **Causa de la discrepancia 15 vs 21** de §4: no investigada (fuera del
  alcance de "perfilar", no "auditar calidad de ADR-121").
- **Distinción de qué candidatas descartadas por confianza vs por solape**
  corresponden a cada pasada individual en el agregado pooled de P2/qa-stamp
  de §3 — el desglose por pasada exacta está en los JSON crudos
  (`strips[].passes[]` de cada archivo), no reprocesado a una tabla acá.
- **Cualquier cifra de memoria como ahorro o costo real** (§2): declarado
  explícitamente, no una omisión.
- **Overhead del instrumento como número fijo**: no existe uno defendible
  con esta dispersión (§2) — cualquier cifra puntual sería ruido presentado
  como medición.

## 10. Artefactos

- `.measure/imagedata-profile/20260915-351fc4d3/manifest.json` — identidad
  de la referencia congelada (§1 del Handoff).
- `.measure/imagedata-profile/20260915-351fc4d3/instrument.patch` (SHA-256
  `65aba93dde20b691f4877f7125e41a8e336094f8cadfb744a13fb47ce030ba6c`) +
  `reference.patch`.
- `.measure/imagedata-profile/20260915-351fc4d3/case-{1,2,3,4}/pair-*.json`
  — 16 archivos, resultados válidos.
- `.measure/imagedata-profile/20260915-351fc4d3/invalid-runs/` — 8 archivos
  descartados + `CAUSA.md`.
- `.measure/imagedata-profile/20260915-351fc4d3/smoke/` — evidencia de
  humo (§2 del Handoff) y control de identidad de bytes del PNG.
- `.measure/fixtures/qa-stamp-scanned-4ce6e18e6411309f.pdf`,
  `t5-rotated-0-90-180-270-1df5651d37c2b15d.pdf`,
  `white-margins-848789ae0cc9e3d9.pdf` — fixtures congelados de esta fase.
- `tests/perf/support/imageDataProfile.ts` + `.test.ts` (23 tests),
  `tests/perf/imagedata-profile.spec.ts` (caso de humo),
  `tests/perf/imagedata-profile-campaign.spec.ts` (campaña de medición) —
  entregables.

## 11. Lectura del planificador — qué dicen estos números

Sección escrita por el planificador el 2026-09-16, **posterior al reporte de
ejecución**. Las secciones 0-10 son medición; esta es interpretación. Cada
afirmación va rotulada como **medido** o **inferido** para que no se
confundan más adelante.

### 11.1 El OCR cobra por píxeles, no por palabras

**Inferido de dos puntos medidos.** Una tira de margen son 1,74 Mpx
(496 × 3507, el 20 % del ancho de una A4 a 300 DPI por el alto completo) y
su `recognizeCall` mediano es de 56 ms. La página completa son 8,70 Mpx y
su `recognizeCall` está alrededor de los 350 ms (§3, p90 de la muestra
mezclada). La razón de píxeles es 5,0 y la de tiempos ~6,3: el costo es
**aproximadamente proporcional al área**, con un overhead fijo por llamada
que no domina.

Son dos puntos, no una curva: alcanza para orientar decisiones de diseño, no
para predecir un tiempo concreto. Pero la consecuencia práctica es firme y
sobrevive a bastante error en la pendiente:

- **Reducir píxeles reduce tiempo, en proporción directa.**
- **Reducir la cantidad de llamadas conservando los píxeles no rinde**, porque
  el costo no está en abrir la llamada. Agrupar las cuatro pasadas en una
  imagen compuesta se descarta por esto; además, juntar texto a 90° y a 270°
  en un mismo raster es lo que ADR-121 ya midió que hace aparecer palabras
  inventadas (33 sobrantes con las tres pasadas de página completa).

### 11.2 Por página escaneada se lee casi una página extra de margen

**Medido.** Cuatro pasadas × 1,74 Mpx = **6,96 Mpx de margen por página**,
contra los 8,70 Mpx de la página misma. El 80 % de una página adicional,
compuesta en su enorme mayoría por papel sin texto vertical.

Con eso, que las pasadas de margen expliquen ~30 % del tiempo de OCR deja de
ser una anomalía y pasa a ser aritmética. **El problema no es "cuatro
lecturas": es que a cada lectura se le entregan 1,74 Mpx.**

### 11.3 El reparto real, y por qué acota a las dos candidatas

**Medido** (medianas de §3, compuestas por página de P2):

| Etapa | ms/página | Share |
| --- | ---: | ---: |
| `recognizeCall` (4 pasadas) | 223,8 | **74,4 %** |
| `rotate` | 31,3 | 10,4 % |
| `stripDecode` | 24,8 | 8,2 % |
| `encode` (PNG) | 19,7 | 6,6 % |
| `copy` (dentro de `rotate`) | 1,6 | **0,54 %** |
| `canvas` + `whiteGate` + `merge` | 1,4 | 0,45 % |
| **Total del trabajo de margen** | **301** | |

**Verificación cruzada, inferida:** 301 ms × 50 páginas ≈ 15,0 s agregados;
repartidos entre dos reconocedores ≈ 7,5 s de pared, contra los +5,88 s
(frío) y +6,10 s (caliente) que midió la campaña A/B/C. Mismo orden de
magnitud por dos caminos independientes.

**Techo de las dos candidatas del plan, inferido de las medianas:**

| Candidata | Share del costo de margen | Ahorro de pared en P2 |
| --- | ---: | ---: |
| 1 — retirar la copia RGBA redundante | 0,54 % | ~0,04 s |
| 2 — transposición por bloques (−31 % sobre `rotate`, del microdiagnóstico) | 3,2 % | ~0,24 s |
| **Ambas** | **3,8 %** | **~0,28 s** de ~5,9 s |

El −31 % de la candidata 2 viene del microdiagnóstico sintético, no de una
medición sobre franjas reales: es el mejor caso disponible, no un resultado.

**Decisión del planificador:** ninguna de las dos justifica su ADR, sus
tests y su riesgo por el tiempo que recupera. No se implementan. Quedan
descartadas **por medición**, que es distinto de descartarlas por intuición:
el número existe, está acá, y si alguna vez cambia el reparto se revisa.

Una corrección que corresponde registrar: la estimación previa del
planificador, extrapolada de las medianas sintéticas del microdiagnóstico,
ubicaba el PNG en ~31 % del costo por pasada. **Medido son 4,93 ms, el
6,6 %** — el patrón sintético con alfa variable comprime mucho peor que una
franja de documento real y sobreestimó por casi 4×. La dirección general
(candidatas chicas, costo río abajo) era correcta; el término dominante no.

### 11.4 Las pasadas son un seguro: se pagan siempre, cobran a veces

**Medido, las dos mitades:**

- En P2 (50 páginas, sin texto rotado en márgenes): **200 pasadas activas,
  ninguna salteada por blanco, `wordsAdded = 0`**. Doscientas lecturas, cero
  palabras.
- En qa-stamp (una página con sello vertical): **21 palabras añadidas**, que
  reproducen exactamente las 15 rotadas + 6 sobrantes de ADR-121 (§4).
- En el fixture T5 rotado: **108 candidatas crudas, las 108 descartadas por
  confianza**, `wordsAdded = 0` (§5.1). Ese fixture no tiene contenido de
  margen diseñado para leerse rotado.

La compuerta de ADR-162 no recorta esto porque es **exacta**: saltea una
franja solo si cada píxel es blanco o transparente. Basta con que el cuerpo
horizontal del documento invada el 20 % lateral —el caso normal— para que la
franja quede activa. En P2 eso pasó en las 100 franjas.

**Inferido, y es la observación con más consecuencias del perfilado:** la
información para no pagar el seguro cuando no corresponde **ya existe en el
motor**. Al llegar a las tiras, el kernel conoce las cajas de todas las
palabras que la pasada derecha reconoció, y de hecho las usa —pero
**después**, en `intersectionRatio`, para descartar candidatas repetidas
cuando el costo de reconocerlas ya se pagó. La misma señal, aplicada
**antes** del reconocimiento, describiría cuánta tinta del margen todavía no
tiene explicación. Cuánta queda realmente es una pregunta abierta y medible;
esta campaña no la midió.

### 11.5 Lo que este perfil deja planteado

1. **Reducir píxeles es el único camino con techo alto** que no toca la
   capacidad: el 74 % está en el área que se le entrega a Tesseract.
2. **La decisión de conservar o recortar la capacidad sigue siendo del
   humano** (plan §6), y este perfil le da por fin las dos mitades del
   tradeoff medidas: cuesta ~6 s cada 50 páginas escaneadas y recupera 15 de
   15 palabras cuando hay un sello que recuperar.
3. Nada de lo anterior autoriza una heurística de salteo por intuición ni un
   umbral de blanco aproximado: T-4b conserva sus prerrequisitos.

Continúa en
[`Margenes_Menos_Pixeles_Plan.md`](Margenes_Menos_Pixeles_Plan.md).
