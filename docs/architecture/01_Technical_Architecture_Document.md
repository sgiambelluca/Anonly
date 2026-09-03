<!-- CONTEXT: scope=arquitectura | dependencias=00_Project_Vision.md | audiencia=humanos+IA | fase=1 -->

# Anonly — Technical Architecture Document (TAD)

> Documento maestro de arquitectura. Contiene los **bloques 1–3** del TAD (Visión, Principios, Arquitectura general) y un **índice ejecutivo de los 12 bloques** que mapea cada bloque a su apéndice o documento externo. Los bloques 4–12 viven en apéndices (`architecture/02` a `architecture/08`) o en `core/`, `ui/`, `roadmap/`.

**Versión**: 1.0
**Última actualización**: 2026-06-17

---

## Índice ejecutivo de los 12 bloques

| # | Bloque | Dónde | Documento |
|---|---|---|---|
| 1 | Visión del proyecto | aquí | `01_Technical_Architecture_Document.md` §1 |
| 2 | Principios de arquitectura | aquí | `01_Technical_Architecture_Document.md` §2 |
| 3 | Arquitectura general | aquí | `01_Technical_Architecture_Document.md` §3 + `02_System_Diagrams.md` |
| 4 | Arquitectura del core (motores) | apéndice externo | `core/*.md` (un spec por motor) + `core/Contracts.md` |
| 5 | Modelo de datos | apéndice | `03_Data_Model.md` |
| 6 | Pipeline | apéndice | `06_Pipeline.md` |
| 7 | Sistema de eventos | apéndice | `04_Event_System.md` |
| 8 | Workers | apéndice | `05_Worker_Architecture.md` |
| 9 | UI Contract | apéndice externo | `ui/React_Client.md` |
| 10 | Performance | apéndice | `07_Performance_Strategy.md` |
| 11 | Testing | distribuido | secciones "Casos de prueba" de cada `core/*.md` + estrategia global en `07_Performance_Strategy.md` §11 |
| 12 | Roadmap | apéndice externo | `roadmap/*.md` |

---

# Bloque 1 — Visión del proyecto

> Resumen ejecutivo. El detalle completo vive en `00_Project_Vision.md`.

### Objetivo

Anonly es una plataforma de anonimización documental **100% local** que detecta, agrupa y reemplaza información sensible en archivos PDF, produciendo un PDF nuevo donde la información original no es recuperable. La unidad de operación es el **grupo de ocurrencias**, nunca la ocurrencia individual.

### Filosofía

- Local-first: nada sale del dispositivo.
- Core desacoplado del cliente: React es solo un cliente.
- Reconstrucción, no parche: se regenera el PDF, no se redacta in-place.
- Agrupación obligatoria: toda operación de reemplazo es a nivel de grupo.
- Transparencia incremental: el usuario ve resultados a medida que se procesan.

### Problema que resuelve

Compartir documentos con datos personales sin exponerlos, sin enviarlos a un servidor y sin perder estructura ni legibilidad. Las soluciones existentes fallan en al menos uno de: privacidad, recuperabilidad, agrupación, vista previa o instalación.

### Casos de uso

Legal, salud, RRHH, datos/ML, compliance, periodismo, educación, soporte. Ver `00_Project_Vision.md` §4.

### Público objetivo

Profesionales que manejan documentos confidenciales; equipos de datos que necesitan datasets anonimizados preservando formato; usuarios que valoran privacidad por defecto.

### Alcance (MVP + v1.0)

PDF (texto + escaneado con OCR), detección por Regex y NER local, agrupación obligatoria, 4 modos de reemplazo, vista previa del documento anonimizado, export a PDF nuevo, procesamiento 100% local en Workers, cancelación en cualquier etapa.

> **Precisión (ADR-087 §2)**: esta línea decía "vista previa **lado a lado**". El lado a lado se retiró: hay **un solo visor** que alterna entre `Original` y `Anonimizado`. El documento necesita todo el ancho para leerse, y el trabajo real es revisar qué se detectó, no comparar píxeles de la misma línea.

### Fuera de alcance (MVP + v1.0)

Otros formatos (Word/imagen), backend, persistencia remota, cuentas de usuario, NER entrenado para Argentina, colaboración multi-usuario en tiempo real.

---

# Bloque 2 — Principios de arquitectura

Reglas inviolables. Cualquier excepción requiere ADR.

| # | Principio | Implicación |
|---|---|---|
| A-1 | Toda la lógica vive en el Core. | `apps/react-client` no contiene lógica de anonimización. |
| A-2 | Los clientes nunca procesan documentos. | El host solo orquesta Workers y renderiza UI. |
| A-3 | Los motores nunca conocen React. | Sin imports de `react`, `react-dom`, JSX. |
| A-4 | Los motores nunca conocen la UI. | Sin tipos, eventos ni conceptos de presentación. |
| A-5 | Todo se comunica mediante eventos. | Sin llamadas directas entre motores. |
| A-6 | No existen dependencias circulares. | Grafo de dependencias acíclico, validado por lint. |
| A-7 | Cada motor puede reemplazarse sin modificar el resto. | Contratos estables, inyección por `EngineId`. |
| A-8 | Toda la información es inmutable. | `readonly`, `ReadonlyArray`, copia estructural. |
| A-9 | Todo procesamiento pesado ocurre en Workers. | PDF/OCR/NER/Render nunca en main thread. |
| A-10 | La agrupación es obligatoria antes de exponer entidades a la UI. | La UI nunca ve ocurrencias crudas, solo grupos. |
| A-11 | El PDF exportado se reconstruye desde cero. | No se redacta in-place; se regenera vía Canvas + pdf-lib. |
| A-12 | El procesamiento es incremental y cancelable. | Eventos por página/etapa, `AbortSignal` propagado a Workers. |
| A-13 | Sin backend de procesamiento. | El Core no hace network. |
| A-14 | Sin persistencia de documentos. | El Core no escribe FS ni `localStorage`. |
| A-15 | Determinismo donde sea posible. | Regex y agrupación deterministas; NER/síntesis con seed configurable. |

---

# Bloque 3 — Arquitectura general

### 3.1 Capas

```
┌─────────────────────────────────────────────────────────────┐
│ apps/react-client   (UI: React + Tailwind + Radix + Zustand) │
└──────────────────────────┬──────────────────────────────────┘
                           │ eventos + store
┌──────────────────────────┴──────────────────────────────────┐
│ packages/anonymization-core                                  │
│   ├─ event-system        (Event Bus tipado)                  │
│   ├─ shared              (tipos, contratos, error codes)     │
│   ├─ pdf-engine          (extracción)                        │
│   ├─ ocr-engine          (OCR fallback)                      │
│   ├─ regex-engine        (patrones determinísticos)          │
│   ├─ ner-engine          (NER local, Transformers.js + ONNX) │
│   ├─ grouping-engine     (agrupación obligatoria)            │
│   ├─ render-engine       (highlight + preview)               │
│   └─ export-engine       (reconstrucción PDF nuevo)          │
└──────────────────────────┬──────────────────────────────────┘
                           │ postMessage (Transferable ArrayBuffer)
┌──────────────────────────┴──────────────────────────────────┐
│ Web Workers (pool por tipo de engine)                        │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Flujo de un documento

```
PDF (ArrayBuffer)
        │
        ▼
   PDF Engine ──► DocumentModel (con páginas sin texto marcadas)
        │
        ▼
   OCR Engine ──► completa texto en páginas sin texto
        │
        ▼
   Regex Engine ──► ocurrencias determinísticas (DNI, CUIT, ...)
        │
        ▼
   NER Engine ──► ocurrencias de persona/organización/dirección
        │
        ▼
   Grouping Engine ──► EntityGroup[] (agrupación obligatoria)
        │
        ▼
   UI: vista previa (Original ⇄ Anonimizado) + edición de grupos
        │
        ▼
   Render Engine ──► páginas renderizadas con reemplazos aplicados
        │
        ▼
   Export Engine ──► PDF nuevo (Canvas + pdf-lib)
```

### 3.3 Pipeline resumido

Documento recibido → Extracción → OCR → Normalización → Regex → NER → Agrupación → Conflictos → Vista previa → Edición → Render → Exportación.

Detalle por etapa (entra/sale/errores/cancelación) en `06_Pipeline.md`.

### 3.4 Modelo de comunicación

- **Host ↔ Core**: eventos tipados vía `IEventBus` y suscripciones.
- **Core ↔ Workers**: `postMessage` con payloads serializables y `Transferable` para `ArrayBuffer`. Cancelación vía `signalId` referenciando un `AbortController` del host.
- **Motor ↔ Motor**: prohibido. Solo a través del pipeline orquestador y el bus de eventos.

### 3.5 Modelo de datos central

El dato más importante del sistema es el **`EntityGroup`**: un grupo de ocurrencias del mismo valor sensible, con un valor canónico, un índice secuencial por tipo, un modo de reemplazo y un valor de reemplazo. Toda interacción del usuario con entidades es a nivel de grupo.

Modelo completo en `03_Data_Model.md`.

### 3.6 Stack (resumido)

| Capa | Stack |
|---|---|
| Cliente | React + TypeScript + Vite + Tailwind + Radix UI + Zustand |
| Core | TypeScript estricto, ESM |
| PDF | PDF.js, pdf-lib |
| OCR | Tesseract.js |
| NER | Transformers.js + ONNX Runtime Web |
| Render | Canvas |
| Infra | Web Workers, Event Bus propio tipado |
| Testing | Vitest, Playwright |
| Monorepo | pnpm workspaces |

Decisiones detalladas en `adr/ADR-001-Framework.md` y siguientes.

---

## Referencias cruzadas

- `00_Project_Vision.md` — el "qué" y "por qué".
- `architecture/02_System_Diagrams.md` — diagramas amplios.
- `architecture/03_Data_Model.md` — bloque 5.
- `architecture/04_Event_System.md` — bloque 7.
- `architecture/05_Worker_Architecture.md` — bloque 8.
- `architecture/06_Pipeline.md` — bloque 6.
- `architecture/07_Performance_Strategy.md` — bloque 10 + testing global.
- `architecture/08_Security_Model.md` — modelo de seguridad.
- `core/Contracts.md` — tipos base.
- `core/<Engine>_Engine.md` — bloque 4 (un doc por motor).
- `ui/React_Client.md` — bloque 9.
- `roadmap/*.md` — bloque 12.
