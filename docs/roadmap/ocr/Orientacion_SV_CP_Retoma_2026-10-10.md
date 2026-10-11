<!-- CONTEXT: scope=pendiente-orientacion-sv-cp | dependencias=adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md,roadmap/hardening/Confianza_Cierre_2026-10-08.md,roadmap/mediciones/ocr/Veredicto_De_Orientacion_Equivocado_2026-10-09.md,roadmap/mediciones/ocr/Costo_De_Verificar_Cuatro_Angulos_2026-10-09.md,roadmap/mediciones/ocr/Costo_RC_Aislado_2026-10-10.md | audiencia=humanos+IA | fase=12 -->

# Orientación equivocada — pendiente de desarrollo en 1.0.x

**Estado: PENDIENTE DE DESARROLLO.** El trabajo SV/CP se cierra
momentáneamente como diferido, hasta que el mantenedor disponga de más
PDF escaneados para mayores pruebas. Por su aclaración posterior del
2026-10-10, debe quedar como único punto abierto de **1.0.x — Confianza**
al completar los demás trabajos de ese bloque. El defecto sigue siendo
un riesgo conocido; esta etiqueta no afirma una corrección técnica.

**Decisión humana del 2026-10-10:** «Cerra con RC y documenta todo lo
demas, dejalo como el unico punto pendiente de la actualizacion de confianza.
este mismo se retomara cuando disponga de mas documentos sobre los cuales
poder hacer escaneos mejores.»

**Aclaración humana posterior:** «sino creeria que lo mejor es dejar todo
anotado, cerralo de forma momentanea como pendiente a desarrollo una vez
cuente con mas pdfs escaneados a disposición para hacer mayores pruebas.
Te diria de dejar todo documentado, y que ese quede como un unico punto
abierto del 1.0.x».

El cierre de esta versión conserva RC y acepta el riesgo residual conocido
de orientación. SV y la extensión de CP a la cadena general quedan
diferidos, sin fecha: se retoman cuando el mantenedor disponga de más
documentos y escaneos de diversa calidad. No se adopta el umbral 0,8.
Esta decisión reemplaza la propuesta condicional de cambiar el comparador
del paso 2, formulada el 2026-10-09. El comparador por confianza de página
que ya existe en la rama sin veredicto se conserva.

El objetivo de 1.0.x es que este sea su único punto abierto, con estado
pendiente de desarrollo.
RC ya tiene caracterización completa y el gate del export terminó 23/23
localmente. «Validar muestra» fue retirada del roadmap el 2026-10-11.
Sol aprobó el lote para PR el 2026-10-11. Memoria final y las repeticiones
sobre el commit siguen pendientes antes de publicar la versión.
La decisión sobre SV/CP no los declara terminados. La autorización posterior
del 2026-10-11 para commits y PR, condicionada a APPROVED y auditoría de
privacidad, está registrada en el plan de cierre.

## Riesgo que se conserva

| Sigla | Qué hace | Estado de esta actualización |
| --- | --- | --- |
| RC, recuperación de lectura vacía con tinta | Sin veredicto de orientación, si la primera lectura de página entera tiene cero palabras y tinta positiva, prueba los cuatro ángulos | Incorporado, caracterizado y aprobado por Sol para PR |
| SV, verificación adicional por baja confianza | Ante una lectura inicial con confianza de página baja, propone revisar otros ángulos, incluso si el detector afirmó una orientación | Pendiente de desarrollo; 0,8 fue un candidato del ensayo, no un umbral adoptado |
| CP, comparación por confianza de página | Propone elegir entre lecturas por confianza de página en la cadena general | Extensión pendiente de desarrollo junto con SV; la rama existente sin veredicto ya usa este criterio y se conserva |

El detector puede afirmar un ángulo incorrecto y el OCR devolver texto
incorrecto con alguna palabra de confianza alta. La cadena general puede
dar esa lectura por fiable, detener los reintentos y no emitir aviso de
página ilegible. Puede faltar una entidad y quedar un dato sin tapar.
RC no entra en páginas con veredicto: recupera páginas enteras sin
veredicto, cuya primera lectura está vacía pero tiene tinta.

Un dígito mal reconocido no demuestra por sí solo una fuga en el export:
el dato puede conservar forma de DNI, detectarse y taparse en su caja.
Los informes distinguen falta del texto esperado, detección, geometría y
lectura del PDF final. No se presenta la confianza OCR como garantía de
lectura correcta, ni la ausencia de aviso como garantía de anonimización.

## Evidencia conservada

| Evidencia | Hallazgo | Límite |
| --- | --- | --- |
| M-O1, 700 observaciones sobre 140 PDF | En las 128 páginas con texto, 48 veredictos naturales y todos correctos; 80 sin veredicto. Veredictos incorrectos forzados: 194/384 sin texto esperado ni aviso | Es un ensayo condicionado a un error forzado; incluye 16 lecturas incompletas con indicador de DNI esperado. Otras siete lecturas tenían forma de DNI con dígitos distintos. No lee el PDF exportado |
| M-O2, sintéticos y documentos disponibles | Ningún veredicto natural equivocado en las 127 páginas con texto del conjunto adicional | Un único escaneo real de buena calidad y digitales rasterizados; no estima frecuencia poblacional |
| Simulación CP solo | 194 → 212 casos sin texto esperado ni aviso: cierra 2 y abre 20 | Refutada como cambio aislado; no se implementa |
| Simulación SV + CP, umbral 0,8 | 194 → 22/384 casos forzados; quedan además cinco casos del ensayo de margen | Sigue habiendo residuos; no es evidencia de frecuencia real ni del costo del producto implementado |
| Activación SV simulada | 0/208 páginas bien orientadas del corpus principal; 7/24 con texto en el margen | El umbral no separa de forma universal lectura correcta e incorrecta; errores sintéticos con confianza 0,87–0,91 lo evaden |
| M-O3, cuatro ángulos en todas las páginas | Tiempo 3,4–4,4 veces mayor; caso rasterizado de 51 páginas cercano a 8 min 50 s | Peor caso forzado, no costo habitual de SV. P2 quedó bajo 3 GB con margen menor que el ruido |
| RC incorporado, costo aislado 12/12 | R1: +1,185/0,952 s; diez hojas de ruido: +19,452/18,713 s hasta Ready, frío/caliente | No mide SV. Presión por importación desconocida y resultados provisionales |

Los detalles y las identidades se conservan en los informes
[M-O1/M-O2](../mediciones/ocr/Veredicto_De_Orientacion_Equivocado_2026-10-09.md),
[M-O3](../mediciones/ocr/Costo_De_Verificar_Cuatro_Angulos_2026-10-09.md)
y [RC aislado](../mediciones/ocr/Costo_RC_Aislado_2026-10-10.md).
La repetición M-O1 sobre RC incorporado está completa: 700/700 observaciones
en `.measure/osd-verdict/campana-m-o1-rc-20261010`, con los mismos 140 hashes.
La auditoría encontró solo ocho cambios previstos: cuatro N1 recuperados
y cuatro controles de ruido con lecturas adicionales. Persisten los cuatro
N4 y los 194/384 residuos forzados; no hay cambios inesperados en la
proyección registrada. Los límites sobre entidades/cajas y export siguen
vigentes. Ver la [validación RC](Recuperacion_RC_Validacion_2026-10-10.md).

## Cómo retomar

1. Incorporar los nuevos documentos por `ANONLY_REAL_DOC_*`, con IDs
   neutros y hashes. Acordar con el mantenedor variedad de calidad,
   densidad, orientación y resolución de los escaneos. No fabricar una
   tasa poblacional a partir de un corpus de conveniencia.
2. Congelar producto, arnés y bytes de entrada. Ejecutar OCR/OSD naturales
   y registrar cobertura contra una verdad conocida, separando fallos de
   reconocimiento, detección y export. Conservar los controles sintéticos
   anteriores y los fallos, sin facilitar sus recetas.
3. Medir cuántas páginas activaría cada candidato SV, cuántas correctas
   reintentaría innecesariamente y cuántos errores quedarían fuera.
   Comparar CP dentro de la misma cadena; no retomar CP como cambio aislado
   pasando por alto su refutación. El 0,8 es un candidato histórico.
4. Separar frecuencia observada de error natural de los ensayos con
   veredicto incorrecto forzado. Informar denominadores, residuos y
   límites; validar en el PDF exportado los casos que se llamen fuga.
5. Si la evidencia justifica una regla, presentar umbral, mejora y costo
   al mantenedor. Tras su decisión, enmendar ADR-190 y el spec antes de
   implementar. Medir la regla real con tiempo, memoria, rangos, presión
   disponible o desconocida, guardas e identidad; repetir gates y revisión.

No registrar nombres, rutas, texto, imágenes ni derivados de documentos
reales. Una nueva campaña no modifica ni reemplaza los crudos históricos.
La aceptación actual del riesgo no equivale a resolverlo técnicamente.
