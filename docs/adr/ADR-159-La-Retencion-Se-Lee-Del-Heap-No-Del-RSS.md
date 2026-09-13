<!-- CONTEXT: scope=adr | dependencias=architecture/07_Performance_Strategy.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-155-El-Arnes-De-Medicion-Configura-El-Core-Por-Un-Canal-Propio.md,adr/ADR-157-El-Pool-De-OCR-Se-Da-De-Baja-Al-Terminar-Su-Etapa.md,adr/ADR-158-El-Raster-De-OCR-Viaja-Codificado.md,roadmap/H-10_Bitacora_De_Memoria.md | audiencia=humanos+IA | fase=11 -->

# ADR-159 — La retención se lee del heap, no del RSS

- **Estado**: Accepted
- **Fecha**: 2026-09-11
- **Decidido por**: El planificador, sobre un re-análisis de los datos que ya
  existían. No hace falta una corrida nueva para tomarlo.
- **Relacionado con**: ADR-146 (las dos métricas, que **no** cambian), ADR-154 §2
  levers 4 y 5 (el reparto Tab/GPU que este ADR corrige), `H-10_Bitacora_De_Memoria.md`
  §7 (el "residuo no localizado")
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. El número que sostiene §7 no sobrevive a su propio dato

`H-10_Bitacora_De_Memoria.md` §7 declara, como hecho medido, **2,4 – 4,2 MB por
página acumulándose en el proceso del renderer**, y construye sobre eso la
extrapolación a 200 páginas (~2,0 a ~2,4 GB) que decide si el trabajo de memoria
es cosmético o estructural.

Re-corrido el mismo cálculo sobre los mismos archivos
(`.measure/memory-p2-scanned-50p-run{0,1,2}.json`, corridas calientes, ventana
`OCR_STARTED → OCR_FINISHED`), la regresión reproduce exactamente los valores
publicados — **−1,58 / +4,46 / +1,95** MB/página en Tab, la fila "Después" de
§5.2 — así que el método es el mismo. Lo que no se había mirado son los
intervalos:

| corrida | pendiente Tab | IC 95 % | R² |
|---|---|---|---|
| run0 | **−1,58** MB/pág | ±1,21 | 0,04 |
| run1 | **+4,46** MB/pág | ±0,67 | 0,50 |
| run2 | **+1,95** MB/pág | ±0,81 | 0,12 |

**Los tres intervalos son disjuntos.** Tres estimaciones ajustadas, precisas
cada una, que se contradicen entre sí: la firma de una varianza entre corridas
que domina al efecto, no la de un efecto medido tres veces.

Y el motivo es visible en el dato crudo: dentro de la ventana de OCR el RSS de
Tab oscila **430 – 660 MB**. La señal que se busca (~250 MB en total) es más
chica que el diente de sierra sobre el que se ajusta la recta.

### 2. Por qué el RSS no puede contestar la pregunta

| corrida | línea de base | pico |
|---|---|---|
| run0 | 1114 MB | **1805 MB** |
| run1 | 1359 MB | 1689 MB |
| run2 | 1577 MB | 1789 MB |

La corrida con la base **más baja** tiene el pico **más alto**. Es el mismo
efecto que ADR-146 §7 ya encontró para M1 y que le costó la degradación a "cota
inferior": **con memoria residente libre por dentro, el recolector corre menos y
el RSS sube; con memoria apretada corre más y el RSS queda plano.**

La consecuencia que no se había sacado: eso no afecta solo al nivel, afecta a la
**pendiente**. Una pendiente de RSS mide la mezcla de dos cosas —lo que se
retiene y cuánta pereza se permite el recolector— y no hay forma de separarlas
desde afuera. **El RSS no es un observable válido para "¿se está reteniendo algo
por página?".**

### 3. El estadístico que sí sirve: el piso

Lo que de verdad queda retenido es el **piso** de la señal, no su nube: el nivel
al que el proceso vuelve después de recolectar. Medido como mínimo del primer
cuarto de la ventana contra mínimo del último cuarto:

| corrida | Tab | GPU | Tab + GPU |
|---|---|---|---|
| run0 | +115 MB (**+2,29**/pág) | +58 MB (+1,15/pág) | +3,44/pág |
| run1 | +243 MB (**+4,86**/pág) | +153 MB (+3,06/pág) | +7,92/pág |
| run2 | +76 MB (**+1,53**/pág) | +157 MB (+3,13/pág) | +4,66/pág |

**Positivo 3 de 3 en los dos procesos.** Dos lecturas:

1. **La acumulación es real y el rango de §7 es correcto.** +1,5 a +4,9 MB/página
   en Tab. El número sobrevive; lo que no sobrevive es la regresión que lo
   sostenía. Que sea 3/3 por el piso vale más que un R² de 0,04–0,50 sobre la
   nube entera.
2. **El reparto entre procesos de §7 está mal.** Dice que *"el renderer explica
   el 73-81 % de la pendiente; GPU es secundario y por debajo del ruido en 2 de
   3 corridas"*. Por el piso, **GPU sube 3/3 también**, y en run1/run2 sube tanto
   o más que Tab. Ese 73-81 % salió de la regresión sobre el diente de sierra.

El punto 2 no es un detalle de contabilidad: **GPU no puede ser el heap de
Tesseract**, que vive en Tab. Lo que hay en GPU son backing stores de canvas. Así
que la hipótesis de §7 —la marca de agua del heap de WASM, "irreducible dentro de
una corrida"— explica **como mucho la mitad** del fenómeno, y la otra mitad es
código nuestro.

> **Ampliado el 2026-09-12 con tres corridas nuevas sobre `main`** (las de arriba
> eran de la rama del spike descartado, §4). Mismo cálculo, misma fase:
>
> | corrida | Tab | GPU |
> |---|---|---|
> | run0 | +206,1 MB | +152,8 MB |
> | run1 | +243,3 MB | +40,9 MB |
> | run2 | **−4,7 MB** | +141,3 MB |
>
> **Sobre las seis corridas disponibles: GPU da positivo 6 de 6; Tab, 5 de 6.**
>
> Dos consecuencias, y la primera me corrige:
>
> 1. **El piso tiene más varianza entre corridas de la que le atribuí.** run2 pasó
>    de +76 a −4,7 MB. "Positivo 3 de 3" era cierto de ese trío, no una propiedad
>    estable. La afirmación honesta ahora es **5 de 6 en Tab**, que sigue siendo
>    evidencia de retención pero más débil de lo que decía este ADR.
> 2. **El hallazgo de GPU, en cambio, se refuerza**: 6 de 6, en dos tandas
>    separadas por días y por una rama. El retiro del "73-81 % es Tab" queda más
>    firme que cuando se escribió, no menos.
>
> Lo que **no** se afirma: por qué cambiaron los valores de Tab entre tandas. Entre
> medio está ADR-158 (ya en `main` en las dos), y no hay A/B controlado. Se registra
> como hallazgo, no como causa — el error que §6 de la bitácora advierte.

> **Tercera tanda, 2026-09-12, con la versión final del instrumento** — Tab
> +132,3 / +146,7 / **−27,9** MB; GPU +161,1 / **+6,5** / +46,4 MB. Sobre las
> **nueve** corridas disponibles: **Tab 7 de 9 positivo, GPU 9 de 9**.
>
> El signo de GPU es robusto; su **magnitud no lo es** — va de 6,5 a 161 MB entre
> corridas del mismo binario. La lectura honesta es **"GPU acumula"**, no "GPU
> acumula N MB por página". Cualquier número por página que se cite del piso es
> una corrida, no una constante.
>
> **Y de acá sale el hallazgo de método más útil de esta tanda**: el piso y el
> pico miden cosas distintas y no son intercambiables. En estas mismas tres
> corridas, el **pico** dentro de la ventana de OCR tiene dispersión de ±6-7 %
> (Tab 1149,7 / 1022,6 / 1165,4 MB; GPU 451,6 / 479,6 / 517,7 MB) mientras el
> piso cambia de signo. No es que uno sea mejor: **el piso mide retención, el
> pico mide el costo transitorio.** Un lever que saca algo retenido se evalúa
> con el piso; uno que saca algo transitorio —como ADR-160, que elimina canvas
> que nacen y mueren dentro de la página— se evalúa con el pico. Elegir el
> estadístico por el lever, no por costumbre, es parte de §3.

### 4. Procedencia de los datos, y su límite

Los tres archivos analizados son las corridas de la rama del spike de
`pageProxy.cleanup()` (§5.2: mismos picos 1805,3 / 1688,6 / 1789,1). Ese spike se
descartó **por medir como no-op** en pico y en pendiente, así que los archivos
son una caracterización válida del comportamiento vigente. Las corridas previas
al spike ya no están en `.measure/`. Recalcular el piso sobre `main` es parte de
la primera tarea, no un pendiente suelto.

## Decisión

### 1. ADR-146 no cambia

M1 y M2 siguen siendo lo que son —lecturas de RSS, con M1 como cota inferior— y
siguen siendo las métricas contra las que se declara el presupuesto. Este ADR no
toca los presupuestos ni cómo se reportan.

### 2. La atribución por componente se lee del heap por target, no del RSS

Cuando la pregunta es **de qué está hecha** la memoria, o **si algo se retiene
por página**, la respuesta se lee del heap de cada target por separado —hilo
principal, cada worker nuestro, y cada worker de tesseract.js— vía CDP, con
recolección forzada antes de cada lectura. Eso separa heap de JS, memoria de
WASM y backing stores de canvas sin estadística de por medio.

Es instrumento, no producto: vive en `tests/`, igual que los arreglos de ADR-146
§7bis, y **no necesita ADR propio para cada lectura que agregue**.

### 3. Ninguna afirmación de acumulación por página se hace con la regresión cruda

El estadístico es el **piso** (mínimo de una ventana inicial contra mínimo de una
ventana final, sobre la misma fase), y se reporta con las corridas individuales a
la vista, nunca promediadas. Una regresión sobre la nube completa de RSS no se
publica como pendiente de acumulación.

### 4. El reparto 73-81 % Tab/GPU se retira

`H-10_Bitacora_De_Memoria.md` §7 y ADR-154 §2 lever 5 quedan corregidos: por el
piso, Tab y GPU aportan en el mismo orden de magnitud. **D3-d (los canvas del
proceso GPU) deja de estar postergado por falta de evidencia** — la evidencia
existía y se estaba leyendo con el estadístico equivocado.

### 5. La extrapolación a 200 páginas se recalcula

Con Tab + GPU: 200 × 3,4-7,9 MB = **680 – 1580 MB** de aporte, contra los
480-840 MB que §7 estimaba con Tab solo. Sigue siendo extrapolación, no
medición: la medición es el perfil de 200 páginas, y este ADR sube su prioridad
en vez de bajarla.

### 6. Un target ocupado en WASM síncrono no se lee, y eso se acepta

**Medido el 2026-09-12**, con dos Web Workers sintéticos y el módulo real de
lectura (sin OCR, sin PDF, ~10 s): un worker adentro de un bucle síncrono de
4000 ms **no procesa ningún mensaje de CDP** —ni `HeapProfiler.enable`— hasta
que cede el control. El worker ocioso de al lado se leyó bien (+20,00 MB
aislados, exactamente lo que retenía) y el hilo principal también.

Es una propiedad del mecanismo, no un defecto: un hilo ocupado no es
inspeccionable desde afuera sin pausarlo. Y los workers de tesseract.js están
ocupados casi toda la ventana de OCR (seis pasadas por página × 50 páginas). Es
esperable que valga igual para los de NER mientras infieren.

**La decisión: se acepta la lectura rala, y NO se pausa ningún target ni se
agrega un hook en producción para esquivarla.** Tres razones:

1. **Para una magnitud monótona, muestrear ralo no pierde nada.** La memoria
   lineal de WASM **solo crece** (lo dice la propia §7 de la bitácora, y es lo
   que hace que terminar la instancia sea la única forma de devolverla). Leerla
   en N puntos sueltos reconstruye su curva de crecimiento igual que leerla
   continuamente.
2. **El hueco entre páginas es el mejor momento para leer, no el peor.** El
   estadístico de §3 es el **piso**, y una lectura que cae justo cuando el worker
   terminó una página y todavía no empezó la siguiente es exactamente el piso.
   La lectura rala no degrada este estadístico: lo muestrea donde importa.
3. Pausar el target cambiaría lo que se mide (el timing es parte del fenómeno) y
   un hook en producción para esto sería instrumentación filtrándose al producto.

**Lo que sí es obligatorio: declarar la cobertura.** Cada target reporta, por
fase, cuántas lecturas se intentaron y cuántas respondieron. Un target leído
pocas veces se reporta así —"sin lectura, ocupado, N de M"— y **nunca** se
promedian sus pocas lecturas hasta que parezcan un número limpio. Es el mismo
criterio de §3: el instrumento tiene que poder decir "no pude", y eso vale más
que un promedio prolijo sobre tres muestras.

### 7. La condición que hace válido todo lo anterior, y hay que verificarla

Todo esto sirve **solo si la memoria lineal de WASM es visible** en los campos
que se leen. `usedSize`/`totalSize` de `Runtime.getHeapUsage` son el heap
gestionado de V8 —objetos, closures, strings— y **no** incluyen el backing store
de un `ArrayBuffer`; el candidato es `backingStorageSize`.

Que un `ArrayBuffer` retenido aparezca ahí ya se midió (§6). Que **la memoria de
un `WebAssembly.Memory` aparezca ahí no se midió todavía**, y no se asume: es la
diferencia entre un instrumento que ve el heap de Tesseract y uno que mira para
otro lado con números que igual parecen razonables.

**Se verifica antes de dar por bueno cualquier número de una corrida real.** Si
resulta que no es visible por esta vía, el instrumento contesta una pregunta
distinta de la que ADR-159 §2 quiere contestar, y la decisión vuelve al
planificador.

### 8. Verificado el 2026-09-12: **no es visible.** Qué mide entonces el instrumento

Medido con el módulo real, adentro de un Worker: tras `new WebAssembly.Memory({ initial: 320 })`
(20 MB, todas sus páginas escritas) y después de un `.grow(160)` (10 MB más), los
**cuatro** campos de `Runtime.getHeapUsage` quedaron **idénticos** — `usedSize`
0,275 MB, `totalSize` 0,786 MB, `embedderHeapUsedSize` 0,018 MB,
`backingStorageSize` 0,001 MB. Un `ArrayBuffer` corriente **sí** se ve en
`backingStorageSize` (§6), así que no es un problema de aislamiento ni de la
sesión: **la memoria lineal de WASM es invisible para `Runtime.getHeapUsage`.**

Eso deja al instrumento sin poder leer directamente el heap de Tesseract, que es
justo la mitad que §3 le dejó a la hipótesis del heap. **No se fuerza.** Se
redefine qué mide, y se declara:

1. **Lo que sí mide, y con precisión**: por isolate, el heap de objetos de V8 y
   los backing stores de `ArrayBuffer`/canvas/strings. Eso responde
   —limpiamente, por target— **"¿acumula el lado JS/canvas, y en cuál?"**
2. **Lo que ya medía**: RSS por proceso, que sigue siendo la métrica de nivel
   (ADR-146, sin cambios).
3. **Lo que pasa a reportarse explícitamente**: el **residuo**, `RSS del proceso −
   Σ(isolates leídos)`, rotulado **"no atribuido (WASM + nativo)"**. Nunca
   omitido, nunca implícitamente cero. Es una cota, no una medición, y se reporta
   como tal.

**La consecuencia de plan, y es la que importa:** el instrumento **alcanza para
validar ADR-160** —que saca `ImageData` y canvas, o sea exactamente lo que
`backingStorageSize` y el RSS del proceso GPU sí capturan— y **no alcanza para
zanjar la marca de agua del heap de WASM**. Así que T-1 deja de ser un
prerrequisito de esa pregunta y pasa a ser lo que habilita medir T-2. La pregunta
del heap de WASM queda abierta, con su vía directa anotada abajo y sin tomar.

**Vía directa, no tomada**: leer `TessModule.HEAPU8.buffer.byteLength` con
`Runtime.evaluate` en la sesión del worker de tesseract.js daría el número exacto
—depende de que ese símbolo sea alcanzable desde el scope global de ese worker,
que no está verificado— y su alternativa, `HeapProfiler.takeHeapSnapshot`, es
demasiado cara para muestrear y distorsionaría lo que mide. Ninguna se intenta
dentro de T-1.

## Consecuencias

**A favor**

- Convierte el hallazgo central de H-10 de un argumento estadístico frágil en uno
  robusto, **sin perder el número**: la acumulación es real, y el rango publicado
  era correcto por casualidad de método, no por suerte de resultado.
- Desbloquea un lever que estaba parado por una conclusión mal derivada (los
  canvas en GPU), y le saca la mitad del peso a una hipótesis que declaraba el
  problema irreducible.
- El instrumento que pide es más barato que seguir acumulando corridas: bajar el
  error de la regresión por debajo de 50 MB pedía del orden de cincuenta corridas
  por condición (§6 hallazgo 1). Una lectura de heap con GC forzado no necesita
  ninguna.

**En contra**

- Invalida lecturas publicadas. El 73-81 % circuló en dos documentos y en un ADR
  aceptado; corregirlo cuesta una pasada por los tres.
- El instrumento nuevo tiene su propia forma de mentir —un GC forzado no es
  gratis y cambia el timing de lo que mide— y eso hay que verificarlo ejecutando,
  no leyéndolo (precedente: los tres defectos de instrumento de §4, ninguno de
  los cuales se manifestó como error).
- No cierra la pregunta de §7. Dice con qué se contesta, no la contesta.

**Lo que no toca**: los presupuestos de `00_Project_Vision.md` §7, las métricas
M1/M2 de ADR-146, ni una línea de `packages/`.
