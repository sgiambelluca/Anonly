<!-- CONTEXT: scope=roadmap-investigacion | dependencias=roadmap/Roadmap_1.x.md,roadmap/hardening/ADR148_Revision_Sol61_2026-10-05.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-180-Los-PDFs-Pesados-Se-Miden-Hasta-El-Archivo-Exportado.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,core/PDF_Engine.md,core/OCR_Engine.md,roadmap/memoria/PDFs_Pesados_Y_Exportacion_Plan.md,adr/ADR-202-El-Minimo-De-Region-OCR-Se-Prueba-A-25pt-Antes-De-Adoptarlo.md,roadmap/ocr/Regiones_Pequenas_25pt_Experimento_Plan.md | audiencia=humanos+IA | fase=12 -->

# OCR de regiones pequeñas — investigación previa al cambio de política

**Decisión del humano, 2026-10-05:** investigar imágenes pequeñas en una
tarea independiente de ADR-148, con mediciones de calidad y memoria.
**Estado (2026-10-05):** caracterización limitada y arnés aprobados por
Sol 6.1 después de corregir dos P2. Auditoría, 12 series de costo y control
dirigido de entidades registrados con sus límites. El humano autorizó
investigar el candidato de 25 pt; ADR-202 y spec experimental escritos.
Ejecución en [el plan de 25 pt](Regiones_Pequenas_25pt_Experimento_Plan.md).
Su primer piloto recuperó el mixed pero refutó la exclusión de trabajo
OCR en tres capas alineadas. Campaña larga detenida; fidelidad, arnés y
evidencia aprobados por Sol, adopción bajo criterios actuales rechazada.
[Resultado del piloto](../mediciones/ocr/Regiones_Pequenas_25pt_2026-10-05.md).
Auditoría y resultados se registran en
[Regiones_Pequenas_2026-10-05.md](../mediciones/ocr/Regiones_Pequenas_2026-10-05.md).
No hay un nuevo umbral de publicación aceptado. El cambio local de
runtime se autoriza solo para el experimento ADR-202, separado del gate
ADR-148 y sin modificar sus fixtures ni criterios de aprobación.
Las tres series de muchas imágenes en una página se ejecutaron en bloque
al final: son observaciones adicionales, no cumplimiento pleno del
intercalado de distribuciones. La futura campaña del prototipo debe
intercalarlas efectivamente. Aprobar la caracterización no cierra esa
validación ni las métricas completas de entidades/export del candidato.

## Problema y alcance

El caso mixto de ADR-148 coloca un DNI en una imagen de 300 × 56 pt. El
OCR independiente lee el dato; el producto no crea una región OCR porque
ADR-065 exige un mínimo de 100 pt **por lado**. Esto demuestra una
limitación de la política vigente. El fixture incompatible fue un error
del planificador, no una regresión de wiring del implementador.

La investigación debe determinar qué imágenes pequeñas contienen texto
útil, cuáles explican ya las palabras nativas, y qué costo tendría enviar
las primeras a OCR. No implementar «Validar muestra», ni OCR automático
del PDF exportado, ni cambiar umbrales para hacer pasar el gate.

## Paso 1. Auditar la admisión completa

Documentar cada filtro vigente de `PDF_Engine.md`/ADR-065 y su código:
área mínima de imagen respecto de página, grilla, dilatación de palabras,
porcentaje de área vacía, clamp al rectángulo de imagen y mínimo por lado.
El diagnóstico debe explicar en qué filtro queda cada candidato. No
suponer que bajar 100 pt resuelve imágenes descartadas por otros filtros.

Auditar también la selección de una sola región por página y las variantes
de pintado agrupado/repetido fuera del alcance de ADR-065. Para la serie
de 1/10/50 regiones, separar una imagen por página de varias imágenes en
la misma página; no presentar el costo del OCR forzado de todas como si
el pipeline actual las hubiera admitido.

Recoger de la app real: página, rectángulo de imagen en puntos, región
propuesta, causa de exclusión, `requiresOCR`, `ocrRegions`, eventos OCR,
palabras reconocidas y grupos. La observación queda en tests; no modificar
contratos ni agregar logging de contenido al Core.

## Paso 2. Corpus sintético y calidad

Conservar sin cambios el caso 300 × 56 pt y sus dos DNI. Agregar un corpus
versionado con semilla fija y truth por página/región que cubra:

- Bandas horizontales y verticales, a ambos lados del límite vigente;
  alturas de 25, 50, 56, 75, 99, 100 y 125 pt son **puntos de medición**,
  no umbrales nuevos. Ajustar contenido para que cada variante sea legible
  en su original y registrar resolución efectiva.
- Texto sensible dentro de imagen, texto neutral dentro de imagen y
  imágenes sin texto (sellos gráficos, logos, formas).
- La misma imagen con capa nativa que ya explica su texto: medir trabajo
  redundante y duplicados, no solo detección de entidades nuevas.
- Casos próximos a los filtros de área y a la grilla; distintas ubicaciones,
  rotación y resoluciones de fuente 150/200/300 dpi.

Medir separados: admisión de regiones, recall/precisión de texto y de
entidades, OCR innecesario sobre imágenes sin texto, duplicados y resultado
del PDF exportado. Para el caso de fuga, usar lectura independiente del
archivo final con control original, vecinos y sensibilidad de ADR-148.
Un original ilegible es inconcluso, nunca éxito.

## Paso 3. Costo y memoria

Primero medir baseline del producto actual. Evaluar OCR explícito sobre
las regiones excluidas desde un arnés de investigación, sin sustituir los
resultados del E2E ni presentar ese OCR forzado como política del producto.
Usar motores y assets reales. Cualquier prototipo de admisión en producto
requiere antes un ADR experimental con alcance y specs del planificador.

Comparar documentos equivalentes con 1, 10 y 50 regiones, pocas imágenes
grandes y muchas pequeñas. Windows nativo, app construida, perfil
Intermedio fijo; registrar equipo, build, hashes, frío/caliente y tres
repeticiones intercaladas como mínimo. Generar fixtures antes de medir.

Registrar regiones admitidas, píxeles procesados, tiempo OCR y tiempo a
Ready; pico total del árbol de procesos, heap observado y presión del
sistema con los límites de atribución de ADR-146/ADR-180. Separar ventanas
de importación, render, export y reposo posterior. No asumir que el pico
siempre está en la importación.

El OCR independiente de validación y el guardado de evidencia corren
**fuera de las ventanas de memoria del producto**. No sumar memoria Node
del verificador al presupuesto de Electron ni conservar sus rásters en
una corrida de medición. Informar `null` y causa si falta una observación;
no sustituir ausencia de medida por cero. No correr gates o mediciones
pesadas simultáneamente. Esperar aviso de finalización de comandos largos,
sin sondeos repetidos ni actualizaciones sin novedades.

## Entrega y decisión posterior

Entregar corpus/generador, hashes, resultados por caso, series y dispersión
de memoria/tiempo, pérdidas de detección y OCR innecesario. Proponer
alternativas sustentadas: cambiar mínimo por lado, otra regla de admisión,
o mantener límite con aviso/limitación explícita. No elegir a priori un
número ni un presupuesto aceptable por conveniencia del test.

El humano decide el costo y riesgo aceptados; el planificador escribe
ADR y specs antes de delegar el cambio por módulo. Los presupuestos
vigentes no cambian por esta investigación. Hasta entonces ADR-148 no
puede declararse aprobado con su fila mixed actual. No retirar esa fila,
marcarla skip ni modificar su expectativa para obtener verde.
