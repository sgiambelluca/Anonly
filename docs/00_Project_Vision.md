<!-- CONTEXT: scope=producto | dependencias=ninguna | audiencia=humanos+IA | fase=0 -->

# Anonly — Visión del Proyecto

> Documento raíz del producto. Todo otro documento referencia a este para entender el "qué" y el "por qué". El "cómo" vive en `architecture/01_Technical_Architecture_Document.md`.

---

## 1. Objetivo

Construir **Anonly**, una plataforma de **anonimización documental** que opera **100% en el cliente del usuario**, sin enviar jamás el contenido de los documentos a ningún servidor. El producto detecta, agrupa y reemplaza información personal y sensible dentro de un PDF, y produce un **PDF completamente nuevo** donde la información original no puede ser recuperada ni por inspección del archivo resultante.

La unidad mínima de operación es el **grupo de ocurrencias**: todas las apariciones de un mismo dato sensible se tratan como una sola entidad de reemplazo. No se anonimiza ocurrencia por ocurrencia.

---

## 2. Filosofía

| Principio | Implicación |
|---|---|
| **Local-first** | El procesamiento ocurre en el dispositivo del usuario. Ningún byte del documento sale del navegador. |
| **Core desacoplado del cliente** | React es solo un cliente. El `anonymization-core` no conoce React ni ningún framework de UI. |
| **Reconstrucción, no parche** | El PDF exportado se regenera desde cero (Canvas + pdf-lib). Nunca se redacta in-place sobre el original. |
| **Agrupación obligatoria** | Toda operación de reemplazo se define a nivel de grupo, nunca de ocurrencia individual. |
| **Transparencia incremental** | El usuario ve resultados a medida que se procesan, no al final. |
| **Determinismo donde sea posible** | Regex y agrupación son deterministas. NER y síntesis de valores usan seed configurable para reproducibilidad. |
| **Documentación como contrato** | Cada motor está definido por un spec autocontenido. Un modelo económico puede implementarlo leyendo solo ese archivo + `core/Contracts.md`. |

---

## 3. Problema que resuelve

Compartir documentos que contienen datos personales (DNI, CUIT, nombres, direcciones, teléfonos, cuentas) —ya sea para análisis, demostraciones, capacitación de modelos, publicaciones, auditorías o compliance— requiere eliminar esa información **sin perder la estructura y legibilidad del documento**.

Las soluciones existentes presentan una o más de estas limitaciones:

- **Servicios online**: suben el documento a un servidor. Inaceptable para documentos confidenciales, legales o médicos.
- **Redacción visual manual**: tapan con cajas negras pero el texto sigue embebido en el PDF y puede recuperarse.
- **Herramientas de escritorio pesadas**: costo, instalación, mantenimiento, sin trazabilidad.
- **Sin agrupación**: anonimizan cada aparición por separado, generando inconsistencias (un mismo DNI aparece como tres valores distintos).
- **Sin vista previa lado a lado**: el usuario no puede comparar el original y el resultado antes de exportar.

Anonly resuelve todo esto en una sola herramienta web, local y con agrupación por defecto.

---

## 4. Casos de uso

| # | Actor | Escenario |
|---|---|---|
| UC-1 | Abogado / escribano | Anonimizar escrituras y expedientes antes de compartirlos con peritos o colegas. |
| UC-2 | Hospital / clínica | Remover PHI de historias clínicas para estudios o capacitación de personal. |
| UC-3 | RRHH | Limpiar CVs y contratos antes de un proceso de selección interno. |
| UC-4 | Equipos de datos / ML | Generar datasets de documentos sintéticos para entrenar modelos, preservando formato. |
| UC-5 | Auditor / compliance | Sanitizar reportes antes de circulación externa o publicación. |
| UC-6 | Periodismo | Proteger fuentes y datos sensibles en documentos antes de publicación. |
| UC-7 | Educación | Preparar material docente sin exponer datos reales de alumnos o pacientes. |
| UC-8 | Soporte / CX | Limpiar tickets y capturas antes de subir a bases de conocimiento o foros. |

---

## 5. Público objetivo

- **Primario**: profesionales que manejan documentos confidenciales (legal, salud, RRHH, compliance, periodismo).
- **Secundario**: equipos de datos e investigación que necesitan datasets anonimizados preservando estructura.
- **Terciario**: usuarios técnicos que valoran la privacidad por defecto y quieren una herramienta sin registro ni envío de datos.

No es público objetivo: anonimización en volumen masivo (millones de documentos en batch server-side) — eso corresponde a una futura versión server del Core (ver `roadmap/Future_Ideas.md`).

---

## 6. Alcance (MVP y v1.0)

### 6.1 En alcance

- Procesamiento de archivos **PDF** (texto y escaneados con OCR).
- Detección por:
  - **Regex determinístico** (DNI, CUIT/CUIL, teléfono, email, IBAN, tarjeta, fecha, matrícula, patente).
  - **NER local** (persona, organización, dirección) vía Transformers.js + ONNX Runtime Web.
- **Agrupación obligatoria** de ocurrencias por valor canónico y tipo.
- 4 modos de reemplazo por grupo: `mask` (censura con formato), `synthetic` (valor sintético válido), `placeholder` (`[DNI 01]`), `redact` (bloque negro).
- Vista previa lado a lado: **original vs. anonimizado**.
- Panel de entidades agrupadas por tipo, con checkbox y contador de ocurrencias.
- Panel de reglas a nivel grupo / tipo / global.
- Exportación a **PDF nuevo** reconstruido (no redacción in-place).
- Procesamiento 100% local en el navegador mediante Web Workers.
- Soporte de cancelación en cualquier etapa del pipeline.

### 6.2 Fuera de alcance (MVP y v1.0)

- Formatos distintos a PDF (Word, imágenes, Excel) — previstos para v2.0.
- Backend de procesamiento. No existe. Los datos no salen del dispositivo.
- Persistencia de documentos en servidor. No se almacena nada remotamente.
- Cuentas de usuario, autenticación ni multi-tenant en el MVP.
- NER entrenado específicamente para Argentina / jerga legal — previsto en `roadmap/Future_Ideas.md`.
- Colaboración en tiempo real entre varios usuarios sobre el mismo documento.
- Redacción de metadatos embebidos en imágenes dentro del PDF (XMP, EXIF) más allá del strip de metadatos del PDF.

---

## 7. Métricas de éxito

| Métrica | Objetivo MVP | Objetivo v1.0 |
|---|---|---|
| Tasa de detección (recall) sobre dataset de referencia | ≥ 90% en Regex | ≥ 85% en NER |
| Precisión de detección | ≥ 98% en Regex | ≥ 90% en NER |
| Falsos negativos post-anonimización en export | 0 en campos Regex | < 1% en NER |
| Recuperabilidad de información original en el PDF exportado | 0% | 0% |
| Tiempo de procesamiento de un PDF de 10 páginas con texto | < 8 s | < 5 s |
| Tiempo de procesamiento de un PDF de 10 páginas escaneadas (OCR) | < 60 s | < 40 s |
| Pico de memoria para 50 páginas | < 512 MB | < 320 MB |
| Tamaño del bundle inicial (sin modelos IA) | < 800 KB gz | < 600 KB gz |
| Cancelación efectiva | < 200 ms desde input hasta cese de CPU | idem |

Las métricas son contractuales y se validan en `architecture/07_Performance_Strategy.md` y en la estrategia de testing de cada motor.

---

## 8. Layout de producto

```
┌──────────────────────────────────────────────────────────┐
│  Toolbar (acciones globales, estado del pipeline, export) │
├──────────────────┬───────────────────────────────────────┤
│  Entidades       │            PDF original               │
│  ▶ Personas (3)  │   (con highlight de grupos activos)   │
│    ☑ Juan (14)   │                                       │
│    ☑ María (6)   │                                       │
│  ▶ DNI (3)       │                                       │
│    ☑ 34.567.891  ├───────────────────────────────────────┤
│  ▶ Direcciones   │          PDF anonimizado              │
│    ☑ Belgrano    │   (vista previa lado a lado)          │
├──────────────────┤                                       │
│  Reglas          │                                       │
│  (por grupo /    │                                       │
│   tipo / global) │                                       │
└──────────────────┴───────────────────────────────────────┘
```

El panel de Entidades lista **grupos**, nunca ocurrencias individuales. Cada grupo muestra su valor canónico, el contador de ocurrencias, un checkbox de habilitación y un selector de modo de reemplazo. El detalle de `UX_Guidelines.md` y `ui/Components.md` define el resto.

---

## 9. Referencias

| Documento | Qué contiene |
|---|---|
| `architecture/01_Technical_Architecture_Document.md` | El "cómo" técnico. Bloques 1–3 + índice de los 12. |
| `architecture/03_Data_Model.md` | `EntityGroup` y los demás modelos. |
| `adr/ADR-002-No-Backend.md` | Por qué no hay backend. |
| `adr/ADR-011-Grouping-First.md` | Por qué la agrupación es obligatoria. |
| `adr/ADR-012-Replacement-Modes.md` | Por qué hay 4 modos de reemplazo. |
| `roadmap/MVP.md` | Qué entra exactamente en el primer release. |
