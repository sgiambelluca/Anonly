<!-- CONTEXT: scope=adr | dependencias=core/OCR_Engine.md,adr/ADR-121-El-Sello-Rotado-Vive-En-El-Margen.md,adr/ADR-147-Perder-Un-Identificador-Cubierto-Es-Una-Regresion.md,adr/ADR-149-Un-Gate-Que-No-Ejecuta-Nada-Es-Rojo.md,adr/ADR-161-Una-Franja-Sin-Tinta-No-Se-Reconoce.md,roadmap/Optimizacion_De_Memoria_Plan.md | audiencia=humanos+IA | fase=11 -->

# ADR-162 — Solo una franja visualmente blanca se saltea

- **Estado**: Accepted
- **Fecha**: 2026-09-13
- **Decidido por**: El planificador, al auditar T-4 antes de entregarla al
  implementador.
- **Relacionado con**: ADR-121 (las pasadas condicionadas), ADR-147 (baseline de
  detección todavía no promovida), ADR-149 §2 (discriminante), ADR-161 (decisión
  que esta ADR acota)
- **Parte de**: Hito 11 — campaña de memoria, T-4

> **Implementada el 2026-09-13** exclusivamente en `ocr-engine`: 137/137 tests
> scoped, typecheck y ESLint del paquete verdes. La medición P2 queda pendiente
> como caracterización de magnitud, no como condición de cierre funcional.

## Contexto

ADR-161 tomó la decisión correcta —no reconocer márgenes vacíos—, pero no dejó
una tarea implementable. Su §Decisión.1 habla de dos números distintos sin
fijarlos: un *umbral de luminancia* que decide qué píxel es tinta y un mínimo de
densidad que decide qué franja corre. Su §Decisión.3 agrega que el segundo debe
quedar “por debajo del piso, con margen”, sin definir cuánto margen. Elegir
cualquiera de los tres números sería arquitectura improvisada por el
implementador.

El procedimiento tampoco se puede ejecutar hoy como está escrito:

- `tests/quality/baselines/reference-v1.json`, la baseline versionada que exige
  ADR-147, todavía no existe;
- ADR-121 ya dejó medido que no hay un escaneo real con sello rotado en el
  corpus; `qa-stamp.pdf` prueba el mecanismo, pero es texto vectorial
  rasterizado, no una muestra representativa de ruido o tinta tenue;
- sin una franja positiva real no existe el piso del que ADR-161 quería derivar
  un umbral.

Esto no autoriza calibrar sobre el fixture limpio ni elegir una tolerancia a
ojo. Sí permite separar una propiedad exacta —“la franja no contiene ningún
píxel visible distinto de blanco”— de la heurística futura —“parece lo bastante
vacía”—. La primera no necesita corpus ni concesión de calidad.

## Decisión

### 1. T-4 implementa solamente la compuerta exacta

Esta ADR **reemplaza ADR-161 §Decisión.1–3 para T-4**. La calibración por
luminancia/densidad queda diferida a T-4b (§6).

Cada franja se convierte a `ImageData` una sola vez, antes de sus dos rotaciones.
Se considera **visualmente blanca** si, para todos sus píxeles:

```text
alpha = 0
  o
(red = 255 y green = 255 y blue = 255)
```

En cualquier otro caso la franja está activa. Dicho de otro modo, un píxel es
señal suficiente para reconocer cuando `alpha > 0` y al menos uno de `red`,
`green` o `blue` es menor que 255.

No se calcula luminancia, proporción, promedio, histograma ni componente
conexa. No existe constante configurable ni campo nuevo de `OcrConfig`.

La regla cuenta un píxel negro con `alpha = 1` como señal. Es deliberadamente
más conservadora que componer y redondear contra fondo blanco: si hay alguna
contribución visible, por pequeña que sea, se conservan las pasadas. Los RGB de
un píxel totalmente transparente se ignoran porque no contribuyen a la imagen.

### 2. Se evalúa por franja y antes de ambas rotaciones

La franja izquierda y la derecha se deciden de forma independiente. El
`ImageData` que ya necesita la rotación de ADR-121 se inspecciona **antes** de
crear los rasters a 90° y 270°:

- ambos márgenes blancos: una pasada principal de reconocimiento y cero de
  margen;
- un margen activo: una pasada principal y dos de margen;
- ambos márgenes activos: una pasada principal y cuatro de margen, exactamente
  el comportamiento anterior.

OSD es una operación separada (`detect`) y no entra en el conteo anterior. Si se
cuentan todas las operaciones de Tesseract, los totales correspondientes son
2/4/6; si se cuentan solo llamadas a `recognize`, son 1/3/5. Los tests deben
nombrar cuál de los dos conteos afirman.

### 3. La incertidumbre abre la compuerta

Si por cualquier motivo no se puede obtener o inspeccionar el `ImageData` de la
franja, se conserva el comportamiento previo: se intentan sus dos pasadas bajo
el guard de ADR-121. La optimización nunca convierte un fallo del predicado en
un falso “vacío”.

Un fallo posterior de decodificación o reconocimiento conserva la semántica de
ADR-121/ADR-160: esa franja se saltea sin costar el texto derecho; una
`CancelledError` se propaga.

### 4. La salida de una franja activa no cambia

La compuerta solo decide si se entra. Para una franja activa quedan intactos:

- `MARGIN_STRIP_RATIO`;
- las rotaciones 90° y 270°;
- `ROTATED_MIN_CONFIDENCE`;
- el descarte por solapamiento;
- el mapeo de cajas, `bbox.rotation`, el orden y el guard por franja.

No cambia ningún contrato público ni la configuración. Un solo módulo:
`ocr-engine`.

### 5. Verificación obligatoria

El discriminante tiene cuatro partes:

1. una franja RGBA blanca opaca no llama a `recognize` para 90° ni 270°;
2. una franja totalmente transparente con RGB no blancos tampoco llama — esos
   canales no son visibles;
3. un único píxel `rgb(254,255,255)` opaco **sí** ejecuta ambas pasadas;
4. un único píxel negro con `alpha = 1` **sí** ejecuta ambas pasadas.

Además:

- izquierda blanca + derecha activa produce exactamente dos llamadas de margen;
- con las dos activas, las palabras, confianza, cajas y regla de fusión son las
  mismas que antes de esta ADR;
- una excepción durante el predicado abre la compuerta y no evita las pasadas;
- el test de franja blanca cuenta llamadas, no palabras: el doble devolvía vacío
  antes de la optimización y afirmar solo `words = []` sería un verde falso
  (ADR-149 §2).

El cierre de implementación se decide por estos tests determinísticos y por los
gates scoped de `ocr-engine`. La caracterización de memoria/tiempo de P2 puede
medir magnitud, pero no decide seguridad ni vuelve rojo un cambio cuyo conteo ya
demuestra que eliminó las cuatro pasadas en el caso blanco.

### 6. T-4b conserva la calibración agresiva, bloqueada

Saltear una franja con fondo gris, ruido de escáner o compresión JPEG exigiría
volver a una heurística de luminancia/densidad. Ese trabajo se llama **T-4b** y
sigue bloqueado hasta que existan simultáneamente:

1. la baseline Chromium/WASM de ADR-147 promovida y versionada;
2. al menos un escaneo real anonimizado con texto rotado tenue en el margen y su
   truth;
3. un ADR nuevo que fije fórmula, umbral de píxel, margen numérico y protocolo
   de rebaseline.

T-4 no deja constantes “temporales” para T-4b. La compuerta exacta es una
propiedad final y segura; la heurística futura, si alguna vez se autoriza, se
agrega encima como otra decisión.

## Consecuencias

**A favor**

- T-4 queda implementable sin pedirle al implementador que elija arquitectura.
- Una franja con cualquier señal visible conserva las pasadas, incluida tinta
  extremadamente tenue.
- El caso limpio elimina cuatro de seis operaciones de Tesseract por página sin
  tocar resolución, paralelismo ni salida.
- El test de conteo prueba el trabajo eliminado sin depender del ruido de RSS.

**En contra**

- Un escaneo con fondo apenas gris, ruido o artefactos conserva las cuatro
  pasadas. El ahorro real puede ser menor que el imaginado por ADR-161.
- Esta decisión no permite extrapolar el resultado de P2 a expedientes reales:
  el fixture de P2 tiene márgenes sintéticos y limpios.

**Lo que no toca**: contratos, `OcrConfig`, DPI, pools, OSD, la fusión de
ADR-121 ni el corpus de ADR-147.
