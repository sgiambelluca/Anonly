# @anonly/anonymization-core

## 1.1.0

### Minor Changes

- - Tipos de entidad del usuario, guardados o del documento, con su etiqueta, sus versiones cortas y su modo (ADR-219, ADR-225).
  - Formatos armados con piezas y recorridos en tiempo lineal; el catálogo de Argentina sale de un catálogo por país (ADR-220, ADR-221).
  - Dos formatos que se pisan van al panel de conflicto, que nace resuelto (ADR-222).
  - `DetectionConfig`, y exportar e importar formatos con `validateFormatsFile` (ADR-223).
  - La hoja de referencia del export se pagina y nombra los tipos propios. Un formato que falla no frena el análisis y se avisa en `skippedFormats`.

### Patch Changes

- - Baja el pico de memoria del segundo escaneo: el parseo suelta las imágenes de cada página, el kernel de Render suelta la página al terminar y el Orchestrator da de baja el pool ocioso de NER al empezar el OCR (ADR-230 a ADR-232).
- Updated dependencies
- Updated dependencies
  - @anonly/pdf-engine@1.1.0
  - @anonly/render-engine@1.1.0
  - @anonly/shared@1.1.0
  - @anonly/regex-engine@1.1.0
  - @anonly/grouping-engine@1.1.0
  - @anonly/export-engine@1.1.0
  - @anonly/event-system@1.1.0
  - @anonly/ner-engine@1.1.0
  - @anonly/ocr-engine@1.1.0

## 1.0.2

### Patch Changes

- 1d0b02b: - La búsqueda y la selección sobre la vista anonimizada siguen la posición visible del texto, incluso cuando una etiqueta desplaza el resto del renglón. El texto tapado queda fuera de la selección (ADR-204).
  - Si editás después de exportar, el diálogo avisa que hay cambios pendientes y permite generar una copia actualizada (ADR-205).
  - Los menús de las entidades se mantienen dentro del área visible y un selector abierto en Configuración se cierra sin cerrar el diálogo (ADR-207).
  - Los avisos breves se sustituyen y duran tres segundos; eliminar una entidad conserva la acción Deshacer y el aviso saliente deja de recibir foco.
  - La búsqueda manual de actualizaciones confirma cuando el actualizador informa que estás usando la última versión; no confirma ante una búsqueda omitida o fallida (ADR-206).
- Updated dependencies [fcee056]
- Updated dependencies [1d0b02b]
  - @anonly/regex-engine@1.0.2
  - @anonly/ocr-engine@1.0.2
  - @anonly/ner-engine@1.0.2
  - @anonly/grouping-engine@1.0.2
  - @anonly/render-engine@1.0.2
  - @anonly/shared@1.0.2
  - @anonly/event-system@1.0.2
  - @anonly/export-engine@1.0.2
  - @anonly/pdf-engine@1.0.2

## 1.0.1

### Patch Changes

- @anonly/event-system@1.0.1
- @anonly/export-engine@1.0.1
- @anonly/grouping-engine@1.0.1
- @anonly/ner-engine@1.0.1
- @anonly/ocr-engine@1.0.1
- @anonly/pdf-engine@1.0.1
- @anonly/regex-engine@1.0.1
- @anonly/render-engine@1.0.1
- @anonly/shared@1.0.1

## 1.0.0

### Patch Changes

- @anonly/event-system@1.0.0
- @anonly/export-engine@1.0.0
- @anonly/grouping-engine@1.0.0
- @anonly/ner-engine@1.0.0
- @anonly/ocr-engine@1.0.0
- @anonly/pdf-engine@1.0.0
- @anonly/regex-engine@1.0.0
- @anonly/render-engine@1.0.0
- @anonly/shared@1.0.0

## 0.9.2

### Patch Changes

- 9058528: Corrige el empaquetado de macOS para publicar un instalador universal y un único appcast de Sparkle.
- Updated dependencies [9058528]
  - @anonly/event-system@0.9.2
  - @anonly/export-engine@0.9.2
  - @anonly/grouping-engine@0.9.2
  - @anonly/ner-engine@0.9.2
  - @anonly/ocr-engine@0.9.2
  - @anonly/pdf-engine@0.9.2
  - @anonly/regex-engine@0.9.2
  - @anonly/render-engine@0.9.2
  - @anonly/shared@0.9.2

## 0.9.1

### Patch Changes

- @anonly/event-system@0.9.1
- @anonly/export-engine@0.9.1
- @anonly/grouping-engine@0.9.1
- @anonly/ner-engine@0.9.1
- @anonly/ocr-engine@0.9.1
- @anonly/pdf-engine@0.9.1
- @anonly/regex-engine@0.9.1
- @anonly/render-engine@0.9.1
- @anonly/shared@0.9.1
