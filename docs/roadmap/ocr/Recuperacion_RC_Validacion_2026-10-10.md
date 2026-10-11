<!-- CONTEXT: scope=validacion-rc | dependencias=core/OCR_Engine.md,adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md,adr/ADR-218-El-Costo-De-RC-Se-Mide-Sin-Forzar-Todas-Las-Paginas.md,roadmap/hardening/Confianza_Cierre_2026-10-08.md,tests/perf/README.md | audiencia=planificador+implementador+revisor | fase=12 -->

# RC adoptado — validación antes de cerrar

RC fue aceptado el 2026-10-10; SV/CP quedó diferido hasta disponer de más
documentos/escaneos, con riesgo residual aceptado para esta actualización
([decisión y retoma](Orientacion_SV_CP_Retoma_2026-10-10.md)). Este protocolo
concreta el item 39 de `OCR_Engine.md` v1.18.0. No amplía producto ni fixtures.
Cada suite/campaña corre en serie, sin competir con otra medición.

## Código y pruebas focalizadas

El primer cambio del implementador pasó 229/229 pruebas OCR, cobertura de
líneas 96,62% y ramas 86,83%, lint, tipos y formato focalizados. El
discriminante falló con el predicado anterior (solo un despacho) y volvió
a verde tras restaurar RC. La auditoría del planificador comprobó que el
diff de producto es exclusivamente la cláusula aprobada. Se refuerzan
además identidad de imagen, ausencia de evento de éxito tras cancelación
y orden del depósito de la clave exacta. No acredita todavía el item completo.

## N1 en el pipeline y export reales

Agregar `tests/e2e/adr190-rc-single-line-export.spec.ts`, sin modificar el
E2E histórico de dos renglones. Nombre de la prueba:
`ADR-190 RC: N1 natural a 150/300 dpi y giros físicos 90/270 recupera el DNI y lo tapa en el export`.

Reusar las cuatro entradas N1 y el generador/cache de M-O1: A4, Helvetica
12, un solo renglón centrado «Juan Perez DNI 34.567.891», raster físico
a 150/300 dpi y giro 90/270. En esta validación local, usar el cache anterior
y comprobar sus hashes contra el manifiesto M-O1. El E2E permanente también
puede regenerar con esa receta si el cache no existe (por ejemplo en CI):
`scannedPdf.ts` fecha el PDF al generarlo, por lo que no se fija un hash
binario antiguo como requisito de regeneración. Registrar esa identidad y
exigir la geometría/contenido de la receta; no cambiar el generador ni
normalizar esta campaña. No reemplazar por `/Rotate`, dos renglones ni una página pequeña. Generar
en Chromium separado y cerrarlo antes de Electron. Los datos son inventados.

Usar app y OCR reales con NER desactivado (el DNI de control es Regex).
El observador puede registrar transporte, pero no forzar orientación,
tinta, palabras ni resultados. En cada combinación exigir:

- Ready, sin error/aviso de página ilegible, DNI detectado y palabras en cache.
- OSD natural sin veredicto, primera lectura vacía, `0 < inkRatio < 0.002`;
  cuatro despachos 0/90/180/270, misma imagen/DPI y escala 1. El resultado
  natural coincide con el entregado; no hay instrumento que active RC.
- Distinguir DPI nominal del fixture y DPI efectivo. ADR-163 exige
  `cap = ceil(72 * max(wpx / anchoPt, hpx / altoPt))` y
  `effectiveDpi = min(300, cap)`. Con la receta A4 y sus dimensiones
  raster redondeadas hacia arriba, los nominales 150/300 producen caps
  151/301 y DPI efectivos 151/300, respectivamente. Verificar esos valores
  exactos desde la geometría de la receta (con ejes intercambiados al girar),
  registrar cap y DPI efectivo, y exigirlo en los cuatro despachos. No usar
  una tolerancia genérica de un DPI respecto del nominal.
- Control geométrico de tinta en el DNI del original y solapamiento de la
  caja detectada con ese lugar conocido del fixture. El giro físico debe
  aplicarse a esa geometría, pues no existe `/Rotate` que lo haga por ella.
- Elegir «Tapar con negro» mediante la UI, exportar mediante el diálogo
  real y leer los bytes finales. Muestrear la región del DNI en el PDF
  exportado con el instrumento de `scannedPdf.ts`, exigiendo cobertura
  negra del dato (mismo criterio de los E2E ADR-190). No basta el preview.

Si cambia una precondición natural o el DNI queda descubierto, reportar
hallazgo; no facilitar el fixture, bajar un umbral ni cambiar producto
para verde. El gate independiente de ADR-148 se ejecuta por separado y
mantiene su propio criterio; este E2E no sustituye esa lectura independiente.

**Resultado N1 (2026-10-10, provisional).** La ejecución serial corregida
en `.measure/adr190-rc-n1-adr163-exact` pasó las cuatro combinaciones con
los mismos hashes de M-O1. Cada primera lectura tuvo cero palabras, OSD
sin veredicto y tinta natural entre 0,001198 y 0,001847. Los cuatro giros
usaron una misma imagen, escala 1 y DPI exactos 151/300 según ADR-163;
la clave exacta de cache contenía cuatro palabras al emitir el único
evento de página terminada. El DNI fue detectado y la cobertura negra del
PDF final fue 0,625–0,75 (criterio vigente ≥ 0,6).
El intento previo que usaba tolerancia de DPI quedó conservado aparte y
no es la evidencia final. El build es normal con `VITE_E2E=1`, renderer
`bb2c7281e486e67596662eecabe9528bb5505d20175f4878bd2396eaeef4a88e`
y fuente OCR `fce7cd304847b0dc964f95ab99be58e60487a538e4b14799e920871d116174f7`.
Las seis regresiones posteriores pasaron en serie: página escasa 1/1,
dos renglones 3/3, calidad 3/3, figuras 4/4, cubierta ilegible 1/1 y
scroll 1/1; sus logs están en `regressions/` de esa carpeta. Este resultado
no acredita por sí solo la caracterización, calidad normativa, costo ni
revisión del lote. Calidad y costo se registran separadamente abajo.

Ejecutar después, uno por uno, los E2E afectados de ADR-190: página escasa,
dos renglones sin veredicto, calidad, figuras, cubierta de página ilegible
y anclaje de scroll. Preservar sus controles históricos.

## Caracterización, calidad y costo

Repetir M-O1 completo en carpeta nueva con RC: 700 observaciones, los 140
PDF exactos y comparación contra la línea de base. Separar los cuatro N1
recuperados de cualquier otro cambio de palabras, entidades o avisos. RC
no cierra el riesgo de los veredictos equivocados; informar los residuos.
No mezclar resultados viejos para aparentar completitud.

La comparación M-O1 usa las observaciones registradas: palabras/confianzas,
despachos, OSD/tinta, indicador de DNI y aviso. El crudo no conserva todas
las entidades ni sus valores/cajas y esta campaña no exporta. La geometría
y el PDF final N1 se acreditan en el E2E separado; no se deducen del
indicador de detección de M-O1.

La calidad normativa debe mantener sus controles y baseline. No recalibrar
baseline ni receta para aprobar el cambio. Si se altera detección o memoria
fuera del alcance esperado, volver al planificador con el hallazgo.
El recorrido normativo de detección usa `tests/measure/baseline.spec.ts`
en Chromium con NER activo, etiqueta nueva, luego `generate-candidate.ts`
y `gate.ts` contra `tests/quality/baselines/reference-v1.json`. Conservar
el candidato y sus crudos separados de la baseline; no promoverlo. Los
fixtures escaneados específicos quedan cubiertos por los E2E ADR-190 y M-O1.

**Calidad normativa (2026-10-10, provisional).** El crudo
`.measure/rc-adoptado-20261010-calidad.json` cubrió los 26 documentos;
su candidato pasó el comparador contra `reference-v1.json` sin promoverlo.
La auditoría comprobó identidad de corpus, modelo, runtime `chromium-wasm`
y configuración `medium`/NER activo. Las 78 entidades conservaron cobertura
y tipo; los 18 falsos positivos coinciden con la referencia y no hubo
documentos fallidos. Logs y candidato quedaron bajo la misma etiqueta.

La confirmación de costo usa `ANONLY_RC_SOURCE_MODE=adopted`, ocho smoke
y doce corridas A/RC de R1/P2N, según ADR-218 y su protocolo. El renderer
RC coincide con el build normal; A solo elimina RC durante el build.
Se informa presión desconocida cuando no está disponible, rangos, máximos,
ruido de 345 MB y memoria posterior a Ready por separado.

**Smoke adoptado (2026-10-10, provisional).**
`.measure/rc-isolated/smoke-20261010-adopted-v1` terminó 8/8 válido, sin
incidencias. La auditoría de los crudos fríos/calientes confirmó los cuatro
N1 recuperados, blanco exacto con una lectura y ruido con cuatro lecturas
solo en RC, sin upscale ni aviso inventado. Orientación y tinta permanecieron
naturales. Fuente RC idéntica y renderer normal/RC iguales al hash indicado
arriba; el brazo A quitó exclusivamente la cláusula RC. Identidad confirmada
al inicio/cierre, sello `finished`, detección de suspensión positiva en ambos
extremos y sin reanudación. La limpieza registró ambos dist restaurados.
El smoke no sustituye las doce corridas de costo ni la caracterización.

**Costo adoptado (2026-10-10, provisional).** Las doce corridas de
`.measure/rc-isolated/campaign-20261010-adopted-v1` fueron válidas, sin
faltantes, incidencias ni fallas. La auditoría confirmó modo, fuente y
renderer RC normal, guardas al inicio/cierre, ausencia de suspensión e
identidad/restauración de ambos dist. R1 agregó 1,185/0,952 s hasta Ready
y P2N 19,452/18,713 s (frío/caliente). La diferencia M2 de R1 quedó dentro
del ruido; P2N frío aumentó 470,8 MB con rangos separados y caliente
351,5 MB con rangos superpuestos. Presión por importación desconocida
en las 24 ventanas; los extremos de tanda no la sustituyen. Se conservaron
RSS y asentamientos calientes positivos. Solo las páginas elegibles
recibieron despachos extra; hashes de texto, cantidades de palabras,
conteos de entidades por tipo y avisos no cambiaron. Esos conteos no
comparan valores/cajas ni acreditan el export. Ver el
[informe](../mediciones/ocr/Costo_RC_Aislado_2026-10-10.md).

**Caracterización RC completa (2026-10-10, provisional):**
`.measure/osd-verdict/campana-m-o1-rc-20261010` registra 700/700
observaciones y 140/140 PDF, sin faltantes, duplicados, inesperados,
incidencias ni fallas. Los 140 hashes coinciden con la campaña anterior.
La comparación independiente del planificador, excluyendo solo los tres
campos de tiempo, encontró 692 registros idénticos y ocho cambios previstos:
los cuatro N1 se recuperan y cuatro controles de ruido pasan de una a cuatro
lecturas sin modificar su resultado final ni inventar avisos. No hay otros
cambios semánticos en la proyección registrada.

En producción queda texto esperado en 124/128 páginas; los cuatro N4
restantes no se recuperan. El ensayo de orientación equivocada forzada
conserva los 194/384 casos sin texto esperado ni aviso, incluidos 16 con
indicador de DNI esperado. No se leyó el export en M-O1: no se convierten
esos residuos en una afirmación de datos visibles en él.

Las seis identidades `first/current` coinciden, las nueve tandas terminaron
sin fallas y la detección de suspensión quedó disponible, sin incidencias.
La única salvedad registrada es el producto sin commit. El planificador
verificó por hash ambos dist restaurados contra sus copias originales;
renderer `bb2c7281e486e67596662eecabe9528bb5505d20175f4878bd2396eaeef4a88e`
y shell `37019a291b47c65bd9546903837e47ca360dee541573970924f6d4c3672eae54`.
El `buildHash` `7314b6122626045cb38d2cbf0070a67a361fbaae94b4a88f513474f7e98b8674`
del manifiesto M-O1 serializa el mismo renderer de otra forma. El digest
del runner y de su original es
`e67f16d7c750fb39f894d613f6120a1263654b6bf5e1d39f18f089cc765d7574`.
Este runner no tiene el
sello `finished` de ADR-218: la comprobación manual posterior quedó en
`final-audit.json` a las 21:46 UTC, antes de iniciar M-V1. Confirmó HEAD,
diff e identidad de producto, diff/archivos nuevos del arnés, ambos locks y
restauración de ambos dist, sin diferencias contra los registros congelados.

Después se congela M-V1 completo con la nueva identidad de producto/arnés,
en carpeta nueva. Los tres smoke anteriores no se reutilizan como celdas.
Todo resultado sigue provisional hasta el commit autorizado y su repetición;
el revisor Sol confirma los gates del lote al final. No autoriza commits,
versión o publicación.
