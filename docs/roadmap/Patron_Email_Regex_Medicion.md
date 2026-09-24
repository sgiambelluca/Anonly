<!-- CONTEXT: scope=roadmap-medicion | dependencias=roadmap/Rendimiento_Experimentos_Plan.md,roadmap/Optimizacion_De_Rendimiento.md,core/Regex_Engine.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 (punto 4a, línea base macOS 2026-09-24; Windows pendiente) -->

# Patrón email de Regex — antes y después en macOS

## Hallazgo

El patrón `email` anterior reproducía un costo cuadrático sobre texto adverso
sin `@` y denso en dígitos/guiones: al duplicar los caracteres, el tiempo se
cuadruplica aproximadamente. En 160 KiB bloqueó el hilo **42,5 segundos**;
durante ese tiempo la cancelación programada tampoco pudo ejecutarse. Los
documentos reales R1/R2 fueron rápidos, pero esta tanda no clasificó si
contenían la forma adversa. La corrección se motiva por **robustez del peor
caso**, sin atribuirle el tiempo de importación observado en R1/R2.

El escáner lineal de ADR-175 eliminó ese bloqueo en la repetición: los 160 KiB
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
pero no cómo evitar su backtracking cuadrático. El planificador cerró ADR-175
y `Regex_Engine.md` v1.14.0 antes de pedir código, conforme a R-18/R-21 de
`AI_Development_Guide.md`. El cambio se limitó al email default, con búsqueda
lineal por `@` y paridad diferencial de spans, normalización, orden y
detecciones; los patrones custom conservaron su ruta. Un simple chequeo
`text.includes("@")` no habría cubierto el prefijo con `@` tardía.

El banco ya se repitió en la Mac sobre todos los tamaños y R1/R2. La campaña
completa todavía debe repetirse en Windows nativo ventilado cuando ese equipo
esté disponible; hasta entonces los tiempos y cualquier criterio de perfil son
locales. La aceptación de código además requiere cobertura y los gates del
monorepo.
