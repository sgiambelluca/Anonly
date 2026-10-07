<!-- CONTEXT: scope=plan-hardening | dependencias=roadmap/Roadmap_1.x.md,adr/ADR-210-El-Repintado-De-Linea-Desplaza-Los-Pixeles-Del-Renglon.md,adr/ADR-058-Repintado-De-Linea-Por-Calibracion.md,adr/ADR-194-Automatico-Elige-El-Perfil-De-Rendimiento-Segun-El-Equipo.md,adr/ADR-163-El-DPI-De-OCR-No-Supera-Al-Raster-Fuente.md,adr/ADR-124-La-Unidad-De-Alcance-Es-El-Commit-No-El-PR.md,roadmap/interaccion/Revision_ADR204_2026-10-07.md,roadmap/mediciones/ocr/DPI_Descendente_Fase1_Windows_2026-10-01.md,tests/perf/README.md | audiencia=humanos+IA | fase=12 -->

# Confianza 1.0.x — plan de la branch de trabajo

Branch `hardening/confianza-1.0.x`, creada desde `develop` el 2026-10-07,
después de integrar el PR #59. Es una branch de campaña (ADR-124): toca varios módulos, y cada
commit toca uno.

## Qué decidió el mantenedor (2026-10-07)

- La branch toma cuatro frentes de `Roadmap_1.x.md` §3: repintado de línea,
  emails en escaneos de baja resolución, direcciones y memoria del perfil
  Bajo.
- **Repintado**: no se apaga. Se trabaja directamente la solución.
- **Emails**: primero se mide, para tener un punto de partida contra el que
  comparar cualquier cambio de detección.

## Orden de trabajo

Las mediciones van primero y de a una. Mientras tanto se cierran los
documentos del repintado.

Por qué el repintado se implementa **después** de las dos mediciones:

- Los arneses exigen que `packages/` y `apps/` no tengan cambios sin
  commitear, y en esta branch se commitea recién al final (decisión del
  mantenedor, 2026-10-07). Con el repintado a medio implementar, el arnés se
  negaría a correr.
- Los gates del implementador (lint, typecheck, tests) compiten por CPU y
  memoria con una medición en curso.
- La línea de base de emails tiene que salir del producto tal como está hoy.

Un solo sub-agente a la vez: el de mediciones termina M-M1 y M-E1, y recién
entonces arranca el implementador de `render-engine`.

| Paso | Frente | Qué | Quién | Estado |
|---|---|---|---|---|
| 1 | Memoria | M-M1: pico del perfil Bajo sobre `P2H` | implementador (`tests/perf`) y planificador | **cerrado el 2026-10-07**: máximo 2,05 GB, techo fijado en 2,5 GB, también en el arnés |
| 2 | Emails | M-E1: línea de base sobre escaneos de 200 y 150 dpi nativos | implementador (`tests/perf`) y planificador | **medido el 2026-10-07**: sin pérdidas a 200 dpi nativos; 2 de 25 a 150 |
| 3 | Repintado | Implementación desde el spec, capturas, revisor | implementador, mantenedor, revisor | ADR-210 **aceptado**, spec v1.18.0, implementación en `render-engine` y E2E con canvas real **entregados** el 2026-10-07; capturas del preview y del export enviadas al mantenedor. Falta el revisor, que va al final de la branch |
| 4 | Direcciones | Auditoría de la línea de base; después ADR | planificador | **auditado el 2026-10-07**: el modelo detecta la calle y deja el número afuera. ADR-212 **aceptado a prueba** ese día, spec de NER v1.11.0 e **implementación en `ner-engine` entregada** (139 tests del módulo en verde, 98,8 % de líneas). **Medido el 2026-10-07 (M-D1)**: la regla deja 6 alturas a la vista y tapa 4 años de más; tapar siempre, 0 y 9. Las cuatro direcciones de la línea de base quedan cubiertas. **Decidido por el mantenedor el 2026-10-07: tapar siempre**, sin volver a medir. ADR-212 y spec de NER v1.12.0 enmendados; sigue el cambio en `ner-engine` y el revisor |
| 2b | Emails | M-E2: la misma línea de base sobre los textos con degradación de fotocopia | implementador (`tests/perf`) y planificador | **medida el 2026-10-07**: sin pérdidas a 300 y 200 dpi; 4 de 10 a 150, tres de ellas con `Q` y un espacio |
| 6 | Visor | El cambio de vista pide la imagen a la escala del zoom (frente 5) | implementador (`apps/react-client`) | pedido por el mantenedor el 2026-10-07; **implementado ese día** en el cliente, para el cambio de vista, las ediciones y el reanálisis. Para el instante borroso que quedaba al conmutar: ADR-213 aceptado e **implementado el 2026-10-07**, con la enmienda del mantenedor: bajo «Anonimizado» nunca se muestra la imagen original (20 tests en Electron). Quedan dos hallazgos anotados, sin decidir. Falta el revisor |
| 5 | Emails | ADR-211 y spec de Regex; después implementación y comparación contra la línea de base | mantenedor, planificador, implementador | ADR-211 **aceptado** el 2026-10-07, con el espacio tras el punto incluido; spec de Regex v1.15.0 e **implementación en `regex-engine` entregada** ese día (190 tests del módulo en verde, 98,7 % de líneas; los tres tests de ADR-181 sin tocar). **Medido el 2026-10-07 (M-E3): de 11 a 2, de 4 a 0 y de 8 a 0 emails perdidos, sin agregados y sin otros cambios.** Cerrado, falta el revisor |

## Frente 1 — Memoria del perfil Bajo (M-M1)

**Pregunta.** ¿Cuál es el pico de memoria del perfil `low` en el escenario de
ADR-194 §7, y entra en el techo provisorio de 3,5 GB?

**Escenario**, el mismo de los otros tres niveles: corpus `P2H` (20 páginas A4
a 300 dpi nativos), Windows nativo, arnés del pool, pico de RSS del árbol
durante el OCR (fase `pool-rss` del spec), tres corridas frías, y se compara
el **máximo**.

**Qué le falta al arnés.** La fase `ultra` de `run-ocr-pool.sh` corre los
brazos `2`, `4`, `4b`, `6` y `6b`. El spec acepta el brazo `1`, pero ese brazo
solo fuerza `workerPool.ocrPoolSize` sobre la base `medium` de las suites de
medición (ADR-194 §8). El perfil `low` fija además en 1 los pools de PDF, NER
y render (`settingsToEngineConfig.ts`, `LEVEL_OVERRIDE.low`). Un brazo `1`
sobre base `medium` no es el perfil Bajo.

**Tarea.**

1. Un camino opt-in en el arnés que corra el perfil `low` tal como lo elige un
   usuario: por el setting `performancePreset: "low"`, no por overrides
   sueltos. Las demás fases y brazos no cambian.
2. La corrida comprueba la configuración efectiva antes de medir: los cuatro
   pools en 1 y `ocr.maxLiveImageBytes` sin enviar (128 MiB). Si no coincide,
   la corrida es inválida.
3. Tres corridas frías de memoria sobre `P2H`, en serie, con las mismas
   guardas de validez de la fase `ultra`.
4. El resultado: el pico de cada corrida, el máximo, y el commit y el
   entorno. Sin rutas ni datos de documentos reales; `P2H` es sintético.

**Después.** El planificador actualiza la tabla de ADR-194 §7 y el ítem de
`Roadmap_1.x.md` §3. Si el máximo supera 3,5 GB, vuelve al mantenedor: el
techo no se sube en silencio (ADR-194 §7).

La repetición de M2, que el mismo ítem del roadmap menciona, no entra en este
paso.

### Resultado de M-M1 (2026-10-07)

Arnés nuevo: `ANONLY_OCR_POOL_PHASE=low-memory ./tests/perf/run-ocr-pool.sh`
(`tests/perf/README.md`, «Memoria del perfil Bajo»). Producto de `develop`
del 2026-10-07, sin los cambios de esta branch. Windows 11 nativo, 12 hilos y 16,9 GB de RAM.

| Corrida | Pico de RSS del árbol durante el OCR | OCR |
|---|---:|---:|
| r0 | 2,045 GB | 33,5 s |
| r1 | 2,018 GB | 33,0 s |
| r2 | 2,040 GB | 36,6 s |

- **Máximo: 2,045 GB**, contra un techo provisorio de 3,5 GB.
- Configuración efectiva comprobada en las tres: `performancePreset: "low"`,
  sin overrides, los cuatro pools en 1 y 128 MiB de imágenes vivas.
- Las tres corridas son válidas y sus huellas de OCR, NER y Grouping
  coinciden. Un reconocedor ocupado como máximo.
- En el pico, el proceso del renderer pesa entre 1,3 y 1,4 GB y el de GPU
  entre 0,4 y 0,56 GB.
- El pico mide la ventana del OCR, como en los otros niveles. No hubo
  despachos de NER dentro de esa ventana.
- **Una cuarta observación**: el humo previo, primera corrida después del
  build y la que generó el corpus `P2H`, dio 2,42 GB. No forma parte de la
  tanda, pero se deja dicho.

**Decidido por el mantenedor el 2026-10-07: el techo de `low` es 2,5 GB.** Es
lo que da la regla de ADR-194 §7 (máximo más unos 0,35 GB de ruido,
redondeado al medio GB). ADR-194 §7 ya lo dice.

El arnés compara contra ese techo desde el mismo día
(`LOW_MEMORY_CEILING_BYTES` en `tests/perf/support/ocrPoolLowSummary.ts`, con
sus tests y el README del arnés).

## Frente 2 — Emails en escaneos de baja resolución (M-E1)

**Lo que ya se sabe.** Al leer a menos de 300 dpi un escaneo de 300 dpi
nativos se pierden emails, y la causa es la lectura del OCR: la `@` leída
como `Q` en 9 de 11 casos y el punto del nombre leído como espacio en 2
(`DPI_Descendente_Fase1_Windows_2026-10-01.md` §2.1).

**Pregunta.** ¿Pasa lo mismo en un escaneo cuya resolución **nativa** es de
200 o de 150 dpi, que es lo que hoy se lee a esa resolución (ADR-163)? ¿Con
qué frecuencia y con qué lecturas?

**Corpus.** Los mismos textos sintéticos de la campaña de DPI descendente
(`SR`, `S12`, `S10` y `S8`), rasterizados a 200 y a 150 dpi nativos, más los
de 300 dpi como control. Se leen con la configuración por defecto: no se
fuerza `ocr.dpi`.

**Qué se registra por celda.**

- Emails esperados, detectados, perdidos y agregados contra la verdad del
  sintético.
- Para cada email perdido, cómo lo leyó el OCR, clasificado: `@` como `Q`,
  punto como espacio, las dos cosas, u otra lectura.
- Cuántas cadenas del texto leído tienen la forma `nombreQdominio.tld` sin
  ser un email de la verdad. Es la cota de falsos positivos de una regla
  tolerante.
- El DPI efectivo de cada despacho, con el observador de ADR-190, para
  demostrar que se leyó a la resolución nativa.

Dos repeticiones por celda. Windows nativo. No cambia producto.

**Salida.** Un informe en `mediciones/ocr/`, solo con valores sintéticos.
Es la línea de base: cualquier cambio de detección posterior se mide con el
mismo arnés y se compara contra estos números.

**Después.** Con el informe, el mantenedor decide si la detección tolera esas
lecturas y con qué límite (`Roadmap_1.x.md` §3). Recién ahí se escribe el ADR
y el spec de Regex.

### Resultado de M-E1 (2026-10-07)

Informe:
[`Emails_DPI_Nativo_2026-10-07.md`](../mediciones/ocr/Emails_DPI_Nativo_2026-10-07.md).
Arnés nuevo: `./tests/perf/run-ocr-emails-native.sh`.

- A **200 dpi nativos** no se pierde ningún email (25 de 25).
- A **150 dpi nativos** se pierden 2 de 25, los dos en el texto de 8 pt y los
  dos por la `@` leída como `Q`.
- En todo el texto leído no hay ninguna otra cadena con la forma
  «nombre, `Q`, dominio»: una regla tolerante recuperaría los dos y no
  inventaría ninguno, en este corpus.
- Las 24 celdas son válidas y las dos repeticiones coinciden.
- Límite: los sintéticos son limpios. Los corpus con degradación de fotocopia
  no entraron.

**Decidido por el mantenedor el 2026-10-07**: se cubre el caso de la `@`
leída como `Q`, y solo ese. Propuesta en
[ADR-211](../../adr/ADR-211-El-Email-Tolera-La-Arroba-Leida-Como-Q-En-Texto-De-OCR.md),
pendiente de su aceptación. La línea de base para comparar son este informe,
M-E2 y los 11 emails perdidos de la campaña de DPI descendente.

### M-E2 — textos con degradación de fotocopia

Pedida por el mantenedor el 2026-10-07: toda medición suma a la decisión.

- **Corpus**: `SD1` a `SD5`, los sintéticos con degradación de fotocopia de
  la campaña de DPI descendente, rasterizados a 300, 200 y 150 dpi nativos.
- **Todo lo demás, igual que M-E1**: configuración por defecto, dos
  repeticiones, DPI efectivo comprobado, clasificación de cada email perdido
  y conteo de cadenas con forma de `Q` que no son un email de la verdad.
- **Salida**: se agrega al informe de M-E1, en una sección propia.

**Cómo corrió.** El arnés exige `packages/` y `apps/` sin cambios sin
commitear, y la implementación del repintado los tenía. El planificador los
apartó con `git stash`, se midió sobre el producto de `develop` del 2026-10-07, y
los restituyó idénticos (comprobado contra un parche de respaldo).

**Resultado (2026-10-07).** En el informe de M-E1, sección «M-E2».

- A 300 y a 200 dpi nativos, con degradación, no se pierde ningún email.
- A 150 dpi se pierden 4 de 10. En uno la `@` se leyó como `Q`; en tres,
  además, hay un espacio después del punto del nombre
  (`contacto. estudioQexample.org`).
- La regla de ADR-211 recuperaría el primero entero y **solo el final** de
  los otros tres: `contacto.` quedaría sin tapar.
- Ninguna cadena ajena con forma de `Q`.
- Límite del arnés: la receta de fotocopia está en píxeles, así que a 150 dpi
  la degradación es físicamente más fuerte que a 300. Las celdas de 150 son
  un caso exigente, no la misma fotocopia a menor resolución.

**Decidido por el mantenedor el 2026-10-07**: ADR-211 queda aceptado y cubre
también el espacio después del punto del nombre. Condición suya: el avance se
demuestra midiendo.

### M-E3 — después del cambio

Los tres arneses se vuelven a correr con ADR-211 implementado y se comparan
contra sus corridas anteriores:

| Arnés | Antes: emails perdidos | Se espera después |
|---|---:|---:|
| DPI descendente (lectura forzada) | 11 | 2 (los del punto leído como espacio, fuera de alcance) |
| Emails nativos, textos limpios (M-E1) | 2 | 0 |
| Emails nativos, textos degradados (M-E2) | 4 | 0 |

Además: ningún email agregado que no esté en la verdad y ninguna otra
entidad perdida. Si un número no se cumple, vuelve al mantenedor.

Los arneses exigen el producto commiteado. El mantenedor autorizó commits
locales, sin push, el 2026-10-07.

**Resultado (2026-10-07).** En el informe de M-E1, sección «M-E3».

| Arnés | Antes | Después |
|---|---:|---:|
| DPI descendente (lectura forzada) | 11 | 2 |
| Emails nativos, textos limpios | 4 | 0 |
| Emails nativos, textos degradados | 8 | 0 |

En las dos de emails nativos cada email cuenta dos veces, una por
repetición; por eso 4 y 8, y no 2 y 4.

- Los 2 que quedan son el punto leído como espacio sin `Q`, fuera del
  alcance de ADR-211, y solo aparecen al forzar la lectura a 150 dpi.
- Ningún email agregado por el cambio y ninguna otra entidad distinta.
- El texto leído por el OCR es idéntico al de la línea de base en las 105
  celdas.
- El test de peores casos de la búsqueda con `Q` es lineal.

Se cumple la condición del mantenedor.

## Frente 3 — Repintado de línea

[ADR-210](../../adr/ADR-210-El-Repintado-De-Linea-Desplaza-Los-Pixeles-Del-Renglon.md),
**aceptado por el mantenedor el 2026-10-07**: mover los píxeles del renglón en
vez de volver a escribir el texto, y eliminar la calibración de tipografía.

Pasos:

1. Hecho el 2026-10-07: `Render_Engine.md` v1.18.0 (nota de cabecera,
   «Enmienda normativa ADR-210» y checklist §15 ítem 33), la enmienda en
   ADR-058 y el comentario de `lineWords` en `03_Data_Model.md`.
   `UX_Guidelines.md` no cambia: lo que dice del repintado sigue siendo cierto.
2. El implementador de `render-engine` implementa desde el spec, con los
   nombres de test de §14.
   **Entregado el 2026-10-07.** Se eliminó la calibración y el repintado
   mueve píxeles. 234 tests del módulo en verde (eran 229), cobertura de
   líneas 96,5 %. Los siete tests nuevos están con sus nombres, y el
   implementador comprobó con mutaciones que no son vacuos. Tres precisiones
   que surgieron al implementar quedaron en la enmienda del spec: la
   cláusula de superposición del origen es defensiva, (d) redondea igual que
   el origen, y la franja de medio píxel entre el tamaño exacto y el
   redondeado. Pendiente fuera del módulo, en commits propios: dos
   comentarios que todavía hablan de calibración
   (`shared/src/types.ts` y `src/line-words.ts`). Observación ajena a este
   cambio: el test `interaction geometry does not change full rendering`
   compara el canvas de codificación y no el de la página; se revisa aparte.
3. **Entregado el 2026-10-07**: `tests/e2e/line-repaint-pixels.spec.ts`, con
   `support/pagePixels.ts` y un fixture de Helvetica. Va en su propio commit
   (`tests/`). Sobre el canvas real de la app:
   - los renglones se repintan, con un único desplazamiento entero: 15 px al
     100 % de zoom y 19 px al 130 %;
   - los píxeles movidos son **idénticos** a los del original, canal por
     canal y sin tolerancia;
   - se repinta a los dos zooms;
   - un renglón de control, donde la etiqueta entra, no se mueve.

   El E2E de interacción anonimizada sigue en verde. Los dos comentarios que
   hablaban de calibración (`shared` y el façade) quedaron corregidos, cada
   uno para su commit.
4. **Hecho el 2026-10-07**: el mantenedor recibió capturas del antes y el
   después en la app (Times New Roman, Arial, Calibri y un escaneo, al 100 %
   y al 130 %) y del PDF exportado, digital y escaneado.
5. Revisor, por lote, al final de la branch.

**Dos hallazgos ajenos a ADR-210 que aparecieron al probar.** Son anteriores a
esta branch y no se corrigen acá:

- **El visor no vuelve a pedir la imagen al cambiar de vista después de un
  zoom.** Si se hace zoom en Original y se pasa a Anonimizado (o al revés), la
  otra vista muestra su imagen anterior estirada, hasta que haya otro zoom o
  un scroll. En `PdfViewer.tsx`, el efecto de zoom pide solo la vista activa,
  y ningún efecto vuelve a pedir al cambiar de vista si ya había una imagen.
  El E2E lo esquiva con un «Alejar» y un «Acercar» y lo deja comentado.
  Anotado en `Roadmap_1.x.md` §9.
- **En un escaneo, alrededor de una etiqueta que entra en su caja quedan
  restos tenues de la tinta original** fuera de la caja de la palabra: el
  borde difuso de los dígitos. No es legible. Pasa en el camino sin repintado,
  que ADR-210 no toca; en un renglón repintado no pasa, porque se tapa toda
  la franja. Visto en la captura del export de un escaneo a 300 dpi; no está
  medido contra el gate de ADR-148.

## Frente 4 — Direcciones

**Lo que ya se sabe.** En la línea de base de calidad
(`tests/quality/baselines/reference-v1.json`) hay cuatro direcciones y
ninguna queda cubierta, ni siquiera en parte. Las cuatro tienen la forma
«calle y número» y son sintéticas. Todos los demás tipos de la línea de base
están cubiertos al 100 %.

**Relevado el 2026-10-07, sin correr el modelo.** Las cuatro aparecen en el
dataset de referencia con la misma frase: «con domicilio en *calle número*.»
(`tests/fixtures/generate.ts`, `appendEntitySentence`). La verdad las espera
del detector `ner`. El motor de nombres convierte la etiqueta `LOC` del modelo
en `Address`, y su propio código lo llama una aproximación: «lugar» no es
«dirección» (`ner-engine/src/worker/kernel.ts`). No hay ningún patrón de
Regex para direcciones.

**Auditado el 2026-10-07 con el modelo real**, en la aplicación de
escritorio, sobre los cuatro documentos sintéticos:

| Documento | La verdad espera | La app detecta como dirección |
|---|---|---|
| `doc-001` | `Maipú 1434` | `Maipú` |
| `doc-003` | `Belgrano 5983` | `Belgrano` |
| `doc-006` | `Pueyrredón 9741` | `Pueyrredón` |
| `doc-011` | `Pueyrredón 2584` | `Pueyrredón` |

- **El modelo sí encuentra la calle, en los cuatro.** Lo que queda afuera es
  el número. La línea de base cuenta «no cubierta» porque la detección no
  abarca el valor entero.
- En el documento exportado, hoy, la calle sale tapada y la altura a la
  vista.
- No hace falta un detector nuevo de direcciones para estos casos: alcanza
  con extender lo que el modelo ya marca.

**Lo que falta decidir.**

- Qué formas de dirección tiene que cubrir el producto. Es una decisión del
  mantenedor: calle y número, piso y departamento, localidad, código postal.

**Camino que propone el planificador**: un posprocesado de las direcciones
que el modelo ya etiqueta. Cuando a una dirección la sigue inmediatamente un
número, la ocurrencia se extiende para incluirlo. El alcance de «número» es
la decisión del mantenedor:

1. solo la altura: de uno a cinco dígitos pegados a la calle, con o sin
   «N°», «Nº» o «nro.» en el medio. Cubre los cuatro casos;
2. además, piso y departamento («piso 3», «dpto. B», «3° B»);
3. además, código postal y localidad.

Riesgo a tener presente: un lugar seguido de un año («en Rosario 2019») se
taparía como «Rosario 2019». Es tapar de más un año, no una fuga.

**Decidido por el mantenedor el 2026-10-07**: se prueba la regla por
contexto de
[ADR-212](../../adr/ADR-212-La-Direccion-Incluye-La-Altura-Que-La-Sigue.md).
Solo la altura; piso, departamento, código postal y localidad quedan afuera.
Un número con forma de año se suma solo con una palabra de dirección cerca.
Si la medición muestra que deja escapar alturas, se pasa a tapar siempre.

### M-D1 — cuánto tapa la regla y cuánto deja

Oraciones sintéticas escritas para esto, corridas por la aplicación con el
modelo real. Categorías y resultado esperado, en ADR-212 («Cómo se decide si
la regla alcanza»).

- Entre 8 y 10 oraciones por categoría, con calles y lugares distintos.
- Por oración: si el modelo marcó el lugar, y si el número quedó dentro de
  la dirección.
- El informe da, para la regla por contexto y para «tapar siempre», las
  alturas que quedan a la vista y los años tapados de más. Las oraciones
  donde el modelo no marcó el lugar se cuentan aparte: son límite del
  modelo, no de la regla.
- Además, la línea de base de calidad: las cuatro direcciones cubiertas y
  ningún otro tipo peor que antes.

Corre con el cambio implementado y commiteado en local. Va a
`mediciones/ner/`.

**Implementación (2026-10-07).** Una función pura en `ner-engine` extiende el
span sobre el texto de la página, antes de mapear a palabras. Los ocho tests
del caso 34 están con sus nombres y ningún test existente cambió. Al
implementar aparecieron dos cosas que el spec no decía y quedaron escritas
en el caso 34: cómo se cuentan y se comparan las palabras de las ventanas
(«Domicilio:» cuenta como «domicilio»), y que la dirección no se extiende
sobre una palabra de otro ángulo, para no absorber el número de un folio
girado en el margen.

### Resultado de M-D1 (2026-10-07)

Informe:
[`Altura_De_Direcciones_2026-10-07.md`](../mediciones/ner/Altura_De_Direcciones_2026-10-07.md).
Arnés nuevo: `./tests/perf/run-address-height.sh`.

Se midieron 76 oraciones en ocho categorías, y no las entre 8 y 10 por
siete del diseño: se sumó una categoría, la de un lugar seguido de un número
que no es altura ni año.

| | Regla por contexto | Tapar siempre |
|---|---:|---:|
| Alturas a la vista, de 39 con la calle marcada | 6 | 0 |
| Años tapados de más, de 9 con el lugar marcado | 4 | 9 |
| Otros números tapados de más, de 8 | 6 | 6 |

- La regla hace lo que ADR-212 dice en las 76 oraciones. Las dos corridas
  coinciden.
- Las 6 alturas a la vista son alturas con forma de año sin palabra de
  dirección: el costo aceptado a prueba.
- **Un límite que no es de la regla**: en 9 de las 48 oraciones con un
  domicilio el modelo no marcó la calle, y quedan a la vista la calle y la
  altura con cualquiera de las dos variantes.
- **Un costo de las dos variantes**: un lugar seguido de un número
  cualquiera se tapa de más («Viajó a Mendoza 3 veces» da «Mendoza 3»).
- Las oraciones de la categoría D se escribieron para que la regla fallara:
  la medición no dice con qué frecuencia aparece ese caso en un documento
  real.

**Línea de base de calidad.** Las cuatro direcciones pasan a cubiertas: 78
de 78 entidades, contra 74 de 78. Ninguna otra entidad cambia y los falsos
positivos son los mismos. El candidato no se promovió: se promueve con la
regla ya decidida, en commit propio (ADR-147 §5).

**Decidido por el mantenedor el 2026-10-07: tapar siempre.** El número que
sigue a una dirección se suma aunque tenga forma de año y no haya ninguna
palabra de dirección. No se vuelve a medir: los números de «tapar siempre»
salen de esta misma medición.

Lo que sigue:

1. Hecho: ADR-212 reescrito con la regla final y `NER_Engine.md` v1.12.0
   (caso 34 sin criterio de año ni lista de palabras; siete tests en §14).
2. El implementador saca de `ner-engine` el criterio de año y las listas, y
   ajusta los tests.
3. En commit propio, el arnés de M-D1 pasa a esperar el resultado de la
   regla final.
4. Revisor, con toda la branch.

**Pendiente aparte**: promover el candidato de la línea de base de calidad.
Pide una medición del producto final y es un cambio revisado (ADR-147 §5).

## Frente 5 — El visor al cambiar de vista (sumado el 2026-10-07)

Pedido por el mantenedor: al pasar de Original a Anonimizado, o al revés,
después de un zoom, la página se ve pixelada hasta que uno se mueve por el
documento.

**Causa.** `React_Client.md` §7 ya decía que conmutar el toggle emite un
`RENDER_REQUESTED` del nuevo lado. `PdfViewer` no lo hacía: ninguno de sus
efectos se dispara por el cambio de vista. Es un defecto contra el spec, así
que no lleva ADR; el spec ganó una precisión con la escala y el momento.

**Tarea** (`apps/react-client`, y `tests/e2e` en su propio commit):

1. El cuarto emisor de `PdfViewer`, como lo describe `React_Client.md` §7.
2. Un test de la regla y un E2E: tras un zoom y un cambio de vista, la imagen
   del otro lado llega a la escala del zoom sin tocar nada más.
3. Quitar del E2E del repintado el rodeo de «Alejar» y «Acercar», que deja de
   hacer falta.

Corre después de la implementación de emails, de a un sub-agente por vez.

**Ampliado por el mantenedor el 2026-10-07**: también se veía borroso al
activar o desactivar una entidad. Pidió arreglarlo en todos los casos.

### Resultado (2026-10-07)

Medido en la app con el ancho real de la imagen que dibuja el visor: 595 px
al 100 % de zoom y 773 px al 130 %.

| Caso, con zoom al 130 % | Antes | Después |
|---|---|---|
| Zoom en una vista y pasar a la otra | queda en 595 | 773 |
| Editar una entidad mirando Original y pasar a Anonimizado | queda en 595 | 773 |
| Cambiar el modo de reemplazo mirando Original y pasar | queda en 595 | 773 |
| Agregar una entidad a mano mirando Original y pasar | queda en 595 | 773 |
| Reanalizar desde Configuración | queda en 595 y no se corrige | 773 |
| Editar mirando Anonimizado (entidad, tipo entero, modo) | 773 | 773 |
| Zoom y edición inmediata | 773 | 773 |

«Queda en 595» era hasta el próximo zoom o scroll. Al 100 % no había
defecto visible: la escala por defecto del motor coincide con la del zoom.

**Dos causas, las dos en el cliente.**

1. Las imágenes que nacen de una edición las pide el Core para el lado
   anonimizado, a la última escala que conoce de ese lado (ADR-189). Si el
   zoom se hizo mirando Original, esa escala quedó vieja, y al conmutar nada
   volvía a pedir la imagen. Lo corrige el emisor de cambio de vista.
2. El reanálisis desde Configuración pedía la imagen sin escala. El motor la
   dibujaba a la escala por defecto y la recordaba como vigente, así que las
   ediciones siguientes también salían borrosas. Ahora la pide con la escala
   del zoom.

**Pruebas.** `viewer-kind-switch-render.spec.ts` (2 tests) y
`viewer-edit-scale.spec.ts` (7 tests) fallan sin el arreglo y pasan con él.
El E2E del repintado ya no usa el rodeo. Tests del cliente, 1073 en verde.

**Lo que queda, para decidir.** Al conmutar a una vista cuya imagen guardada
está a otra escala, se ve esa imagen estirada unos 150 a 200 ms hasta que
llega la nueva. Es consecuencia de dibujar solo el lado que se mira
(ADR-056). Evitarlo pide una decisión sobre el Core: que el motor sepa la
escala del lado que no se mira sin tener que dibujarlo, o dibujar los dos
lados en cada zoom.

**Pedido por el mantenedor el 2026-10-07: eliminar ese instante.**
[ADR-213](../../adr/ADR-213-Cambiar-De-Vista-No-Muestra-Una-Imagen-A-Otra-Escala.md),
aceptado ese día, y `React_Client.md` §7 con las reglas: al terminar un zoom se actualizan los dos lados,
y al conmutar no se muestra una imagen guardada a otra escala, sino que se
espera la nítida con un tope de medio segundo. Incluye que el pedido de
imagen lleve siempre su escala. Es todo en el cliente.

**Implementado el 2026-10-07.** `viewer-kind-switch-hold.spec.ts`, 16 tests
sobre la imagen real que dibuja el visor: 14 fallan con el código anterior y
los 16 pasan con ADR-213. Con zoom al 130 %, al conmutar ya no se dibuja la
imagen de 595 px antes de la de 773: se dibuja solo la de 773. Tests del
cliente: 1100 en verde.

**Decidido por el mantenedor el 2026-10-07: nunca se muestra la original
bajo «Anonimizado».** En ese sentido se pinta la anonimizada que haya o el
estado de carga; ADR-213 y `React_Client.md` §7 quedaron enmendados. Lo que
sigue es cómo estaba planteado. Al pasar de Original a Anonimizado,
mientras llega la imagen anonimizada a la escala correcta, la página sigue
mostrando la imagen **original** bajo la pestaña «Anonimizado». Lo normal
son 150 a 200 ms; el tope es medio segundo. Es lo que dice la regla 4 de
ADR-213, pero conviene que lo decida sabiéndolo: la alternativa es que en
esa dirección nunca se sostenga la original.

**Implementado el 2026-10-07.** `viewer-kind-switch-hold.spec.ts` pasó a 20
tests. Tests del cliente: 1108 en verde.

- Al pasar a Anonimizado se pinta la imagen anonimizada que haya, aunque
  esté a otra escala, o el estado de carga. La espera con tope vale solo al
  pasar a Original.
- **Un defecto que apareció al probar**: con la regla ya corregida, el lienzo
  conservaba los píxeles de la original uno o dos cuadros, mientras cargaba
  la imagen nueva. Ahora se vacía antes del primer pintado.
- Los helpers puros nuevos del visor están en los thresholds de cobertura
  (`vitest.config.ts`), al 100 %.

**Dos hallazgos, sin decidir.** Ninguno muestra datos sin tapar.

- **Un cuadro gris al pasar a Anonimizado.** Dura unos 16 ms y aparece aunque
  haya una imagen anonimizada guardada: el lienzo se vacía en el acto y la
  imagen guardada carga de forma asíncrona. Evitarlo pide tener las imágenes
  ya decodificadas antes de conmutar.
- **El reintento contra un dibujo lento.** Con el dibujo demorado a propósito
  1,5 s, el reintento del visor, que corre cada 700 ms, reinicia el dibujo en
  curso, y una página sin imagen anonimizada no termina de aparecer. Solo se
  vio con ese atraso artificial; no está medido cuánto tarda un dibujo real
  en un equipo lento.

## Reglas para los sub-agentes de esta branch

Las de `CLAUDE.md` y `.claude/agents/implementador.md`. En particular:

- Uno a la vez, y los gates y las mediciones en modo síncrono.
- No editan `docs/` ni commitean. Entregan el resultado al planificador.
- Una medición no corre junto con otra suite pesada.
- Ningún dato, ruta ni nombre de un documento real entra al repo ni a un
  informe.
- Si un fixture necesita acomodarse para que algo pase, es un hallazgo y se
  reporta.
