<!-- CONTEXT: scope=adr | dependencias=core/OCR_Engine.md,core/Export_Engine.md,core/Contracts.md,architecture/04_Event_System.md,ui/Components.md,ui/React_Client.md,adr/ADR-090-La-Orientacion-De-Un-Escaneo-Se-Detecta.md,adr/ADR-119-La-Orientacion-Se-Detecta-Con-El-Motor-Que-La-Sabe-Leer.md,adr/ADR-121-El-Sello-Rotado-Vive-En-El-Margen.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-160-El-Worker-De-OCR-No-Decodifica-La-Pagina.md,adr/ADR-161-Una-Franja-Sin-Tinta-No-Se-Reconoce.md,adr/ADR-162-Solo-Una-Franja-Visualmente-Blanca-Se-Saltea.md,adr/ADR-163-El-DPI-De-OCR-No-Supera-Al-Raster-Fuente.md,adr/ADR-164-Un-OSD-Compartido-Por-Core.md,adr/ADR-176-Un-Choque-Pendiente-Bloquea-El-Export.md,roadmap/Revision_Por_Bloques_Hardening.md | audiencia=humanos+IA | fase=11 -->

# ADR-190 — Una página con tinta no sale vacía en silencio

- **Estado**: Aceptado e implementado, incluida la enmienda de recuperación OSD del 2026-09-28. Campaña de §7 ejecutada; cap nativo de ADR-163 conservado y costo residual aceptados por decisión humana. Riesgo residual de basura confiable con veredicto OSD aceptado por el humano el 2026-09-29 (Consecuencias).
- **Fecha**: 2026-09-27.
- **Decidido por**: el humano, a propuesta del planificador.
- **Origen**: revisión de las rondas A y B (`Revision_Por_Bloques_Hardening.md`).
  En la ronda B, B-1 y B-4.
- **Alcance**: `shared` (cinco campos de contrato: `unreadableInk`, `inkRatio`, `osdHadVerdict`, `upscale` y `coveredPages`), `ocr-engine`, `export-engine` y
  `apps/react-client`. El Orchestrator no cambia: el evento y las opciones de
  export viajan como hasta ahora.
- **Relacionado con**:
  - ADR-090, ADR-119 y ADR-164: detección de orientación;
  - ADR-161 y ADR-162: predicado de tinta;
  - ADR-163: DPI del OCR;
  - ADR-154 lever 6: la calidad no se toca sin medir;
  - ADR-176: el export que exige resolver algo antes.

## Contexto

La revisión encontró un camino por el que una página escaneada con datos
sensibles se exporta **sin anonimizar y sin aviso**:

1. Antes de leer cada página, el OCR detecta su orientación (OSD) sobre la
   imagen reducida a la mitad (`OSD_SCALE = 0.5`) y acepta cualquier ángulo
   con confianza ≥ 1 (`MIN_ORIENTATION_CONFIDENCE`). ADR-119 §4 midió que con
   imágenes chicas el OSD da confianza de 1 a 2 y **no acierta ningún
   ángulo**.
2. Con un ángulo equivocado, la página se "endereza" al revés. Tesseract
   devuelve 0 palabras o basura de baja confianza. Las pasadas de margen de
   ADR-121 rescatan como mucho las bandas superior e inferior, y con un error
   de 180° nada.
3. Se emite `OCR_PAGE_FINISHED` con `wordCount: 0`, o con un número positivo
   si es basura. No se emite `OCR_PAGE_FAILED`, y la UI no mira `wordCount`.
   Ni Regex ni NER detectan nada en esa página, y el export sale igual.

ADR-163 agranda el riesgo. Como el OCR corre a la resolución del escaneo, un
escaneo de 150 dpi le llega al OSD a unos 75 dpi, que es la zona de 0/4 que
midió ADR-119, **aun en páginas densas**. `OCR_Engine.md` §13 caso 13 suponía
que una página escasa cae debajo del piso de confianza; la observación lo
contradice.

Hay además páginas donde ningún reintento encuentra texto, aunque tengan un
dato sensible: un nombre manuscrito (Tesseract no lee manuscrita), una página
que es solo una firma o un sello, una foto, un escaneo muy malo.

El humano fijó dos criterios:

- lo que se pueda resolver automáticamente, **no** se le lleva al usuario;
- lo que no, se avisa y se pide confirmación al exportar, **salvo que la
  página ya tenga alguna entidad**, detectada o agregada a mano.

## Decisión

### 1. El OSD mide sobre un tamaño fijo, no relativo

La imagen que recibe el OSD se escala para que su **lado largo** mida
`OSD_TARGET_LONG_SIDE_PX = 1754` px, es decir A4 a 150 dpi. Es exactamente lo
que hoy recibe una página A4 rasterizada a 300 dpi con `OSD_SCALE = 0.5`, así
que el caso que ADR-119 validó no cambia. Reglas:

- El factor es `min(OSD_MAX_UPSCALE, 1754 / ladoLargoPx)` con
  `OSD_MAX_UPSCALE = 2`. Una imagen chica se agranda hasta el doble; una
  grande se reduce como hoy.
- Se aplica igual a páginas enteras y a recortes de `ocrRegions`. El tope de 2
  evita convertir un recorte chico en una imagen enorme.
- El OSD deja de depender del DPI del OCR. Por eso ADR-163 ya no puede sacarlo
  de su rango medido.

El piso de confianza (`MIN_ORIENTATION_CONFIDENCE = 1`) no cambia en este ADR.
El §2 hace que un ángulo equivocado se corrija por reconocimiento, y la
medición del §7 dirá si además conviene subir el piso.

### 2. Una lectura débil se verifica y se reintenta, sin intervención del usuario

**Lectura fiable** es la que tiene al menos una palabra con confianza ≥ 60.
Es el mismo umbral que ya usan las pasadas rotadas de ADR-121,
`ROTATED_MIN_CONFIDENCE`. Entre dos lecturas gana la que tiene **más
palabras con confianza ≥ 60**; si empatan, la de mayor confianza media.

`OcrEngine` (host), dentro del procesamiento de cada página, sigue esta
cadena. **Salvo el paso 2, cada paso corre solo si el anterior no dio una
lectura fiable:**

1. Se reconoce con el ángulo que eligió el OSD, como hoy.
2. Si la página tiene tinta (§3) y ese ángulo no era 0, **siempre** se
   reconoce también a 0° y se queda con la mejor de las dos lecturas, aunque
   la primera parezca fiable (enmienda del 2026-09-27, abajo). La excepción
   para páginas blancas o de puro ruido sigue vigente.
3. Si todavía no hay lectura fiable y la página **tiene tinta** (§3), se
   prueban los ángulos que falten entre 0, 90, 180 y 270. Se registran los
   ángulos intentados, incluido el del OSD, aunque cambie la mejor lectura
   o falle un intento. Cada ángulo se intenta una sola vez antes del paso 4.
4. Si todavía no hay lectura fiable, la página tiene tinta y el DPI efectivo
   de la página es menor que 300, se reconoce una vez más **agrandando la
   imagen** hasta 300 dpi, en el mejor ángulo encontrado. Lo agranda el
   kernel: el campo nuevo `OcrPagePayload.upscale` (§5) indica el factor, y
   las coordenadas se convierten con `dpi × upscale`.
5. Se entrega la mejor lectura de todas las que se intentaron.

> **Enmienda del 2026-09-27 (implementación).** La primera versión corría el
> paso 2 solo si el paso 1 no era fiable. Al implementar, un E2E con una
> página real de **dos renglones girada** mostró que el OSD elige mal el
> cuadrante y Tesseract devuelve **basura con confianza ≥ 60**, que cumple
> el criterio de lectura fiable. La cadena se cortaba ahí y nunca probaba el
> ángulo correcto.
>
> Por eso el paso 2 corre siempre que el OSD diga girada. Cuesta un
> reconocimiento más solo en esas páginas, y la mejor lectura se elige por
> comparación, no por umbral. El criterio de "lectura fiable" (≥ 1 palabra
> con confianza ≥ 60) queda **provisional**: la medición del §7 tiene que
> medir cuánta basura lo cumple y recalibrarlo.
>
> **Hueco conocido hasta esa medición:** si el OSD dice 0 sobre una página
> escasa que en realidad está girada y la lectura a 0° es basura confiable,
> no se prueban otros ángulos. Probarlos en todas las páginas multiplicaría
> el costo del OCR. La medición decide si hace falta un criterio mejor, por
> ejemplo la proporción de palabras confiables o la coherencia con la tinta.

> **Enmienda del 2026-09-28 (implementada y revisada en la ronda B).** La
> [campaña de recuperación](../roadmap/mediciones/ocr/ADR190_OSD_Recuperacion_2026-09-28.md)
> ejecutó el OCR real en cuatro ángulos sobre 64 PDFs con texto. El OSD no dio
> veredicto en 16 páginas de dos renglones; 12 estaban giradas. Las cuatro
> invertidas devolvieron basura confiable a 0° y ningún DNI. El `inkRatio`
> de las 16 quedó debajo de 0,002. Forzar el ángulo correcto recuperó
> exactamente los cuatro tokens en 16/16. Este camino no se resuelve
> cambiando DPI ni tamaño OSD. Un E2E adicional con otra geometría halló el
> caso complementario: OSD ausente, primera lectura vacía, tinta presente y
> basura confiable en el primer ángulo de retry; probar los cuatro ángulos
> sobre el mismo ráster dio una lectura limpia en el último (270°).
>
> El resultado interno de orientación agrega `osdHadVerdict: boolean`:
> `true` solo si el detector devolvió un ángulo válido con confianza ≥ 1;
> `false` cuando faltó veredicto o se usó el fallback a 0°. El 0° por sí
> solo no permite distinguir esos casos. El decoder host valida el booleano.
> Para **páginas enteras** con `osdHadVerdict === false`, se prueban 90°, 180°
> y 270° si la primera lectura contiene alguna palabra con confianza ≥ 0,60
> **o** `inkRatio ≥ 0,002`. El primer brazo alcanza los dos renglones aunque
> queden debajo del umbral de tinta; el segundo evita cortar la búsqueda al
> primer texto falso cuando la página sí tiene tinta. Cada ángulo se intenta una
> vez, sin upscale, con la misma imagen y DPI. Cancelación, timeout y errores
> posteriores conservan las reglas generales de esta sección. En este
> camino, entre las lecturas con alguna palabra confiable, la ganadora se
> elige primero por la confianza de página que devuelve el kernel y después
> por cantidad de palabras confiables. Si ninguna lectura es confiable, se
> conserva la primera. `pageConfidence` no incluye las palabras recuperadas por las pasadas de
> margen de ADR-121. El comparador general no cambia fuera de este camino.
> Esta rama sustituye la cadena general para esa página, para no duplicar
> reconocimientos cuando la mejor lectura termina con ángulo distinto de 0°.
> Una página sin primera palabra confiable **y** por debajo del umbral de
> tinta conserva la cadena vigente; los recortes de región tampoco entran en
> esta cadena nueva. Los cuatro controles de figuras con tinta y OSD ausente
> entran en la nueva rama; su salida y el falso `>` del upscale viejo se
> verifican en el pipeline, no se consideran corregidos por la simulación.
>
> La rama nueva suma como máximo tres reconocimientos. La suma mediana de
> sus tiempos individuales fue 3,814 s en los 16 PDFs medidos; falta medir
> tiempo y memoria del pipeline real. No se aprueba la ronda B por la
> simulación fuera de línea: el cambio debe pasar E2E de 180°/90°/270°,
> calidad, controles negativos y gates de tiempo/memoria antes del revisor.

Detalles:

- Cada paso es un despacho normal al pool, con la cancelación, los timeouts y
  la reserva de imagen de siempre. Un `CancelledError` corta la cadena.
- Un error en un paso posterior al primero **no** hace fallar la página: se
  queda la mejor lectura obtenida hasta ahí. Esto incluye un error de modelo
  ausente en un reintento; el fallo del primer paso conserva su tratamiento
  actual. La cancelación sigue siendo la excepción que corta la cadena.
- Una página que el OSD da como derecha y que el paso 1 ya lee bien paga
  cero costo extra. Una que tiene tinta y da como girada paga siempre el
  reconocimiento a 0° del paso 2. El costo cae
  solo en las páginas sospechosas, y está acotado a cuatro reconocimientos
  adicionales como máximo (pasos 2 a 4).
- Las regiones de ADR-065 siguen la misma cadena, pero sin el paso 4: un
  recorte de región ya viene de un ráster a la resolución configurada.

### 3. La tinta la mide el kernel del OSD

El kernel de orientación ya decodifica la imagen reducida. Sobre esa misma
imagen calcula `inkRatio`: la fracción de píxeles presentes, con el mismo
predicado literal de ADR-162 (`alpha !== 0` y no blanco puro). La devuelve
junto con el ángulo, en `OcrOrientationResult.inkRatio` (§5).

Si la detección de orientación falla después de medir la tinta, el fallback
de ángulo a 0° conserva el `inkRatio` medido. Solo si la medición no está
disponible se usa `inkRatio = 1` (fail-open). Un fallo del OSD no convierte
una página que ya se midió blanca en una página con tinta. Timeout,
cancelación y errores de modelo conservan su tratamiento del spec.

Una página **tiene tinta** si `inkRatio ≥ INK_PRESENT_RATIO = 0.002`, es decir
el 0,2 % de los píxeles. El valor se valida en la medición del §7 contra
páginas en blanco, con ruido de escáner y con muy poco contenido.

Las páginas blancas o de puro ruido quedan afuera. Así no se dispara ni la
cadena del §2 ni el aviso del §4.

### 4. Lo que no se pudo leer se avisa, y se confirma al exportar

Si la cadena termina sin lectura fiable en una **página entera** (no en una
región) que tiene tinta, `OCR_PAGE_FINISHED` lleva `unreadableInk: true`
(§5). En la UI:

- **El visor marca la página** con el aviso *"Esta página tiene contenido que
  no se pudo leer. Revisala: si tiene datos sensibles, no se van a tapar
  solos."*. Va en una franja fija arriba de la imagen de la página, fuera de
  ella (decisión del humano, 2026-09-29), reservada en toda página marcada:
  agregar o quitar entidades no desplaza el layout (UX-10). Si un `reanalyze` de OCR marca o desmarca una página por encima
  de lo visible, el visor ancla el scroll para que el contenido en pantalla no
  se corra (decisión del humano, 2026-09-29; `Components.md` §5.3).
- **Al exportar**, la UI arma la lista de páginas pendientes: las que tienen
  `unreadableInk` y **no tienen ninguna entidad**. Una página tiene entidad si
  algún grupo no eliminado (ADR-171) tiene una ocurrencia en ella. Da igual
  que el grupo sea automático o manual, o que esté habilitado o no.
- Si la lista no está vacía, antes de exportar se abre una confirmación que
  lista esas páginas. Por cada una se puede:
  - **ir a la página**, lo que cierra la confirmación sin exportar;
  - marcar **"Tapar página entera"**, que es la opción recomendada y queda
    preseleccionada.

  Después se confirma el export. No bloquea como ADR-176: el usuario puede
  exportar igual, pero siempre después de ver la lista.
- Una página que recibe una entidad, por ejemplo agregada a mano, sale de la
  lista sola.
- `reanalyze` con cambio de OCR recalcula la marca. `closeDocument` la borra.

### 5. Contratos (antes que el código, R-2 y R-19)

- `OcrPageFinished` gana `readonly unreadableInk?: true`.
  - Ausente equivale a `false`, igual que `degraded` en ADR-062.
  - Documentado en `Contracts.md` y en `04_Event_System.md`.
- `OcrOrientationResult` gana `readonly inkRatio: number`, en el rango `[0, 1]`.
  - Es un contrato interno entre el host y el worker de OCR, pero vive en
    `@anonly/shared`.
  - La enmienda de 2026-09-28 agrega `readonly osdHadVerdict: boolean`:
    distingue un 0° detectado del fallback 0° cuando OSD no dio veredicto.
- `OcrPagePayload` gana `readonly upscale?: number`.
  - Default 1; el rango válido es `1 ≤ upscale ≤ 300/dpi`.
  - Con `upscale > 1`, el kernel agranda la imagen decodificada y convierte
    las coordenadas con `dpi × upscale`, de modo que el `bbox` sigue saliendo
    en puntos de página (ADR-064).
- `ExportOptions` gana `readonly coveredPages?: ReadonlyArray<number>`.
  - Los índices listados se exportan como una página **enteramente negra**,
    con las mismas dimensiones.
  - Export Engine la dibuja sola, con un rectángulo lleno y sin pedir el
    render de la página, así que ningún píxel original llega al archivo.
  - Índices fuera de rango lanzan `InvalidInputError`, y los duplicados se
    ignoran.
  - Ausente o vacío deja el export idéntico al actual.

### 6. Se corrige el spec

- `OCR_Engine.md` §13 caso 13 se reescribe, porque su suposición resultó
  falsa.
- Se agregan los casos de §1 a §4.
- Se documenta la relación entre el OSD y ADR-163.
- Se corrige la numeración duplicada de §13 y §15 que señaló la revisión
  (O-2).

### 7. Después de implementar se mide, y recién ahí se decide sobre ADR-163

El protocolo de ejecución y controles está en
`roadmap/ADR190_DPI_Campana_Plan.md`. La campaña ejecutada y sus límites
están en `roadmap/mediciones/ocr/ADR190_DPI_2026-09-27.md`.

Es una campaña con documentos **sintéticos**, sin datos reales:

- **Resolución de origen**: 150, 200, 250 y 300 dpi (elegidas por el humano).
- **Densidad**:
  - página completa;
  - encabezado con nombre y DNI;
  - dos líneas;
  - bloque de firma con texto.
- **Ángulo real**: 0, 90, 180 y 270.
- **Brazos**:
  - OCR a la resolución nativa, como hoy con ADR-163;
  - OCR forzado a 300.

Se mide:

- el acierto del OSD con el tamaño fijo del §1, y la confianza;
- la calidad de reconocimiento contra la verdad conocida del fixture: palabras
  y entidades detectadas;
- cuántas lecturas con texto incorrecto cumplen el criterio provisional de
  fiabilidad (≥ 1 palabra con confianza ≥ 60), incluido el caso original de
  dos renglones girados, sin sustituirlo por una página más densa;
- cuántas veces corre cada paso de la cadena del §2 y cuánto tiempo suma;
- `inkRatio` sobre páginas en blanco y con ruido, para validar `INK_PRESENT_RATIO`;
- memoria máxima por brazo.

Con los resultados, el humano decide si ADR-163 sigue como está, si se le
pone un piso, o si se vuelve a 300. Es lo que exigía ADR-154, lever 6, y no se
había hecho.

La medición de 128 lecturas de calidad no encontró mejoras de recall ni DNI
al forzar 300 en ninguna de las 64 parejas; sí observó más tiempo y pico de
memoria en la mayoría. El humano decidió conservar el cap nativo de ADR-163.
Además, los ocho casos de dos
renglones girados 180° dieron basura confiable sin DNI en ambos brazos:
OSD sin veredicto, tinta por debajo del umbral de §3 y un solo
reconocimiento. **La condición de fiabilidad de §2 no queda validada** por
la campaña. La enmienda del 2026-09-28 corrigió el caso sin veredicto OSD; el
caso con veredicto equivocado quedó como riesgo residual aceptado
(Consecuencias).

El [sondeo posterior de escala OSD](../roadmap/mediciones/ocr/ADR190_OSD_Escala_2026-09-28.md)
comparó la mitad histórica, el tamaño
actual de §1 y el ráster nativo. El actual y el nativo dieron los mismos
48 ángulos correctos y 16 ausencias sobre 64 PDFs; las 16 ausencias son
todos los casos de dos renglones y en ningún tamaño cruzaron el umbral
de tinta. La mitad histórica empeoró 22 PDFs a DPI bajo. Aumentar la copia
OSD a nativo no resuelve este defecto y cuesta más `detect`; el informe
recomienda mantener §1. La enmienda pendiente debe ocuparse de la cadena
de reconocimiento y de la fiabilidad, no del tamaño OSD.

## Pruebas exigidas

Los nombres son exactos y entran en §14 de cada spec.

`ocr-engine`:

- `osd input is scaled to a fixed long side`: una página a 150 dpi y otra a
  300 dpi le llegan al OSD con el mismo lado largo; el factor tiene tope 2.
- `a wrong osd angle is corrected by recognizing upright`: un OSD falso que
  devuelve 180 con confianza 1 sobre una página derecha; gana la lectura a 0°.
- `a rotated osd verdict always compares against upright even when the first reading looks reliable`:
  la lectura en el ángulo del OSD trae palabras con confianza ≥ 60 (basura),
  la lectura a 0° trae más; gana la de 0°.
- `a weak reading with ink tries the remaining angles`.
- `a weak reading below 300 dpi retries upscaled`: la conversión de
  coordenadas usa `dpi × upscale` y el `bbox` queda en puntos.
- `a blank or noise-only page does not trigger retries nor unreadableInk`.
- `an unreadable page with ink finishes with unreadableInk`.
- `a readable page pays no extra dispatch`.
- `cancellation stops the retry chain`.
- `a failure in a retry keeps the best reading so far`.
- `a model-missing error in a retry keeps the best reading so far`.
- `a weak retry chain does not retry an already attempted angle`.
- `region requests do not upscale nor raise unreadableInk`.
- `orientation result reports inkRatio with the ADR-162 predicate`.
- `orientation detection failure preserves measured inkRatio`.
- `rejects orientation results whose inkRatio is outside [0,1]`.

`export-engine`:

- `covered pages are exported fully black with the same size and no page render`.
- `coveredPages with an out-of-range index throws InvalidInputError`.
- `absent coveredPages leaves the export unchanged`.

`react-client`:

- el marcador de la página aparece con `unreadableInk` y no desplaza el layout;
- la lista de pendientes excluye las páginas con alguna entidad (automática o
  manual, habilitada o no) y las que no tienen `unreadableInk`;
- la confirmación se abre solo si la lista no está vacía, y "Tapar página
  entera" viaja en `coveredPages`;
- la marca se borra con `closeDocument` y se recalcula con un `reanalyze` de
  OCR.

E2E de regresión:

- una página escasa (nombre y DNI) a 150 y a 300 dpi, derecha y girada:
  sin aviso y con la entidad tapada en el export;
- una página con tinta y sin texto legible (formas, no texto): aparece el
  aviso, la confirmación lista la página, y con "Tapar página entera" el
  export sale negro en esa página y en el resto no cambia nada.

## Consecuencias

- La cadena del §2 recupera lecturas débiles y el §4 avisa cuando una página
  con tinta sigue sin una lectura fiable. No garantiza que toda lectura
  confiable sea correcta.
- **Riesgo residual aceptado por el humano (2026-09-29).** Si el OSD **sí** devuelve un veredicto, pero equivocado (por ejemplo 0° sobre una página escasa que en realidad está girada), y la lectura en ese ángulo es basura con confianza ≥ 60, la cadena de §2 la considera fiable, no prueba otros ángulos ni marca `unreadableInk`, y la página se exporta sin tapar y sin aviso. Lo mismo vale para una página de figuras que recibe veredicto y produce un token falso confiable. No apareció en el corpus medido (§7), pero es posible. Cerrarlo exigiría reconocer todas las páginas en varios ángulos o recalibrar el criterio de lectura fiable. El humano lo aceptó como riesgo conocido para cerrar la ronda B; queda como ABIERTO en `MVP.md` (Hito 11) y como candidato de v1.0.
- **Costo aceptado por el humano:** en páginas escasas nativas, +209,10 MiB
  de pico mediano de suma de working sets y +2.237 ms de tiempo mediano
  (sondeos de cierre de la ronda B). Queda como posible optimización
  (`Future_Ideas.md` §6). No declara cumplido el presupuesto M2 de ADR-146.
- Las páginas sospechosas cuestan más tiempo, hasta cuatro reconocimientos
  extra en el peor caso. La medición del §7 lo cuantifica.
- Un documento con muchas páginas manuscritas va a mostrar varias páginas en
  la confirmación. Es correcto, porque el OCR no puede leerlas.
- **Queda abierto**: una región de imagen dentro de una página con texto
  nativo (un logo, una firma escaneada pegada) no dispara el aviso. Se decidió
  así para no avisar por cada logo; su riesgo es el mismo de antes.
- **Queda abierto**: no existe un "tapar un área" manual. En una página sin
  texto el usuario no puede seleccionar palabras para agregar una entidad, así
  que la única protección disponible es tapar la página entera. Un "tapar
  área" es una feature aparte.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Solo subir el piso de confianza del OSD | Convierte "ángulo equivocado" en "sin rotar", y pierde las páginas escasas que sí están giradas. Sin verificar por reconocimiento, cambia un error por otro. |
| Considerar fallo solo "0 palabras" | Un ángulo equivocado también devuelve basura con `wordCount > 0`. El criterio tiene que ser la confianza. |
| Reintentar agrandando desde el productor del Orchestrator | Obliga a producir y reservar otro PNG a 300 dpi en el host. Agrandar en el kernel usa la imagen que ya está y no toca el presupuesto de imágenes vivas. |
| Bloquear el export (como ADR-176) | El humano eligió avisar y confirmar. Un documento manuscrito quedaría imposible de exportar sin tapar páginas que el usuario ya revisó. |
| Avisar también por las regiones de páginas con texto nativo | Avisaría por cada logo y cada sello, y el aviso dejaría de leerse. Queda abierto. |
