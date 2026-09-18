<!-- CONTEXT: scope=roadmap-plan | tarea=T-8 | dependencias=roadmap/Verificacion_Liberacion_NER_Medicion.md,roadmap/Optimizacion_De_Memoria_Plan.md,adr/ADR-166-El-Modelo-De-NER-Se-Libera-Al-Terminar-La-Deteccion.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-153-El-Gate-De-Tiempos-Se-Mide-Sobre-El-Producto.md,adr/ADR-149-Un-Gate-Que-No-Ejecuta-Nada-Es-Rojo.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md,roadmap/Instrumento_De_Memoria_Arreglo_Plan.md,tests/perf/README.md | audiencia=planificador+implementador+humano | fase=11 -->

# T-8 — A/B intercalado: medir dos versiones del código en la misma sesión

> **Ejecutada el 2026-09-18, en dos sesiones.** Resultado y datos en
> [`AB_Intercalado_Medicion.md`](AB_Intercalado_Medicion.md); la decisión que salió
> de ahí es **ADR-167**. Dos cosas se agregaron sobre la marcha y no estaban en este
> plan: un **tercer brazo C** (temporizador de 15 s solo para NER), pedido por el
> humano después de la primera sesión, y una **espera de revisión configurable**
> entre documentos (`ANONLY_AB_GAP_MS`), que fue la que destapó la recarga muda.
> El Paso 0 (§2ter) salió negativo. Este plan queda como registro de lo que se
> comprometió antes de medir.

**Es una medición, no un cambio.** Todo el trabajo vive en `tests/`. No decide si
ADR-166 se conserva o se revierte: produce el número que hoy falta para que esa
decisión sea del humano y no de una corazonada.

## 1. La pregunta

¿La baja del modelo de NER al cerrar la detección (ADR-166) **baja** el punto de
reposo de la aplicación, lo **sube**, o **no lo mueve**?

La primera tanda de verificación
([`Verificacion_Liberacion_NER_Medicion.md`](Verificacion_Liberacion_NER_Medicion.md))
no pudo contestarla: midió las dos versiones en campañas separadas por horas, con
el banco en regímenes de memoria distintos, y con una dispersión intra-condición
de 255 MB contra una diferencia a explicar de ~380 MB.

## 2. Por qué intercalado, y por qué no hay atajo

El RSS de esta aplicación depende del estado del sistema en el momento de medir
(`Instrumento_De_Memoria_Arreglo_Plan.md` §1, ADR-146 §7ter). Dos consecuencias:

1. **Los absolutos no se comparan entre tandas.** Nunca. Ni con el mismo commit.
2. **Un control solo sirve si es sensible al confound.** El brazo con NER apagado
   parecía validar la comparación entre tandas porque reproducía dentro de 2-3 MB
   — pero reserva ~300 MB y nunca entra en el régimen donde el compresor cambia
   de comportamiento. Ver `Verificacion_Liberacion_NER_Medicion.md` §3.

Si las dos versiones corren **alternadas en la misma sesión**, cualquier deriva
del banco las atraviesa a las dos por igual y la diferencia entre ellas queda
limpia. Es el mismo criterio con el que ya se alternan las condiciones NER on/off
dentro de una campaña, aplicado ahora a dos builds distintos.

No hay forma más barata de contestarlo. Más corridas de una sola versión reducen
el ruido dentro de esa versión, no la distancia entre dos tandas.

## 2bis. El precedente, y qué puede y qué no puede resolver esta campaña

Esto ya se intentó una vez en este repo, y no salió. `tests/perf/README.md`, en
«El método de comparar M2 entre corridas separadas quedó retirado»:

> `renderPoolSize` (4 contra 1), **alternando 3 pares dentro de la misma
> sesión**, con el canal de overrides de ADR-155 — **sin resolución**: −83 MB en
> caliente, +264 MB en frío, cada uno consistente 3/3 en su propia dirección y
> contradictorios entre sí. _«Con n=3, tres de tres en una dirección ocurre una de
> cada cuatro veces por azar puro.»_

O sea: **intercalar no es magia**. Alternar A/B en la misma sesión elimina la
deriva entre tandas, no la dispersión entre corridas. Antes de gastar una hora
hay que decir qué tamaño de efecto este diseño puede distinguir, y comprometerse
a no leer nada más chico.

### El cálculo, hecho antes de medir

De las corridas del 2026-09-17/18, la dispersión intra-condición del punto de
reposo de P1 fue un rango de 255 MB sobre 3 corridas — para n=3 eso da una
desviación del orden de **σ ≈ 150 MB**. La diferencia pareada de dos corridas
independientes tiene σ√2 ≈ 212 MB, y el error estándar del promedio de 6 pares
es 212/√6 ≈ **87 MB**. (El intercalado debería bajar esto, porque parte de la
varianza es de sesión y se cancela dentro del par; se toma la cota pesimista.)

| efecto real | lo que esta campaña puede decir |
| ----------- | ------------------------------- |
| ~380 MB (el que motivó T-8) | ~4,4 errores estándar — **se distingue con holgura** |
| ~250 MB | ~2,9 errores estándar — se distingue |
| ~100 MB | ~1,1 errores estándar — **no se distingue; se reporta sin resolución** |

**Compromiso previo**: por debajo de ~250 MB esta campaña no concluye, y eso se
reporta como «sin resolución» en vez de leerle una dirección al promedio. Es
exactamente el error que la campaña de `renderPoolSize` no cometió y que conviene
no cometer ahora.

### Por qué esto no es el método retirado

Lo que ADR-146 §7 punto 3 retiró es **atribuir memoria restando corridas**: de
dónde sale el consumo se responde dentro de una corrida, por fase. T-8 no
atribuye nada — compara **dos versiones del binario**, que es algo que por
definición no se puede hacer dentro de una sola corrida.

Las tres diferencias con la campaña que fracasó:

1. **El efecto buscado es 4,5 veces más grande** que el que se perseguía allá
   (−83/+264 MB).
2. **Seis pares en vez de tres**, con la resolución declarada de antemano.
3. **Los brazos difieren en una línea**, no en un parámetro que mueve cuatro
   pools a la vez.

Si aun así vuelve «sin resolución», eso **también decide**: significaría que el
efecto de ADR-166 sobre el punto de reposo es más chico que 250 MB, y entonces
~1 s por reanálisis no se paga con nada que podamos medir.

## 2ter. Paso 0 — la sonda: ¿se puede leer el heap de WASM?

**Se corre antes que todo lo demás, con un tope de 20 minutos.** Si sale bien,
T-8 deja de ser una campaña contra el ruido y pasa a tener un número exacto
adentro. Si sale mal, se pierden 20 minutos y la campaña corre como está
planeada.

### La puerta que ya está cerrada

ADR-159 §8 verificó —midiendo, no razonando— que **la memoria lineal de WASM es
invisible para `Runtime.getHeapUsage` de CDP**: con un `WebAssembly.Memory` de
20 MB con todas sus páginas escritas, y después de un `grow()` de 10 MB más, los
cuatro campos quedaron idénticos. Por eso el reporte de `memory.spec.ts` publica
"no atribuido (WASM + nativo)" como **cota, no medición**.

El modelo de NER vive justo ahí. Esa vía no se reintenta.

### Las dos que no se probaron

1. **Que el worker informe su propio heap.** Desde adentro del worker, el tamaño
   de la memoria lineal del módulo de ONNX Runtime es un número exacto y
   determinista (el `byteLength` del buffer), no una estimación del sistema
   operativo. Hay que ver si el runtime lo expone de forma alcanzable sin tocar
   producción; se resuelve con un parche de instrumentación, mismo mecanismo que
   `ner-internal-instrumentation.patch`.
2. **`performance.measureUserAgentSpecificMemory()`**, que desglosa por tipo e
   incluye WebAssembly. Exige `crossOriginIsolated`, y **esta aplicación ya lo
   tiene** (ADR-100/130/132, por `SharedArrayBuffer`). Es lenta —fuerza una
   recolección y puede tardar segundos— así que sirve para tomar dos o tres
   puntos por corrida, no para muestrear una curva.

### Cómo se verifica que la sonda sirve

Con el mismo método que hizo bien ADR-159 §7, que es el único que da derecho a
confiar en un instrumento: **un control discriminante** (ADR-149 §2). Reservar un
`WebAssembly.Memory` de tamaño conocido, escribir sus páginas, crecerlo, y exigir
que el número **se mueva en la magnitud esperada**. Si no se mueve, la vía no
sirve y se descarta por escrito.

Un instrumento que mide mal no tira error: devuelve un número plausible.

### Qué cambia según el resultado

| resultado | efecto sobre T-8 |
| --------- | ---------------- |
| alguna vía funciona | se agrega como métrica a las dos etapas, junto al RSS. La pregunta se parte en dos, y solo una queda ruidosa |
| ninguna funciona | T-8 corre tal cual, con RSS emparejado y la resolución de ~250 MB declarada en §2bis |

En los dos casos **el resultado se escribe**, incluido el negativo: que
`Runtime.getHeapUsage` no ve WASM está documentado desde el 2026-09-12 y evitó que
alguien lo reintentara a ciegas. Lo mismo vale acá.

### Lo que la sonda NO resuelve

Aunque funcione, **no reemplaza al RSS**. Parte la pregunta en dos mitades
distintas:

| pregunta | instrumento | ruido |
| -------- | ----------- | ----: |
| ¿cuánto ocupaba el modelo, y se soltó? | el runtime, exacto | ~cero |
| ¿el sistema operativo devolvió esa memoria? | RSS | alto — se ataca emparejando |

La segunda es la que le importa al usuario, porque es lo que su máquina siente, y
va a seguir necesitando el A/B intercalado. La sonda no ahorra la campaña: la
hace interpretable.

## 3. Los dos brazos

| brazo | qué es |
| ----- | ------ |
| **A** | El código tal como está: `runDetectionStage` invoca `this.engines.ner.releaseIdleWorkers()` en su `finally`. |
| **B** | Idéntico, **menos esa única línea**. La memoria la libera el temporizador de ADR-080 a los 60 s, como antes de ADR-166. |

**B no es revertir el commit de ADR-166.** Los contadores
`activeProcessPages`/`activeProcessPagesBatches`, el `boolean` de
`WorkerPool.releaseIdleWorkers()` y la dedup por ciclo de carga **quedan
idénticos en los dos brazos**. Lo único que cambia es si la baja se invoca o no.
Si se revirtiera el commit entero, una diferencia de memoria no se podría
atribuir a la baja en vez de a cualquier otra cosa que el commit tocó.

El brazo B se materializa como un parche versionado en
`tests/perf/support/ab-sin-baja-ner.patch`, mismo mecanismo que
`ner-preload-ocr.patch` ya usa.

## 4. Mecanismo: dos builds, uno se intercambia

Reconstruir entre corrida y corrida costaría ~12 s cada vez y metería el compilador
en el medio de la campaña. En su lugar:

1. Construir **A** desde el árbol limpio → copiar `apps/react-client/dist` a
   `.measure/ab/<tanda>/dist-A`.
2. `git apply` del parche → construir **B** → copiar a `.../dist-B`.
3. `git apply -R` para dejar el árbol limpio. **El árbol queda en A durante toda
   la campaña**; lo que se intercambia es el `dist`.
4. Antes de cada corrida: `rm -rf apps/react-client/dist && cp -R .../dist-<brazo>
   apps/react-client/dist`.

Solo hace falta intercambiar el `dist` de `react-client`: el shell lo resuelve en
tiempo de ejecución (`apps/desktop-shell/src/paths.ts`) y el Core viaja dentro de
ese bundle.

### 4.1 Esto neutraliza `checkFreshBuild`, y hay que reemplazarlo

`checkFreshBuild.ts` (globalSetup de `playwright.perf.config.ts`) compara la
fecha del `dist` contra la del fuente. Con `cp -R` el `dist` siempre queda recién
copiado, así que **el guard va a pasar siempre**, incluso si se midiera el brazo
equivocado. Ese guard existe porque ya pasó una vez: una campaña entera medida
sobre un `dist` de 5,7 h de antigüedad, con todos los gates en verde.

Se reemplaza por dos verificaciones más fuertes:

1. **Identidad por hash.** Al construir cada brazo se registra el sha256 de cada
   archivo de `dist/assets` y un digest del conjunto. Antes de cada corrida, el
   script recalcula el digest del `dist` activo y **aborta** si no coincide con el
   del brazo que dice estar corriendo.
2. **Discriminante de comportamiento** (ADR-149 §2: un control que no distingue
   las dos versiones no prueba nada). Antes de la campaña, una corrida de
   `memory.spec.ts` por brazo, y se exige:
   - brazo **A**: `phases.NER_MODEL_READY` **presente** en la corrida caliente;
   - brazo **B**: **ausente**.

   Si ese pre-vuelo no separa los brazos, el mecanismo de intercambio está roto y
   la campaña no arranca. Cuesta ~2 min y evita perder una hora midiendo dos
   veces lo mismo.

## 5. Protocolo

**Paso 0**: la sonda de §2ter, con su tope de 20 minutos. Nada se lanza antes.

**Condición de banco**: la campaña corre **sin análisis en paralelo**. Las dos
tandas del 2026-09-18 se tomaron con el agente trabajando encima —el inquilino
más grande de esta máquina: ~35 % de CPU y ~500 MB—, y eso es ruido evitable y
gratis de evitar. Se lanza, se espera, y recién después se mira.

**Perfil**: P1 — 10 páginas de texto nativo, **NER activo**. Es el discriminante:
sin OCR de por medio, la memoria del modelo es prácticamente todo lo que se
mueve. P2 arrastra el residuo de OCR y su señal de NER cambia de signo entre
tandas (`Perfilado_Base_Caliente_Medicion.md` §4.2). El caso de uso real es con
NER encendido, que es además el peor caso — criterio fijado por el humano.

**Etapa 1 — punto de reposo** (`hot-baseline-attribution` reducido a un perfil):

- 1 corrida de calentamiento, brazo A, **descartada por protocolo** (no por su
  resultado): la primera corrida de una sesión arrastra cachés frías.
- 6 pares A/B alternados, arrancando por A: `A B A B A B A B A B A B`.
- Instancia fresca de Electron por corrida, seriales (`workers: 1`, `retries: 0`).
- Ventana de observación de 125 s con los checkpoints ya definidos
  (5/15/30/45/60/75/90/120 s) más las muestras crudas.
- ~2,5 min por corrida → **~35 min**.

**Etapa 2 — pico del segundo documento** (`memory.spec.ts`, P1):

- 4 pares A/B alternados, mismo mecanismo.
- Contesta la pregunta de `Verificacion_Liberacion_NER_Medicion.md` §5: si la
  recarga dentro de la ventana del segundo documento sube el pico, y cuánto.
- ~45 s por corrida → **~7 min**.

**Registro por corrida**: brazo, digest del `dist` activo, presión de memoria del
sistema al abrir y al cerrar, y el reporte completo que ya produce cada arnés.

## 6. Cómo se lee el resultado

**Comparación pareada, no promedios sueltos.** La corrida A₁ y la B₁ se tomaron
con minutos de diferencia; A₁ y A₆ no. La diferencia que se analiza es
`B_i − A_i` para cada par, y sobre esas 6 diferencias se mira el signo y la
dispersión.

Criterio de cierre, fijado **antes** de medir:

| resultado | lectura |
| --------- | ------- |
| las 6 diferencias tienen el mismo signo y su magnitud supera la dispersión intra-brazo | el efecto existe y tiene número |
| las diferencias cambian de signo, o su promedio queda por debajo de la dispersión intra-brazo | **no hay efecto detectable** sobre el punto de reposo |

El segundo resultado **es un resultado**, no un fracaso: significaría que ADR-166
cuesta ~1 s por reanálisis y no compra memoria sostenida, y eso alcanza para
decidir.

**Regla de parada, fijada de antemano**: si la campaña vuelve sin resolución, **no
se agregan corridas**. Agregar pares hasta que el promedio se acomode convierte el
ruido en conclusión — es la forma más fácil de fabricar un resultado sin darse
cuenta. Con la resolución declarada en §2bis, seis pares o se reporta sin
resolución.

## 7. Lo que este plan no hace

- **No decide ADR-166.** Entrega el número; la decisión es del humano, con su
  propio ADR o una enmienda al existente.
- **No toca `packages/` ni `apps/`** fuera del parche temporal, que se revierte
  antes de correr y nunca se commitea aplicado.
- **No cambia `idleDisposeMs`**, ni ninguna otra configuración. La variante
  "bajar el temporizador solo para NER" es una tercera opción que, si se quiere,
  se mide después y como brazo propio.

## 8. Portabilidad: macOS hoy, Windows después

Decisión del humano del 2026-09-18: la campaña corre primero en la máquina actual
(macOS, M1, 8 GB) y el banco de Windows queda para más adelante, con el arnés
pensado para correr en las dos.

Requisitos que eso impone al script, y que valen desde ahora:

1. **Nada específico de macOS en el camino principal.** El load average se lee
   con `os.loadavg()` de Node, no con `sysctl -n vm.loadavg`. En Windows nativo
   ese valor no existe: la espera se **saltea con un mensaje explícito**, nunca
   con un cero silencioso (mismo mandato que `systemMemoryPressure.ts`).
2. **Hash portable**: `sha256sum` o `shasum -a 256` según cuál exista, patrón que
   `run-hot-baseline-campaign.sh` ya usa.
3. **Sin `rsync`**: `rm -rf` + `cp -R`, que existen en los tres entornos.

Y dos límites que hay que escribir antes de que alguien los pise:

- **`systemMemoryPressure.ts` no tiene lector para `win32`**: devuelve
  `available: false`. Medir en Windows nativo pierde justamente la variable que
  esta campaña existe para controlar. Implementarlo es prerrequisito de cualquier
  tanda allá.
- **Bajo WSL, `os.platform()` devuelve `"linux"` y se lee `/proc/meminfo` de la
  VM, no del host.** Son números creíbles y equivocados: describen la memoria de
  la máquina virtual, que además tiene su propio globo de memoria dinámica. Una
  campaña de memoria bajo WSL **no mide el sistema del usuario**. Si el banco de
  Windows se monta, es con toolchain nativo.

## 9. Límites declarados de entrada

1. **No resuelve por qué.** Contesta si la baja temprana mueve el punto de
   reposo, no qué hace el asignador de memoria por debajo. La devolución de
   páginas al sistema no ocurre en el instante de la llamada
   (`Verificacion_Liberacion_NER_Medicion.md` §6), y eso queda sin explicar.
2. **Un solo perfil y una sola máquina.** P1 sobre un M1 de 8 GB. Los números no
   se extrapolan a otro hardware ni a documentos escaneados.
3. **El fixture sigue sin ser un escaneo real** (§4 del plan de campaña).
4. **n=6 pares resuelven ~250 MB, no menos.** El cálculo y el compromiso de no
   leer por debajo de eso están en §2bis. Un efecto real de 100 MB existiría y
   esta campaña no lo vería.

## 10. Entrega al implementador

Trabajo acotado a `tests/perf/`:

- `support/wasm-heap-probe.spec.ts` + su parche — el Paso 0 de §2ter, con el
  control discriminante. Se entrega **primero** y por separado: su resultado
  decide si el resto lleva una métrica más.
- `support/ab-sin-baja-ner.patch` — el brazo B, una línea.
- `run-ab-intercalado.sh` — construcción de los dos brazos, pre-vuelo
  discriminante, intercambio + verificación de digest por corrida, alternancia,
  agregación.
- `ab-release-curve.spec.ts` — una corrida de P1/NER on por invocación, etiquetada
  por `ANONLY_AB_ARM`, reutilizando `measureHotBaselineCurve`.
- `support/aggregateAbReports.ts` — comparación **pareada** según §6, con sus
  tests (R-13). **Pendiente**: no se construyó en la ejecución del 2026-09-18; el
  análisis se hizo aparte y está transcripto en `AB_Intercalado_Medicion.md`.
- Entrada propia en `tests/perf/README.md`, al lado de «El método de comparar M2
  entre corridas separadas quedó retirado» — que es la página que había que leer
  antes de la tanda del 2026-09-18 y no se leyó. La entrada nueva dice qué hace
  este arnés, qué resolución tiene y por qué no es el método retirado.

No toca `packages/`, `apps/`, ni ningún spec de motor (R-21). El parche del brazo
B se revierte antes de correr y **nunca se commitea aplicado**.
