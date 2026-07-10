# @anonly/regex-engine

Detecta patrones determinísticos (DNI, CUIT, teléfono, email, IBAN, tarjeta, fecha, matrícula, patente) en el texto de cada página del `Document`. Emite `Occurrence[]` con `source: "regex"` y `confidence: 1.0`. Determinista: mismo input → mismo output.

> Hito 4 (`docs/roadmap/MVP.md` §4). Corre en el **main thread** (no en Worker): es liviano, < 5% del pipeline total (`docs/core/Regex_Engine.md` §12).

## Documentación

- **Spec canónico**: [`docs/core/Regex_Engine.md`](../../../docs/core/Regex_Engine.md)
- Contratos base: [`docs/core/Contracts.md`](../../../docs/core/Contracts.md)
- Eventos: [`docs/architecture/04_Event_System.md`](../../../docs/architecture/04_Event_System.md) §5
- ADRs relevantes: [`ADR-011`](../../../docs/adr/ADR-011-Grouping-First.md) (por qué Regex emite a Grouping, no a UI), [`ADR-012`](../../../docs/adr/ADR-012-Replacement-Modes.md) (`maskFormat` por tipo), [`ADR-022`](../../../docs/adr/ADR-022-Regex-Phone-AR-Word-Boundaries.md) (límites de palabra en el patrón Phone AR mobile)

## Contenido

- `regex.types.ts` — `RegexPattern`, `RegexEngineConfig`, `RegexEngineInput`, `RegexEngineOutput`.
- `regex.errors.ts` — `RegexInvalidPatternError`.
- `patterns/default-ar.ts` — `DEFAULT_PATTERNS_AR` (11 patrones AR con checksum/normalizer/maskFormat).
- `regex.engine.ts` — clase `RegexEngine` (implementa `IEngine`): `init`, `process`, `addPattern`, `removePattern`, `dispose`.

## Reglas

- Nunca importa otro motor ni React (spec §5 "Dependencias prohibidas"). Solo `@anonly/shared`; sin dependencias externas (usa `RegExp` nativo de JS).
- No se suscribe al bus: solo emite `ENTITY_FOUND` (interno, solo lo escucha Grouping Engine) y `REGEX_FINISHED`.
- `addPattern`/`removePattern` existen en la interfaz pública (contrato del motor, spec §6) pero la UI de patrones custom está fuera de alcance MVP (`docs/roadmap/MVP.md` §3).
- Overlap entre patrones (p. ej. DNI dentro de un CUIT): gana el match más largo en el mismo span (spec §13 caso 10).
- Patrones custom: timeout best-effort de 1000ms por página por patrón y try/catch ante regex que lanza al ejecutarse (spec §12, §13 casos 8-9). Ambos mecanismos están implementados; los tests dedicados de cancelación/perf (`cancel.test.ts`, `perf.test.ts` de la sección 14 del spec) quedan diferidos a Hito 11, igual que en PDF Engine (`docs/roadmap/MVP.md` §4 Hito 2).

## Scripts

```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest run
pnpm build         # tsc para generar dist/
```
