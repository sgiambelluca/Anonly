<!-- CONTEXT: scope=medicion-ocr-experimental | dependencias=adr/ADR-202-El-Minimo-De-Region-OCR-Se-Prueba-A-25pt-Antes-De-Adoptarlo.md,roadmap/ocr/Regiones_Pequenas_25pt_Experimento_Plan.md,roadmap/mediciones/ocr/Regiones_Pequenas_2026-10-05.md,core/PDF_Engine.md | audiencia=humanos+IA | fase=12 -->

# Regiones de 25 pt — piloto del 2026-10-05

> **Cierre posterior ADR-203:** el humano pidió cerrar el criterio de ADR-148.
> Se restauró 100 pt en el workspace y se creó un mixed elegible versionado
> para ese gate, con 21/21, R-16 verde y Sol APPROVED local (CI completa success posterior, run 37383499951).
> La variante pequeña y snapshots de esta investigación se
> conservan. Las referencias a prototipo activo en el relato siguiente
> describen el estado histórico del experimento, no una política actual.
> Ver [la ronda de cierre](../../hardening/ADR148_Cierre_ADR203_2026-10-05.md).

**Estado:** contraejemplo H2 confirmado por Sol 6.1; el revisor rechaza adoptar
25 pt bajo el criterio acordado de conservar exclusión de trabajo redundante.
**Fidelidad del prototipo, arnés y evidencia: APPROVED** en segunda revisión
Sol 6.1. No quedan correcciones mecánicas pendientes. Diseño siguiente por decidir.
Investigación local autorizada por el humano, conforme a ADR-202.
Referencia 100 pt/candidato 25 pt; única diferencia funcional prevista:
constante de mínimo por ambos lados del bbox clampeado en PDF Engine.

## Preguntas del piloto

- H1: ¿el pipeline admite y anonimiza el DNI de la imagen mixed original,
  con fuente confirmada y vecinos preservados en el archivo descargado?
- H2: ¿los 12 controles alineados conservan cero trabajo OCR nuevo?
- H3: ¿qué cambios de lectura/ocurrencias sensibles o falsas aparecen en
  los controles pequeños, neutrales y blancos?
- H4: si el piloto sostiene la hipótesis, ¿cuál es el costo del pipeline
  completo y cumple los presupuestos canónicos?

No se ha medido todavía H4 con esta política. No se reutilizan como costo
de candidato los picos de OCR forzado de la investigación anterior.
Primero se evalúan H1/H2; una refutación válida detiene la campaña larga
y se revisa independientemente. El implementador no cambia otros filtros.

## Evidencia revisada del piloto

Campaña local: `.measure/ocr-region-25pt/2026-10-05/`. Los snapshots
`reference-100/` y `candidate-25/` tienen manifiestos separados. El piloto
válido está en **`pilot-2026-10-05T18-04-16-248Z-26584/`** y contiene
`first-stage-decision.json`, `fixture-manifest.json`, `pilot-interpretation.json`
y fuentes/exports/observaciones por brazo. La primera ejecución está en
`pilot-2026-10-05T17-52-08-725Z-24396/`; su raw
`first-stage-decision.json` se conserva, incluidos campos del arnés inicial
que requieren corrección metodológica. No sustituir el raw por un derivado.

Ambos brazos llegaron a Ready en ambos fixtures. Intermedio, NER habilitado,
OCR a 300 dpi y pools OCR/NER de dos workers. Los fixtures tienen los
mismos hashes por brazo:

- Mixed original, run válido: `daf8a1b904ee1f354aa2685a8aad157b9534dd8894f96c01a9c90d99c98665c7`.
- Capas alineadas: `a4074d8d23f45f5ecd198484c05274df8ca5072d293642cce23f2cce28259d0c`.

Idiomas de OCR del piloto: **`["spa"]`** en ambos brazos. La configuración
por defecto de la app es `["spa", "eng"]`; el éxito del mixed bajo este
piloto no acredita esa configuración ni la matriz ADR-148. El contraejemplo
de H2 observa admisión geométrica y ejecución, con settings idénticos por
brazo; no depende de recuperar texto con un idioma concreto.

| Fixture | Referencia 100 pt | Candidato 25 pt |
| --- | --- | --- |
| Mixed | Cero regiones/eventos OCR; una ocurrencia DNI nativa y un grupo. El export conserva el DNI de imagen | Una región de 300 × 56 pt; un evento OCR con cuatro palabras; dos ocurrencias DNI y dos grupos. La lectura independiente del export no recupera ninguno de los dos DNI originales |
| 12 capas alineadas | Cero regiones/eventos OCR; 12 ocurrencias Regex y un grupo | Tres regiones/eventos OCR adicionales; 12 ocurrencias Regex y un grupo. Los tres eventos tienen cero palabras |

En el corpus alineado, las regiones nuevas están en los pageIndex 9, 10
y 11 (páginas humanas 10–12). Cada bbox mide **54,953125 × 300 pt** en
`x=158,046875`, `y=242`. Esto refuta H2: el mínimo reducido admite trabajo
OCR en controles cuya imagen ya dispone de texto nativo alineado. No se
observa aumento de ocurrencias en estos controles; la redundancia medida
es de ejecución OCR. Cero palabras no demuestra por sí solo ausencia de
tinta en los píxeles del recorte ni identifica una falla de reconocimiento.

El raw inicial compara la capa textual con un DNI sin puntuación y deja
`sourceTextLayerContainsNativeDniOnly=false`; esa comparación no constituye
una comprobación válida. El run válido registra lectura de
ambos DNI y vecinos en la fuente, verifica por UI el modo **Tapar con negro**
en ambos grupos y comprueba ausencia de ambos DNI y conservación de vecinos
en el export. La comparación simétrica de capa textual y el oráculo completo
se cerraron en la auditoría complementaria aprobada por Sol. H1 se sostiene
en este piloto con `spa`. El texto `ENS` observado por el verificador en el área del DNI
rasterizado no se contabiliza como identificador recuperado.

Hash del export de referencia:
`19a2c33ab87e94a681a1a137b362b6987a7260823b9083d405c3dc5a108c2342`.
Hash del export candidato:
`654e5565284b0563f5bc628b1fffda60a04dad267818f3d4c6cf047b33e64cc8`.
El mixed se genera de nuevo por ejecución: el hash del primer intento fue
`191fd81c2ddfb6de54f01c1ffe7130d41b644b6f04295115b248363d0a0543bc`.
La identidad requerida es de los bytes usados por ambos brazos de cada run,
no identidad entre ejecuciones distintas. El corpus alineado sí conserva
su hash histórico exacto.

## Checks y revisión

Luna informa exit 0 de Prettier, ESLint y `tsc -p tests/tsconfig.json --noEmit`,
dos pruebas de frontera verdes y el piloto dirigido verde en 24,9 s. Ese
verde certifica el registro de una parada válida; no certifica H2 ni adopción.
Sol confirmó **184/184 tests PDF**, incluidos contract/unit/edge y las dos
regresiones nuevas; cobertura **98,01% líneas**, thresholds intactos.
Prettier, ESLint, typecheck PDF/tests y `git diff --check` verdes. Verificó
los 287 hashes de cada snapshot, los sourcemaps y fuentes/exports: la única
diferencia funcional entre brazos es el mínimo por lado. No repitió Electron.

Primera revisión del arnés: **REJECTED**. Correcciones pedidas a Luna:

1. P1: sustituir búsqueda de DNI completos en dígitos concatenados por
   `verifyExport`: fragmentos, cantidad/dimensiones de páginas, vecinos y
   sensibilidad afirmada (referencia falla por fuga, candidato cumple).
   Conservar auditoría independiente íntegra y rásters/metadatos/hashes.
2. P2: flag opt-in que impida preparación y lanzamiento sin activación.
3. P2: normalizar ambos lados del predicado de capa textual y agregar
   regresión discriminante; el DNI rasterizado formateado no puede compararse
   directamente con un texto reducido a dígitos.

La comprobación previa `assertMixedFixtureTextLayer` protege el fixture
actual, pero no volvía válido el predicado inicial registrado. En la primera
revisión H1 completa quedó pendiente de esas correcciones; H2 se confirmó y no se
modifican controles ni filtros para obtener otra conclusión.

### Cierre mecánico aprobado en segunda revisión

Auditoría complementaria **offline**, sin relanzar Electron ni medir de
nuevo: `h1-audit-2026-10-05T18-20-16-777Z-14576/h1-audit.json` bajo la
misma campaña. Usa las fuentes y exports del piloto válido de las 18:04;
conserva tres PDFs, tres PNG, OCR íntegro y hashes/versiones/metadatos de
los assets e instrumentos. No reemplaza ni corrige por sobrescritura los raws.

Con `verifyExport`, los resultados registrados son:

| Control | Resultado |
| --- | --- |
| Lectura de ambos DNI, vecinos e integridad de la fuente | CUMPLE |
| Export de referencia | NO CUMPLE: fuga de `62938475` y fragmentos `6293`/`8475` |
| Export del candidato | CUMPLE: páginas/dimensiones, vecinos y ausencia de fragmentos prohibidos |
| Sensibilidad del oráculo al añadir el DNI a su documento OCR candidato | NO CUMPLE por los mismos fragmentos |

El último control es sintético sobre la entrada del oráculo; no inyecta
grupos ni entidades en el producto y no reemplaza el export UI real. El
predicado de capa textual normaliza ambos identificadores y tiene una
regresión que detecta el DNI de imagen si se añade erróneamente a esa capa.

Ambos tests del arnés requieren **`ANONLY_REGION25_PROTOTYPE=1`** antes de
preparación/lanzamiento. Sin la variable quedaron dos tests salteados, sin
preparar fixtures/snapshots ni abrir Electron: es un arnés opt-in separado
del gate ADR-148, donde sí se exige cero salteados. Luna informa el audit
offline verde en 6,6 s, tests del helper y checks scoped verdes. Sol confirmó
el cierre y correspondencia de los tres PDFs/PNG con el piloto: hashes,
tamaños, dimensiones, metadatos OCR, assets spa/browser y versiones reales.
La referencia demuestra sensibilidad sobre un archivo real; la inyección
adicional prueba el comparador. Sus checks propios finales de formato,
ESLint, TypeScript, **13/13 unit tests** y `git diff --check` fueron verdes.
También confirmó los dos skips esperados sin flag, sin preparación/Electron.
No repitió los 184 tests PDF/cobertura ni campañas ya confirmados.

La limpieza del perfil temporal del run válido terminó. Quedaron cuatro
perfiles `anonly-25pt-*` de intentos fallidos bajo `%TEMP%`: Luna verificó
las rutas, pero la herramienta rechazó su eliminación recursiva. Se conserva
esa limitación y no se intentó otra vía para eludir el rechazo.

## Alcance de la conclusión

La condición de parada de ADR-202 se activa por H2. No se ejecutan por ello
la calidad ampliada H3 ni el costo real H4, y tampoco P1/P2, la matriz de
21 filas ADR-148 ni gates globales de adopción. No hay nueva evidencia de
pico de memoria, delta de consumo o cumplimiento de presupuestos para 25 pt.

| Hipótesis | Conclusión revisada |
| --- | --- |
| H1 | Confirmada solo para mixed de 300 × 56 pt, bajo spa, con export real y oráculo completo |
| H2 | Refutada por tres ejecuciones OCR adicionales en controles alineados |
| H3 | No evaluada de forma ampliada; tampoco se ejecutó la cohorte histórica de 17 pequeños tras la parada temprana |
| H4 | No medida; no permite ubicar el pico ni estimar delta/cumplimiento de memoria |

La revisión debe distinguir fidelidad del experimento y aprobación de
política. El candidato de 25 pt por sí solo no cumple todas las condiciones
de este piloto; no se adopta a partir del éxito parcial del mixed. El
workspace conserva el prototipo local identificado por ADR-202 y la
referencia de publicación sigue siendo 100 pt. ADR-148 conserva su rechazo.
No se realizó commit, push, merge ni publicación.

## Siguiente decisión de diseño

El éxito del mixed no justifica elevar el criterio de H2 a aprobado. Hay
dos caminos nuevos, aún sin autorizar como política de producto:

- Investigar una señal que distinga contenido rasterizado no representado
  por el texto nativo de los huecos geométricos actuales. Debe conservar
  la recuperación de pequeños legibles y evitar los controles alineados;
  su propio costo de inspección también requiere medición. No se prescribe
  ahora un algoritmo, threshold, nuevo descarte ni fix de rotación.
- Aceptar explícitamente el OCR adicional como un tradeoff y autorizar una
  campaña de calidad/costo del candidato bajo un criterio revisado. Los
  tres eventos de cero palabras no predicen su costo en otros documentos.

El planificador recomienda investigar la primera opción antes de adoptar
25 pt. Elegir un mínimo mayor que 54,953125 pt para excluir exactamente
estas regiones sería ajustar al piloto y también excluiría los seis
originales confirmados de 25 pt y los seis de 50 pt de la caracterización
anterior. Es una consecuencia geométrica del mínimo, no una prueba de una
nueva política ni un nuevo resultado del pipeline.
Cambiar el criterio de admisión o aceptar un costo nuevo requiere
la decisión humana prevista en ADR-202; ninguna de estas opciones se
implementó dentro del piloto.

**Cierre:** fidelidad, arnés y evidencia APPROVED; adopción del candidato
bajo los criterios actuales REJECTED; ADR-148 global estaba REJECTED al
cierre de este piloto y recibió aprobación local posterior bajo ADR-203.
No se cambia
automáticamente la política de producto. La pregunta sobre la siguiente
línea de investigación quedó enviada al humano; no se abrió otra campaña.
