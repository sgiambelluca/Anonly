<!-- CONTEXT: scope=roadmap-handoff | dependencias=roadmap/MVP.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-064-Palabras-De-OCR-En-Puntos.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md | audiencia=humanos+IA | fase=10.8 -->

# Hito 10.8 — Handoff: estado, síntoma abierto y diagnóstico

> Documento de traspaso para retomar el hito en una sesión nueva. Escrito 2026-08-10, con el hito **code-complete y todos los gates en verde**, pero con un síntoma reportado en prueba manual que **no** está resuelto.

## 1. De dónde salió el hito

Prueba real de la herramienta sobre una pericia judicial (5 páginas, expediente PP-13-00-027653-24/00). Una página se anonimizaba mal de dos formas independientes, y la investigación destapó tres defectos más. Los cinco se arreglaron en este hito; el sexto es el que sigue abierto.

## 2. Qué se hizo, y está verificado

| ADR | Qué resuelve | Estado |
|---|---|---|
| **ADR-063** | El bbox de texto rotado salía con las dimensiones intercambiadas: una franja de 173×16 pt horizontal donde el texto ocupa 16×173 vertical. Se deriva de la matriz completa. | ✅ implementado |
| **ADR-064** | Las palabras de OCR entraban en **píxeles** del raster donde el modelo exige puntos (factor 4,17× a 300 DPI). En toda página escaneada la censura caía fuera de lugar. | ✅ implementado |
| **ADR-065** | `requiresOCR = words.length === 0`: una sola palabra nativa dejaba la página fuera de OCR. El 55% de la página 1 —una imagen con datos de una persona— nunca se escaneaba. Compuertas + OCR **por región**. | ✅ implementado |
| **ADR-066** | El texto de las anotaciones (firma digital) era invisible: `getTextContent()` no lee appearance streams. Se extrae nativo, sin OCR. Y el reemplazo sobre bbox rotado se pinta rotado. | ✅ implementado |

**Gates al cierre**: `pnpm lint` limpio, `pnpm typecheck` OK, **1165 tests** en 81 archivos, **242 contract**. Rama `feat/hito10.8-texto-rotado-ocr-parcial`, **24 commits sin pushear**.

Lo que el humano confirmó que **sí** funciona tras las pruebas: el texto que estaba como imagen bajo la firma ahora se detecta.

## 3. El síntoma abierto

> "Sigue sin escanear el texto que está en la firma digital, no detecta ni la fecha, ni el nombre ni otros datos."

## 4. Diagnóstico — LEER ESTO ANTES DE TOCAR NADA

**El `pdf-engine` funciona. Está verificado ejecutando el motor real contra el PDF real, sin mocks.** Resultado:

```
words totales=47 | con rotation=26
rotadas: "E13000013835753"@90° | "CCS"@90° | "Público"@90° | "Ministerio"@90° |
"SIMP.Penal.API"@90° | "Informático"@90° | "Sistema"@90° | "Milagros"@90° |
"SIMP"@90° | "electrónica"@90° | "12:30:18"@90° | "-"@90° | "los"@90° |
"SIMP"@90° | "de"@90° | "Argentina"@90° | "by"@90° | "Rocio"@90° |
"07/07/2026"@90° | "signed"@90° | "Firma"@90° | "Albarracin,"@90° |
"Digitally"@90° | "Location:"@90° | "Reason:"@90° | "Date:"@90°

¿aparece el apellido del firmante en page.text?: true
¿aparece la fecha 07/07/2026 en page.text?:      true
```

O sea: **la extracción de anotaciones y el poblado de `rotation` andan**. El problema está aguas abajo del motor, o en el build.

### Actualización tras la segunda prueba manual — LO MÁS IMPORTANTE

El humano **rebuildeó y volvió a probar**. Resultados nuevos, que descartan la hipótesis (1) y precisan el resto:

- **La detección FUNCIONA.** La fecha de la firma aparece en la lista de entidades de la UI.
- **El reemplazo `redact` NO la tapa.** El texto de la firma se ve igual en el panel anonimizado.

Diagnóstico ejecutando `PdfEngine` + `RegexEngine` reales sobre el PDF real:

```
ocurrencias en pág 1: 2
  [PHONE] "00-027653"   bbox=(140.8,112.6) 71.6×8.2   rotation=—
  [DATE]  "07/07/2026"  bbox=(28.9,721.6)   8.0×37.9   rotation=—
```

**Bug verificado nº1 — `rotation` se pierde al construir la `Occurrence`.** El `Word` tenía `rotation: 90` (verificado arriba); la `Occurrence` sale con `rotation` **ausente**. La causa es `mapSpanToWords` (`regex-engine/src/regex.engine.ts`, ~línea 185): **construye un `BoundingBox` nuevo** a partir de min/max escalares en vez de propagar el original, así que el campo se cae en silencio.

Esto **falsifica la premisa de ADR-066 §6**, que justificaba poner `rotation` en `BoundingBox` diciendo: *"es lo que viaja por la cadena `Word → Occurrence → Replacement` sin tocar tres tipos: `mapSpanToWords` une bboxes y el campo viaja con ellos"*. **No viaja.** Consecuencia: el pintado rotado de ADR-066 §7 **nunca se activa**, porque `bbox.rotation` siempre llega `undefined` al render.

Arreglo: propagar `rotation` en `mapSpanToWords` (decidir qué hacer si las palabras del match tienen rotaciones distintas — en la práctica comparten una) y revisar el camino equivalente de `ner-engine`. Es `regex-engine`, un módulo.

**Lo que ESTE bug no explica.** `redact` ignora la rotación: rellena el rectángulo y nada más. Y el bbox de la ocurrencia es **geométricamente correcto** —(28.9, 721.6) 8×37.9 es la franja vertical donde está la fecha, dentro del rect de la anotación—. Además el orden de dibujo es el correcto: `kernelRenderPage` hace `pageProxy.render()` primero y `paintReplacements()` después, así que la caja va **encima**. Y `buildPageReplacements` (`export-engine`) solo filtra grupos con `enabled === false`.

O sea que **queda una segunda causa sin identificar** entre "la ocurrencia existe con el bbox correcto" y "la caja negra no aparece". Próximo paso concreto: instrumentar qué devuelve `buildPageReplacements(0, snapshot.groups)` con el grupo en `redact` — si el `Replacement` está ahí con ese bbox, el problema es del kernel; si no está, es del snapshot de Grouping o del estado `enabled` del grupo.

**Hallazgo lateral que explica "aparecen tres fechas".** El número de expediente `PP-13-00-027653-24/00` produce un falso positivo `[PHONE] "00-027653"`. Los patrones numéricos de `default-ar.ts` están matcheando partes del número de causa. No es del hito; sumar a los pendientes.

### Hipótesis restantes

**(1) ~~Build viejo en la app.~~ DESCARTADA** — el humano rebuildeó y el síntoma persiste.

**(2) El orden de lectura destruye el nombre.** Este sí es un defecto real y explica **el nombre, pero no la fecha**. Mirá el orden en que salen las palabras rotadas arriba: los cinco runs de la firma están **intercalados entre sí y cada uno invertido**. "Albarracin, Rocio de los Milagros" aparece disperso como `… Milagros … los … de … Rocio … Albarracin,` con palabras de otros runs en el medio.

La causa es aritmética y está en `sortWordsByReadingOrder` (`pdf.engine.ts`), que ordena por `bbox.y` asc y luego `bbox.x` asc: para texto a 90° que avanza en `+y` de espacio PDF, el token N+1 tiene **mayor** `y` de usuario, o sea **menor** `y` arriba-izquierda, así que ordenar por `y` ascendente **invierte el run**.

Ningún NER puede reconocer un nombre con las palabras al revés y entremezcladas. **La fecha, en cambio, es un solo token (`07/07/2026`) y sobrevive intacta a la inversión** — por eso esta hipótesis no explica que la fecha tampoco se detecte, y por eso (1) sigue siendo la primera sospechosa.

Esto es exactamente el hueco que **ADR-063 §4** difirió, dos veces, con el argumento de que "el texto vertical nunca se concatenó bien". Ese argumento era válido cuando el único texto rotado era la marca de agua —dos tokens, donde invertir casi no daña— y **deja de valer** con un run multi-palabra. Cerrarlo requiere orden por columnas, que cambia un invariante compartido con `ocr-engine` y `03_Data_Model.md`: dos motores más, ADR propio.

**(3) Algo entre el motor y la detección.** Si tras (1) la fecha sigue sin aparecer, el siguiente paso es instrumentar el façade: verificar que `Page.words` que llega a Regex tiene las 47 palabras, y que `page.text` conserva `07/07/2026`.

### Cómo reproducir el diagnóstico

Un test temporal en `tests/` que importe `PdfEngine` del **source**, con `pdfjs-dist` **sin mockear**, y procese el PDF real. Es lo que produjo la salida de arriba. Borrarlo después: lee un documento con datos sensibles y no debe commitearse.

## 5. Lo que NO hay que rehacer

- No volver a intentar OCR para la firma. Es texto nativo y exacto; OCR-earlo sería fotografiar algo que ya tenemos (ADR-066, Alternativas).
- No volver a la contención estricta del `rect` de anotación. El word real se sale 0,66 pt por el ascenso del glifo y se descartaban los cinco runs (ADR-066 §3, bloque "Corrección").
- No tocar `requiresOCR`, `textlessPages` ni `sourceKind` (ADR-065 §10).
- No regenerar el snapshot de `pdf-engine`: si cambia, se rompió texto horizontal.

## 6. Nota de método

En este hito hubo **siete ambigüedades reportadas por implementadores, y las siete resultaron ser errores de especificación del planificador**, no del implementador. Dos de ellas habrían dejado la feature sin efecto en silencio, con los tests en verde:

- El decoder validaba 4 de 5 campos de `PdfEngineOutput`.
- El guard del `rect` de anotación descartaba el texto real por 0,66 pt — y el implementador lo tapó ensanchando un fixture. Se detectó **leyendo las decisiones que reportó**, no por los tests.

Dos prácticas que valieron la pena y conviene sostener: **medir antes de escribir un ADR** (dos métricas de la compuerta de OCR se falsificaron así antes de llegar al código), y **correr los cuatro gates desde el coordinador**, sin delegarlos — un implementador con alcance de un módulo no ve lo que rompió afuera.
