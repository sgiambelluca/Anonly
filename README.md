# Anonly

> Plataforma de **anonimización documental 100% local**. Detecta, agrupa y reemplaza información sensible en archivos PDF y produce un PDF completamente nuevo donde la información original no es recuperable. Ningún byte del documento sale de la máquina del usuario.

**Anonly se entrega como aplicación de escritorio** para macOS y Windows (ADR-130). Se baja el instalador una vez y desde ahí funciona sin conexión: el modelo de detección de nombres y los binarios de OCR viajan adentro del paquete, así que no se descarga nada en el primer uso.

### Lo único que la app le pide a internet

Buscar si hay una versión nueva. Esa consulta va a GitHub y **le revela tu IP y la versión que tenés instalada** — nada más: nunca el contenido, el nombre ni ningún metadato de un documento, y el chequeo se puede apagar desde Configuración.

Vale la pena decirlo con precisión: **el Core nunca habla con la red** —hay un gate de CI que lo verifica sobre el código— y el contenedor solo lo hace para consultar versiones y bajar actualizaciones. En macOS y Windows cada actualización se valida con una clave Ed25519 propia antes de instalarse. Esto no firma la primera instalación: Windows seguirá mostrando un editor no verificado hasta integrar Authenticode.

Los instaladores se construyen en CI con logs públicos, y cada release publica el sha256 de cada archivo más una atestación que ata el binario a un commit de este repositorio. Cualquiera puede verificar que lo que bajó salió de este código.

---

## Empezar

**Requisitos**: Node ≥ 22 y pnpm ≥ 9 (el repo fija `pnpm@9.12.0` en `packageManager`).

```bash
pnpm install
```

Los modelos de IA y los binarios wasm **no se commitean** (~110 MB, ADR-018): se bajan de sus orígenes pinneados y se verifican por hash contra `assets.lock.json`. Sin este paso la app arranca pero no detecta nombres ni lee escaneados:

```bash
pnpm assets:mirror
```

Levantar la app en desarrollo (http://localhost:5173):

```bash
pnpm dev
```

Antes de abrir un PR, el subset mínimo de gates:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract
```

<details>
<summary>Otros comandos útiles</summary>

| Comando | Qué hace |
|---|---|
| `pnpm build` | Compila los paquetes del Core. |
| `pnpm test:e2e` | Playwright sobre la **app de escritorio empaquetada**: construye el renderer y el shell y corre los escenarios dentro de Electron (ADR-130). |
| `pnpm test:integration` | Tests que cruzan varios motores. |
| `pnpm test:quality` | Recall y precisión sobre el dataset de referencia. Reporta, no falla por número bajo (ADR-095). |
| `pnpm test:security` | Gates de no-recuperabilidad y de origen de los assets. |
| `pnpm test:coverage` | Cobertura con los thresholds por paquete de `vitest.config.ts`. |
| `pnpm fixtures:generate` | Regenera los PDF de prueba y el dataset de referencia. |
| `pnpm format` | Prettier sobre todo el repo. |

La tabla canónica y completa de gates vive en [`docs/architecture/07_Performance_Strategy.md`](./docs/architecture/07_Performance_Strategy.md) §11.4.

</details>

<details>
<summary>Windows</summary>

El desarrollo pasa por **WSL Ubuntu**: los binarios de `node_modules` son Linux y no son ejecutables desde Windows nativo.

```bash
wsl -d Ubuntu -- bash -c "cd /mnt/c/<ruta-del-repo> && source ~/.nvm/nvm.sh && <comando>"
```

El `cd` va **dentro** del `bash -c`; el flag `--cd` de `wsl.exe` no es confiable en todos los entornos. Excepción: `git push` no depende de `pnpm` y corre directo desde Windows; solo `git commit` necesita WSL, por los hooks de `lint-staged`.

</details>

---

## Tabla de contenidos

- [Empezar](#empezar)
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

Anonly es una herramienta web para anonimizar documentos PDF que contienen datos personales o sensibles (DNI, CUIT, nombres, direcciones, teléfonos, cuentas, etc.) antes de compartirlos, publicarlos, usarlos en demos, entrenar modelos o cumplir con requisitos de compliance.

A diferencia de otras soluciones, Anonly:

- **No envía el documento a ningún servidor**. Todo el procesamiento ocurre en el navegador del usuario mediante Web Workers.
- **No redacta el PDF original**. El PDF exportado se reconstruye desde cero (Canvas + pdf-lib), garantizando que el texto sensible no quede embebido y recuperable.
- **Opera por grupos, no por ocurrencias individuales**. Todas las apariciones de un mismo dato se tratan como una sola entidad de reemplazo, garantizando coherencia.
- **Deja revisar antes de exportar**: el visor conmuta entre el documento original y el anonimizado, y el árbol de entidades muestra qué se detectó y con qué se va a reemplazar.

## Filosofía

| Principio | Implicación |
|---|---|
| **Local-first** | El procesamiento ocurre en el dispositivo. Ningún byte sale del navegador. |
| **Core desacoplado del cliente** | React es solo un cliente. El `anonymization-core` no conoce React. |
| **Reconstrucción, no parche** | El PDF exportado se regenera desde cero. Nunca se redacta in-place. |
| **Agrupación obligatoria** | Toda operación de reemplazo se define a nivel de grupo, nunca de ocurrencia. |
| **Transparencia incremental** | El usuario ve resultados a medida que se procesan, no al final. |
| **Un fallo se dice, no se disimula** | Si un detector no corrió, la herramienta lo avisa antes de exportar. Un documento que llega a "Listo" con datos sin detectar es el peor resultado posible. |
| **Determinismo donde sea posible** | Regex y agrupación son deterministas; NER y síntesis con seed configurable. |
| **Documentación como contrato** | Cada motor está definido por un spec autocontenido. Un modelo económico puede implementarlo leyendo solo ese archivo + `core/Contracts.md`. |

## Características

### Detección

- **Regex determinístico** con patrones argentinos: DNI, CUIT/CUIL, teléfono, email, IBAN, tarjeta, fecha, matrícula, patente, carátula judicial.
- **NER local** (Transformers.js + ONNX Runtime Web) para personas, organizaciones y direcciones. Siempre activo: no es una preferencia del usuario.
- **OCR** (Tesseract.js) para PDFs escaneados sin texto extraíble, con detección de orientación, lectura de sellos rotados en los márgenes y segmentación de texto disperso.
- **Lo dudoso se sugiere, no se descarta**: una detección por debajo del umbral entra al árbol apagada y marcada para revisar, en vez de desaparecer en silencio.

### Agrupación

Todas las ocurrencias del mismo dato se agrupan automáticamente (exacto, o difuso con Levenshtein para tipos de texto libre). El usuario puede fusionar varios grupos en una sola pasada o dividirlos. Cada grupo tiene un `indexInType` estable (`[DNI 01]`, `[DNI 02]`, `[PERSONA 01]`).

### Modos de reemplazo (por grupo)

| Modo | Ejemplo | Uso |
|---|---|---|
| `placeholder` | `[DNI 01]` | default, informativo para revisión |
| `mask` | `XX.XXX.XXX` | censura conservando formato |
| `synthetic` | `39.123.456` | valor plausible determinista por seed |
| `redact` | bloque negro | censura visual total |

El modo se decide a tres niveles —documento, categoría y grupo—, y el más específico gana.

### Interfaz

- **Tres momentos, no cuatro paneles** (ADR-087): cargar, escanear, revisar. Cada uno muestra solo lo que sirve en ese momento.
- Un visor que conmuta entre **original** y **anonimizado**, con zoom y búsqueda.
- Árbol de entidades agrupadas por tipo, con checkbox cascade, contador de ocurrencias y selector de modo inline.
- Resolución de conflictos entre detectores (overlap, disagree, low confidence, ambiguous canonical).
- Agregado manual de entidades que el detector no encontró, por diálogo, por selección sobre el documento o desde el buscador.
- Virtualización de páginas, preview incremental y cancelación en cualquier etapa.

### Seguridad

- 100% local. Sin backend de procesamiento. Sin persistencia remota.
- CSP estricta, sin `unsafe-eval`. Los modelos y binarios wasm se sirven **first-party** desde el propio origen, nunca desde un CDN de terceros en runtime (ADR-018), con URL, revisión y `sha256` pinneados en `assets.lock.json` y verificados al mirrorearlos.
- El PDF exportado no contiene capas de texto, bookmarks, JavaScript, forms ni XMP del original.
- Metadata sensible (author, creator, XMP) descartada en el PDF Engine.
- Passwords de PDFs protegidos nunca se loguean ni persisten.

### Export

- PDF nuevo reconstruido desde cero con pdf-lib.
- Formato de imagen (PNG/JPEG), DPI (150/300) y calidad JPEG configurables.
- Metadata propia mínima (`producer: "Anonly"`). Nunca copia del original.
- No-recuperabilidad verificada por test: buscar el texto original en el export da cero resultados.

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
- Cancelable en cualquier etapa.
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
├── scripts/                      # mirror de assets, build del léxico
└── tests/                        # e2e, integration, invariants, quality,
                                  # measure, security, fixtures
```

Cada motor tiene sus tests unitarios dentro de su propio paquete (`src/__tests__/`); en `tests/` viven los que cruzan varios motores o la app entera.

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
| [`docs/architecture/07_Performance_Strategy.md`](./docs/architecture/07_Performance_Strategy.md) | Virtualización, lazy loading, cache, memoria, y la tabla canónica de gates (§11.4). |
| [`docs/architecture/08_Security_Model.md`](./docs/architecture/08_Security_Model.md) | 100% local, CSP, no-recuperabilidad, metadata strip, supply chain. |

### Decisiones (ADRs)

Todas viven en [`docs/adr/`](./docs/adr), una por archivo, con el formato `ADR-NNN-Titulo-En-Kebab.md` y numeración correlativa por orden de decisión.

**No hay índice acá a propósito**: son más de cien y una lista en el README se desactualiza al segundo ADR nuevo. Cómo encontrar la que buscás:

- **Por tema**: cada spec de motor y cada documento de arquitectura declara en su bloque `<!-- CONTEXT -->` los ADR que lo gobiernan, y cita el que corresponde en cada sección.
- **Por texto**: `grep -ril "<tema>" docs/adr/`. Los títulos son frases completas en castellano, no siglas.
- **Por estado**: cada ADR abre con `Estado`, `Fecha`, `Decidido por` y `Relacionado con`. Una decisión revertida o precisada lo dice en el ADR original, con el número del que la supersede.

Un ADR se escribe **antes** del código cuando la decisión toca un contrato público, agrega una dependencia o cambia una regla de trabajo.

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
| [`docs/core/Render_Engine.md`](./docs/core/Render_Engine.md) | Render + preview |
| [`docs/core/Export_Engine.md`](./docs/core/Export_Engine.md) | Reconstrucción del PDF final |

Cada spec de motor sigue la plantilla canónica de 15 secciones (Objetivo → Checklist de implementación), de modo que un modelo económico puede implementarlo leyendo solo ese archivo + `Contracts.md`.

### UI

| Documento | Contenido |
|---|---|
| [`docs/ui/React_Client.md`](./docs/ui/React_Client.md) | UI Contract (cómo el cliente consume el Core, independiente de framework) |
| [`docs/ui/UX_Guidelines.md`](./docs/ui/UX_Guidelines.md) | Patrones UX: los tres momentos, árbol de entidades, conflictos, export, accesibilidad |
| [`docs/ui/Components.md`](./docs/ui/Components.md) | Catálogo de componentes (Radix + Tailwind) y mapeo al Core |

### Guías para desarrollo con IA

| Documento | Contenido |
|---|---|
| [`docs/ai/Code_Standards.md`](./docs/ai/Code_Standards.md) | Reglas de TypeScript estricto, estructura de paquetes, prohibiciones |
| [`docs/ai/Module_Specification_Template.md`](./docs/ai/Module_Specification_Template.md) | Plantilla canónica de 15 secciones para specs de motor |
| [`docs/ai/AI_Development_Guide.md`](./docs/ai/AI_Development_Guide.md) | Reglas de trabajo R-1..R-22: un commit = un módulo, no romper contratos, etc. |
| [`docs/ai/Prompting_Guide.md`](./docs/ai/Prompting_Guide.md) | Prompts base: implementar motor, escribir tests, revisar, refactor, ADR |

## Atribución de datos de terceros

El léxico de género usado para inferir `personGender` sobre entidades `Person` incorpora datos derivados de "Nombres" (Buenos Aires Data, CC-BY-2.5-AR). Atribución completa, licencia y procedencia (URL, fecha de descarga, hash del artefacto) en [`NOTICE`](./NOTICE) y en `packages/anonymization-core/shared/assets/gender-lexicon.provenance.json`.

## Roadmap

Vive en [`docs/roadmap/`](./docs/roadmap). El punto de entrada es [`MVP.md`](./docs/roadmap/MVP.md): su §4 lleva el estado real de los hitos, hito por hito, y es la fuente de verdad sobre qué está cerrado y qué sigue.

Ahí mismo están los alcances de las versiones posteriores (`Version_1.0.md`, `Version_2.0.md`, `Future_Ideas.md`) y los documentos de trabajo vivos: informes de campo, inventarios de deuda y listas de pendientes abiertos con su motivo.

## Estado

**En desarrollo (MVP)**, en el Hito 11 (hardening). Los siete motores del Core, el Orchestrator y el cliente React están implementados y con tests; los hitos anteriores están cerrados, cada uno con lo que dejó abierto **a propósito** anotado en su propia sección.

El estado real, hito por hito, está en [`docs/roadmap/MVP.md`](./docs/roadmap/MVP.md) §4 — y esa es la fuente de verdad, no este README, que se desactualiza más rápido.

## Contribuir

El proyecto se desarrolla bajo un modelo **planificador + implementador + revisor** con asistencia de IA. Las reglas obligatorias para cualquier contribución (humana o de IA) están en:

- [`docs/ai/AI_Development_Guide.md`](./docs/ai/AI_Development_Guide.md) — reglas de trabajo.
- [`docs/ai/Code_Standards.md`](./docs/ai/Code_Standards.md) — estándares de código.
- [`docs/ai/Prompting_Guide.md`](./docs/ai/Prompting_Guide.md) — prompts base reutilizables.

Con **Claude Code** (herramienta principal): [`CLAUDE.md`](./CLAUDE.md) se carga automáticamente en toda sesión, y los roles implementador (Sonnet) / revisor (Opus) están definidos como subagentes en [`.claude/agents/`](./.claude/agents/).

Resumen de reglas clave:

- **Un commit = un módulo**, no un PR (ADR-124). Nunca modificar más de un motor en el mismo commit. Un PR **sí** puede tocar varios: hay cambios en un motor que no se pueden evaluar hasta verlos funcionando en otro, y partirlos en PRs separados obliga a revisar a ciegas. El gate de alcance se audita recorriendo commits (`git show --stat`), no el diff acumulado del PR.
- La excepción es el commit que **cambia un contrato**: toca por definición a sus consumidores, y se acepta si existe el ADR que lo autoriza y no lleva nada más.
- La **higiene de datos** —sacar nombres, números de expediente o cualquier dato de un documento real— va en su propio commit, nunca escondida dentro de uno funcional.
- Nunca romper contratos públicos definidos en `docs/core/Contracts.md`.
- Nunca crear dependencias entre motores. Comunicación solo por eventos.
- Nunca acceder a React ni a librerías de UI desde `packages/`.
- Todo el código es TypeScript estricto. Sin `any`, sin `@ts-ignore` sin issue.
- Todo PR incluye tests (contract + unit + edge, y snapshot si aplica).
- Toda decisión técnica no trivial va en un ADR antes de implementarse.

Antes de abrir un PR, ejecutar:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract
```

Todos los gates deben pasar (ver [`docs/architecture/07_Performance_Strategy.md`](./docs/architecture/07_Performance_Strategy.md) §11.4 para la lista completa).
