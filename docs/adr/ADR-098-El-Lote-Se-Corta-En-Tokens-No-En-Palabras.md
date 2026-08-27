<!-- CONTEXT: scope=adr | dependencias=core/NER_Engine.md,core/Contracts.md,adr/ADR-024-Ner-Batching.md,adr/ADR-046-Reparto-Host-Kernel-NER.md,adr/ADR-088-Runs-Rotados-Y-Caja-Alta.md,roadmap/Optimizacion_De_Rendimiento.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-098 — El lote se corta en tokens, no en palabras

- **Estado**: Accepted
- **Fecha**: 2026-08-27
- **Decidido por**: El humano, tras el relevamiento de rendimiento del 2026-08-27 que destapó el defecto.
- **Relacionado con**: **ADR-024 §2 (superseded en su premisa)**, ADR-046 §1 (el reparto host/kernel que esta decisión respeta), ADR-088 §2 (el `inferenceText` sobre el que se corta)
- **Parte de**: Hito 11, calidad de detección

> Convención de citas: `ADR-098 §N` refiere a **Decisión §N**.

## Contexto

### 1. El lote se corta en palabras; el modelo trunca en tokens

`computeWordChunks` (`ner.engine.ts`) corta cada lote en `batchSize` **palabras** — 256 por default (`config.ts`). El modelo trunca en 512 **tokens**: `model_max_length: 512` en el `tokenizer_config.json` y `max_position_embeddings: 512` en el `config.json` del modelo mirroreado.

El pipeline de Transformers.js tokeniza con `padding: true, truncation: true` y **sin `max_length` explícito** (`pipelines/token-classification.js`), así que cae en el `model_max_length` del tokenizer y **descarta la cola sin error, sin warning y sin log**. El kernel no chequea la longitud en ningún lado.

### 2. La razón tokens/palabra no es constante, y en el documento objetivo es alta

Medido con el **tokenizer real del modelo**, sobre 256 palabras:

| texto | tokens | razón | |
|---|---|---|---|
| prosa natural | 364 | 1,42 | ok |
| **párrafo legal denso** (nombres + DNI + CUIT + teléfono) | **654** | 2,55 | **trunca** |
| identificadores puros | 1567 | 6,12 | **trunca** |

ADR-024 §2 eligió las palabras a sabiendas, llamándolas *"proxy de tokens"*. La premisa es que el proxy sea estable. **Está falsificada**: varía de 1,42 a 6,12 según el contenido, y el caso que la rompe —identificadores pegados a nombres— es exactamente el documento al que apunta el producto.

### 3. Reproducido de punta a punta

`tests/fixtures/reference/doc-026.pdf` (agregado con esta decisión) es una página de ~230 palabras de cláusula jurídica densa, con tres entidades de NER colocadas **a propósito**: una antes del corte de 512 tokens y dos después.

Medido con el harness de `tests/measure/` —app real en Chromium, modelo real— **antes** de esta decisión:

```
NER — recall de cobertura: 1/3 (33,3 %)
Entidades sin cubrir:
  PERSON  "Rosana Ferreyra"
  ADDRESS "Rivadavia 4820"
```

Las dos que faltan son las que caen pasada la marca. `Marcelo Duarte`, al principio, aparece siempre.

### 4. Lo que **no** sirve como arreglo

**Bajar `batchSize`.** El host cuenta palabras y no tiene tokenizer (vive en el kernel, ADR-046 §1). Un presupuesto de palabras que sea seguro para el peor caso medido (razón 6,12) serían ~80 palabras: haría **tres veces más despachos** en prosa, donde el problema no existe, para cubrir un caso que se detecta exacto en el lugar donde sí hay tokenizer.

**Inyectar el límite por config.** El límite no es una preferencia: sale del modelo (`model_max_length`). Un campo de config que lo repita es una segunda fuente de verdad que puede desincronizarse del modelo cargado.

## Decisión

### 1. El kernel parte un lote que excede el presupuesto de tokens, antes de inferir

`kernelClassify` mide el `inferenceText` con **el tokenizer del pipeline ya cargado** (`classifier.tokenizer`, propiedad pública) y, si excede el presupuesto, lo parte en sub-lotes que entren, infiere cada uno y concatena.

El presupuesto sale del propio tokenizer (`model_max_length`), menos los tokens especiales que agrega el encoder. No se hardcodea 512.

### 2. El corte se busca con el tokenizer, nunca estimando por una razón

La razón varía de 1,42 a 6,12 (§Contexto 2): estimar por un promedio vuelve a fallar en el mismo caso. El corte se busca por **bisección sobre el índice de palabra**, midiendo con el tokenizer en cada paso — ~8 tokenizaciones por sub-lote, todas en JS puro y sin tocar el modelo.

El corte cae siempre en un **límite de palabra**: partir adentro de una palabra le daría al modelo un fragmento que no existe en el documento.

### 3. Los spans vuelven a coordenadas del lote

Cada sub-lote produce `NerKernelSpan` con offsets relativos a **sí mismo**. Antes de concatenar se les suma el desplazamiento del sub-lote dentro del lote, así que el contrato con el host no cambia: sigue recibiendo offsets relativos al texto del batch (ADR-046 §1).

`titleCaseUppercaseRuns` (ADR-088 §2) mapea carácter a carácter y **no cambia la longitud**, así que un índice de corte vale igual para el `inferenceText` y para el texto original — que es lo que permite cortar los valores del original y no del transformado.

### 4. Esto no cambia ningún contrato público

No se toca `NerConfig`, ni `NerKernelSpan`, ni el reparto host/kernel de ADR-046. `batchSize` sigue significando lo mismo y sigue siendo el corte primario; lo de acá es una **red de contención** adentro del kernel, que es el único lugar del sistema que sabe cuántos tokens tiene un texto.

## Consecuencias

**A favor**

- Se recupera detección que hoy se pierde en silencio, en el tipo de documento que el producto apunta.
- El límite sale del modelo, así que cambiar de modelo no deja el número viejo colgado.
- Sin dependencia nueva, sin contrato modificado, sin segunda pasada por el modelo salvo cuando el lote de verdad no entra.

**En contra**

- Un lote que excede paga varias inferencias en vez de una. Es más trabajo, pero la alternativa era no analizar esa parte del texto.
- La bisección agrega tokenizaciones. Son baratas (JS puro, sin modelo) pero no son gratis.
- Una entidad que caiga **exactamente sobre el corte** entre dos sub-lotes se puede partir. Es el mismo riesgo que ADR-024 ya acepta para el corte por `batchSize`, y no lo empeora: agrega cortes solo donde antes había truncamiento, o sea donde no había nada.

**Lo que queda sin medir**

- Cuán seguido un documento real excede el presupuesto. `doc-026` lo fuerza a propósito; no sabemos la frecuencia en un expediente de verdad.
