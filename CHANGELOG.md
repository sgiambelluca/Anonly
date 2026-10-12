# Changelog

Anonly se versiona como **un solo producto**: todos los paquetes `@anonly/*` se mueven juntos (`fixed` en `.changeset/config.json`), y la versión que manda es la de `apps/desktop-shell/package.json`. Cómo se publica: [`RELEASING.md`](./RELEASING.md).

El versionado sigue [Semantic Versioning](https://semver.org/lang/es/).

Este archivo es un índice. Los cambios de cada versión no se escriben a mano acá: los genera [Changesets](./.changeset/README.md) en el `CHANGELOG.md` de cada paquete al correr `pnpm version`.

## Dónde leer qué cambió

- **Para un usuario**: el menú «Novedades» de la pantalla de inicio, que trae un resumen de cada versión dentro de la aplicación (ADR-216), y las notas completas en [GitHub Releases](https://github.com/sgiambelluca/Anonly/releases).
- **Por paquete**:

| Paquete                      | Qué es                                            | Changelog                                                                                                |
| ---------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `@anonly/desktop-shell`      | Contenedor de escritorio (Electron) y actualizador | [`apps/desktop-shell/CHANGELOG.md`](./apps/desktop-shell/CHANGELOG.md)                                   |
| `@anonly/react-client`       | La interfaz que carga el contenedor               | [`apps/react-client/CHANGELOG.md`](./apps/react-client/CHANGELOG.md)                                     |
| `@anonly/anonymization-core` | Façade y Orchestrator del Core                    | [`packages/anonymization-core/CHANGELOG.md`](./packages/anonymization-core/CHANGELOG.md)                 |
| `@anonly/shared`             | Tipos, contratos y error codes                    | [`shared/CHANGELOG.md`](./packages/anonymization-core/shared/CHANGELOG.md)                               |
| `@anonly/event-system`       | Event Bus tipado                                  | [`event-system/CHANGELOG.md`](./packages/anonymization-core/event-system/CHANGELOG.md)                   |
| `@anonly/pdf-engine`         | Extracción de PDF                                 | [`pdf-engine/CHANGELOG.md`](./packages/anonymization-core/pdf-engine/CHANGELOG.md)                       |
| `@anonly/ocr-engine`         | OCR con Tesseract.js                              | [`ocr-engine/CHANGELOG.md`](./packages/anonymization-core/ocr-engine/CHANGELOG.md)                       |
| `@anonly/regex-engine`       | Patrones determinísticos                          | [`regex-engine/CHANGELOG.md`](./packages/anonymization-core/regex-engine/CHANGELOG.md)                   |
| `@anonly/ner-engine`         | NER local con Transformers.js + ONNX              | [`ner-engine/CHANGELOG.md`](./packages/anonymization-core/ner-engine/CHANGELOG.md)                       |
| `@anonly/grouping-engine`    | Agrupación, conflictos y reglas                   | [`grouping-engine/CHANGELOG.md`](./packages/anonymization-core/grouping-engine/CHANGELOG.md)             |
| `@anonly/render-engine`      | Render y vista previa                             | [`render-engine/CHANGELOG.md`](./packages/anonymization-core/render-engine/CHANGELOG.md)                 |
| `@anonly/export-engine`      | Reconstrucción del PDF nuevo                      | [`export-engine/CHANGELOG.md`](./packages/anonymization-core/export-engine/CHANGELOG.md)                 |

## Versiones publicadas

| Versión | Fecha      | Notas                                                                |
| ------- | ---------- | -------------------------------------------------------------------- |
| 0.9.2   | 2026-09-05 | Pre-release. Instalador universal de macOS y un único appcast.       |
| 0.9.1   | 2026-09-05 | El release no llegó a publicarse: el workflow falló en el empaquetado. |

Ningún paquete se publica a npm.
