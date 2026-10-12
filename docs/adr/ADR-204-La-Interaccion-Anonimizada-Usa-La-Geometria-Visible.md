<!-- CONTEXT: scope=adr-aceptado | dependencias=adr/ADR-058-Repintado-De-Linea-Por-Calibracion.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,core/Contracts.md,core/Render_Engine.md,core/Orchestrator.md,ui/Components.md | audiencia=humanos+IA | fase=11 -->

# ADR-204 — La interacción anonimizada usa la geometría visible

- **Estado:** Aceptado por el mantenedor el 2026-10-05.
- **Fecha:** 2026-10-05.
- **Alcance:** lupa y selección manual en la vista anonimizada.
- **Implementación autorizada:** contratos y specs se cierran antes de delegar.

## Contexto

El humano pide mostrar el rectángulo amarillo de la lupa en anonimizado y
permitir el mismo click/arrastre del original, ignorando etiquetas ya
anonimizadas. Actualmente `PdfViewer` monta `WordSelectionOverlay` solamente
en original. Tanto la lupa como la selección usan la geometría de `Page.words`.

El anonimizado conserva un raster, sin una capa de palabras equivalente.
Además, `tryRepaintLine` en el kernel de render mueve las palabras vecinas
por `plan.delta` cuando el reemplazo exige espacio (ADR-058). Las coordenadas
originales pueden ser incorrectas incluso para texto que sigue visible.
Filtrar solamente los bboxes de las entidades no soluciona ese desplazamiento.

## Decisión

1. El kernel de render devuelve, junto al preview anonimizado, un mapa de
   las posiciones efectivamente pintadas. Lo produce el mismo cálculo que
   dibuja el raster; la UI no recalcula fuentes ni desplazamientos.
2. El mapa identifica palabras originales todavía visibles y zonas de
   reemplazo por ocurrencia, sin transportar texto original oculto adicional.
   `PreviewWordPosition` vincula `sourceBbox` original con `bbox` trasladado;
   `PreviewCoveredRegion` vincula `occurrenceId`, `sourceBbox` de un fragmento
   y `bbox` visible. `PreviewInteractionGeometry` contiene ambos arrays,
   `revision` y `scale`. Las cajas están en puntos de página, sin texto.
   Reutilizar los tokens originales, como propone el humano. Una marca
   derivada de si están cubiertos por reemplazos habilitados permite excluirlos
   de la selección. Mantener esa marca en la vista de interacción o calcularla
   desde las entidades vigentes, sin mutar `Page.words` ni persistir un boolean
   que quede viejo al deshabilitar, eliminar, deshacer o cambiar un grupo.
   La marca resuelve qué palabras se pueden elegir; el mapa resuelve dónde
   se ven las que se desplazaron durante el repintado.
3. Raster y mapa pertenecen a la misma revisión de contenido, página, kind
   y escala. Cache, resultados tardíos y cambios de zoom no pueden combinar
   píxeles nuevos con geometría vieja. Sin mapa vigente, deshabilitar el
   hit-test en anonimizado hasta recibirlo.
   Usar una representación dispersa de desplazamientos y zonas cubiertas:
   no duplicar texto ni retener un segundo documento completo. Su vida sigue
   la del preview cacheado y los límites de memoria existentes.
4. La lupa mantiene el índice del documento original. Una coincidencia que
   sigue visible usa su geometría transformada. Para una coincidencia que
   ahora es etiqueta, señalar la zona del reemplazo sin
   restaurar ni dibujar su texto original.
5. El click/arrastre selecciona únicamente palabras todavía visibles. Las
   etiquetas, los bloques negros y las zonas cubiertas quedan excluidos.
   Una selección formada solamente por zonas cubiertas no hace nada. Las
   entidades deshabilitadas tienen texto visible y siguen siendo seleccionables.
6. El agregado conserva el contrato actual: un valor de palabras consecutivas
   de un renglón, y todas sus apariciones. Revalidar selección y visibilidad
   antes de confirmar si el documento se editó desde el arrastre.

## Política de interacción aceptada

Si el arrastre empieza sobre una etiqueta, ignorarlo. Si empieza en texto
visible, tomar su tramo consecutivo y cortarlo al alcanzar la primera zona
anonimizada. Respetar la dirección del arrastre y mostrar exactamente el
tramo elegido en el globo antes de agregar. No unir palabras a ambos lados
de una zona cubierta. La lupa sigue localizando el texto original ya cubierto
y señala la etiqueta o bloque correspondiente.

**Enmienda del 2026-10-06, caso reportado por el mantenedor:** si el gesto
empieza en blanco, el rectángulo puede seleccionar texto visible aunque su
punto inicial esté arriba o debajo del renglón. Elegir el renglón dominante
como en el original (ADR-114), y su primer token tocado según la dirección;
ese token es el ancla. Si está cubierto, ignorar; en otro caso, aplicar el
mismo corte ante cobertura. No ensanchar cajas ni inventar un umbral de
altura. Cuando se empieza directamente sobre texto visible, conservar el
ancla original y el corte existente, aunque otra corrida cubra más área.

La cobertura de palabras se determina contra `sourceBbox`; el hit-test y el
rectángulo se dibujan con `bbox`. Cualquier solapamiento de área positiva con
una región cubierta excluye el token completo, aunque esté parcialmente tapado;
no hay umbral porcentual. Una palabra sin entrada desplazada conserva su caja
original. En repintado, la etiqueta usa la extensión real del token
y las vecinas usan el mismo delta del dibujo. Con fragmentos hay una región
por fragmento, incluidos los que solo se tapan. Rotación y redact conservan
las reglas existentes del kernel.

El Orchestrator mantiene una revisión por documento/página, inicialmente 0;
la incrementa al invalidar una página por cambios de grupos o palabras OCR.
La expone con `getPreviewInteractionRevision(documentId, pageIndex)`, que
devuelve `null` si la página no existe. La adjunta al input de preview y al
payload del worker. Render la incorpora a su clave de cache y devuelve el
mapa de la misma entrada que el blob. El cliente solo acepta un mapa cuya
revisión coincide con la vigente del façade. Un preview sin mapa puede
mostrarse, pero no admite interacción anonimizada. Toda página invalidada,
también si queda sin reemplazos tras reanálisis, debe tener un input nuevo.

La siembra de esos inputs no implica rasterizar todas las páginas vacías.
`RenderEngine.preparePreviewInput(input): boolean` los registra sin trabajo
de imagen y señala si ya hubo una solicitud de preview. El seed renderiza
solo páginas con reemplazos o previamente solicitadas; en estas últimas
refresca inmediatamente la generación, incluso si el render anterior sigue
en vuelo. Una página vacía nunca solicitada conserva la carga diferida y
recibe su primera imagen con la revisión preparada, también después de OCR.
La marca se elimina al cargar/cerrar el documento o disponer el motor;
preparar metadatos y exportar full no la crean. El contrato detallado y las
precondiciones se declaran en Render §6 y su enmienda normativa.

## Alternativas

- **Copiar bboxes originales:** barato pero incorrecto en líneas repintadas.
- **Recalcular layout en React:** duplica decisiones del kernel y puede
  divergir por métricas tipográficas y escala.
- **Quitar repintado:** altera legibilidad y exportación, fuera de este pedido.
- **OCR sobre el preview:** vuelve a reconocer texto y pierde el vínculo
  fiable con las ocurrencias originales; agrega costo y ambigüedad.

## Plan y validación

Contratos nuevos declarados en Contracts; transporte en Data Model y Event
System; obligaciones en Render, Orchestrator y specs UI. Implementar por
módulos sin dependencias externas, OCR adicional ni cambios al PDF exportado.

Pruebas: palabra vecina desplazada por etiqueta larga, etiqueta corta sin
repintado, redact, varias entidades por línea, fragmentos multilínea, OCR,
zoom, cambio de modo, caché de preview, edición mientras hay selección y
resultado de render tardío. En Electron, el rectángulo y el hit-test deben
coincidir con la palabra visible. El resaltado nunca se incorpora al PDF
exportado. Los tests del original conservan su comportamiento.

## Revisión del 2026-10-07

El planificador midió el rectángulo de la lupa contra la tinta del canvas en
la aplicación de escritorio, con y sin repintado de línea: la posición y el
hit-test son correctos. Queda una diferencia menor con el punto 1 de la
decisión: el mapa conserva el tamaño original de una palabra desplazada,
aunque el repintado la haya dibujado más chica. No se corrige acá, porque
depende de qué se decida sobre el repintado de ADR-058. Medición y hallazgos:
`roadmap/interaccion/Revision_ADR204_2026-10-07.md`.
