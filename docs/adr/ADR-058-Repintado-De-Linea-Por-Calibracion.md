<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Render_Engine.md,core/Orchestrator.md,core/PDF_Engine.md,architecture/05_Worker_Architecture.md,architecture/07_Performance_Strategy.md,adr/ADR-004-Rendering.md,adr/ADR-009-Export-Strategy.md,adr/ADR-012-Replacement-Modes.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,adr/ADR-041-FuseOcrPage-Funcion-Pura-Sin-Estado-Retenido.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md,adr/ADR-053-Pdfjs-Dentro-De-Un-Worker-Fuentes-Y-Cmaps.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md | audiencia=humanos+IA | fase=10.5 -->

# ADR-058 — Repintado de línea por calibración: que el reemplazo nunca se derrame, y que el documento se siga leyendo como un documento

- **Estado**: Accepted
- **Fecha**: 2026-08-06
- **Decidido por**: El humano, sobre dos propuestas propias. Descartó explícitamente redibujar el documento entero ("es verdad que sería altamente dificultoso el lograr esto y rompe con lo que mencionás") y eligió el punto medio de repintar la línea afectada, con fidelidad tipográfica **aproximada sin costura visible** y con el repintado activándose **solo cuando el token no entra**. Es el punto 5 de `Cambios para hacer.txt`.
- **Relacionado con**: ADR-004 y ADR-009 (**no se tocan**: el export sigue siendo raster; ver §11), ADR-012 (los cuatro modos de reemplazo), ADR-020 (granularidad de `Word` y prorrateo del ancho), ADR-041 (precedente de función pura host-side), ADR-043 (reparto host/worker/kernel, que este ADR respeta), ADR-053 (`disableFontFace: true` en el kernel — condiciona §3), ADR-057 (la escalera de abreviaturas, primera pieza de la misma cascada)
- **Parte de**: Hito 10.5, pasos 1, 3 y 4

> Convención de citas: `ADR-058 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-058, Contexto §N`.

## Contexto

### 1. El defecto, localizado

`paintReplacements` (`render-engine/src/worker/kernel.ts`), para los modos con texto:

```ts
context.fillStyle = REPLACEMENT_BG_COLOR;              // "#ffffff", exactamente el bbox
context.fillRect(bbox.x, bbox.y, bbox.width, bbox.height);
context.fillStyle = REPLACEMENT_TEXT_COLOR;            // "#000000"
context.font = fontForMode(replacement.mode, bbox.height);  // size = max(8, round(h * 0.7))
context.textAlign = "center";
context.fillText(replacement.replacementValue, bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
```

Tres decisiones se componen para producir el bug: el tamaño de fuente sale **solo de la altura**, el `fillText` va **sin `maxWidth`**, y el texto está **centrado**. Un token más ancho que su caja se derrama hacia los dos lados, más allá del rectángulo blanco, encima de palabras del original que siguen dibujadas debajo.

Afecta a `mask`, `synthetic` y `placeholder`. `redact` es inmune (fill opaco, sin texto).

### 2. Acortar el token no alcanza

ADR-057 baja `[PERSONA 01]` a `[PRS-01]`, pero:

- `mask` y `synthetic` no pueden acortarse sin destruir su semántica (ADR-057 §6), y `mask` de IBAN son 24 caracteres fijos.
- Sobre "Ana" (3 caracteres), ni `[PRS-01]` entra.

O sea que hace falta una garantía dura independiente del token, y hace falta algo mejor que encogerlo hasta lo ilegible.

### 3. Lo que hay disponible en el momento de pintar, y no se está usando

El kernel pinta sobre el **mismo contexto 2D** donde pdf.js acaba de renderizar la página (`renderPageOntoContext` → `paintReplacements`, en `renderPageKernel`). En ese instante tiene, gratis:

1. **El raster de la página ya dibujado.** `getImageData` sobre el bbox de una palabra da el color real de la tinta y del fondo. No hay que deducirlos del PDF — y deducirlos del PDF sería mucho peor: `getTextContent()` no expone color, hay que rastrear el estado gráfico con `getOperatorList()`.
2. **`measureText` del propio contexto**, que es la medición real con la que se va a dibujar.

Lo único que **no** tiene es el resto de las palabras de la página: `RenderPagePayload` transporta `replacements` y `annotations`, nada más.

### 4. La extracción tira todo lo que haría falta para "redibujar bien"

`convertTextItemsToWords` (`pdf-engine/src/pdf.engine.ts`) se queda con `str`, `x`, `y`, `width`, `height` y descarta: `fontName` y el mapa `styles` de pdf.js (familia tipográfica), la escala real de la matriz (`transform[0]`/`[3]`, o sea tamaño y rotación), y todo lo que no sea texto. `Page.words` es además una **lista plana** ordenada por posición (`sortWordsByReadingOrder`): no hay noción de línea, párrafo, sangría ni alineación.

Redibujar el documento entero exigiría reponer todo eso, más re-embeber las fuentes subseteadas del original, más decidir qué hacer con imágenes, tablas, sellos y vectores. Es el "modo texto preservado" que `Version_2.0.md:41` ya tiene agendado con ADR propio y research previo. El humano lo descartó para este hito.

### 5. Pero para **repintar una línea** no hace falta extraer nada

Con el raster (Contexto §3) y los bboxes de las palabras se puede **calibrar en vez de extraer**: probar un puñado de fuentes candidatas y quedarse con la que reproduce los anchos reales de esa línea. Es deducir la tipografía de cómo se comportó, no leerla del archivo.

Y tiene una propiedad que la extracción no puede tener: **funciona igual en documentos escaneados**. Todo sale del raster y de los bboxes, no de metadata del PDF, así que la ruta OCR (`sourceKind: "scanned"`) —donde no hay fuentes ni estructura— entra sin nada extra. Con extracción de metadata, los escaneados quedaban afuera por construcción y habría dos motores de repintado distintos.

### 6. El prorrateo de ADR-020 acota qué se puede prometer

pdf.js devuelve un `TextItem` por run (frecuentemente una línea o frase entera), no por palabra. ADR-020 divide el run en palabras **prorrateando el ancho linealmente por longitud de caracteres**, o sea asumiendo ancho de carácter constante dentro del run. Consecuencia para este ADR: la **suma** de los anchos de un run es exacta, los anchos y posiciones **individuales** son aproximados.

Eso decide dos cosas de §3 y §5: la calibración se ajusta sobre el conjunto de la línea (donde el error se cancela), no palabra por palabra; y el reposicionamiento aplica un **desplazamiento uniforme** a las x registradas, que preserva el espaciado relativo aunque las x sean aproximadas.

## Decisión

Una cascada de cuatro piezas. Cada una absorbe lo que la anterior no pudo, y **la primera es la garantía**: todo lo demás es calidad.

### 1. Shrink-to-fit: nada se derrama nunca

`paintReplacements` mide con `measureText` y ajusta el tamaño de fuente hasta que el token entra en el ancho disponible, con el piso de 8px que `fontForMode` ya tiene. El `fillText` pasa además a llevar `maxWidth` como red de seguridad final.

Aplica a los tres modos con texto, siempre, **independientemente del resto de este ADR**. Es un cambio local a una función y no toca ningún contrato: si los §2-§6 nunca se implementaran, el defecto reportado igual quedaría cerrado.

Es la única pieza de este ADR que es una garantía dura. Las demás son mejores resultados cuando las condiciones lo permiten.

### 2. Repintado de línea, **solo cuando el token no entra**

Si tras ADR-057 el token sigue sin caber en su bbox, y las condiciones de §6 se cumplen:

1. Tapar desde `bbox.x` hasta el final de la línea, con el color de fondo muestreado (§4), sobre la banda vertical que cubre las palabras de esa línea.
2. Dibujar el token en `bbox.x`, con la tipografía calibrada (§3) y el color muestreado (§4).
3. Redibujar cada palabra siguiente de la línea **en su propia x registrada, desplazada por el delta** `(anchoDelToken - bbox.width)`.

**El paso 3 es reposicionamiento, no re-maquetado**, y esa distinción es la decisión de fondo:

- El error de calibración **no se acumula**. Cada palabra se ancla a una posición conocida en vez de derivarse de la anterior, así que un desvío de medio píxel por palabra se queda en medio píxel, no en quince al final del renglón.
- **El texto justificado sobrevive.** Si el original tiene el espaciado entre palabras estirado, se conserva, porque los espacios nunca se recalculan.
- El prorrateo de ADR-020 (Contexto §6) deja de importar: un desplazamiento uniforme preserva las posiciones relativas, que es lo que el ojo lee como "palabras parejas".

Si el token **entra**, no se repinta nada: se conserva el camino actual (rectángulo del bbox + texto). El humano lo pidió explícitamente así — menos superficie de riesgo y menos costo por página.

### 3. Calibración inversa de la tipografía

Se prueba un conjunto acotado de candidatos —familia genérica (`serif` / `sans-serif` / `monospace`) × peso (`normal` / `bold`) × estilo (`normal` / `italic`)— con el tamaño derivado de la altura del bbox (`REPLACEMENT_FONT_HEIGHT_RATIO`, ADR-057 §5) como punto de partida, y se elige el candidato que **minimiza el error entre el ancho medido con `measureText` y el ancho real registrado** de las palabras de la línea.

Restricciones que hacen válido el método:

- **Se ajusta sobre el conjunto de la línea, no palabra por palabra** (Contexto §6): el prorrateo hace exacta la suma y aproximados los individuales.
- **Solo familias genéricas.** El kernel corre con `disableFontFace: true` (ADR-053) y dentro de un Worker, donde no hay Font Loading API ni fuentes web: pedir una familia concreta por nombre no tiene sentido y no se hace.
- Si el mejor candidato deja un error relativo por encima de un umbral, **no se calibra**: se cae a §6 (fallback). Una calibración mala es peor que no repintar, porque produce exactamente la costura visible que el humano pidió evitar.

### 4. El color se muestrea del canvas, no se deduce del PDF

`getImageData` sobre el bbox de la palabra original da:

- **La tinta**: el píxel más oscuro dentro del área del glifo.
- **El fondo**: el color dominante del borde de la caja.

Con eso, `REPLACEMENT_BG_COLOR` y `REPLACEMENT_TEXT_COLOR` dejan de ser las constantes `#ffffff`/`#000000` fijas y pasan a ser lo que la página realmente tiene ahí. Resuelve de paso los fondos de color y los sombreados, que hoy quedan con un parche blanco encima.

Se muestrea **antes** de tapar nada, obviamente, y una sola vez por línea repintada.

> Costo: `getImageData` fuerza una lectura del backing store del canvas. Se hace **solo en las líneas que se repintan** (§2), que por construcción son pocas. En una página sin reemplazos que no entren, este ADR no agrega ni una lectura.

### 5. El transporte de las palabras de la línea: `RenderPagePayload.lineWords`

El kernel necesita las palabras vecinas y no las tiene (Contexto §3). Se agregan al payload:

```ts
export interface RenderPagePayload {
  // …campos actuales…
  readonly lineWords?: ReadonlyArray<Word>;
}
```

**Quién las selecciona**: el Orchestrator, con una **función pura host-side** que filtra desde `Page.words` las palabras que comparten línea con cada reemplazo. Precedente exacto de ese reparto: `fuseOcrPage` (ADR-041) — lógica pura que necesita el `Document` completo, ejecutada por el host, sin estado retenido y sin que ningún motor importe a otro.

**Cuándo se adjuntan**: solo cuando algún reemplazo de esa página **podría** no entrar, estimado con `estimateTokenWidth` (ADR-057 §5). La estimación se aplica con **margen conservador**: ante la duda, se adjunta. Adjuntar de más cuesta payload; adjuntar de menos degrada silenciosamente a §1. En una página donde todo entra, `lineWords` va ausente y el transporte no cambia en nada respecto de hoy.

**Si `lineWords` viene ausente y el kernel mide que no entra, cae a §1.** El campo es opcional y su ausencia nunca es un error.

> **Por qué no extraer el texto en el worker.** El kernel tiene el `pageProxy` y podría llamar `getTextContent()` él mismo, ahorrando el cambio de contrato. Se rechaza porque rompe el caso escaneado: en un PDF sin capa de texto, `getTextContent()` devuelve vacío y las únicas palabras que existen son las de OCR, que viven en el `Document` que retiene el Orchestrator. Sería duplicar la extracción de texto —responsabilidad de `pdf-engine`, no de éste— para obtener un resultado peor.

### 6. Cuándo **no** se repinta

El repintado se activa de forma **conservadora**: solo sobre lo que se puede verificar que es texto de cuerpo, alineado a la izquierda, con lugar a la derecha. Cualquier duda cae a §1.

Condiciones de activación, todas necesarias:

1. **Hay línea.** `lineWords` trae al menos una palabra a la derecha del reemplazo compartiendo banda vertical con él.
2. **La línea parece texto de cuerpo.** Los huecos entre palabras consecutivas están dentro de un rango plausible; un hueco desproporcionado delata una fila de tabla o columnas, no una línea.
3. **La alineación es a la izquierda.** Se infiere de las posiciones: si la línea está centrada o alineada a la derecha, desplazar hacia la derecha es la operación equivocada.
4. **Hay margen.** El desplazamiento cabe antes del extremo derecho de la caja de texto inferida para esa línea.
5. **La calibración cerró** (§3): el error del mejor candidato está bajo el umbral.

**Rotación — gap conocido y acotado.** `Word` no lleva rotación: `pdf-engine` descarta `transform[0]`/`[3]` (Contexto §4). El texto a 90°/270° no pasa la condición 1 (sus palabras no comparten banda vertical), así que se filtra solo. El texto a **180°** sí comparte banda y no es distinguible con los datos disponibles: es un gap residual, no bloqueante — el peor caso es una línea repintada con las palabras corridas hacia el lado equivocado, sin superposición, en un sello o marca de agua. Se verifica en el E2E manual de §10 con un PDF sellado. Cerrarlo de verdad requiere extender `Word` con la escala de la matriz, que es trabajo aparte (§11).

### 7. El aviso de degradación: `AnnotationKind.Degraded`

Cuando se cae a §1 y el encogido dejó el token por debajo de un umbral de legibilidad, la ocurrencia se marca con una anotación nueva:

```ts
export enum AnnotationKind {
  Highlight = "highlight",
  Replacement = "replacement",
  Redact = "redact",
  Conflict = "conflict",
  Degraded = "degraded",   // ADR-058 §7
}
```

Se pinta reutilizando `paintAnnotations`, que ya sabe dibujar recuadros por `AnnotationKind`.

**El umbral es una razón, no un tamaño absoluto**: `tamañoEfectivo / tamañoNatural < DEGRADED_FONT_RATIO` (default `0.6`, en `Contracts.md` §6). Deliberadamente **no** se usa un piso en píxeles: los píxeles dependen de la escala del render, así que un umbral absoluto haría que el preview y el export discreparan sobre si hay que avisar. La razón es invariante a la escala y los dos coinciden siempre. (El piso de 8px de `fontForMode` se conserva, pero es un piso de dibujo, no un criterio de aviso.)

**Por qué con umbral y no en todo fallback**: si la señal apareciera cada vez que el repintado no se activó, aparecería en medio documento y el usuario aprendería a ignorarla. El umbral existe para que significar algo.

**Y por qué avisar, si el resultado ya es correcto**: porque el aviso es accionable y la palanca principal **ya existe**. El usuario puede editar el `replacementValue` de ese grupo a mano (`GROUP_UPDATE_REQUESTED` con `patch.replacementValue`, respetado por ADR-057 §7), cambiar el modo a `redact` —que no tiene problema de espacio— o deshabilitar el grupo. Sin el aviso, esa palanca existe pero nadie sabe cuándo usarla: el token quedó chico en la página 7 y solo se descubre haciendo zoom página por página.

### 8. Lo que **no** cambia

- **El export sigue siendo raster.** Todo esto pasa sobre el canvas, antes del `convertToBlob`. ADR-004 y ADR-009 quedan intactos y la garantía de no-recuperabilidad sigue siendo **estructural** (no hay capa de texto en el PDF de salida), no dependiente de que el detector haya acertado.
- **El reparto de ADR-043 no se toca.** Toda la lógica nueva vive en el kernel sin estado por documento; la clase `RenderEngine` sigue host-side; no aparecen estados nuevos ni por documento ni por página.
- **`Replacement` no gana ningún campo.** Se evaluó y se descartó (ver Alternativas): el repintado hace innecesaria la idea de transportar una caja de layout expandida.
- **`pdf-engine` no se toca.** Ninguna pieza de este ADR necesita metadata de fuente.

### 9. Alcance: cuatro PRs

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 1 | Shrink-to-fit (§1) | `render-engine` | — |
| 2 | `RenderPagePayload.lineWords`, `AnnotationKind.Degraded`, `DEGRADED_FONT_RATIO` — junto con los tipos de ADR-057 §8 y ADR-059 §3 | `shared` | — |
| 4 | Selección host-side de las palabras de la línea (§5) | `packages/anonymization-core/src` | PR 2 |
| 5 | Calibración, muestreo de color, repintado y condiciones de activación (§2-§4, §6) | `render-engine` | PR 2, PR 4 |
| 6 | Umbral y emisión de la anotación `Degraded` (§7) | `render-engine` | PR 5 |

El PR 1 va primero y **no depende de nada**: cierra el defecto reportado por sí solo. Es el criterio de alivio que ADR-056 §7 ya usó con su PR 1.

La numeración es la del Hito 10.5 completo (`roadmap/MVP.md` §4); los PRs 3, 7 y 8 son de ADR-057 y ADR-059.

### 10. Tests

`render-engine`, PR 1:

- Unit, **test de propiedad**: para cualquier combinación generada de token y bbox, el ancho medido del texto dibujado nunca excede el ancho disponible. Es la aserción que representa la garantía de §1; el resto de los tests de este ADR son de calidad.
- Edge: un token muchísimo más largo que su caja se dibuja al piso de 8px y no se derrama.
- Edge: los tres modos con texto respetan el ajuste; `redact` no cambia de comportamiento.

`packages/anonymization-core/src`, PR 4:

- Unit: la función de selección es pura — misma entrada, misma salida, sin estado retenido entre llamadas (mismo criterio que los tests de `fuseOcrPage`).
- Unit: agrupa por banda vertical y devuelve solo las palabras a la derecha del reemplazo.
- Unit: en una página donde todos los tokens entran, `lineWords` va **ausente** del payload.
- Edge: palabras de OCR (`source: "ocr"`) se seleccionan igual que las de PDF.

`render-engine`, PR 5:

- Unit: el repintado **no** se activa cuando el token entra (el camino actual se conserva bit a bit).
- Unit: con `lineWords` ausente y token que no entra, cae a §1 sin error.
- Unit: la calibración elige el candidato de menor error sobre un conjunto de anchos conocido.
- Unit: el desplazamiento es uniforme — cada palabra redibujada queda en `x + delta`, y las distancias relativas entre palabras se conservan (el test que protege la decisión de §2).
- Edge, una por condición de §6: sin palabras a la derecha; hueco desproporcionado (tabla); línea centrada; sin margen a la derecha; calibración por encima del umbral de error. Las cinco caen a §1.
- Edge: texto a 90° no activa el repintado (no comparte banda vertical).
- Edge: color de tinta y de fondo muestreados sobre una página con fondo no blanco.

`render-engine`, PR 6:

- Unit: el aviso se emite **solo** bajo `DEGRADED_FONT_RATIO`, no en todo fallback (§7).
- Unit: el mismo reemplazo produce el mismo veredicto de aviso en `preview` y en `full` — la prueba de que el umbral es invariante a la escala.

### 11. Verificación manual, como gate del PR 5

Browser real, no headless — mismo criterio que ADR-053 §8, ADR-054 §9 y ADR-056 §9, y por una razón más fuerte acá: **el criterio de aceptación de §2-§4 es visual y ninguna suite automatizada puede juzgar "costura visible"**.

Cuatro documentos, uno por familia de riesgo:

1. PDF de texto con nombres cortos ("Ana", "Luz") en medio de párrafos → el caso que motivó el ADR.
2. PDF escaneado (ruta OCR) → verifica la propiedad de Contexto §5.
3. PDF con tablas y con texto justificado → ejercita las condiciones 2 y 3 de §6.
4. PDF con sello o marca de agua → ejercita el gap de rotación de §6.

**Criterio de aceptación**: en un documento de texto normal, las líneas repintadas no se distinguen de las que no se tocaron, a tamaño de lectura.

**Si la costura canta**, el escalón siguiente —y no se hace de entrada— es extender `Word` con `fontName` y la escala real de la matriz de transformación: extensión aditiva y chica de `pdf-engine`, con ADR propio, que permitiría arrancar la calibración del candidato correcto en vez de deducirlo. Queda anotado acá para que no se re-descubra desde cero.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Redibujar el documento entero a un PDF limpio** | La propuesta original del humano, descartada por él mismo tras ver el costo. Exige reponer todo lo que la extracción tira (Contexto §4), re-embeber fuentes subseteadas, y decidir qué hacer con imágenes, tablas, sellos y vectores. Y en su forma con texto real reabre ADR-004/ADR-009: la no-recuperabilidad dejaría de ser estructural. Es el "modo texto preservado" de `Version_2.0.md:41`, con ADR y research propios. |
| **Solo shrink-to-fit (§1), sin repintado** | Cierra el defecto pero `[PRS-01]` sobre "Ana" queda en 4px: correcto e ilegible. Resuelve la superposición y no el problema que la superposición causaba. |
| **Extraer `fontName`, tamaño y color del PDF para redibujar fiel** | El color no está en `getTextContent()` — hay que rastrear el estado gráfico con `getOperatorList()`, que es caro y frágil. Y deja los escaneados afuera por construcción (Contexto §5), obligando a dos motores de repintado. El muestreo de píxeles (§4) da mejor resultado por menos. Queda como escalón de mejora, no de entrada (§11). |
| **Re-maquetar la línea como un string continuo** | Acumula el error de calibración a lo largo del renglón y destruye el espaciado del texto justificado. El reposicionamiento por palabra (§2) evita las dos cosas al precio de nada. |
| **Reflow al párrafo** | `Page.words` no tiene noción de párrafo (Contexto §4); habría que inferirla. Y un párrafo que refluye puede cambiar de altura, empujar el contenido de abajo y en el límite repaginar — con lo que los bboxes del panel `original` dejan de corresponder con los del `anonymized`, que es la premisa del visor lado a lado. |
| **Expandir el bbox hacia el espacio en blanco vecino** | Es un caso particular de §2 (que corre las palabras, no solo se come el hueco) con menos alcance. Como pieza independiente obligaba a agregar un campo de layout a `Replacement` para nada. Subsumida. |
| **Repintar siempre que la línea tenga un reemplazo, entre o no** | Más consistente en teoría (no habría líneas "mitad original mitad repintada"), pero paga costo y riesgo de costura en el caso mayoritario, donde no hacía falta. El humano eligió explícitamente "solo cuando no entra". |
| **Bloque opaco donde no se puede repintar bien** | Nunca queda ilegible, pero pierde la información de qué tipo de dato era, que es exactamente lo que el modo `placeholder` existe para conservar. Convierte un problema de estética en una pérdida de información. |
| **Extraer las palabras con `getTextContent()` en el worker, sin cambio de contrato** | Rompe el caso escaneado (§5) y duplica en `render-engine` una responsabilidad de `pdf-engine`. |
| **Umbral de aviso en píxeles absolutos** | El preview y el export renderizan a escalas distintas, así que un piso en px haría que discreparan sobre si hay que avisar sobre el mismo reemplazo. La razón es invariante a la escala (§7). |
| **Avisar en todo fallback, sin umbral** | Se enciende en medio documento y el usuario aprende a ignorarlo. Una señal que aparece siempre no es una señal. |

## Consecuencias

**Positivas**: el derrame desaparece de forma garantizada y por una sola pieza chica y aislada (§1); en el caso mayoritario —texto de cuerpo alineado a la izquierda— el documento anonimizado pasa a leerse como un documento en vez de como un parche encima de otro; los escaneados obtienen exactamente el mismo tratamiento que los PDFs de texto, sin código propio (Contexto §5); los fondos de color y sombreados dejan de recibir un parche blanco (§4); ADR-004 y ADR-009 quedan intactos, así que no se toca la columna vertebral de seguridad del producto; y el usuario recibe una señal accionable sobre una palanca que ya existía y era invisible (§7).

**Negativas**: se rompe un contrato público del Core (`RenderPagePayload`, `AnnotationKind`), con el churn de fixtures y tests que eso implica; el criterio de aceptación de la pieza cara es **visual y no automatizable** (§11), así que su calidad real solo se conoce probando con documentos de verdad; el kernel gana complejidad sustancial —calibración, muestreo, inferencia de línea y de alineación— en una función que hoy tiene veinte líneas; `getImageData` fuerza lecturas del backing store, acotadas a las líneas repintadas pero no gratis, sobre un pipeline que ADR-053 ya encareció con `disableFontFace: true`; el texto a 180° es un gap residual reconocido (§6); y las condiciones conservadoras de §6 implican que en documentos con mucha tabla o mucho texto centrado el repintado casi no se va a activar, y el resultado va a ser el de §1 con avisos.

**Neutras**: `redact` no cambia en absoluto. El cache LRU, el supersede por escala (ADR-037 §4), el reparto host/worker (ADR-043) y las opciones de fuentes/CMaps (ADR-053) quedan tal cual; la clave del cache ya incorpora `hash(replacements ++ annotations)`, así que la anotación `Degraded` participa de la invalidación sin cambios. `Replacement` y `pdf-engine` no se tocan.

## Docs actualizados por este ADR

- `architecture/03_Data_Model.md` §18 (`RenderPagePayload.lineWords`).
- `core/Contracts.md` §5 (`AnnotationKind.Degraded`), §6 (`DEGRADED_FONT_RATIO`).
- `core/Render_Engine.md` → v1.9.0: nota de cabecera, §2, §6, §9, §13 (casos 4/5/6 reescritos; casos nuevos 25-28), §14, §15.
- `core/Orchestrator.md` — la función pura de selección de §5 y su enganche (mismo lugar donde vive el reparto de `fuseOcrPage`).
- `ui/Components.md` y `ui/UX_Guidelines.md` — la marca de degradación en el árbol de entidades y su acceso a editar el token.
- `roadmap/MVP.md` §4 — bloque del Hito 10.5, pasos 1, 3 y 4.

## Validación

- Los tests de §10 verdes, en particular el **test de propiedad de §1**: es el que representa la garantía y el único que no puede quedar en amarillo.
- Verificación manual de §11 en browser real, con los cuatro documentos.
- Verificación de no-regresión: una página donde todos los tokens entran produce el **mismo raster** que antes de este ADR (§2, el camino actual se conserva).
- Grep de control: ningún `fillText` en el kernel sin ancho disponible acotado.
- Grep de control: `REPLACEMENT_BG_COLOR`/`REPLACEMENT_TEXT_COLOR` dejan de usarse como constantes fijas en el camino de §2 (§4).
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`, más `pnpm test:e2e`.

## Referencias

- `core/Contracts.md` §5, §6 — `core/Render_Engine.md` §6, §9, §13 — `core/Orchestrator.md` — `core/PDF_Engine.md`
- `architecture/05_Worker_Architecture.md` §7.4 — `architecture/07_Performance_Strategy.md` §11.4
- `adr/ADR-004` — `adr/ADR-009` — `adr/ADR-012` — `adr/ADR-020` §1, §2 — `adr/ADR-041` — `adr/ADR-043` §2 — `adr/ADR-053` §2, §3 — `adr/ADR-057` §5, §6, §7
- Código: `packages/anonymization-core/render-engine/src/worker/kernel.ts` (`paintReplacements`, `fontForMode`, `paintAnnotations`, `renderPageOntoContext`) — `packages/anonymization-core/pdf-engine/src/pdf.engine.ts` (`convertTextItemsToWords`, `sortWordsByReadingOrder`) — `packages/anonymization-core/src/orchestrator.ts` (`renderMediatedPreview`, llamadas a `buildPageReplacements`) — `packages/anonymization-core/shared/src/types.ts` (`RenderPagePayload`, `Word`) — `packages/anonymization-core/shared/src/enums.ts` (`AnnotationKind`)
