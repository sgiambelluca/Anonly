<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/NER_Engine.md,core/Grouping_Engine.md,architecture/04_Event_System.md,adr/ADR-024-NerStarted-ModelLoading-BatchSize.md,adr/ADR-046-NerEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md,adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-088 — El texto que recibe el NER tiene que ser texto que exista

- **Estado**: Accepted
- **Fecha**: 2026-08-22
- **Decidido por**: El humano, sobre la reproducción de las tres fugas del gate manual (`roadmap/Post_Hito10.8_Pendientes.md` §23) en `tests/integration/qa-stamp-detection.test.ts`.
- **Relacionado con**: ADR-067 §4 (el orden que concatena los runs rotados, y que este ADR asume intacto), ADR-024 §2 (`batchSize` en palabras), ADR-046 §2/§3 (un despacho por batch), ADR-066 §6 (`rotation` en `BoundingBox`, la señal que este ADR consume), ADR-063 (el bbox rotado, que ya andaba y no alcanzaba)
- **Parte de**: la campaña de calidad de detección abierta por `roadmap/Calidad_De_Deteccion_Informe.md`

> Convención de citas: `ADR-088 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-088, Contexto §N`.

## Contexto

### 1. Dos fugas de dato, un mismo diagnóstico

El gate manual de ADR-058 §11 encontró que el PDF exportado de `qa-stamp.pdf` sigue conteniendo nombres legibles (§23a, §23b, §23d). El informe de calidad atribuyó las dos a la detección y sospechó de la normalización de Grouping. **Medido, no es eso.**

La reproducción corre el pipeline real —`pdfjs-dist` sin mockear, Regex/NER/Grouping reales— y replaya la inferencia con los tokens crudos que devolvió el modelo de producción (`Xenova/bert-base-multilingual-cased-ner-hrl`, dtype `q8`) sobre el texto exacto de esa página. Lo que muestra:

**§23a — el folio a 270°.** El modelo etiqueta bien `Juan Pérez` del folio, y después le pega `I-PER` a los cuatro wordpieces de `JUZGADO` y a la `L` de `LOPEZ`. La agregación BIO los une en **una sola entidad**:

```
PERSON "Juan Pérez JUZGADO CIVIL"   bbox = 525 × 521 pt   rotation: ausente
```

Sobre una página de 595 × 842 pt. Arranca en el folio del margen izquierdo y termina en el sello del derecho; como sus palabras no coinciden en ángulo (270 y 90), `rotation` queda ausente (ADR-066 §6); y como solapa media página, Grouping la descarta por conflicto de solapamiento. **El folio nunca llega al reemplazo.**

**§23b — el sello en mayúsculas.** Sobre `JUZGADO CIVIL 12 — PERITO CARLOS LOPEZ — DNI 42.998.103` el modelo devuelve **cero** tokens etiquetados. La misma línea en Title Case devuelve `PER :: Perito Carlos Lopez` con score 0,999. El modelo es *cased*: la caja alta no es un detalle de estilo, es texto que no sabe leer.

### 2. Lo que las une: el modelo lee frases que no existen

ADR-067 §4 emite los runs rotados **después** de todo el texto horizontal, en una pasada aparte. Fue la decisión correcta —evita partir una línea horizontal al medio— y logró lo que buscaba: cada run sale **contiguo**. Pero deja un efecto que nadie miró: dos runs de márgenes opuestos quedan **pegados uno al otro** en `Page.text`. Sobre este fixture:

```
… +54 11 1234-5678. FIEL COPIA Folio 214 — Juan Pérez JUZGADO CIVIL 12 — PERITO …
                                └── folio, margen izquierdo ─┘└── sello, margen derecho ──
```

El modelo recibe eso como una oración. Y responde como corresponde a una oración: `Juan Pérez JUZGADO` parece un nombre seguido de un apellido en caja alta. **No es un falso positivo del modelo; es una entrada que no describe la página.** Es exactamente el mismo diagnóstico que ADR-067, Contexto §1 —"no es un falso negativo del modelo: es una entrada corrupta"—, un nivel más arriba: ADR-067 arregló el orden *dentro* de cada run, y quedó el borde *entre* runs.

La caja alta es el otro lado de lo mismo: `PERITO CARLOS LOPEZ` es texto que el modelo no puede leer, y sobre el que va a devolver lo que devuelva sin que nadie se entere.

### 3. Por qué no se arregla en Grouping

La sospecha del informe era que `normalizedValue` no plegaba acentos. Verificado que no es el problema, por dos caminos independientes:

1. `normalizeForComparison` (`Contracts.md` §6) **sí** pliega diacríticos y caja.
2. Aun si no lo hiciera, `levenshteinNormalized("carlos lopez", "carlos lópez") = 0,917`, por encima del umbral de 0,88 — agruparían igual por el pase difuso.

Grouping no puede agrupar lo que nunca recibe. Las dos fugas nacen antes, en qué texto se le da al modelo.

## Decisión

### 1. Un batch de inferencia nunca mezcla orientaciones

`computeWordChunks` parte hoy solo por `batchSize` (ADR-024 §2). Pasa a partir **además** en todo cambio de `bbox.rotation` entre palabras consecutivas — tratando ausente y `0` como el mismo valor, según `Contracts.md` §5.

`batchSize` sigue siendo el máximo de palabras por lote y sigue siendo la unidad de los checkpoints de cancelación (§12 del spec): las corridas solo **agregan** bordes, nunca los sacan, así que los checkpoints se vuelven más frecuentes, nunca menos.

**Una página sin texto rotado produce exactamente los mismos batches que hoy**, palabra por palabra. Todo el costo y todo el riesgo de este punto viven en las páginas que tienen runs rotados.

Medido sobre `qa-stamp.pdf`: con el folio como batch propio, el modelo devuelve `PERSON "Juan Pérez"` con score **1,000** y bbox contenido en el run. La entidad de media página desaparece.

### 2. Las corridas en caja alta se pasan a Title Case solo para la inferencia

Dentro del kernel (`kernelClassify`), antes de clasificar, el texto del batch se transforma; el resultado se clasifica; y los **valores de los spans se cortan del texto original**, nunca del transformado. La transformación preserva la longitud carácter a carácter, así que los offsets valen en los dos y `NerKernelSpan` no cambia de forma.

Una **corrida en caja alta** es una secuencia maximal de **dos o más** palabras consecutivas (separadas por un espacio) que cumplen las tres condiciones:

1. tiene al menos una letra;
2. no tiene ninguna minúscula (`w === w.toUpperCase() && w !== w.toLowerCase()`);
3. **no tiene un punto seguido de letra** (`/\.\p{L}/u`) — el guard de acrónimos.

Cada palabra de una corrida se pasa a Title Case: primera letra como está, el resto en minúscula. Una palabra cuya transformación cambia de longitud se deja intacta (defensa contra los casos de Unicode donde el mapeo de caja no es 1:1).

**El guard de la condición 3 no es decorativo, y no estaba en la primera redacción.** Sin él, sobre `"… Empresa S.A., CUIT 20-12345678-9 …"` las palabras `S.A.,` y `CUIT` forman una corrida de dos y se transforman en `S.a., Cuit`: medido, eso **degradó** la organización del cuerpo de 0,995 a 0,792 de confianza. Con el guard, `S.A.,` deja de ser elegible, la corrida se corta, `CUIT` queda sola —una palabra no es corrida— y las dos quedan intactas. El mínimo de dos palabras hace el resto del trabajo: `DNI 34.567.891` nunca se toca porque el número no tiene letras.

Medido sobre `qa-stamp.pdf` con las dos condiciones puestas: el sello devuelve `PERSON "PERITO CARLOS LOPEZ"` con score 0,999 —el valor con su caja original, que es lo que va al `canonicalValue` del grupo— y el cuerpo horizontal devuelve **las mismas cinco entidades que hoy**, con las mismas confianzas.

### 3. Lo que este ADR NO cambia

- **El orden de lectura de ADR-067 queda intacto.** Los runs se siguen emitiendo al final, contiguos y en una pasada aparte. Lo que cambia es dónde se corta el texto para la inferencia, no en qué orden sale `Page.text`. Ningún otro consumidor (`Regex`, la lupa, el export) ve una diferencia.
- **Ningún contrato público.** No hay tipos, eventos ni error codes nuevos; `NerPagePayload` y `NerKernelSpan` conservan su forma; las firmas de §6 del spec no se tocan.
- **`normalizeNerValue` no se toca en este ADR.** Diverge de `normalizeForComparison` (no pliega diacríticos), y es una divergencia real que conviene cerrar — pero **no cambia ninguno de los casos medidos acá**, así que cambiarla ahora sería mover una comparación sin evidencia que lo pida. Queda anotada en Consecuencias.
- **§23c (la carátula `Pérez, Juan`) sigue abierta**, y este ADR no la toca. Medido: el modelo etiqueta solo `Juan`, con score 0,592–0,699 según el contexto, siempre por debajo del `confidenceThreshold` de 0,7. Es otro problema y va por otro camino.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Partir el batch por orientación (§1) | Chequear adyacencia en `aggregateTokensToSpans`: un `I-` que no es contiguo en el texto al span abierto lo cierra | Es correcto y hay que hacerlo algún día, pero **no arregla este caso**: entre `Pérez` del folio y la `J` de `JUZGADO` hay exactamente un espacio, así que son adyacentes y la guarda no dispara. Ataca el síntoma un paso después de donde nace. |
| Partir el batch por orientación (§1) | Separar los runs en `Page.text` con un separador que corte la oración (un `\n`, un `.`) | Cambia `Page.text`, que es entrada de **Regex** y de la lupa además de NER, y correría todos los offsets de todos los consumidores. Un cambio de contrato de hecho para arreglar un problema de un solo motor. |
| Partir el batch por orientación (§1) | Dejar el texto rotado fuera de NER | Es justo el dato que ADR-066/ADR-067 pelearon para hacer llegar al detector: el nombre del firmante de una pericia vive en un run a 90°. |
| Title Case solo para inferencia (§2) | Una **segunda** pasada de inferencia solo sobre los segmentos en caja alta, mezclando spans con los de la primera | Duplica el costo de inferencia en cualquier página con caja alta, y obliga a resolver solapamientos entre spans de dos pasadas. La pasada única sale gratis y, medida, no toca el texto que ya andaba. |
| Title Case solo para inferencia (§2) | Bajar el `confidenceThreshold` | No aplica: sobre caja alta el modelo no devuelve tokens **con ninguna confianza**, no devuelve tokens. |
| Title Case solo para inferencia (§2) | Un modelo *uncased* | Cambia el asset de 178 MB, la calidad sobre el 99 % del texto que hoy anda, y el gate de recall entero. Desproporcionado frente a una transformación de string medida. |
| Cortar los valores del texto original | Cortarlos del transformado | El `canonicalValue` del grupo es lo que el usuario ve en el panel y lo que "Ver ocurrencias" busca en el documento: tiene que decir `PERITO CARLOS LOPEZ`, como está impreso, no `Perito Carlos Lopez`. |

## Consecuencias

**Positivas**:

- **§23a y §23b cierran**: las dos fugas de nombre de `qa-stamp.pdf` pasan a detectarse, medidas con el modelo real. Los `it.fails` de `tests/integration/qa-stamp-detection.test.ts` correspondientes pasan a `it`.
- El caso que motivó ADR-067 —el nombre del firmante en un run a 90° de una pericia real— queda además protegido de contaminarse con el run vecino, que es lo único que le faltaba.
- El texto en caja alta deja de ser un punto ciego. Sellos, carátulas, encabezados y membretes de expediente lo usan sistemáticamente, así que el alcance es mucho mayor que este fixture.
- Costo cero en la página típica: sin texto rotado, los batches son idénticos; sin corridas en caja alta, el texto que se clasifica es el mismo objeto.

**Negativas**:

- **Batches más cortos ⇒ menos contexto ⇒ el modelo puede etiquetar distinto.** Medido en este fixture: el batch del sello produce `ORGANIZATION "DNI"` con score 0,999, un falso positivo que el texto de página completo no producía. Consecuencia real: un grupo de Organización de más, que tapa el literal `DNI` del sello y que el usuario puede deshabilitar desde el panel. Se acepta a cambio de cerrar dos fugas, y se anota: la precisión se gobierna con el dataset de referencia del Hito 11 (`tests/fixtures/README.md`), no caso por caso.
- **La guarda de ADR-066 §6 queda inalcanzable desde `processPage`** (hallazgo de la implementación, no previsto al redactar). Esa regla dice que si las palabras de un span discrepan en el ángulo, `rotation` queda ausente en la `Occurrence`. Con §1 un batch es de una sola orientación, así que un span **no puede** abarcar palabras de ángulos distintos: la rama sigue en `mapSpanToWords` como defensa en profundidad, pero ninguna ruta de producción la recorre. El test que la cubría (`omits rotation when the words of the entity disagree on the angle`) se reescribe para afirmar la garantía **más fuerte** que la reemplaza —las palabras que discrepan nunca comparten ocurrencia, y cada una conserva su ángulo—, que es lo que el producto necesitaba de aquella regla.
- Una página con muchos runs rotados hace más despachos de inferencia que antes (uno por run en vez de uno cada 256 palabras). Cada uno es más chico, así que el trabajo total del modelo no crece de forma apreciable, pero el overhead por despacho sí se paga más veces.
- Un documento **entero** en caja alta —los hay, en expedientes viejos— pasa a clasificarse en Title Case de punta a punta. Es mejor que hoy (hoy no se detecta nada), pero no es el régimen sobre el que el modelo se entrenó y no está medido.
- `normalizeNerValue` sigue divergiendo de `normalizeForComparison`: no pliega diacríticos, mientras `Contracts.md` §6 define esa función como **la** normalización de comparación de texto libre. Hoy lo tapa el pase difuso de Grouping (0,917 sobre un umbral de 0,88 para un acento de diferencia). Queda como deuda anotada, no como parte de este ADR.

## Validación

- Test de integración (`tests/integration/qa-stamp-detection.test.ts`, ya existente): los `it.fails` de §23a y §23b pasan a `it` y quedan verdes con el pipeline real.
- Test unit (`ner-engine`): una página **sin** texto rotado produce exactamente los mismos chunks que antes del ADR — la garantía de no regresión de §1.
- Test unit: una página con un run a 90° y otro a 270° produce un chunk por run, ninguno mezclado, y los offsets de cada chunk siguen apuntando al mismo texto dentro de `Page.text`.
- Test unit: un run más largo que `batchSize` se sigue partiendo por `batchSize` dentro del run.
- Test unit (kernel): `PERITO CARLOS LOPEZ` se clasifica en Title Case y el `value` del span sale con la caja **original**.
- Test unit (kernel): `S.A., CUIT` **no** se transforma (guard de acrónimos, §2 condición 3), y `DNI 34.567.891` tampoco (mínimo de dos palabras).
- Test unit (kernel): un texto sin ninguna corrida en caja alta se clasifica sobre el mismo string, sin transformar.
- Test edge: una página de una sola palabra rotada; un batch todo en caja alta; una palabra cuya transformación cambiaría de longitud.
- Cobertura ≥ 85% líneas en `ner-engine`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract` verdes.

## Referencias

- `roadmap/Post_Hito10.8_Pendientes.md` §23 (los hallazgos del gate manual)
- `roadmap/Calidad_De_Deteccion_Informe.md` (el informe que ordenó el trabajo; sus hipótesis para §23a/§23b quedan corregidas por este ADR)
- `core/NER_Engine.md` §12 (batches y cancelación), §15 (checklist)
- `core/Contracts.md` §5 (`BoundingBox.rotation`, ausente ≡ 0), §6 (`normalizeForComparison`)
- `adr/ADR-024-NerStarted-ModelLoading-BatchSize.md` §2 (`batchSize` en palabras)
- `adr/ADR-046-NerEngine-Pool-Propia-Kernel-Puro.md` §2, §3 (un despacho por batch)
- `adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md` §4 (los runs al final, contiguos — intacto)
- `ai/AI_Development_Guide.md` R-1, R-2, R-13, R-18, R-19, R-21
