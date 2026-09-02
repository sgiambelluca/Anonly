<!-- CONTEXT: scope=roadmap-handoff | dependencias=roadmap/Post_Hito10.8_Pendientes.md,core/PDF_Engine.md,core/OCR_Engine.md,architecture/03_Data_Model.md,adr/ADR-064-Palabras-De-OCR-En-Puntos.md,adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md,adr/ADR-090-La-Orientacion-De-Un-Escaneo-Se-Detecta.md,adr/ADR-108-El-Avance-De-Un-Espacio-Incluye-El-Word-Spacing.md,adr/ADR-109-La-Caja-De-Una-Palabra-Es-Su-Caja-De-Tinta.md,adr/ADR-110-El-Renglon-Es-Un-Grupo-No-Una-Coordenada.md,adr/ADR-111-El-Token-Que-No-Es-Entidad-Tambien-Entra-Al-Agregador.md,adr/ADR-112-El-Sello-No-Es-Un-Parrafo.md,adr/ADR-113-El-Renglon-Se-Corta-Donde-Hay-Una-Columna.md,adr/ADR-114-La-Seleccion-Del-Mouse-Es-De-Un-Renglon.md,adr/ADR-115-La-Puntuacion-Pegada-No-Es-Parte-Del-Valor.md,adr/ADR-116-Un-Valor-Que-El-Documento-Ya-Confirmo-No-Se-Descarta.md,adr/ADR-117-Una-Ocurrencia-Contenida-No-Aporta-Tinta.md,adr/ADR-118-La-Clave-De-Agrupado-Tiene-Una-Sola-Definicion.md | audiencia=humanos+IA | fase=11 -->

# Documentos escaneados — Handoff: qué se cerró, qué queda y cómo medirlo

> Documento de traspaso para retomar el tema en una sesión nueva. Escrito el 2026-08-30 con ADR-108/109/110 cerrados; **§3 reescrito el 2026-09-02** tras medir el fallo escaneado entero con el pipeline real, y con **ADR-111 implementado y los gates en verde**.
>
> **Estado en una línea**: el texto nativo quedó bien y está medido; del escaneo se cerraron el agregador del NER (ADR-111), la lectura del sello (ADR-112), el orden de sus dos columnas (ADR-113), la selección manual con el mouse (ADR-114) la clave de agrupado de las ocurrencias manuales (ADR-115), lo que se hace con una detección dudosa cuyo valor el documento ya confirmó (ADR-116) y lo que se hace con una ocurrencia contenida dentro de otra (ADR-117). Sigue abierto el **texto rotado dentro de una página derecha** (§3.5) y **qué entidad cubre el sello** (§3.6).

> **Los nombres de este documento son ficticios.** El expediente sobre el que se midió es real y no se transcribe acá (`08_Security_Model.md` §10.2: nada de contenido de documento fuera de RAM, y una herramienta de anonimización no es lugar para datos de una causa penal). Los reemplazos **preservan largo y cantidad de diacríticos**, porque varias distancias citadas son Levenshtein normalizado por longitud: con otro nombre, el número dejaría de verificar. Precedente: ADR-084.

## 1. De dónde salió

Prueba real de la herramienta sobre dos familias de documento:

- **Texto nativo** (pericias, apelaciones, oficios, un fallo de la SCBA): la caja de cada palabra quedaba corrida y dejaba letras a la vista. **Cerrado** — ADR-108 y ADR-109.
- **Escaneado** (un fallo del Tribunal de Casación Penal, sin capa de texto, procesado por OCR): el reemplazo del nombre del imputado —que está en la **columna derecha** del encabezado— se pintaba sobre el escudo y el `PROVINCIA DE…` de la **izquierda**. **Mejorado, no cerrado** — ADR-110.

## 2. Lo que se cerró, con sus números

| ADR | qué era | medido |
|---|---|---|
| **ADR-108** | el flujo de glifos no aplicaba `Tw`, y aplicárselo a todo espacio tampoco servía: lo lleva el glifo con `glyph.isSpace` (PDF 32000-1 §9.3.3), la misma bandera con la que decide el renderer de pdf.js | fuga de tinta por izquierda **965 → 7** palabras en una pericia; cajas completamente fuera del dato **13 → 2** |
| **ADR-109** | la caja iba de la línea de base **hacia arriba**, así que las descendentes quedaban afuera en una de cada tres palabras | palabras con tinta bajo la caja **30,1 % → 0 %** donde la medición es limpia |
| **ADR-110** | el orden de lectura usaba un comparador **con tolerancia**, que no es transitivo | pares consecutivos preservados en un escaneo **67,5 % → 100 %** (página 1); texto nativo **idéntico** en 109 páginas |

Los tres están en `fix/calidad-de-deteccion`, con tests que se verificaron **en las dos direcciones** (fallan si se revierte el mecanismo).

## 3. Lo que sigue abierto

> **Actualización 2026-09-02.** Esta sección se reescribió entera después de una campaña de medición sobre el fallo escaneado completo (20 páginas) con el pipeline real: OCR de verdad → `sortWordsByReadingOrder` del motor → patrones de `default-ar.ts` → kernel de NER con el modelo local. Las hipótesis de la versión anterior —DPI y binarizado— **se midieron y son falsas**; la causa era otra. Los defectos encontrados están cerrados (ADR-111 a ADR-114); lo que queda abierto es el texto rotado (§3.5), qué entidad cubre el sello (§3.6) y dos huecos de patrón (§3.3).

### 3.1 El sello del encabezado: era el modo de segmentación de página de Tesseract

**El síntoma medido.** Sobre las 19 páginas con texto, el nombre del imputado sale del OCR así:

```
p2   casera, BARTOLOME ARTURO / RECURSO DE     ← apellido perdido
p3   suarna, bArtoLomE ARTURO / RECURSO DE     ← nombre y apellido perdidos
p12  sez, BARTOLOME Uses / RECURSO DE
p15  suarez, BARtoLome ARTURO §1 RECURSO DE
```

y el `IPP NNNN-NNNN-NN` desaparece en 17 de 19 páginas. **La causa**: con el modo default (`AUTO`), Tesseract **fusiona en una sola caja de línea** dos renglones impresos del sello que están muy juntos —`IPP NNNN-NNNN-NN` encima de `SUAREZ, BARTOLOME ARTURO S/ RECURSO DE`—, y el reconocedor devuelve basura para la parte izquierda. Es la explicación de las cajas con 60 % de diferencia de alto que §5 de ADR-110 reportaba sin explicar: **son cajas de dos renglones**.

**Lo que se descartó, con número:**

| palanca | resultado | conclusión |
|---|---|---|
| DPI 200 (nativo del escaneo) | 59/114 ítems del encabezado | |
| **DPI 300 (hoy)** | **57/114** | el DPI **no es la palanca**. El raster embebido es de 1656×2339 px sobre 595×842 pt = **200 DPI reales**, así que 300 ya interpola y 400 interpola más |
| DPI 400 | 58/114 | |
| binarizado Otsu global, 300 DPI | 57/114, **idéntico** | Tesseract ya binariza internamente; no hay nada que ganar afuera |

**Lo que sí es la palanca: `tessedit_pageseg_mode`.** Medido sobre las 19 páginas, contra la transcripción a mano del sello:

| ítem del sello | default (AUTO) | PSM 4 (columna única) | **PSM 11 (texto disperso)** |
|---|---|---|---|
| nº de causa `NNNNNN` | 19/19 | 19/19 | 19/19 |
| `IPP NNNN-NNNN-NN` | 2/19 | 18/19 | **18/19** |
| apellido `SUAREZ,` | 9/19 | 19/19 | **19/19** |
| nombres `BARTOLOME ARTURO` | 8/19 | 18/19 | **18/19** |
| `S/` | 3/19 | 14/19 | **17/19** |
| `PROVINCIA DE BUENOS AIRES` | 16/19 | 5/19 | **18/19** |
| **total** | **57/114** | 93/114 | **109/114** |

Punta a punta, con el pipeline de detección entero: el apellido del imputado pasa de detectarse en **9/19 páginas a 19/19**, y los nombres de **8/19 a 19/19**.

#### ¿PSM 11 no mete más ruido? Medido en tres frentes

**(a) Documentos comunes — verdad sintética.** Siete PDFs nativos rasterizados a 300 DPI y pasados por OCR, comparando contra su propio texto nativo (35 páginas, 11.403 palabras). La **precisión** es la métrica que contesta "cuánto ruido inventa":

| PSM | recall | precisión | palabras sobrantes conf<60 | sobrantes conf≥60 |
|---|---|---|---|---|
| default | 96,29 % | 96,02 % | 104 | 351 |
| **11** | 96,26 % | **96,50 %** | **67** | 331 |
| 4 | 96,13 % | 96,20 % | 77 | 356 |

Sobre páginas normales PSM 11 **inventa menos**, no más: 35 % menos palabras espurias de baja confianza, con el mismo recall.

**(b) El sello del escaneo real** — donde sí hay más palabras de ruido, porque está el código de barras:

| encabezado, 19 páginas | default | PSM 11 |
|---|---|---|
| palabras leídas | 406 | 559 (+38 %) |
| ruido (fuera del vocabulario del sello) | 115 (28,3 %) | 166 (**29,7 %**) |
| ruido con conf<50 | 70 | 135 |
| **área** de página cubierta por ruido | 70.024 pt² (36,6 %) | **52.117 pt² (33,5 %)** |
| cuerpo: palabras con conf<50 | 14 | **11** |
| `SUAREZ, BARTOLOME ARTURO` contiguo en el orden de lectura | 5/9 | **18/19** |
| entidades en el encabezado | 48 | 64 |
| **entidades hechas SOLO de ruido** | **4** | **4** |

Las tres lecturas que importan: la **proporción** de ruido casi no se mueve (28,3 % → 29,7 %) mientras el motor lee 38 % más palabras —o sea, lo que entra de más es sobre todo texto real que AUTO no leía—; el **área** que ocupa el ruido **baja**, porque PSM 11 parte el código de barras en muchas cajas chicas en vez de pocas grandes; y **las entidades espurias no aumentan**, que es lo único que el usuario ve. Una `Word` de ruido que ninguna entidad cubre no dibuja ninguna caja y es invisible.

**(c) Texto rotado** (`tests/fixtures/qa-stamp.pdf`, con sellos a 90° y 270°, rasterizado y pasado por OCR):

| | default | PSM 11 |
|---|---|---|
| recall | 79,5 % | 75,3 % |
| **precisión** | 56,9 % | **98,2 %** |
| palabras inventadas | 44 | **1** |

**Hallazgo aparte, y no es de PSM**: *ninguno de los dos modos lee el texto rotado*. Las 15 palabras que faltan con AUTO incluyen las 12 del sello a 90°/270° (`Juan Pérez`, `PERITO CARLOS LOPEZ`, `DNI 42.998.103`), y con PSM 11 son las mismas. Ver §3.5.

**Costo de PSM 11**: +8 % de tiempo de OCR por página (3.150 ms → 3.388 ms medidos), y 3 palabras menos en `qa-stamp` (una real, `455.`, y dos rayas). **Adoptado — ADR-112**, con los gates en verde.

### 3.2 El agregador BIO del NER — CERRADO por ADR-111

Dos defectos, los dos reproducidos sobre el mismo fallo escaneado y medidos sobre 8 documentos / 115 páginas antes de tocar código:

- **Tres párrafos como una sola persona.** `TokenClassificationPipeline._call` de @huggingface/transformers default a `ignore_labels: ['O']` y el kernel nunca le pasó opciones: trabajaba con **21 de 466 tokens**. Sin los `O`, `aggregateTokensToSpans` no ejecuta nunca su rama de cierre y el cursor de `positionTokens` se queda sin anclas — una `Person` de **785 caracteres**.
- **Entidades partidas a mitad de palabra**: `Florencio Varela` → `"Floren"` + `"cio Varela"`; `CARRAL` → cuatro entidades.

Resultado: spans de más de 40 caracteres **19 → 3** (los 3 restantes son nombres largos legítimos de organismos), spans cortados a mitad de palabra **48 → 0**, sin costo de tiempo medible. Ver ADR-111 y `NER_Engine.md` §13 casos 23-25.

### 3.2b Las dos columnas del sello y la selección manual — CERRADOS por ADR-113 y ADR-114

Los dos salieron de usar la herramienta con ADR-112 ya aplicado.

- **`ARTURO RECURSO DE SUAREZ` como una sola `Person`** (1 de 19 páginas). La banda de ADR-110 se deriva de la mediana de altos del renglón vigente, y la columna izquierda del sello (8,6 pt) alcanza a la derecha (6,0 pt), que está 4,08 pt más abajo — contra una banda de 4,32, y la palabra siguiente a 4,32 exactos: **lo decide el redondeo binario**. Ninguna medida vertical más fina sirve, porque un escaneo tiene desviación: dos variantes medidas arreglan el sello y rompen el cuerpo en palabras de caja chica (`con`, `por`, `que`, el guion de una firma). El hueco horizontal sí es inequívoco: 113,5 pt contra 2,4–13 entre palabras de una frase. **ADR-113**: cortar el renglón por hueco y volver a unir los trozos **pegados**. Medido: pares preservados 96,9 → **97,3 %** (solo cuerpo, 99,6 → **99,8 %**), sello entero 16/19 → **17/19**, texto nativo idéntico en 110 páginas.
- **La selección con el mouse no reconocía nada.** El matcher literal encuentra `TRIBUNAL DE CASACIÓN PENAL` en **18/18** páginas si el valor está bien armado; con 4 pt de holgura en el arrastre el valor sale con el renglón de arriba pegado y encuentra **0/18**, porque un valor de dos renglones no existe en el documento. Y el overlay no daba ninguna señal: `void addManualEntity(...)`, promesa suelta. **ADR-114**: recortar al renglón dominante (por área seleccionada) y mostrar el resultado.

### 3.2c Un apellido en cuatro grupos — CERRADO por ADR-115

Agregar a mano el apellido del imputado abría **cuatro grupos**: `suarez`, `suarez,`, `“suarez,` y `suarez.`. `normalizedValue` es la clave de agrupado y se calculaba **distinto según qué detector encontró la ocurrencia** — `ner-engine` recorta la puntuación de borde, `normalizeForComparison` (la vía manual) no. Y la puntuación llega pegada por diseño: `Page.words` separa por whitespace y un match manual entra con las palabras enteras (ADR-089 §3). El pase difuso no las junta: contra `suarez` dan **0,857 y 0,750**, bajo el umbral de 0,88. **ADR-115**: `normalizeEntityValue` en `@anonly/shared`. Medido sobre las 60 ocurrencias de "Suarez" del documento: **7 grupos → 4**.

Los 4 que quedan (`suarez`, `bartolome arturo suarez`, `mariela suarez`, `leonardo suarez`) son valores genuinamente distintos y **está bien que sigan separados**: `Mariela Suarez` es otra persona, y un motor que adivinara a cuál se refiere un `Suarez` suelto anonimizaría a la equivocada.

**Cerrado por ADR-118**: `ner-engine` tenía su propia función, que recortaba bordes pero **no sacaba diacríticos**, así que `muñíz` (NER) y `muniz` (manual) daban claves distintas — **0,600**, muy por debajo del umbral. Medido sobre 683 ocurrencias: de **108** con diacríticos, 85 las rescataba el pase difuso y **23 se partían**. La pregunta inversa también se midió y da cero: unificar **no colapsa nada** (247 claves distintas antes y después, 0 colisiones nuevas), porque dentro de la salida del propio NER no conviven dos variantes acentuadas del mismo valor — todo el efecto es cruzado contra la vía manual, que es donde estaba el hueco. El kernel pasó a usar `normalizeEntityValue` de `@anonly/shared`: no se le agregó un paso, las dos pasaron a ser **la misma función**.

### 3.2d Una página de veinte sin tapar, y las diez ocurrencias de más — CERRADO por ADR-116 y ADR-117

Dos defectos distintos que salieron del mismo síntoma.

**ADR-116** — en la página 6 el apellido seguía a la vista con el sello leído al 96 %, el orden correcto y la caja bien mapeada: el NER lo detectaba con **0,612** contra un umbral de 0,7, y `handleLowConfidence` emitía el conflicto y **volvía sin registrar**, aunque el grupo `suarez` ya existía por las otras diecinueve páginas. Ahora, con clave **exacta**, la ocurrencia entra (el conflicto se sigue emitiendo). Medido sobre 8 documentos: de 54 ocurrencias bajo el umbral, **9** entran por clave exacta y **0** llegaban por el pase difuso.

**ADR-117** — agregar el apellido a mano llevaba el grupo de 24 a **34**, y las 10 de más **no eran datos sin tapar**: eran el apellido arrancado de adentro de `Bartolomé Arturo Suarez`, `Mariela Suarez` y `Leonardo Suarez`, con lo que el apellido de tres personas distintas terminaba compartiendo token en el export. `findOverlapConflict` saltea los pares del mismo tipo y el dedup exige bbox idéntico, así que no lo frenaba nadie. Ahora una ocurrencia **contenida entera** en otra del mismo tipo no se registra. Medido: el pipeline automático produce **1** contención en 763 ocurrencias (basura), y **0** solapamientos parciales del mismo tipo — la contención es un artefacto del barrido literal, no del detector.

**Lección de método**: la pregunta del humano ("¿qué eran esas ocurrencias extra?") valía más que el síntoma. Contarlas una por una mostró que el salto de 24 a 34 no agregaba cobertura, agregaba ambigüedad.

### 3.3 Dos huecos de detección que el escaneo dejó a la vista

**(a) El número de causa y el IPP no tienen patrón.** `Causa n° NNNNNN` e `IPP NNNN-NNNN-NN` aparecen en el encabezado de las 19 páginas y en el cuerpo, y se detectan **0/19**. Es `Post_Hito10.8_Pendientes.md` §26, que ya lo tenía anotado desde una pericia distinta; este documento **agrega dos formas** a la tabla de formas relevadas: `IPP NNNN-NNNN-NN` y `Causa n°/N° NNNNNN`.

**(b) `caratula-ar` está muerto en caja alta.** El patrón exige `\p{Lu}\p{Ll}+` de los dos lados de la coma y un `s/`/`c/` en **minúscula**. Una carátula de expediente se escribe `SUAREZ, BARTOLOME ARTURO S/ RECURSO DE CASACIÓN`. Medido: **0 matches en las 20 páginas**, incluida la línea del cuerpo `caratulada "SUAREZ, BARTOLOME ARTURO S/ RECURSO DE CASACIÓN"`, donde el ancla `caratulada` está pegada. Hoy lo salva el NER, pero el camino determinista está apagado justo sobre el formato de los sellos y las carátulas.

### 3.4 Residuos chicos ya identificados

- **2 cajas fuera de toda tinta** en una pericia: los tokens `/` y `D` de la línea `S ____/____ D` del encabezado. No son un dato.
- **8 items del sello de notificación electrónica de un fallo** (empalme 90,6 %, el único documento que no llega a 100 %). Uno contiene un nombre. `Post_Hito10.8_Pendientes.md` §24.
- **El fixture de `snapshot.test.ts` no declara `styles`**, así que el camino de la caja de tinta de ADR-109 no está cubierto por ninguna snapshot. `PDF_Engine.md` §15 ítem 29.
- **§25 (§23g)**: el token de reemplazo se dibuja ~30 % más chico que el texto que lo rodea.
- **El código de barras produce una entidad espuria** en 1 de 19 páginas. Es un falso positivo visible y desactivable de un clic; se deja.
### 3.5 Un sello rotado dentro de una página derecha no lo lee nadie — abierto, con una salida medida

**Por qué OSD no lo resuelve, aunque suene a que debería.** `worker.detect()` (ADR-090) contesta *una* pregunta: **¿está torcida la página?** Devuelve un `orientation_degrees` para la hoja entera, y el kernel rota el raster completo antes de reconocer. Eso arregla un escaneo hecho de costado — todo su texto de una vez.

Un sello a 90° en el margen de una página **derecha** es otro problema: para enderezar el sello habría que girar la hoja, y ahí el cuerpo queda de costado. OSD, además, contesta bien: la orientación dominante de esa página *es* 0°. Y el buscador de líneas de Tesseract busca líneas de base **horizontales**; una corrida vertical no es una línea, así que no la encuentra. (`PSM.SINGLE_BLOCK_VERT_TEXT` existe, pero asume que la **página entera** es vertical.)

Medido sobre `qa-stamp.pdf` rasterizado: de las 15 palabras rotadas del original, la pasada derecha recupera **2**, con `AUTO` y con PSM 11 por igual.

**La salida, ya medida**: reconocer la misma página **tres veces** —derecha, rotada 90° y rotada 270°— y unir.

| pasada | palabras rotadas recuperadas | palabras totales que devuelve |
|---|---|---|
| derecha (hoy) | 2/15 | 56 |
| **90°** | **11/15** — `JUZGADO CIVIL 12 — PERITO CARLOS LOPEZ — DNI 42.998.103` | 23 |
| **270°** | **7/15** — `Folio 214 — Juan Pérez` | 24 |
| **unión de las tres** | **15/15** | — |

Costo: **1.664 ms → 3.846 ms por página** (2,3×).

**Las piezas ya existen y están probadas**: `rotateImageData` y `unrotateBbox` del kernel de OCR (ADR-090 §3/§4, con tests que verifican que son inversas), `bbox.rotation` en el contrato de `Word`, el tratamiento de runs rotados del orden de lectura (ADR-067 §2/§3/§4) y el corte de batch por orientación del NER (ADR-088 §1). Lo que falta decidir y **medir** antes de escribir el ADR:

1. **La regla de fusión.** Las pasadas rotadas devuelven 23 y 24 palabras, de las cuales 11 y 7 son del sello; el resto es cuerpo leído de costado y ruido. Candidata obvia: descartar toda palabra rotada cuya caja se solape con una palabra ya encontrada derecha. Sin medir.
2. **Cómo no pagar 2,3× en todo documento.** Candidatas: correr las pasadas extra solo donde la pasada derecha dejó **tinta sin reclamar**, o solo sobre los márgenes (donde viven los folios y los sellos). Las dos agregan maquinaria y constantes que hay que justificar con número.
3. **No hay un escaneo real con sello rotado en el corpus.** `qa-stamp.pdf` es un fixture sintético de `pdf-lib`: sirve para probar que el mecanismo recupera el texto, no para estimar cuánto aparece esto en un expediente de verdad.


### 3.6 Qué entidad cubre el sello — abierto, y es una decisión de producto

`TRIBUNAL DE CASACIÓN PENAL` está bien leído en **18/18** páginas y **ninguna entidad lo cubre en ninguna**. El grupo que aparece habilitado en el panel de Organizaciones nace de una detección en el **cuerpo** de la página 1; habilitar un grupo no sale a buscar más apariciones de su valor.

Causa: `Page.text` se arma con `words.join(" ")`, **sin ningún separador de renglón**, así que el modelo recibe el sello como una oración corrida (`…SUAREZ, BARTOLOME ARTURO S/ RECURSO DE TRIBUNAL DE CASACIÓN PENAL CASACIÓN SALA I…`). Sobre eso etiqueta la persona —que tiene señal léxica fuerte— y nada más.

Tres salidas, con lo que cada una cuesta:

| | qué hace | costo | riesgo |
|---|---|---|---|
| **A** | habilitar un grupo dispara `findLiteral` de su valor canónico | bajo: la maquinaria ya existe (`addManualEntity`) | cambia el significado del check (de "tapá estas N" a "tapá este valor"); un canónico genérico —un `Person` "Juan"— barrería de más |
| **B** | meter un separador de renglón en `Page.text` | **alto**: `Page.text` es contrato y todos los motores asumen `join(" ")` | el beneficio **no está medido**: no se sabe si el modelo mejora con la estructura |
| **C** | no tocar detección y apoyarse en la vía manual, ya arreglada | cero | un arrastre por documento, a cargo del usuario |

**Lo que hay que medir antes de elegir entre A y B**: sobre las 20 páginas, cuántas entidades del sello detecta hoy contra una transcripción a mano. Si lo único que falta es el tribunal, A alcanza; si falta medio sello, la causa es la de B y A es un parche. **Y para saber si A es aceptable**: correr `pnpm test:quality` sobre los 26 documentos de referencia con y sin el barrido, y comparar precisión.

## 4. Cómo reproducir cualquiera de estas mediciones

El harness vive **fuera del repo**, en `~/bbox-harness/` dentro de WSL (si viviera adentro, `eslint`/`typecheck` fallarían). Los documentos de prueba, en `~/bboxdocs/`.

Depende de un archivo generado, porque las funciones internas de `pdf.engine.ts` no se exportan:

```bash
cd ~/Anonly && { cat packages/anonymization-core/pdf-engine/src/pdf.engine.ts; \
  printf '\nexport {\n  convertTextItemsToWords as __convertTextItemsToWords,\n  walkOperatorListForAnnotationsAndImages as __walk,\n  indexGlyphs as __indexGlyphs,\n  findGlyphAt as __findGlyphAt,\n  alignToGlyphs as __alignToGlyphs,\n  sortWordsByReadingOrder as __sortWords,\n  boundingBoxFromParallelogram as __bboxFromParallelogram,\n  sumGlyphAdvances as __sumGlyphAdvances,\n  unitVectorOrDefault as __unitVector,\n};\n'; } \
  > packages/anonymization-core/pdf-engine/src/__internals.gen.ts
```

Desde 2026-09-02 el generador es `~/gen-internals.sh`, que además produce dos archivos más: `regex-engine/src/__internals.gen.ts` (expone `runPattern`, `passesRunGuard`, `resolveOverlaps`, `mapSpanToWords`) y `ner-engine/src/worker/__kernel.gen.ts` — una copia del kernel con `NER_LOCAL_MODEL_PATH`/`NER_WASM_PATH` reescritas a rutas absolutas de WSL, porque en Node `"/models/ner/"` es una ruta del filesystem que no existe y no hay sudo para montarla. Es la única diferencia con el kernel real, y no es lo que se está midiendo.

**Borrarlos todos al terminar**: rompen los gates.

| script | qué mide |
|---|---|
| `escape.ts` | por palabra, cuántos pt de tinta quedan **fuera** de su caja, contra el render real |
| `detect.ts` | OCR real de una página → orden del motor → **detección real** (regex + NER). Es el que reprodujo el span de 785 caracteres |
| `hdr.ts` | ítems del sello recuperados por configuración (`DPI`, `PSM`, `BIN=otsu`), contra la transcripción a mano, más las métricas del cuerpo para que una mejora del encabezado no tape una regresión |
| `ocrprec.ts` | **verdad sintética**: rasteriza PDFs nativos, los pasa por OCR y mide *recall y precisión* de palabra contra su propio texto nativo. La precisión es la que contesta "cuánto ruido inventa esta configuración" |
| `missing.ts` | qué palabras nativas concretas pierde cada configuración, marcando las rotadas |
| `noiseab.ts` | ruido del encabezado del escaneo real: cuánto, con qué confianza, cuánta **área** ocupa, si rompe la contiguidad del nombre y **cuántas entidades produce** |
| `textcache.ts` + `nerab.ts` | cachea el `Page.text` de un documento (nativo u OCR) y después hace A/B del agregador BIO sin volver a hacer OCR: spans, fragmentos (empiezan o terminan pegados a una letra) y gigantes (> 40 chars) |
| `nerdiag.ts` | instrumenta el agregador: cuántos tokens devuelve el modelo, cuántos se ubican, y de dónde sale un span gigante |
| `rotpass.ts` | cuántas palabras rotadas recupera cada pasada (derecha / 90° / 270°) y cuánto cuesta la unión de las tres — §3.5 |
| `readingorder.ts` | orden de lectura. Modo `pdf`: compara el motor contra un prototipo y dice si el texto queda idéntico. Modo `ocr`: corre Tesseract de verdad y compara contra su recorrido `bloque → párrafo → línea` |
| `overlay.ts` / `exp.ts` | dibujan las cajas sobre la página renderizada; `exp.ts` con `REDACT=old\|new` simula el tapado |
| `why.ts` | por qué falla cada empalme (`SIN-ORIGEN` vs `NO-ALINEA`) |
| `vert.ts`, `vert2.ts` | desajuste vertical, interlineado y solapamiento entre renglones |
| `clusters.ts`, `probe.ts`, `flowdump.ts` | tinta real por renglón, mapa ASCII de píxeles, volcado del flujo de glifos |

Los gates y los benchmarks van **siempre en `~/Anonly`** (clon nativo de WSL): `pnpm lint` tarda 32 s ahí contra ~10 min sobre `/mnt/c`.

## 5. Lo que NO hay que volver a perseguir

Cada uno de estos se midió y se descartó. Repetirlos es tiempo perdido.

1. **No es la geometría del bbox.** Las cajas del OCR convertidas a puntos coinciden con la tinta **al sub-punto** (cinco palabras verificadas, la mayor diferencia 0,07 pt). ADR-064 está bien.
2. **No es la conversión px→pt ni `fuseOcrPage`/`fuseOcrRegion`.** Se verificó sobre el mismo renglón que fallaba.
3. **Cambiar la clave de orden no arregla nada.** Las tres candidatas —borde superior, borde inferior, centro— rompen la misma línea de formas distintas. El problema era la **tolerancia**, no la clave. (Y la afirmación de ADR-109 §3 sobre que el borde inferior era "más estable" para OCR era falsa; tiene errata.)
4. **Segmentar en columnas no aporta.** Prototipado, barrido de 0,8 a 4,0 cuerpos y también desactivado por completo: resultados **idénticos**. Con la banda en 0,5 las columnas ya caen en renglones distintos.
5. **Ampliar la tolerancia de `findGlyphAt`** (0,05 pt): descartado por medición en ADR-102 §3 y de nuevo en ADR-108 §3.
6. **Exceptuar los espacios iniciales de un run** de `Tw`: cuesta diez veces más fuga. "Inicial" es propiedad de la operación de dibujo, no del renglón.
7. **Subir el DPI de rasterizado** (2026-09-02): 200/300/400 dan 59/57/58 de 114 ítems del sello. El escaneo embebido es de 200 DPI reales; de 300 para arriba solo se interpola.
8. **Binarizar el raster antes de Tesseract** (Otsu global, 2026-09-02): resultado **idéntico** al de no hacer nada. Tesseract ya binariza internamente.
9. **PSM 4** como alternativa a PSM 11: arregla la columna derecha del sello pero rompe la izquierda (`PROVINCIA DE BUENOS AIRES` cae de 16/19 a 5/19, partido en `PRO VIN CIA`), y su precisión sobre documentos comunes es peor que la de PSM 11.

## 6. Trampas de método que ya cobraron caro

- **Una métrica que promedia errores parciales puede esconder los totales.** La primera versión de `escape.ts` **descartaba en silencio** toda palabra cuya caja no tocara ninguna tinta — o sea, el peor fallo posible. Midió "17 fugas" mientras dejaba 6 cajas 58 pt fuera del dato. Lo encontró el humano mirando el PDF, no la métrica. **Mirar siempre primero el contador de cajas fuera de toda tinta.**
- **Un test que pasa con y sin el cambio no prueba nada.** El primer test de columnas de ADR-110 pasaba también con el mecanismo viejo. Verificar los tests **en las dos direcciones**: revertir el mecanismo y comprobar que fallan.
- **Cuando una compensación no cierra del todo, suele ser que el modelo está mal.** En ADR-108 se probaron tres formas de compensar el corrimiento antes de encontrar la regla (`glyph.isSpace`); ninguna bajaba de ~50 fugas, la regla correcta bajó a 7.
- **Medir sobre el documento original, nunca sobre una copia re-exportada** (lección heredada de `Hito10.8_Handoff.md`).
- **Los oráculos internos mienten.** Las métricas AFM (ADR-097) y la tasa de empalme (ADR-102) dieron verde mientras el defecto estaba vivo: miden si el motor es consistente consigo mismo. El oráculo tiene que ser **externo** — la tinta renderizada, o el recorrido de Tesseract.
- **Un doble que devuelve lo que se le pide no puede detectar una regresión en lo que se le pide** (2026-09-02). El defecto de ADR-111 §1 vivió detrás de una suite verde porque `mockTokenClassificationPipeline` devolvía los tokens que cada test le daba, ignorando las opciones de la llamada — justo el parámetro que estaba mal. El doble tiene que **imitar la regla de la librería**, no obedecer al test: `mockPipelineHonouringIgnoreLabels` filtra como filtra el pipeline real, y por eso los tests de §1 fallan si se revierte el mecanismo.
- **Medir recall sin medir precisión responde media pregunta** (2026-09-02). La primera medición de PSM 11 solo tenía recall de palabra y sugería un costo de −0,34 pp; agregando precisión resultó que PSM 11 **inventa menos** palabras que el default, y con más páginas el costo de recall se fue a −0,03 pp. Cuando la pregunta es "¿esto mete más ruido?", la métrica es precisión.

## 7. Higiene pendiente

Varias docs de este repo —incluidas ADR-110 y `Post_Hito10.8_Pendientes.md` §29, escritas en esta campaña— contienen **nombres reales de un expediente penal** usados como ejemplo de medición. En una herramienta de anonimización eso es material que no debería estar. Los valores técnicos (posiciones, alturas, orden) se conservan igual reemplazando los nombres por marcadores. Hay precedente previo (ADR-084), así que la decisión es de alcance más amplio que esta campaña.
