<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/PDF_Engine.md,core/OCR_Engine.md,architecture/03_Data_Model.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-064-Palabras-De-OCR-En-Puntos.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=10.8 -->

# ADR-067 — El orden de lectura agrupa los runs rotados antes de concatenar

- **Estado**: Accepted
- **Fecha**: 2026-08-13
- **Decidido por**: El humano, tras verificar en la app real que la firma digital de la pericia produce grupo de Fecha pero **ninguno de Persona**: el nombre del firmante queda en claro en el PDF anonimizado.
- **Relacionado con**: ADR-066 §6 (`BoundingBox.rotation`, la señal que este ADR consume), ADR-066 §9 (que dejó este hueco anotado como "el trabajo que sigue"), ADR-064 §2 (el orden se calcula antes de convertir unidades, invariante intacto), ADR-065 §3 (`fuseOcrRegion` reordena, y hereda este orden)
- **Supersede**: **ADR-063 §4** (el orden de lectura sí cambia, para texto rotado). Ver Contexto §3.
- **Parte de**: Hito 10.8, paso 4

> Convención de citas: `ADR-067 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-067, Contexto §N`.

## Contexto

### 1. El nombre del firmante nunca llega al detector

ADR-066 cerró la extracción: los cinco runs de la firma producen `Word`s, con `rotation: 90` y bbox correcto. Verificado ejecutando el motor real contra la pericia. Pero al cargar el documento en la app, la lista de entidades sale así:

```
Organizaciones (1) · Direcciones (2) · Teléfonos (1) · Fechas (1)
```

**No hay Personas.** Sobre la firma quedan en claro el nombre y apellido de quien firma, el motivo y la ubicación; solo la fecha se tapa, porque es un token suelto que un patrón de regex reconoce sin contexto.

La causa está en `Page.text`, que es lo que reciben Regex y NER. Medido sobre la página 1:

```
… Milagros SIMP electrónica 12:30:18 - los SIMP de Argentina by Rocio
07/07/2026 signed Firma Albarracin, Digitally Location: Reason: Date:
```

El nombre real es *Albarracin, Rocio de los Milagros*. Sale disperso —`… Milagros … los … de … Rocio … Albarracin,`— con palabras de los otros cuatro runs intercaladas. Ningún NER reconoce una entidad así, y no es un falso negativo del modelo: es una entrada corrupta.

### 2. La aritmética que lo produce

`sortWordsByReadingOrder` (`pdf.engine.ts`) ordena por `bbox.y` asc y luego `bbox.x` asc. Para un run a 90° el texto avanza hacia `+y` en espacio PDF, o sea hacia **arriba** en pantalla: el token N+1 tiene **menor** `bbox.y` arriba-izquierda. Ordenar por `y` ascendente **invierte cada run**. Y como los cinco runs de la firma se solapan en `y` —son cinco columnas paralelas de la misma altura—, además quedan intercalados entre sí.

Los seis runs rotados de la página, con sus coordenadas medidas:

| `bbox.x` | cuerpo | contenido real |
|---|---|---|
| 9,3 | 8 | `Albarracin, Rocio de los Milagros` |
| 19,1 | 8 | `Digitally signed by SIMP - Sistema Informático Ministerio Público` |
| 28,9 | 8 | `Date: 07/07/2026 12:30:18` |
| 30,0 | 16 | `CCS E13000013835753` (la marca de agua, otro run) |
| 38,6 | 8 | `Reason: Firma electrónica SIMP SIMP.Penal.API` |
| 48,4 | 8 | `Location: Argentina` |

Cada run tiene un `bbox.x` propio y constante: la columna **es** la identidad del run.

### 3. El argumento de ADR-063 §4 dejó de valer

ADR-063 §4 difirió esto dos veces, con este razonamiento: un orden consciente de columnas *"cambia un invariante compartido con `ocr-engine` y con el modelo de datos, o sea que arrastra a dos motores más y contradice R-1"*.

Dos hechos lo invalidan, y ninguno de los dos existía cuando se escribió:

1. **`BoundingBox` ya tiene `rotation`** (ADR-066 §6). En ADR-063 no había forma de distinguir un word vertical de uno horizontal sin re-derivarlo de la matriz, que el motor ya había descartado. Hoy el campo viaja en el dato.
2. **`ocr-engine` nunca puebla `rotation`.** Verificado en `ocr-engine/src/worker/kernel.ts#toWords`: construye el bbox con `{x, y, width, height}` y nada más — Tesseract no reporta orientación por palabra y el motor no la infiere. Todo word de OCR entra por la rama sin rotación, o sea que un orden que se ramifica **por `rotation`** deja a `ocr-engine` sin un byte de cambio.

El invariante de `03_Data_Model.md` §115 sí cambia, pero solo para words rotados; para todo lo demás queda literal. Es un motor (`pdf-engine`), no tres.

El otro argumento de ADR-063 §4 —*"en ningún caso el texto vertical se concatenaba bien"*— era cierto para una marca de agua de dos tokens, donde invertir casi no daña. Con un run de cinco palabras que contiene un nombre propio, deja de serlo.

## Decisión

### 1. El orden se ramifica por `rotation`, y la rama horizontal no cambia

Un `Word` con `bbox.rotation` ausente o `0` va por el camino de siempre: `bbox.y` asc, luego `bbox.x` asc, con la tolerancia de misma-línea de 1. **Una página sin texto rotado produce el array idéntico, palabra por palabra**, así que el snapshot de `pdf-engine` no se regenera (si cambia, el cambio rompió texto horizontal — mismo criterio que ADR-063).

`rotation: 0` explícito y ausente se tratan igual, como manda `Contracts.md` §5 ("ausente ≡ 0").

### 2. Un run rotado es una columna contigua

Los words con `rotation` 90/180/270 se agrupan en **runs**, con dos criterios que se aplican en orden:

1. **Misma coordenada transversal**, con tolerancia 1 — el eje perpendicular al avance: `bbox.x` para 90/270, `bbox.y` para 180. Es el espejo exacto de la tolerancia de misma-línea que ya usa la rama horizontal.
2. **Contigüidad sobre el eje de avance**: dos words consecutivos de una columna pertenecen al mismo run si el hueco entre ellos es ≤ **2 cuerpos** (el cuerpo es la extensión transversal del bbox: `width` para 90/270, `height` para 180).

El segundo criterio no es decorativo. Medido sobre la página: los huecos reales entre palabras de un mismo run van de 0,44 a 0,58 cuerpos, mientras que el hueco entre la marca de agua y el run `Date:` —que comparten columna con 1,1 pt de diferencia, dentro del rango de un ajuste tipográfico— es de **30 cuerpos**. Verificado subiendo la tolerancia transversal a 3, que fusiona las dos columnas: el corte por hueco las separa igual. Sin este criterio el resultado dependería de un margen de 0,1 pt.

### 3. Dentro de un run, el orden es el del avance

- `90`: `bbox.y` **descendente** (el texto sube en pantalla).
- `270`: `bbox.y` ascendente.
- `180`: `bbox.x` descendente.

### 4. Los runs se emiten en una pasada aparte, después de todo el texto horizontal

`Page.words` sale como `[…texto horizontal ordenado…, …runs rotados…]`. Son **dos `sort` independientes**: el texto horizontal se ordena entre sí con el comparador de siempre, y los runs entre sí por el bbox de su **primera palabra en orden de lectura** (la de abajo de todo en un run a 90°).

Con eso el texto vertical deja de caer en "una posición arbitraria de `Page.text`" (ADR-066 §9) y pasa a ser determinista y **contiguo**: es la contigüidad, no la posición absoluta, lo que un NER necesita para reconocer un nombre.

> **Corrección (2026-08-13, hallazgo en prueba manual sobre la pericia de 5 páginas)**: la primera redacción ubicaba cada run **entre** el texto horizontal, por su ancla, dentro del mismo `sort`. Eso **parte una línea horizontal al medio**, y rompió un caso que antes andaba.
>
> El comparador tiene tolerancia de 1 y por lo tanto **no es transitivo**. Con `La` en `y = 400,0`, `Plata` en `y = 400,8` —la misma línea impresa— y una marca de agua del margen anclada en `y = 401,5`: el ancla queda **fuera** de la tolerancia de `La` (1,5) pero **dentro** de la de `Plata` (0,7), así que se ordena después de `La` y antes de `Plata`. `Page.text` sale `… La CCS E13000013835753 Plata …`.
>
> Y como `mapSpanToWords` une el **rango de índices completo** de un match, el bbox de esa ocurrencia se traga el run entero: medido, una ocurrencia que empieza en `x = 250` salía con `x = 10` — **240 pt corrida hacia el margen izquierdo**, tapando donde no hay nada y dejando el dato a la vista.
>
> Separar las dos pasadas da una garantía **más fuerte** que la que se buscaba en §1: el orden relativo del texto horizontal es idéntico al previo a ADR-067 en **cualquier** página, tenga o no texto rotado, porque ningún ancla ajena participa de su `sort`. De paso elimina el mismo riesgo que ya existía **antes** de este ADR, cuando cada word rotado se ordenaba suelto entre las líneas horizontales.

### 5. `ocr-engine` no se toca

Su copia local del criterio (`OCR_Engine.md` §10) queda como está, por Contexto §3.2: sus words nunca llevan `rotation`, así que la rama nueva no los alcanza. Si algún día `ocr-engine` aprendiera a reconocer texto rotado, poblar `rotation` bastaría para que este orden lo cubra — pero eso es otro ADR y hoy no hay nada que reconciliar. R-1/R-5 se respetan: un PR, un motor.

### 6. `fuseOcrPage`/`fuseOcrRegion` heredan el orden sin cambios

Las dos llaman a la misma función. `fuseOcrRegion` (ADR-065 §3) mezcla nativas + OCR y reordena: las nativas rotadas conservan sus runs, las de OCR entran por la rama horizontal. No hace falta ninguna previsión extra.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Ramificar por `rotation` | Un algoritmo de layout general (XY-cut, columnas por proyección) | Resuelve un problema mucho más grande del que tenemos —incluye el texto horizontal a dos columnas, que hoy nadie reportó— y cambiaría el orden de **todas** las páginas, o sea el snapshot y la entrada de NER de todo documento existente. Riesgo desproporcionado frente a un defecto acotado y medido. |
| Agrupar por columna + hueco | Agrupar solo por columna (tolerancia transversal) | Funciona sobre este documento por 0,1 pt de margen: la marca de agua está a `x = 30,0` y el run `Date:` a `x = 28,9`. Un margen así no es una decisión, es suerte. |
| Agrupar por columna + hueco | Reconstruir el run desde el `TextItem` de pdf.js | Sería más directo, pero el orden se recalcula también en `fuseOcrRegion`, sobre `Word[]` ya materializados donde la identidad del item se perdió. El criterio tiene que funcionar sobre el dato, no sobre su procedencia. |
| Emitir los runs al final, en una pasada aparte (§4) | Ubicar cada run por su ancla, intercalado entre el texto horizontal | **Era la primera redacción, y se revirtió con evidencia**: parte una línea horizontal al medio (el comparador con tolerancia no es transitivo) y el bbox de la entidad partida se traga el run entero. Ver la corrección de §4. Preserva mejor la relación entre orden y geometría, pero a cambio de poder corromper el texto horizontal, que es la mayor parte del documento. |
| Tolerancia transversal 1 | Una tolerancia proporcional al cuerpo | Sería más elegante, pero cambia el criterio de agrupación por un parámetro nuevo sin evidencia que lo pida: con el corte por hueco de §2.2 la tolerancia dejó de ser el criterio que separa los casos medidos. Se mantiene en 1 por simetría con la rama horizontal. |

## Consecuencias

**Positivas**:

- El nombre del firmante pasa a ser una entrada válida para NER: `Albarracin, Rocio de los Milagros` sale contiguo y en orden. Es el dato más sensible de la firma y hoy sale en claro.
- Los otros cuatro runs se reconstruyen íntegros, incluida la marca de agua (`CCS E13000013835753`), que hasta ahora se detectaba en 2 de 5 páginas (ADR-066 §9).
- Cierra el hueco que ADR-063 §4 difirió dos veces, con un alcance de un solo motor.
- No hay regresión posible sobre texto horizontal: la rama es literalmente la de antes.

**Negativas**:

- `03_Data_Model.md` §115 gana una excepción: el invariante deja de ser una línea y pasa a ser dos casos. Mitigado porque el caso nuevo aplica solo a words con `rotation`, que hoy solo produce `pdf-engine` y solo para texto rotado.
- El orden pasa a depender de dos constantes (tolerancia transversal, hueco de 2 cuerpos) en vez de una. Las dos quedan medidas y con dos órdenes de margen sobre los casos reales.
- Un documento con texto rotado en ángulos arbitrarios (no rectos) sigue sin cubrirse: `pdf-engine` no puebla `rotation` ahí (ADR-066 §8), así que esos words caen en la rama horizontal, exactamente como hoy.

## Validación

- Test unit (`pdf-engine`): una página solo con texto horizontal produce el **mismo array** que antes del ADR — la garantía de no regresión.
- Test unit: un run rotado **no parte una línea horizontal**, ni siquiera cuando su ancla cae dentro de la tolerancia de una palabra de la línea y fuera de la de otra (§4, corrección). Es la regresión medida sobre la pericia de 5 páginas.
- Test unit: el orden del texto horizontal es **idéntico** con y sin texto rotado en la misma página (§4, corrección).
- Test unit: cinco runs a 90° paralelos y solapados en `y` se reconstruyen cada uno íntegro y contiguo en `Page.text`.
- Test unit: un run a 90° sale en orden de avance (`y` descendente), no invertido.
- Test unit: dos runs en la misma columna separados por un hueco > 2 cuerpos quedan como dos runs, no como uno.
- Test unit: `rotation: 270` ordena por `y` ascendente; `rotation: 180`, por `x` descendente.
- Test unit: words con `rotation: 0` explícito se ordenan junto a los que no tienen el campo.
- Test unit: `fuseOcrRegion` con nativas rotadas + words de OCR conserva los runs nativos (ADR-067 §6).
- Test edge: una página sin ningún word rotado; un run de un solo word.
- El snapshot de `pdf-engine` **no se regenera** (§1).
- Cobertura ≥ 85% líneas en `pdf-engine`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract` verdes.

## Referencias

- `architecture/03_Data_Model.md` §4 (invariante de `words`)
- `core/PDF_Engine.md` §12, §13, §14 (orden de lectura)
- `core/OCR_Engine.md` §10 (sin cambios — ver §5)
- `core/Contracts.md` §5 (`BoundingBox.rotation`, ausente ≡ 0)
- `adr/ADR-063-Bbox-De-Texto-Rotado.md` **§4 (superseded por este ADR)**, §2 (la envolvente, intacta)
- `adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md` §6 (`rotation` en `BoundingBox`), §9 (el hueco que este ADR cierra)
- `adr/ADR-065-OCR-Por-Region.md` §3 (`fuseOcrRegion` reordena)
- `ai/AI_Development_Guide.md` R-1, R-2, R-5, R-19, R-21
