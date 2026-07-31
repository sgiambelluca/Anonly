<!-- CONTEXT: scope=adr | dependencias=architecture/05_Worker_Architecture.md,architecture/03_Data_Model.md,core/Contracts.md,ai/Code_Standards.md,adr/ADR-019-Hito1-Hardening.md,adr/ADR-031-RenderFailed-ErrorCode-Erratas-Render.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md | audiencia=humanos+IA | fase=10 -->

# ADR-042 — `WorkerOutbound.COMPLETED.result` pasa de `Serializable` a `unknown`

- **Estado**: Accepted
- **Fecha**: 2026-07-22
- **Decidido por**: El humano, sobre el segundo informe de ambigüedad de PR12 (levantado por el implementador al terminar el entry-point del PdfWorker y confirmado por el revisor como bloqueante y transversal a los 5 PRs de worker). El registro del informe está en `roadmap/Hito10_Observaciones_Revision.md`, entrada "PR12".
- **Relacionado con**: ADR-019 (`INIT.config`/`RUN.payload` tipados `unknown` a nivel de transporte — este ADR aplica la misma regla en la dirección de vuelta), ADR-031 (§4: única excepción vigente de `as unknown as` en producción — este ADR evita crear una segunda), ADR-036 (§3: variante `EVENT` con `payload: unknown` — segundo precedente de la misma regla), ADR-041 (PR12; su §5 previó auditar sorpresas transversales antes de repetirlas motor por motor — mismo espíritu acá)

## Contexto

El entry-point del PdfWorker responde `COMPLETED` con el resultado de `engine.process()`. `WorkerOutbound.COMPLETED.result` estaba tipado `Serializable` (`shared/src/interfaces.ts`):

```ts
export type Serializable =
  | string | number | boolean | null | undefined
  | ReadonlyArray<Serializable>
  | { readonly [key: string]: Serializable };
```

`PdfEngineOutput` — como todos los tipos de dominio del Core (`Document`, `Page`, `Word`, `BoundingBox`, cada `*EngineOutput`) — es una **`interface`**, y TypeScript no asigna una `interface` nombrada a un tipo con index signature aunque todos sus campos sean datos planos compatibles uno por uno (limitación conocida del compilador, microsoft/TypeScript#15300; un `type` alias con la misma forma sí chequea). Recursivo: no se resuelve tocando un tipo, porque toda la cadena `Document`→`Page`→`Word`→`BoundingBox` son `interface`s.

No es un problema de runtime (`postMessage` clona la data real sin mirar el tipo estático), pero sí de contrato:

- `Code_Standards.md` §10 reserva `as unknown as` en producción a la única excepción de ADR-031 §4 y exige ADR propio para cualquier otro caso de frontera; §2 exige issue/ADR referenciado para todo `@ts-expect-error`. El implementador dejó un `@ts-expect-error` documentado como **pendiente de decisión** (manejo correcto: sin cast inventado, ambigüedad reportada).
- Es **transversal**: los entry-points de PR13–16 (Render, Ocr, Ner, Export) responden `COMPLETED` con sus propios `*EngineOutput` — el mismo choque, 4 veces más.

Verificación previa a la decisión: `Serializable` se usa en exactamente **tres** campos, todos de `WorkerOutbound` (`PROGRESS.partial`, `COMPLETED.result`, `LOG.meta`) — en ningún otro punto del contrato ni de `Contracts.md` (donde `WorkerOutbound` no aparece; el contrato de mensajería vive en `05_Worker_Architecture.md` §2). Y la regla "los tipos concretos se afinan en el otro lado de la frontera" ya está escrita dos veces: `05_Worker_Architecture.md` §2.1 ("`config` (en `INIT`) y `payload` (en `RUN`) quedan tipados `unknown` a este nivel de transporte — cada worker los afina a su propio tipo concreto", ADR-019) y la variante `EVENT` (ADR-036 §3, `payload: unknown` — payloads que también son `interface`s). `COMPLETED.result: Serializable` era la única celda del protocolo inconsistente con esa regla.

## Decisión

### 1. `COMPLETED.result: unknown`

```ts
// 05_Worker_Architecture.md §2.2 (ADR-042)
| { readonly type: "COMPLETED"; readonly jobId: string; readonly result: unknown; readonly transferred?: ReadonlyArray<Transferable> }
```

Misma regla que `INIT.config`/`RUN.payload` (§2.1, ADR-019) y `EVENT.payload` (ADR-036 §3): el tipo concreto no existe a nivel de transporte. El lado que consume afina: el host-bridge de cada motor estrecha `result` a su `*EngineOutput` esperado con el mismo comentario de frontera estilo ADR-019 que ya usa el lado `RUN` en el entry-point. El `@ts-expect-error` del entry-point del PdfWorker se elimina; `post({ type: "COMPLETED", jobId, result })` compila directo.

### 2. `PROGRESS.partial` y `LOG.meta` conservan `Serializable`

La limitación de TS solo muerde con `interface`s **nombradas**; los objetos literales ad-hoc — lo que de hecho viaja en `partial` y `meta` (p. ej. `{ pageIndex }`) — sí chequean contra el index signature. Mantener `Serializable` ahí conserva una garantía estática real (que no se cuele una función, un `Map` o una clase en un mensaje que cruza `postMessage`) a costo cero. Si un motor futuro choca la misma pared en `partial`, este ADR se extiende por amendment — no se resuelve con un cast local.

### 3. Patrón sancionado para PR13–16

Los entry-points de Render/Ocr/Ner/Export replican el patrón sin volver a levantar la ambigüedad: `RUN.payload` se afina al payload del job en el entry-point (ADR-019); `COMPLETED.result` se afina al `*EngineOutput` en el host-bridge (este ADR); los eventos viajan por `EVENT` con `payload: unknown` y el host-bridge los re-emite afinados (ADR-036 §3). Ningún `as unknown as`, ningún `@ts-expect-error` de transporte.

> **Amendment (2026-07-31, ADR-055) — "afinar" es decodificar, no castear**: este ADR declaró `result: unknown` a nivel de transporte pero dejó el lado del consumidor como "el host-bridge lo estrecha con comentario de frontera". Un cast anotado **no** es una verificación: el parámetro de tipo de `dispatch<T>` es una afirmación que el compilador no puede comprobar contra lo que de verdad llega por `postMessage`. La consecuencia se cobró en `ner-engine`, que estuvo semanas sin detectar **ninguna** entidad porque el worker posteaba `{ spans }` y el host iteraba el resultado como si fuera un array (ver ADR-055, Contexto §1).
>
> ADR-055 completa este ADR con la obligación correspondiente del lado del consumidor: **guard de runtime**, impuesto por tipos (el puerto interno de cada motor devuelve `Promise<unknown>`), y prohibición de que un decoder devuelva un default en silencio. Este ADR no se revisa: `result: unknown` sigue siendo la decisión correcta a nivel de transporte; lo que faltaba era decir qué obliga a hacer del otro lado.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| (A) Ampliar la rama de objeto de `Serializable` para aceptar `interface`s | No es expresable en TS sin perder la garantía por completo (la restricción estructural con index signature **es** la garantía); debilitaría también `partial`/`meta`, los dos usos donde hoy sí funciona. |
| (B) Helper `toSerializable<T>()` en `shared` (cast único revisado, o validación runtime) | Como cast puro, es la misma brecha estática concentrada en un archivo pero con una pieza nueva que mantener; con validación real, costo runtime por resultado (validar en profundidad un `Document` de miles de `Word`s en cada parseo) para cubrir una brecha que es solo de tipos. |
| (D) Migrar los tipos de dominio de `interface` a `type` alias | Churn masivo sobre `Contracts.md` y todos los motores para esquivar una limitación puntual del compilador en un punto de frontera — desproporcionado. |
| (C ampliada) `unknown` también en `partial` y `meta` | Regala gratis la garantía estática en los dos campos donde el chequeo sí opera (literales ad-hoc); no hay choque real que lo justifique hoy. |

## Consecuencias

**Positivas**: el protocolo queda con una sola regla de tipado en las dos direcciones ("tipos concretos se afinan al cruzar la frontera"); desaparece el `@ts-expect-error` y no nace una segunda excepción de `as unknown as` (ADR-031 §4 sigue siendo la única); los 4 PRs de worker restantes heredan el patrón sin pausa; cambio mínimo (un campo en `shared/src/interfaces.ts` + una fila del doc).

**Negativas**: el consumidor de `COMPLETED.result` (host-bridge/pool) pierde el chequeo automático y debe afinar explícitamente — mitigado: es exactamente lo que el lado `RUN`/`EVENT` ya hace, con comentario de frontera obligatorio (ADR-019, `Code_Standards.md` §10).

**Neutras**: `Serializable` sigue existiendo con sus dos usos restantes (`partial`, `meta`); structured clone en runtime no cambia en nada.

## Docs actualizados por este ADR

- `architecture/05_Worker_Architecture.md` §2.2: fila `COMPLETED` (`result: unknown`) + párrafo introductorio con la regla y el porqué de que `partial`/`meta` no cambien.
- `roadmap/Hito10_Observaciones_Revision.md`: entrada "PR12", registro del informe y el veredicto.

## Validación

- `pnpm typecheck` verde sin el `@ts-expect-error` en `pdf-engine/src/worker/entry.ts`.
- Los tests de transporte de PR11 (`worker-pool.ts`, fakes estructurales de `WorkerLike`) siguen verdes: el estrechamiento de `result` en el lado host queda cubierto por los tests del host-bridge de PR12.
- Gates completos (`pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`) verdes al cierre de PR12.

## Referencias

- `architecture/05_Worker_Architecture.md` §2.1–§2.2 — `ai/Code_Standards.md` §2, §10
- `adr/ADR-019` — `adr/ADR-031` §4 — `adr/ADR-036` §3 — `adr/ADR-041` §5
- `packages/anonymization-core/shared/src/interfaces.ts` (`Serializable`, `WorkerOutbound`) — `packages/anonymization-core/pdf-engine/src/worker/entry.ts` (estado previo con `@ts-expect-error`)
- microsoft/TypeScript#15300 (interfaces vs index signatures)
