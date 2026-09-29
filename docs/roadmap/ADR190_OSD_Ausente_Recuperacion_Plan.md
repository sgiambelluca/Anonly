<!-- CONTEXT: scope=recuperacion-osd-ausente | dependencias=mediciones/ocr/ADR190_DPI_2026-09-27.md,mediciones/ocr/ADR190_OSD_Escala_2026-09-28.md,../adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md | audiencia=planificador+implementador+revisor | fase=11 -->

# Investigación de recuperación cuando el OSD no da veredicto

**Estado:** protocolo ejecutado y enmienda implementada; resultados del
pipeline en `mediciones/ocr/ADR190_OSD_Recuperacion_2026-09-28.md`.
Sol aprobó calidad y cobertura. Se implementó y revisó una mitigación de
memoria; QUALITY final pasó 128/128. Tras detener TIME, el humano autorizó
un sondeo dirigido mínimo de memoria (16 PDF escasos nativos y cuatro
controles), que completó 20/20. Después, un sondeo dirigido de TIME del
build final completó 60/60 (tres repeticiones por PDF). Sol aprobó
técnicamente B4/B5/B6 y B-1/B-4/O-9 en calidad/cobertura, y cerró la
reserva de medición temporal: el costo escaso final mediano es +2.237 ms y
+209,10 MiB de pico de suma de working sets frente al baseline. La
aceptación de ese costo residual llegó por decisión humana para cerrar la
ronda B; optimizarlo queda como posible trabajo posterior en `Future_Ideas.md`
§6. Los sondeos no son el gate de ADR-146 ni demuestran cumplimiento de su
presupuesto M2, excedido históricamente en Windows. El cap
nativo de OCR de ADR-163 y el tamaño OSD actual se conservan.

## Preguntas que debe resolver la evidencia

1. Sobre la **misma imagen de entrada**, ¿un reconocimiento a 90°, 180° o
   270° recupera nombre y DNI cuando la primera lectura a 0° es basura
   confiable? ¿Qué ángulo devuelve mejor resultado en los 16 PDFs de dos
   renglones a 150/200/250/300 DPI y cuatro giros?
2. ¿El comparador actual (cantidad de palabras con confianza ≥ 0,60 y luego
   confianza media) elegiría esa lectura frente a la basura, sin consultar
   la verdad conocida? Si falla, registrar cada par de lecturas y probar
   propuestas de ranking **fuera del producto** antes de cambiar el motor.
   El preflight a 150/300 DPI encontró que los giros 90°/270° pueden sumar
   palabras falsas confiables y ganar por cantidad, aun cuando la lectura
   limpia a 180° tiene confianza de página 0,95 y la mezcla 0. Comparar
   explícitamente el ranking actual con uno que priorice esa confianza de
   página; no confundirla con la confianza de cada palabra.
3. ¿Qué gatillo selecciona esas páginas sin convertir blanco, ruido o
   figuras en una cadena costosa o falsamente “fiable”? Estudiar OSD nulo,
   palabras de la primera pasada, distribución de confianza y `inkRatio`
   juntos. No fijar un umbral nuevo solo porque separa este corpus
   sintético: el ruido a 150 DPI dio `inkRatio=0,001093` y los dos renglones
   actuales empezaron en `0,001230`, con margen demasiado pequeño.
4. ¿Cuál es el costo de reconocimientos adicionales por página y qué casos
   no quedan resueltos aunque se prueben todos los giros?

El preflight revisado completó 40/40 observaciones con cuatro PDFs de dos
renglones y cuatro controles, producción más cuatro ángulos. En ambos PDFs
invertidos, forzar 180° recuperó 4/4 tokens y el DNI, mientras producción
a 0° devolvió 0/4 y basura con confianza de página 0,64/0,62. El revisor
validó el instrumento para extender la medición, no aprobó aún un ranking
ni la modificación del producto. Un control de figuras a 150 DPI terminó
con una falsa palabra confiable en un reintento: la matriz debe conservar
también la **salida final**, no solo la primera lectura.

## Instrumento y denominadores

Arnés opt-in en `tests/perf/`, sin cambios en el producto. Reutilizar los
64 PDFs de QUALITY y sus hashes; el subconjunto primario son los 16 de
dos renglones. Usar el **mismo ráster OCR y DPI efectivo nativo** que
`ocr-page` recibió en QUALITY, con Tesseract real y los mismos modelos.
Para cada fixture registrar una primera lectura igual a producción y
lecturas forzadas a los cuatro ángulos, sin escoger ni esconder errores.
Conservar palabras, confianza, ángulo, DPI, conteo de despachos y tiempo
de cada reconocimiento; evaluar recall/precisión de tokens y recuperación
del DNI contra el texto conocido. Cuando existan lecturas de ángulo ya
observadas por producción, verificar paridad. Calcular el hash del payload
OCR nuevo y exigir identidad entre lecturas forzadas del mismo fixture.
QUALITY anterior guardó DPI, dimensiones y longitud de bytes del ráster,
pero no su hash: cotejar esos metadatos sin afirmar una igualdad de hash
retrospectiva. El build y los 64 hashes de PDF deben coincidir con QUALITY.
No asumir que `orientation=0` implica que
el OSD acertó: registrar por separado el veredicto crudo.

La matriz ampliada cubre 64 PDFs con texto y 12 controles, cada uno en
producción y con el primer reconocimiento forzado a 0/90/180/270: **380
observaciones**. Un override del primer despacho no debe cambiar los
reintentos posteriores; registrar su secuencia completa y la salida final.
Agregar controles blanco, ruido y figuras a cuatro DPI, fuera del
denominador de aciertos con texto. Para controles informar si hay palabras
confiables falsas, qué gatillos se activarían y cuánto costarían, además
de `inkRatio`. Evaluar también las otras densidades para detectar una
posible regresión de ranking o un gatillo demasiado amplio. El informe
debe contar PDFs únicos y observaciones repetidas por separado; no tomar
una salida de OCR distinta en repeticiones como fallo instrumental sin
registrarla.

Primero preflight con dos renglones a 150 y 300 DPI, 0° y 180°, y un
control de ruido/figuras, para demostrar fidelidad del instrumento y que
el ángulo correcto realmente recupera los datos. Revisión Sol del arnés
antes de la matriz. Si el experimento valida un gatillo y ranking, el
planificador enmienda ADR-190 y `OCR_Engine.md` antes de implementación
Luna. La corrección se evalúa con E2E de recuperación y export, no solo con
un test unitario de elección de ángulo. Se requieren luego revisión Sol,
medición de calidad, tiempo y memoria de la cadena y controles negativos
para cerrar B-1/B-4/O-9.
