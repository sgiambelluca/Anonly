<!-- CONTEXT: scope=adr | dependencias=architecture/07_Performance_Strategy.md,adr/ADR-032-Export-EncodedPageImage-Requested-Warning.md,ai/Code_Standards.md | audiencia=humanos+IA | fase=9 -->

# ADR-033 — Test-infra global: scripts `test:<dir>` con filtro posicional y resolución de motores desde `tests/`

- **Estado**: Accepted
- **Fecha**: 2026-07-16
- **Decidido por**: El humano, sobre propuesta del planificador (reconciliación post-Hito 8)
- **Relacionado con**: ADR-032 (auditoría pre-Hito 8; §4 y Contexto quedan corregidos en parte por este ADR), ADR-031 (precedente de erratas doc-only), 07 §11.4 (tabla canónica de gates)

## Contexto

Durante el Hito 8 (`export-engine`, PR APPROVED), el implementador tuvo que corregir dos piezas
de infraestructura de tests globales para que sus propios gates corrieran. Ambos fixes son
correctos y de alcance mínimo (verificados empíricamente por el revisor), pero establecen
precedentes transversales que exceden a un motor y que, por R-18, deben quedar decididos en un
ADR antes de que el Hito 9 construya el harness de integración encima. El implementador
correctamente no editó ADR-032 ni creó uno nuevo (R-21); la reconciliación es del planificador.

Hechos verificados:

1. **`vitest run --dir tests/security` no encuentra tests** (`No test files found`, exit 1).
   Causa: `--dir` reancla el root del proyecto a `tests/security/`, y el `include` global
   `tests/**/*.test.ts` de `vitest.config.ts` pasa a resolverse como `tests/security/tests/**`
   (inexistente). El filtro posicional (`vitest run tests/security`) intersecta correctamente
   contra el `include`. El bug era latente desde la creación de los scripts: nunca se detectó
   porque los cinco directorios (`tests/{security,cancel,leak,perf,stress}/`) estaban vacíos.
   `test:security` ya fue corregido en el PR del Hito 8; `test:cancel`, `test:leak`,
   `test:perf` y `test:stress` conservan el `--dir` roto.
2. **Ningún `@anonly/*` se resuelve vía `node_modules` de la raíz**: por P-2, ningún motor es
   dependencia de ningún `package.json` de la raíz, así que pnpm no crea symlinks en
   `node_modules/@anonly/`. Los cuatro paquetes preexistentes (`shared`, `event-system`,
   `anonymization-core`) ya se resolvían exclusivamente por `resolve.alias` de
   `vitest.config.ts`. `tests/security/security.test.ts` (Hito 8) es el **primer** test global
   —fuera de un paquete— que importa un motor (`@anonly/export-engine`); requirió un alias
   nuevo en `vitest.config.ts` y un `paths` espejo en `tests/tsconfig.json`.
3. **ESLint hoy permite ese import por omisión, no por decisión**: los bloques
   `no-restricted-imports` que prohíben `@anonly/*-engine` aplican a
   `packages/anonymization-core/**`; `tests/**` de la raíz queda fuera de su alcance.
4. **ADR-032 quedó con drift código-vs-doc**: su Contexto lista como verificado-OK que
   "`test:security` ya corre `--dir tests/security`" y su errata §4 repite el flag. La
   afirmación era falsa ya al momento de escribirse (el bug latente nunca se había ejercitado).
   `Export_Engine.md` §14 no arrastra el error (cita el directorio y ADR-032 §4, sin el flag).

## Decisión

### 1. Todos los scripts `test:<dir>` usan filtro posicional; se corrigen los cinco ahora en `main`

Este doc-PR aterriza en `main` directamente, antes de que `feat/export-engine-hito-8` (aún sin
mergear) lo haga. `test:security` ya tenía el fix (filtro posicional) en esa rama, pero no en
`main`; `test:cancel`, `test:leak`, `test:perf` y `test:stress` no tenían fix en ninguna rama.
Para no dejar `main` con cuatro scripts corregidos y uno todavía roto —contradiciendo esta misma
decisión mientras esa rama no mergea—, los cinco pasan de `vitest run --dir tests/<x>` a
`vitest run tests/<x>` acá. Cuando `feat/export-engine-hito-8` mergee, su commit trae la misma
línea para `test:security`: contenido idéntico, sin conflicto.

- **Por qué ahora y no "cuando toque su hito"**: el riesgo es cero (los directorios están
  vacíos; por 07 §11.4 cada gate se auto-activa recién al existir su directorio) y el costo de
  diferirlo es conocido: Hito 9/11 chocaría con el mismo `No test files found` en medio de un PR
  de implementación, forzando otra vez un fix de infra fuera de módulo.
- `--dir` queda prohibido en scripts `test:*` del monorepo mientras el `include` global sea
  relativo al root.

### 2. Convención de resolución de motores desde `tests/`: alias explícito por motor, a demanda

Se ratifica el patrón introducido en Hito 8 como convención general para todo test global
(integración, security, cancel, leak, perf, stress):

- Un test de `tests/` que necesita un motor lo importa **solo por su contrato público**
  (`@anonly/<engine>`, que resuelve a `src/index.ts` del paquete — el alias lo garantiza por
  construcción).
- La resolución se hace con **dos entradas espejo, explícitas, por motor**:
  `resolve.alias` en `vitest.config.ts` (fuente única de la ruta real) y `paths` en
  `tests/tsconfig.json`.
- Ambas entradas se agregan **a demanda, en el mismo PR que introduce el primer test global que
  importa ese motor** — análogo al glob de thresholds de cobertura que CLAUDE.md exige agregar
  en el mismo PR que implementa un motor. Se agrega una línea a CLAUDE.md (sección Gates)
  registrando esta obligación.
- Importar motores desde `tests/**` queda **bendecido explícitamente**: es la única ubicación,
  junto con el façade, autorizada a hacerlo. P-1/P-2 no cambian: la prohibición protege a los
  motores entre sí y al Core de React; los tests globales son consumidores del contrato
  público, igual que los `__tests__` de cada paquete respecto de `@anonly/event-system`.

### 3. Reconciliación de ADR-032: nota de corrección, sin reescribir el histórico

ADR-032 no se reescribe (el cuerpo de un ADR aceptado es registro histórico). Se agrega una
nota breve bajo su encabezado: "Corregido en parte por ADR-033: `test:security` corre
`vitest run tests/security` (filtro posicional); la forma `--dir` citada en Contexto y §4
nunca funcionó". `Export_Engine.md` §14 no requiere cambios.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Declarar los motores como `devDependencies` del root para que pnpm los linkee | Crea symlinks en `node_modules/@anonly/` que la config de Vitest excluye deliberadamente (`deps.moduleDirectories` + `exclude`, para no duplicar tests), y hace parecer dependencia instalable lo que es una relación de test. La frontera P-2 queda más nítida sin entradas en ningún `package.json` de la raíz. |
| Alias wildcard (`@anonly/*` → `packages/anonymization-core/*/src/index.ts`) | Rompe con `@anonly/anonymization-core` (el façade vive en `anonymization-core/src/`, no en `anonymization-core/anonymization-core/src/`) y pierde la auditabilidad: la lista explícita documenta exactamente qué motores consume `tests/`. |
| Corregir los scripts hermanos recién cuando su hito pueble el directorio | Difiere un fix de riesgo cero hacia el medio de un PR de implementación futuro, repitiendo exactamente la situación que este ADR viene a cerrar. |
| Ajustar el `include` de vitest para que `--dir` funcione | Invierte la carga: reconfigura el include global (que funciona para todos los demás usos) para rescatar un flag que no aporta nada sobre el filtro posicional. |

## Consecuencias

**Positivas**: Hito 9/11 hereda los cinco scripts `test:<dir>` funcionales y una convención
documentada para el harness de integración multi-motor; el drift código-vs-ADR queda
reconciliado; la frontera "quién puede importar motores" queda completa y explícita
(façade + `tests/` + `__tests__` de cada paquete).

**Negativas**: dos entradas por motor (vitest + tsconfig) a mantener a mano; si un paquete se
renombra o se mueve, hay que tocar ambas (mitigado: el comentario en `tests/tsconfig.json`
declara al alias de vitest como fuente única de la ruta).

**Fuera de alcance**: la tensión entre Code_Standards §10 y el patrón `as unknown as` en tests
de guards runtime (observación no bloqueante 4 del revisor de Hito 8) es una decisión de
estándar de código independiente de test-infra; si se endurece, será por errata de
Code_Standards, no acá.

## Referencias

- `package.json` (raíz) — scripts `test:{security,cancel,leak,perf,stress}`
- `vitest.config.ts` — `resolve.alias`, `include`, `deps.moduleDirectories`
- `tests/tsconfig.json` — `paths`
- `eslint.config.js` — bloques `no-restricted-imports` (alcance `packages/anonymization-core/**`)
- `architecture/07_Performance_Strategy.md` §11.4 — `adr/ADR-032` (Contexto, §4) — `adr/ADR-031` §5
- `core/Export_Engine.md` §14 — `ai/AI_Development_Guide.md` R-18, R-21
