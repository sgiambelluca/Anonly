<!-- CONTEXT: scope=roadmap-plan | dependencias=roadmap/H-10_Bitacora_De_Memoria.md,architecture/07_Performance_Strategy.md,core/OCR_Engine.md,adr/ADR-143-Las-Imagenes-De-OCR-Se-Producen-Cuando-Hay-Lugar.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-147-Perder-Un-Identificador-Cubierto-Es-Una-Regresion.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-157-El-Pool-De-OCR-Se-Da-De-Baja-Al-Terminar-Su-Etapa.md,adr/ADR-158-El-Raster-De-OCR-Viaja-Codificado.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md,adr/ADR-160-El-Worker-De-OCR-No-Decodifica-La-Pagina.md,adr/ADR-161-Una-Franja-Sin-Tinta-No-Se-Reconoce.md,adr/ADR-162-Solo-Una-Franja-Visualmente-Blanca-Se-Saltea.md,tests/fixtures/README.md,tests/perf/README.md,adr/ADR-164-Un-OSD-Compartido-Por-Core.md | audiencia=humanos+IA | fase=11 -->

# Optimización de memoria — plan de campaña

> **Qué es esto.** `H-10_Bitacora_De_Memoria.md` es el registro de la campaña
> anterior **al momento de pausarla**. Esto la reanuda: qué se verificó para
> poder decidir, qué se decidió, y en qué orden se ejecuta.
>
> **Estado (2026-09-15)**: T-1 cerrada; **T-2 cerrada**, implementada y
> verificada con control A/B; **T-3 cerrada con resultado inconcluso** —la
> extrapolación lineal no ocurrió, pero tampoco apareció una meseta limpia—;
> T-4 **cerrada** en su variante exacta y sin calibración (ADR-162), con sus
> gates scoped verdes; T-4b conserva la heurística calibrada y sigue bloqueada por el
> corpus de ADR-147; **T-5 cerrada**, OSD compartido + una página de adelanto
> aceptado, con implementación, validación y controles finales completos.
> El perfilado de ImageData cerró como evaluación separada; I-1 de márgenes
> quedó implementada y conservada tras medición A/B (`Margenes_Menos_Pixeles_Plan.md` §9);
> T-6a **cerrada e implementada** como cap conservador por página (ADR-163);
> T-6b queda en pausa por la decisión del humano del 2026-09-17 de conservar
> 300 DPI como valor configurado, priorizando calidad. T-6a sigue vigente.
> **Reapuntada el 2026-09-17 (§1bis)**: con el instrumento arreglado, procesar
> un documento cumple el presupuesto (M1 de P2 = 204,8 MB contra 512) y el
> exceso está en lo que la app retiene después de cerrarlo (base caliente de
> 1,7–2,2 GB). **T-7 abierta** para atribuir esa base.

**Perfil de referencia**: P2 — 50 páginas escaneadas, OCR + NER reales, sobre el
shell de Electron empaquetado.

---

## 1. Qué cambió respecto de la bitácora

Dos verificaciones, las dos pedidas por el humano antes de autorizar nada.

### 1.1 El residuo por página existe, pero el estadístico que lo medía no servía

Re-análisis de los mismos archivos, sin corridas nuevas. La regresión de RSS que
sostenía los "2,4-4,2 MB/página" da tres intervalos de confianza **disjuntos**
(−1,58 / +4,46 / +1,95 MB/pág), sobre una señal que oscila 430-660 MB dentro de
la ventana. El **piso** —el estadístico correcto para retención— da positivo
**3 de 3**, y además muestra que **el proceso GPU acumula tanto como el
renderer**, contra el 73-81 % que la bitácora le atribuía a Tab.

→ **ADR-159**. Consecuencia: la hipótesis de §7 (marca de agua del heap de WASM,
"irreducible dentro de una corrida") explica **como mucho la mitad**. La otra
mitad son canvas nuestros, y son reducibles.

### 1.2 tesseract.js no necesita un canvas, y el `angle` no reemplaza la rotación

Leído en la fuente de `tesseract.js@6.0.1` y `tesseract.js-core@6.1.2`:
`loadImage` acepta un `Blob` y lo pasa tal cual; `setImage` escribe los bytes
codificados en el MEMFS del WASM. **El canvas por página es costo íntegramente
nuestro.** En cambio el `angle` de `SetImageFile` va a `pixRotate` con
`L_ROTATE_AREA_MAP` y salida clavada al tamaño de entrada: no sirve para los
90°/270° de ADR-121 y sería una pérdida de calidad.

→ **ADR-160**, con el `angle` descartado por escrito para que nadie lo reintente.

---

## 1bis. Corrección de rumbo (2026-09-17): el exceso no está en el pipeline

> **Corregido por T-7 el 2026-09-17, con medición
> ([`Perfilado_Base_Caliente_Medicion.md`](Perfilado_Base_Caliente_Medicion.md)).**
> Esta sección concluía que había un residuo **estructural** de 700 MB–1,2 GB
> retenido tras cerrar el documento. **No es así.** Esa base caliente se tomaba
> en una ventana de ≤30 s (`HOT_BASELINE_SETTLE_CEILING_MS`) y la liberación por
> inactividad ocurre después: extendiendo la observación a 120 s, la app cae de
> 1506,0 a 583,9 MB en P1 y de 1393,7 a 366,1 MB en P2, cerca de su base fría
> (~420 MB). Era memoria **en tránsito hacia su liberación**, medida antes de que
> ocurriera; no un piso.
>
> Lo que sigue en pie de esta sección es el otro hecho: **procesar un documento
> cumple el presupuesto** (M1 de P2 = 204,8 MB contra 512). Y lo que reemplaza al
> diagnóstico equivocado es más accionable que él: **la liberación funciona, pero
> su reloj está calibrado para un usuario que espera entre documentos.** Quien
> encadena varios en menos de un minuto abre el segundo sobre la base todavía
> inflada — el «residuo del documento anterior» de ADR-146 §7bis. El lever no es
> buscar una fuga; es cuándo se libera.
>
> El texto original se conserva abajo para que la corrección sea legible.


Con el instrumento arreglado (`Instrumento_De_Memoria_Arreglo_Plan.md`, cerrado)
la primera tanda interpretable dice algo que reordena esta campaña.

**Procesar un documento no es lo que excede el presupuesto.** M1 de P2 dio
**78,5 / 204,8 / 389,1 MB** contra los 512 MB de `00_Project_Vision.md` §7:
cumple. El control P1 dio **6,7 MB** de mediana con medio megabyte de
dispersión.

**Lo que pesa es lo que la aplicación retiene después de cerrar el documento:**

| perfil | base fría | base caliente | base / M2 caliente |
|---|---:|---:|---:|
| P1 — 10 p de texto | 429,5 MB | **1723,9 MB** | **100 %** |
| P2 — 50 p escaneadas | 412,2 MB | **2158,1 MB** | **91 %** |

La app arranca en ~420 MB. Después de abrir y cerrar **un** documento queda en
1,7–2,2 GB **sin documento abierto**, y procesar el siguiente cuesta 6,7 MB en
P1 y 204,8 MB en P2. En la corrida caliente de P1, la línea de base **es** el
100 % de M2: todo lo que se mide ya estaba ahí antes de importar nada.

Parte es por diseño —ADR-146 §1 define la base caliente con los modelos ya
cargados— pero los componentes que `07_Performance_Strategy.md` §7.1 sabe
nombrar suman ~1 GB con Electron incluido. Entre **700 MB y 1,2 GB** no están
atribuidos.

### Esto confirma una corrección que ya estaba escrita y no se explotó

ADR-154 §2 lever 3 lo anticipó el 2026-09-12, por inferencia sobre tres
corridas: *«bajar el nivel sostenido sí baja ese pico — el del documento
siguiente. O sea que ADR-156 y ADR-157 no son ajenos al máximo en el uso real,
que es abrir varios documentos en una sesión»*. Hoy ese nivel sostenido tiene
número, y es el 91–100 % de lo que mide la corrida siguiente.

**Consecuencia para el orden de esta campaña**: los levers que actúan sobre el
pico *durante* el procesamiento —copias por página, canvas, GPU, DPI— apuntan a
una porción que ya entra en presupuesto. El trabajo pasa a la retención
posterior al documento, que es T-7.

Lo que **no** cambia: T-6b sigue en pausa, y el límite de §4 sigue vigente —el
fixture no es un escaneo real, y P4 no existe.

---

## 2. El orden

Cada tarea dice qué la desbloquea y qué entrega. **Una tarea = un módulo**
(R-1/R-5).

### T-1 — Instrumento: heap por target, con GC forzado — **CERRADA (2026-09-12)**

**Dónde**: `tests/` únicamente. **ADR**: ninguno nuevo (ADR-159 §2 ya lo autoriza).

> **Cerrada.** `tests/perf/support/cdpHeap.ts` (cliente CDP propio por WebSocket,
> sin dependencia nueva, con auto-attach recursivo a los workers anidados de
> tesseract.js), más heap-por-target, cobertura y residuo integrados a
> `PhaseSegment`, y el piso de ADR-159 §3 en el agregador. 32 tests nuevos, gates
> verdes (132/132 archivos, 2122/2122 tests). Nada en `packages/` ni `apps/`.
>
> **La línea de base de T-2** es la corrida del 2026-09-12 04:43-04:45
> (`.measure/memory-p2-scanned-50p-run{0,1,2}.json`), la única tomada con la
> versión final del instrumento. **Ninguna corrida anterior sirve de "antes"**:
> mezclar versiones de instrumento es lo que dejó el M2 de ADR-158 sin
> atribución limpia.
>
> | pico en la ventana de OCR | run0 | run1 | run2 |
> |---|---|---|---|
> | Tab | 1149,7 MB | 1022,6 MB | 1165,4 MB |
> | **GPU** | 451,6 MB | 479,6 MB | 517,7 MB |
>
> **Tres hallazgos que sobreviven a la tarea**, los tres de verificar en vez de
> asumir: un target ocupado en WASM síncrono no contesta CDP (ADR-159 §6);
> `Runtime.getHeapUsage` **no ve** la memoria lineal de WASM (§8); y el piso y el
> pico miden cosas distintas, así que el estadístico se elige por el lever (§3).
>
> **Abierto y declarado**: la marca de agua del heap de WASM de Tesseract queda
> fuera del alcance del instrumento; el residuo "no atribuido" no cierra
> aritméticamente y **no se usa como criterio de nada**; y el generador de
> fixtures de P2 no es determinístico (produce un hash distinto por corrida).

Lectura del heap de cada target por separado —hilo principal, los cinco workers
nuestros, y los **dos** workers de tesseract.js que cada worker de OCR levanta
(principal LSTM + OSD legacy)— vía CDP, con recolección forzada antes de cada
lectura. Más el estadístico del piso de ADR-159 §3 en el agregador.

**Por qué primero**: sin esto, cada lever siguiente se evalúa con el mismo ruido
que invalidó la pendiente. Y recalcula el piso sobre `main`, que hoy no está
medido (los tres archivos de `.measure/` son de la rama del spike descartado —
ADR-159 §4).

**Cierra cuando**: una corrida de P2 reporta, por fase, el heap de cada target y
el piso por proceso, y el instrumento está verificado **ejecutándolo**, no
leyéndolo.

> **Corregido el 2026-09-12, sobre dos verificaciones que fallaron — y por eso se
> hicieron antes de correr nada** (ADR-159 §6 y §8):
>
> 1. Un target adentro de una llamada **síncrona** de WASM no contesta CDP hasta
>    que cede el control, y los workers de tesseract.js están así casi toda la
>    ventana de OCR. La lectura rala **se acepta** (la memoria de WASM solo crece,
>    así que muestrear ralo no pierde nada, y el hueco entre páginas es justo el
>    piso que se quiere medir), con cobertura declarada por target y fase.
> 2. **`Runtime.getHeapUsage` no ve la memoria lineal de WASM.** Medido: 20 MB de
>    `WebAssembly.Memory` y un `.grow()` de 10 MB más no mueven ninguno de sus
>    cuatro campos. El instrumento mide el heap de objetos de V8 y los backing
>    stores de `ArrayBuffer`/canvas — no el heap de Tesseract.
>
> **Qué cambia en el plan**: T-1 **alcanza para medir T-2** (ADR-160 saca
> `ImageData` y canvas, que es exactamente lo que sí se ve) y **no alcanza para
> zanjar la marca de agua del heap de WASM**. Deja de ser prerrequisito de esa
> pregunta, que queda abierta. El residuo `RSS − Σ(isolates)` se reporta rotulado
> **"no atribuido (WASM + nativo)"**, nunca implícitamente cero.

### T-2 — ADR-160: el worker de OCR no decodifica la página — **CERRADA (2026-09-12)**

> **Medido, 3 corridas, contra la línea de base de T-1. Verificado de forma
> independiente por el planificador sobre los JSON.**
>
> **Control A/B de 6 corridas alternando condición** (BEFORE/AFTER × 3 pares,
> reconstruyendo en cada una, con los 6 JSON preservados). Δ = AFTER − BEFORE
> dentro del mismo par:
>
> | | par 1 | par 2 | par 3 | promedio | signo |
> |---|---|---|---|---|---|
> | pico Tab | −192,8 | −11,4 | −94,7 MB | **−99,6** | 3/3 |
> | **pico GPU** | −175,4 | −87,5 | −141,2 MB | **−134,7** | 3/3 |
> | M2 | −168,4 | −27,4 | −177,0 MB | **−124,3** | 3/3 |
>
> **En los pares 1 y 2 la condición AFTER arrancó con una línea de base 648 y
> 564 MB MÁS ALTA y aun así midió picos más bajos**: el confound de base jugaba
> en contra y el cambio ganó igual.
>
> Una primera medición sin control había dado −378 MB combinado; el A/B la
> corrigió a **−234 MB**. La diferencia era deriva de línea de base.
>
> **El GPU bajó 3-4× más que Tab en términos relativos**, que es exactamente lo
> que ADR-160 §6 predijo: ahí viven los backing stores de los canvas que el
> cambio elimina. Predicción hecha **antes** de medir, no después.
>
> **Sin costo de calidad, medido**: `groupCount = 11` y `entityCount = 13` en las
> tres corridas, y `groupCount = 11` también en las **6** del control A/B. Todas
> válidas (`ok`, `peakWithinPhases`, `hotBaselineSettled`).
>
> **El test estructural pasa con su discriminante**: cero `OffscreenCanvas` de
> página completa en el camino común, y > 0 en el camino lento de orientación
> ≠ 0 — o sea que el contador mide algo (ADR-149 §2).
>
> Alcance respetado: solo `ocr-engine`. Sin cambios de contrato.

**Dónde**: `ocr-engine`. **ADR**: 160, escrito. **Contrato**: no cambia.

El lever más grande que queda sin costo de calidad, sin tocar paralelismo
(ADR-154 §1) ni DPI. Elimina cuatro superficies de página completa por página en
el camino común.

**Cierra cuando**: gates verdes, cobertura ≥ 85 % del módulo, y los tres
criterios de aceptación de **ADR-160 §6** — que son, en orden de peso:

1. **El test estructural**: el camino común no construye ningún
   `OffscreenCanvas` de página completa, con su discriminante (contra el kernel
   previo tiene que dar > 0). No depende de ninguna medición, así que fija la
   propiedad aunque la memoria se mueva menos de lo estimado.
2. **El pico por proceso** dentro de `OCR_STARTED → OCR_FINISHED`, Tab y GPU por
   separado, contra la línea de base de T-1 del 2026-09-12. **No el piso**: lo
   que este ADR saca es transitorio, y el piso mide retención (ADR-159 §3).
3. **Calidad idéntica** sobre el corpus de ADR-147.

### T-3 — Perfil de 200 páginas — **CERRADA, RESULTADO INCONCLUSO (2026-09-13)**

**Dónde**: módulo de tests (`tests/fixtures/` + `tests/perf/`). **ADR**: ninguno:
es una extensión del instrumento de ADR-146/159, no cambia producto, contratos,
presupuestos ni gates.

**Objetivo**: medir —no extrapolar— si el piso de memoria sigue creciendo cuando
el mismo trabajo de P2 se extiende de 50 a 200 páginas. Va después de T-2 a
propósito: la comparación se hace sobre el camino de OCR ya corregido por
ADR-160. Los **94-190 MB** de la bitácora son el exceso previo a T-2 y quedan
solo como contexto histórico; no son umbral ni criterio de esta tarea.

> **Implementación validada el 2026-09-13 con una corrida opt-in real.** Build
> fresco de React/Vite y del shell; Playwright: **1 passed en 4,5 min**, sin
> timeout ni OOM. Esa corrida fue la validación de instrumento y sus JSON se
> sobrescribieron deliberadamente al tomar la tanda final 3+3, como anticipa
> §2bis punto 6. Los datos canónicos son los de §3.0.

#### 3.0 Resultado de la caracterización

Mismo build post-T-2, equipo inactivo, perfiles ejecutados en serie. Las seis
corridas son válidas: `ok: true`, `peakWithinPhases: true` y, en caliente,
`hotBaselineSettled: true`. No hubo timeout ni OOM.

| perfil/run | temperatura | M2 | M1 | tiempo | grupos | entidades |
|---|---|---:|---:|---:|---:|---:|
| 50p/run0 | fría | 1329,3 MB | — | 30,5 s | 11 | 13 |
| 50p/run0 | caliente | 1484,4 MB | 738,0 MB | 27,6 s | 11 | 13 |
| 50p/run1 | fría | 1683,2 MB | — | 29,1 s | 11 | 13 |
| 50p/run1 | caliente | 1681,6 MB | 290,4 MB | 28,9 s | 11 | 13 |
| 50p/run2 | fría | 1813,4 MB | — | 29,0 s | 11 | 13 |
| 50p/run2 | caliente | 1470,5 MB | 97,8 MB | 27,7 s | 11 | 13 |
| 200p/run0 | fría | 1418,7 MB | — | 107,7 s | 40 | 56 |
| 200p/run0 | caliente | 1813,6 MB | 984,4 MB | 108,7 s | 40 | 56 |
| 200p/run1 | fría | 1867,7 MB | — | 116,5 s | 40 | 56 |
| 200p/run1 | caliente | 1826,4 MB | 1141,7 MB | 116,7 s | 40 | 56 |
| 200p/run2 | fría | 2012,7 MB | — | 114,4 s | 40 | 56 |
| 200p/run2 | caliente | 1769,8 MB | 912,9 MB | 118,8 s | 40 | 56 |

M1 se conserva como **cota inferior** y no decide por sí sola. Los pisos que sí
contestan retención se muestran por corrida, sin promedio:

| perfil/run | temp. | piso Tab OCR | Δ Tab | piso GPU OCR | Δ GPU | Δ Tab+GPU |
|---|---|---:|---:|---:|---:|---:|
| 50p/run0 | fría | 599,7→714,0 | +114,4 MB | 122,0→216,4 | +94,5 MB | **+208,9 MB** |
| 50p/run0 | caliente | 663,1→788,1 | +124,9 MB | 181,7→228,1 | +46,4 MB | **+171,3 MB** |
| 50p/run1 | fría | 635,9→866,1 | +230,2 MB | 183,9→288,7 | +104,8 MB | **+335,0 MB** |
| 50p/run1 | caliente | 730,0→763,5 | +33,5 MB | 192,8→232,3 | +39,5 MB | **+73,0 MB** |
| 50p/run2 | fría | 456,7→876,1 | +419,4 MB | 174,7→311,6 | +136,9 MB | **+556,3 MB** |
| 50p/run2 | caliente | 736,8→863,4 | +126,7 MB | 214,7→256,7 | +42,0 MB | **+168,7 MB** |
| 200p/run0 | fría | 650,3→799,0 | +148,7 MB | 107,9→270,9 | +163,0 MB | **+311,7 MB** |
| 200p/run0 | caliente | 726,0→862,0 | +136,0 MB | 119,9→222,2 | +102,3 MB | **+238,3 MB** |
| 200p/run1 | fría | 677,8→711,0 | +33,2 MB | 150,8→246,9 | +96,1 MB | **+129,3 MB** |
| 200p/run1 | caliente | 773,4→772,0 | −1,3 MB | 113,4→233,1 | +119,7 MB | **+118,4 MB** |
| 200p/run2 | fría | 568,1→768,5 | +200,4 MB | 164,4→240,1 | +75,8 MB | **+276,2 MB** |
| 200p/run2 | caliente | 727,2→739,4 | +12,2 MB | 111,5→217,5 | +106,0 MB | **+118,2 MB** |

**La extrapolación lineal queda descartada.** Cuadruplicar las páginas no
cuadruplicó el delta del piso: 50p dio +73,0 a +556,3 MB y 200p dio +118,2 a
+311,7 MB. El aumento de 200p queda en el mismo orden que el de 50p y, en tres
de las seis comparaciones por temperatura/run, es menor.

**Pero “acotado” tampoco queda demostrado.** Releídos los cuatro cuartos de la
serie cruda de 200p, el cambio combinado Q3→Q4 fue +45,4 / +67,0 / +6,4 / +88,0
/ −7,8 / −60,4 MB: positivo en cuatro corridas y negativo en dos. La mayor parte
del crecimiento aparece temprano y hay señales de meseta, pero el tramo tardío
no es plano de forma consistente.

**Conclusión T-3: inconcluso entre “acotado” y “crecimiento tardío”, con un
resultado firme más estrecho: la extrapolación lineal de ADR-159 §5 es falsa.**
No se actualiza el presupuesto ni se autoriza un lever nuevo a partir de estos
datos. Si hiciera falta distinguir las dos hipótesis restantes, el experimento
siguiente debe instrumentar avance por página y pisos por bloque de páginas; no
se resuelve sumando más repeticiones del mismo máximo RSS.

#### 3.1 El fixture, sin una segunda variable escondida

Se agrega **una sola variante liviana**: `generateText200p()` junto a
`generateText50p()` en `tests/fixtures/generate.ts`. **No** se agrega una variante
densa de 200 páginas: T-3 cambia longitud, no densidad.

Propiedades obligatorias:

1. **200 páginas A4**, mismo layout, tipografía, plantilla de párrafo y densidad
   aproximada de P2; el escaneado se produce al mismo DPI configurado que P2.
2. **20 páginas con entidad**, una cada diez:
   `TEXT_200P_ENTITY_PAGE_INDICES = [0, 10, ..., 190]`. Cada una contiene Person
   + DNI sintetizados; las otras 180 son neutras. Así se conserva el 10 % de
   páginas con entidad de P2 y la última verificación queda cerca del final.
3. Las 200 páginas tienen texto fuente distinto. El rótulo dice
   `Página N de 200`; no se reutiliza el literal `de 50` del builder actual.
4. `generateText50p()` conserva exactamente su API y sus invariantes actuales.
   Se permite extraer un helper interno parametrizado para evitar duplicación,
   siempre que los tests existentes de 50 páginas sigan verdes.
5. La fuente se genera en memoria y el PDF escaneado se obtiene con
   `getOrGenerateScannedFixture("p2-scanned-200p", ...)`, fuera del Electron
   medido y antes de abrirlo, igual que P2. No se commitea ningún PDF binario.

El perfil y sus reportes se llaman **`p2-scanned-200p`**. Es una extensión de
P2, no “P3”: ADR-146 §4 ya reserva P3 para el ciclo de 10 open/close.

#### 3.2 Es opt-in, no agranda el gate cotidiano

El perfil vive en `tests/perf/memory.spec.ts`, pero queda saltado salvo que
`ANONLY_MEMORY_200P=1`. `pnpm test:perf` sin esa variable mantiene su alcance y
duración actuales. Esto no es un `test.skip` que esconda un gate: `memory.spec.ts`
es un instrumento sin umbral (`tests/perf/README.md`), y T-3 es una campaña
manual explícita. Si más adelante el perfil se convierte en gate Stress, se
actualizan primero `07_Performance_Strategy.md` §11.4 y el comando canónico.
El título del test comienza con `P2-200 — 200 páginas escaneadas`, que es el
selector estable usado por el comando de la tanda.

Los límites también son específicos del perfil, no globales:

- `measureProfile` acepta un `runTimeoutMs` opcional; el default de los perfiles
  existentes queda en **180 000 ms**.
- P2-200 usa **900 000 ms por import**: cuatro veces el límite de P2 por las
  cuatro veces más páginas, más 25 % de margen.
- El test completo usa **2 100 000 ms (35 min)** para generación, corrida fría,
  cierre/asentamiento y corrida caliente. Un timeout u OOM se registra como
  “no cumple”/inconcluso según ADR-146 §6; nunca se vuelve infinito ni se aumenta
  después de ver el resultado.

#### 3.3 Protocolo de medición

La implementación del perfil se verifica primero con **una** corrida. La
caracterización final se hace después, siempre serial y con el equipo inactivo:

1. Un único commit/build post-T-2 y la versión final del instrumento de T-3.
   Como T-3 toca el helper para parametrizar el timeout, se vuelve a medir P2-50:
   no se mezclan versiones del instrumento (§2bis punto 4).
2. Tres ejecuciones de `p2-scanned-50p` y tres de `p2-scanned-200p`; cada
   ejecución conserva el par fría→cerrar/asentar→caliente de ADR-146 §4. Son,
   por tanto, tres corridas frías y tres calientes por perfil.
3. Solo entran a la lectura corridas con `ok: true`,
   `peakWithinPhases: true` y, para caliente, `hotBaselineSettled: true`. Un OOM,
   timeout o dato ausente se muestra individualmente y no se promedia.
4. Por corrida y temperatura se transcriben: M2; M1 —solo caliente y rotulada
   cota inferior—; duración; pico de Tab y GPU dentro de
   `OCR_STARTED → OCR_FINISHED`; piso inicial, piso final y delta de Tab y GPU
   en esa fase; suma del delta Tab+GPU; `groupCount` y `entityCount`.
5. M2/tiempo pueden llevar min/promedio/máximo como hoy. Los pisos se muestran
   **corrida por corrida, nunca promediados**, según ADR-159 §3. El residuo
   `RSS − Σ(isolates)` sigue rotulado “no atribuido (WASM + nativo)” y no se usa
   como si midiera el heap de Tesseract.

Comandos de la tanda, después del build exigido por `tests/perf/README.md`:

```bash
npx playwright test --config=playwright.perf.config.ts tests/perf/memory.spec.ts --grep "P2 — 50 páginas" --repeat-each=3
ANONLY_MEMORY_200P=1 npx playwright test --config=playwright.perf.config.ts tests/perf/memory.spec.ts --grep "P2-200" --repeat-each=3
pnpm tsx tests/perf/support/aggregateMemoryReports.ts
```

Antes de la tanda se aplican todos los puntos de §2bis. Los nombres de perfil
son distintos, así que sus JSON no se pisan entre sí; sí se preserva cualquier
tanda anterior antes de volver a usar `run0..2`.

#### 3.4 Qué decide la medición y quién lo decide

T-3 **no agrega un threshold automático** ni cambia por sí sola el presupuesto.
El implementador entrega el instrumento y los JSON; el planificador lee la serie
cruda y los pisos individuales y registra una de tres conclusiones:

- **crecimiento estructural al menos hasta 200 páginas**: el piso de la ventana
  de OCR continúa subiendo en la parte tardía de las corridas válidas y el perfil
  de 200 amplifica de forma consistente el delta Tab+GPU observado en 50;
- **acotado antes de 200 páginas**: la serie alcanza una meseta visible y el
  tramo tardío no continúa elevando el piso, aunque el primer tramo haya crecido;
- **inconcluso**: señales mixtas, corridas inválidas o ruido que no permite una
  de las dos afirmaciones anteriores. “Inconcluso” es un resultado válido del
  experimento, no autorización para elegir el relato más conveniente.

La conclusión se escribe en este plan y en la bitácora con los valores de las
seis corridas a la vista. Solo después se decide presupuesto o lever siguiente.

#### 3.5 Tests y cierre

Tests mínimos del generador, en `tests/fixtures/generate.test.ts`:

1. produce 200 páginas y header `%PDF-`;
2. dos invocaciones en el mismo proceso producen bytes idénticos;
3. las 200 fuentes de página son distintas;
4. hay exactamente 20 índices de entidad, cada diez páginas, incluido 190;
5. las páginas de entidad contienen Person + DNI y las neutras no contienen DNI;
6. los rótulos usan `de 200`, mientras los tests existentes conservan `de 50`.

El perfil Playwright afirma `cold.ok`/`hot.ok` y
`groupCount >= TEXT_200P_ENTITY_PAGE_INDICES.length` en ambas temperaturas. El
`PIPELINE_READY` de cada corrida y la entidad distribuida hasta el índice 190
evitan considerar completa una medición que no recorrió el documento entero.

**La implementación queda lista cuando**: esos tests y los gates aplicables
están verdes, el perfil opt-in produce un reporte válido en una corrida y el
default de `pnpm test:perf` no lo ejecuta. **Cumplido el 2026-09-13**: 57 tests
scoped verdes, lint/typecheck/Prettier verdes, perfil omitido por default y una
corrida opt-in válida.

**T-3 cierra cuando**: además existen las tres corridas válidas por perfil, el
cuadro comparativo quedó transcripto y el planificador registró una conclusión
estructural/acotada/inconclusa. **Cumplido el 2026-09-13: T-3 cierra como
inconclusa, con la extrapolación lineal descartada.**

### T-4 — Gatear las franjas visualmente blancas de ADR-121 — **CERRADA**

**Dónde**: `ocr-engine` únicamente. **ADR**: 161 + **162**. **Contrato**: no
cambia. ADR-162 cierra la ambigüedad que impedía entregar ADR-161: T-4 no usa un
umbral de luminancia ni densidad; saltea solo una franja demostrablemente blanca.

> **El modo de falla es asimétrico y define la forma del gate**: saltear una
> franja con un sello es una **fuga de datos**; correr una franja vacía es tiempo
> y memoria. Por eso cualquier píxel visible distinto de blanco —aunque tenga
> `alpha = 1` o un único canal en 254— conserva las dos pasadas. Ruido, fondo
> gris o incertidumbre también conservan el camino anterior.

Hoy las cuatro pasadas rotadas corren **siempre**, sin condición. El propio
ADR-121 dice que sobre un documento sin texto rotado *"las cuatro pasadas
producen 4 candidatas y entran 0. Lo único que cambia ahí es el reloj"* — no es
lo único: son 4 de las 6 operaciones de Tesseract por página, y cada
`SetImageFile` materializa una copia dentro del heap de WASM
(`thresholder.cpp`: `pix_ = src.copy()`).

#### 4.1 Propiedad exacta

Una franja es blanca si cada píxel tiene `alpha = 0` o RGB `(255,255,255)`.
No hay porcentajes ni constantes configurables. Se inspecciona el `ImageData`
de cada franja una vez, antes de sus rotaciones 90°/270°:

| márgenes | llamadas `recognize` de margen | `recognize` totales | operaciones con OSD |
|---|---:|---:|---:|
| ambos blancos | 0 | 1 | 2 |
| uno activo | 2 | 3 | 4 |
| ambos activos | 4 | 5 | 6 |

El fallo del predicado abre la compuerta. Un fallo posterior de la franja
conserva el guard de ADR-121; una cancelación se propaga. La regla de fusión,
`MARGIN_STRIP_RATIO`, `ROTATED_MIN_CONFIDENCE`, geometría y salida no cambian.

#### 4.2 Tests que cierran la implementación

1. blanco opaco y transparente con RGB no blanco: cero llamadas de margen;
2. un solo píxel opaco `(254,255,255)`: dos llamadas;
3. un solo píxel negro con `alpha = 1`: dos llamadas;
4. izquierda blanca + derecha activa: exactamente dos llamadas de margen;
5. dos franjas activas: palabras, confianza, cajas y fusión idénticas al camino
   previo;
6. una excepción del predicado conserva ambas pasadas;
7. el test de blanco cuenta llamadas — afirmar solo salida vacía no discrimina
   contra el código anterior (ADR-149 §2).

**Cierra implementación cuando**: los tests anteriores y los gates scoped de
`ocr-engine` están verdes, sin cambios fuera del módulo. La medición P2 posterior
dimensiona memoria/tiempo, pero no decide la seguridad de la compuerta ni es
necesaria para demostrar que el trabajo se eliminó.

**Cumplido el 2026-09-13**: implementado exclusivamente en `ocr-engine`; 137/137
tests scoped, typecheck y ESLint del paquete verdes. El caso blanco prueba el
discriminante contando cero llamadas de margen, y el caso fail-open prueba dos
rotaciones de la franja incierta con la otra franja blanca.

#### T-4b — Heurística para márgenes no blancos — **BLOQUEADA**

La calibración más agresiva que proponía ADR-161 queda separada. Requiere la
baseline Chromium/WASM de ADR-147, un escaneo real anonimizado con texto rotado
tenue en el margen y un ADR nuevo que fije fórmula, umbral de píxel y margen
numérico. No forma parte de T-4 y el implementador no deja constantes
provisorias para ella.

### T-5 — OSD compartido — **CERRADA (2026-09-15)**

**Decisión del humano y aceptación final:** se conserva un OSD por Core con
una página de adelanto y dos reconocedores LSTM, bajo el presupuesto de
imágenes de 128 MiB. Se acepta por la mejora temporal observada, aunque no
se haya demostrado ahorro de memoria. No se afirma equivalencia estadística
ni reducción de RSS.

La implementación y los cinco pendientes de validación están resueltos:
drenaje/dispose, reconstrucción, aislamiento, identidad y orden de regiones,
reanálisis por generación y censura/conservación externa en Electron real.
Controles generales verdes: lint, typecheck, 2193 tests con cobertura y
thresholds, 312 tests de contrato y formato. E2E T5 con build fresco: PASS.
Cobertura agregada de OCR, incluidos workers: **93,79 %**.

Evidencia definitiva, artefactos y límites en
[`T5_OSD_Compartido_Cierre_Final.md`](T5_OSD_Compartido_Cierre_Final.md).
El cierre T5 no declara terminada toda la campaña de hardening ni los gates
propios de una release completa.

| Campaña separada P2, 50 páginas | Frío | Caliente |
| --- | ---: | ---: |
| A → B, OSD/adelanto con igual comportamiento histórico de ImageData | −24,0 % | −25,4 % |
| B → C, corrección ImageData que restituye las rotaciones | +5,882 s | +6,099 s |

No extrapolar el primer porcentaje a la versión con márgenes reparados. Las
huellas del P2 coinciden, pero ese fixture no mide el beneficio de recuperar
un sello vertical. Se conservan los datos y las limitaciones de la campaña en
[`T5_OSD_Compartido_Revision_Separados.md`](T5_OSD_Compartido_Revision_Separados.md).

**Continúa por separado:** evaluación y optimización de ImageData desde la
versión funcional aceptada. No se cambia su implementación durante este cierre
ni se revierten capacidades para mejorar artificialmente el reloj. Ver
[`T5_ImageData_Investigacion.md`](T5_ImageData_Investigacion.md),
[`ImageData_Perfilado_Plan.md`](ImageData_Perfilado_Plan.md), su handoff de
perfilado [`ImageData_Perfilado_Handoff.md`](ImageData_Perfilado_Handoff.md)
y los resultados de ese perfilado
[`ImageData_Perfilado_Resultados.md`](ImageData_Perfilado_Resultados.md).
El perfil está hecho. Las dos candidatas del plan original quedaron
descartadas **por medición** (0,54 % y 3,2 % del costo de margen). La campaña
posterior de márgenes eligió I-1 —no leer una franja cuya tinta ya está
explicada por palabras reconocidas—, la implementó y la conservó tras una
medición A/B reproducible: **6,234 s de ahorro neto medio de OCR por 50 páginas
P2**, con huella de calidad idéntica y el sello conservado. La decisión y sus
límites están en
[`Margenes_Menos_Pixeles_Plan.md`](Margenes_Menos_Pixeles_Plan.md) §9 y
[`Margenes_Menos_Pixeles_Medicion_I1.md`](Margenes_Menos_Pixeles_Medicion_I1.md).

Las alternativas de prepasada completa y dos páginas de adelanto permanecen
registradas y no seleccionadas en
[`T5_OSD_Investigacion_Scheduling.md`](T5_OSD_Investigacion_Scheduling.md).
Los handoffs e informes anteriores son historial, no instrucciones pendientes.

### T-6a — DPI adaptativo — **CERRADA (ADR-163)**

**Sin costo de calidad: es aritmética, no criterio.** Hoy
`scale = ctx.config.ocr.dpi / 72` es fijo **sin mirar la página**. Si la imagen
embebida de un escaneo está a 200 dpi, rasterizar a 300 la **sobremuestrea**:
2,25× más memoria por cero información nueva. Pasa a rasterizarse a
`min(dpi configurado, resolución nativa de la imagen embebida)`.

Es un **punto fijo**: no hay umbral que elegir ni concesión que aceptar — o la
página trae la resolución o no la trae, y si no la trae se usa el `dpi`
configurado como hoy.

**Especificación cerrada el 2026-09-13.** El borrador anterior no decía de
dónde salía la resolución, qué ocurría con contenido compuesto ni cómo evitar
desacoplar el raster de la conversión de cajas. ADR-163 lo restringe al caso
demostrable y común: página `requiresOCR` cuyo único contenido pintado es un
ráster con dimensiones nativas válidas. `pdf-engine` publica el cap opcional
`Page.ocrDpiCap`; el Orchestrator usa por request la pareja inseparable
`effectiveDpi`/`scale = effectiveDpi / 72`. Cualquier ambigüedad conserva el DPI
configurado; por defensa del boundary, también lo conserva ante un cap no
numérico, no finito o `<= 0`. Regiones OCR quedan fuera de T-6a.

**Reparto de implementación** (sin mezclar módulos en un commit):

1. `shared`: campo público opcional `Page.ocrDpiCap`;
2. `pdf-engine`: cálculo exacto desde dimensiones de píxel y ejes CTM, sin una
   segunda pasada del operator list;
3. façade: DPI, estimación y escala por descriptor; ningún cambio en OCR ni
   Render.

**Cerrada el 2026-09-13.** Los tests discriminantes de ADR-163 quedaron verdes
en los tres scopes, incluidos fallback por contenido compuesto, cap inválido y
dos páginas con escalas independientes. Verificación: 508/508 tests afectados,
2157/2157 globales, 311/311 contract tests, typecheck global, ESLint scoped y
Prettier. Una medición P2 caracteriza magnitud en T-6b, pero no condiciona este
cierre funcional.

**No se puede dimensionar con el fixture actual** (§4): cuánto rinde depende de
la resolución de los escaneos reales, y el fixture es sintético. Eso no bloquea
implementarlo — bloquea estimarlo de antemano.

### T-6b — La curva de calidad contra DPI — **en pausa por decisión del humano (2026-09-17)**

Distinta de T-6a y posterior. **No cambia código de producto**: mide, sobre el
corpus de ADR-147, cuánto cae la calidad de detección a medida que baja el DPI
(300 / 250 / 200 / 150). El producto es una curva, no una decisión.

> **Decisión del humano: son dos pasos, y en este orden.** Primero T-6a, que es
> un punto fijo sin concesiones. Después esta medición, **y recién con la curva
> en la mano se decide** si se baja el DPI por default y hasta dónde. Sin la
> curva, bajar el DPI sería aceptar una pérdida de calidad sin saber cuánta — que
> es exactamente lo que ADR-154 §1 y ADR-126 §2 prohíben.

**Decisión posterior:** se conserva `config.ocr.dpi = 300` y no se impulsa una
reducción general a 250/200/150 DPI. La curva T-6b queda en pausa mientras esa
preferencia siga vigente. Esto no revierte T-6a: en páginas completas formadas
por un solo ráster cuya resolución nativa comprobable sea menor, ADR-163 usa
`min(300, ocrDpiCap)`; las regiones OCR y los casos ambiguos siguen a 300.
Forzar 300 **efectivos** también sobre un ráster fuente de menor resolución
sería una decisión distinta, con una comparación de calidad propia antes de
cambiar ADR-163.

---

### T-7 — De qué está hecha la línea de base caliente — **CERRADA (2026-09-17)**

**Dónde**: `tests/` únicamente. **ADR**: ninguno; no cambia producto. **La
desbloquea**: el instrumento arreglado, cerrado el 2026-09-17. **Plan detallado
y protocolo**: [`Perfilado_Base_Caliente_Plan.md`](Perfilado_Base_Caliente_Plan.md),
que además fija la hipótesis principal: la base caliente se toma con un techo de
30 s (`HOT_BASELINE_SETTLE_CEILING_MS`) y el pool libera por inactividad a los
60 s (`idleDisposeMs`, ADR-080), así que **ninguna medición de la campaña vio
nunca esa liberación**.

> **Cerrada con resultado** (`Perfilado_Base_Caliente_Medicion.md`, 12 corridas
> válidas): **casi todo se libera solo**. P1 cae de 1506,0 a 583,9 MB y P2 de
> 1393,7 a 366,1 MB al extender la observación a 120 s — cerca de la base fría de
> ~420 MB. El «piso irreducible» que la pregunta suponía no aparece, y el hueco
> de §1bis queda disuelto.
>
> Refinamiento del informe, que conviene no perder: el escalón único cerca de los
> 60 s describe bien el caso de un solo pool (P1 sin NER: −76,3 / −76,1 /
> −76,2 MB, tres corridas casi idénticas), pero **solo 6 de 12 corridas tienen
> ahí su paso mayor**; el resto libera antes. Es compatible con que cada pool
> tenga su propio reloj anclado a su último job, y el informe lo deja como
> lectura de la forma de la curva, **no verificado**: el arnés no persiste
> `OCR_FINISHED`/`NER_FINISHED` después del cierre.
>
> **Lo que queda abierto no es un residuo, es un reloj**: la liberación funciona
> pero llega tarde para quien encadena documentos en menos de un minuto. Elegir
> qué hacer con eso es decisión del humano, con su propio ADR (ADR-154 §1/§5).

**Pregunta**: de los 1,7–2,2 GB que la aplicación retiene después de cerrar un
documento (§1bis), ¿cuánto se libera solo y cuánto es piso irreducible?

Tres cortes, todos medibles con el instrumento actual:

1. **Esperar más allá del `idleDisposeMs` de 60 s** con el documento ya cerrado,
   muestreando. El pool libera sus workers por inactividad (ADR-080) y el de OCR
   se da de baja al terminar su etapa (ADR-157). Si la base cae al pasar ese
   umbral, el lever es de ciclo de vida y el número dice cuánto vale.
2. **Atribuir por proceso** lo que quede: Tab, GPU, Browser y Utility ya se
   registran por separado. Un piso que viva en GPU no se ataca igual que uno del
   renderer.
3. **Comparar con NER deshabilitado**, que es el corte más limpio disponible sin
   tocar producto: separa el modelo residente del resto del piso.

**Cierra cuando** cada uno de los tres cortes tenga su número con sus tres
corridas y el reporte diga **qué fracción de la base caliente es recuperable y
qué fracción no**. No decide ninguna optimización: entrega la atribución que hoy
falta para poder elegir un lever.

**Límite declarado de entrada**: M2 se mueve con la presión de memoria del
sistema (`Instrumento_De_Memoria_Arreglo_Plan.md` §1), así que las
comparaciones válidas son entre condiciones medidas en la misma sesión y con la
presión registrada. No comparar contra tandas anteriores al 2026-09-17: no
tienen ese dato.

## 2bis. Cómo se corre una medición sin arruinarla

Reglas operativas aprendidas a costa de tandas perdidas el 2026-09-12. Ninguna es
obvia y las tres costaron tiempo real.

1. **Una sola medición por vez.** Dos instancias de Electron haciendo OCR en
   paralelo se contaminan mutuamente y las dos quedan inservibles — pasó, y costó
   una tanda entera. Antes de lanzar: `pgrep -f "[p]laywright test --config"`. Si
   algo parece colgado, **matalo explícitamente**; nunca lanzar otra corrida
   encima.
2. **`pgrep -f "patrón"` se matchea a sí mismo.** Un bucle de espera cuya propia
   línea de comando contiene el patrón nunca sale: se ve a sí mismo y concluye que
   el proceso sigue vivo. Colgó dos esperas ocho minutos sobre un test ya
   terminado. Usar `[p]atrón` (el corchete evita el auto-match) o, mejor, el
   código de salida del comando en vez de sondear.
3. **No correr vitest mientras hay una medición en vuelo.**
   `tests/fixtures/generate.test.ts` verifica el determinismo del generador de
   fixtures, que escribe en `.measure/fixtures/`: dos corridas simultáneas le dan
   un rojo falso.
4. **Nunca mezclar versiones del instrumento entre el "antes" y el "después".**
   Es lo que dejó el M2 de ADR-158 sin atribución limpia. Si el instrumento
   cambió, la línea de base se vuelve a tomar.
5. **El fixture de P2 no es determinístico**: produce un hash distinto por
   corrida, así que se regenera cada vez y la corrida tarda de más. Está fuera de
   alcance de esta campaña; no sorprenderse.
6. **Cada corrida PISA la anterior.** `writeReport` escribe en
   `.measure/memory-<perfil>-run<N>.json`, nombre fijo: la medición del "después"
   destruye la del "antes". Pasó con la línea de base de T-1, que solo sobrevive
   porque sus números estaban transcriptos en ADR-160 §6 y en este plan antes de
   que se sobrescribiera. **Antes de medir un "después", copiar los JSON del
   "antes" a otro nombre** — y, en cualquier caso, transcribir las cifras a un
   documento: `.measure/` está gitignoreado y no es un archivo histórico.

## 3. Lo que no se vuelve a mirar

Descartado con medición o con código. Reabrir cualquiera de estos necesita
evidencia nueva, no una idea nueva.

| | por qué |
|---|---|
| Chunkear los rásters de OCR | ADR-143: ya son 2 páginas vivas, no 20 |
| Listeners de abort acumulándose | H-09C, cerrado (`worker-pool.ts`, `settled` + `cleanup()`) |
| Píxeles crudos en la caché de preview | ADR-156 |
| `renderPoolSize` | bitácora §5.1, bajo el ruido, y la premisa erraba por dos órdenes |
| `pageProxy.cleanup()` / `PDFDocumentProxy.cleanup()` | bitácora §5.2, y el `NUM_PAGES_THRESHOLD = 2` cierra la puerta |
| Escala de grises para la entrada de OCR | bitácora §5.3: tesseract.js no acepta píxeles |
| `nerPoolSize` | bitácora §5.4: el segundo worker no existe |
| Bajar el paralelismo en general | ADR-154 §1, decisión del humano |
| El `angle` de `SetImageFile` para rotar | ADR-160 §4 del Contexto |

---

## 4. El límite que arrastra todo: el fixture no es un escaneo

El fixture de P2 pesa **1,71 MB para 50 páginas** = 35 KB/página, generado
rasterizando texto limpio. Un expediente escaneado real —JPEG, ruido, grises—
pesa 10-50× más. Dos consecuencias:

1. Las copias del buffer del PDF que la bitácora §5.1 descartó por costar 5,1 MB
   costarían ~200 MB con un archivo real. El descarte es correcto **para el
   fixture**, no para el producto.
2. Tesseract trabaja mucho más sobre una página con ruido (más componentes
   conexos), así que el costo por página real es otro.

**Conseguir un PDF escaneado real anonimizado como perfil P4 cambia cuáles de
estos levers importan.** No bloquea T-1 a T-4; sí bloquea dimensionar T-6.

---

## 5. Decisiones y pendientes del humano

1. **T-6b en pausa**: se conserva la configuración de 300 DPI por preferencia
   del humano del 2026-09-17; no se propone bajarla sin reabrir la decisión.
   La evaluación posterior de ImageData es un trabajo separado. Aumentar el
   número de reconocedores también requiere su propia decisión.
2. **El presupuesto**: la alternativa A de la bitácora §7.1 (reemplazar los
   ~1600 MB estimados de `07_Performance_Strategy.md` §7 por componentes
   medidos) sigue disponible, pero **sobre números nuevos** — los de hoy salen
   del instrumento que ADR-159 acaba de degradar para este uso.
3. **La alternativa B de la bitácora** (reciclar los workers de Tesseract a mitad
   del documento) **no se recomienda arrancar todavía**: apostaba entera a la
   hipótesis del heap, y ADR-159 §3 le sacó la mitad del peso. Se re-evalúa con
   lo que midan T-1 y T-2.
4. **Precargar NER durante el OCR: descartado el 2026-09-17, decisión tomada.**
   Era una idea de velocidad, pero el costo que midió fue de memoria: el disparo
   temprano subió el pico de RSS **144–422 MB en las tres rondas**, por encima
   de la dispersión de sus propios controles en cada una, y sin una mejora
   estable de `import→Ready`. Va en dirección contraria a ADR-157, que da de
   baja el pool de OCR para que Tesseract y ONNX no convivan. El descarte está
   anotado en el lever 3 de ADR-154 §2, con la evidencia en
   [`Precalentamiento_NER_Durante_OCR_Medicion.md`](Precalentamiento_NER_Durante_OCR_Medicion.md)
   §7. No se reabre sin un `modelLoadMs` materialmente mayor o un banco menos
   ruidoso.

## 6. Trabajo posterior al hardening

El humano prevé migrar el contenedor Electron a Tauri **después de terminar
hardening**, con el objetivo de reducir su costo de recursos. Se registra en
[`Future Ideas §2.5`](Future_Ideas.md#25-migración-electron--tauri-después-del-hardening).
No se inicia esa migración durante T-5 ni se usa un ahorro hipotético del shell
para aceptar métricas actuales del Core.
