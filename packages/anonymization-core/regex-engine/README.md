# @anonly/regex-engine

Detecta patrones determinísticos (DNI, CUIT, teléfono, email, IBAN, tarjeta, fecha, matrícula, patente) en el texto de cada página del `Document`. Emite `Occurrence[]` con `source: "regex"` y `confidence: 1.0`. Determinista: mismo input → mismo output.

## Ejecución

Corre en el **main thread**, sin Worker y sin pool. Es deliberado y no una deuda: es el motor más barato del pipeline —**< 5 % del total** (`docs/core/Regex_Engine.md` §12)—, y cruzar el texto de cada página por `postMessage` costaría más que lo que ahorraría.

## Documentación

- **Spec canónico**: [`docs/core/Regex_Engine.md`](../../../docs/core/Regex_Engine.md)
- Contratos base: [`docs/core/Contracts.md`](../../../docs/core/Contracts.md)
- Eventos: [`docs/architecture/04_Event_System.md`](../../../docs/architecture/04_Event_System.md) §5
- ADRs relevantes: [`ADR-011`](../../../docs/adr/ADR-011-Grouping-First.md) (por qué Regex emite a Grouping, no a UI), [`ADR-012`](../../../docs/adr/ADR-012-Replacement-Modes.md) (`maskFormat` por tipo), [`ADR-022`](../../../docs/adr/ADR-022-Regex-Phone-AR-Word-Boundaries.md) (límites de palabra en el patrón Phone AR mobile)

## Contenido

- `regex.types.ts` — `RegexPattern`, `CatalogFormat`, `RegexEngineInput`, `RegexEngineOutput`.
- `regex.errors.ts` — `RegexInvalidPatternError`.
- `patterns/default-ar.ts` — `DEFAULT_PATTERNS_AR` (11 patrones AR con checksum/normalizer/maskFormat).
- `patterns/catalog.ts` — `BASE_CATALOG` y `getCatalog` (ADR-221 §2): los patrones base con su `CatalogFormatInfo`.
- `formats/` — el generador de formatos (ADR-220): autómata de Thompson y recorrido lineal (`format-automaton.ts`), `validateFormat` y `testFormat` (`format-validation.ts`), `compareFormat` (`format-compare.ts`).
- `regex.engine.ts` — clase `RegexEngine` (implementa `IEngine`): `init`, `process`, `findLiteral`, `searchText`, `dispose`.

## Reglas

- Nunca importa otro motor ni React (spec §5 "Dependencias prohibidas"). Solo `@anonly/shared`; sin dependencias externas (usa `RegExp` nativo de JS).
- No se suscribe al bus: solo emite `ENTITY_FOUND` (interno, solo lo escucha Grouping Engine) y `REGEX_FINISHED`.
- Los formatos del usuario llegan por `ctx.config.detection.userFormats` (ADR-223 §2) y se compilan en `init`; `addPattern`, `removePattern` y los patrones con `RegExp` del usuario se retiraron en la v2.0.0 (ADR-220 §7).
- Overlap entre patrones (p. ej. DNI dentro de un CUIT): gana el match más largo en el mismo span (spec §13 caso 10).
- Los formatos del generador no usan `RegExp`: un autómata propio sin retroceso, O(caracteres × estados) por página, con `FORMAT_MAX_STATES` como tope (spec §6, §12). No hay presupuesto de tiempo.

## Scripts

```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest run
pnpm build         # tsc para generar dist/
```
