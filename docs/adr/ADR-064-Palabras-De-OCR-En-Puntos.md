<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/OCR_Engine.md,core/PDF_Engine.md,core/Orchestrator.md,core/Render_Engine.md,architecture/03_Data_Model.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md,adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md,adr/ADR-045-OcrEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=10.8 -->

# ADR-064 — Las palabras de OCR salen en puntos de página, no en píxeles del raster

- **Estado**: Accepted
- **Fecha**: 2026-08-09
- **Decidido por**: El humano, al pedir un ADR aparte tras el hallazgo. Apareció al especificar el paso 2 del Hito 10.8 (OCR por región), que necesita traducir coordenadas de un recorte a coordenadas de página y no puede apoyarse en una traducción de página que no existe.
- **Relacionado con**: ADR-014 y ADR-041 (la fusión OCR→PDF, que es donde el defecto se materializa), ADR-034 §1 (`rasterizePage` y el `scale = dpi/72` que lo origina), ADR-045 (el kernel puro donde vive el fix), ADR-063 (el **otro** defecto de coordenadas del mismo hito, de causa independiente)
- **Parte de**: Hito 10.8, paso 0 — **bloquea** el paso 2

> Convención de citas: `ADR-064 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-064, Contexto §N`.

## Contexto

### 1. El contrato dice puntos y el motor produce píxeles

`architecture/03_Data_Model.md` §137 es explícito sobre el espacio de coordenadas de todo `BoundingBox`:

> `bbox` está en coordenadas de página (puntos PDF, origen esquina superior-izquierda).

El kernel de OCR arma el bbox directo de los `x0/y0/x1/y1` de Tesseract (`ocr-engine/src/worker/kernel.ts`, `toWords`):

```ts
bbox: {
  x: w.bbox.x0,
  y: w.bbox.y0,
  width: w.bbox.x1 - w.bbox.x0,
  height: w.bbox.y1 - w.bbox.y0,
},
```

Esos valores son **píxeles de la imagen que se le pasó**, y esa imagen no está a 72 DPI. El Orchestrator la rasteriza con `scale = ctx.config.ocr.dpi / 72` (`orchestrator.ts`, ADR-034 §1), que con el default de 300 DPI vale **4,1667**.

### 2. La conversión inversa no existe en ninguna parte

`dpi / 72` aparece **una sola vez** en todo el Core, y es esa: la que escala hacia arriba para rasterizar. No hay ningún `72 / dpi` ni equivalente. Las palabras viajan intactas desde el kernel hasta `Page.words`:

1. `ocr.engine.ts` desestructura `{ words, confidence }` del resultado del kernel y las devuelve tal cual en `OcrPageOutput`, y las deposita igual en `ctx.cache`.
2. El Orchestrator las lee de `ctx.cache` en `handleOcrPageFinished` e invoca `fuseOcrPage(document, pageIndex, words)`.
3. `fuseOcrPage` (`pdf-engine`, ADR-041) normaliza NFC y ordena, pero **no toca la geometría** — ni tiene por qué: su contrato dice que recibe `Word`s ya formados.

### 3. El consumidor asume puntos y vuelve a escalar, así que el error se compone

`render-engine/src/worker/kernel.ts`, en `paintReplacements`:

```ts
const bbox = scaleBbox(replacement.bbox, scale);
```

O sea que el render toma el bbox como puntos y lo multiplica por la escala de render. Un bbox que ya venía en píxeles a 300 DPI se escala **dos veces**.

Y la cadena que lleva de `Word` a `Replacement` está cerrada: `regex-engine` arma el bbox de cada ocurrencia como unión de los `Word.bbox` que la cubren (`mapSpanToWords`), y de ahí pasa al grupo y al `Replacement`.

**Consecuencia**: en cualquier página que haya pasado por OCR, el rectángulo de censura sale ~4,17× de tamaño y desplazado por el mismo factor. Para la mayoría de las palabras cae fuera de la página. El dato sensible queda visible **y** se tapa un área que no corresponde.

### 4. Por qué no se detectó antes

Ningún test fija el espacio de coordenadas. El fixture de `tests/integration/ocr-pdf-fusion.test.ts` usa un bbox de valores arbitrarios (`{ x0: 10, y0: 10, x1: 100, y1: 30 }`) que pasa igual en píxeles o en puntos, y los tests del propio motor solo verifican que las palabras se propaguen y se ordenen. El defecto solo es visible al mirar el PDF exportado de un documento escaneado.

La pericia real que originó el Hito 10.8 tampoco lo expuso: su única página con imagen es justamente la que el paso 2 rescata —hoy nunca llega a OCR, porque le basta una palabra nativa para quedar marcada como página con texto— y las otras cuatro son texto nativo puro.

### 5. Por qué bloquea el paso 2 del hito

El paso 2 OCR-ea **una región** de la página y necesita traducir las coordenadas del recorte a coordenadas de página. Especificar esa traducción sobre una base donde la traducción de página entera está rota significaría escribir en cinco specs una premisa falsa. Este ADR es la precondición, no un desvío.

## Decisión

### 1. El kernel convierte a puntos antes de devolver las palabras

`toWords` gana el `dpi` del payload (`OcrPagePayload.dpi`, que ya viaja hasta el kernel) y convierte cada `bbox` con el factor exacto:

```
pt = px · 72 / dpi
```

Aplicado a `x`, `y`, `width` y `height`. Es una multiplicación escalar sin corrimiento de origen: el raster de `rasterizePage` sale de `getViewport({ scale })`, cuyo origen es la esquina superior-izquierda con `y` creciendo hacia abajo — **la misma convención** que `03_Data_Model.md` §137 exige. Lo único que difiere es la unidad; no hay flip ni traslación.

### 2. El orden de lectura se calcula **antes** de convertir

`sortWordsByReadingOrder` del kernel usa una tolerancia de **1px** para decidir "misma línea" (dos palabras de una misma línea impresa casi nunca comparten `y0` exacto). Si la conversión corriera primero, esa tolerancia pasaría a valer 1 **punto** ≈ 4,17 px a 300 DPI, y el agrupado por línea cambiaría de comportamiento como efecto colateral silencioso de un cambio de unidades.

Se ordena en píxeles con la tolerancia de 1px intacta y se convierte después, en un `map` que preserva el orden. El array resultante queda **en el mismo orden que hoy**, palabra por palabra. El invariante público de `OCR_Engine.md` §10 (`bbox.y` asc, luego `bbox.x` asc) se conserva: un escalado positivo uniforme no altera un orden.

### 3. `OcrPageInput.dpi` pasa a ser precondición documentada, no un dato informativo

Hoy `dpi` viaja hasta el kernel y **no se usa para nada**. Al convertirse en el divisor de la conversión, deja de ser decorativo: `dpi` **debe** ser el DPI con el que se rasterizó `imageData`.

Hoy eso se cumple —el Orchestrator deriva las dos cosas del mismo `ctx.config.ocr.dpi`, `scale = dpi/72` para rasterizar y `dpi` para el input— pero son **dos expresiones separadas** que nada obliga a moverse juntas. Se documenta como precondición explícita en `OCR_Engine.md` §9 y como responsabilidad del caller en `Orchestrator.md` §2. No se agrega un mecanismo para forzarlo: el acoplamiento vive en tres líneas contiguas de un solo archivo, y un guard de runtime no tendría contra qué comparar.

### 4. `dpi > 0` es una restricción de entrada

`dpi ≤ 0` (o no finito) pasa a lanzar `InvalidInputError`, junto al resto de las restricciones de `OCR_Engine.md` §9. Antes era inocuo porque el valor no se leía; ahora es una división por cero o una geometría sin sentido.

### 5. La conversión va en el kernel, y en ningún otro lado

Tres lugares donde **no** va, con su motivo:

- **`fuseOcrPage` (`pdf-engine`)**: no conoce el DPI ni tiene por qué. Meterlo ahí exige un parámetro nuevo en una función pura de otro motor, para arreglar un defecto que no es suyo.
- **El Orchestrator**: podría hacerlo al leer el cache, pero entonces las `Word` de `OcrPageOutput` —la salida pública del motor— seguirían estando en píxeles, y cualquier otro consumidor heredaría el bug. El motor debe devolver su contrato bien.
- **`render-engine`**: es el consumidor. Compensar ahí dejaría el dato mal en el modelo y el arreglo escondido en el pintado, que es exactamente cómo nació este defecto.

El kernel es el único punto que tiene, a la vez, los píxeles crudos y el DPI con que se produjeron.

### 6. Sin cambios de firma pública

`OcrPageInput`, `OcrPageOutput`, `OcrConfig` y la clase `OcrEngine` quedan idénticos. `Contracts.md` no se toca. Cambia el **significado de los valores** que ya viajaban, no la forma — por eso el fix es de un módulo (R-1) y no arrastra a los otros cuatro que participan de la cadena.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Convertir en el kernel de `ocr-engine` | Convertir en `fuseOcrPage` (`pdf-engine`) | La función no conoce el DPI; habría que agregárselo como parámetro, cambiando el contrato de una función pura de otro motor para arreglar un defecto ajeno. |
| Convertir en el kernel | Convertir en el Orchestrator al leer `ctx.cache` | Dejaría `OcrPageOutput.words` —salida **pública** del motor— en píxeles, o sea el bug intacto para cualquier consumidor futuro, con el parche escondido en el caller. |
| Convertir en el kernel | Compensar en `render-engine` al pintar | Deja el dato mal en el modelo y el arreglo enterrado en el pintado. Es el patrón que produjo este defecto. |
| Ordenar en píxeles y convertir después | Convertir primero y ordenar en puntos | La tolerancia de "misma línea" pasaría de 1px a 1pt (≈ 4,17px a 300 DPI) sin que nadie lo pidiera: un cambio de comportamiento del agrupado por línea, colado dentro de un cambio de unidades. |
| Documentar `dpi` como precondición | Agregar un guard de runtime que verifique que `imageData` corresponde a ese DPI | El motor no conoce el tamaño en puntos de la página: no tiene contra qué comparar. Un guard necesitaría un dato nuevo en el input solo para verificar el que ya está. |
| Un ADR propio, previo al paso 2 | Absorberlo dentro del ADR del paso 2 | Son módulos distintos (`ocr-engine` contra `pdf-engine` + `render-engine` + façade) y problemas distintos: este es un defecto vivo que afecta **hoy** a todo documento escaneado, con o sin Hito 10.8 (R-1, R-5). |

## Consecuencias

**Positivas**:

- La censura cae donde corresponde en documentos escaneados. Es un defecto que hoy expone datos sensibles en el export: la caja se pinta lejos y el dato queda a la vista.
- `Word.bbox` pasa a tener un único espacio de coordenadas sea cual sea el `source`, que es lo que `03_Data_Model.md` §137 ya afirmaba y el código incumplía. Todo lo aguas abajo —`mapSpanToWords`, el bbox unión de las ocurrencias, el hit-test de ADR-061, el `lineWords` de ADR-058— deja de tener un caso especial no escrito para páginas OCR.
- Desbloquea el paso 2 del Hito 10.8.
- El orden de lectura queda **bit-idéntico** al actual (§2), así que el cambio no puede regresionar nada que dependa del orden de `words`.

**Negativas**:

- `dpi` gana una responsabilidad real y con ella una forma nueva de romper las cosas: un caller que pase un `dpi` distinto del usado para rasterizar produce geometría mal escalada, en silencio. Mitigado con la precondición documentada de §3, no con código.
- Los tests que fijen bbox de OCR con valores crudos de Tesseract cambian de números esperados. Es el síntoma correcto: hoy pasan porque no verifican nada del espacio de coordenadas (Contexto §4).

## Validación

- Test unit nuevo (`ocr-engine`): un bbox de Tesseract de `(0, 0)–(417, 417)` px con `dpi = 300` produce `{ x: 0, y: 0, width: 100.08, height: 100.08 }` pt.
- Test unit nuevo: con `dpi = 72` la conversión es la identidad (factor 1) — fija la fórmula en el caso degenerado.
- Test unit nuevo: el **orden** de las palabras devuelto es idéntico al que produce el mismo input sin conversión, incluida la tolerancia de misma-línea (§2).
- Test edge nuevo: `dpi = 0`, negativo o no finito → `InvalidInputError` (§4).
- Test de integración (`tests/integration/ocr-pdf-fusion.test.ts`): el fixture pasa a usar píxeles a un DPI conocido y verifica que el `Word` fusionado queda en puntos — el test que hoy no distingue los dos espacios (Contexto §4).
- Cobertura ≥ 85% líneas en `packages/anonymization-core/ocr-engine/src/**`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract` verdes.

## Referencias

- `core/OCR_Engine.md` §9, §10, §11, §13, §14 (versión 1.3.0)
- `core/Orchestrator.md` §2 (precondición del `dpi` que pasa el caller)
- `core/PDF_Engine.md` §6 (`fuseOcrPage`: precondición de espacio de coordenadas de las `words` entrantes)
- `architecture/03_Data_Model.md` §137 (el invariante que este ADR hace cumplir)
- `adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md`, `adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md` (la fusión)
- `adr/ADR-034-Auditoria-Pre-Hito9-Orchestrator.md` §1 (`rasterizePage`, `scale = dpi/72`)
- `adr/ADR-045-OcrEngine-Pool-Propia-Kernel-Puro.md` (el kernel donde vive el fix)
- `adr/ADR-063-Bbox-De-Texto-Rotado.md` (el otro defecto de coordenadas del hito, independiente de este)
- `ai/AI_Development_Guide.md` R-1, R-5, R-19, §5 (ambigüedad: el protocolo por el que este hallazgo se reportó antes de escribir el paso 2)
