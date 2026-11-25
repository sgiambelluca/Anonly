> Informe del implementador del spike, ronda 2, copiado sin cambios. El resumen y lo que decide están en `Plan_1.2.md` §8.10.

# PDF con texto preservado (`pdf-text`): ronda 2

Fecha: 2026-11-25. Repo sin tocar. Código en `C:\Anonly\spikes\texto-preservado\harness\r2\` y datos en `...\results\r2\`. Reusa el arnés y los datos de la ronda 1 (`TEXTO_PRESERVADO.md`).

**Sin documentos reales**: no había ninguna variable `ANONLY_REAL_DOC_*` definida. Todo es sintético o de fixtures del repo.

## Resumen (los números que deciden)

1. **Control 1 sin falsos positivos**: la regla «una palabra releída sobre una o más tapas pasa si su texto es el reemplazo de alguna de ellas, un pedazo contiguo de ese reemplazo, o una palabra planeada vecina pegada a un pedazo (regla C)» da **0/279** páginas limpias marcadas (la regla vieja daba 23/279 con 20 %). Positivos: **80/80** malas de la ronda 1 y **20/20** nuevas (7 de «una palabra del original bajo una tapa en página densa», 7 de «pegada al texto del reemplazo», 6 de «media palabra»). En las 100 se marca la palabra correcta. Las tapas que se pisan siguen en el corpus.
2. **Control 2 (texto igual al planeado)**: exacto da 34 falsos positivos; sin espacios, 3; como secuencia de palabras, 3; como bolsa de caracteres, 0. Los 3 que quedan en «sin espacios» son hebreo y árabe (pdfjs reordena el texto bidireccional). Los 4 casos de `[MANUAL-` cortado eran **pdfjs descartando los glifos que caen fuera de la hoja**: la caja del reemplazo se salía de la página. Recortar la caja a la página lo arregla en 4/4. Detecta 100/100 las páginas malas en todos los modos.
3. **Escaneo con capa**: la regla híbrida clasifica **2 de 239** páginas nativas con palabras del corpus (T16 y T17, las dos con capa Tr 3 sobre imagen a página completa). Ninguna otra página del corpus cae por error. 8 páginas sintéticas armadas para esto caen las 8 (6 con capa legítima, 2 con capa falsa).
4. **Fugas con la regla híbrida**: 0 de 19 tokens escondidos de las 18 trampas (150 y 300 dpi), 0 de `DATO-W-BLANCO-01`, 0 de las 2 capas falsas sintéticas (399 palabras falsas en V+ y N, 0 en O). V+ deja pasar la capa falsa; la híbrida no.
5. **Fidelidad en las páginas que caen en «escaneo con capa»** (capa legítima, T16 + 6 sintéticos): F1 de palabras 0,81 (O a 150 dpi) y 0,82 (O a 300), CER 0,12; V+ daba 0,99 y V estricto 0,12. El precio de cerrar la fuga de T17 es perder ≈ 0,18 de F1 en las capas legítimas. En T16 solo: 0,72 y 0,77.
6. **Tiempo extra** de la híbrida: clasificar cuesta 0,02 ms por página. El OCR (O) solo corre en las páginas que caen: en el corpus, 3,1 ms por página (150 dpi) o 6,0 ms (300 dpi) en promedio. En una página de escaneo con capa, 0,3-0,6 s (pocas palabras) y 1,5-4,4 s a 150 dpi (63-238 palabras); a 300 dpi, 0,7-1,1 s y 2,3-6,2 s.
7. **Control para la capa hecha con OCR**: el control 1 no sirve (marca 66/84 a 150 dpi y 69/84 a 300). Sirve la combinación de tres: **P1** («ninguna palabra sobre una tapa se parece al texto original que esa tapa cubre»): detecta 70/70 originales inyectados, 4/84 falsos positivos a 150 dpi y 7/84 a 300; **P2** («cada palabra tiene tinta en la imagen exportada, fuera de las tapas»): detecta 84/84 palabras inventadas sobre un hueco, 1/84 falsos positivos; y el control 2 sin espacios o con bolsa de caracteres: 0/84 falsos positivos. Una palabra falsa alineada con tinta real solo la ve un segundo OCR (no medido).
8. **Falla cerrada de V**: con las comprobaciones por página (cero operaciones de texto en la lista, conteo igual al de la API pública, operaciones que no son de texto intactas, y un **centinela** magenta que solo aparece si el segundo dibujo salió de la lista filtrada) la guarda dispara **0/260** páginas del corpus y los resultados son idénticos a los de la ronda 1. Si el filtro no se aplica (239/239), si los códigos de texto están corridos (239/239), si el campo privado desaparece (excepción en 260/260), si el render usa otra lista (260/260) o si se saca de más (135/260, las 7 páginas que filtrarían texto escondido incluidas), la guarda dispara siempre que hay algo que perder.
9. **Lo contrario de lo supuesto**: si el filtro no saca el texto, **ninguna palabra parece visible** (las dos pasadas son iguales): la capa queda vacía, sin fuga y sin aviso. La fuga aparece cuando el filtro saca **de más** (7 páginas de trampas con fuga en la simulación). Las comprobaciones cubren las dos direcciones.
10. **Hallazgo nuevo de V**: una palabra invisible cuya caja pisa texto visible se juzga visible (al sacar todo el texto la caja cambia igual). **Fuga en 2/2** páginas armadas para eso (con y sin fondo oscuro). Con una guarda «descartar una palabra cuya caja se solapa ≥ 1 % con otra» se cierra, a costa de 212 de 13.879 palabras (1,5 %) en 19 de 239 páginas; con ≥ 25 % del área menor, 51 palabras (0,37 %).
11. **Corrección de la ronda 1**: el arnés corría V antes de rasterizar, V muta la lista de operaciones de la página y los JPEG de `results/tmp/img` salieron **sin texto**. Se rehicieron. Con las imágenes correctas (65,6 KB por página, no ≈ 28), la capa comprimida suma **+1,00 % (F1) y +1,19 % (F2)**, no +2,3 % y +3,0 %. Sin comprimir: +6,7 % y +7,8 %. Render de poppler idéntico `pdf-image`/`pdf-text` en 558/558 páginas, ahora con imágenes con texto. Tiempo por página de render con pintado: 22,9 ms (no 19,4); JPEG 20,0 ms (no 18,5).

## 1. La verificación al exportar

### Qué se armó

- 279 páginas limpias (capa de V, escrita con F2, releída con el PdfEngine y con pdfjs).
- 80 malas de la ronda 1 (capa con la regla «ninguna»: las palabras bajo las tapas siguen).
- 20 malas nuevas: 7 «a» (una palabra del original bajo una tapa automática, en páginas de ≥ 150 palabras), 7 «b» (la palabra del original pegada al texto del reemplazo, p. ej. `Mendoza[NOMBRE-01]`), 6 «c» (la palabra entera en la capa con una tapa del 45 % o 55 %).
- Código: `stage-e.mjs` (arma y lee, guarda `e-cache.json`), `ctl.mjs` (los controles), `analyze-e.mjs` y `analyze-e2.mjs` (medición), `stage-clamp.mjs`.

### Control 1: palabras releídas sobre tapas

Resultados con la cache de la ronda 2 (279 limpias, 80 malas, 20 nuevas), recortando a la hoja las 8 páginas cuyos items se salían:

| Regla | FP en 279 | malas R1 | nuevas |
|---|---|---|---|
| R1: vieja, 20 % del área | 19 (23 sin recortar) | 80/80 | 20/20 |
| R1: vieja, estricta | 27 (31 sin recortar) | 80/80 | 20/20 |
| A: alguna tapa, texto = reemplazo | 72 (75) | 80/80 | 20/20 |
| B: A + pedazo contiguo del reemplazo | 1 | 80/80 | 20/20 |
| B con pedazo ≥ 2 caracteres | 1 | 80/80 | 20/20 |
| B, 20 % | 1 | 80/80 | 20/20 |
| **C: B + palabra pegada a vecina planeada** | **0** | **80/80** | **20/20** |
| C con pedazo ≥ 2 | 0 | 80/80 | 20/20 |
| C, 20 % | 0 | 80/80 | 20/20 |

- **Por qué A solo no alcanza**: el PdfEngine relee un reemplazo en una caja angosta partido en dos palabras (`[MANUAL` y `-02]`). Cada palabra tiene que pasar por separado. B lo admite si el trozo es un pedazo contiguo del reemplazo (tras normalizar espacios).
- **Lo que arregla B respecto de la regla vieja**: 22 de los 23 falsos positivos de la ronda 1 (se ve por la diferencia entre la regla vieja y B; no se diagnosticó cada uno). Las causas vistas son tapas que se pisan y reemplazos partidos.
- **El último falso positivo** (`lowa-full-025`): el PdfEngine devolvió `2000-01XXXX-XX`, la palabra vecina `2000-01` pegada al reemplazo `XXXX-XX`. pdfjs junta palabras contiguas. La regla C lo admite solo si la palabra pegada empieza (o termina) con una palabra planeada cuya caja cae dentro de la releída y el resto es un pedazo del reemplazo.
- **Lo que protege**: una palabra del original bajo una tapa sigue marcándose siempre que su texto no sea un pedazo del reemplazo. Se marcó la palabra bajo la tapa en 80/80 de las malas de la ronda 1. En las 20 nuevas, la palabra marcada contiene la palabra filtrada en 20/20.
- **Límite de la regla de pedazos**: una palabra del original que sea un pedazo del texto del reemplazo pasa. En el corpus, 1 de 461 tapas con original conocido cae así (un reemplazo sintético que repite un apellido). Esa palabra además está a la vista en el reemplazo.
- **Cobertura chica**: 20 malas nuevas; la regla C con vecina pegada solo se probó en 1 caso real. No hay caso de fuga pegada a una vecina.

### Control 2: texto igual al planeado

Texto de pdfjs contra el planeado, 279 limpias, con la caja recortada a la hoja:

| Modo | Falsos positivos | malas R1 | nuevas |
|---|---|---|---|
| exacto (ronda 1) | 34 (37 sin recortar) | 80/80 | 20/20 |
| sin espacios | **3** (7 sin recortar) | 80/80 | 20/20 |
| secuencia de palabras (cada token releído = una o más planeadas contiguas) | 3 (7) | 80/80 | 20/20 |
| bolsa de caracteres | **0** (4) | 80/80 | 20/20 |

- **Diagnóstico de los falsos positivos que quedan en «sin espacios» y «secuencia»** (3): `lowa-borde-069`, `lowa-full-070` y `lowa-full-098`. Texto en árabe y hebreo. pdfjs reordena las palabras del texto bidireccional al armar `getTextContent`, así que la secuencia cambia aunque cada palabra sea la planeada. La bolsa de caracteres no mira el orden.
- **Diagnóstico de los 4 de `[MANUAL-`** (`lowa-full-042`, `-044`, `-054`, `scan-syn-006`): la caja del reemplazo de una tapa manual sale de la hoja (`x + ancho` pasa el borde derecho) y **pdfjs descarta los glifos que quedan fuera de la hoja**. En 054 la hoja mide 419,6 pt y la caja termina en 459,3 pt; salen 8 de 11 caracteres. Hay 8 páginas con items fuera de la hoja y 4 pierden texto. Recortando la caja a la página con `x ≥ 0` y `x + ancho ≤ ancho de página` se leen completas las 4 (con `scan-syn-006` exacto sigue fallando por dos palabras pegadas, igual en «sin espacios»). **Pendiente de saber** si en la app una tapa puede salirse de la página. Si no, es un artefacto del corpus; si puede, el escritor tiene que recortar.
- **No se probó que la causa sea ese límite en el código de pdfjs.** Lo respaldan: el recorte lo arregla, y un caso aislado con el mismo texto dentro de la hoja se lee completo (`dbg8.mjs`).
- **Combinado** (control 1 regla C o control 2 «bolsa de caracteres»): 0/279 falsos positivos; con «sin espacios», 3.
- **Qué pierde la bolsa de caracteres**: no ve el orden. Un cambio de orden de palabras en la capa pasa. El control 1 cubre las tapas; el orden no está medido.

## 2. Escaneo con capa previa

### Regla

Una página es «escaneo con capa» si V rechaza al menos una palabra con tinta debajo (≥ 5 % de píxeles oscuros y desvío de luma ≥ 30 en la caja, alto ≥ 2 pt) y una imagen cubre ≥ 80 % de la página. En esas páginas la capa sale del OCR de la imagen ya tapada (O). En las demás, V para el nativo y N sobre el OCR del original para los escaneos, como en la ronda 1. Código: `classify.mjs`, `analyze-hybrid.mjs`.

### Cuántas páginas caen

- 260 páginas nativas en el corpus; 239 con palabras (21 sin palabras no se clasifican).
- Caen **2**: `trap-017` (T16, 23 palabras rechazadas con tinta) y `trap-018` (T17, 1 palabra).
- Con imagen ≥ 80 %: solo esas 2. Con Tr 3: esas 2 y T05 (sin imagen, no cae). **Ninguna página no escaneada cae.**
- Umbrales de tinta: con el 5 % cae T17. Con 20 % de tinta T17 deja de caer (su palabra tiene entre 5 y 20 %), y con los umbrales de la ronda 1 caen las mismas dos.
- Una página mal clasificada nunca fuga: si no cae, V descarta la capa (se pierde texto legítimo); si cae de más, sale la capa de O (se pierde fidelidad). Las dos rutas son seguras por separado. La clasificación decide fidelidad, no seguridad.
- **Corpus chico para esta pregunta**: el corpus casi no tiene páginas con imagen de fondo a página completa. Para medir el falso positivo posible se armaron 4 páginas nativas con fondo a página completa (claro y oscuro, con y sin una palabra invisible): **ninguna cae**. Con una palabra invisible sobre texto visible tampoco (ver «Hallazgo: palabra invisible sobre texto visible»: V la juzga visible).

### Páginas armadas para esto

- 6 escaneos sintéticos de la ronda 1 (a 300 dpi) con una capa Tr 3 alineada con las palabras reales (`scan-syn-003, 004, 005, 007, 009, 011`; 63 a 238 palabras), 2 con capa falsa del mismo tamaño y alineada (`FALSO-nnn`, `scan-syn-008, 010`). Se corrió el PdfEngine, V, el plan de tapas (2-5 por página), la imagen tapada y OCR a 150 y a 300 dpi. Código: `gen-layered.mjs`, `stage-layer.mjs`.
- Caen las 8.

### Fugas

| | Capa falsa (T17 + 2 sintéticas, palabras falsas en la capa) | T16 (token legítimo) | 18 trampas (19 tokens escondidos) |
|---|---|---|---|
| N | 399 | conserva | 14 de 15 (ronda 1) |
| V | 0 | tira 23 de 23 | 0 |
| V+ | **399** | conserva | 0 |
| **Híbrida (150 / 300 dpi)** | **0 / 0** | **conserva el token en O: sí** | **0 / 0** |

- La híbrida no deja pasar ni las 2 capas falsas sintéticas ni T17.
- `DATO-W-BLANCO-01` (el Word convertido): V lo bloquea; la híbrida no cambia nada ahí.
- **Contra el resto de las trampas**: ninguna de las otras 16 cae, así que usan V. Nada cambia respecto de la ronda 1 (V: 0 fugas).

### Fidelidad (texto esperado = texto visible con las tapas aplicadas)

| Fuente | T16 solo, F1 / CER | 6 sintéticos legítimos, F1 / CER | 7 legítimos (T16 + 6), F1 / CER |
|---|---|---|---|
| N (sin filtrar, deja pasar capas falsas) | 1,00 / 0 | 1,00 / 0 | 1,00 / 0 |
| V estricto | 0,43 / 0,76 | 0,06 / 0,96 | 0,12 / 0,93 |
| V+ (capa entera con tapas) | 1,00 / 0 | 0,99 / 0,006 | 0,99 / 0,006 |
| **O a 150 dpi** | 0,72 / 0,15 | 0,81 / 0,12 | 0,80 / 0,12 |
| **O a 300 dpi** | 0,77 / 0,16 | 0,82 / 0,11 | 0,81 / 0,12 |

- Por página sintética, F1 de O a 150/300: 0,87/0,86; 0,84/0,88; 0,95/0,96; 0,76/0,76; 0,72/0,73; 0,70/0,73. Peor en las páginas densas (238 palabras).
- Capas falsas (T17 + 2 sintéticas), contra el texto que se ve en la imagen: O 0,82 (150) y 0,83 (300), contra 0,01 de V+ y N.
- Esta fidelidad es la de la ronda 1 (O sobre la imagen tapada): el OCR pierde sobre todo el texto del reemplazo y las palabras junto a las tapas.

### Tiempo extra

- Clasificar: 0,02 ms por página (media de 260 páginas; máximo 0,5 ms) más lo que ya cuesta V (que calcula la tinta). Con la guarda de la parte 3, V pasa de 9,8 a 16,1 ms por página.
- O (OCR de la imagen tapada, que la app ya produce): T16 0,47 s (150) y 0,79 s (300); T17 0,27 y 0,66; los 8 sintéticos 0,61-4,42 s (150) y 1,05-6,18 s (300), promedio 2,3 y 3,4 s.
- Promedio sobre las 239 páginas del corpus: 3,1 ms (150) y 6,0 ms (300). Sobre un documento escaneado con capa en todas sus páginas: el costo completo de O en cada página.

### Qué control puede verificar esa capa

El control 1 no (marca 66/84 a 150 dpi y 69/84 a 300 dpi con la regla C): el OCR rara vez devuelve el texto exacto del reemplazo. Se probaron tres, sobre 84 páginas con OCR (las 76 de la ronda 1 con OCR de la imagen tapada, que incluyen las 18 trampas, y las 8 con capa) a 150 y 300 dpi, con la capa de O escrita en F2 y releída con el PdfEngine y pdfjs. Código: `control-scl.mjs`.

| Control | Qué exige | Falsos positivos (84 páginas) | Detección |
|---|---|---|---|
| P1 | ninguna palabra que toca una tapa se parece (similitud ≥ 0,8, o la contiene) al texto original que esa tapa cubre. La regla `redact` «ninguna palabra» **no** se usa: el OCR lee ruido sobre el negro (40/84) | 4 (150 dpi), 7 (300 dpi) | 70/70 originales inyectados sobre una tapa, a 150 y a 300 |
| P2 | cada palabra fuera de las tapas tiene tinta (desvío de luma ≥ 12) en la imagen exportada a 150 dpi | 1 (una palabra) | 84/84 palabras inventadas sobre un hueco |
| Control 2 (sin espacios / bolsa de caracteres) | el texto de la capa releída es el planeado | 0 / 0 | solo detecta fallas del escritor |

- **Falsos positivos de P1 (150 dpi, diagnosticados)**: `lowa-sint-022`, `scan-syn-005` y `lay-legit-005` leen «Quiroga» vecina de una tapa; en dos de ellos un reemplazo sintético («Marta Quiroga») repite un apellido que está en el original. `trap-011` lee `agina` (resto visible de una palabra con tapa del 45 %). Los 3 de 300 dpi que se suman no se diagnosticaron uno por uno.
- **Lo que P1 y P2 no ven**: una palabra falsa **alineada con tinta real** y que no está sobre una tapa. Pasa P2 y P1. Para esa solo sirve un **segundo OCR** de la imagen exportada, comparando con la capa. No se midió. Es determinista (la capa sale del mismo OCR), así que sirve para detectar un defecto del escritor y duplica el costo de O.
- **Por construcción, la capa de O no puede llevar texto que no esté en la imagen** salvo por un defecto del escritor; P1, P2 y el control 2 cubren ese caso en lo que se midió.

## 3. Que la prueba de visibilidad falle cerrada

Código: `guard.mjs` (la prueba con las comprobaciones), `guard-run.mjs`, `cleanup-test.mjs`.

### Propuesta (por página)

1. **G1**: la lista filtrada no tiene operaciones `showText`, `showSpacedText`, `nextLineShowText` ni `nextLineSetSpacingShowText`.
2. **G2**: la cantidad de operaciones sacadas es igual a la que había antes, y esa cantidad coincide con la que cuenta la API pública `page.getOperatorList()` antes de filtrar (a través de otra vía distinta de `_intentStates`).
3. **G3**: las operaciones que no son de texto no cambian (misma cantidad por código; el largo de la lista no cambia; las `dependency` suben exactamente en la cantidad sacada).
4. **G4, el centinela**: se agrega a la lista filtrada un cuadrado magenta de 4 × 4 pt en la esquina inferior derecha, **antes de las anotaciones**, con 64 `restore`, un `setGState` (alfa 1, mezcla normal, sin máscara) y un `save`. El segundo dibujo tiene que tenerlo y el primero no. Confirma que el segundo render salió de **la lista que filtramos**.
5. Si falla cualquiera, o si `_intentStates` no existe o cambia de forma (excepción), la página **no usa V**: fail cerrada. Qué sale en su lugar es decisión de producto (en esta ronda se mide solo la detección).

Con G1 + G4 juntos se sabe que el render usó la lista y que la lista no tiene texto. Lo que no cubre: texto dentro de patrones de mosaico o de máscaras suaves (listas de operaciones aparte); no hay caso en el corpus.

### Lo que hubo que ajustar para que no dispare en el corpus

El centinela falló en las páginas con (a) anotaciones al final de la lista (el centinela agregado después de `endAnnotation` no se dibuja), y (b) un estado gráfico de alfa 0 que queda sin restaurar (T14). Se resolvió insertándolo antes de `beginAnnotation`, con los `restore` y el `setGState`. En esa forma no dispara en ninguna página del corpus. El centinela depende de la estructura interna de la lista (`constructPath` con `[[rectangle], [x, y, w, h], minMax]`): si pdfjs la cambia, el centinela no se ve y la guarda dispara, es decir, falla cerrada. Un ajuste de pdfjs puede dar falsos positivos masivos, que es el costo de fallar cerrado.

### Medición

260 páginas nativas (239 con texto), pdfjs 4.10.38. «Páginas con texto» = páginas donde había algo para filtrar.

| Caso | Páginas donde dispara | Qué pasa sin guarda |
|---|---|---|
| Filtro correcto | **0 / 260** | resultados idénticos a la ronda 1 en 260/260 |
| El filtro no se aplica | 239 / 239 con texto | **ninguna palabra visible en 237 páginas**: capa vacía, 0 fugas |
| Códigos de texto corridos (+1) | 239 / 239 | ídem, capa vacía |
| El campo privado desaparece | excepción en 260 / 260 | no hay V |
| Muta una copia; el render usa otra lista (G1, G3, G4) | 260 / 260 | capa vacía |
| pdfjs re-interpreta la página al segundo dibujo (solo G4) | 260 / 260 | capa vacía |
| Saca de más (también imágenes, rellenos y trazos) | 135 / 260 | **fuga en 7 páginas** (T02, T03, T04, T10, T11, T13, T17); las 7 disparan |

- 0 páginas con resultado distinto y sin disparo, en ningún caso.
- Costo: 16,1 ms por página con la guarda y 9,8 con V solo (+6,3 ms; no se separó cuánto cuesta cada comprobación).
- **La mutación de V rompe la página**: después de V, el mismo objeto de página dibuja sin texto (0 píxeles oscuros contra 1.323). `page.cleanup()` lo restaura (1.323 otra vez). Ese es el defecto que contaminó los JPEG de la ronda 1.

### Hallazgo: palabra invisible sobre texto visible

- V mide el cambio dentro de la caja de la palabra al sacar **todo** el texto. Si la palabra invisible pisa texto visible, el cambio ocurre igual y la juzga visible.
- Se armaron 2 páginas nativas con fondo a página completa y una palabra de opacidad 0 sobre un renglón visible (`bg-claro-oculta`, `bg-oscuro-oculta`; `gen-bg.mjs`). **Fuga en 2/2** con V.
- Guarda de solape: descartar de V una palabra cuya caja se solapa con otra. Cierra 2/2. Costo en las 239 páginas con 13.879 palabras: ≥ 0,01 % de solape, 219 palabras (1,6 %); ≥ 1 %, 212 (1,5 %, 19 páginas); ≥ 5 %, 161 (1,2 %); ≥ 10 %, 104; ≥ 25 % del área menor, 51 (0,37 %, 11 páginas); ≥ 50 %, 8. Todas son palabras visibles que se pierden. V necesita ≥ 1 % del área de diferencia para juzgar visible, así que un solape menor del 1 % no basta para engañarlo; con 25 % hay riesgo si el solape es entre 1 y 25 %. No se probó una palabra invisible con solape chico.
- Esto **no estaba en las 17 trampas de la ronda 1**. No lo cubre la regla híbrida (la página con la palabra invisible no cae en «escaneo con capa»: V no rechaza ninguna palabra).

## Qué quedó sin medir

- **Documentos reales**: ninguno.
- **Re-OCR de la imagen exportada** como control de la capa de O (se describe, no se midió).
- **Chromium / Electron y los render reales de la app**: todo con `@napi-rs/canvas` y pdfjs en Node. El centinela y la guarda dependen de `_intentStates` y de la estructura de operaciones de pdfjs 4.10.38; con otra versión no se probó.
- **Palabras invisibles con solape chico** (1-25 %) sobre texto visible.
- **Texto dentro de patrones de mosaico, máscaras suaves y Type3** para la guarda.
- **Páginas con `/Rotate`** para el centinela y V (no hay en el corpus).
- Los 3 falsos positivos de P1 que se suman a 300 dpi no se diagnosticaron uno por uno.
- Si una tapa puede salirse de la hoja en la app.
- Orden de palabras de la capa (control 2 «bolsa de caracteres» no lo ve).
- Tiempos de render y de guarda: Node, no la app.

## Qué sale solo de sintéticos

- Todo. Las 20 malas nuevas, los 8 PDF con capa, las 4 páginas con fondo, las simulaciones de falla y las tapas son armados por mí. Los PDF de LibreOffice y los fixtures son los de la ronda 1.
- Las cifras de fugas y de falsos positivos dependen de cómo se armaron las trampas y de las tapas aleatorias (con superposiciones).
- La fidelidad de O está medida sobre 7 páginas legítimas (T16 y 6 sintéticos de 63-238 palabras) y 3 con capa falsa.
- Los falsos positivos del control 1 (279 páginas) son de un corpus con 647 tapas; 8 páginas tienen cajas fuera de la hoja.

## Archivos

- Informe: `C:\Anonly\spikes\texto-preservado\results\TEXTO_PRESERVADO_R2.md`.
- Código (`harness\r2\`): `common.mjs`, `stage-e.mjs`, `ctl.mjs`, `analyze-e.mjs`, `analyze-e2.mjs`, `stage-clamp.mjs`, `classify.mjs`, `gen-layered.mjs`, `gen-bg.mjs`, `stage-layer.mjs`, `analyze-hybrid.mjs`, `control-scl.mjs`, `guard.mjs`, `guard-run.mjs`, `overlap.mjs`, `regen-img.mjs`, `stage-size.mjs`, `time-cover.mjs`, `cleanup-test.mjs`; `dbg*.mjs` y `guard-dbg.mjs` son de diagnóstico.
- Resultados (`results\r2\`): `analysis-e.json`, `analysis-e2.json`, `clamp.json`, `classify.json`, `analysis-hybrid.json`, `stage-layer.json`, `stage-bg.json`, `control-scl-summary.json`, `guard-run.json`, `overlap.json`, `regen-img.json`, `stage-size.json`, `time-cover.json`, `img\` (JPEG anonimizados correctos). Orden: `stage-e`, `analyze-e2` (con `stage-clamp`), `classify`, `gen-layered`, `stage-layer`, `gen-bg`, `stage-layer units-bg.json stage-bg.json`, `analyze-hybrid`, `control-scl`, `guard-run`, `overlap`, `regen-img`, `stage-size`.
