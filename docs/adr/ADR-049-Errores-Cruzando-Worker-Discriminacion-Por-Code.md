<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Orchestrator.md,core/PDF_Engine.md,ai/Code_Standards.md,architecture/05_Worker_Architecture.md,adr/ADR-035-Hito9-Pools-InProcess-Retryable.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-045-OcrEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-046-NerEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-047-ExportEngine-Ensamblador-Worker-Dedicado.md,adr/ADR-048-Cierre-E2E-Hito10-Fixtures-Assets-Escenarios.md | audiencia=humanos+IA | fase=10 -->

# ADR-049 — Los errores que cruzan un Worker se discriminan por `code`, nunca por `instanceof` de subclase

- **Estado**: Accepted
- **Fecha**: 2026-07-30
- **Decidido por**: El planificador, sobre un bug **real y reproducible** que el implementador destapó y rastreó hasta su causa raíz durante PR17 (Escenario 3 E2E, PDF protegido). El diagnóstico del implementador se verificó línea por línea contra el código antes de escribir este ADR y es correcto; este ADR agrega la parte que no estaba en el reporte (un segundo sitio afectado, el barrido del resto de los `instanceof`, y el reparto en PRs).
- **Relacionado con**: ADR-035 §3 (semántica canónica de `retryable`; deja el pendiente que este ADR absorbe), ADR-036 §2/§3 (transporte real de workers desde PR12 — el bug no existe con pools in-process), ADR-045/ADR-046/ADR-047 (los tres motores que ya normalizan sus errores por `code` en su host-bridge: el precedente que este ADR generaliza), ADR-048 §7 punto 1 (`protected.pdf` commiteado: el fixture que permitió reproducirlo), ADR-013 §6 (los eventos se emiten siempre en host — por eso el evento sí llega y el error no)

> Convención de citas: `ADR-049 §N` (sin calificar) refiere a **Decisión §N**, como en el resto de los ADRs del repo. Las secciones del contexto se citan explícitamente como `ADR-049, Contexto §N`.

## Contexto

### 1. El síntoma

Cargar un PDF protegido con contraseña debe abrir `PasswordDialog` para que el usuario la ingrese y reintente (`ui/Components.md` §2.7, `ui/React_Client.md` §4). Con el transporte real de workers (PR12 en adelante) lo que se ve es el **banner genérico de pipeline fallido** —el mismo que un PDF corrupto—, con el botón "Cerrar documento". El diálogo alcanza a abrirse y se cierra solo un instante después.

Reproducido de forma determinista (2/2 corridas, con script standalone de Playwright y con `tests/e2e/scenario-3-protected-pdf.spec.ts`) sobre `tests/fixtures/protected.pdf` (AES-256 real generado con `qpdf`, password `test1234`, ADR-048 §7 punto 1).

### 2. La causa raíz: `serialize()`/`deserialize()` pierden la identidad de clase

La cadena, verificada en el código:

1. `pdf-engine/src/pdf.engine.ts` detecta el caso, emite `PDF_PASSWORD_REQUIRED` en el canal `pdf` y lanza `PdfPasswordRequiredError`. Con transporte real esto ocurre **dentro del Worker**.
2. `pdf-engine/src/worker/entry.ts` (`handleRun`, catch): `err instanceof EngineError` → `post({ type: "FAILED", jobId, error: err.serialize() })`. `serialize()` produce un objeto plano `{ code, engineId, message, retryable, details }` (`shared/src/errors.ts`). **La clase no cruza `postMessage`** — no puede: structured clone no transporta prototipos.
3. `src/worker-pool.ts`, caso `"FAILED"`: `pending.reject(EngineError.deserialize(outbound.error))`.
4. `shared/src/errors.ts`, `EngineError.deserialize()`: devuelve **siempre** un `DeserializedEngineError` genérico. El propio comentario ya marcaba la limitación ("los motores específicos pueden override para devolver su subclase concreta"), pero ningún motor la overridea hoy.
5. `src/orchestrator.ts`, `handleExtractionFailure`: `err instanceof PdfPasswordRequiredError` da **`false`** contra un `DeserializedEngineError` → cae a `failPipeline(documentId, err)` → `PIPELINE_FAILED`, stage `Failed`.
6. `PasswordDialog` observa `stage`: al pasar a `Failed` fuerza el cierre del diálogo que el evento sí había abierto (los **eventos** cruzan el bus-bridge intactos, ADR-013 §6 — solo el camino de excepción pierde fidelidad), y el banner genérico toma la pantalla.

El bug es invisible con pools in-process (Hito 9): ahí la excepción nunca se serializa y el `instanceof` acierta. Por eso sobrevivió a `unit.test.ts`/`edge.test.ts` del façade, que mockean los motores y corren todo en el mismo realm.

### 3. Hay un **segundo** sitio afectado, no reportado

`orchestrator.ts` (despacho de `pdf-parse`) pasa un `isRetryable` propio:

```ts
isRetryable: (err) =>
  err instanceof EngineError && err.retryable && !(err instanceof PdfPasswordRequiredError),
```

El override existe porque `PdfPasswordRequiredError` se construye hoy con `retryable: true`, contra lo que ya declaran `05_Worker_Architecture.md` §5 y `PDF_Engine.md` §11 (errata de ADR-035 §3). Cruzando el worker, ese segundo `instanceof` también falla y el predicado queda en `err.retryable === true`: **el pool reintenta el PDF protegido** con backoff antes de fallar. O sea, el mismo bug de identidad produce dos síntomas: el diálogo que se cierra y unos reintentos que no deberían existir.

### 4. Barrido del resto de los `instanceof` (qué más está latente y qué no)

Verificado sobre todo `packages/`:

- **`CancelledError` no está afectado.** El worker no lo serializa: `entry.ts` lo discrimina *antes* del `FAILED` y postea un frame `CANCELLED` propio, y `worker-pool.ts` reconstruye un `CancelledError` real host-side (`pending.reject(new CancelledError(outbound.jobId))`). Los `instanceof CancelledError` del Orchestrator y del pool son correctos y se quedan como están.
- **`isRetryable`/`isTimeoutError` del pool no están afectados**: usan `instanceof EngineError` (que **sí** sobrevive: `DeserializedEngineError` extiende `EngineError`) más el flag `retryable` o el `code`. Ese es exactamente el patrón correcto.
- **Los tres motores con pool propia ya lo resuelven bien**: `normalizeNerError` (`ner-engine`, con un comentario que describe esta misma pérdida de identidad), `normalizeExportError` (`export-engine`) y el chequeo por `code` de `ocr-engine` reinstancian o discriminan por `EngineErrorCode` antes de decidir. El Orchestrator quedó como **el único** consumidor que discrimina por subclase concreta.
- **`RenderFailedError` se importa en el Orchestrator pero solo se instancia**, nunca se usa en un `instanceof`.

Conclusión del barrido: hoy hay **exactamente dos** `instanceof` de subclase concreta rotos, los dos sobre `PdfPasswordRequiredError`, los dos en `orchestrator.ts`.

> **Errata (2026-08-22): esa conclusión era falsa, y el punto ciego está en la línea de arriba.** Había un tercer `instanceof` roto, en `render-engine`: `renderPagesInternal` discriminaba con `err instanceof RenderPageFailedError || err instanceof RenderTimeoutError`, y `toPageFailure` con el mismo par (ahí el fallo era benigno — re-envolvía el error en vez de tomar la rama equivocada).
>
> El motivo es más simple y más feo que un matiz de análisis: el ítem anterior dice "**los tres** motores con pool propia" y enumera ner, export y ocr. Falta **`render-engine`**, que también corre sobre pool propia (`core/Render_Engine.md` §12, primera viñeta: "Corre en `RenderPool`"). No fue que el barrido evaluara `render-engine` y se equivocara: **no entró en la enumeración**, y la conclusión "exactamente dos" heredó ese hueco.
>
> **Salvedad sobre `pdf-engine`**, que no tiene pool ni puerto propio y por eso no participa de esto (`ai/Code_Standards.md` §7 lo nombra como el único caso, vía ADR-055 §10): sus dos `instanceof` de subclase (`pdf.engine.ts:1425` y `:1894`) capturan errores lanzados **en el mismo contexto**, así que el prototipo sobrevive y hoy no son este bug. Eso vale **solo mientras no tenga puerto**: el día que lo gane, los dos se convierten exactamente en esto, y los encontraría el mismo punto ciego.
>
> El costo fue exactamente el que este ADR predice en §6: el `instanceof` daba `false` para **todo** fallo de render de producción, así que el reintento de `core/Render_Engine.md` §11 nunca corría y el batch se abortaba por la rama "no recuperable" sin emitir `PREVIEW_PAGE_FAILED` — la UI no se enteraba de nada y el visor quedaba gris para siempre. Se corrigió por `code`, con un test que inyecta el error **deserializado** (§6) y que se verificó fallando contra el código viejo. Rastro medido en `roadmap/Post_Hito10.8_Pendientes.md` §21.

## Decisión

### 1. Regla general: por `code`, no por clase

**Todo código que pueda recibir un `EngineError` que cruzó (o pueda cruzar) el boundary de un Worker discrimina por `err.code` contra `EngineErrorCode`, nunca por `instanceof <SubclaseConcreta>`.** `instanceof EngineError` sigue siendo válido y necesario (distingue un error tipado del Core de un `Error` cualquiera): lo que no sobrevive al `postMessage` es la subclase, no la jerarquía base.

Esto no inventa nada: es lo que ya hacen `ner-engine`, `ocr-engine` y `export-engine` en sus host-bridges, y lo que `05_Worker_Architecture.md` §5 ya presupone al definir la política de reintentos sobre el **`SerializedEngineError`** y no sobre la clase.

### 2. `EngineError.deserialize()` **no se toca**

Se rechaza reconstruir la subclase concreta desde un registry `code → constructor` (ver "Alternativas"). `Contracts.md` §4 queda **sin cambios**: este ADR no modifica ningún contrato público — ni `SerializedEngineError`, ni `deserialize()`, ni `EngineErrorCode`, ni ningún payload de evento.

Sí se precisa la redacción del comentario de `deserialize()` en `Contracts.md` §4 para que deje de sugerir un override por motor que nunca ocurrió y que este ADR descarta: lo que se garantiza al cruzar el boundary son `code`/`engineId`/`message`/`retryable`/`details`, no la clase.

### 3. Helper único de discriminación, en el façade

El chequeo vive detrás de un type-guard con nombre, en `packages/anonymization-core/src/errors.ts` (archivo que ya existe):

```ts
export function isEngineErrorCode<C extends EngineErrorCode>(
  err: unknown,
  code: C,
): err is EngineError & { readonly code: C } {
  return err instanceof EngineError && err.code === code;
}
```

En el façade y no en `shared/`, por dos razones: hoy tiene un único consumidor (el Orchestrator), y ponerlo en `shared` obligaría a que el PR toque dos paquetes (R-1/R-5). Si aparece un segundo consumidor fuera del façade, promoverlo a `shared` es un movimiento mecánico y sin cambio de contrato.

> **Actualización (2026-08-22): apareció el segundo consumidor y el helper se promovió.** `render-engine` lo necesita para el `instanceof` roto que documenta la errata de Contexto §4, y un motor no puede importar el façade (P-1), así que la única alternativa a promoverlo era duplicarlo. Vive en `packages/anonymization-core/shared/src/errors.ts` y se exporta desde `@anonly/shared`; el façade y `render-engine` lo importan de ahí. Sin cambio de contrato, tal como decía esta sección.

### 4. `PdfPasswordRequiredError.retryable` pasa a `false` — se cierra el pendiente de ADR-035 §3

`pdf-engine/src/pdf.errors.ts`, segundo argumento del `super(...)`: `true → false`. Con eso el predicado por defecto del pool (`err instanceof EngineError && err.retryable`) decide **igual** con la clase concreta y con la deserializada, porque lee el flag, no el prototipo — y el override de `isRetryable` del Orchestrator deja de tener razón de existir y se elimina.

Esto no es trabajo extra que este ADR inventa: es literalmente el "PR chico de `pdf-engine` posterior al Hito 9" que ADR-035 §3 dejó anotado y que `MVP.md` arrastra como pendiente. Resulta ser la otra mitad de este bug.

### 5. El único `instanceof` que queda se reemplaza

`handleExtractionFailure` pasa a `if (isEngineErrorCode(err, EngineErrorCode.PDF_PASSWORD_REQUIRED))`. Queda un solo punto de discriminación, por `code`, con comportamiento idéntico en transporte real y en el fallback in-process. Se retira el import de `PdfPasswordRequiredError` en `orchestrator.ts`, que queda huérfano.

### 6. Tests: el error se inyecta **deserializado**, o el test no prueba nada

Los tests actuales del façade pasan **con el bug presente**, porque mockean los motores y el error nunca se serializa. Cualquier test de regresión de este ADR debe atravesar el mismo camino que el transporte real:

```ts
const wireError = EngineError.deserialize(new PdfPasswordRequiredError(documentId).serialize());
```

y afirmar (a) que el stage sigue en `Extracting` y no se emite `PIPELINE_FAILED`, y (b) que el pool no reintentó. Un test que arroje la clase concreta es un test verde sobre un bug vivo.

### 7. Dos PRs, en este orden

Son dos módulos ⇒ **dos PRs** (R-1/R-5), y el orden **no es opcional**: si el del façade va primero, se retira el override mientras `retryable` sigue en `true` y el pool reintenta el PDF protegido dos veces antes de fallar.

| # | PR | Módulo | Contenido |
|---|---|---|---|
| 17.1 | `PdfPasswordRequiredError.retryable = false` | `pdf-engine` | §4. Tres líneas + fila de test en `edge.test.ts` (`PDF_Engine.md` §14). Cierra el pendiente de ADR-035 §3. |
| 17.2 | Discriminación por `code` en el Orchestrator | `packages/anonymization-core/src` | §3 (`isEngineErrorCode` en `src/errors.ts`), §5 (`handleExtractionFailure` + retiro del override y del import), §6 (tests con error deserializado), y el des-`fixme` de `tests/e2e/scenario-3-protected-pdf.spec.ts` con sus aserciones reales. Depende de 17.1. |

El des-`fixme` del Escenario 3 viaja en el PR 17.2 —y no en el PR17— porque es la **evidencia** del fix: es el test que hoy falla y que debe pasar para dar el bug por cerrado (mismo criterio con el que los PRs 12–16 exigían "E2E verde tras cada uno"). PR17 conserva los otros siete escenarios y su alcance de ADR-048.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Registry `code → constructor` en `EngineError.deserialize()`** | (a) **Invierte capas**: `shared/` tendría que conocer las clases de los motores, que dependen de `shared` y no al revés — bloqueado por ESLint (`@anonly/*-engine` en `no-restricted-imports`, P-1/P-2). La única salida es un registry mutable global poblado por side-effect de import: estado global con dependencia de orden de carga, frágil bajo tree-shaking y bajo tests que importan un motor aislado. (b) **La reconstrucción es lossy**: los constructores concretos toman argumentos de dominio (`constructor(documentId: string)`), no `(message, details)` — reconstruir haría `new PdfPasswordRequiredError(details.documentId)` y **descartaría en silencio** el `message` y los `details` que realmente viajaron desde el Worker. (c) Es la maquinaria más pesada para el problema más chico: dos call sites, uno de los cuales desaparece por §4. |
| **Override de `deserialize()` por motor** (lo que insinuaba el comentario original) | Mismo problema (b) que arriba, y agrega el de *quién* llama a qué override: el que deserializa es `worker-pool.ts`, que es genérico por `PoolKey` y no debe conocer el motor. Exigiría un despacho por `engineId` que es el mismo registry con otro nombre. |
| **Hook `reviveError` por job en `DispatchParams`** | Plumbing nuevo en el transporte (`worker-pool.ts`) para restaurar una identidad que después se consulta una sola vez. Más superficie de contrato interno que la condición que evita. Si algún día un motor necesita **reinstanciar** (no solo discriminar), el patrón ya resuelto y probado es normalizar en el host-bridge del motor, como `normalizeNerError`. |
| **Solo cambiar `handleExtractionFailure`, sin tocar `retryable`** | Deja vivo el segundo síntoma (§3): el pool sigue reintentando el PDF protegido, con backoff, antes de mostrar el diálogo. Y deja el override `instanceof` en el código como trampa para el próximo lector. |
| **Dejarlo y marcar el Escenario 3 como `fixme` permanente** | Es un bug de producto reproducible en el flujo normal del usuario, no una limitación de test: hoy, en la app real, un PDF protegido es indistinguible de uno corrupto. |

## Consecuencias

**Positivas**: el flujo de password vuelve a funcionar con transporte real; desaparecen los reintentos espurios sobre un error que nunca fue auto-reintentable; el código del Orchestrator queda alineado con lo que ya hacen los tres motores con pool propia; la regla queda escrita en `Code_Standards.md`, que es donde el próximo implementador la va a leer antes de introducir el mismo `instanceof`; se cierra un pendiente que venía arrastrándose desde el Hito 9.

**Negativas**: la discriminación por `code` es menos expresiva que por tipo — se pierde el narrowing automático al subtipo concreto (`details` sigue siendo `Readonly<Record<string, unknown>>` y hay que leerlo con guardas). Es el precio de un boundary que no transporta prototipos, y el type-guard de §3 al menos preserva el narrowing del `code`.

**Neutras**: ningún contrato público cambia; ningún payload de evento cambia; `deserialize()` y `DeserializedEngineError` siguen exactamente como están. La cobertura y los gates no se mueven de umbral.

## Docs actualizados por este ADR

- `ai/Code_Standards.md` §7: regla normativa nueva (discriminar por `code` a través del boundary de Worker) con el ejemplo correcto y el incorrecto.
- `core/Contracts.md` §4: se precisa el comentario de `deserialize()` — qué se garantiza al cruzar el boundary y qué no. **Sin cambio de shape** (R-2/R-19 no aplica: no hay cambio de contrato).
- `core/Orchestrator.md` v1.5.2: nota de versión, §13 caso 3 (el mecanismo de discriminación), §14 (dos tests nuevos), §15 (item 19).
- `core/PDF_Engine.md` §11: la nota del flag `retryable` deja de decir "va en un PR chico posterior al Hito 9" y pasa a citar el PR 17.1 de este ADR.
- `architecture/05_Worker_Architecture.md` §5: bullet nuevo sobre la pérdida de identidad de clase en el camino `FAILED`, y por qué `CANCELLED` no la sufre.
- `roadmap/MVP.md` (Hito 9 pendiente, Hito 10 narrativa y tabla de PRs) y `adr/ADR-038` §8: PRs 17.1 y 17.2 insertados.
- `roadmap/Hito10_Observaciones_Revision.md`: entrada del bug + tarea de seguimiento.

## Validación

- `tests/e2e/scenario-3-protected-pdf.spec.ts` sin `test.fixme` y verde: cargar `protected.pdf` abre `PasswordDialog` y **no** aparece el banner de pipeline fallido; ingresar `test1234` completa el pipeline hasta `Ready`; una contraseña incorrecta vuelve a pedirla en vez de fallar el pipeline.
- Test del façade con `EngineError.deserialize(new PdfPasswordRequiredError(id).serialize())`: stage sigue en `Extracting`, sin `PIPELINE_FAILED`, y el pool no reintentó (spy de `dispatch`/`run`).
- Test de `pdf-engine`: `new PdfPasswordRequiredError(id).retryable === false`.
- Grep de control, verde tras el fix: ningún `instanceof` de subclase concreta de `EngineError` fuera de `CancelledError` en `packages/anonymization-core/src/`.
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`, y `pnpm test:e2e` (con `pnpm assets:mirror` previo, ADR-048 §1).

## Referencias

- `core/Contracts.md` §4 (`EngineError`, `SerializedEngineError`, `EngineErrorCode`) — `ai/Code_Standards.md` §7 — `architecture/05_Worker_Architecture.md` §5/§9 — `core/Orchestrator.md` §13 caso 3, §14 — `core/PDF_Engine.md` §11
- `adr/ADR-013` §6 (eventos siempre en host) — `adr/ADR-035` §3 (`retryable`) — `adr/ADR-036` §2/§3 (transporte real) — `adr/ADR-045`/`ADR-046`/`ADR-047` (normalización por `code` en los host-bridges) — `adr/ADR-048` §7 punto 1 (`protected.pdf`)
- Código: `packages/anonymization-core/shared/src/errors.ts` (`serialize`/`deserialize`/`DeserializedEngineError`) — `packages/anonymization-core/pdf-engine/src/pdf.errors.ts` — `packages/anonymization-core/pdf-engine/src/worker/entry.ts` (`handleRun`) — `packages/anonymization-core/src/worker-pool.ts` (`"FAILED"`/`"CANCELLED"`, `isRetryable`, `isTimeoutError`) — `packages/anonymization-core/src/orchestrator.ts` (`handleExtractionFailure`, override `isRetryable`) — `packages/anonymization-core/src/errors.ts` — `packages/anonymization-core/ner-engine/src/ner.engine.ts` (`normalizeNerError`) — `apps/react-client/src/components/toolbar/PasswordDialog.tsx` — `tests/e2e/scenario-3-protected-pdf.spec.ts` — `tests/fixtures/protected.pdf`
