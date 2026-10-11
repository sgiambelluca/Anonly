---
"@anonly/regex-engine": patch
"@anonly/ocr-engine": patch
"@anonly/ner-engine": patch
"@anonly/grouping-engine": patch
"@anonly/render-engine": patch
"@anonly/react-client": patch
---

Cambia la detección y el PDF exportado: el mismo documento puede dar un resultado distinto que en la versión anterior.

- Una dirección incluye la altura que la sigue: «Maipú 1434» se tapa entera, y antes quedaba el número a la vista (ADR-212).
- Se reconoce una dirección precedida por «calle», «Av.» o una expresión de domicilio, también en mayúsculas, aunque el modelo no reconozca el nombre de la calle (ADR-217).
- En texto en mayúsculas, una dirección que chocaba con el patrón de patente («AVENIDA DEL MAR 450») ya no deja la calle a la vista (ADR-214).
- En escaneos de baja resolución se detecta el email cuando la lectura confunde la `@` con una `Q` (ADR-211).
- Una página casi vacía con tinta y sin orientación reconocida prueba los cuatro ángulos para recuperar un renglón de costado (enmienda RC de ADR-190).
- Cuando una etiqueta no entra en el lugar del dato, el resto del renglón se corre con su letra original, igual a cualquier zoom y en el PDF exportado (ADR-210).
- Al cambiar entre Original y Anonimizado después de un zoom o de una edición, la página se ve nítida, y bajo «Anonimizado» nunca se muestra la imagen original (ADR-213).
