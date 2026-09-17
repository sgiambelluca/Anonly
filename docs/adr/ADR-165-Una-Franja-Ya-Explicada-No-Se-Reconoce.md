<!-- CONTEXT: scope=adr | dependencias=core/OCR_Engine.md,adr/ADR-121-El-Sello-Rotado-Vive-En-El-Margen.md,adr/ADR-162-Solo-Una-Franja-Visualmente-Blanca-Se-Saltea.md,adr/ADR-164-Un-OSD-Compartido-Por-Core.md,adr/ADR-149-El-Test-Que-No-Ve-El-Rojo-No-Mide.md,roadmap/Margenes_Menos_Pixeles_Plan.md,roadmap/Margenes_Menos_Pixeles_Resultados.md,roadmap/ImageData_Perfilado_Resultados.md | audiencia=planificador+implementador+revisor | fase=11 -->

# ADR-165 — Una franja ya explicada no se reconoce

- **Estado**: Accepted; implementación y medición pendientes. Se revierte si la medición de §7 no muestra el ahorro o mueve la calidad.
- **Fecha**: 2026-09-16.
- **Decidido por**: el humano autoriza implementar y medir, con la secuencia documentar → medir → implementar → medir → conservar o revertir.
- **Parte de**: campaña de márgenes, `roadmap/Margenes_Menos_Pixeles_Plan.md` §8.
- **Control BEFORE**: `3650ce7`, que ya incluye la errata v1.16.1 de `OCR_Engine.md`. No comparar contra commits anteriores: tocan la misma función.

## 1. Problema, medido

ADR-121 agregó cuatro pasadas de margen por página escaneada: dos franjas
(20 % del ancho, alto completo) reconocidas cada una a 90° y 270°. Recupera
15 de 15 palabras de un sello vertical, y es la razón por la que existe.

El perfilado del 2026-09-15 (`roadmap/ImageData_Perfilado_Resultados.md`) midió
lo que cuesta: **~301 ms por página, de los cuales 74,4 % es `recognizeCall`**.
Como cada franja es un quinto de la página, las cuatro pasadas son **el 80 % de
una página adicional leída por cada página**, y ese 80 % es estructural, no
depende del DPI.

Sobre P2 —50 páginas, sin texto rotado en márgenes— eso son **200 pasadas que
devuelven cero palabras**, unos 6 segundos de reloj.

ADR-162 ya saltea franjas, pero su compuerta es **exacta y por eso angosta**:
solo una franja donde *cada* píxel es blanco o transparente. Basta con que el
cuerpo horizontal del documento invada el 20 % lateral —el caso normal— para
que la franja quede activa. Medido: en P2 esa compuerta saltearía **0 de 100**.

## 2. Decisión

Antes de las dos pasadas rotadas de una franja, proyectar sobre ella las cajas
de las palabras que **la pasada derecha ya reconoció**, dilatadas 1 píxel. Si
no queda ningún píxel no blanco fuera de esas cajas, **las dos pasadas de esa
franja no se ejecutan**.

El fundamento no es estadístico: una franja cuya tinta está enteramente
explicada por texto ya leído no puede aportar una palabra nueva. Sus candidatas
las descartaría `intersectionRatio` de todos modos, **después** de haber pagado
el reconocimiento. Esta decisión mueve esa misma comprobación antes de pagarlo.

### 2.1 El criterio de píxel es el del producto, literal

Un píxel cuenta como presente con **el mismo predicado que `isVisuallyWhiteStrip`**
(ADR-162): `alpha !== 0 && !(r === 255 && g === 255 && b === 255)`. Exacto, sin
umbral de brillo.

Esto es explícito porque la primera medición se hizo con otro criterio —un
umbral `v < 128` tomado de ADR-164 §5.1, que es un criterio de **test**— y ese
número no era utilizable para una regla de producto: habría metido acá el
umbral de blanco aproximado que T-4b tiene frenado esperando corpus real. El
predicado se **reutiliza**, no se reescribe: una copia divergente mide otra
cosa y no avisa.

### 2.2 El único parámetro es una tolerancia geométrica de 1 píxel

La caja que Tesseract reporta es ajustada: el borde suavizado del glifo cae
fuera de ella, y el viaje de coordenadas puntos→píxeles redondea. La dilatación
de 1 píxel absorbe las dos cosas.

Tiene precedente directo en este repo: ADR-164 §5.1 usa radio Chebyshev 1 por
exactamente la misma razón, *"admite diferencias locales del rasterizado"*.

**La evidencia de que no es un número calibrado para dar un resultado** está en
la medición del 2026-09-16, sobre 112 franjas:

| | `d = 0` | `d = 1` | `d = 2..8` |
| --- | ---: | ---: | ---: |
| Franjas sin contenido propio (108) | residuo 5–94 px, mediana 38 | **0 en las 108** | 0 |
| Franjas con el sello (2) | 5.126 y 13.220 | 4.923 y 13.213 | 4.923 y 13.193 |

**Cualquier valor de `d` entre 1 y 8 toma exactamente las mismas 112
decisiones.** El parámetro tiene una sola transición con significado (0 → 1) y
después es plano en todo el rango medido. La separación entre una franja
explicada y una con sello es de **cero contra ~5.000 píxeles**: no hay zona
gris que calibrar. Se elige `d = 1` por ser el mínimo que funciona, que es
también el que menos expone al riesgo de §6.

### 2.3 Convive con ADR-162, no lo reemplaza

La compuerta de ADR-162 se conserva **antes** de esta regla. Lógicamente queda
subsumida —tinta cero implica residuo cero— pero corta al primer píxel no
blanco, así que en la práctica es casi gratis y evita proyectar cajas sobre una
franja en blanco. ADR-162 no se modifica ni se marca superado.

### 2.4 El enmascarado es solo para decidir

La franja que **sí** se reconoce recibe sus píxeles **originales, intactos**.
No se le entrega a Tesseract una imagen enmascarada. Así, sobre todo lo que se
lee, el riesgo de calidad de este cambio es exactamente cero.

### 2.5 Ante la duda, se lee

Hereda la postura de ADR-162, que falla abierta por diseño. Cualquier fallo
—proyección imposible, lectura de píxeles que tira, dimensiones incoherentes—
**no saltea**: ejecuta las pasadas como hoy. Nunca al revés.

## 3. Alcance

Solo `ocr-engine`, un commit. No cambia contratos, ni `MARGIN_STRIP_RATIO`, ni
`ROTATED_MIN_CONFIDENCE`, ni el umbral de solape, ni el guard por franja, ni
`toWords`, ni el orden de lectura, ni el DPI, ni el número de reconocedores.
No agrega campo a `OcrConfig`: como en ADR-121, no hay interruptor.

## 4. Lo que esta decisión NO es

- **No es una heurística de salteo.** No estima si "probablemente no hay nada":
  comprueba que no queda tinta sin explicar. Por eso no arrastra los
  prerrequisitos de T-4b, que siguen vigentes para cualquier regla que sí
  estime.
- **No baja el DPI ni reduce resolución** (idea I-3 del plan, no seleccionada).
- **No recorta la franja** (idea I-2, sin datos suficientes; si esta decisión se
  conserva, pierde casi todo su objeto: no se recorta lo que no se lee).

## 5. Pruebas

Filas normativas en `OCR_Engine.md` §14. Se requiere además:

1. **Discriminante obligatorio** (ADR-149 §2): un test donde la franja tiene
   tinta **no** explicada y comprueba que las dos pasadas **sí** se ejecutan.
   Contra una implementación que saltee siempre, tiene que fallar.
2. Franja cuya tinta está enteramente cubierta: cero llamadas a `recognize`
   para esa franja, y la página conserva sus palabras derechas.
3. Un píxel no blanco a 2 px de toda caja: **no** saltea. Fija que la tolerancia
   es 1 y no "un poco".
4. Fallo de la proyección o de la lectura de píxeles: ejecuta las pasadas
   (§2.5), sin evento ni error.
5. La franja que se reconoce recibe los píxeles originales, no los enmascarados
   (§2.4).
6. Conservación de la capacidad: `qa-stamp` sigue recuperando sus 15 palabras
   rotadas. **No es un test unitario del motor** y no figura en §14 de
   `OCR_Engine.md`: el `qa-stamp.pdf` del repo es un PDF nativo, con texto
   embebido, que no pasa por OCR. La comprobación corre en la **medición de
   etapa 2** (§7) sobre el rasterizado congelado
   `.measure/fixtures/qa-stamp-scanned-4ce6e18e6411309f.pdf`, donde la
   capacidad se ejerce de verdad.

## 6. Riesgo aceptado, declarado

El único modo de perder un sello es que **toda** su tinta caiga dentro de cajas
de palabras ya leídas dilatadas 1 px. Geométricamente eso exige un sello más
chico que el texto que lo tapa —ilegible de todos modos— o pegado a él dentro
de un píxel.

No apareció en 112 franjas, pero **112 franjas de cuatro fixtures sintéticos no
demuestran imposibilidad**. Se asume con su argumento, no como caso descartado.
Un escaneo real con ruido o tinta tenue deja residuo y por lo tanto **se lee**:
el modo de falla del ruido es perder el ahorro, nunca el texto.

## 7. Aceptación

Medición A/B sobre el P2 congelado, pares alternados, frío y caliente, mismo
protocolo que las campañas anteriores. Se conserva si y solo si:

- El ahorro aparece por encima del ruido, **neteado** del costo propio de la
  regla, que se paga en cada franja.
- La huella de calidad de P2 queda idéntica a `c723dace…`, 1038 palabras.
- `qa-stamp` conserva sus 21 palabras (15 rotadas + 6 sobrantes de ADR-121).

El efecto esperado (~5,9 s sobre P2) es un orden de magnitud mayor que el piso
de ruido caracterizado de esta máquina (deltas de 446 a 1693 ms que se comían
su propia mediana), así que **un resultado nulo no sería falta de potencia**:
sería que la proyección estaba equivocada. Si eso pasa, se revierte y se
informa como tal.
