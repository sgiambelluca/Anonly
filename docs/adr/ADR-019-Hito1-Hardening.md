<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,adr/ADR-007-Event-Bus.md,adr/ADR-012-Replacement-Modes.md,adr/ADR-017-Claude-Code-Workflow.md,ai/Code_Standards.md | audiencia=humanos+IA | fase=5 -->

# ADR-019 — Hardening del Hito 1 (`@anonly/shared` + `@anonly/event-system`)

- **Estado**: Accepted
- **Fecha**: 2026-07-08
- **Decidido por**: Usuario + planificador
- **Relacionado con**: ADR-007 (Event Bus), ADR-008 (Immutability), ADR-012 (Replacement Modes), ADR-017 (Claude Code Workflow)

## Contexto

Antes de empezar el Hito 3, se hizo un code review integral del Hito 1 (`packages/anonymization-core/shared`, `packages/anonymization-core/event-system` y el tooling raíz del monorepo). El review encontró una serie de desviaciones entre el código y `core/Contracts.md`/`ADR-007`, deuda de migraciones incompletas (formas duplicadas de un mismo concepto) y huecos de rigor en los tests contractuales. Por `R-19` (todo cambio de contrato va primero a docs), este ADR registra las decisiones **antes** de que el PR de código las implemente.

El humano aprobó **todos** los cambios de abajo en un único PR. Esto es una excepción consciente a `R-1` ("un PR = un módulo"): ver la sección 10 de la Decisión.

## Decisión

### 1. Canal del bus tipado como `EventChannel` (elimina `EventChannelLike`)

`IEventBus.on/once/off/emit/emitAsync` tipan su parámetro `channel` con el enum `EventChannel` de `@anonly/shared`. Se elimina el alias `EventChannelLike = string` que existía en `interfaces.ts` "para evitar un import circular con `enums.ts`" — ese ciclo no existe en la práctica (ambos son módulos hoja del mismo paquete). `Contracts.md` §3.2 siempre definió la firma de `IEventBus` con `EventChannel`; el código tenía una desviación del contrato que este PR corrige alineando el código al doc, no al revés.

### 2. `EventBusOptions.logger` requerido; se elimina el fallback a `console.error`

`EventBusOptions.logger` deja de ser opcional (`logger?: ILogger` → `logger: ILogger`). Se elimina el fallback interno a `console.error` dentro de `invokeHandler`. `P-4` ("Prohibido `console.*` en `packages/`") es una prohibición absoluta sin excepciones documentadas; ese fallback era la única violación real de `P-4` en el código del Hito 1, y quedaba fuera del alcance del lint porque la regla `no-console` tenía `allow: ["warn", "error"]`. Con logger requerido, todo caller (el Orchestrator en producción; los tests hoy) debe proveer un `ILogger` real — no queda ningún camino de producción que depende de un logger por defecto.

### 3. `engineId: EngineId | "core"` en `EngineError` / `SerializedEngineError`

Se oficializa el valor literal `"core"` como `engineId` válido para errores de infraestructura compartida no atribuibles a un motor concreto. Los cuatro errores genéricos de `shared/src/errors.ts` (`EngineNotInitializedError`, `EngineDisposedError`, `InvalidInputError`, `CancelledError`) no pertenecen a ningún motor: son errores del framework del Core. `Contracts.md` §4 se actualiza para declarar el tipo como `EngineId | "core"` (antes solo `EngineId`) con una nota de qué significa `"core"`, y se agregan al snippet los métodos `serialize()` / `static deserialize()` — ya implementados — que permiten que un `SerializedEngineError` cruce el boundary de un Worker (`postMessage`) y se reconstruya como `EngineError` en el host.

### 4. `LogLevel` queda como única forma (union type)

Existían tres formas del mismo concepto: `enum LogLevel` (`enums.ts`, valor runtime), `type LogLevelString` (`interfaces.ts`, para tipos) y el re-export `LogLevelEnum` (`index.ts`). Se consolida en una sola: `export type LogLevel = "debug" | "info" | "warn" | "error"`, declarada en `interfaces.ts` junto a `ILogger` (que ya usa esos cuatro niveles). Se elimina el enum `LogLevel` de `enums.ts` y los alias `LogLevelEnum` / `LogLevelString`. `Contracts.md` §3.3 siempre documentó la forma union; el código arrastraba una migración incompleta de enum a union type.

### 5. `synthesize()` exige `seed` obligatorio (sin default hardcodeado)

`synthesize(type, indexInType, seed)` deja de tener `seed: string = "anonly-default-seed"`. Un default fijo contradice `ADR-012-Replacement-Modes.md` §"SAN y reidentificación": el seed del modo `synthetic` debe ser aleatorio por sesión para evitar correlación entre sesiones distintas del mismo documento. Con un default hardcodeado en `shared`, cualquier caller que no pasara `seed` explícito rompía esa garantía silenciosamente. La responsabilidad de generar (y mantener estable durante la sesión) el seed aleatorio pasa al **Grouping Engine** (Hito 6, ver `ADR-012` §SAN), que es quien conoce el ciclo de vida del documento y de sus grupos.

### 6. CUIT sintético: el dígito verificador 10 ya no se "trucha" a 9

El algoritmo módulo 11 de AFIP para CUIT puede dar `11 - (suma % 11) === 10`, un caso sin dígito verificador válido de un solo dígito. La implementación anterior mapeaba ese caso a `"9"` — un CUIT que un validador AFIP real **rechazaría**, porque `9` no es el resultado del algoritmo para ese `(prefijo, cuerpo)`. Se corrige: cuando el cálculo da 10, se regenera el `body` con el mismo `rng` determinista (avanzando su estado, sin reiniciar el seed) hasta obtener un cuerpo cuyo checksum sea un dígito 0–9 genuino. El caso `11 → 0` se mantiene (ese sí es válido: así lo define el algoritmo). El resultado siempre pasa un validador de checksum módulo 11 independiente de la implementación (ver el test nuevo de ~200 seeds en `shared/src/__tests__/contract.test.ts`).

### 7. `off()` / `Unsubscribe` tras `dispose()` del bus pasan a ser no-op

Antes, `off()` (y por lo tanto el `Unsubscribe` devuelto por `on()`) lanzaba si se llamaba después de `dispose()` del bus, igual que `on/once/emit/emitAsync`. En la práctica, un engine guarda sus `Unsubscribe` y los invoca en su propio `dispose()` sin poder garantizar el orden relativo entre el `dispose()` del bus y el suyo propio. Exigir que el caller lo sepa de antemano convierte un cleanup que por intención es idempotente ("dejar de escuchar") en una fuente de excepciones espurias durante el shutdown. Se cambia: `off()` y el `Unsubscribe` son no-op seguros post-`dispose()`. `on/once/emit/emitAsync` **siguen lanzando**: (re)suscribirse o emitir en un bus muerto sigue siendo un error de programación real que debe fallar de forma ruidosa.

### 8. `WorkerInbound` pasa a unión discriminada por `type`

`WorkerInbound` era una única interfaz con todos los campos opcionales (`jobId?`, `signalId?`, `jobType?`, `payload?`, `config?`), sin relación entre `type` y qué campos son válidos para ese mensaje — el compilador no detectaba, por ejemplo, un mensaje `CANCEL` sin `signalId`. Se alinea con `WorkerOutbound` (ya una unión discriminada desde el Hito 1) definiendo cuatro variantes (`INIT`, `RUN`, `CANCEL`, `DISPOSE`), cada una con exactamente los campos que necesita, todos `readonly`. `config` (en `INIT`) y `payload` (en `RUN`) quedan tipados `unknown`: cada worker los afina a su propio tipo cuando se implemente en su hito (`PdfParsePayload`, `OcrPagePayload`, etc., ya existen en `Contracts.md` §5 pero son específicos de job type, no del mensaje de transporte).

### 9. Semántica del bus documentada; freeze-shallow descartado; matriz emisor→receptor diferida a Hito 9

`ADR-007` prometía dos cosas que nunca se implementaron y que este PR decide formalmente no implementar en su forma original:

- **Freeze-shallow del payload en dev**: se descarta. La inmutabilidad ya se garantiza por tipos (`readonly` end-to-end en todo payload de `EventPayloadMap`) y por tests, consistente con `Code_Standards.md` §6 ("se prohíbe `Object.freeze` en hot paths; el contrato se garantiza por tipos y tests"). `emit`/`emitAsync` están en el hot path de cada evento del pipeline (potencialmente uno por palabra/página); un freeze recursivo o incluso shallow en cada emisión es un costo de runtime que ADR-007 no había medido y que Code_Standards ya prohíbe para hot paths.
- **Test de contrato de la matriz emisor→receptor** (`04_Event_System.md` §11): se difiere a Hito 9 (Orchestrator). La matriz solo se puede validar de punta a punta cuando existen los motores reales que emiten y escuchan; en el Hito 1 solo existen `shared` y `event-system`, sin motores que instanciar ni Orchestrator que los conecte.

Además, se documenta explícitamente la semántica ya implementada del bus (antes implícita en el código, ahora en `04_Event_System.md`): `emit` es un despacho **síncrono en línea** a los handlers registrados en el momento de la llamada (si no hay suscriptores, es un no-op silencioso, no un error). `emitAsync` es, hoy, un alias awaitable de `emit` (los handlers siguen siendo síncronos); existe para que los callers puedan `await` desde ya y para dejar la puerta abierta a handlers async sin romper el contrato público de `IEventBus`.

### 10. Excepción a R-1 para este PR

`AI_Development_Guide.md` R-1 exige "un PR = un módulo". Este PR toca `shared`, `event-system`, tooling raíz (`eslint.config.js`, cuatro `package.json`, `tests/tsconfig.json`) y documentación transversal (este mismo ADR incluido). Es una **excepción consciente, autorizada explícitamente por el humano**: se trata de un hardening transversal pre-Hito 3 (antes de construir motores sobre estos contratos) en un proyecto de un solo desarrollador, donde separar en varios PRs secuenciales generaría más fricción de coordinación que valor de aislamiento — los cambios son interdependientes (el canal tipado de `interfaces.ts` solo tiene sentido si `event-bus.ts` lo consume en el mismo cambio; el `no-console` estricto de `eslint.config.js` solo puede activarse una vez que `event-bus.ts` ya no tiene el fallback a `console.error`). Esta excepción **no sienta precedente automático**: la próxima vez que una tarea toque dos módulos requiere la misma autorización explícita del humano.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Seed obligatorio en `synthesize()` | Mantener el default `"anonly-default-seed"` | Rompe la garantía de "seed aleatorio por sesión" de ADR-012 §SAN para cualquier caller que no pase seed; un bug de omisión se vuelve silencioso en vez de un error de tipo. |
| CUIT: regenerar `body` en vez de mapear 10→9 | Mantener el mapeo 10→9 documentando la limitación | Un CUIT con dígito verificador inválido es peor que uno improbable pero válido: cualquier validación externa (o el propio usuario) lo detecta como "sintético roto", no como dato anonimizado plausible. |
| `off()` no-op post-dispose | Mantener el throw en `off()` también | Obliga a todo caller de `Unsubscribe` a encapsular su propio try/catch en cleanup paths, solo para una operación que es conceptualmente idempotente. |
| Freeze-shallow del payload | Implementarlo solo en dev (`process.env.NODE_ENV`) | El Core no tiene bundler (`Code_Standards.md` §1) ni una noción runtime confiable de "modo dev"; introducir una rama de comportamiento dev-only es en sí una superficie de bugs no testeada en producción. Tipos + tests ya cubren el contrato (Code_Standards §6). |
| Matriz emisor→receptor por test de contrato ahora | Simularla con mocks de motores inexistentes | Un mock de un motor que todavía no tiene spec de implementación fija comportamiento antes de que el spec lo defina — el test quedaría desincronizado del motor real cuando se implemente, dando falsa confianza. |

## Consecuencias

**Positivas**:
- El código de `shared` y `event-system` queda alineado 1:1 con `core/Contracts.md`: cero desviaciones de contrato conocidas al cierre de este PR.
- Se elimina la única violación real de `P-4` (`console.error` en el bus) y se cierra la puerta a que reaparezca (lint estricto sin `allow`).
- `synthesize()` y el CUIT sintético dejan de tener casos que un validador externo (AFIP, un lector humano) pueda identificar como "generado incorrectamente".
- `WorkerInbound` discriminado detecta en compile-time mensajes mal formados antes de llegar al Hito 3 (donde se implementan los primeros Workers reales).
- La documentación de la semántica del bus (`emit`/`emitAsync`, no-op de canal sin suscriptores, `off()` post-dispose) reduce ambigüedad para los implementadores de motores en los próximos hitos.

**Negativas**:
- El PR es más grande de lo habitual (excepción a R-1), lo que dificulta un poco más la revisión en una sola pasada. Mitigado: cada decisión está aislada en su propia subsección de este ADR y su propio ítem de checklist en el PR.
- Cualquier caller externo de `synthesize()` sin seed explícito (no hay ninguno conocido dentro del repo a la fecha de este ADR) se rompe en compile-time. Aceptable: el único caller previsto (Grouping Engine) todavía no existe.
- La matriz emisor→receptor queda sin test de contrato automatizado hasta Hito 9. Riesgo aceptado explícitamente: no hay motores que puedan violarla todavía.

**Neutras**:
- `EventBusOptions.logger` requerido obliga a todos los tests existentes de `event-system` a instanciar un logger de prueba; no cambia el comportamiento del bus en sí, solo hace explícito lo que ya era la única ruta de producción real.

## Nota de actualización (2026-07-09)

El code review del Hito 2 detectó que la regla "`as unknown as` prohibido también en tests" era
impracticable en su forma absoluta: mockear la frontera de una librería externa con tipos complejos
(el `PDFDocumentLoadingTask` de pdfjs-dist; luego tesseract.js en Hito 3 y @xenova/transformers en
Hito 5) no admite mocks estructurales sin cast. Se **precisa** la regla: los casts de frontera
contra tipos de librerías externas mockeadas se permiten **solo** concentrados en helpers de
`__tests__/fixtures/` (uno por librería, con comentario justificativo); siguen prohibidos dispersos
en los archivos de test y para verificar contratos de tipos propios. Aplicado en `pdf-engine` vía
`mockGetDocumentResult`/`mockGetDocumentFailure` (46 ocurrencias dispersas → 1 concentrada). Ver
`ai/Code_Standards.md` §10.

## Referencias

- `core/Contracts.md` §3.2 (`IEventBus`), §3.3 (`LogLevel`), §4 (`EngineError`/`SerializedEngineError`), §8 (`EventPayloadMap`)
- `architecture/04_Event_System.md` §11 (matriz emisor→receptor), §12 (payloads), API del bus
- `architecture/05_Worker_Architecture.md` §2.1 (`WorkerInbound`)
- `architecture/03_Data_Model.md` §17 (`PipelineError`)
- `adr/ADR-007-Event-Bus.md` (nota de actualización 2026-07-08)
- `adr/ADR-012-Replacement-Modes.md` §SAN y reidentificación
- `adr/ADR-008-Immutability.md`
- `ai/Code_Standards.md` §6 (inmutabilidad), §10 (tests), §12 (prohibiciones absolutas)
- `ai/AI_Development_Guide.md` R-1, R-19
