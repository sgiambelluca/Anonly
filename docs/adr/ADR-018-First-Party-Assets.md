<!-- CONTEXT: scope=adr | dependencias=architecture/08_Security_Model.md,architecture/07_Performance_Strategy.md,adr/ADR-002-No-Backend.md,adr/ADR-006-NER-Local.md | audiencia=humanos+IA | fase=5 -->

# ADR-018 — Modelos y wasm servidos first-party (mirror propio, sin CDNs de terceros)

- **Estado**: Accepted
- **Fecha**: 2026-07-07
- **Decidido por**: Usuario + planificador
- **Relacionado con**: ADR-002 (no backend), ADR-006 (NER local)

## Contexto

`08_Security_Model.md` §3.2 promete una CSP con `connect-src 'self'`: el navegador bloquea toda request a orígenes distintos del propio. Pero las librerías de IA descargan sus assets desde terceros por defecto:

- **Tesseract.js**: modelos de idioma (`spa+eng`, ~30 MB) y wasm desde jsDelivr/GitHub.
- **Transformers.js**: modelo NER ONNX (~60 MB Q8) desde `huggingface.co`.
- **onnxruntime-web** y **pdfjs-dist**: wasm que, según el bundling, puede resolverse a CDN externo.

Con la CSP prometida, esas descargas fallan y OCR/NER no funcionan. Las specs de OCR (§15.17) y NER (§5) dejaban la resolución abierta ("documentar excepción o mirror en CDN propio") — una ambigüedad que bloquea los Hitos 3 y 5.

## Decisión

**Todos los assets de runtime (modelos de IA, archivos wasm, workers) se sirven first-party**: desde el mismo origen de la app (o un CDN propio bajo el mismo dominio). Nunca desde jsDelivr, HuggingFace ni ningún origen de terceros en runtime.

Operativamente:

1. **Mirror versionado**: un script del repo (`scripts/mirror-assets.ts`, a crear en el Hito 3) descarga los assets pinneados (URL + revisión + `sha256` declarados en un `assets.lock.json` versionado), verifica el hash y los deposita en el directorio público del build (`apps/react-client/public/models/`, `public/wasm/`). Los binarios **no** se commitean al repo (son ~110 MB); el script corre en build/deploy.
2. **Configuración de librerías** apuntando al origen propio:
   - Tesseract.js: `langPath`, `corePath`, `workerPath` → `/wasm/tesseract/`, `/models/tesseract/`.
   - Transformers.js: `env.allowRemoteModels = false`, `env.localModelPath` → `/models/ner/` (o `env.remoteHost` al mismo origen).
   - onnxruntime-web: `env.wasm.wasmPaths` → `/wasm/onnx/`.
   - pdfjs-dist: `workerSrc`/wasm → `/wasm/pdfjs/`.
3. **Verificación de integridad en runtime**: al cargar un modelo, `crypto.subtle.digest` comparado contra el hash de `assets.lock.json` (el mismo mecanismo que `08_Security_Model.md` §8.2 ya define). Hash mismatch → `OCR_MODEL_MISSING` / `NER_MODEL_LOAD_FAILED`.
4. **CSP intacta**: `connect-src 'self'` sin excepciones. El test `no-third-party-connect` (§11 del Security Model) sigue siendo válido y bloqueante.
5. Actualizar un modelo = actualizar `assets.lock.json` (URL/revisión/hash) en un PR revisable.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **Excepción de CSP** (`connect-src` + `huggingface.co`, `cdn.jsdelivr.net`) | Debilita la promesa S-1: un XSS podría exfiltrar contenido del documento hacia los dominios permitidos. Invalida el test `no-third-party-connect`. Dependencia de disponibilidad y de que el tercero no mueva/cambie archivos. Imposibilita el modo offline (v1.0). |
| **Empaquetar los modelos dentro del bundle de la app** | Es la misma decisión con menos flexibilidad: cada release re-publica ~110 MB y el versionado del modelo queda acoplado al del código. El mirror en `public/` mantiene lazy loading y cache independiente. |
| **Carga manual por el usuario** (subir el archivo del modelo) | UX inaceptable para el público objetivo (profesionales no técnicos). |
| **Descarga de terceros solo la primera vez + cache** | La primera vez sigue violando la CSP y exponiendo la promesa; el problema es el origen, no la frecuencia. |

## Consecuencias

**Positivas**: la promesa "ningún byte sale del navegador" cubre también metadatos de uso (ni HuggingFace ni jsDelivr ven quién usa Anonly); CSP estricta sin excepciones; integridad verificable con hash pinneado (supply chain, §8.3); disponibilidad bajo control propio; habilita PWA offline (v1.0) sin cambios.

**Negativas**: hostear ~110 MB de assets estáticos (costo bajo: el deploy ya es un CDN estático, ADR-002); actualizar modelos es manual vía `assets.lock.json` (aceptable: los modelos cambian poco y el pin es deseable); el script de mirror es una pieza más de build.

**Neutras**: el cache del lado del cliente no cambia (IndexedDB para Tesseract, Cache Storage para ONNX, HTTP cache para wasm — `07_Performance_Strategy.md` §2.2/§2.3).

## Validación

- Test E2E `no-third-party-connect`: cero requests fuera del origen propio durante OCR y NER (ya definido en `08_Security_Model.md` §11; esta decisión lo hace cumplible).
- Test de integridad: modelo con hash alterado → error tipado, no se carga.
- Hito 3 (OCR) y Hito 5 (NER) implementan la configuración de librerías descrita; el checklist de cada spec lo referencia.

## Referencias

- `architecture/08_Security_Model.md` §3.2 (CSP), §8.2–8.3 (integridad y modelos)
- `architecture/07_Performance_Strategy.md` §2.2–2.3 (carga de wasm y modelos)
- `core/OCR_Engine.md` §15.17
- `core/NER_Engine.md` §5, §15.19
- `adr/ADR-002-No-Backend.md`
- `adr/ADR-006-NER-Local.md`
