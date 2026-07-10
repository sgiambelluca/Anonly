<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/NER_Engine.md,adr/ADR-006-NER-Local.md,adr/ADR-018-First-Party-Assets.md,adr/ADR-021-Engines-Inline-Hasta-Hito9.md,roadmap/MVP.md | audiencia=humanos+IA | fase=5 -->

# ADR-023 — NER: nombre canónico de config (`NerConfig`) + modelo multilingüe pinneado

- **Estado**: Accepted
- **Fecha**: 2026-07-10
- **Decidido por**: Repaso de ambigüedades previo al Hito 5, modelo elegido por el humano
- **Relacionado con**: ADR-006 (NER local), ADR-018 (assets first-party), ADR-021 §2 (mismo defecto de alias en OCR)

## Contexto

Antes de arrancar el Hito 5 (`ner-engine`), el repaso del spec detectó dos ambigüedades que
bloqueaban la implementación y son cambios de contrato (requieren ADR antes de código, R-19/R-21):

1. **Nombre duplicado del mismo tipo de config.** `core/Contracts.md` §6 define `NerConfig`
   (`modelId`, `quantization`, `confidenceThreshold`, `batchSize`, `enabled`), y `core/NER_Engine.md`
   §4 (dependencias permitidas) lo cita como el tipo a usar. Pero `NER_Engine.md` §6 y su checklist
   §15.2 definían `NerEngineConfig` con **los mismos cinco campos idénticos**, como si fuera un tipo
   nuevo. Es el mismo defecto que ADR-021 §2 ya corrigió para OCR (`OcrConfig` vs `OcrEngineConfig`).
   El código nunca usó el alias: `packages/anonymization-core/shared` ya construye el config como
   `NerConfig`. El alias solo vivía en el texto del spec.

2. **Modelo default placeholder, no multilingüe.** `NER_Engine.md` §6 y `ADR-006` §Decisión nombran
   `Xenova/bert-base-NER` como default. Ese modelo es la conversión de `dslim/bert-base-NER`,
   entrenado sobre CoNLL-2003 **en inglés** — no es multilingüe. El propio ADR-006 lo marca como
   placeholder ("o equivalente multilingüe fine-tuned") y `roadmap/MVP.md` §2.1 exige explícitamente
   "modelo Q8 multilingüe". A la fecha de este ADR, `assets.lock.json` no tenía ninguna entrada de
   modelo NER: el modelo no estaba ni mirrorado ni pinneado.

## Decisión

### 1. `NerConfig` es el único nombre canónico (se elimina el alias `NerEngineConfig`)

`NerConfig` (de `core/Contracts.md` §6, re-exportado por `@anonly/shared`) es el nombre canónico del
tipo de configuración del motor. El alias `NerEngineConfig` del spec se **elimina** de `NER_Engine.md`
§6 y §15.2 (precedente exacto: ADR-021 §2 para `OcrConfig`). A diferencia del caso OCR, acá no hay
cambio de campos: los cinco campos ya eran idénticos entre Contracts.md y el spec, por lo que es un
rename puro, sin migración de forma. Los valores por defecto (`quantization: "q8"`,
`confidenceThreshold: 0.7`, `batchSize: 256`, `enabled: true`) viven en las constantes de defaults y
en `ADR-006` §Configuración, no en el tipo.

### 2. Modelo multilingüe default: `Xenova/bert-base-multilingual-cased-ner-hrl`

El `modelId` default pasa de `Xenova/bert-base-NER` a **`Xenova/bert-base-multilingual-cased-ner-hrl`**,
cuantizado a **Q8**. Razones: es multilingüe (incluye español, requisito de MVP §2.1 y de la fila
"Modelo solo en español" de ADR-006), tiene **conversión ONNX oficial bajo el namespace Xenova**
(carga directa con `@xenova/transformers`, sin conversión propia), y es el que sostiene el gate de
recall ≥ 85% de `NER_Engine.md` §14. Sigue siendo `NER_MODEL_ID` configurable en settings (ADR-006).

**Pin y mirror (ADR-018).** El modelo se sirve first-party: la entrada del modelo (URL de origen +
`revision` + `sha256` + `sizeBytes`, con `destination` en `apps/react-client/public/models/ner/`) se
agrega a `assets.lock.json` y se materializa con `pnpm assets:mirror` durante el Hito 5 — el mismo
paso que OCR hizo en PR #11. Este ADR fija la **decisión** del modelo; el pin concreto (hash) lo
produce ese paso de mirror y se revisa en el PR, no se inventa acá. La verificación de integridad en
runtime del modelo cargado sigue diferida a Hito 11 (ADR-018 punto 3, `NER_Engine.md` §15.19).

**Corrección de tamaño.** mBERT tiene un vocabulario de ~119k tokens; su Q8 pesa **~150–180 MB**,
no los ~50–80 MB que `ADR-006` §Consecuencias, `NER_Engine.md` §12 y `07_Performance_Strategy.md`
§2.3 estimaron dimensionando sobre un BERT inglés. Esas cifras quedan superadas por este ADR. El
presupuesto de memoria por worker (`NER_Engine.md` §12, 200–400 MB) puede quedar en el extremo alto;
se valida en Hito 9/11.

**Mapeo de labels.** El modelo emite `PER`, `ORG`, `LOC`, `DATE`. Ojo: el model card del modelo
base (`Davlan/...`) lista solo tres tipos; la fuente de verdad es el `id2label` de su `config.json`,
que incluye `B-DATE`/`I-DATE`. El motor mapea **los cuatro**: `PER → Person`, `ORG → Organization`,
`LOC → Address` (aproximación: "location" no es estrictamente "dirección postal") y
`DATE → Date` (`EntityType.Date`, ya existente en `Contracts.md` §5).

**`DATE` se mapea, no se descarta (decisión de producto).** El patrón Date de `Regex_Engine.md`
§Patrones default solo cubre fechas **numéricas** (`\d{1,2}[/-]\d{1,2}[/-]\d{2,4}`); sin el label
`DATE` del modelo, las fechas escritas en palabras ("3 de mayo de 2024") quedarían sin cobertura de
ningún motor. En los documentos objetivo (legales/notariales) una fecha es un cuasi-identificador
(nacimiento, sentencia, escritura) que cruzado con otros datos re-identifica a la persona; ese gap
es inaceptable para una herramienta de anonimización. En consecuencia, el contrato de salida de NER
(`NER_Engine.md` §10) se amplía a `entityType ∈ {Person, Organization, Address, Date}`. No hace
falta regla nueva de deduplicación: si Regex y NER detectan la misma fecha numérica, aplica la
resolución de overlap ya especificada en `Grouping_Engine.md` (gana mayor `confidence`, en empate
Regex; Regex emite `confidence: 1.0`, así que siempre gana). Las fechas numéricas siguen siendo
responsabilidad primaria de Regex (determinístico); NER aporta las formas en lenguaje natural. El
dataset de referencia de `NER_Engine.md` §14 debe incluir fechas escritas en palabras.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Mantener `Xenova/bert-base-NER` | Solo inglés (CoNLL-2003). Viola el requisito multilingüe de MVP §2.1 y ADR-006. |
| `Babelscape/wikineural-multilingual-ner` | Licencia **CC BY-NC-SA 4.0** (solo uso no comercial): descalificante para un producto, con o sin conversión propia. Además, sin conversión ONNX oficial bajo Xenova: exigiría conversión propia con Optimum, más superficie de supply-chain y más difícil de pinnear (ADR-018). |
| `Xenova/distilbert-base-multilingual-cased-ner-hrl` | Más liviano/rápido y con ONNX oficial; se descartó como default por menor recall frente al gate ≥ 85%. Queda como fallback documentado si el presupuesto de memoria/latencia lo exige. |
| Mantener el alias `NerEngineConfig` | Duplica el nombre de un tipo público; el spec se contradice consigo mismo (§4 vs §6). Mismo defecto que ADR-021 §2 rechazó para OCR. |

## Consecuencias

**Positivas**: el spec de NER queda implementable sin frenadas; un único nombre para el tipo de
config, alineado con el código y con Contracts.md; el requisito multilingüe queda satisfecho con un
modelo que se puede servir first-party y pinnear por hash; las estimaciones de tamaño quedan
corregidas antes de que induzcan a error en el dimensionamiento de memoria; las fechas en lenguaje
natural quedan cubiertas sin costo adicional (el label `DATE` viene incluido en el modelo elegido).

**Negativas**: el modelo multilingüe pesa ~2–3× lo estimado originalmente (~150–180 MB Q8), lo que
alarga la descarga inicial (mitigado por lazy loading + `NER_MODEL_LOADING` + cache) y presiona el
presupuesto de memoria por worker; el mapeo `LOC → Address` es una aproximación imperfecta que puede
generar falsos positivos/negativos de direcciones, a validar contra el dataset de referencia (§14);
el mapeo `DATE → Date` suma una fuente probabilística para un tipo que Regex trata como
determinístico — los solapamientos los resuelve la regla de overlap existente de Grouping sin regla
nueva, pero el dataset de referencia (§14) debe incluir fechas en lenguaje natural para medir su
recall real.

## Referencias

- `core/Contracts.md` §6 (`NerConfig`) — `core/NER_Engine.md` §6, §10, §12, §15
- `adr/ADR-006-NER-Local.md` (decisión original, modelo placeholder)
- `adr/ADR-018-First-Party-Assets.md` (mirror + pin por hash), `assets.lock.json`
- `adr/ADR-021-Engines-Inline-Hasta-Hito9.md` §2 (precedente del alias en OCR)
- `roadmap/MVP.md` §2.1, §4 Hito 5 — `architecture/07_Performance_Strategy.md` §2.3
