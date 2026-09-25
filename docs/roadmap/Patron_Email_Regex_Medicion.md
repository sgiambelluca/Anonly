<!-- CONTEXT: scope=roadmap-medicion | dependencias=roadmap/Rendimiento_Experimentos_Plan.md,roadmap/Optimizacion_De_Rendimiento.md,core/Regex_Engine.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 (punto 4a, línea base macOS 2026-09-24 y confirmación Windows 2026-09-25; cerrado) -->

# Patrón email de Regex — antes y después en macOS, confirmado en Windows

## Hallazgo

El patrón `email` anterior reproducía un costo cuadrático sobre texto adverso
sin `@` y denso en dígitos/guiones: al duplicar los caracteres, el tiempo se
cuadruplica aproximadamente. En 160 KiB bloqueó el hilo **42,5 segundos**;
durante ese tiempo la cancelación programada tampoco pudo ejecutarse. Los
documentos reales R1/R2 fueron rápidos, pero esta tanda no clasificó si
contenían la forma adversa. La corrección se motiva por **robustez del peor
caso**, sin atribuirle el tiempo de importación observado en R1/R2.

El escáner lineal de ADR-181 eliminó ese bloqueo en la repetición: los 160 KiB
sin `@` bajaron de **42.533 ms a 9,05 ms** para `RegexEngine.process`; con
`@` tardía y sufijo inválido tardaron **10,32 ms**. Las huellas de detección
del corpus normal y de R1/R2 permanecieron iguales. Esta mejora corresponde
al caso adverso; R1/R2 ya tardaban milisegundos y su tiempo se mantuvo en el
mismo orden. No se cambió la cancelación entre páginas ni se añadió un timeout
productivo.

## Protocolo y datos

El arnés opt-in `tests/perf/regex-worst-case.ts` ejecutó cada tamaño en un
proceso aislado con límite externo de 65 s; tres pasadas de tiempo sin sonda y
una separada por patrón. Orden intercalado con un texto normal de igual tamaño.
Las detecciones del normal coincidieron con la referencia en todas las rondas,
y el adverso produjo cero emails; no hubo censuras ni discrepancias. Se usó
`caffeinate` y no se observó suspensión. Resultado numérico ignorado por Git:
`.measure/regex-worst-case/20260924T042751991Z/numeric-report.json`.

La repetición con el cambio usó el mismo barrido, añadió `@` tardía con sufijo
inválido y dejó 66 corridas válidas, sin censuras ni diferencias de detección.
Artefacto: `.measure/regex-worst-case/20260924T050504322Z/numeric-report.json`.

| Caracteres | Adverso: mediana total | Normal: mediana total |
|---:|---:|---:|
| 2.048 | 9,58 ms | 3,55 ms |
| 10.240 | 169,53 ms | 4,16 ms |
| 20.480 | 666,32 ms | 4,97 ms |
| 40.960 | 2.659,69 ms | 6,65 ms |
| 81.920 | 10.616,72 ms | 10,67 ms |
| 163.840 | 42.533,07 ms | 23,46 ms |

Medianas post-cambio, en ms. El normal mantuvo los conteos de emails
25/122/242/480/956/1.878 según tamaño; todas las huellas se conservaron.

| Caracteres | Sin `@` | `@` tardía, sufijo inválido | Normal |
|---:|---:|---:|---:|
| 2.048 | 2,75 | 3,06 | 3,70 |
| 10.240 | 3,21 | 3,77 | 4,47 |
| 20.480 | 3,68 | 4,36 | 5,47 |
| 40.960 | 4,51 | 5,18 | 7,56 |
| 81.920 | 6,24 | 7,26 | 12,30 |
| 163.840 | 9,05 | 10,32 | 25,20 |

En 160 KiB, el escáner aislado tardó 0,006 ms sin `@` y 1,287 ms con `@`
tardía. La cancelación programada se despachó tras 9,75 y 10,65 ms
respectivamente, frente a ~42,46 s antes del arreglo. Estos tiempos son de
la Mac medida, no un SLA portable.

En la pasada por patrón de 160 KiB, `email.exec` acumuló ~42.661 ms; el
siguiente patrón más costoso estuvo alrededor de 1,1 ms. El retraso máximo
observado para el timer/cancelación fue ~42,46 s; `abortSignal` no se observó
durante `process`, consistente con el chequeo contractual entre páginas. El
watchdog es una protección del banco y no un timeout del producto.

El control de R1/R2 se hizo dentro del renderer empaquetado con un wrapper de
`RegexEngine.process` y un hook de `RegExp.exec`; solo salieron longitudes,
tiempos, conteos y huellas de detección. Hubo tres rondas alternadas por
documento, seis válidas, sin suspensión ni cambio de huella. Los PDF se
pasaron por `ANONLY_REAL_DOC_R1/R2` y tienen nombres neutros en el banco; no
se guardaron nombres, rutas ni texto en el reporte. Artefactos:
`.measure/regex-real/20260924T044601Z/`.

La repetición post-cambio está en
`.measure/regex-real/postscan-20260924T051000Z/`: seis corridas válidas,
longitudes por página idénticas, 10/30 detecciones y SHA-256 de salida
idénticos a la línea base para R1/R2. Un helper de benchmark construyó el
motor temporalmente y restauró ambos `dist` en `finally`.

| Documento | Páginas | Caracteres de entrada Regex | Máximo por página | Regex total por ronda | Patrón email por ronda | Detecciones |
|---|---:|---:|---:|---:|---:|---:|
| R1 nativo | 51 | 83.722 | 1.833 | 4 / 4 / 4 ms | 0,27 / 0,28 / 0,24 ms | 10 |
| R2 escaneado | 20 | 33.671 | 2.191 | 10 / 10 / 9 ms | 0,18 / 0,17 / 0,14 ms | 30 |

El bloqueo síncrono de Regex post-cambio fue **4,535 / 3,710 / 3,795 ms** en
R1 y **9,235 / 10,600 / 9,235 ms** en R2; `REGEX_FINISHED` fue 5/3/4 y
10/10/9 ms. La tabla anterior mide `RegExp.exec` de email de la línea base;
el escáner nuevo ya no llama a ese `exec`, y su tiempo exacto por página real
no se instrumentó por separado. Comparar `exec = 0` con el valor anterior
sería un falso ahorro. El tiempo total del motor y la huella son comparables.

Los caracteres son la carga efectiva que recibió Regex, no los bytes del PDF
ni una aproximación por cantidad de páginas. El wrapper síncrono midió en R1
4,12/3,97/4,07 ms y en R2 10,25/9,64/8,49 ms; la diferencia con el entero
de `REGEX_FINISHED` es resolución de medición. No hubo deriva térmica adversa
observable en estas seis corridas. El banco no contó caracteres únicos por
invocación de `email.exec` ni clasificó el patrón adverso dentro de R1/R2; por
eso sus tiempos no refutan la curva sintética.

## Decisión de planificación

La documentación anterior fijaba el patrón de email y la salida determinista,
pero no cómo evitar su backtracking cuadrático. El planificador cerró ADR-181
y `Regex_Engine.md` v1.14.0 antes de pedir código, conforme a R-18/R-21 de
`AI_Development_Guide.md`. El cambio se limitó al email default, con búsqueda
lineal por `@` y paridad diferencial de spans, normalización, orden y
detecciones; los patrones custom conservaron su ruta. Un simple chequeo
`text.includes("@")` no habría cubierto el prefijo con `@` tardía.

El banco ya se repitió en la Mac sobre todos los tamaños y R1/R2. La aceptación
de código además requiere cobertura y los gates del monorepo.

---

## Repetición Windows nativo (2026-09-25)

> Commit `ee5eeba` (`hardening/plan-2026-09`), Windows 11 Pro build 26200,
> i5-12400, 16,9 GB RAM, nativo (Git Bash, no WSL).

Primera tanda (mismo día): solo R1/R2. Segunda tanda, más tarde el mismo día:
el barrido sintético adverso de 2.048–163.840 caracteres, que había quedado
pendiente.

### R1/R2 reales

Control de documentos reales
(`tests/perf/run-regex-real-docs.sh`, que no tiene gate de plataforma y corrió
sin modificar — solo se sustituyó `python3 tests/perf/support/timeout-command.py`
por el `timeout` de GNU coreutils que trae Git Bash, y se retiró la guarda
`pgrep` por las mismas razones documentadas en `Hilos_NER_Medicion.md`).

Tres rondas intercaladas por documento, **6/6 corridas válidas, 0 fallidas**,
huellas de detección idénticas en las tres rondas de cada documento (mismo
criterio que macOS).

| Documento | Páginas | Caracteres de entrada Regex | Máximo por página | Regex total por ronda | Detecciones |
|---|---:|---:|---:|---:|---:|
| R1 nativo | 51 | 83.722 | 1.833 | 5 / 5 / 7 ms | 10 |
| R2 escaneado | 20 | 33.655 | 2.189 | 17 / 14 / 13 ms | 30 |

Mismo orden de magnitud que la Mac post-ADR-181 (R1: 4/4/4 ms; R2: 10/10/9 ms)
— algo más lento en milisegundos absolutos aquí, pero la diferencia es del
orden de unidades de milisegundo sobre un total de una o dos decenas: ruido de
banco, no una regresión. El patrón email ya no tiene un costo por invocación
propio desde ADR-181 (el escáner lineal no llama a `RegExp.exec` por email),
así que `perPatternMs` no incluye esa clave en ninguna plataforma — es
correcto, no un dato faltante. El `maxMainThreadGapMs` (25,98 / 17,93 / 19,74 ms
en R1; 41,68 / 28,83 / 25,33 ms en R2) confirma que el motor sigue sin bloquear
el hilo principal de forma perceptible en documentos reales, igual que en la
Mac.

**Conclusión**: la corrección de ADR-181 se sostiene en una segunda
plataforma para los documentos reales.

### Barrido sintético adverso (2.048–163.840 caracteres)

Corrido directo con `pnpm exec tsx tests/perf/regex-worst-case.ts`, sin
`caffeinate` (sin equivalente en Windows) y sin modificar el script — no
tiene gate de plataforma ni dependencias de shell, cada caso ya trae su
propio watchdog interno de 65 s. **66 corridas, 0 censuradas, 0
inconsistencias de referencia** (`.measure/regex-worst-case/20260925T221744723Z/`).

| Caracteres | Sin `@` (mediana) | `@` tardía, sufijo inválido (mediana) | Normal (mediana) |
|---:|---:|---:|---:|
| 2.048 | 1,83 ms | 2,08 ms | 3,73 ms |
| 10.240 | 2,55 ms | 3,54 ms | 4,69 ms |
| 20.480 | 3,36 ms | 4,93 ms | 7,27 ms |
| 40.960 | 5,15 ms | 7,47 ms | 10,43 ms |
| 81.920 | 7,88 ms | 10,67 ms | 16,15 ms |
| 163.840 | 13,26 ms | 15,82 ms | 30,63 ms |

**Confirma lo mismo que macOS: no hay bloqueo cuadrático en ninguna
plataforma.** Los 163.840 caracteres, que antes de ADR-181 bloqueaban 42,5 s
en la Mac, tardan **13–31 ms** acá — cuatro órdenes de magnitud menos, igual
que en macOS (9–25 ms). `emailScannerMs`, medido en la pasada por patrón,
fue de **0,002–0,009 ms** para el caso sin `@` y de **5,66 ms** para `@`
tardía a 163.840 caracteres — sigue siendo el costo dominante entre los
patrones custom (`caratula-ar` fue el segundo más caro, ~2,05 ms a ese
tamaño), pero de milisegundos, no de decenas de segundos.

Los números absolutos **no coinciden** entre plataformas — a diferencia y en
la misma dirección que lo observado en Grouping (`Agrupacion_Difusa_Medicion.md`):
en tamaños chicos Windows es más rápido que la Mac (2.048: 1,83/2,08/3,73 ms
contra 2,75/3,06/3,70 ms), pero en tamaños grandes es más lento (163.840:
13,26/15,82/30,63 ms contra 9,05/10,32/25,20 ms). El patrón se repite en
varias mediciones de esta campaña Windows para código con bucles ajustados
sobre cadenas — no se investigó la causa, y no cambia la conclusión: **el
bug cuadrático original está cerrado en las dos plataformas.**
