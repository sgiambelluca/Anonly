<!-- CONTEXT: scope=plan-investigacion | dependencias=roadmap/ImageData_Perfilado_Handoff.md,roadmap/T5_OSD_Compartido_Cierre_Final.md,roadmap/T5_ImageData_Investigacion.md,adr/ADR-121-El-Sello-Rotado-Vive-En-El-Margen.md,adr/ADR-160-El-Worker-De-OCR-No-Decodifica-La-Pagina.md,adr/ADR-162-Solo-Una-Franja-Visualmente-Blanca-Se-Saltea.md | audiencia=humano+planificador | fase=11 -->

# ImageData — evaluación posterior al cierre de T5

Estado: planificación iniciada el 2026-09-15; ninguna optimización de producto
implementada ni nueva mejora de rendimiento declarada. OSD compartido con una
página de adelanto permanece fijo. Este trabajo no reabre T5 ni T-6b.

## Pregunta y referencia

Determinar qué costo de ImageData puede eliminarse conservando la lectura de
páginas giradas y texto vertical de margen, y qué tradeoff de calidad/tiempo
tendría cambiar esa capacidad. La implementación nativa actual es la referencia
funcional. El comportamiento que lanzaba TypeError y omitía reconocimientos
no es un candidato de producto ni un oráculo de calidad.

La campaña previa separó OSD/adelanto e ImageData, pero no separó internamente
los ~6 segundos adicionales de preparación, codificación, transporte y OCR.
El microdiagnóstico de `T5_ImageData_Investigacion.md` apunta a copias y
transposición mejorables; sus milisegundos sintéticos no estiman el ahorro de
un PDF real ni autorizan ya un cambio del kernel.

## Secuencia

1. **Congelar la referencia funcional:** snapshot y hashes de fuentes/build,
   configuración, assets e instrumento. Para comparar P2 con el historial,
   reutilizar el PDF congelado SHA-256
   `26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f`.
   No regenerarlo con los generadores cuya metadata acaba de estabilizarse.
2. **Perfilar la referencia**, sin variantes de optimización todavía. Medir
   por página principal y por cada combinación margen/rotación: obtención y
   decodificación de franja, rotación/copia, preparación de canvas, conversión
   a PNG cuando sea observable, llamada de reconocimiento completa y filtrado.
   Registrar conteo de llamadas y palabras útiles añadidas por pasada. Usar
   relojes del mismo origen para cada intervalo; no sumar intervalos solapados
   para presentarlos como duración total ni llamar CPU al tiempo de un job.
3. **Casos mínimos:** P2 para costo sin ganancia esperada de texto; el fixture
   de páginas 0/90/180/270 para enderezado; qa-stamp rasterizado o equivalente
   sintético con ground truth para margen vertical en página derecha; márgenes
   blancos para comprobar la omisión exacta ya existente. El caso positivo
   distingue beneficio funcional de trabajo que solo devuelve candidatos
   descartados. No extrapolar estos casos limpios a ruido/tinta tenue reales.
4. **Medir tiempo y memoria:** frío/caliente separados; tiempos OCR y Ready
   válidos, pico simultáneo RSS en ventana y recursos temporales observables.
   Conservar corridas inválidas rotuladas; no seleccionar solo el mínimo ni
   interpretar ruido de RSS como ahorro o equivalencia. Comparar primero el
   mismo build con/sin instrumento para reconocer su sobrecosto.
5. **Elegir una optimización a partir del perfil**, con decisión documentada
   por el planificador antes de delegar implementación. Primera candidata:
   retirar la segunda copia RGBA de un buffer de salida ya propio. Segunda:
   mover píxeles RGBA completos en la transposición. Se implementan y miden
   por separado; no cambiar PNG/DPI, heurísticas o cantidad de pasadas junto
   con ellas. Cada una debe conservar bytes, dimensiones, espacio de color,
   propiedad del buffer y vida útil durante el reconocimiento.
6. **Aceptar o descartar cada variante:** comparación temporal/memoria con
   orden alternado, mismo trabajo y evidencia de calidad. Mantener mejoras
   demostradas sin pérdida de texto/cajas/entidades/censura. Un resultado
   inconcluso se informa como tal. Si el costo dominante sigue en pasadas
   adicionales, presentar al humano el beneficio de calidad medido y las
   alternativas con sus pérdidas explícitas antes de cambiar esa capacidad.

## Protocolo ejecutable

Los pasos 1 a 4 tienen handoff cerrado por el planificador el 2026-09-15 en
[`ImageData_Perfilado_Handoff.md`](ImageData_Perfilado_Handoff.md): instrumento,
etapas cronometradas, casos, orden de corridas, invariantes y entrega.

**Ejecutados y cerrados el 2026-09-15**, con resultados, límites y evidencia en
[`ImageData_Perfilado_Resultados.md`](ImageData_Perfilado_Resultados.md). El
reparto medido ubica ~74 % del costo de margen en las pasadas de
reconocimiento adicionales y ~0,5 % en la copia redundante. Los pasos 5 y 6
siguen sin autorizar: con el perfil hecho, la decisión sobre qué hacer —o no
hacer— con ese reparto es del humano.

## Límites y roles

El planificador diseña el instrumento y fija cualquier criterio de aceptación
faltante; este plan de investigación no es autorización para que un
implementador improvise una nueva arquitectura de instrumentación. Los
experimentos permanecen aislados del runtime entregable y de los contratos
públicos. Conservar evidencia reproducible y reportes, no telemetría permanente.

No eliminar una rotación de margen por intuición, ni introducir umbrales de
blanco aproximado: T-4b mantiene sus prerrequisitos de corpus y baseline. No
usar `angle` de Tesseract para reemplazar transposición: ADR-160 ya documenta
por qué no conserva geometría/píxeles. No empezar migración de shell ni bajar
DPI en esta fase.

La decisión sobre la implementación definitiva de ImageData queda abierta.
Conservar o retirar una capacidad debe ser una decisión consciente del humano
con evidencia de costo y texto recuperado, nunca el efecto accidental de un
error absorbido por el worker.
