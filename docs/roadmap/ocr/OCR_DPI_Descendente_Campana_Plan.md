<!-- CONTEXT: scope=campana-ocr-dpi-descendente | dependencias=roadmap/rendimiento/Perfiles_Rendimiento_Revision.md,roadmap/ocr/ADR190_DPI_Campana_Plan.md,roadmap/mediciones/ocr/ADR190_DPI_2026-09-27.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-163-El-DPI-De-OCR-No-Supera-Al-Raster-Fuente.md,adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,adr/ADR-155-El-Arnes-De-Medicion-Configura-El-Core-Por-Un-Canal-Propio.md,core/OCR_Engine.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 (protocolo; fase 1 ejecutada, campaña cerrada) -->

# Campaña de DPI descendente: ¿puede el OCR leer a 250 o 200 dpi?

**Estado:** **cerrada el 2026-10-01.** La fase 1 se corrió en Windows y
ningún brazo pasó; el humano decidió no bajar la resolución por defecto y no
correr la fase 2 completa. Resultados y lo que la regla no pudo juzgar:
`mediciones/ocr/DPI_Descendente_Fase1_Windows_2026-10-01.md`. Lo que sigue
es el protocolo tal como se escribió antes de medir. No cambia producto,
defaults ni contratos. **Todas las mediciones
se corren en Windows nativo** (§7).

## 1. Por qué

La tanda de perfiles en Windows (`Perfiles_Rendimiento_Revision.md`,
«Lectura del `summary.json`») mostró que el pico de memoria del OCR sigue a
las páginas en proceso y a su resolución, no al tamaño del pool. Un escaneo
A4 a 300 dpi llevó el pico a 3011, 3917 y 4205 MiB con dos, cuatro y seis
reconocedores ocupados; el mismo contenido a 216 dpi quedó entre 700 y
1100 MiB por debajo a igual ocupación. Además, a 300 dpi el presupuesto de
imágenes vivas (128 MiB) frena a Alto y a Ultra en tres reconocedores.

El humano propuso leer con menos resolución. Es la palanca 6 de ADR-154 §2,
que exige medir la calidad antes de usarla. En esta aplicación, una palabra
mal leída es un dato sensible que se exporta sin tapar.

**Lo que ya se sabe.** La campaña del 2026-09-27 comparó el DPI nativo
contra 300 forzado, con escaneos de 150 a 300 dpi. Forzar 300 no mejoró
ninguna de 64 parejas, y las páginas completas se leyeron sin fallos a las
cuatro resoluciones. Eran fixtures sintéticos con Helvetica 12 limpia. **No
midió lo que esta campaña pregunta:** tomar un escaneo de 300 dpi y leerlo
a menos, con letra chica o degradada.

## 2. La pregunta, y lo que no se va a concluir

> Para un escaneo de 300 dpi nativos, ¿leer a 250 o a 200 dpi conserva
> todas las detecciones, y cuánta memoria y tiempo ahorra con dos, cuatro y
> seis reconocedores?

Fuera de alcance:

- **No decide el valor de producto.** Con los resultados, el humano elige
  entre bajar el DPI por defecto, bajarlo solo en Alto y Ultra, o no
  tocarlo. Eso va con su ADR y, si cambia `OcrConfig.dpi`, con
  `Contracts.md`.
- **No prueba el desempeño sobre «los documentos de los usuarios».** Prueba
  los corpus de §4. Lo sintético no reemplaza a lo real, y pocos documentos
  reales no son una muestra.
- **No fija techos de memoria.** Los informa.

## 3. Cómo se baja la resolución, sin tocar el producto

El Core reconoce a `min(ocr.dpi, page.ocrDpiCap)` (ADR-163). Con un origen
de 300 dpi nativos, configurar `ocr.dpi` en 250 o 200 por el canal de
overrides del arnés (ADR-155) hace que el Core rasterice y reconozca a esa
resolución. Es el mismo camino que usaría el producto: no hace falta
intervenir descriptores ni parchear nada.

El arnés tiene que **demostrar** el DPI efectivo de cada despacho
`ocr-page`, como en la campaña anterior. Un brazo cuyo DPI efectivo no es
el pedido no se informa como ese brazo.

| Brazo | `ocr.dpi` | Para qué |
|---|---:|---|
| `300` | 300 | Control: el comportamiento de hoy |
| `250` | 250 | Candidato |
| `200` | 200 | Candidato |
| `150` | 150 | **Control discriminante** (ADR-149 §2): se espera que pierda detecciones. Si no pierde ninguna en los corpus que deciden, la métrica no discrimina y la campaña se detiene (§6.5) |

## 4. Corpus

Todos con 300 dpi nativos, salvo que se indique. Los bytes de cada PDF y
su hash se conservan entre brazos.

**Sintéticos, con verdad conocida** (texto, posiciones y entidades):

| ID | Contenido |
|---|---|
| `S12` | Página completa, Helvetica 12 pt. Enlaza con la campaña anterior |
| `S10` | Lo mismo a 10 pt |
| `S8` | Lo mismo a 8 pt: notas al pie, sellos, formularios |
| `S6` | Lo mismo a 6 pt. Es el caso límite: se espera que algún brazo falle |
| `SD` | `S10` degradado como una fotocopia: desenfoque, ruido y pérdida de contraste. **Cinco variantes, con cinco semillas, y una receta que no se calibra para ningún brazo** (ver «Por qué `SD` lleva varias semillas») |
| `SE` | Dos renglones (página escasa) a 10 pt, a 0° y a 180°: el caso que ADR-190 protege |
| `SR` | **Sintético con la forma de R2**, a 300 dpi nativos (pedido del humano, 2026-10-01, porque no hay un escaneo real a 300 dpi). Veinte páginas con la misma cantidad de palabras por página que R2, redondeada a 5: 290, 300, 335, 280, 270, 315, 340, 350, 385, 295, 360, 330, 295, 290, 305, 355, 285, 150, 60 y 0. Largo medio de palabra de unos 5 caracteres y unas 9 entidades por página, como R2. Helvetica 12 pt con interlineado 1,5. La última página queda en blanco, como en R2 |

Cada página lleva entidades de todos los tipos de Regex (DNI, CUIT,
teléfono, email, fecha e IBAN) y nombres para NER, en posiciones
conocidas. Un fixture con letra grande no reemplaza al de letra chica.

**Por qué `SD` lleva varias semillas.** La primera versión del arnés
calibró una sola receta hasta que el brazo `300` leyó todas las entidades.
En el humo de desarrollo, con esa receta, 200 y 250 dpi perdieron entidades
y 150 no perdió ninguna. La causa no está verificada: puede ser un fixture
ajustado al borde para un brazo, o puede ser que bajar la resolución
promedie el ruido y lea mejor de verdad. Las dos cosas piden lo mismo:

- La receta se fija por su **aspecto** (una fotocopia legible para una
  persona) y **no se ajusta mirando el resultado de ningún brazo**.
- Se generan cinco variantes que solo difieren en la semilla del ruido.
- Los brazos se comparan por **totales contra la verdad** sobre las cinco
  variantes (§6.2), no entidad por entidad.

Las cinco variantes **no son cinco muestras independientes**: comparten el
texto, el desenfoque y el contraste. La muestra efectiva son las 16
entidades de la página, vistas con cinco ruidos. `SD` puede mostrar que una
resolución lee peor una fotocopia; no puede demostrar que lee igual de bien
todas las fotocopias.

**Reales, sin verdad conocida:**

| ID | Qué es |
|---|---|
| `R2` | El escaneado real ya usado. **Obligatorio** para que la matriz esté completa (§6.1). Su resolución nativa se infería de unos 240 dpi o menos (la corrida midió un tope de página de 201 dpi: es un escaneo de unos 200), así que los brazos `300` y `250` son el mismo despacho y solo `200` y `150` bajan de verdad: en `R2`, el brazo `250` no se evalúa y el informe lo dice |
| `R3` | Un escaneo real a 300 dpi, **si aparece**. El humano no tiene uno hoy (2026-10-01), y `SR` ocupa su lugar. Entra solo por `ANONLY_REAL_DOC_R3` y es opcional |

Para los reales la referencia es el brazo `300` del mismo documento. No se
conoce la verdad: «igual que a 300» no significa «correcto».

**Lo que `SR` es y lo que no.** Los conteos por página salen de los
agregados que el arnés ya había guardado de R2 (palabras y caracteres por
página, sin texto). `SR` copia la **densidad** de R2, no su contenido, su
tipografía ni su calidad de escaneo: es texto sintético limpio, con
entidades inventadas. Sirve para medir tiempo y memoria con una carga
parecida a la de un documento real a 300 dpi, y como un corpus más de
calidad. **No reemplaza a un escaneo real**: una fotocopia torcida, un
sello o una letra gastada no están representados más que en `SD`. Sin un
real a 300 dpi, la campaña no puede afirmar nada sobre documentos reales a
esa resolución, y el informe lo tiene que decir.

## 5. Qué se mide

### 5.1 Calidad (fase 1)

Un reconocedor, NER activado, una instancia por celda. Por corpus y brazo:

- **Entidades**, por tipo: esperadas, detectadas, perdidas y agregadas. En
  los sintéticos, contra la verdad. En los reales, contra el brazo `300`.
- **Texto**: recall y precisión de tokens contra la verdad (sintéticos).
- **Geometría**: para cada entidad presente en los dos brazos, la
  **cobertura** de la caja de referencia (la de `300`) por la caja del
  brazo (§6.3). Una caja corrida o achicada deja parte del dato sin tapar
  aunque la entidad «se detecte».
- **Cadena de ADR-190**: veredicto del OSD, `inkRatio`, pasos de
  recuperación, `upscale` y `unreadableInk`, por celda. Si bajar el DPI
  dispara reintentos con upscale, el brazo no ahorra lo que parece, y hay
  que verlo.
- **DPI efectivo** de cada despacho.

Los reportes de los reales llevan conteos por tipo y huellas, nunca el
texto ni las entidades.

### 5.2 Tiempo y memoria (fase 2)

Solo para los brazos que pasen la fase 1, más el control `300`. Sobre
`P2H` (20 páginas a 300 dpi), sobre `SR` y sobre `R3` si existe, con la fase `ultra`
de `run-ocr-pool.sh` extendida con la dimensión de DPI:

- Reconocedores: 2, 4 y 6.
- Presupuesto de imágenes vivas: 128 MiB en todos, para ver si deja de
  frenar. A 200 dpi una A4 reserva 14,8 MiB y entran ocho; a 250 dpi,
  23,1 MiB y entran cinco.
- Tres rondas intercaladas de tiempo y tres instancias frías de RSS
  natural, ocupación, huellas y cancelación, como en `ultra`.

## 6. Regla de decisión, fijada antes de medir

Reescrita el 2026-10-01 tras la revisión del arnés, que encontró caminos
por los que un brazo salía «pasa» sin cumplir la regla. El principio: **el
arnés solo puede decir «pasa» cuando midió todo lo que la regla exige.** Lo
ausente, lo inválido y lo indeterminado nunca cuentan a favor.

Cada brazo sale con uno de cuatro veredictos: **pasa**, **no pasa**,
**indeterminado** o **parcial**.

### 6.1 La matriz tiene que estar completa

Corpus que deciden: `S12`, `S10`, `S8`, `SE`, `SR`, `R2` y `SD` (sus cinco
variantes juntas). `S6` se informa aparte y no decide. `R3` es opcional:
si está en la matriz, decide como un corpus más; si falta, la matriz igual
puede estar completa.

- Si falta cualquier corpus que decide, o alguna de sus celdas, todos los
  brazos salen **parcial**. Un humo, o una corrida con un subconjunto de
  corpus o sin `R2`, nunca emite «pasa».
- Un corpus con una celda inválida deja ese corpus **indeterminado**.
- **Brazo no efectivo en un corpus real.** Si en ninguna página de un real
  el DPI efectivo es el pedido (el `250` sobre `R2`), el brazo **no se
  evalúa** en ese corpus: no aprueba ni reprueba ahí, y la línea final lo
  nombra. Su despacho es el mismo que el de `300`, así que si aun así
  difiere del control, se informa como **control inconsistente**.
- **Brazo parcialmente efectivo.** Si el DPI pedido se aplicó en unas
  páginas y en otras no, el corpus queda **indeterminado** para ese brazo, y
  el informe dice en cuántas páginas fue efectivo. La resolución de `R2` es
  una inferencia; si sus páginas tienen topes distintos, hay que verlo antes
  de concluir.
- **En los sintéticos todo brazo tiene que ser efectivo.** Son de 300 dpi
  nativos. Un brazo que no se evalúa en algún sintético que decide queda
  **indeterminado**: nadie pasa habiendo sido medido solo en parte de la
  matriz.

### 6.2 Criterio 1: entidades

**Corpus limpios y reales** (`S12`, `S10`, `S8`, `SE`, `SR`, `R2`), por
separado:

- **Piso del control.** Las dos repeticiones de `300` tienen que detectar
  exactamente las mismas entidades. En los sintéticos tienen que detectar
  además al menos el 90 % de las entidades de la verdad. Si no, el control
  no sirve de referencia: el corpus queda **indeterminado** y el fixture se
  revisa.
- **El brazo no pasa** si pierde una sola entidad que `300` detecta.
- Una entidad que `300` también pierde no se le carga al brazo, y se
  informa.

**`SD`**, sobre las cinco variantes juntas (80 entidades en total):

- **Piso del control.** `300` tiene que detectar al menos el 90 % de las 80.
  Si no, `SD` queda **indeterminado**: una fotocopia que el OCR de hoy ya
  no lee no puede aprobar a nadie.
- **El brazo no pasa** si su total de entidades perdidas contra la verdad
  es mayor que el de `300`.
- Con un total igual o menor, pasa. No hay compensaciones ni «no
  concluyente»: se comparan dos totales. El detalle por variante se informa.
- **Límite aceptado a sabiendas:** con totales, un brazo puede pasar
  habiendo perdido entidades que `300` lee, si `300` pierde otras tantas.
  El piso permite hasta 8 de cada lado. Es el precio de no confundir ruido
  con resolución en una fotocopia; el informe muestra siempre qué entidades
  perdió cada uno, para que el humano lo vea.

Un brazo que no pasa solo en `SD` **no pasa**.

### 6.3 Criterio 2: cajas

Lo que importa es cuánto del dato queda tapado. La métrica es la
**cobertura**: la fracción del área de la caja de referencia (la de `300`)
que queda dentro de la caja del brazo. Una caja que crece no penaliza; una
que se achica o se corre, sí.

- **El brazo no pasa** si alguna entidad tiene una cobertura menor que el
  umbral.
- **El umbral es 0,95** (decisión del humano, 2026-10-01): la caja del
  brazo tiene que cubrir al menos el 95 % de la caja de `300`. Es una
  constante del arnés, no un parámetro libre. La línea final muestra el
  umbral aplicado.
- Se puede pasar otro valor para **explorar**, pero entonces ningún brazo
  sale «pasa»: quedan **indeterminados**, con la salvedad a la vista. Un
  valor que no sea un número entre 0 y 1 se trata igual.
- Una entidad presente en los dos brazos sin caja medible deja el corpus
  **indeterminado**.
- Se informa además la cobertura entre las dos repeticiones de `300`, como
  referencia de cuánto varía el propio control.

### 6.4 Criterio 3: la cadena de ADR-190

El brazo no pasa si tiene más páginas con `unreadableInk` o más pasos de
recuperación que la **peor** de las dos repeticiones de `300` en el mismo
corpus.

### 6.5 Control discriminante

El brazo `150` tiene que perder al menos una entidad que `300` detecta en
algún corpus que decide **donde `150` fue efectivo** (`S6` no cuenta, y un
corpus donde no se despachó a 150 dpi tampoco). Si no pierde ninguna, sea cual sea
su veredicto, **la campaña se detiene**: la línea final dice
`DETENER-CAMPANA` y ningún brazo sale «pasa». Una métrica que no ve fallar
a 150 dpi no demuestra que 200 dpi esté bien.

### 6.6 Veredicto del brazo

- **parcial**: la matriz no está completa (§6.1).
- **no pasa**: falla algún criterio en algún corpus que decide.
- **indeterminado**: no falla ninguno, pero algún corpus o criterio quedó
  indeterminado.
- **pasa**: matriz completa, control discriminante en orden, y los tres
  criterios cumplidos en todos los corpus donde el brazo se evalúa.

El informe muestra siempre, además, las pérdidas **contra la verdad** de
cada brazo, incluido `300`: una lectura dice si bajar la resolución
empeora, la otra si el OCR ya falla hoy.

## 7. Ejecución y validez

- **Banco: Windows nativo, para las dos fases** (decisión del humano,
  2026-10-01). Es el i5-12400 de 12 hilos y 16 GB de las tandas anteriores,
  con Git Bash. El rasterizado con GPU cambia los píxeles que recibe
  Tesseract (`mediciones/transversal/OCR_Entre_Plataformas_Medicion.md`),
  así que la calidad vale para la plataforma donde se midió: las
  conclusiones son de Windows y no se extienden a macOS sin medirlo ahí.
- **macOS no mide.** El arnés se desarrolla y se revisa en la Mac. El
  implementador corre ahí un humo para comprobar que arranca, aplica el
  DPI pedido y escribe sus archivos. Esos números no se informan ni se
  comparan con los de Windows.
- **El arnés nace portable.** Corre en Git Bash con la biblioteca de
  plataforma de `run-ocr-pool.sh` (`tests/perf/support/ocr-pool-platform.sh`):
  detección y prevención de suspensión con señal positiva, guarda de
  procesos, rutas `C:\...` y salvedades en el resumen. Tiene un modo de
  humo corto, que es el primer paso en Windows.
- **Sin producto.** El arnés vive en `tests/perf/`, usa el canal de
  ADR-155 y no cambia `apps/` ni `packages/`.
- **En serie**, una instancia fría por celda, sin otra medición ni suite
  en paralelo, con la detección de suspensión activa y sus salvedades a la
  vista.
- **Datos reales.** Solo por `ANONLY_REAL_DOC_*`. Nada de rutas, nombres,
  texto ni entidades en el repo ni en los reportes.
- **Continuaciones.** Si la matriz se completa con más de una carpeta, cada
  corpus se toma **entero de una sola carpeta**, y las salvedades y la
  detección de suspensión de **todas** las carpetas llegan al resumen. Una
  continuación sin detección de suspensión deja la salvedad, aunque la
  primera carpeta la haya tenido.
- **Inválido no es cero.** Una celda que no llegó a `Ready`, sin despacho
  observado o con DPI efectivo distinto del pedido se informa como inválida.
- **El arnés se revisa antes de la matriz**, con un preflight chico y su
  control, como en la campaña anterior.

## 8. Qué se entrega

1. El arnés y sus tests unitarios, revisados.
2. Un informe en `mediciones/ocr/`, con las tablas de calidad por corpus y
   brazo, la de tiempo y memoria, las celdas inválidas y las salvedades.
3. Para el humano: qué brazos pasan, cuánta memoria y tiempo ahorra cada
   uno por perfil, y las opciones de producto con su costo. La decisión es
   suya.

## 9. Lo que necesita del humano

- ~~Un escaneo real a 300 dpi (`R3`).~~ El humano no tiene uno; se usa el
  sintético `SR`. Si aparece uno más adelante, se suma sin cambiar el arnés.
- **Correr las dos fases en Windows**: primero el humo, después la fase 1
  de calidad y, con los brazos que pasen, la fase 2 de tiempo y memoria.
