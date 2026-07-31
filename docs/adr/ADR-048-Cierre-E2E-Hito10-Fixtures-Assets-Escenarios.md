<!-- CONTEXT: scope=adr | dependencias=architecture/07_Performance_Strategy.md,ui/React_Client.md,ui/Components.md,core/Contracts.md,adr/ADR-018-First-Party-Assets.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-039-NerConfig-WasmPaths-Overrides-Parciales.md | audiencia=humanos+IA | fase=10 -->

# ADR-048 — Cierre E2E del Hito 10 (PR17): assets en CI, fixtures generables, y qué escenario va a qué gate

- **Estado**: Accepted (los dos puntos de §7 quedaron **ratificados por el humano el 2026-07-24**: opción recomendada en ambos — `protected.pdf` commiteado y **PR16.5** para el wiring `settings.store` → `EngineConfig`)
- **Fecha**: 2026-07-24
- **Decidido por**: El planificador, en la auditoría pre-PR17 encargada por el humano. PR17 es "E2E completa: escenarios 2, 3, 4, 5, 7, 9, 10 y 11 de `07` §11.3 + fixtures pesados restantes" (ADR-038 §8) — la auditoría contra el repo encontró que **cuatro de esos ocho escenarios no son ejercitables hoy** por razones que no se resuelven escribiendo el `.spec.ts`, más un problema que afecta a **toda** la suite en CI.
- **Relacionado con**: ADR-018 (assets first-party mirroreados, nunca commiteados — la causa raíz del problema de CI), ADR-036 §8/ADR-038 §8 (tabla de PRs), ADR-039 (los assets de ort pasaron a `src/assets/`, importados como módulo por Vite), ADR-010 (estrategia de testing), ADR-021 §5 (los tests unit mockean las fronteras; E2E es el único lugar donde corren de verdad)

## Contexto

### 1. La suite E2E no puede pasar en CI hoy — ni siquiera la que ya existe

`.gitignore` (líneas 55–60) excluye del repo, por ADR-018, los tres directorios de assets first-party:

```
apps/react-client/public/wasm/          # tesseract, 7.7 MB
apps/react-client/public/models/        # modelo NER, 179 MB
apps/react-client/src/assets/onnxruntime/   # ort-wasm-simd-threaded.{mjs,wasm} (ADR-039)
```

Se obtienen con `pnpm assets:mirror` (`scripts/mirror-assets.ts`, verificando hash contra `assets.lock.json`). El job `test-e2e` de `.github/workflows/ci.yml` hace `checkout` → `pnpm install` → `playwright install` → `pnpm test:e2e`: **nunca corre el mirror**. Consecuencias, en orden de gravedad:

1. El tercero es un `import … from "../assets/onnxruntime/ort-wasm-simd-threaded.mjs?url"` en `core-adapter/index.ts` — **Vite falla al resolver el módulo**, así que el dev server que levanta Playwright (`webServer` de `playwright.config.ts`) no sirve una app funcional: **toda** la suite se cae, no solo los escenarios de NER.
2. Sin `public/models/`, `pipeline()` rechaza → `NER_MODEL_MISSING` → `PIPELINE_FAILED`: el Escenario 1 (que llega hasta el export) no puede pasar.
3. Sin `public/wasm/`, el OCR real (Escenario 2, PR14/PR17) no puede correr.

Los "gates verdes" reportados en PR10 y PR13/PR14 son **locales**, en un entorno donde el mirror ya se había corrido. Nadie verificó el job de CI con la suite existente. Esto no es un problema de PR17 en sentido estricto — es un problema que PR17 **hereda y no puede ignorar**, porque su definición de terminado es "suite E2E completa verde" y el gate `test:e2e` (`07` §11.4) está declarado activo.

### 2. Tres de los ocho escenarios no tienen fixture y uno no es generable

`tests/fixtures/generate.ts` genera **tres** de los ocho fixtures del README: `text-10p.pdf`, `empty.pdf`, `corrupt.pdf`. Los demás requieren herramientas externas (el propio archivo lo documenta: `qpdf --encrypt`, `pdftoppm`). `tests/e2e/support/fixtures.ts` los arma **en memoria** desde esos generadores, sin commitear binarios — el patrón correcto, y `viewer-scroll-jump.spec.ts` ya lo extendió generando un `many-Np.pdf` grande al vuelo.

- **Escenario 3 (PDF protegido)**: `protected.pdf` **no es generable con pdf-lib** — pdf-lib no implementa encriptación (limitación conocida del proyecto). No hay forma de producirlo con las dependencias actuales. (Resuelto en §7 punto 1: se commitea, generado una vez con `qpdf`.)
- **Escenario 2 (PDF escaneado)**: `scanned-10p.pdf` no existe, y la entrada "PR14" del roadmap difirió explícitamente el fixture de PDF escaneado real **a Hito 11** — en contradicción directa con que el Escenario 2 esté asignado a PR17.
- **Escenario 4 (PDF enorme → cancelar)**: no necesita `huge-1000p.pdf` (LFS): el precedente de `many-Np.pdf` alcanza y sobra.

### 3. El Escenario 7 pisa el gate `test:leak` de Hito 11

`07` §11.3 item 7 ("abrir y cerrar 10 documentos → la memoria regresa al baseline") es, palabra por palabra, la definición del gate `test:leak` de §11.4 ("memoria no regresa al baseline tras 10 open/close", `tests/leak/`, **Hito 11**). Además, medir memoria con precisión en Chromium requiere `performance.measureUserAgentSpecificMemory()`, que **exige `crossOriginIsolated`** (headers COOP/COEP) — headers que PR10 probó, descartó y revirtió al resolver el bug #3.

### 4. El Escenario 8 sigue `fixme` con una pregunta al planificador sin responder

`tests/e2e/scenario-8-ner-disabled.spec.ts` está en `test.fixme` desde PR10 con un informe de ambigüedad correcto: no existe forma de desactivar NER **antes** de importar el primer documento. `App.tsx` llama `initCore()` sin argumentos una sola vez en el mount; `core-adapter/index.ts` nunca deriva un `EngineConfig` desde `settings.store`. La pregunta textual del implementador —"¿el wiring `settings.store` → `EngineConfig` es un PR pendiente del Hito 10 y cuál, o queda diferido a v1.0?"— nunca se contestó. No es solo un test bloqueado: es un **bug de producto** (el toggle de NER en `SettingsDialog` sin documento abierto no hace nada, y `React_Client.md` §3.7 promete que afectará "al próximo `createCore`" que nunca ocurre). Nota: `initCore` **ya acepta** `EngineConfigOverrides` desde ADR-039 — falta solo el llamador.

### 5. Deudas menores heredadas, en el alcance natural de PR17

- `pnpm typecheck` no incluye `tests/e2e/` (observación del revisor de PR10 sin acción): los `.spec.ts` solo se type-chequean al correr Playwright.
- El comentario de cabecera de `scenario-1-import-edit-export.spec.ts` quedó desactualizado tras el fix del bug #7 (dice que `ExportButton` se gatea por `stage === Ready`; el gate real es `{Ready, Done}`).

## Decisión

### 1. El mirror de assets es un paso **obligatorio** del gate E2E, en CI y en local

El job `test-e2e` de `ci.yml` gana un paso `pnpm assets:mirror` **antes** de `pnpm test:e2e`, con cache de `actions/cache` sobre los tres directorios (clave: hash de `assets.lock.json`) para no re-descargar 187 MB en cada corrida. `07` §11.4 documenta el prerequisito en la fila del gate E2E: *"requiere `pnpm assets:mirror` previo (ADR-018): los assets first-party no están en el repo"*. Se agrega el mismo prerequisito al README de `tests/e2e/`.

**Verificación de que el diagnóstico es correcto, antes de escribir un solo escenario nuevo** (primer item del checklist de PR17): borrar los tres directorios en local, correr `pnpm test:e2e` y confirmar que la suite existente se cae; correr `pnpm assets:mirror` y confirmar que vuelve a pasar. Si la falla observada no coincide con §1, se reporta antes de continuar.

### 2. Fixtures: todo generado en runtime; ninguno commiteado

Se mantiene y extiende el patrón de `support/fixtures.ts` (generación en memoria, sin binarios en el repo):

- **Escenario 4**: `generateManyPages(n)` ya existe en `viewer-scroll-jump.spec.ts`; se promueve a `support/fixtures.ts` y se reusa. Sin `huge-1000p.pdf` ni LFS.
- **Escenario 2 (escaneado)**: se genera **en el browser**, dentro del propio spec: `page.evaluate` rasteriza `text-10p.pdf` con el `pdfjs-dist` que la app ya carga, vuelca cada página a un canvas, y re-arma un PDF de imágenes con pdf-lib (que ya es dependencia del workspace). Resultado: un PDF sin capa de texto, con contenido conocido — exactamente lo que el Escenario 2 necesita (`textlessPages.length > 0` → OCR real). Esto **supersede** el diferimiento a Hito 11 anotado en la entrada "PR14" del roadmap: la razón de aquel diferimiento era no tener cómo producir el fixture, y esta vía no existía como opción cuando se escribió.
- **Escenario 3 (protegido)**: pdf-lib no encripta. Ver §7 (punto que requiere ratificación del humano).

`tests/fixtures/README.md` se actualiza para reflejar qué fixture se genera dónde (Node vs browser) y cuál sigue sin origen.

### 3. Escenario 7: se ejercita el **flujo**, no la métrica

PR17 implementa el Escenario 7 como test de **flujo y liberación de recursos observable**: abrir y cerrar 10 documentos consecutivos verificando, por cada ciclo, que `DOCUMENT_CLOSED` deja el estado limpio (sin documento activo, sin preview, sin blob URLs vivos — chequeables desde los stores y desde el DOM) y que el ciclo 10 se comporta igual que el 1 (sin degradación de tiempos ni errores acumulados). La **medición de memoria contra baseline** queda donde ya estaba asignada: el gate `test:leak` (`tests/leak/`, Hito 11), que puede usar Node/`--expose-gc` o una corrida dedicada con COOP/COEP habilitados solo para ese entorno de medición, sin tocar la CSP de producción. `07` §11.3 item 7 se anota con este reparto para que nadie lo lea como "PR17 debe medir bytes".

### 4. Escenarios 5, 9, 10, 11: sin bloqueos, con una precondición

Los cuatro son ejercitables con lo que ya existe (`reanalyze` de ADR-038, merge/split de PR8, zoom de ADR-037), **siempre que** §1 esté resuelto: los tres tocan NER real y por lo tanto el modelo. El Escenario 9 (preservación de ediciones) es el más caro en tiempo de corrida: se le da timeout propio y se documenta como el más lento de la suite.

### 5. Orden y dependencias de PR17

PR17 corre **después** de PR16 y de **PR16.5** (§7 punto 2): los escenarios 2 y 3 ejercitan caminos (OCR real, password) que atraviesan OcrWorker/PdfWorker, el 1/9 atraviesan Ner/Render/ExportWorker, y el 8 depende del wiring de PR16.5. Dentro del PR, el orden recomendado es: (a) fix de CI + verificación de §1; (b) escenarios sin fixture nuevo (5, 9, 10, 11); (c) escenario 4; (d) escenario 2; (e) escenario 3 con el fixture commiteado; (f) escenario 8 (sacar el `test.fixme`); (g) deudas menores de §6.

### 6. Deudas menores que PR17 absorbe

- `tests/e2e/tsconfig.json` entra en la cadena de `pnpm typecheck` (referencia desde el tsconfig raíz), para que un `.spec.ts` con error de tipos se detecte en el gate y no en la corrida.
- Se corrige el comentario stale de `scenario-1-import-edit-export.spec.ts` (`{Ready, Done}`, `Components.md` §2.5 post-bug #7).

### 7. Los dos puntos de alcance — **ratificados por el humano (2026-07-24), opción (a) en ambos**

1. **Escenario 3 — PDF protegido → `protected.pdf` se commitea**. Se genera **una sola vez** con `qpdf --encrypt test1234 test1234 256 -- text-10p.pdf protected.pdf` (comando ya documentado en `generate.ts` y en `tests/fixtures/README.md`) y el binario (~100 KB) entra al repo. No contradice ADR-018: eso rige los **assets first-party mirroreados** (modelo, wasm), no un fixture determinista de test. `generate.ts` sigue siendo la fuente de los generables; `protected.pdf` queda documentado como el único fixture commiteado y con el comando exacto que lo reproduce.
   *(Alternativas descartadas: dev-dependency que encripte —`node-qpdf2`/`muhammara`—, que exigía ADR propio por R-12 y un binario nativo en CI; diferir el escenario a Hito 11.)*
2. **Escenario 8 — wiring `settings.store` → `EngineConfig` → PR16.5**. PR nuevo, chico, de `apps/react-client`, **entre PR16 y PR17**: el bootstrap deriva `EngineConfigOverrides` desde los settings persistidos y llama `initCore(overrides)`. Cierra el bug de producto (hoy el toggle de NER sin documento abierto no hace nada, contra lo que promete `React_Client.md` §3.7), responde la pregunta abierta desde PR10 y llega a tiempo para que PR17 saque el Escenario 8 de `fixme`. Alcance exacto:
   - `settings.store.load()` ya existe y ya persiste `nerEnabled`/`ocrLanguages`/`performancePreset`; `initCore` ya acepta `EngineConfigOverrides` desde ADR-039. **Falta solo el llamador**: `App.tsx` carga los settings antes del `initCore()` del `useEffect` de mount y pasa los overrides derivados.
   - El mapeo es el de `React_Client.md` §3.7, que pasa a especificar también el **bootstrap** (no solo el flujo con documento abierto): `nerEnabled → ner.enabled`, `ocrLanguages → ocr.languages`, `performancePreset → workerPool.*PoolSize` (con `auto` = omitir la sección, para no pisar los defaults derivados de `hardwareConcurrency`).
   - El override de `wasmPaths` que `initCore` ya inyecta (ADR-039) se conserva: los overrides del usuario se mergean **debajo** de él, nunca lo pisan.
   - Fuera de alcance: recrear el core al cambiar un setting con documento abierto (sigue siendo `reanalyze`, ADR-038 §7) y el redimensionado de pools en caliente (§3.7, Q3).
   *(Alternativa descartada: diferir a v1.0 corrigiendo §3.7 para no prometer el comportamiento.)*

Con esto, los ocho escenarios de PR17 quedan sin bloqueo: ninguno arranca en `fixme`.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Commitear los assets first-party** (resolvería CI de una) | Contradice ADR-018 y suma 187 MB al repo; el mirror con hash es justamente la garantía de integridad del modelo (`08_Security_Model.md` §8.3). |
| **Correr E2E en CI con NER desactivado** | Sería exactamente el Escenario 8, que hoy no se puede configurar (§4 del Contexto); y dejaría sin cobertura E2E justo la frontera que solo E2E ejercita (ADR-021 §5). |
| **Escenario 7 midiendo memoria en Playwright** | `measureUserAgentSpecificMemory()` exige `crossOriginIsolated`; habilitar COOP/COEP para el E2E significa testear una app con una configuración distinta de la de producción — y PR10 ya descartó esos headers. Peor: duplicaría el gate `test:leak` de Hito 11 con una medición menos confiable. |
| **Generar el escaneado en Node** (sin browser) | Requiere rasterizar texto sin canvas ni fuentes: no hay forma razonable en Node puro. En el browser, pdfjs + canvas ya están cargados por la propia app. |
| **Dejar el fix de CI para Hito 11** | El gate `test:e2e` está declarado **activo** en `07` §11.4; un gate activo que no puede pasar es peor que no tenerlo, y enmascara regresiones reales de los PRs 12–16. |

## Consecuencias

**Positivas**: el gate E2E pasa a ser real (hoy es decorativo en CI); los ocho escenarios quedan con un camino concreto de implementación o un motivo documentado; ningún binario nuevo en el repo salvo el que el humano ratifique; el Escenario 2 recupera la cobertura de OCR real que PR14 había diferido; se cierra la única pregunta del implementador que llevaba abierta desde PR10.

**Negativas**: el job `test-e2e` de CI se vuelve más lento y dependiente de la red (mitigado con cache por hash de `assets.lock.json`); generar el escaneado dentro del browser hace ese spec más frágil que uno con fixture estático (mitigado: contenido conocido, y es el mismo pdfjs que la app ya usa); PR17 crece con trabajo de CI e infraestructura que no es "escribir escenarios".

**Neutras**: la decisión no cambia ningún contrato del Core ni de la UI; `07` §11.3 conserva sus once escenarios (cambia dónde se mide el 7, no qué se promete).

## Docs actualizados por este ADR

- `architecture/07_Performance_Strategy.md`: §11.3 (notas de los escenarios 2, 3, 7 y 8), §11.4 (prerequisito `assets:mirror` en la fila del gate E2E).
- `tests/fixtures/README.md`: qué fixture se genera dónde (Node/browser) y `protected.pdf` como único fixture commiteado, con su comando de reproducción.
- `ui/React_Client.md` §3.7: el mapeo settings → `EngineConfig` pasa a cubrir también el **bootstrap** (alcance de PR16.5).
- `roadmap/Hito10_Observaciones_Revision.md`: entradas PR16/PR16.5/PR17 + tareas de seguimiento.
- `roadmap/MVP.md` (Hito 10) y `adr/ADR-038` §8: PR16.5 insertado en la tabla de PRs.
- `.github/workflows/ci.yml` y `tests/e2e/` (README/tsconfig): los aplica PR17, no el planificador.

## Validación

- Con los tres directorios de assets borrados, `pnpm test:e2e` falla; tras `pnpm assets:mirror`, pasa (verificación explícita del diagnóstico §1, primer item de PR17).
- CI: el job `test-e2e` verde en una corrida limpia, con y sin cache de assets.
- Escenarios 2, 4, 5, 9, 10, 11 verdes; 3 y 8 verdes o `fixme` documentado según §7.
- `pnpm typecheck` falla si un `.spec.ts` de `tests/e2e/` tiene un error de tipos (verificable introduciendo uno a propósito).

## Referencias

- `architecture/07_Performance_Strategy.md` §11.2–§11.4 — `ui/React_Client.md` §3.7 — `ui/Components.md` §2.5/§13.9
- `adr/ADR-010` — `adr/ADR-018` — `adr/ADR-021` §5 — `adr/ADR-036` §8 — `adr/ADR-038` §8 — `adr/ADR-039`
- `.gitignore` (55–60) — `.github/workflows/ci.yml` (job `test-e2e`) — `scripts/mirror-assets.ts` — `playwright.config.ts` — `tests/e2e/support/fixtures.ts` — `tests/e2e/scenario-8-ner-disabled.spec.ts` — `tests/fixtures/generate.ts` — `apps/react-client/src/core-adapter/index.ts` (`initCore`) — `apps/react-client/src/App.tsx`
