<!-- CONTEXT: scope=adr | dependencias=ui/React_Client.md,ui/Components.md,core/Contracts.md,architecture/05_Worker_Architecture.md,roadmap/Perfiles_Rendimiento_Revision.md,roadmap/mediciones/ocr/DPI_Descendente_Fase1_Windows_2026-10-01.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-125-La-Configuracion-Se-Toca-Antes-Del-Primer-Documento.md,adr/ADR-132-El-Shell-Tiene-Su-Propio-Modelo-De-Seguridad.md,adr/ADR-143-Las-Imagenes-De-OCR-Se-Producen-Cuando-Hay-Lugar.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-169-La-Pantalla-De-Trabajo-Tras-Pruebas-De-Usuario.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md | audiencia=humanos+IA | fase=11 -->

# ADR-194 — Automático elige el perfil de rendimiento según el equipo

- **Estado**: Aceptado.
- **Fecha**: 2026-10-01.
- **Decidido por**: el humano, a propuesta del planificador, en tres tandas
  (2026-09-30 y 2026-10-01): los cinco perfiles y sus reconocedores, la
  regla de Automático, la fuente de la RAM, la migración, los topes de
  imágenes, los techos de memoria y que Configuración muestre el nivel
  resuelto. El registro de cada decisión y sus mediciones está en
  `roadmap/Perfiles_Rendimiento_Revision.md`.
- **Alcance**: `apps/react-client` (settings, derivación de overrides,
  diálogo de Configuración, recreación del Core) y `apps/desktop-shell` (un
  dato nuevo hacia el renderer). También norma las suites de medición de
  `tests/` (§8). **Sin cambio de contrato del Core**: no hay tipo, evento ni
  error code nuevo. Los perfiles usan claves que `EngineConfigOverrides` ya
  tiene (`workerPool.*PoolSize`, `ocr.maxLiveImageBytes`), y los defaults del
  Core no cambian.
- **Enmienda**: `React_Client.md` §3.6 y §3.7 (el setting y su mapeo),
  `Components.md` §2.6 (el diálogo) y §2.7 (el diálogo de contraseña sigue
  al Core vivo), ADR-132 §3 (la superficie del preload gana un dato de solo
  lectura), ADR-192 §5 (la tabla de techos por perfil de rendimiento) y §2
  (sus techos pasan a ser los del nivel `medium`, §7), y
  `tests/perf/README.md`.
- **No cambia**: la regla de ADR-038 §7 Q3 (con un documento abierto, el
  perfil se aplica al próximo documento; §9 corrige cómo se cumple) ni
  ADR-125 (sin documento, el Core se recrea si el override derivado cambió).

## Contexto

`performancePreset` tenía tres valores. `low` ponía los cuatro pools en 1.
`high` ponía dos reconocedores de OCR, lo mismo que el default. `auto` no
mandaba nada y dejaba los defaults del Core, que solo distinguen un equipo
chico (menos de 4 núcleos o menos de 4 GB) del resto.

Las mediciones de la campaña (`Perfiles_Rendimiento_Revision.md`) mostraron:

- Con cuatro y seis reconocedores, un escaneo real tarda 25 % y 36 % menos
  que con dos, con las mismas detecciones.
- La memoria sigue a las páginas en proceso y a su resolución, no al tamaño
  del pool. Un escaneo de 300 dpi con seis reconocedores ocupados llega a
  4,4 GB de pico.
- El tope de imágenes vivas de 128 MiB (ADR-143 §3) admite tres páginas A4 a
  300 dpi. Con ese tope, cuatro y seis reconocedores rinden como tres.
- Bajar la resolución del OCR para ahorrar memoria se midió y se descartó:
  se pierden emails (`DPI_Descendente_Fase1_Windows_2026-10-01.md`).
- `navigator.deviceMemory` no informa más de 8 GB: no distingue un equipo de
  8 GB de uno de 32.

## Decisión

### 1. Cinco valores, cuatro niveles

`performancePreset` pasa a `"auto" | "low" | "medium" | "high" | "ultra"`.
Los cuatro últimos son **niveles**. `auto` no es un nivel: se **resuelve** a
uno (§3). El default sigue siendo `auto`.

| Valor | Nombre en la UI | Reconocedores de OCR |
|---|---|---:|
| `auto` | Automático | los del nivel resuelto |
| `low` | Bajo consumo | 1 |
| `medium` | Intermedio | 2 |
| `high` | Alto rendimiento | 4 |
| `ultra` | Ultra | 6 |

### 2. Qué manda cada nivel al Core

El override se deriva del **nivel**, también cuando el usuario eligió
`auto`. Lo que la tabla marca «no se envía» queda en el default del Core.

| Nivel | `pdfPoolSize` | `ocrPoolSize` | `nerPoolSize` | `renderPoolSize` | `ocr.maxLiveImageBytes` |
|---|---|---:|---:|---|---|
| `low` | 1 | 1 | 1 | 1 | no se envía (128 MiB) |
| `medium` | no se envía | 2 | 2 | no se envía | no se envía (128 MiB) |
| `high` | no se envía | 4 | 2 | no se envía | `136 * 1024 * 1024` |
| `ultra` | no se envía | 6 | 2 | no se envía | `200 * 1024 * 1024` |

- **PDF y Render** quedan en el default del Core, que escala con los núcleos
  hasta 4 (`05_Worker_Architecture.md` §1.1). El `high` anterior mandaba 4
  fijo; en un equipo de cinco hilos o más el resultado es el mismo.
- **`nerPoolSize`** conserva los valores de hoy. Son plazas, no inferencias
  paralelas. **Los hilos internos de NER no se tocan en ningún nivel**: bajar
  los hilos cuesta entre 1,5 y 2,9 veces el tiempo sin ahorrar memoria, y
  subirlos depende del equipo.
- **El tope de imágenes** de `high` y `ultra` es el que admite cuatro y seis
  páginas A4 a 300 dpi (33,2 MiB cada una). Son los brazos `4b` y `6b` de la
  tanda de Windows. `ocr.dpi` no cambia.
- `ocr.maxLiveImageBytes` viaja en la misma sección `ocr` que
  `ocr.languages`; las dos claves se mandan juntas.

### 3. La regla de Automático

Dos señales, leídas en el renderer al derivar el override:

- **RAM instalada**, en GiB: `totalMemoryBytes / 2^30`, del shell (§4).
- **Hilos**: `navigator.hardwareConcurrency`. Si falta, 4, como en el Core.

| Orden | Condición | Nivel |
|---:|---|---|
| 1 | menos de 4 hilos, o menos de 7 GiB | `low` |
| 2 | menos de 15 GiB | `medium` |
| 3 | 12 hilos o más | `ultra` |
| 4 | 8 hilos o más | `high` |
| 5 | el resto (15 GiB o más, con 4 a 7 hilos) | `medium` |

- **7 y 15 GiB son «8 GB» y «16 GB» con tolerancia.** Un equipo de 16 GB
  informa menos de 16 GiB (el banco de Windows informa 15,8), y uno con
  gráficos integrados informa menos todavía.
- **La fila 5 no la decidió el humano explícitamente**: su regla cubre 16 GB
  con 8 hilos o más. Se completa con el nivel conservador.
- **Sin el dato de RAM** (la app corre fuera del shell, o el valor no es un
  número finito y positivo): menos de 4 hilos, o `navigator.deviceMemory`
  menor que 4, da `low`; el resto, `medium`. Son las mismas dos condiciones
  con las que el Core separaba un equipo chico, pero el resultado no es
  idéntico al `auto` anterior: ver «Consecuencias».
- La regla es una **función pura** de `{ totalMemoryBytes?,
  hardwareConcurrency?, deviceMemory? }`. No mira la memoria libre, la
  cantidad de páginas ni el documento.
- Una elección manual gana siempre: quien elige `ultra` en un equipo de 8 GB
  lo obtiene.

Evidencia y límites: el único equipo donde se midió `ultra` es un i5-12400
de 12 hilos y 16 GB, con unos 9 GiB libres. No hay medición con otras
aplicaciones abiertas ni en equipos de 32 GB.

### 4. El shell informa la RAM instalada

El proceso principal lee `os.totalmem()` y la pasa al renderer **sin canal
de IPC**: como argumento de `webPreferences.additionalArguments`
(`--anonly-total-memory-bytes=<entero>`), que el preload lee de
`process.argv` y expone con `contextBridge`:

```ts
// window.anonlyDevice — solo lectura, un solo campo
interface AnonlyDevice {
  readonly totalMemoryBytes: number;
}
```

- El preload expone el objeto **solo si** el argumento es un entero finito y
  positivo. Si no, `window.anonlyDevice` no existe y rige la rama «sin el
  dato» de §3.
- Es un valor fijo del equipo, leído una vez al crear la ventana. No hay
  mensaje, suscripción ni refresco.
- **Vía usada: `process.argv`.** Comprobado ejecutando en macOS con
  Electron 44 y `sandbox: true`: la página lee `window.anonlyDevice` con el
  valor de `os.totalmem()`. En Windows queda por comprobar; si ahí el
  argumento no llegara, el preload puede leer
  `process.getSystemMemoryInfo().total` (en KiB) y exponer el mismo campo.
  **No se agrega un canal de IPC** para esto.
- **Superficie (ADR-132 §3).** El preload pasa a exponer dos objetos:
  `anonlyUpdater`, sin cambios, y `anonlyDevice`, con ese único campo. Nada
  más del sistema cruza: ni memoria libre, ni modelo de CPU, ni nombre del
  equipo, ni usuario.
- El dato no sale del renderer. La app no tiene a dónde mandarlo
  (`connect-src 'self'`, ADR-132 §2).

### 5. Migración de un `high` guardado

Un `high` guardado antes de este ADR significaba dos reconocedores. Dejarlo
como está lo convertiría en cuatro, con más memoria, sin que el usuario lo
pida.

- El JSON de `anonly:settings` gana `settingsVersion: 2`. `persist()` lo
  escribe siempre.
- En `load()`, si `settingsVersion` falta o es menor que 2 y
  `performancePreset` es `"high"`, se carga como `"auto"`.
- `low` y `auto` se conservan. Un valor que no es ninguno de los cinco se
  carga como `"auto"`.
- `load()` no escribe. La migración es idempotente: se repite igual hasta el
  primer `persist()`, y desde ahí un `high` guardado con versión 2 es el
  nuevo y se respeta.

### 6. Configuración muestra el nivel resuelto

- El selector ofrece cinco opciones, en este orden: Automático, Bajo
  consumo, Intermedio, Alto rendimiento, Ultra.
- La descripción bajo el selector, por opción:

  | Opción | Texto |
  |---|---|
  | Automático | «Anonly elige según tu equipo. En este equipo usa: _nivel_.» |
  | Bajo consumo | «Usa menos memoria y procesador. Puede tardar más.» |
  | Intermedio | «Equilibrio entre velocidad y uso de memoria.» |
  | Alto rendimiento | «Termina antes en documentos escaneados. Usa más memoria.» |
  | Ultra | «El más rápido en escaneados. Para equipos con 16 GB o más.» |

  _nivel_ es el nombre de la UI del nivel que da §3 en ese equipo.
- El texto sale de la misma función que deriva el override. No puede decir
  un nivel distinto del que se aplica.
- La descripción ocupa **un renglón** de alto fijo para las cinco opciones
  (ADR-169 §1): cambiar de opción no cambia el alto del diálogo. Los cinco
  textos entran en un renglón al ancho del diálogo; por eso el de Ultra es
  corto.

### 7. Techos de memoria por perfil de rendimiento (ADR-192 §5)

Escenario: un escaneo de 300 dpi nativos (`P2H`, 20 páginas A4), en Windows
nativo, con el arnés del pool (`tests/perf/run-ocr-pool.sh`, fase `ultra`:
pico de RSS del árbol durante el OCR, tres corridas frías, el **máximo**
contra el techo). GB decimales.

| Nivel | Máximo medido (2026-10-01) | Techo |
|---|---:|---:|
| `low` | sin medir | **3,5 GB (provisorio)** |
| `medium` | 3,16 GB | **3,5 GB** |
| `high` | 4,11 GB | **4,5 GB** |
| `ultra` | 4,41 GB | **5,0 GB** |

- El techo es el máximo medido más el ruido de M2 (unos 0,35 GB, ADR-146
  §7), redondeado al medio GB. En `medium` y `high` el margen es el ruido y
  nada más.
- **`low` es provisorio**: no hay corrida de un reconocedor sobre `P2H`. Se
  mide en la próxima tanda de Windows antes del release, y el techo se
  confirma o se corrige con ese número.
- Estos techos **no reemplazan** los de ADR-192 §2 (2,0 GB en P1 y 3,0 GB
  en P2, medidos con `memory.spec.ts`). Son otro escenario y otro
  instrumento, y un número de uno no se compara contra el techo del otro.
- **Los techos de ADR-192 §2 son del nivel `medium`.** Se fijaron con «la
  configuración por defecto», que entonces eran dos reconocedores. Con este
  ADR, el default de un equipo grande pasa a ser `ultra`, así que
  `memory.spec.ts` y las demás suites de medición **fijan `medium`** de
  forma explícita (§8). Sin eso, el gate de ADR-192 mediría otra
  configuración que la que fijó su techo.
- Se evalúan como en ADR-192 §4: en Windows, antes de cada release, a mano.
  Un máximo que supera el techo vuelve al humano; el techo no se sube en
  silencio.
- Como en ADR-192, un techo es una alarma de regresión. No limita nada en la
  aplicación.

### 8. Las suites de medición no dependen de Automático

Automático da un nivel distinto en cada equipo. Una medición que lo deje
elegir no es comparable entre bancos ni contra un techo.

- **Las suites de medición fijan `medium`** cuando no fijan otra cosa:
  `tests/perf`, `tests/leak`, `tests/stress` y `tests/measure` (la línea de
  base de calidad, cuya identidad está en `tests/quality/baseline`). Lo hacen por el setting (`performancePreset: "medium"`
  con `settingsVersion: 2`), en un punto común.
- **El arnés del pool de OCR fija siempre** `workerPool.ocrPoolSize` y
  `ocr.maxLiveImageBytes` en todos sus brazos, también en el de control. No
  asume qué manda el nivel vigente.
- **Los E2E funcionales siguen en Automático**: ejercitan el camino por
  defecto del producto.
- **Excepciones, que siguen en Automático** porque lanzan Electron por su
  cuenta, fuera del punto común: `external-baseline.spec.ts`,
  `ner-batch-real.mjs`, `ner-batch-feasibility.mjs` y
  `ocr-platform-probe.mjs`. Quien las corra tiene que anotar el nivel que
  resolvió el equipo. En `external-baseline`, comparar un instalado anterior
  a este ADR contra el repo en un equipo que resuelve a `ultra` enfrenta dos
  reconocedores contra seis: esa comparación no vale sin fijar el nivel.

### 9. Con un documento abierto, el nivel nuevo rige al cerrarlo

ADR-038 §7 Q3 y `Components.md` §2.6 dicen que un cambio de perfil con un
documento abierto «aplica al próximo documento». El código no lo cumplía:
nada recreaba el Core al cerrar el documento, y el nivel nuevo regía recién
al reiniciar la aplicación. Se corrige con este ADR: al quedar la aplicación
sin documento, si el override derivado difiere del que tiene el Core vivo,
el Core se recrea (la misma comparación de ADR-125, con
`sameEngineConfigOverrides`).

- La comparación es sobre el override entero, no solo el perfil. Un cambio
  de idiomas aplicado por re-análisis con el documento abierto también
  recrea el Core al cerrar: el documento siguiente arranca con lo guardado.
- Una importación que llega mientras el Core se recrea espera al Core nuevo.
- Si falla liberar el Core anterior, se crea igual el nuevo. Si falla crear
  el nuevo, se vuelve a crear con el override anterior, para que la
  aplicación quede usable; el próximo cierre de documento reintenta. En los
  dos casos el error va a la consola: al cerrar un documento no hay un
  diálogo donde mostrarlo.
- **Todo consumidor del bus sigue al Core vivo.** Cada Core tiene su propio
  bus. Un componente que se suscribe una sola vez al montar queda escuchando
  el bus de un Core que ya no existe. Vale en particular para
  `PasswordDialog` (`Components.md` §2.7), que es el único que escucha
  `PDF_PASSWORD_REQUIRED`: sin esto, tras una recreación un PDF protegido
  no abre el diálogo y queda en `Extracting`.
- Dos recreaciones no corren a la vez: la del diálogo de Configuración
  (ADR-125) espera a la que esté pendiente.

## Pruebas exigidas

Los tests de `apps/react-client` y de `apps/desktop-shell` no fijan nombres
en un spec.

1. **La regla de Automático**, caso por caso: 3 hilos con 32 GiB da `low`;
   6,9 GiB con 8 hilos, `low`; 7,0 GiB con 8 hilos, `medium`; 14,9 GiB con
   12 hilos, `medium`; 15,0 GiB con 12 hilos, `ultra`; 15,8 GiB con 8 y con
   11 hilos, `high`; 32 GiB con 4 y con 7 hilos, `medium`; sin RAM con 12
   hilos, `medium`; sin RAM con 3 hilos, `low`; sin RAM con `deviceMemory`
   2, `low`; RAM `NaN`, 0 o negativa, igual que sin RAM.
2. **El override de cada nivel** es exactamente el de §2, incluidas las
   claves que no se envían. `auto` deriva el override del nivel resuelto: ya
   no devuelve un override sin `workerPool`.
3. **`sameEngineConfigOverrides`** distingue los cuatro niveles entre sí, y
   da igual entre `auto` y el nivel al que resuelve.
4. **Migración**: `high` sin versión carga como `auto`; `high` con
   `settingsVersion: 2` carga como `high`; `low` y `auto` sin versión se
   conservan; un valor desconocido carga como `auto`; `persist()` escribe
   `settingsVersion: 2`.
5. **El diálogo**: las cinco opciones en orden, y con Automático la
   descripción nombra el nivel resuelto.
6. **Cambio con documento abierto** (§9): cambiar el perfil con un documento
   abierto no recrea el Core; al cerrar el documento, sí, y el Core nuevo
   recibe el override del perfil elegido. Sin cambio de perfil, cerrar el
   documento no recrea nada. Tras una recreación, `PDF_PASSWORD_REQUIRED`
   emitido por el Core nuevo abre el diálogo de contraseña.
7. **El preload**: expone `anonlyUpdater` y `anonlyDevice` y ningún otro
   objeto; `anonlyDevice` tiene solo `totalMemoryBytes`; con un argumento
   ausente o inválido no lo expone. El main no registra ningún `ipcMain`
   nuevo.

Cada una tiene que fallar contra el código de `f25bdbc` (ADR-149 §2).

## Consecuencias

**A favor**

- Un equipo de 16 GB con 12 hilos procesa un escaneo en dos tercios del
  tiempo sin que el usuario toque nada.
- El usuario ve qué nivel usa su equipo.
- Cada nivel tiene un techo de memoria escrito y medido, salvo `low`.

**En contra**

- **Automático pasa a consumir más memoria en equipos grandes**: hasta
  5,0 GB de pico en un escaneo de 300 dpi, contra 3,2 GB con dos
  reconocedores. Es el costo aceptado de la mejora de tiempo.
- **En un equipo de 8 GB, `medium` llega a 3,5 GB** con un escaneo de 300
  dpi, más que los 3,0 GB con los que ADR-192 justificó el equipo mínimo.
  No es un cambio de este ADR (es la configuración de hoy), pero queda
  escrito.
- La regla usa RAM instalada, no memoria libre. Un equipo de 16 GB con poca
  memoria libre recibe `ultra` igual.
- **Un equipo chico en Automático baja PDF y Render de 2 a 1.** Antes
  recibía los defaults del Core para un equipo chico (PDF 2, OCR 1, NER 1,
  Render 2); ahora recibe `low`, que pone los cuatro en 1.
- **Un equipo de 4 a 7 GiB con 4 hilos o más queda más lento.** Antes no
  era un equipo chico para el Core y recibía dos reconocedores; ahora la
  regla le da `low`. Es la consecuencia de «menos de 8 GB: Bajo», y esos
  equipos están por debajo del mínimo soportado (ADR-192 §1).
- **CI.** Un runner con menos de 4 hilos corre los E2E en `low`.
- **Las suites de medición cambian en un banco chico.** En un equipo de
  menos de 4 hilos corrían con OCR 1 y NER 1; con `medium` fijo pasan a OCR 2
  y NER 2 (PDF y Render siguen en 2). Afecta a `pipeline-timing.spec.ts`,
  que es un gate de CI, y a `tests/leak` y `tests/stress`. En un equipo no
  chico, `medium` es exactamente lo que Automático daba antes.
- El preload expone un segundo objeto.
- La regla está validada en un solo equipo de 16 GB.

## Alternativas descartadas

- **Leer la RAM con `navigator.deviceMemory`.** Topa en 8 GB.
- **Un canal de IPC para la RAM.** Agrega un mensaje y un handler a una
  superficie que ADR-132 quiere mínima, para un valor que no cambia.
- **Que el Core decida el nivel.** El Core no lee del sistema (R-10), y la
  preferencia vive en la UI.
- **Conservar `high` guardado como el nuevo `high`.** Duplica los
  reconocedores y sube la memoria sin que el usuario lo pida.
- **128 MiB de tope para todos los niveles.** `high` y `ultra` quedarían en
  tres reconocedores ocupados con un escaneo de 300 dpi.
- **Bajar la resolución del OCR para compensar la memoria.** Medido y
  descartado: se pierden emails.
- **Mirar la memoria libre o la cantidad de páginas.** No hay una señal
  contractual, y redimensionar pools con un documento abierto queda fuera
  (ADR-038 §7).
