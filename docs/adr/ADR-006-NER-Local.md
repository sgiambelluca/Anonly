<!-- CONTEXT: scope=adr | dependencias=07_Performance_Strategy.md,08_Security_Model.md | audiencia=humanos+IA | fase=2 -->

# ADR-006 — NER Local con Transformers.js + ONNX Runtime Web

- **Estado**: Accepted
- **Fecha**: 2026-06-17
- **Decidido por**: Planificación inicial
- **Complementado por**: ADR-018 (los modelos se sirven first-party, nunca desde HuggingFace en runtime); ADR-023 (resuelve el modelo default multilingüe concreto `Xenova/bert-base-multilingual-cased-ner-hrl` y corrige el tamaño Q8 a ~150–180 MB — el placeholder `Xenova/bert-base-NER` de §Decisión queda superado)

## Contexto

Regex detecta patrones determinísticos (DNI, CUIT, teléfono, email, etc.) pero no detecta personas, organizaciones ni direcciones. Para esos se necesita NER (Named Entity Recognition).

Para respetar el principio "100% local" (ADR-002), el NER debe correr en el navegador. Esto requiere:
- Un modelo NER liviano que cargue en WASM.
- Un runtime que funcione sin `unsafe-eval` (para mantener CSP estricta).
- Performance razonable (< 20 s por página de texto).

## Decisión

Usar **Transformers.js** (`@xenova/transformers`) sobre **ONNX Runtime Web** (`onnxruntime-web`), con un modelo multilingüe cuantizado:

- Modelo default: `Xenova/bert-base-NER` o equivalente multilingüe fine-tuned, cuantizado a **Q8** (~50–80 MB).
- Runtime: `onnxruntime-web` con backend WASM (SIMD cuando esté disponible).
- Ejecución: en `NerWorker` (Web Worker dedicado), modelo cargado una vez por worker y reutilizado entre jobs.
- Cache: modelo en Cache Storage del navegador, versionado por `modelId`.
- Lazy: solo se carga si NER está activado y hay texto que analizar.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **API externa (OpenAI, spaCy server, etc.)** | Viola ADR-002. El texto sale del dispositivo. |
| **TensorFlow.js con modelo propio** | Modelos NER en TF.js menos maduros que ONNX. Soporte WASM menos eficiente que ORT. |
| **Compromise.js / NLP heurístico** | Sin ML real. Recall bajo en nombres no occidentales, direcciones complejas. |
| **ONNX Runtime Web con modelo propio entrenado** | Excelente calidad, pero entrenar y mantener un modelo para MVP es costo fuera de alcance. Para v1.0 o futuros. |
| **WebGPU + transformers.js** | Más rápido pero soporte de navegadores aún incompleto en MVP. Mantener WASM como fallback. |
| **Modelo solo en español** | Limita futuro multi-idioma. Multilingüe desde el inicio permite v2.0 sin rework. |
| **Modelo grande sin cuantizar** | Demasiado pesado para descargar y memoria. Q8 balancea tamaño/calidad. |

## Consecuencias

**Positivas**:
- NER 100% local, consistente con ADR-002.
- Transformers.js abstrae tokenización e inferencia; no re-implementamos.
- Cuantización Q8 reduce modelo a ~60 MB y runtime asequible.
- Cache en navegador evita re-descarga en sesiones futuras.

**Negativas**:
- Descarga inicial del modelo (60 MB) la primera vez. Mitigado con `NER_MODEL_LOADING` progreso y lazy loading.
- Calidad de NER limitada por el modelo open-source. No alcanza la calidad de modelos comerciales (spaCy server, GPT-4, etc.). Recall objetivo v1.0: ≥ 85%.
- Memoria: ~200–400 MB por worker. Mitigado con `NerPool` size 1–2.
- Latencia: 5–15 s por página de texto denso. Aceptable para MVP (< 60 s end-to-end con OCR).

**Neutras**:
- WebGPU se puede agregar como backend faster cuando tenga soporte amplio (v1.0+), sin cambiar la API de Transformers.js.
- Modelo específico para Argentina / jerga legal es `roadmap/Future_Ideas.md`, con su propio ADR.

## Configuración

- `NER_CONFIDENCE_THRESHOLD = 0.7` (ocurrencias por debajo se marcan conflicto `low_confidence`).
- `NER_BATCH_SIZE = 256` tokens (default de Transformers.js).
- `NER_MODEL_ID` configurable en settings, default a un modelo pinned por hash.

## Validación

- Test de recall/precision sobre dataset de referencia en CI (gate de v1.0).
- Test de cancelación de inferencia.
- Test de descarga + cache (segunda sesión no descarga).
- Test de fallback si WebGPU no disponible.

## Referencias

- `07_Performance_Strategy.md` §2.3 (carga de modelos)
- `08_Security_Model.md` §8.3 (integridad de modelos)
- `core/NER_Engine.md` (spec completo)
- `roadmap/Future_Ideas.md` (modelo AR específico)
