<!-- CONTEXT: scope=adr | dependencias=08_Security_Model.md,06_Pipeline.md | audiencia=humanos+IA | fase=2 -->

# ADR-004 — Renderizado por Reconstrucción (no redacción in-place)

- **Estado**: Accepted
- **Fecha**: 2026-06-17
- **Decidido por**: Planificación inicial

## Contexto

El output del producto es un PDF donde la información sensible **no debe ser recuperable**. Existen dos enfoques técnicos para producir ese PDF:

1. **Redacción in-place**: abrir el PDF original, tachar/eliminar las regiones sensibles y guardar.
2. **Reconstrucción**: renderizar cada página (con los reemplazos aplicados) a imagen, y ensamblar un PDF nuevo desde cero.

La redacción in-place tiene una falla crítica de seguridad: las herramientas que solo tapan visualmente (negro encima del texto) dejan el texto embebido, recuperable seleccionando o quitando la caja. Incluso herramientas que "remueven" el texto del content stream pueden dejar rastros en capas comprimidas, XMP, o fonts embebidas.

## Decisión

**El PDF exportado se reconstruye desde cero**, no se redacta in-place. El flujo es:

1. `Render Engine` produce una imagen por página (Canvas/OffscreenCanvas) con los reemplazos ya aplicados visualmente (texto sintético/placeholder, censura, o bloque negro en modo `redact`).
2. `Export Engine` crea un `PDFDocument` vacío con pdf-lib y adjunta cada imagen como una página.
3. No se copia del original: capas de texto, fonts embebidas, bookmarks, JavaScript, forms, XMP, metadata sensible. Todo se descarta.
4. La metadata del nuevo PDF es mínima y generada por Anonly.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **Redacción in-place con pdf-lib (quitar texto del content stream)** | Riesgo de recuperación por capas comprimidas, fonts embebidas con glyph mapping, XMP. Requiere auditar cada PDF para garantizar remoción completa. Complejo y frágil. |
| **Redacción visual con caja negra (sin tocar texto)** | Recuperable trivialmente: seleccionar el texto bajo la caja. Inaceptable. |
| **Redacción con pdf-lib + overwrite del texto con "X"** | Sigue dejando el texto en el content stream. Recuperable. |
| **Reconstrucción pero preservando texto no sensible (mejor calidad)** | Re-construir capas de texto es muy complejo y arriesgado: si nos equivocamos con qué texto es "sensible", filtramos. MVP prioriza seguridad sobre calidad de texto seleccionable. |

## Consecuencias

**Positivas**:
- Garantía de no-recuperabilidad: el texto original no está en el PDF resultante, punto.
- Simplifica el modelo mental: el export es "imágenes + pdf-lib", no "edición quirúrgica del original".
- Más fácil de testear (test de no-recuperabilidad determinista).
- Decoupling: el Render Engine no necesita entender la estructura interna del PDF, solo producir imágenes.

**Negativas**:
- El PDF resultante **no tiene texto seleccionable** ni buscable. Es un PDF "scanned-like".
  > **Confirmado por ADR-059 §4 (2026-08-06)**: sigue valiendo **sin excepciones**. La leyenda opcional de marcadores se evaluó con `drawText` de pdf-lib —mucho más barato— y se **rechazó** precisamente para no romper esta propiedad: se rasteriza y se embebe como cualquier otra página. El motivo es que "el export es 100% imagen" se audita en un segundo (abrir el PDF, intentar seleccionar texto, no hay nada), mientras que con una sola capa de texto auditar pasa a ser un juicio sobre su contenido.
- Mayor tamaño de archivo (imágenes vs texto vectorial).
- Se pierden bookmarks, links, forms del original.
- Calidad de texto en zoom depende de la resolución de render (mitigado con DPI configurable, default 150).

**Neutras**:
- v2.0 podría ofrecer un modo "texto preservado" con redacción verificada por capas (requiere investigación adicional y su propio ADR). MVP no lo incluye.

## Validación

- Test `no-recuperability` en CI: cualquier regex de valor original matchea cero veces en el buffer del export.
- Test `metadata-strip`: export no contiene `author`/`creator`/`title` del original.
- Test de tamaño: export de `text-10p.pdf` < 2 MB con DPI 150 JPEG q 0.85.

## Referencias

- `08_Security_Model.md` §4
- `06_Pipeline.md` §13 (etapa 11)
- `core/Render_Engine.md` (spec)
- `core/Export_Engine.md` (spec)
- `roadmap/Version_2.0.md` (modo texto preservado, futuro)
