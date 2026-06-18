<!-- CONTEXT: scope=adr | dependencias=00_Project_Vision.md,01_Technical_Architecture_Document.md | audiencia=humanos+IA | fase=2 -->

# ADR-001 — Framework, Stack y Monorepo

- **Estado**: Accepted
- **Fecha**: 2026-06-17
- **Decidido por**: Planificación inicial

## Contexto

Anonly necesita un stack que permita:
- Procesamiento 100% local en el navegador (PDF.js, Tesseract, ONNX).
- Reutilizar el Core desde múltiples clientes (React web primero, Electron/RN después).
- TypeScript estricto y ESM nativo.
- Web Workers con transferencia zero-copy.
- Bundling de wasm y modelos IA perezoso.

## Decisión

Adoptar **monorepo con pnpm workspaces** y el siguiente stack:

| Capa | Tecnología |
|---|---|
| Monorepo | pnpm workspaces 9+ |
| Lenguaje | TypeScript 5.4+ estricto, ESM |
| Cliente web | React + Vite + Tailwind + Radix UI + Zustand |
| PDF | PDF.js (extracción), pdf-lib (export) |
| OCR | Tesseract.js |
| NER | Transformers.js + ONNX Runtime Web |
| Render | Canvas / OffscreenCanvas |
| Infra | Web Workers con pools por tipo, Event Bus tipado propio |
| Testing | Vitest + Playwright |
| Lint | ESLint + Prettier |

Estructura del monorepo:

```
apps/
  react-client/
packages/
  anonymization-core/
    shared/
    event-system/
    pdf-engine/
    ocr-engine/
    regex-engine/
    ner-engine/
    grouping-engine/
    render-engine/
    export-engine/
docs/
tests/
```

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **npm workspaces** | Más lento, menos eficiente en disco que pnpm. Sin symlink por-package en IG. |
| **Turborepo + pnpm** | Útil para caching de builds, pero el Core no se build-ea (es TS fuente consumido por Vite). Overhead sin beneficio claro hasta que el repo crezca mucho. |
| **Sin monorepo (single package)** | Dificulta reutilizar el Core desde otros clientes (Electron, RN), que es un objetivo explícito del producto. |
| **Yarn workspaces** | pnpm es más rápido y tiene mejor manejo de peers para wasm/ai libs. |
| **Next.js / Remix** | No aporta nada: Anonly es una SPA local sin SSR ni rutas server-side. |
| **Webpack** | Vite es más rápido en dev y mejor soporte para ESM/wasm. |
| **Redux Toolkit** | Más boilerplate del necesario. Zustand cubre el estado sin acción tipada verbosa. |
| **Jest** | Vitest es nativo ESM, más rápido y se integra con Vite sin config extra. |
| **Cypress** | Playwright es más rápido, mejor soporte multi-navegador y más estable en CI. |

## Consecuencias

**Positivas**:
- Core reutilizable desde otros clientes sin refactor.
- ESM nativo + Vite = dev server rápido.
- pnpm = disco bajo y installs rápidos.
- Tipado estricto end-to-end.

**Negativas**:
- Más archivos de config que un single package.
- pnpm requiere instalación (no viene con Node).
- Algunas libs de IA pueden tener issues con ESM puro; mitigable con `imports` field.

**Neutras**:
- Turborepo se puede agregar después sin romper nada (ADR-001 no lo prohíbe, solo no lo impone).

## Referencias

- `01_Technical_Architecture_Document.md` §3.6
- `ai/Code_Standards.md` §1, §3
- `02_System_Diagrams.md` §3
