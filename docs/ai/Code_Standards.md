<!-- CONTEXT: scope=estándares-de-código | dependencias=ninguna | audiencia=IA+humanos | fase=0 -->

# Anonly — Estándares de Código

> Reglas obligatorias para todo código TypeScript del proyecto. Aplican por igual a `apps/react-client` y a `packages/anonymization-core`. Cualquier desviación debe estar registrada en un ADR.

---

## 1. Stack y versiones

| Herramienta | Versión mínima | Notas |
|---|---|---|
| Node.js | 20 LTS | ESM nativo. |
| TypeScript | 5.4+ | `verbatimModuleSyntax` habilitado. |
| pnpm | 9+ | Monorepo vía workspaces. |
| Vite | 5+ | Solo `apps/react-client`. El Core no usa bundler. |
| Vitest | 1+ | Unit + contract + snapshots. |
| Playwright | 1.40+ | E2E. |

---

## 2. TypeScript — configuración obligatoria

`tsconfig.json` base (compartido por todos los paquetes):

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "strict": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": false,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": false,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**Prohibido**: `any`, `as unknown as`, `@ts-ignore`, `@ts-expect-error` sin justificación en comentario adyacente y issue referenciado. `as` solo para narrowing seguro documentado.

---

## 3. Estructura de un paquete del Core

Cada motor es un paquete independiente bajo `packages/anonymization-core/<engine>-engine/`.

```text
packages/anonymization-core/<engine>-engine/
├── package.json
├── tsconfig.json            // extends ../../tsconfig.base.json
├── src/
│   ├── index.ts             // export público exclusivamente
│   ├── <engine>.engine.ts   // clase que implementa IEngine
│   ├── types.ts             // tipos propios (no compartidos)
│   ├── errors.ts            // códigos de error del motor
│   └── __tests__/
│       ├── contract.test.ts // valida el contrato de IEngine
│       ├── unit.test.ts     // lógica interna
│       └── fixtures/        // entradas de prueba
└── README.md                // apunta a docs/core/<Engine>_Engine.md
```

- `index.ts` es el **único** punto de export. Nada se importa desde rutas internas.
- Los tests viven junto al código, no en un repositorio aparte.
- No hay `src/internal/` mágico: lo que no está en `index.ts` es implícitamente privado.

---

## 4. Naming

| Elemento | Convención | Ejemplo |
|---|---|---|
| Paquete (carpeta) | kebab-case + sufijo `-engine` | `pdf-engine` |
| Archivo de motor | kebab-case + `.engine.ts` | `pdf.engine.ts` |
| Archivo de tipos | kebab-case + `.types.ts` | `pdf.types.ts` |
| Clase de motor | PascalCase + sufijo `Engine` | `PdfEngine` |
| Interfaz pública | `I` + PascalCase | `IEngine`, `IEventBus` |
| Tipo / enum | PascalCase | `EntityType`, `EngineId` |
| Constante de config | UPPER_SNAKE_CASE | `MAX_PAGE_COUNT` |
| Variable / función | camelCase | `parsePage` |
| Evento (enum value) | UPPER_SNAKE_CASE | `PAGE_PARSED` |
| Error code | `<ENGINE>_<REASON>` | `PDF_PASSWORD_REQUIRED` |

---

## 5. Export e import

- **Solo exports nombrados.** Prohibido `export default`. Facilita el refactor automatizado y el análisis estático de IAs.
- Imports con `import type` para tipos cuando `verbatimModuleSyntax` lo exige.
- Imports agrupados y ordenados: (1) Node builtins, (2) externos, (3) `@anonly/...`, (4) relativos. Separados por línea en blanco.

```ts
import { readFile } from "node:fs/promises";

import type { IEventBus } from "@anonly/shared";

import { PdfEngine } from "./pdf.engine.js";
```

- Extensiones `.js` explícitas en imports relativos (ESM).
- Sin barrel files profundas: un solo nivel de `index.ts` por paquete.

---

## 6. Inmutabilidad

- Todo dato del Core es **inmutable**: `readonly` en todas las propiedades de tipos públicos y `ReadonlyArray<T>` para colecciones.
- Mutaciones internas usan copia estructural y devuelven una nueva referencia.
- Se prohíbe `Object.freeze` en hot paths (costo de runtime); el contrato se garantiza por tipos y tests.

```ts
export interface EntityGroup {
  readonly id: string;
  readonly type: EntityType;
  readonly canonicalValue: string;
  readonly members: ReadonlyArray<OccurrenceRef>;
  readonly replacementMode: ReplacementMode;
  readonly replacementValue: string;
  readonly indexInType: number;
  readonly enabled: boolean;
}
```

---

## 7. Manejo de errores

- Toda función pública del Core que puede fallar retorna `Result<T, EngineError>` o lanza una excepción **tipada** que extiende `EngineError`.
- **Prohibido** lanzar strings, `Error` genérico o `unknown`. Siempre una subclase de `EngineError` con `code`, `engineId` y `details`.
- Los códigos de error viven en el enum `EngineErrorCode` de `@anonly/shared` y deben coincidir con los listados en `core/<Engine>_Engine.md#errores-posibles`.

```ts
export class PdfPasswordRequiredError extends EngineError {
  readonly code = EngineErrorCode.PDF_PASSWORD_REQUIRED;
  constructor(documentId: string) {
    super("PDF_PASSWORD_REQUIRED", "pdf", { documentId });
  }
}
```

---

## 8. Concurrencia y cancelación

- Toda operación del Core de larga duración recibe un `AbortSignal` (vía `ctx`).
- Los Workers reciben el `AbortSignal` serializado como `signalId`; el host mantiene un `Map<signalId, AbortController>`.
- Prohibido `setTimeout`/`setInterval` sin guardar handle para limpieza en `dispose()`.

---

## 9. Logging

- `ILogger` inyectado por `ctx`. **Prohibido** `console.*` en el Core.
- Niveles: `debug | info | warn | error`.
- Nunca loguear contenido del documento. Solo metadatos (`documentId`, `pageIndex`, `engineId`, `durationMs`).

---

## 10. Tests — obligaciones

Cada PR generado por IA o humano debe incluir:

| Tipo | Cobertura mínima | Archivo |
|---|---|---|
| Contract | 100% de métodos de la interfaz pública | `contract.test.ts` |
| Unit | ≥ 85% de líneas del motor | `unit.test.ts` |
| Snapshot | `DocumentModel` de un PDF de fixture estable | `snapshot.test.ts` |
| Edge | Todos los casos límite del spec del motor | `edge.test.ts` |

Ubicación de fixtures (fuente de verdad: `tests/fixtures/README.md`):

- **Fixtures binarios compartidos** (PDFs de prueba): `tests/fixtures/` en la raíz del repo. Los ≥ 5 MB van a Git LFS o descarga con hash verificado.
- **Fixtures propios del motor** (estructuras en memoria, mocks deterministas): `<engine>-engine/src/__tests__/fixtures/`, versionados junto al código.

### Asserts de compile-time en tests

En tests (`*.test.ts`), `@ts-expect-error` con un comentario justificativo adyacente es válido para **asserts de compile-time** — por ejemplo, verificar que una propiedad `readonly` no se puede reasignar sin recurrir a un cast — y **no requiere un issue referenciado**, a diferencia de la regla general de la §2 ("Prohibido: ... `@ts-expect-error` sin justificación en comentario adyacente y issue referenciado"). El comentario adyacente basta como justificación en este caso porque el propio test documenta qué invariante de tipos está verificando. `as unknown as` **sigue prohibido también en tests**, con una única excepción: los **casts de frontera** contra tipos de librerías externas mockeadas (pdfjs-dist, tesseract.js, @xenova/transformers) se permiten **solo concentrados en helpers de `__tests__/fixtures/`** — un helper por librería, con comentario justificativo adyacente — nunca dispersos en los archivos de test (ver nota 2026-07-09 en `adr/ADR-019-Hito1-Hardening.md`; precedente: `mockGetDocumentResult` en `pdf-engine`). Para contratos de tipos **propios**, un test que necesita bypassear el sistema de tipos sigue estando probando con la herramienta equivocada.

---

## 11. Commits y PRs

- Commits en formato **Conventional Commits** sin scope: `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`, `refactor: ...`, `chore: ...`.
- Un PR = un módulo. Nunca tocar dos motores en el mismo PR (ver `ai/AI_Development_Guide.md`).
- Título del PR: `<tipo>: <motor> — <cambio>`. Ej: `feat: grouping-engine — soporte de alias manuales`.
- El PR debe pasar todos los gates ejecutables antes de merge. La tabla canónica de gates vive en `architecture/07_Performance_Strategy.md` §11.4 (única fuente de verdad; no se duplica acá).

---

## 12. Prohibiciones absolutas

| # | Regla |
|---|---|
| P-1 | El Core **nunca** importa de `apps/react-client` ni de `react`, `react-dom`, `react/jsx-runtime`. |
| P-2 | Un motor **nunca** importa directamente de otro motor. Comunicación solo por eventos y tipos de `@anonly/shared`. |
| P-3 | **Nunca** `any` ni `@ts-ignore` sin issue asociado. |
| P-4 | **Nunca** `console.*` en `packages/`. |
| P-5 | **Nunca** mutar props de entrada en funciones públicas del Core. |
| P-6 | **Nunca** escribir en el sistema de archivos ni en `localStorage` desde el Core. El Core es puro procesamiento. Aplica a documentos y datos del usuario: cachear assets publicos (modelos OCR/NER) en IndexedDB/Cache Storage via la propia libreria esta permitido (ADR-021 §6). |
| P-7 | **Nunca** hacer network requests desde el Core. |
| P-8 | **Nunca** export default. |
| P-9 | **Nunca** agregar dependencias externas a un motor sin ADR que lo justifique. |
| P-10 | **Nunca** publicar tipos que no estén documentados en `core/Contracts.md` o el spec del motor. |

**Enforcement automatizado**: P-1 y P-2 se validan por máquina con `no-restricted-imports` en `eslint.config.js` (raíz del repo). Los nombres reales de los paquetes son `@anonly/<engine>-engine` (bloqueados con el patrón `@anonly/*-engine` dentro de `packages/anonymization-core/`), no subpaths del façade. El único paquete del Core autorizado a importar motores es el façade `@anonly/anonymization-core` (`packages/anonymization-core/src/`), que es la composition root (`createCore`, Orchestrator). Al crear un motor nuevo no hay que tocar ESLint: el patrón lo cubre automáticamente.

P-4 se valida a máquina con la regla `no-console` en modo **estricto** (sin `allow`) para todo `packages/**/*.{ts,tsx}` — a diferencia del resto del repo, donde `no-console` permite `warn`/`error`. Los motores tampoco pueden importar `@anonly/event-system` directamente: usan el `IEventBus` inyectado por `ctx` (`EngineContext.bus`, de `@anonly/shared`); ese patrón está bloqueado en `eslint.config.js` con `no-restricted-imports` (excepto en los tests de cada paquete, donde importar el bus real para tests de integración sí está permitido). Ver `adr/ADR-019-Hito1-Hardening.md`.

---

## 13. Referencias

- `ai/Module_Specification_Template.md` — plantilla canónica de un motor.
- `ai/AI_Development_Guide.md` — reglas de trabajo para IA.
- `architecture/01_Technical_Architecture_Document.md` — arquitectura completa.
- `adr/ADR-001-Framework.md` — decisión de stack y monorepo.
