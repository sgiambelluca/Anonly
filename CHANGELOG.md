# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo por paquete.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el versionado [Semantic Versioning](https://semver.org/lang/es/).

Los cambios se generan automáticamente vía [Changesets](./.changeset/README.md) a partir de los Conventional Commits del repo.

---

## Paquetes

| Paquete                      | Descripción                                   | Primera versión |
| ---------------------------- | --------------------------------------------- | --------------- |
| `@anonly/shared`             | Tipos, contratos, error codes del Core        | 0.1.0           |
| `@anonly/event-system`       | Event Bus tipado propio                       | 0.1.0           |
| `@anonly/pdf-engine`         | Extracción de PDF                             | 0.1.0           |
| `@anonly/ocr-engine`         | OCR con Tesseract.js                          | 0.1.0           |
| `@anonly/regex-engine`       | Patrones determinísticos AR                   | 0.1.0           |
| `@anonly/ner-engine`         | NER local con Transformers.js + ONNX          | 0.1.0           |
| `@anonly/grouping-engine`    | Agrupación, conflictos, reglas                | 0.1.0           |
| `@anonly/render-engine`      | Render + preview                              | 0.1.0           |
| `@anonly/export-engine`      | Reconstrucción PDF nuevo                      | 0.1.0           |
| `@anonly/anonymization-core` | API pública del Core (composición de engines) | 0.1.0           |
| `@anonly/react-client`       | App web (no publicable a npm)                 | –               |

---

## [Unreleased]

### Added

- Hito 1 — Fundación del monorepo: pnpm workspaces, tsconfig base, ESLint, Prettier, Vitest, Playwright.
- CI con GitHub Actions: gates de lint, typecheck, tests, audit.
- Commitlint con Conventional Commits.
- Changesets para versionado semver + CHANGELOG automático.
- Estructura de directorios `apps/` y `packages/anonymization-core/`.
- Hito 2 — `@anonly/pdf-engine` (PRs #6, #7): ejecución inline en host thread con `pdfjs-dist`. Implementa `IEngine` con `process`, `fuseOcrPage`, `dispose`; emite `PAGE_PARSED`, `DOCUMENT_PARSED`, `PDF_PASSWORD_REQUIRED`, `PDF_INVALID`; errores `PdfPasswordRequiredError`, `PdfInvalidError`, `PdfCorruptedError`, `PdfTimeoutError`; configuración `PdfEngineConfig.maxPageCount` integrada en `EngineConfig.pdf`. Tests: `contract.test.ts`, `unit.test.ts`, `edge.test.ts`, `snapshot.test.ts`. Pendiente: migración a `PdfPool` (Hito 9) y tests stress/cancel (Hito 11).

### Changed

- `@anonly/shared`: `EngineConfig` ahora incluye `readonly pdf: PdfEngineConfig` (requerido por ADR-013). Source of truth de `PdfEngineConfig` movida a `core/Contracts.md` §6.

### Notes

- Las versiones `0.x.y` son pre-release del MVP. Cambios `minor` pueden ser breaking sin bump `major` hasta `1.0.0` (convención SemVer pre-1.0).
- Las features del MVP se documentarán acá a medida que se implementen los hitos 2–12 de `docs/roadmap/MVP.md`.
