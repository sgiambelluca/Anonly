# Anonly

> Plataforma de **anonimización documental 100% local**. Detecta, agrupa y reemplaza información sensible en archivos PDF y produce un PDF completamente nuevo donde la información original no es recuperable. Ningún byte del documento sale del navegador del usuario.

---

## Tabla de contenidos

- [Qué es](#qué-es)
- [Filosofía](#filosofía)
- [Características](#características)
- [Arquitectura](#arquitectura)
- [Stack](#stack)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Documentación](#documentación)
- [Roadmap](#roadmap)
- [Estado](#estado)
- [Contribuir](#contribuir)

---

## Qué es

Anonly es una herramienta web para anonimizar documentos PDF que contienen datos personales o sensibles (DNI, CUIT, nombres, direcciones, teléfonos, cuentas, etc.) antes de compartirlos, publicarlos, usarlos en demos, entrenar modelos o cumplir con requirements de compliance.

A diferencia de otras soluciones, Anonly:

- **No envía el documento a ningún servidor**. Todo el procesamiento ocurre en el navegador del usuario mediante Web Workers.
- **No redacta el PDF original**. El PDF exportado se reconstruye desde cero (Canvas + pdf-lib), garantizando que el texto sensible no quede embebido y recuperable.
- **Opera por grupos, no por ocurrencias individuales**. Todas las apariciones de un mismo dato se tratan como una sola entidad de reemplazo, garantizando coherencia.
- **Muestra original y anonimizado lado a lado** para validación antes de exportar.

## Filosofía

| Principio | Implicación |
|---|---|
| **Local-first** | El procesamiento ocurre en el dispositivo. Ningún byte sale del navegador. |
| **Core desacoplado del cliente** | React es solo un cliente. El `anonymization-core` no conoce React. |
| **Reconstrucción, no parche** | El PDF exportado se regenera desde cero. Nunca se redacta in-place. |
| **Agrupación obligatoria** | Toda operación de reemplazo se define a nivel de grupo, nunca de ocurrencia. |
| **Transparencia incremental** | El usuario ve resultados a medida que se procesan, no al final. |
| **Determinismo donde sea posible** | Regex y agrupación son deterministas; NER y síntesis con seed configurable. |
| **Documentación como contrato** | Cada motor está definido por un spec autocontenido. Un modelo económico puede implementarlo leyendo solo ese archivo + `core/Contracts.md`. |

## Características

### Detección

- **Regex determinístico** con patrones argentinos: DNI, CUIT/CUIL, teléfono, email, IBAN, tarjeta, fecha, matrícula, patente.
- **NER local** (Transformers.js + ONNX Runtime Web) para personas, organizaciones y direcciones.
- **OCR** (Tesseract.js) para PDFs escaneados sin texto extraíble.

### Agrupación

Todas las ocurrencias del mismo dato se agrupan automáticamente (exacto o fuzzy con Levenshtein). El usuario puede fusionar o dividir grupos manualmente. Cada grupo tiene un `indexInType` estable (`[DNI 01]`, `[DNI 02]`, `[PERSONA 01]`).

### Modos de reemplazo (por grupo)

| Modo | Ejemplo | Uso |
|---|---|---|
| `placeholder` | `[DNI 01]` | default, informativo para revisión |
| `mask` | `XX.XXX.XXX` | censura conservando formato |
| `synthetic` | `39.123.456` | valor plausible determinista por seed |
| `redact` | bloque negro | censura visual total |

### Interfaz

- **4 paneles**: Toolbar \| Entidades + Reglas \| PDF original + PDF anonimizado (lado a lado).
- Árbol de entidades agrupadas por tipo, con checkbox cascade, contador de ocurrencias y selector de modo inline.
- Sistema de reglas por grupo / tipo / global con prioridades.
- Resolución de conflictos entre detectores (overlap, disagree, low confidence, ambiguous canonical).
- Virtualización de páginas, preview incremental, cancelación en cualquier etapa (< 200 ms).

### Seguridad

- 100% local. Sin backend de procesamiento. Sin persistencia remota.
- CSP estricta. Sin `unsafe-eval`. SRI en todos los assets.
- El PDF exportado no contiene capas de texto, bookmarks, JavaScript, forms ni XMP del original.
- Metadata sensible (author, creator, XMP) descartada en el PDF Engine.
- Passwords de PDFs protegidos nunca se loguean ni persisten.

### Export

- PDF nuevo reconstruido desde cero con pdf-lib.
- Formato de imagen (PNG/JPEG), DPI (150/300) y calidad JPEG configurables.
- Metadata propia mínima (`producer: "Anonly"`). Nunca copia del original.
- Garantía testada de no-recuperabilidad (CI gate: buscar texto original en el export = 0 hits).

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│ apps/react-client   (UI: React + Tailwind + Radix + Zustand) │
└──────────────────────────┬──────────────────────────────────┘
                           │ eventos tipados + store
┌──────────────────────────┴──────────────────────────────────┐
│ packages/anonymization-core                                  │
│   ├─ shared              (tipos, contratos, error codes)     │
│   ├─ event-system        (Event Bus tipado)                  │
│   ├─ pdf-engine          (extracción)                        │
│   ├─ ocr-engine          (OCR fallback)                      │
│   ├─ regex-engine        (patrones determinísticos)          │
│   ├─ ner-engine          (NER local, Transformers + ONNX)    │
│   ├─ grouping-engine     (agrupación obligatoria)            │
│   ├─ render-engine       (highlight + preview)               │
│   └─ export-engine       (reconstrucción PDF nuevo)          │
└──────────────────────────┬──────────────────────────────────┘
                           │ postMessage + Transferable
┌──────────────────────────┴──────────────────────────────────┐
│ Web Workers (pool por tipo de engine)                        │
└─────────────────────────────────────────────────────────────┘
```

### Pipeline

```
PDF → PDF Engine → OCR (si falta texto) → Normalización → Regex → NER
    → Grouping → Conflictos → Vista previa → Edición → Render → Export
```

- Incremental: las entidades aparecen en vivo a medida que se detectan.
- Cancelable en cualquier etapa con SLA < 200 ms.
- Comunicación motor↔motor y motor↔UI únicamente por eventos tipados.

### Principios arquitecturales

- Toda la lógica vive en el Core. Los clientes nunca procesan documentos.
- Los motores nunca conocen React ni la UI.
- Los motores nunca se importan entre sí. Comunicación solo por eventos y tipos de `@anonly/shared`.
- Cada motor es reemplazable sin modificar el resto.
- Toda la información es inmutable (`readonly`, `ReadonlyArray`).
- Todo procesamiento pesado ocurre en Web Workers (pools por tipo).

## Stack

| Capa | Tecnología |
|---|---|
| Cliente | React, TypeScript, Vite, Tailwind CSS, Radix UI, Zustand |
| PDF | PDF.js (extracción), pdf-lib (export) |
| OCR | Tesseract.js |
| NER | Transformers.js + ONNX Runtime Web |
| Render | Canvas / OffscreenCanvas |
| Infra | Web Workers con pools por tipo, Event Bus tipado propio |
| Testing | Vitest, Playwright |
| Monorepo | pnpm workspaces |

## Estructura del repositorio

```
Anonly/
├── apps/
│   └── react-client/             # UI (React)
├── packages/
│   └── anonymization-core/       # Core reutilizable
│       ├── shared/               # tipos, contratos, error codes
│       ├── event-system/         # Event Bus tipado
│       ├── pdf-engine/
│       ├── ocr-engine/
│       ├── regex-engine/
│       ├── ner-engine/
│       ├── grouping-engine/
│       ├── render-engine/
│       └── export-engine/
├── docs/                         # documentación técnica (ver abajo)
└── tests/                        # tests globales: e2e, perf, stress, leak, cancel
```

## Documentación

Toda la documentación técnica vive en [`docs/`](./docs) y está optimizada para consumo humano y de IA. Cada archivo empieza con un bloque `<!-- CONTEXT -->` que declara su scope, dependencias y audiencia.

### Visión y arquitectura

| Documento | Contenido |
|---|---|
| [`docs/00_Project_Vision.md`](./docs/00_Project_Vision.md) | Visión de producto, casos de uso, alcance, métricas. |
| [`docs/architecture/01_Technical_Architecture_Document.md`](./docs/architecture/01_Technical_Architecture_Document.md) | TAD maestro: bloques 1–3 + índice ejecutivo de los 12 bloques. |
| [`docs/architecture/02_System_Diagrams.md`](./docs/architecture/02_System_Diagrams.md) | Diagramas Mermaid + ASCII (capas, pipeline, eventos, workers, datos, despliegue). |
| [`docs/architecture/03_Data_Model.md`](./docs/architecture/03_Data_Model.md) | Modelos: `Document`, `Page`, `Word`, `EntityGroup`, `Rule`, `Conflict`, etc. |
| [`docs/architecture/04_Event_System.md`](./docs/architecture/04_Event_System.md) | Tabla exhaustiva de eventos: emisor, receptores, payload, timing. |
| [`docs/architecture/05_Worker_Architecture.md`](./docs/architecture/05_Worker_Architecture.md) | Pools por tipo, mensajes, timeouts, cancelación, reintentos, colas. |
| [`docs/architecture/06_Pipeline.md`](./docs/architecture/06_Pipeline.md) | 11 etapas: entra, sale, eventos, errores, cancelación. |
| [`docs/architecture/07_Performance_Strategy.md`](./docs/architecture/07_Performance_Strategy.md) | Virtualización, lazy loading, cache, memoria, testing global. |
| [`docs/architecture/08_Security_Model.md`](./docs/architecture/08_Security_Model.md) | 100% local, CSP, no-recuperabilidad, metadata strip, supply chain. |

### Decisiones (ADRs)

| ADR | Decisión |
|---|---|
| [`ADR-001`](./docs/adr/ADR-001-Framework.md) | Framework, stack y monorepo (pnpm) |
| [`ADR-002`](./docs/adr/ADR-002-No-Backend.md) | No backend para procesamiento |
| [`ADR-003`](./docs/adr/ADR-003-Workers.md) | Procesamiento pesado en Workers (pools por tipo) |
| [`ADR-004`](./docs/adr/ADR-004-Rendering.md) | Renderizado por reconstrucción (no redacción in-place) |
| [`ADR-005`](./docs/adr/ADR-005-State-Management.md) | Estado UI con Zustand + Event Bus |
| [`ADR-006`](./docs/adr/ADR-006-NER-Local.md) | NER local con Transformers.js + ONNX Runtime Web |
| [`ADR-007`](./docs/adr/ADR-007-Event-Bus.md) | Event Bus tipado propio |
| [`ADR-008`](./docs/adr/ADR-008-Immutability.md) | Inmutabilidad de todo el estado del Core |
| [`ADR-009`](./docs/adr/ADR-009-Export-Strategy.md) | Estrategia de exportación |
| [`ADR-010`](./docs/adr/ADR-010-Testing-Strategy.md) | Estrategia de testing (Vitest + Playwright) |
| [`ADR-011`](./docs/adr/ADR-011-Grouping-First.md) | Operación a nivel de grupo, no ocurrencia |
| [`ADR-012`](./docs/adr/ADR-012-Replacement-Modes.md) | 4 modos de reemplazo (mask / synthetic / placeholder / redact) |
| [`ADR-013`](./docs/adr/ADR-013-PDF-Engine-Hito2-Inline.md) | PDF Engine Hito 2: ejecución inline + reconciliación de config |
| [`ADR-014`](./docs/adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md) | Fusión OCR→PDF mediada por el Orchestrator |
| [`ADR-015`](./docs/adr/ADR-015-UI-Channel-Canonical.md) | Canal `ui` canónico para eventos emitidos por la UI |
| [`ADR-016`](./docs/adr/ADR-016-Preview-Kind.md) | `kind` (original/anonimizado) en `PREVIEW_UPDATED` |
| [`ADR-017`](./docs/adr/ADR-017-Claude-Code-Workflow.md) | Flujo de desarrollo con Claude Code (CLAUDE.md + subagentes) |
| [`ADR-018`](./docs/adr/ADR-018-First-Party-Assets.md) | Modelos y wasm servidos first-party (mirror propio, CSP intacta) |
| [`ADR-019`](./docs/adr/ADR-019-Hito1-Hardening.md) | Hardening del Hito 1 (`shared` + `event-system`): canal tipado, logger requerido, `engineId: "core"`, `LogLevel` único, seed obligatorio, excepción a R-1 |
| [`ADR-020`](./docs/adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md) | Hardening del Hito 2 (PDF Engine): word-splitting con bbox prorrateado, normalización NFC, política única de eventos fatales, `fuseOcrPage` con guard, `releaseDocument`, `parsePage` puro, excepción a R-1/R-21 |
| [`ADR-021`](./docs/adr/ADR-021-Engines-Inline-Hasta-Hito9.md) | Motores restantes inline hasta Hito 9; OcrConfig con fuente unica de timeout/retries; campos modelLoading/modelDownloaded; spec OCR reconciliado con ADR-014; cache de assets publicos permitido (P-6) |

### Core (contratos y specs de motores)

| Documento | Motor |
|---|---|
| [`docs/core/Contracts.md`](./docs/core/Contracts.md) | Tipos base, interfaces, enums, error codes, glosario |
| [`docs/core/Orchestrator.md`](./docs/core/Orchestrator.md) | Componente host: secuenciación del pipeline, pools, façade `createCore` |
| [`docs/core/PDF_Engine.md`](./docs/core/PDF_Engine.md) | Extracción de texto y posiciones |
| [`docs/core/OCR_Engine.md`](./docs/core/OCR_Engine.md) | OCR para páginas sin texto |
| [`docs/core/Regex_Engine.md`](./docs/core/Regex_Engine.md) | Patrones determinísticos AR |
| [`docs/core/NER_Engine.md`](./docs/core/NER_Engine.md) | NER local para persona/org/dirección |
| [`docs/core/Grouping_Engine.md`](./docs/core/Grouping_Engine.md) | Agrupación, conflictos, reglas |
| [`docs/core/Render_Engine.md`](./docs/core/Render_Engine.md) | Render + preview lado a lado |
| [`docs/core/Export_Engine.md`](./docs/core/Export_Engine.md) | Reconstrucción del PDF final |

Cada spec de motor sigue la plantilla canónica de 15 secciones (Objetivo → Checklist de implementación), de modo que un modelo económico puede implementarlo leyendo solo ese archivo + `Contracts.md`.

### UI

| Documento | Contenido |
|---|---|
| [`docs/ui/React_Client.md`](./docs/ui/React_Client.md) | UI Contract (cómo el cliente consume el Core, independiente de framework) |
| [`docs/ui/UX_Guidelines.md`](./docs/ui/UX_Guidelines.md) | Patrones UX: 4 paneles, árbol de entidades, conflictos, export, accesibilidad |
| [`docs/ui/Components.md`](./docs/ui/Components.md) | Catálogo de componentes (Radix + Tailwind) y mapeo al Core |

### Guías para desarrollo con IA

| Documento | Contenido |
|---|---|
| [`docs/ai/Code_Standards.md`](./docs/ai/Code_Standards.md) | Reglas de TypeScript estricto, estructura de paquetes, prohibiciones |
| [`docs/ai/Module_Specification_Template.md`](./docs/ai/Module_Specification_Template.md) | Plantilla canónica de 15 secciones para specs de motor |
| [`docs/ai/AI_Development_Guide.md`](./docs/ai/AI_Development_Guide.md) | Reglas de trabajo para IA: un módulo por PR, no romper contratos, etc. |
| [`docs/ai/Prompting_Guide.md`](./docs/ai/Prompting_Guide.md) | Prompts base: implementar motor, escribir tests, revisar, refactor, ADR |

## Atribución de datos de terceros

El léxico de género usado para inferir `personGender` sobre entidades `Person` (`docs/adr/ADR-060-Reemplazo-Por-Genero.md`, `docs/adr/ADR-069-Lexico-De-Genero-Fuente-Unica-Y-Canal-Del-Usuario.md`) incorpora datos derivados de "Nombres" (Buenos Aires Data, CC-BY-2.5-AR). Atribución completa, licencia y procedencia (URL, fecha de descarga, hash del artefacto) en [`NOTICE`](./NOTICE) y en `packages/anonymization-core/grouping-engine/assets/gender-lexicon.provenance.json`.

## Roadmap

| Versión | Alcance |
|---|---|
| [`MVP 0.1.0`](./docs/roadmap/MVP.md) | PDF + Regex + OCR + NER + agrupación obligatoria + 4 modos + export reconstruido |
| [`v1.0`](./docs/roadmap/Version_1.0.md) | Patrones Regex custom, WebGPU NER, pausa/reanudación, undo/redo, PWA offline, multi-idioma, modo oscuro |
| [`v2.0`](./docs/roadmap/Version_2.0.md) | Word/Excel/PowerPoint/imagen, Electron, React Native, plugins, batch, agrupación semántica, texto preservado |
| [`Future`](./docs/roadmap/Future_Ideas.md) | NER Argentina, LLM local, embeddings, compliance GDPR/HIPAA, SDK Python, CLI, server batch |

## Estado

**En desarrollo (MVP)**. La documentación técnica está completa (43 documentos; ver índices arriba — al agregar un doc, actualizar también este README). La implementación sigue los hitos de [`docs/roadmap/MVP.md`](./docs/roadmap/MVP.md); estado actual: Hitos 1 y 2 cerrados.

## Contribuir

El proyecto se desarrolla bajo un modelo **planificador + implementador + revisor** con asistencia de IA. Las reglas obligatorias para cualquier contribución (humana o de IA) están en:

- [`docs/ai/AI_Development_Guide.md`](./docs/ai/AI_Development_Guide.md) — reglas de trabajo.
- [`docs/ai/Code_Standards.md`](./docs/ai/Code_Standards.md) — estándares de código.
- [`docs/ai/Prompting_Guide.md`](./docs/ai/Prompting_Guide.md) — prompts base reutilizables.

Con **Claude Code** (herramienta principal, ver [`ADR-017`](./docs/adr/ADR-017-Claude-Code-Workflow.md)): [`CLAUDE.md`](./CLAUDE.md) se carga automáticamente en toda sesión, y los roles implementador (Sonnet) / revisor (Opus) están definidos como subagentes en [`.claude/agents/`](./.claude/agents/).

Resumen de reglas clave:

- Un PR = un módulo. Nunca modificar más de un motor por PR.
- Nunca romper contratos públicos definidos en `docs/core/Contracts.md`.
- Nunca crear dependencias entre motores. Comunicación solo por eventos.
- Nunca acceder a React ni a librerías de UI desde `packages/`.
- Todo el código es TypeScript estricto. Sin `any`, sin `@ts-ignore` sin issue.
- Todo PR debe incluir tests (contract + unit + edge).
- Toda decisión técnica no trivial va en un ADR antes de implementarse.

Antes de abrir un PR, ejecutar:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract
```

Todos los gates deben pasar (ver [`docs/architecture/07_Performance_Strategy.md`](./docs/architecture/07_Performance_Strategy.md) §11.4 para la lista completa).
