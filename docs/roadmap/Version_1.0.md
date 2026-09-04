<!-- CONTEXT: scope=roadmap-v1 | dependencias=roadmap/MVP.md,00_Project_Vision.md | audiencia=humanos+IA | fase=5 -->

# Anonly — Roadmap v1.0

> Mejoras sobre el MVP. v1.0 no cambia la arquitectura; agrega features que el MVP dejó fuera y refina UX/perf.

**Versión objetivo**: 1.0.0
**Criterio**: cumple todas las métricas v1.0 (más exigentes que MVP) + features listadas.

---

## 1. Objetivo v1.0

Producto pulido para uso profesional diario. Mejor calidad de detección, mejor UX, mejor perf, soporte para más casos de uso sin cambiar el Core arquitecturalmente.

---

## 2. Features v1.0

### 2.1 Detección

- **Patrones Regex custom del usuario**: UI para crear/editar/eliminar patrones con validación (regex válida + `EntityType` válido + test en vivo sobre una muestra). Persistencia en `localStorage`. Ver `core/Regex_Engine.md` §6 (`addPattern`/`removePattern`).
- **Mejora de NER**: opción de usar WebGPU si está disponible (fallback WASM). Reducción de tiempo NER de 5–15 s a 1–3 s por página en dispositivos con WebGPU.
- **Agregado de tipos de entidad custom**: el usuario puede definir `EntityType.Custom` con su propio label, formato mask y sintetizador.

### 2.2 Pipeline

- **Pausa/reanudación parcial**: el usuario puede pausar el pipeline en cualquier etapa y reanudar. Estado del pipeline persistente en sesión (no en disco).
- **Reprocesamiento selectivo**: tras editar un grupo, el usuario puede re-ejecutar NER solo en las páginas con miembros de ese grupo, para detectar entidades que la primera pasada no encontró.
- **Batch encolado**: el usuario puede encolar varios PDFs y procesarlos secuencialmente (no paralelo, para respetar memoria).

### 2.3 UX

- **Modo oscuro**: tokens de diseño con variantes dark/light. Respeto de `prefers-color-scheme`.
- **Multi-idioma UI**: inglés y español. Sistema de i18n (probable `react-i18next` con ADR específico).
- **Atajos de teclado completos**: panel de ayuda `Cmd/Ctrl+?` con lista.
- **Tooltips enriquecidos**: en highlights del visor, mostrar valor original + modo + tipo + conteo de ocurrencias.
- **Filtros avanzados en el árbol**: por tipo, por modo, por conflicto, por habilitado.
- **Búsqueda con regex en el árbol**: además de texto literal.
- **Historial de acciones (undo/redo)**: hasta 50 acciones, con `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z`.

### 2.4 Export

- **Marca de agua opcional**: "Anonimizado por Anonly" configurable en `ExportOptions` (default off).
- **Export a imágenes (PNG por página)**: además de PDF.
- **Export con DPI configurable en UI** (150/300/600).
- **Estimación de tamaño pre-export más precisa**.

### 2.5 Performance

- **WebGPU para NER** cuando esté disponible.
- **SharedArrayBuffer para NER** (requiere COOP/COEP headers; ADR específico).
- **Cache más agresiva**: snapshots de `EntityGroup[]` por `documentId` en sesión para reabrir rápido.
- **Bundle inicial < 600 KB gz** (optimización de deps).

### 2.6 Accesibilidad

- Auditoría WCAG 2.1 AA completa.
- Soporte para screen readers refinado ( VoiceOver, NVDA).
- Navegación por teclado 100% (sin necesidad de mouse).

### 2.7 PWA — ~~en alcance~~ **FUERA DE ALCANCE (ADR-130)**

El 1.0 se entrega como **aplicación de escritorio empaquetada**, no como PWA, y el escritorio **reemplaza** al cliente web en vez de convivir con él.

La PWA resolvía el modo offline, pero no los dos problemas que motivaron el cambio: (a) sigue necesitando una URL, y la promesa "100% local" es también perceptiva —ver ADR-130 §1—; (b) el motor de render lo sigue decidiendo el navegador desde el que se instala, que es de donde vino el bug de Safari de `polyfills.ts`. Y su modo offline es frágil: los ~202 MB viven en Cache Storage, que el navegador desaloja bajo presión de disco.

Lo que la PWA prometía lo cubre el instalador, mejor: los assets viajan adentro del paquete (ADR-130) y las actualizaciones son automáticas (ADR-131).

- ~~**Installable como PWA**: service worker para offline (assets estáticos cacheados).~~
- ~~**Modo offline real**: tras primera carga, la app funciona sin red (modelos y wasm ya cacheados).~~

---

## 3. Métricas v1.0 (más exigentes que MVP)

| Métrica | Target v1.0 |
|---|---|
| PDF 10p texto | < 5 s |
| PDF 10p escaneado | < 40 s |
| Pico memoria 50p | < 320 MB |
| Bundle inicial | < 600 KB gz |
| Recall NER | ≥ 88% |
| Precision NER | ≥ 92% |
| Delta render 1 grupo | < 100 ms |
| First preview | < 1 s |

---

## 4. ADRs nuevos esperados en v1.0

> Sin número reservado: la numeración se asigna al crear cada ADR, tomando el siguiente número libre en `docs/adr/`. Reservar números en roadmaps generó colisiones (los "ADR-013/014" reservados acá fueron tomados por decisiones reales del Hito 2).

- WebGPU NER — backend WebGPU con fallback WASM.
- i18n — decisión de `react-i18next` u otra lib.
- PWA Offline — service worker + COOP/COEP.
- Undo/Redo — estrategia de historial de acciones.
- Custom Entity Types — extensibilidad de tipos.

---

## 5. Hitos v1.0

1. Patrones Regex custom + UI.
2. Modo oscuro + tokens.
3. Multi-idioma.
4. WebGPU NER (con fallback).
5. Pausa/reanudación.
6. Undo/redo.
7. PWA + offline.
8. Export a imágenes + marca de agua.
9. Auditoría accesibilidad.
10. Hardening + release 1.0.0.

---

## 6. Referencias

- `roadmap/MVP.md` (qué se construye primero)
- `roadmap/Version_2.0.md` (qué sigue)
- `00_Project_Vision.md` §6 (alcance/no-alcance)
