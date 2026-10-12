# @anonly/react-client

## 1.0.2

### Patch Changes

- 8a1dbcf: - El aviso de espacio justo (]↔[) muestra cómo queda el texto hoy y cómo quedaría con cada salida, y aplica la que elegís. «Dejarlo a la vista» confirma con un aviso y se puede deshacer (ADR-215).
  - «Eliminar entidad» pide confirmación con un diálogo que muestra qué pasa con el texto: queda a la vista en todas sus apariciones (ADR-215).
  - La versión del pie de inicio abre «Novedades», con lo que trae cada versión (ADR-216).
- fcee056: Cambia la detección y el PDF exportado: el mismo documento puede dar un resultado distinto que en la versión anterior.

  - Una dirección incluye la altura que la sigue: «Maipú 1434» se tapa entera, y antes quedaba el número a la vista (ADR-212).
  - Se reconoce una dirección precedida por «calle», «Av.» o una expresión de domicilio, también en mayúsculas, aunque el modelo no reconozca el nombre de la calle (ADR-217).
  - En texto en mayúsculas, una dirección que chocaba con el patrón de patente («AVENIDA DEL MAR 450») ya no deja la calle a la vista (ADR-214).
  - En escaneos de baja resolución se detecta el email cuando la lectura confunde la `@` con una `Q` (ADR-211).
  - Una página casi vacía con tinta y sin orientación reconocida prueba los cuatro ángulos para recuperar un renglón de costado (enmienda RC de ADR-190).
  - Cuando una etiqueta no entra en el lugar del dato, el resto del renglón se corre con su letra original, igual a cualquier zoom y en el PDF exportado (ADR-210).
  - Al cambiar entre Original y Anonimizado después de un zoom o de una edición, la página se ve nítida, y bajo «Anonimizado» nunca se muestra la imagen original (ADR-213).

- 1d0b02b: - La búsqueda y la selección sobre la vista anonimizada siguen la posición visible del texto, incluso cuando una etiqueta desplaza el resto del renglón. El texto tapado queda fuera de la selección (ADR-204).
  - Si editás después de exportar, el diálogo avisa que hay cambios pendientes y permite generar una copia actualizada (ADR-205).
  - Los menús de las entidades se mantienen dentro del área visible y un selector abierto en Configuración se cierra sin cerrar el diálogo (ADR-207).
  - Los avisos breves se sustituyen y duran tres segundos; eliminar una entidad conserva la acción Deshacer y el aviso saliente deja de recibir foco.
  - La búsqueda manual de actualizaciones confirma cuando el actualizador informa que estás usando la última versión; no confirma ante una búsqueda omitida o fallida (ADR-206).
- Updated dependencies [fcee056]
- Updated dependencies [1d0b02b]
  - @anonly/ocr-engine@1.0.2
  - @anonly/ner-engine@1.0.2
  - @anonly/render-engine@1.0.2
  - @anonly/anonymization-core@1.0.2
  - @anonly/export-engine@1.0.2
  - @anonly/pdf-engine@1.0.2

## 1.0.1

### Patch Changes

- Las actualizaciones muestran el avance de la descarga en una tarjeta, se instalan sin asistente y, con «Instalar automáticamente», al cerrar Anonly (en macOS, al abrirlo). El instalador se vuelve a verificar antes de usarse y Windows lo vuelve a correr si la instalación se corta (ADR-197). El instalador de Windows se publica con el nombre que indica su manifiesto (ADR-198).
  - @anonly/anonymization-core@1.0.1
  - @anonly/export-engine@1.0.1
  - @anonly/ner-engine@1.0.1
  - @anonly/ocr-engine@1.0.1
  - @anonly/pdf-engine@1.0.1
  - @anonly/render-engine@1.0.1

## 1.0.0

### Minor Changes

- df0c629: La búsqueda automática de actualizaciones se puede apagar desde Configuración (ADR-188).

### Patch Changes

- 6d989b3: El instalador incluye los textos de licencia del software de terceros que distribuye, y «Acerca de» lista los componentes principales (ADR-196).
  - @anonly/anonymization-core@1.0.0
  - @anonly/export-engine@1.0.0
  - @anonly/ner-engine@1.0.0
  - @anonly/ocr-engine@1.0.0
  - @anonly/pdf-engine@1.0.0
  - @anonly/render-engine@1.0.0

## 0.9.2

### Patch Changes

- 9058528: Corrige el empaquetado de macOS para publicar un instalador universal y un único appcast de Sparkle.
- Updated dependencies [9058528]
  - @anonly/anonymization-core@0.9.2
  - @anonly/export-engine@0.9.2
  - @anonly/ner-engine@0.9.2
  - @anonly/ocr-engine@0.9.2
  - @anonly/pdf-engine@0.9.2
  - @anonly/render-engine@0.9.2

## 0.9.1

### Patch Changes

- @anonly/anonymization-core@0.9.1
- @anonly/export-engine@0.9.1
- @anonly/ner-engine@0.9.1
- @anonly/ocr-engine@0.9.1
- @anonly/pdf-engine@0.9.1
- @anonly/render-engine@0.9.1
