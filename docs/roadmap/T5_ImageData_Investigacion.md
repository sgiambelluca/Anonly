# ImageData nativo — utilidad y costo separado de T5

Fecha: 2026-09-15. Investigación del planificador posterior a la campaña A/B/C.
No modifica código de producto ni sustituye los gates de aceptación.

## Decisión vigente

El humano ratifica conservar un OSD compartido con una página de adelanto por
la mejora temporal observada. No condiciona esta decisión a demostrar ahorro
de RAM. La campaña A/B muestra −24,0 % en frío y −25,4 % en caliente sobre P2;
RSS es variable y no demuestra ahorro ni equivalencia estricta de memoria.
Ese porcentaje corresponde al comportamiento histórico de ImageData y no se
extrapola a otra carga de trabajo. El cierre funcional sigue pendiente de
dispose y de las pruebas de aceptación delegadas al mismo implementador Luna.

ImageData nativo se evalúa por separado. Referencia numérica y limitaciones:
[revisión A/B/C](T5_OSD_Compartido_Revision_Separados.md).

## Qué arregla

`rotateImageData` y `cropImageData` devolvían un objeto estructural compatible
con el tipo TypeScript. Chromium exige una instancia nativa en `putImageData`.
Se reprodujo de nuevo el TypeError con un objeto estructural, mientras que la
instancia nativa se acepta.

1. **Página completa girada 90/180/270:** el enderezado debe convertirse a
   canvas antes del reconocimiento principal. La imagen estructural falla en
   esa conversión; la corrección restituye ese camino de lectura.
2. **Texto girado dentro de los márgenes:** cada franja activa se gira a 90 y
   270 antes de reconocerla. La excepción estructural se absorbía por el guard
   de recuperación y se omitían las pasadas. La corrección permite ejecutarlas.

OSD identifica la orientación dominante de la página; una página derecha puede
contener un sello vertical. OSD no reemplaza el reconocimiento de ese sello.
ADR-121 documentó 2/15 palabras rotadas con la pasada derecha frente a 15/15
con las adicionales en qa-stamp.pdf. Es evidencia histórica sintética del
mecanismo, no una medición nueva ni garantía sobre expedientes reales.

## Por qué aumenta el tiempo

ADR-162 saltea únicamente franjas exactamente blancas o transparentes. Texto
horizontal dentro del 20 % lateral, un fondo gris o ruido también las activan.
La inspección anterior del P2 encontró activas sus 100 franjas. Por código,
eso permite cuatro reconocimientos adicionales por página, 200 en 50 páginas.
Este conteo se infiere del código y de los píxeles, no de contadores internos
registrados durante la campaña histórica.

Cada pasada incluye transposición RGBA, conversión a canvas, codificación PNG,
transferencia/decodificación y reconocimiento. La fuente de
[Tesseract.js 6.0.1](https://github.com/naptha/tesseract.js/blob/v6.0.1/src/worker/browser/loadImage.js)
confirma que convierte OffscreenCanvas a Blob antes de leer sus bytes.
No admite sustituir esto sin más por un objeto ImageData crudo.

B→C agrega 5,88 s en frío y 6,10 s en caliente para el documento completo,
aproximadamente 118–122 ms por página amortizados con dos reconocedores.
La suma de duración de los jobs LSTM crece unos 12 segundos; OSD permanece
alrededor de 7 segundos agregados. Estos jobs incluyen preprocesamiento y
esperas: no atribuir sus 12 segundos íntegramente al cálculo dentro de WASM.

Es esperable que ejecutar trabajo antes omitido cueste tiempo; no demuestra
que la implementación sea óptima. En P2 no hay palabras adicionales: sus
huellas completas coinciden, y no contiene el caso de sello que justifica la
funcionalidad. Medir costo y beneficio requiere también casos positivos.

## Microdiagnóstico exploratorio ejecutado

Artefactos locales reproducibles:
`.measure/t5-imagedata-investigation/native-copy.mjs` y `native-copy.json`.
Chromium headless 149.0.7827.55; kernel SHA-256
`9d3fe511e79cf939845ca5bbc86ded7a35cc8c6a55054e685c60bf40f44f2f79`.
Franja sintética de 496 × 3507, 6.957.888 bytes RGBA, patrón determinista con
alfa variable. Veinte muestras tras cuatro calentamientos, orden alternado.
Son pruebas en el hilo principal de Chromium, sin Electron, OCR ni P2.

| Operación | Mediana |
| --- | ---: |
| Copia adicional + construcción nativa | 0,7 ms |
| Construcción nativa reutilizando buffer | Por debajo de la resolución del reloj |
| Rotación actual con copia | 9,7 ms |
| Misma rotación sin copia | 8,4 ms |
| Prototipo sin copia, moviendo RGBA en bloques de 32 bits | 6,7 ms |
| PNG de este patrón sintético | 18,8 ms |

El constructor comparte el array suministrado (`image.data === pixels`). Los
buffers de salida de rotación/recorte ya se crean separados de la entrada:
una segunda copia no es necesaria solo para obtener una instancia nativa.
El prototipo de bloques conservó todos los bytes frente a la función actual
en 90/180/270 sobre esta imagen. Falta cubrir dimensiones, offsets, inputs de
tests y cancelación antes de proponerlo como implementación.

No sumar medianas independientes ni extrapolarlas a P2. El PNG usa un patrón
sintético, no texto de documento. El diagnóstico incluye asignación y GC;
no cuantifica ahorro de RSS. Tampoco demuestra que estas mejoras recuperen
los aproximadamente seis segundos de la campaña.

## Siguiente evaluación propuesta

1. **Perfil local de pasos reales**, sin telemetría en producto: separar
   decodificación de franja, rotación/copia, canvas/encode, llamada completa a
   recognize y filtrado. Casos: P2, página girada y margen con texto rotado.
   Una medición de recognize desde el host incluye serialización y esperas;
   debe nombrarse así, sin confundirla con tiempo puro de inferencia.
2. **Primera candidata conservadora:** evitar la copia redundante manteniendo
   ImageData nativo, propiedad del buffer y espacio de color. Tipar el buffer
   de salida como ArrayBuffer cuando corresponda, sin casts que oculten
   SharedArrayBuffer. Validar que ningún consumidor reutilice el buffer
   mientras Tesseract todavía lo lee.
3. **Segunda candidata:** transposición por píxel completo, conservando
   exactamente RGBA y fallback para buffers no alineados si se admiten.
   Medir separadamente contra la corrección nativa actual; no usar el camino
   roto como baseline de esta optimización.
4. Si el perfil ubica el costo en PNG, evaluar una ruta sin pérdida o el
   reciclaje acotado de superficies. No hay ahorro demostrado todavía ni se
   autoriza nueva dependencia/core modificado con este diagnóstico. ADR-160
   ya descartó `angle` de Tesseract como reemplazo de rotación ortogonal.
5. **No saltar franjas activas por intuición:** reducir pasadas mediante una
   heurística requiere resolver T-4b: baseline de calidad, corpus real con
   tinta tenue y ADR que fije el criterio. Bajar DPI no pertenece a este trabajo.

La capacidad de leer páginas giradas y sellos de margen ya forma parte del
producto especificado. Recomiendo reparar y optimizar esa capacidad; retirar
silenciosamente el arreglo conservaría un fallo funcional. Su implementación
final debe ganar aceptación de calidad, y el costo en documentos sin texto
rotado merece seguir en evaluación separada de la decisión OSD.
