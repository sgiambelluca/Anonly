# T-5 — Resultados separados A/B/C

Fecha: 2026-09-15. Reporte factual para revisión del planificador. La etapa AB
se ejecutó antes de incorporar C; T5 sigue pendiente y ninguna condición
histórica con fallo de ImageData se declara aceptada.

## Identidad y separación

- A: control detached `48961510e004c62f39669de7760a41d8361ef49f`, 2 LSTM + 2 OSD,
  2 consumidores, ImageData estructural histórico.
- B: fuentes T5 actuales con 2 LSTM + 1 OSD, una página de adelanto, hasta 3
  consumidores, pero retorno ImageData estructural histórico.
- C: exactamente B más `createImageDataResult` con copia estable y ImageData
  nativo. C se midió en la etapa 2; no se introdujo otra variable.

Snapshot recuperable y diff exacto: `.measure/t5-osd/t5-20260915-separated-20260915-105519/snapshots/current/`,
`.measure/t5-osd/t5-20260915-separated-20260915-105519/snapshots/B/kernel.ts` y `.measure/t5-osd/t5-20260915-separated-20260915-105519/manifests/image-data.diff`.
El candidato C final, que incluye además la guarda de ramas activas, quedó
preservado en `snapshots/final-C/`; sus hashes están en
`manifests/final-C-source-sha256.txt`.
Los intentos operativos inválidos se conservan, sin promediar, en
`.measure/t5-osd/t5-20260915-separated-20260915-105519/diagnostics/invalid-attempts.md`.
Fixture congelado: `.measure/t5-osd/t5-20260915-adelanto-7c3a9d11/fixture/p2-scanned-50p.pdf`,
SHA-256 `26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f`.
Todos los JSON y stdout están en `.measure/t5-osd/t5-20260915-separated-20260915-105519/AB/` y `.measure/t5-osd/t5-20260915-separated-20260915-105519/logs/AB/`; los de BC están en las carpetas homónimas `BC/`.

El instrumento exige `ANONLY_T5_STAGE`, `ANONLY_T5_CONDITION` (A/B/C) y
registra el mapa de factories, hashes de fuente/build/instrumento/lock/assets,
configuración efectiva y huellas completas de Word[].

## Diagnóstico ImageData fuera de medición

A y B conservan la forma estructural histórica. En Chromium,
`putImageData` rechaza esa forma antes de llamar a `recognize`. Para P2, las
100/100 franjas tienen píxeles visibles, de modo que el cero efectivo en las
cuatro pasadas de margen proviene del TypeError previo a Tesseract; una página
girada también falla antes de su reconocimiento completo. El diagnóstico
completo y el diff se conservan en
`.measure/t5-osd/t5-20260915-separated-20260915-105519/diagnostics/image-data-behavior.md`.

## Etapa 1 — AB, solo OSD compartido + adelanto

Orden alternado ejecutado: A1/B1, B2/A2 y A3/B3. Cada sesión tuvo frío y
caliente separados, un Electron, builds frescos y el mismo P2. Los tiempos son
OCR_STARTED→OCR_FINISHED y Ready usa el reloj común de las fases. Deltas son
B−A; MB son decimales.

| Par | Frío OCR | Frío Ready | Frío RSS OCR | Frío RSS global | Caliente OCR | Caliente Ready | Caliente RSS OCR | Caliente RSS global |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | -3613 ms | -3636 ms | +52.5 MB | +275.0 MB | -4181 ms | -4262 ms | +265.8 MB | +265.8 MB |
| 2 | -3754 ms | -3409 ms | -8.1 MB | -59.9 MB | -3532 ms | -5011 ms | -458.2 MB | -458.2 MB |
| 3 | -3562 ms | -3552 ms | -53.4 MB | +245.4 MB | -3971 ms | -3829 ms | +371.1 MB | +346.8 MB |
| **media** | **-3643 ms** | **-3532 ms** | **-3.0 MB** | **+153.5 MB** | **-3895 ms** | **-4367 ms** | **+59.6 MB** | **+51.5 MB** |

Todos los JSON seleccionados tuvieron `ok=true` y `peakWithinPhases=true`.
Las tres huellas cold/hot por condición coinciden con
`c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49` y
contienen 50 páginas/1038 palabras. La dispersión entre pares es dominante en
RSS; en este conjunto el tiempo OCR medio de B resulta 3.64 s menor en frío y
3.89 s menor en caliente que A, aunque no se adopta como mejora de producto
porque A/B pierden trabajo por el fallo histórico de ImageData y BC mide la
corrección por separado. No se suman porcentajes.

| Condición | Padres OCR concurrentes | Hijos Tesseract observados | Jobs OCR | Jobs OSD |
| --- | ---: | ---: | ---: | ---: |
| A | 2 | 2 LSTM + 2 OSD | 50 | 0 (incluido dentro de ocr-page histórico) |
| B | 2 | 2 LSTM + 1 OSD | 50 | 50 |

Los conteos de hijos son independientes de los jobs; los padres se recrean
entre frío/caliente. El RSS se informa como máximo simultáneo dentro de OCR y
máximo global, nunca como suma de costos.

## Requisitos verificados antes de C

- Ciclo de vida: ramas de sesión contadas hasta asentarse tras rechazo de
  `Promise.all`; repro permanente pasa junto a 15 pruebas T5.
- Ventana: cuatro requests prueban que la cuarta no se produce mientras dos
  LSTM están bloqueados; presupuesto/retry, lowResource/fallback y cancelación
  del adelanto tienen pruebas aisladas.
- Calidad P2: Word[] completas, confianza, bbox, rotación y orden se preservan
  en las huellas; la limitación de A/B es el trabajo interno perdido por el
  fallo histórico de ImageData, no una igualdad de llamadas.

## Etapa 2 — BC, solo corrección ImageData

Se midieron controles B contemporáneos y C en el orden B1/C1, C2/B2 y B3/C3,
sin reutilizar tiempos de AB. C conserva exactamente la topología de B; la
diferencia funcional es la copia estable/native `createImageDataResult`, que
permite completar las franjas y páginas giradas que A/B abortan antes de
`recognize`.

Los tiempos son C−B, en milisegundos; RSS está en megabytes decimales y es
informativo por par. El par 2 de B reportó `peakWithinPhases=false` en frío y
caliente, por lo que sus RSS no entra en la media válida.

| Par | Frío OCR | Frío Ready | Frío RSS OCR | Frío RSS global | Caliente OCR | Caliente Ready | Caliente RSS OCR | Caliente RSS global |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | +6074 ms | +6157 ms | -11.3 MB | -151.7 MB | +6039 ms | +5898 ms | +179.7 MB | +117.7 MB |
| 2† | +6023 ms | +6109 ms | +56.9 MB | -280.9 MB | +6290 ms | +6429 ms | -467.3 MB | -276.4 MB |
| 3 | +5547 ms | +5189 ms | +80.2 MB | +224.3 MB | +5969 ms | +5942 ms | +245.3 MB | +245.3 MB |
| **media tiempo** | **+5881 ms** | **+5818 ms** |  |  | **+6099 ms** | **+6090 ms** |  |  |
| **media RSS válida (pares 1,3)** |  |  | **+34.1 MB** | **+32.6 MB** |  |  | **+216.9 MB** | **+184.4 MB** |

† La corrida se conserva completa en `BC/pair-2/B/` y su log; el resultado de
RSS no es comparable por la marca de validez. Todos los JSON de C tuvieron
`ok=true`, dos padres LSTM, un padre OSD/orientación y máximos `ocr-page=2`,
`ocr-orient=1`. Las huellas completas de Word[] de C coinciden con B y con la
huella P2 `c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49`.

El resultado separa las variables: OSD compartido + adelanto tuvo en AB una
media de tiempo OCR B−A de −3.64 s en frío y −3.89 s en caliente, con alta
dispersión; recuperar el trabajo de ImageData añade aproximadamente +5.88 s
frío y +6.10 s caliente frente a B. Por tanto, B no acredita por sí solo una
mejora de producto sobre el control histórico y C paga un coste medible para
recuperar reconocimiento funcional. No se suman porcentajes ni se tratan
máximos RSS como aditivos.

## Matriz requisito → prueba → resultado

| Requisito | Evidencia | Resultado factual |
| --- | --- | --- |
| Cancelación, timeout y generaciones tardías | `t5-shared-osd.test.ts`, pruebas de kernel de orientación | Pasa; inicializaciones tardías se terminan y bitmaps se cierran. |
| Adelanto acotado y presupuesto | prueba de cuatro requests, retry y presupuesto | Pasa; la cuarta espera turno y se observan 2 LSTM + 1 OSD. |
| Liberación durante producción y reanálisis | pruebas de ramas activas, `releaseIdleWorkers` y reanálisis | Pasa en unit; aislamiento queda cubierto por tests, con E2E funcional aún pendiente de revisión. |
| Igualdad estructural de OCR | Word[] completas en JSON cold/hot | Huellas coinciden en P2; no prueba zonas que A/B no alcanzan. |
| Separación ImageData | `diagnostics/image-data-behavior.md`, `manifests/image-data.diff`, BC | C recupera el camino nativo; el coste C−B está medido. |
| E2E de giros, censura y exportación | `ANONLY_T5_E2E=1` + `tests/e2e/t5-orientation-pixel.spec.ts` | Pasa (1 test, 24.1 s): 5 páginas 0/90/180/0/270, reanálisis, DNI ground truth y píxel exportado cambiado; PDF crudo en `.measure/t5-e2e/orientation-1789482356784/anonymizado.pdf`; no se declara cierre. |
| Instrumento y topología CDP | manifests por corrida y stdout | Pasa con mapa de factories explícito; RSS no atribuido a WASM se mantiene como cota. |

## Límites

El E2E de C pasa con las comprobaciones de cinco páginas, rotaciones, reanálisis,
texto ground truth y píxel de exportación descritas arriba. Aún no es un oráculo
independiente para cada caja OCR ni para todas las zonas externas; la aceptación
final queda pendiente de revisión y T5 no se marca cerrada. El build final y el
árbol quedaron en C después de los gates scoped.
