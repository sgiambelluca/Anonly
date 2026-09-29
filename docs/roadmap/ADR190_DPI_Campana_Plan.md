<!-- CONTEXT: scope=campana-ocr-dpi | dependencias=adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-163-El-DPI-De-OCR-No-Supera-Al-Raster-Fuente.md,core/OCR_Engine.md,roadmap/Revision_Por_Bloques_Hardening.md | audiencia=planificador+implementador+revisor | fase=11 (protocolo pendiente de implementar y medir) -->

# Campaña de DPI y fiabilidad de OCR — ADR-190 §7

**Estado:** protocolo ejecutado; resultados en
`mediciones/ocr/ADR190_DPI_2026-09-27.md`. Fue parte del cierre de B-1 y B-4
de la ronda B: el humano conservó el cap nativo, y la lectura escasa confiable
pero falsa se corrigió con la enmienda de recuperación de ADR-190. El humano eligió las resoluciones y pidió
implementar primero los reintentos y avisos de ADR-190.

## 1. Qué se compara

La misma imagen de origen se reconoce con dos brazos:

| Brazo | Resolución de origen | DPI de reconocimiento |
|---|---|---|
| Nativo | 150, 200, 250 o 300 | El cap de ADR-163, con la cadena de ADR-190 vigente |
| Forzado a 300 | El mismo fixture del brazo nativo | 300, conservando los mismos píxeles de origen |

No se vuelve a dibujar el texto del fixture a 300 para el segundo brazo:
eso introduciría información que el escaneo original no tiene. La resolución
configurada por sí sola no anula el cap de ADR-163; el arnés tiene que
demostrar que el brazo forzado realmente reconoce a 300 y registrar el DPI
efectivo de cada despacho. A 300 de origen ambos brazos son un control de
equivalencia.

La cadena del producto se conserva en ambos brazos. Si el brazo nativo
termina reintentando con upscale, se registra; no se lo presenta como una
lectura exclusivamente nativa.

## 2. Fixtures y matriz

Fixtures sintéticos deterministas con texto y posiciones conocidos, sin
documentos reales. Se conservan los bytes y su hash entre brazos.

| Dimensión | Valores |
|---|---|
| DPI de origen | 150, 200, 250, 300 |
| Densidad | Página completa, encabezado con nombre y DNI, dos renglones, bloque de firma con texto |
| Giro real | 0°, 90°, 180°, 270° |
| Brazo | Nativo, forzado a 300 |

Son 128 combinaciones de lectura por repetición. Se agrega un control sin
texto para blanco, ruido determinista y formas geométricas; las formas
incluyen el caso de línea y elipse que produjo una falsa palabra confiable.
El caso de dos renglones se conserva aunque falle. Se registran tamaño de
página, tipografía, tamaño del texto, generación del giro y bbox de los
datos de control. Un fixture pequeño con letras grandes no reemplaza la
página de tamaño normal con poco texto.

Se registra la convención del giro del fixture y el ángulo que el kernel
necesita para enderezarlo. El acierto del OSD se compara con esa corrección,
no necesariamente con el número del giro aplicado: si el fixture gira 90°
en sentido horario y el kernel rota en ese mismo sentido, lo endereza con
270°. Un control geométrico sobre los píxeles del PDF generado fija esta
correspondencia antes de puntuar; la fórmula declarada en el fixture no es
por sí sola la prueba de la rotación aplicada.

La región recortada se verifica por separado: OSD de tamaño fijo, geometría
y ausencia de upscale y de `unreadableInk`, como exige ADR-190. No se mezcla
con la curva de DPI de página completa.

## 3. Datos que debe producir el arnés

Por combinación:

- Hash e identidad del fixture, brazo, DPI de origen y DPI efectivo.
- Ángulo del OSD, confianza e `inkRatio`; ángulo real conocido y acierto.
- Secuencia real de reconocimientos: ángulo, upscale, duración y resultado
  o error. Diferenciar reintentos de transporte del pool de los pasos de
  recuperación de ADR-190. Ningún ángulo se repite antes del upscale.
- Palabras finales contra la verdad del fixture, cantidad y confianza.
  Aplicar la misma normalización de calidad en ambos brazos y registrar sus
  reglas; una cantidad de palabras por sí sola no mide calidad.
- Entidades esperadas y recuperadas. El DNI es un control de Regex; si NER
  está desactivado, no afirmar que se midió la detección del nombre como
  entidad: solo su reconocimiento como texto. La configuración se conserva
  idéntica entre brazos.
- `unreadableInk` y resultado de fiabilidad. Contar explícitamente lecturas
  incorrectas que cumplen el criterio provisional (una palabra ≥ 60),
  separando OSD=0 de OSD distinto de 0. Un test que pasa por producir un
  reporte no significa que la lectura sea correcta.
- Tiempo total y costo de la cadena. La comparación de tiempos se ejecuta
  separada de las sondas de memoria, sobre el mismo build y fixtures.
- Pico de memoria por brazo, frecuencia de muestreo y magnitud exacta del
  instrumento existente (por ejemplo suma de working sets). La ausencia de
  muestra se informa como no observable, nunca como cero; no se atribuye
  esa suma solamente al motor OCR.

## 4. Ejecución y controles

Windows nativo, Electron y Tesseract reales del build actual. Un solo arnés
activo; no ejecutar otros benchmarks o gates durante las mediciones. Usar
los assets ya disponibles del producto y el canal de tests de ADR-155 sin
agregar configuración pública ni un control a la UI.

Los fixtures se rasterizan en un Chromium separado y se cachean antes de
iniciar las instancias de Electron medidas. Se cierra ese generador antes
de medir; generar dentro del renderer de la app contaminaría su memoria
base (precedente `tests/perf/support/scannedFixtureCache.ts`, ADR-146 §4).

El arnés puede intervenir sobre copias de los descriptores de página del
Core expuesto por `VITE_E2E`: en el brazo forzado elimina solamente
`ocrDpiCap` antes de que el Orchestrator construya los requests. La
intervención vive en `tests/perf/`, conserva los bytes originales y no cambia
el código de producto. Se registra el cap original y se verifica el DPI del
request real; no se sustituye la salida de Tesseract, ni se fabrican palabras
o resultados del OSD. El brazo nativo conserva los descriptores originales.

La observación de despachos y resultados puede envolver el transporte real
de workers desde el arnés, manteniendo sus mensajes sin cambios. Debe
registrar el resultado de `ocr-orient` y cada trabajo `ocr-page`, con su
correlación por job y página; los reconocimientos internos de márgenes no
se presentan como pasos de la cadena del host. La fase de tiempos usa la
misma observación ligera en ambos brazos, sin sonda de memoria, e informa
  esa limitación del instrumento. La integridad del registro se comprueba
  por celda: debe haber el despacho de orientación y al menos un despacho
  terminal de reconocimiento para la página o región medida. Un trabajo
  fallido o cancelado se conserva con su causa y se contrasta con el resultado
  final; una lectura completada anterior puede ser el mejor resultado válido
  cuando falla un reintento posterior, como prevé ADR-190 §2. No basta la
  presencia de cualquier trabajo para declarar la celda completamente
  observada. El control de DPI no puede ser verdadero por ausencia de
  reconocimientos.

`OcrOrientationResult` solo transporta ángulo validado e `inkRatio`; no
incluye la confianza cruda de Tesseract. Por eso la fase de **calidad**, que
incluye el preflight y una matriz completa, puede agregar una sonda CDP
desde `tests/perf/` sobre el worker hijo de Tesseract. La sonda observa sus
mensajes de salida originales y registra ángulo y confianza crudos,
correlacionados con el job de orientación del host. No cambia resultados,
umbrales ni assets y no realiza GC ni consultas de heap. Si el OSD rechaza
la operación sin producir resultado, los campos crudos son `null` con el
error correspondiente. Si resuelve con ángulo y confianza nulos, se conserva
ese mensaje y se informa la ausencia de veredicto, con una razón explícita;
no es una pérdida de instrumentación. No se inventa una confianza ni se
cuenta un fallback a 0° como acierto del detector.

La sonda CDP de confianza se apaga en las fases de tiempo y memoria. Esas
fases conservan el ángulo validado y las palabras del transporte y explicitan
que la confianza cruda no se observa allí; la calidad se cruza por hash de
fixture con su fase completa. Los tiempos de la fase con CDP no se usan como
tiempos sin sonda. Si la sonda no puede observar o correlacionar resultados
reales en el preflight, se informa el bloqueo antes de la matriz completa.

Para esta primera curva se desactiva NER y se conserva Regex para el DNI.
El nombre se evalúa como texto reconocido. Se mantiene el mismo tamaño de
pool en los dos brazos; cada brazo y repetición arranca una instancia nueva
de Electron y registra que la baja de OCR entre documentos vuelve a cargar
sus workers. La campaña es opt-in; no se agrega a los gates rutinarios ni
se modifica la configuración pública de la app.

Primero correr un preflight de los cuatro DPI, ambos brazos y el caso de
dos renglones girados. Verificar bytes idénticos entre brazos, DPI efectivo,
captura completa de resultados y control de equivalencia a 300. Después
correr la matriz completa. Para tiempos, tres órdenes intercalados AB/BA/AB
con las mismas condiciones de arranque; informar todas las corridas y la
mediana, sin elegir solamente el mejor tiempo. La fase de memoria se corre
por separado y registra el estado frío o caliente de los workers.

Los resultados crudos van en una sesión propia bajo `.measure/`. El reporte
versionable va en `docs/roadmap/mediciones/ocr/`, con revisión del código,
hash de build, versiones de runtime y modelo, fecha, instrumento y todas
las fallas. Los resultados deben permitir comparar cada pareja de brazos,
no solo promedios de densidades y ángulos distintos.

## 5. Cierre

El planificador presenta la curva de calidad, falsos positivos de fiabilidad,
tiempo y memoria. Con esa evidencia el humano decide conservar ADR-163,
poner un piso o volver a 300; si hace falta calibrar la fiabilidad o la
tinta, se escribe la enmienda antes de cambiar código.

Ni el informe histórico de 2.823 tests ni los E2E con cuatro líneas cierran
esta campaña. La ronda B conserva sus bloqueantes hasta registrar la
medición, la decisión y la verificación posterior del revisor.
