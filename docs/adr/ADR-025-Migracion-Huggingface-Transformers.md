<!-- CONTEXT: scope=adr | dependencias=core/NER_Engine.md,adr/ADR-001-Stack.md,adr/ADR-006-NER-Local.md,adr/ADR-018-First-Party-Assets.md,adr/ADR-023-NER-Config-Canonical-Model-Multilingue.md | audiencia=humanos+IA | fase=5 -->

# ADR-025 — Migración de `@xenova/transformers` (v2) a `@huggingface/transformers` (v4)

- **Estado**: Accepted
- **Fecha**: 2026-07-11
- **Decidido por**: El humano, tras el triage de las 12 alertas de Dependabot post-Hito 5
- **Relacionado con**: ADR-001/ADR-006 (elección de Transformers.js), ADR-018 (assets first-party), ADR-023 (modelo NER)

## Contexto

`@xenova/transformers@2.17.2` está **deprecado**: su autor se unió a Hugging Face y el proyecto
continúa como `@huggingface/transformers` (Transformers.js v3+, hoy v4.2.0, Apache-2.0). La v2 no
recibe más actualizaciones y ancla `onnxruntime-web@1.14.0` (2023), cuya cadena transitiva
(`onnx-proto@4.0.4 → protobufjs@6.11.6`) produjo 12 alertas de Dependabot (1 crítica RCE, 5 high),
mitigadas temporalmente con un override de pnpm (`onnx-proto>protobufjs: ^7.6.5`). Cada CVE futura
de esa cadena exigiría el mismo parche manual, sin upstream que la arregle.

Además: el backend **WebGPU** que `NER_Engine.md` §12 y el roadmap contemplan para v1.0+ solo
existe en v3+; en v2 esa línea es letra muerta. Y el triage detectó un **gap latente del Hito 5**:
`ner.engine.ts` apunta `env.backends.onnx.wasm.wasmPaths` a `/wasm/onnxruntime/`, pero ese
directorio no existe — no hay binarios wasm de ONNX Runtime en `assets.lock.json` ni mirrorados
(solo los de tesseract). Los tests no lo detectan porque mockean la frontera (ADR-021 §5); en el
navegador real el modelo no cargaría.

La migración es unidireccional e inevitable; se decide hacerla ahora, con el contexto del motor
fresco, en lugar de arrastrarla como pendiente hasta Hito 9/11.

## Decisión

`ner-engine` migra de `@xenova/transformers@^2.17.2` a **`@huggingface/transformers@^4.2.0`**.
Alcance concreto:

1. **Import y API.** Reemplazo del paquete; `pipeline("token-classification", modelId, opts)` se
   mantiene. La opción de cuantización cambia: `quantized: true` (v2) → **`dtype: "q8"`** (v3+),
   que mapea al mismo archivo `model_quantized.onnx` — los assets del modelo pinneados por
   ADR-023 **no cambian** (mismo `revision`, mismos hashes en `assets.lock.json`).
2. **`onnxruntime-web` deja de ser dependencia directa** del motor: v4 bundlea su propia versión
   pinneada. Se elimina de `package.json` del motor y de la lista de dependencias permitidas de
   `NER_Engine.md` §4 (el acceso al backend es vía `env.backends.onnx` de la librería).
3. **Mirror de wasm (cierra el gap).** Los binarios wasm de la versión exacta de `onnxruntime-web`
   que v4 bundlea se agregan a `assets.lock.json` (URL + `revision` + `sha256` + `sizeBytes`,
   destino `apps/react-client/public/wasm/onnxruntime/`) y se materializan con
   `pnpm assets:mirror` — mismo patrón que tesseract y el modelo NER (ADR-018). La versión del
   wasm debe coincidir **exactamente** con la que la librería espera; se lee del lockfile, no se
   asume.
4. **Configuración local first-party se preserva**: `env.allowRemoteModels = false` +
   `env.localModelPath` + `wasmPaths` propios. Si v4 renombró alguna de estas opciones, se adapta
   el código manteniendo la invariante de ADR-018 (nunca red externa en runtime).
5. **Limpieza del override.** Con la cadena v2 fuera del árbol, el override
   `"onnx-proto>protobufjs"` del `package.json` raíz se elimina (el de `js-yaml@^3` no se toca:
   es de `@changesets/cli`). `pnpm audit` debe seguir limpio sin él.
6. **Tests**: los `vi.mock("@xenova/transformers", ...)` y el cast de frontera de
   `__tests__/fixtures/test-helpers.ts` pasan al nuevo nombre de paquete; si v4 cambió los tipos
   del resultado de token-classification, el cast de frontera se ajusta (sigue siendo el único
   punto de cast, Code_Standards §10).

WebGPU **no** se activa en este cambio: MVP sigue en WASM (`NER_Engine.md` §12); la migración solo
lo vuelve posible para la evaluación de v1.0.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Quedarse en v2 + overrides | Deuda perpetua: paquete sin mantenimiento, cada CVE transitiva se parchea a mano, WebGPU imposible, y el gap de wasm había que cerrarlo igual contra una versión vieja. |
| Migrar a v3.x en vez de v4 | Mismo esfuerzo de migración (el salto de API está en v2→v3), pero aterrizando en una línea ya superada; v4 es la mantenida. |
| Diferir a Hito 9/11 | Rechazada por el humano: la migración es inevitable y unidireccional; hacerla con el motor recién escrito y sus tests frescos minimiza el riesgo de contexto perdido. |

## Consecuencias

**Positivas**: dependencia mantenida upstream (seguridad sin overrides); backend WebGPU disponible
para evaluar en v1.0; el gap de wasm del Hito 5 queda cerrado con assets pinneados; assets del
modelo intactos (sin re-descarga de 178 MB para usuarios que ya lo cachearon).

**Negativas**: v4 trae subdependencias nuevas (`@huggingface/tokenizers`, `@huggingface/jinja`,
`sharp` y `onnxruntime-node` — estas dos últimas son node-only y no entran al bundle del
navegador); el comportamiento de tokenización/agregación puede diferir sutilmente entre versiones
→ los snapshot tests del motor y el dataset de referencia (§14) son el mecanismo de detección; el
wasm bundle de ort 1.26-dev es distinto al 1.27 asumido hasta ahora y hay que pinnearlo con
cuidado (punto 3).

## Referencias

- `core/NER_Engine.md` §4, §12 — `adr/ADR-018-First-Party-Assets.md` — `adr/ADR-023` §2
- Commit `b7731e2` (mitigación temporal por overrides) — alertas Dependabot del 2026-07-11
- https://github.com/huggingface/transformers.js (v4.2.0, Apache-2.0)
