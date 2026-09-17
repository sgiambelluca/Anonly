<!-- CONTEXT: scope=plan-investigacion | dependencias=roadmap/ImageData_Perfilado_Resultados.md,roadmap/ImageData_Perfilado_Handoff.md,adr/ADR-121-El-Sello-Rotado-Vive-En-El-Margen.md,adr/ADR-162-Solo-Una-Franja-Visualmente-Blanca-Se-Saltea.md,adr/ADR-163-El-DPI-De-OCR-No-Supera-Al-Raster-Fuente.md,adr/ADR-160-El-Worker-De-OCR-No-Decodifica-La-Pagina.md | audiencia=humano+planificador | fase=11 -->

# Márgenes — leer menos píxeles

Estado: **planificación**, 2026-09-16. Ninguna idea está implementada ni
autorizada a implementarse. Este documento describe tres ideas y **cómo
decidir entre ellas midiendo**, no qué hacer.

**Regla de avance fijada por el humano el 2026-09-16: primero documentar,
después medir, y recién implementar si la medición muestra que vale la pena.**
Una idea que no pasa su criterio de §5 se descarta con su número, como se
descartaron las dos candidatas de ImageData (0,54 % y 3,2 %, medidas).

## 1. De dónde sale esto

De [`ImageData_Perfilado_Resultados.md`](ImageData_Perfilado_Resultados.md)
§11. Lo que hay que tener presente, con su rótulo:

- **Medido:** las pasadas de margen cuestan ~301 ms por página escaneada, de
  los cuales **74,4 % es `recognizeCall`**. `rotate` es 10,4 %, `stripDecode`
  8,2 %, `encode` 6,6 %, la copia redundante 0,54 %.
- **Medido:** cuatro pasadas × 1,74 Mpx = **6,96 Mpx de margen por página**,
  contra 8,70 Mpx de la página misma. Se lee el 80 % de una página extra.
- **Inferido:** el costo de reconocer es **aproximadamente proporcional al
  área**. Reducir píxeles rinde en proporción; reducir la cantidad de
  llamadas conservando los píxeles, no.
- **Medido:** en P2, 200 pasadas activas y **cero palabras**. En qa-stamp,
  21 palabras que reproducen exactamente ADR-121. La capacidad sirve; el
  problema es que se paga en todas las páginas.
- **Inferido:** el motor **ya conoce** las cajas de las palabras leídas
  derechas cuando llega a las tiras; hoy las usa después del reconocimiento
  (`intersectionRatio`), no antes.

El objetivo de esta fase es **bajar el área que se le entrega a Tesseract sin
perder ninguna palabra que hoy se recupere**. No es reducir la capacidad.

## 2. Las tres ideas

### I-1 — Tapar la tinta ya explicada antes de decidir si se lee (prioritaria)

**Mecanismo.** Antes de las pasadas rotadas, proyectar sobre la tira las
cajas de las palabras que la pasada derecha ya reconoció, y mirar qué tinta
queda sin explicar. Una tira cuya tinta está **enteramente** explicada por
texto ya leído no puede aportar una palabra nueva: sus candidatas serían
descartadas por `intersectionRatio` de todos modos, después de haber pagado
el reconocimiento.

**Por qué puede ser grande.** En P2 las 100 franjas están activas porque el
cuerpo horizontal invade el 20 % lateral — que es exactamente tinta ya
explicada. Si el residuo es nulo o casi nulo, se evitan pasadas enteras, y
cada pasada evitada son 56 ms de `recognizeCall` más su `rotate`, `encode` y
`canvas`.

**Variante autorizada a medir: solo para decidir.** El enmascarado se usa
**únicamente** para decidir si la tira se lee; la tira que sí se lee recibe
**sus píxeles originales, intactos**. Así el riesgo de calidad sobre lo que
se lee es exactamente cero. La variante que le entrega píxeles enmascarados
a Tesseract **no** se mide en esta fase.

**Lo que hay que resolver antes de proponerla como implementación:** si el
residuo resulta "casi cero" en vez de cero, la regla necesita un umbral, y un
umbral de tinta es precisamente lo que T-4b tiene frenado esperando corpus
real y ADR. La medición de §4 existe para saber en cuál de los dos mundos
estamos, **no** para elegir un umbral.

### I-2 — Recortar la tira a la caja de su tinta (prioritaria)

**Mecanismo.** Hoy la tira va del borde superior al inferior de la página.
Si la tinta ocupa un tercio del alto, se le entregan a Tesseract dos tercios
de papel blanco. Calcular la caja vertical de la tinta cuesta prácticamente
nada: `isVisuallyWhiteStrip` ya recorre todos esos píxeles (0,235 ms) para
decidir si la franja está en blanco.

**Se combina con I-1.** El recorte más interesante no es el de la tinta
total, sino el de la **tinta residual** de I-1: la caja de lo que no está
explicado. Las dos se miden juntas porque salen del mismo análisis.

**Riesgo propio, distinto del de I-1:** acá sí cambian los píxeles que recibe
Tesseract. Menos margen blanco alrededor del texto puede cambiar su análisis
de layout. Hay que conservar un padding y demostrar sobre qa-stamp que las
15 palabras siguen apareciendo, además de que la huella de P2 no se mueva.

### I-3 — Menor resolución solo para las tiras (condicional, de reserva)

**Mecanismo.** El cuerpo del documento necesita 300 DPI; un sello de margen
suele ser texto grande. A media escala son la cuarta parte de los píxeles.

**Condicional por decisión del humano:** solo se mide **si I-1 e I-2 juntas
no proyectan una mejora significativa** según §5. Tiene costo de calidad
real —a diferencia de las otras dos— y es la única de las tres que puede
perder una palabra que hoy se recupera.

**Límites si llega a medirse:** es estrictamente para las tiras de margen. No
toca el DPI global, no reabre ADR-163 ni T-6a, y no sustituye a T-6b, que
sigue siendo la curva de calidad del documento completo.

### Lo que se descarta de entrada, y por qué

**Agrupar las cuatro pasadas en una sola imagen compuesta.** El costo es
proporcional al área, así que juntar llamadas conservando píxeles no ahorra
(§11.1 de resultados). Además, poner texto a 90° y a 270° en un mismo raster
es lo que ADR-121 midió que produce palabras inventadas: 33 sobrantes con las
tres pasadas de página completa.

**Usar OSD para elegir una sola rotación por tira.** Una detección de
orientación cuesta del orden de lo que cuesta la lectura que evitaría, y el
OSD compartido de ADR-164 tiene cola de concurrencia uno: cien detecciones
más competirían con el camino principal.

## 3. Qué se mide primero

**Una sola pregunta decide entre I-1 e I-2, y las dos salen del mismo
análisis de píxeles:** después de tapar la tinta ya explicada, ¿cuánta queda
en el margen de un documento normal, y dónde está?

- Si el residuo es **nulo** en buena parte de las tiras: I-1 sola resuelve, y
  con una regla **exacta**, sin umbrales — compone con la filosofía de
  ADR-162 en vez de contradecirla.
- Si el residuo es **chico pero no nulo**: I-1 necesitaría un umbral, y eso
  arrastra los prerrequisitos de T-4b. Pero I-2 se vuelve la protagonista:
  una caja de tinta residual chica es un recorte grande.
- Si el residuo es **grande y disperso**: ninguna de las dos rinde, y recién
  ahí entra I-3.

## 4. Protocolo de medición

El handoff ejecutable de M-1 + M-2 está en
[`Margenes_Menos_Pixeles_Handoff.md`](Margenes_Menos_Pixeles_Handoff.md):
instrumento, campos por tira, la correlación que decide, protocolo y entrega.
M-3 sigue sin handoff porque sigue condicional.

### M-1 + M-2 — Análisis de tinta residual y su caja (una sola corrida)

**No toca producto.** Es análisis de píxeles sobre los mismos rasters que el
motor ya produce, con la misma arquitectura de instrumento descartable que
ya funcionó: patch preservado con su SHA-256, revertido al terminar, árbol
entregable idéntico al de la referencia verificado por hash.

Por cada tira de cada página, registrar:

1. Píxeles de tinta totales y su caja (sin enmascarar).
2. Píxeles de tinta **residual** tras proyectar las cajas de las palabras de
   la pasada derecha, y su caja.
3. Fracción del área de la tira que ocupa cada una de esas dos cajas.
4. Si el residuo es exactamente cero, y si no, cuánto es.

**Definición de tinta:** la misma composición sobre blanco de ADR-164 §5.1
(`v = a*(r+g+b)/3 + (1-a)*255`, tinta si `v < 128`), reutilizada para no
inventar un segundo criterio de tinta en el repo. Declarar que ese umbral
discrimina texto negro sintético y no tinta tenue real.

**Conversión de cajas:** las palabras vienen en puntos de página; las tiras,
en píxeles del raster enderezado. La conversión tiene que ser la inversa
exacta de `toPagePoints`, y hay que **probarla con un caso construido** antes
de confiar en el histograma — una conversión mal hecha no da error, da un
residuo equivocado.

**Fixtures:** los cuatro ya congelados de la campaña anterior (P2, qa-stamp
rasterizado, T5 rotado, márgenes blancos), con sus SHA-256. No regenerar
ninguno.

**Salidas:** distribución del residuo sobre las 100 tiras de P2 (no solo la
mediana: el histograma completo y los extremos), y el caso qa-stamp, donde el
sello **tiene que sobrevivir** al enmascarado. Si el sello desaparece, la
idea está mal planteada y se reporta así.

### M-3 — Curva de calidad contra escala de tira (condicional)

Solo si §5 no autoriza ni I-1 ni I-2. Reconocer las tiras de qa-stamp a
escala 1,0 / 0,75 / 0,5 / 0,35 y contar cuántas de las 15 palabras rotadas
sobreviven en cada una, con su tiempo. El criterio de parada es la primera
escala que pierde una palabra: se elige la anterior, no esa.

## 5. Criterios de decisión

Se calcula el **ahorro proyectado** aplicando los costos por etapa ya
medidos (§11.3 de resultados) a las pasadas evitadas y a los píxeles
recortados. La proyección es una estimación, no un resultado.

| Idea | Avanza a ADR + implementación si |
| --- | --- |
| I-1 | El residuo es **exactamente cero** en una fracción de tiras que proyecte **≥ 20 %** del costo de margen, y el sello de qa-stamp sobrevive al enmascarado. Un residuo "casi cero" que requiera umbral **no** avanza: vuelve al planificador con los prerrequisitos de T-4b. |
| I-2 | La caja de tinta residual proyecta **≥ 20 %** del costo de margen, y el recorte con padding conserva las 15 palabras de qa-stamp y la huella de P2. |
| I-3 | Solo se mide si I-1 e I-2 juntas no llegan al 20 %. Avanza si existe una escala que conserva **15/15** con ahorro proyectado ≥ 20 %. |

El piso de 20 % (≈ 1,2 s sobre P2) no es arbitrario: acabamos de descartar
por medición dos candidatas de 0,54 % y 3,2 %, y un cambio que toca el
camino de lectura tiene que valer sustancialmente más que eso para pagar su
ADR, sus tests y su riesgo.

**La proyección no es aceptación.** Una idea que pasa su criterio se
implementa detrás de su ADR y **después** se mide de verdad, con pares
alternados, huella de calidad y las 15 palabras de qa-stamp, igual que la
campaña anterior. Una mejora proyectada que no aparece en la medición real
se reporta como tal y se revierte.

## 6. Límites

- Ninguna idea puede perder una palabra que hoy se recupere. La huella de
  calidad de P2 (`c723dace…`) y las 15 de qa-stamp son condición, no métrica.
- No se introduce un umbral de blanco aproximado ni una heurística de salteo
  por intuición: T-4b conserva sus prerrequisitos de corpus y baseline.
- No se cambia el DPI global, el número de reconocedores, el presupuesto de
  imágenes ni la compuerta exacta de ADR-162 sin su propio ADR.
- No se mide la variante de I-1 que le entrega píxeles enmascarados a
  Tesseract.
- Los experimentos viven en `tests/` y en patches descartables; el árbol
  entregable queda idéntico, verificado por hash.
- Sin commit ni push sin autorización del humano (I-9).

## 7. Roles

El planificador escribe el handoff ejecutable de M-1+M-2 antes de delegar,
igual que en la fase anterior: este plan **no** es autorización para que un
implementador improvise la arquitectura del análisis. La elección entre las
ideas se toma con los histogramas sobre la mesa. Conservar o recortar la
capacidad de margen sigue siendo decisión del humano.

## 8. Decisión del planificador tras M-1 + M-2 (2026-09-16)

Con los histogramas sobre la mesa
([`Margenes_Menos_Pixeles_Resultados.md`](Margenes_Menos_Pixeles_Resultados.md)),
se aplica el criterio de §5:

- **I-1 pasa, y en su forma exacta.** 110 de 112 tiras con residuo
  **exactamente cero** en dilatación 0, **cero filas** en la categoría
  descalificante (residuo cero que igual aportó palabras), el sello de
  qa-stamp sobrevive con 9.651 píxeles sin explicar, y el residuo es
  **idéntico en las cuatro dilataciones**: la tinta está claramente cubierta o
  claramente no. No hace falta umbral, así que no arrastra los prerrequisitos
  de T-4b. Proyección sobre el perfil de P2: ~100 % del costo de margen, muy
  por encima del piso de 20 %.
- **I-2 queda abierta, no descartada.** Sin datos suficientes para decidirla:
  P2 no tiene residuo que recortar y qa-stamp aporta solo dos tiras. Si I-1 se
  mantiene, I-2 pierde casi todo su objeto —no se recorta lo que no se lee—;
  si I-1 se revierte, vuelve a la mesa con una medición propia.
- **I-3 no se mide.** Su condición de activación era que I-1 e I-2 no llegaran
  al piso, y no se cumplió.

### 8.1 Orden de ejecución, fijado por el humano

1. **Primero la errata v1.16.1** de `OCR_Engine.md` (caja de margen desenrollada
   con las dimensiones equivocadas en 90/270). No es solo prioridad: **toca la
   misma función** que va a tocar I-1, `recognizeRotatedMargins`. I-1 se
   construye sobre el árbol ya corregido, no en paralelo.
2. **ADR de I-1 + su handoff**, escritos por el planificador. Hechos:
   [ADR-165](../adr/ADR-165-Una-Franja-Ya-Explicada-No-Se-Reconoce.md),
   `OCR_Engine.md` v1.17.0 y
   [`Margenes_Menos_Pixeles_Implementacion_Handoff.md`](Margenes_Menos_Pixeles_Implementacion_Handoff.md).
   La medición M-1b (§8 del handoff de medición) ubicó el resultado en el
   **Mundo B**: el criterio exacto de ADR-162 necesita una tolerancia
   geométrica de 1 px, y cualquier valor entre 1 y 8 toma las mismas 112
   decisiones.
3. **Implementación** en `ocr-engine`, un solo commit, con sus tests.
4. **Medición A/B real** del cambio implementado.
5. **Conclusión**: se mantiene o se revierte.

### 8.2 El experimento tiene potencia para detectar el efecto

Vale registrarlo antes de medir, para que un resultado nulo signifique algo. El
piso de ruido de esta máquina está caracterizado: en el perfilado de ImageData
los deltas `I − C` iban de 446 a 1693 ms según caso y métrica, y **se comían su
propia mediana**. El efecto esperado de I-1 sobre P2 es de ~5,9 s, **un orden de
magnitud por encima** de ese piso.

Es decir: si el ahorro está, esta medición lo ve. Un resultado nulo no sería
falta de potencia — sería que la proyección estaba equivocada, y eso es
información, no un empate.

### 8.3 Criterio para mantener

| Condición | Cómo se verifica |
| --- | --- |
| El ahorro aparece por encima del ruido | Pares alternados sobre el P2 congelado, frío y caliente |
| No se pierde texto | Huella de calidad de P2 idéntica a `c723dace…`, 1038 palabras |
| El sello se sigue recuperando | qa-stamp conserva sus 21 palabras (15 rotadas + 6 sobrantes de ADR-121) |
| El costo propio de la regla está neteado | I-1 **agrega** trabajo por tira; el ahorro que se informa es el neto |

Si el ahorro no aparece, o la calidad se mueve en cualquier dirección: **se
revierte y se informa como tal**. Una mejora proyectada que no se materializa
es un resultado publicable, no algo a rescatar ajustando el experimento.

### 8.4 Lo que el ADR tiene que resolver, y que la medición no contesta

- **Si la regla nueva reemplaza la compuerta exacta de ADR-162 o convive con
  ella.** Lógicamente la subsume —tinta cero implica residuo cero— pero la
  compuerta es más barata y puede quedar como atajo. Es una decisión, no un
  hallazgo.
- **Qué pasa si la proyección de cajas falla.** ADR-162 falla abierta por
  diseño: ante la duda se lee. La regla nueva tiene que heredar esa postura, no
  inventar una propia.
- **Que el enmascarado es solo para decidir.** La tira que se lee recibe sus
  píxeles originales, intactos. Esto ya estaba en §2 de este plan y no se
  relaja al implementar.
- **El único modo de perder un sello**, que hay que dejar escrito aunque sea
  razonamiento y no medición: que **toda** su tinta caiga dentro de cajas de
  palabras ya leídas. Geométricamente eso exige un sello más chico que el texto
  que lo tapa, es decir ilegible de todos modos. La medición no puede descartar
  ese caso —no apareció en 112 tiras—, así que se declara como riesgo asumido
  con su argumento, no como imposibilidad demostrada.
