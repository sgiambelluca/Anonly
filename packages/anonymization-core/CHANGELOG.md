# @anonly/anonymization-core

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
