<!-- CONTEXT: scope=seguridad | dependencias=00_Project_Vision.md,01_Technical_Architecture_Document.md,06_Pipeline.md | audiencia=IA+humanos | fase=1 -->

# Anonly — Modelo de Seguridad

> Define las garantías de seguridad y privacidad del producto. **Anonly procesa documentos potencialmente confidenciales**: la seguridad no es opcional ni best-effort, es un contracto del producto. Toda decisión aquí se respalda con ADRs.

---

## 1. Promesa de seguridad (resumen ejecutable)

| # | Promesa | Verificación |
|---|---|---|
| S-1 | Ningún byte del documento sale del navegador del usuario. | audit de network, CSP sin `connect-src` a terceros, test E2E que snifflea network. |
| S-2 | Ningún documento se persiste remotamente. | sin endpoints de upload; el Core no hace network (regla R-10 de `ai/AI_Development_Guide.md`). |
| S-3 | El PDF exportado no permite recuperar la información original. | test de no-recuperabilidad: buscar texto original en el buffer del export. |
| S-4 | Los modelos IA se cargan solo desde orígenes verificados (SRI). | SRI en todas las tags `<script>` y workers; integrity check al cargar wasm/modelos. |
| S-5 | No se conservan metadatos sensibles del PDF original en el export. | test de metadata del export. |
| S-6 | El procesamiento ocurre en Web Workers con CSP estricta. | CSP `worker-src 'self' blob:` + `script-src` con `'wasm-unsafe-eval'` acotado a compilar WASM (nunca `'unsafe-eval'` completo — ver §3.2). |
| S-7 | Passwords de PDFs protegidos no se persisten ni loguean. | grep automatizado + test de logger. |
| S-8 | Supply chain auditada: dependencias con hash, sin `postinstall` opaco. | `pnpm audit`, `pnpm-lock.yaml` inmutable, review de `postinstall`. |

---

## 2. Modelo de amenazas

### 2.1 Amenazas consideradas

| Amenaza | Vector | Mitigación |
|---|---|---|
| Fuga de documento al servidor | request de red no intencional | S-1, CSP estricta, Core sin network |
| Recuperación de texto del PDF exportado | capas de texto escondidas, redacción in-place | S-3, reconstrucción completa (ADR-004) |
| Recuperación por metadata | XMP sensible, autor original | S-5, strip de metadata en PDF Engine y export |
| Recuperación por caché del navegador | cache HTTP con el documento | el documento vive solo en RAM, no en cache HTTP |
| Recuperación por IndexedDB | escenarios donde se persiste algo | solo modelos y wasm en IndexedDB/Cache; nunca documentos |
| Supply chain attack | librería comprometida | S-4, S-8, SRI, lockfile inmutable, audit |
| XSS que exfiltra el documento | script injectado | CSP estricta, sin `unsafe-inline` en `script-src`, sin `unsafe-eval`; la única concesión es `'wasm-unsafe-eval'` (acotada a compilar WebAssembly, no habilita `eval()`/`Function()`) — ver §3.2 |
| Side channel por timing | – | out of scope MVP; mitigación general: sin telemetría |
| Reidentificación por patrones | un DNI reemplazado por el mismo valor en todos lados | agrupación por defecto + modos `synthetic` y `placeholder` con índices únicos |
| Malware en modelo IA | modelo ONNX malicioso | SRI, modelos solo de source verificada (HuggingFace publicadas con commit hash) |

### 2.2 Fuera de scope

- Ataques de side channel de hardware (Spectre, etc.): asumimos sandbox del navegador.
- Protección contra un usuario malicioso con acceso al dispositivo del otro: fuera de alcance (es un producto local).
- Anonimización criptográficamente garantizada (k-anonimidad probada): el producto hace anonimización operacional, no criptográfica. Ver `roadmap/Future_Ideas.md` para futuras garantías.

---

## 3. Procesamiento 100% local

### 3.1 Reglas

- El Core **nunca** hace `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` ni ningún API de red. Regla R-10 de `ai/AI_Development_Guide.md`.
- Las únicas requests permitidas son desde `apps/react-client` para cargar assets estáticos (chunks, wasm, modelos) desde el CDN propio, y están restringidas por CSP.

### 3.2 CSP verificada (ADR-039, Hito 10 PR10)

```
default-src 'self';
script-src 'self' blob: 'wasm-unsafe-eval';
worker-src 'self' blob:;
style-src 'self' 'unsafe-inline';   /* Tailwind lo requiere; revisar ADR-005 */
connect-src 'self';                 /* sin third-party */
img-src 'self' data: blob:;
font-src 'self';
object-src 'none';
frame-src 'none';
base-uri 'self';
form-action 'self';
manifest-src 'self';
```

Notas:
- **`'wasm-unsafe-eval'` en `script-src`** (CSP Level 3, no `'unsafe-eval'` completo): la nota previa de este documento decía "sin `unsafe-eval`... verificar al integrar" — la verificación (Hito 10 PR10, Escenario 1 E2E, primera vez que `onnxruntime-web` corre en un browser real) confirmó que **hace falta** para el build `asyncify` pinneado en `assets.lock.json` (`WebAssembly.instantiate()` rechaza sin esto: `CompileError: ... violates ... "wasm-unsafe-eval" is not an allowed source`). `'wasm-unsafe-eval'` es la concesión mínima posible: habilita únicamente compilar/instanciar módulos WASM, **no** `eval()`, `new Function()` ni `setTimeout`/`setInterval` con string — el vector de XSS que S-6/§2.1 mitigan (inyectar y ejecutar JS arbitrario vía `eval`) sigue bloqueado.
- **`blob:` en `worker-src` y `script-src`**: `onnxruntime-web` (build threaded/asyncify) construye su worker de inferencia a partir de un Blob del `.mjs` que la app le inyecta por `NerConfig.wasmPaths` (ADR-039) y lo `import()`a dinámicamente — sin `blob:` en ambas directivas, ese `import()` es rechazado (`Failed to fetch dynamically imported module: blob:...`). El blob solo puede originarse de JS same-origin ya en ejecución (no hay `connect-src` a terceros que permita traer un blob malicioso desde afuera), así que esto no abre un vector nuevo de inyección remota: sigue dependiendo de que `script-src 'self'` (sin `unsafe-inline`) ya esté comprometido.
- `unsafe-inline` en `style-src` es necesario para Tailwind inject; mitigable con build que extrae CSS a archivo (trabajar para eliminarlo en v1.0).
- `connect-src 'self'` bloquea cualquier exfiltración y **no admite excepciones**: los modelos de IA y el wasm también se sirven desde el mismo origen (mirror first-party, ADR-018), por lo que Tesseract.js/Transformers.js se configuran para no tocar CDNs de terceros.

### 3.3 CORS

- Los assets se sirven con `Access-Control-Allow-Origin: 'self'` (o el origen exacto).
- No hay endpoints con CORS abierto.

---

## 4. No-recuperabilidad del export

### 4.1 Garantía

El PDF exportado se reconstruye desde cero:

1. Cada página se renderiza a imagen (PNG/JPEG) con los reemplazos ya aplicados visualmente.
2. `pdf-lib` crea un `PDFDocument` nuevo y adjunta las imágenes como páginas.
3. No se copia ninguna capa de texto, ningún bookmark, ningún JavaScript, ningún form, ninguna XMP del original.
4. La metadata del nuevo PDF es mínima y generada por Anonly (no contiene autor, título ni datos del original).

### 4.2 Test de no-recuperabilidad

Test automatizado (gate de CI):

1. Tomar `text-10p.pdf` con nombres y DNIs.
2. Procesar y exportar con todos los grupos habilitados en `placeholder`.
3. Abrir el PDF resultante con PDF.js y buscar texto plano de cualquier nombre/DNI original.
4. Verificar que **cero** resultados > 0 chars coincidentes.
5. Verificar que la metadata del resultante no contiene `author`, `creator`, `title` del original.

Cualquier regex que matche un DNI/nombre original en el export = fallo de gate.

### 4.3 Modo `redact` (censura visual)

- En modo `redact`, el render pinta un bloque negro sólido sobre el bbox.
- El texto **original** no se incluye en la imagen resultante (se pinta encima con fill opaco).
- Garantía: incluso con OCR sobre la imagen, el texto debajo no se reconstruye porque la imagen se rasteriza sin el texto (se pinta fill antes del `convertToBlob`).

### 4.4 Caso trampa: redacción in-place

Anonly **nunca** redacta in-place sobre el PDF original (ADR-004). Redactar in-place deja el texto debajo del bloque negro, recuperable quitando el bloque. Por eso se reconstruye desde cero.

---

## 5. Metadatos sensibles

### 5.1 Strip en el PDF Engine

El PDF Engine extrae `DocumentMetadata` solo con campos **no sensibles** (ver `03_Data_Model.md` §3):

- Se conservan: `pdfVersion`, `encrypted`, `hasForms`, `producer` (software, no persona).
- Se descartan: `author`, `creator` (si es nombre de persona), `title` sensible, `subject`, `keywords`, XMP completo.

### 5.2 Metadata del export

El export genera metadata mínima:

```ts
export interface ExportMetadata {
  readonly producer: "Anonly";
  readonly creator: "Anonly";
  readonly creationDate: Date;
  readonly title?: string;       // solo si el usuario pone uno explícito
}
```

Nunca se copian campos del original. El test de no-recuperabilidad valida esto.

### 5.3 XMP, JavaScript y forms

- XMP del original: descartado, no se replica.
- JavaScript embebido en el PDF original: descartado (los PDFs pueden tener JS; Anonly no lo ejecuta ni lo replica).
- Forms (AcroForm) del original: descartados. El export no contiene forms.

---

## 6. Passwords de PDFs protegidos

### 6.1 Flujo

1. PDF Engine detecta protección → emite `PDF_PASSWORD_REQUIRED`.
2. UI pide password al usuario.
3. El password viaja **solo en RAM**, en el payload del `pdf-parse` job, transferido al worker.
4. Worker lo usa para abrir el PDF con PDF.js y lo descarta de su scope al terminar.
5. No se loguea (regla R-9 + regla específica de logger).
6. No se persiste en ningún lado.

### 6.2 Garantías

- El password **no** se incluye en ningún evento del bus.
- El password **no** se incluye en logs (`ctx.logger` rechaza campos con nombre `password`, `pwd`, `secret`).
- Tras `DOCUMENT_CLOSED`, el password se elimina de la memoria del worker (se sobreescribe con `new Uint8Array(len)` antes de GC, si el motor lo permite).

### 6.3 Test

- Grep automatizado en CI: `grep -r "password" packages/ | grep -v "PDF_PASSWORD_REQUIRED\|errors.ts"` debe no encontrar usos sospechosos.
- Test de logger: spy sobre `ctx.logger` y verificar que ningún argumento contenga el password de `protected.pdf`.

---

## 7. Sanitización de logs

Reglas del `ILogger` (inyectado en `ctx`):

| Regla | Detalle |
|---|---|
| No loguear contenido del documento | nunca `Page.text`, `Word.text`, `Occurrence.value`, `EntityGroup.canonicalValue`. |
| No loguear passwords, secrets, tokens | el logger filtra campos por nombre y por valor (heuristic: looks-like-secret). |
| Solo loguear IDs y metadatos | `documentId`, `pageIndex`, `engineId`, `durationMs`, `groupCount`. |
| Niveles | `debug` solo en dev; `info`, `warn`, `error` en prod. |
| Sin `console.*` | regla R-9 de `ai/AI_Development_Guide.md`. |

El logger se implementa en `event-system` o `shared` y se inyecta vía `EngineContext`.

---

## 8. Supply chain

### 8.1 Dependencias

- Todas las dependencias se fijan en `pnpm-lock.yaml` (lockfile inmutable en git).
- `pnpm audit` en CI: cero `high` o `critical` para merge.
- Solo se permiten dependencias con ≥ 1000 stars en GitHub o mantenidas por organizaciones reconocidas, con justificación en el ADR correspondiente.
- Sin dependencias con `postinstall` opaco. Si una dependencia crítica tiene `postinstall`, se audit en PR y se documenta.

### 8.2 Integridad de assets

- Todos los `<script>` y workers cargados desde HTML tienen `integrity` SRI.
- Wasm y modelos cargados desde JS verifican `integrity` (Subresource Integrity para `fetch`) o `crypto.subtle.digest` comparado con hash hardcoded en el código.
- Hashes se almacenan en un archivo `integrity.json` versionado y firmado (futuro: firma con Sigstore; MVP: hash hardcoded con review).

### 8.3 Modelos IA

- **Todos los modelos y wasm se sirven first-party** (mismo origen de la app o CDN propio bajo el mismo dominio), nunca desde HuggingFace/jsDelivr en runtime (ADR-018).
- El mirror se construye en build con `assets.lock.json` (URL de origen + revisión + `sha256` pinneados, verificados al descargar y al cargar en runtime).
- HuggingFace es solo la **fuente** del mirror (pinneada por commit hash), no un origen de runtime.
- No se cargan modelos desde URLs arbitrarias o configurables por el usuario en MVP.

### 8.4 Origen de los chunks

- Todos los chunks JS se sirven desde el mismo origen que la app.
- Sin CDN third-party para JS (sí para imágenes estáticas si hace falta, pero nunca para JS/wasm/modelos).

---

## 9. SAN (Single Attribute Non-identifiability)

Para evitar reidentificación por patrones:

- Cada `EntityGroup` tiene un `indexInType` único. En modo `placeholder`, `[DNI 01]` es consistente en todo el documento (mismo grupo → mismo placeholder).
- En modo `synthetic`, el valor sintético es **determinista por seed** (configurable por documento) pero **diferente entre grupos** del mismo tipo. Dos DNIs distintos no se reemplazan por el mismo sintético.
- En modo `mask`, el formato se preserva pero se censura, evitando correlación por valor.
- En modo `redact`, no hay valor, solo bloque negro, evitando correlación por longitud (todos los bloques son del tamaño del bbox).

### 9.1 Riesgo residual

- Si el documento tiene un solo grupo de un tipo (ej. un solo DNI), `placeholder` `[DNI 01]` podría revelar que hay un único DNI. No revela el valor, pero sí el conteo. Aceptable para el producto; documentado en la UI ("X ocurrencias" se muestra al usuario, pero no al receptor del PDF).
- Modo `synthetic` con seed predecible: si el atacante conoce el seed, puede revertir el sintético. Mitigación: seed default aleatorio por sesión, configurable pero nunca expuesto en el PDF resultante.

---

## 10. Privacidad del usuario de Anonly

- Sin analytics en MVP. Sin telemetry. Sin error reporting automático.
- Sin cookies (excepto las estrictamente necesarias, ninguna en MVP).
- Sin accounts. Sin login.
- El usuario puede borrar todos los caches (modelos, wasm) desde Settings → "Borrar datos locales".

### 10.2 localStorage / IndexedDB

- `localStorage`: solo settings del usuario (idioma, modo default, performance preset). Nunca documentos ni datos sensibles.
- `IndexedDB`: solo modelos y wasm cacheados. Nunca documentos.

---

## 11. Test de seguridad (CI)

| Test | Tipo | Validación |
|---|---|---|
| `no-network-from-core` | grep + unit | ningún `fetch`, `XMLHttpRequest`, `WebSocket` en `packages/` |
| `no-recuperability` | integration | buscar texto original en export = 0 hits |
| `metadata-strip` | integration | export no contiene `author`/`creator`/`title` del original |
| `no-password-in-logs` | unit | spy de logger no recibe password |
| `csp-strict` | E2E | response headers tienen CSP de §3.2 |
| `sri-present` | E2E | todos los `<script>` tienen `integrity` |
| `no-third-party-connect` | E2E | sin requests a dominios no first-party |
| `pnpm-audit` | CI | cero high/critical |
| `lockfile-immutable` | CI | `pnpm-lock.yaml` no cambia sin `pnpm install` deliberado |

---

## 12. Referencias

- `00_Project_Vision.md` §7 — métricas.
- `adr/ADR-002-No-Backend.md` — sin backend.
- `adr/ADR-004-Rendering.md` — reconstrucción vs redacción.
- `adr/ADR-009-Export-Strategy.md` — estrategia de export.
- `adr/ADR-012-Replacement-Modes.md` — modos de reemplazo y SAN.
- `ai/Code_Standards.md` §12 — prohibiciones absolutas.
- `ai/AI_Development_Guide.md` §2.2 — regla R-10 (no network).
