<!-- CONTEXT: scope=medicion-ocr-veredicto-de-orientacion | dependencias=../../hardening/Confianza_Cierre_2026-10-08.md,../../../adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md,ADR190_OSD_Recuperacion_2026-09-28.md,../../../../tests/perf/README.md | audiencia=planificador+implementador+revisor | fase=11 -->

# Página escasa y girada: qué pasa si la orientación se detecta mal (M-O1, Windows)

**Decisión posterior del 2026-10-10:** cerrar esta actualización con RC,
conservar el riesgo de veredicto equivocado y diferir SV/CP hasta disponer
de más documentos/escaneos. Ver
[evidencia y retoma](../../ocr/Orientacion_SV_CP_Retoma_2026-10-10.md).
Los resultados originales siguientes se conservan; la repetición M-O1
sobre RC incorporado está completa y se informa por separado abajo.

## Confirmación de RC incorporado (2026-10-10, provisional)

En `.measure/osd-verdict/campana-m-o1-rc-20261010` se completaron 700/700
observaciones sobre los mismos 140 PDF. Sus hashes coinciden 140/140 con
la campaña original. Inventario: cero faltantes, inesperados, duplicados,
incidencias, avisos del instrumento y fallas del runner.

La auditoría independiente del planificador excluyó únicamente
`durationMs`, `totalOcrDurationMs` y `readyMs`: 692 registros coinciden
exactamente y ocho cambian por el predicado RC aceptado. Cuatro N1 naturales
(150/300 dpi, giros físicos 90/270) pasan de una a cuatro lecturas y recuperan
el texto esperado; cuatro controles de ruido también amplían las lecturas,
sin cambio del resultado final ni aviso nuevo. Ningún otro registro cambia
en los campos semánticos observados.

Producción pasa de 120/128 a 124/128 páginas con texto esperado. Persisten
los cuatro N4 a 300 dpi, que leen otros dígitos. El indicador de DNI esperado
no prueba que Regex haya perdido todos los DNI ni que el PDF exportado deje
el dato a la vista: M-O1 no registra todas las entidades/cajas ni lee el
export. Para N1, el E2E separado sí verifica la caja y la cobertura final.
El ensayo forzado conserva 194/384 lecturas sin texto esperado ni aviso;
16 de ellas conservan el indicador de DNI esperado; otras siete lecturas
históricas tenían forma de DNI con dígitos distintos. Es el riesgo diferido
por la decisión humana, no una frecuencia estimada de documentos reales.

Las nueve tandas terminaron sin fallas; detección de suspensión disponible
y sin incidencias registradas, prevención positiva en las nueve. Las seis
identidades congeladas entre tandas coinciden. Ambos dist fueron comparados
con sus copias originales después de restaurarlos. El runner M-O1 no tiene
el sello final de las campañas nuevas: la auditoría manual posterior del
árbol/locks quedó en `final-audit.json` a las 21:46 UTC, antes de M-V1,
con todas las igualdades confirmadas.
La única salvedad de campaña es producto sin commit; se repite sobre el
commit autorizado antes de publicar. Identidades y procedimiento detallado:
[validación RC](../../ocr/Recuperacion_RC_Validacion_2026-10-10.md).

## Campañas originales del 2026-10-09

**Estado:** dos campañas completas, M-O1 y M-O2. No cambian producto. El
mantenedor decidió el 2026-10-09 sobre M-O1 («Qué deja para decidir»); M-O2
es la medición que pidió antes de enmendar ADR-190.

**Qué se buscaba.** ADR-190 dejó un riesgo aceptado: si la detección de
orientación (OSD) **afirma** un ángulo equivocado sobre una página con muy
poco texto, y la lectura en ese ángulo es basura con alguna palabra de
confianza ≥ 60, la página se da por leída, no se prueban otros ángulos, no
se avisa, y se exporta sin tapar. El plan
([`Confianza_Cierre_2026-10-08.md`](../../hardening/Confianza_Cierre_2026-10-08.md),
Frente 3) pidió buscarlo con más geometrías y medir cuánto costaría
cerrarlo.

**Resumen.**

1. **No apareció ningún veredicto equivocado.** Sobre 128 PDF con texto, el
   OSD afirmó un ángulo en 48 y acertó en los 48. En las 80 páginas escasas
   no afirmó nada: devolvió «sin veredicto», que es el caso que la enmienda
   del 2026-09-28 ya cubre.
2. **Si lo hubiera, el producto no avisa nunca.** Con un veredicto
   equivocado puesto a mano, la página sale sin los datos esperados y sin
   aviso en 194 de 384 casos. El aviso de página ilegible no se emitió en
   ninguno.
3. **Hay un hueco real, sin forzar nada.** Una página con un solo renglón de
   12 pt, escaneada de costado, se exporta sin leer y sin aviso: 4 de 4. No
   interviene ningún veredicto equivocado.
4. **Comparar las lecturas por confianza de página elige el ángulo correcto
   en 128 de 128.** Comparar por cantidad de palabras confiables, en 51 de
   128. La cadena general de hoy usa la segunda.
5. **Ningún umbral sobre la primera lectura separa limpio** una página bien
   orientada de una mal orientada en este corpus.

## Método y validez

Arnés `tests/perf/osd-verdict.spec.ts`, con `./tests/perf/run-osd-verdict.sh`
(`tests/perf/README.md`, «Veredicto de orientación equivocado»). Worker y
modelos reales, una instancia fría de Electron por observación, en serie.
NER apagado, como en la campaña de ADR-190: se mide OSD, OCR y Regex.

**Alcance de las etiquetas históricas:** «fuga», `silent-leak` y
`silentLeak` en las tablas/crudos nombran texto esperado ausente sin aviso
de página ilegible. El indicador `dniEntity` exige además el valor del DNI
esperado. No son un veredicto sobre el PDF exportado: este arnés no lo lee
ni registra todas las entidades y sus cajas. La clasificación se conserva
para comparar campañas; toda afirmación de dato visible en el export
requiere otra prueba, como el E2E N1.

**Corpus.** 140 PDF escaneados sintéticos, sin capa de texto.

- Los 76 de la campaña de recuperación de ADR-190, sin cambios: 64 con texto
  (`full`, `header`, `signature` y `two-lines`, a 150, 200, 250 y 300 dpi,
  en los cuatro giros) y 12 controles sin texto (`blank`, `noise` y
  `shapes`). Sus 76 hashes coinciden con los de aquella campaña.
- 64 nuevos de página escasa: ocho geometrías, en los cuatro giros, a 150 y
  300 dpi. El texto sale de «Juan Perez DNI 34.567.891».

| Geometría | Página | Letra | Texto | Tinta medida (`inkRatio`) |
|---|---|---|---|---|
| N1 | A4 | 12 pt | un renglón, centrado | 0,0012 a 0,0018 |
| N2 | A4 | 9 pt | un renglón, arriba a la izquierda | 0,0008 a 0,0012 |
| N3 | A4 | 14 pt | tres renglones, abajo a la derecha | 0,0016 a 0,0022 |
| N4 | A4 | 36 pt | «DNI 34.567.891», centrado | 0,0048 a 0,0061 |
| N5 | Oficio, 612 × 1008 pt | 12 pt | dos renglones, arriba | 0,0009 a 0,0012 |
| N6 | A5, 420 × 595 pt | 11 pt | dos renglones, centrados | 0,0023 a 0,0033 |
| N7 | 280 × 220 pt | 26 pt | dos renglones (la geometría del E2E de ADR-190) | 0,0348 a 0,0477 |
| N8 | A4 | 10 pt | dos renglones, uno en cada mitad de la página, arriba | 0,0009 a 0,0014 |

Lo que la tabla del plan no fijaba se eligió y quedó escrito en
`tests/perf/support/osdVerdictCorpus.ts`: margen de 54 pt, interlineado de
1,5 veces el cuerpo, alineación. N4 lleva «DNI 34.567.891» sin el nombre: son
dos datos esperados, no cuatro. Ninguna geometría se cambió después de ver
un resultado.

Para comparar, la tinta de los controles: `noise` 0,0004 a 0,0011, `blank`
0, `shapes` 0,0050 a 0,0068. El producto considera que una página tiene
tinta desde 0,002 (`INK_PRESENT_RATIO`).

**Cinco observaciones por PDF**, 700 en total.

- `production`: el producto sin forzar nada.
- `forced-0`, `forced-90`, `forced-180` y `forced-270`: el arnés reemplaza
  el resultado de la detección de orientación, antes de que lo lea el
  producto, por un veredicto afirmado en ese ángulo. Conserva la tinta
  medida. Una de las cuatro es el ángulo correcto y sirve de control; las
  otras tres son veredictos equivocados.

Lo que se fuerza es un veredicto, no su ausencia. Cada registro guarda lo que
devolvió el worker y lo que recibió el producto, y la campaña falla si no
coinciden con lo pedido: no falló en ninguna. En las 80 páginas donde el OSD
natural no dio veredicto, los ángulos que prueba el producto con el
veredicto forzado son distintos de los de producción, que es la evidencia de
que siguió por la rama «con veredicto».

El primer reconocimiento de cada observación forzada es además la **primera
lectura** del PDF en ese ángulo, sobre el mismo ráster. De ahí salen las
señales y la comparación de las cuatro lecturas.

**Validez.** 700 de 700 observaciones, cero fallas del instrumento, cero
avisos de inestabilidad. Siete tandas reanudables entre el 2026-10-09 01:40
y 04:11 UTC, todas con el mismo build (SHA-256 del `dist`:
`87ade126cc8cb5c866a564405f97383fb0a0d872c7cb3e8c63b437685931bc71`) y con
`packages/` y `apps/` sin cambios sobre la branch `hardening/confianza-cierre`.
Las cinco observaciones de cada PDF leyeron el mismo ráster. Windows 11
nativo, i5-12400, 16,9 GB de RAM, Node 22.23.2.

Sesión cruda: `.measure/osd-verdict/campana-m-o1/` (un JSON por observación,
`manifest.json`, `summary.json`, `summary-tables.txt` y `leaks-table.txt`).

**Qué se llama «fuga» en este informe.** La página termina sin los datos
esperados (las palabras del texto y el DNI detectado como entidad) y sin el
aviso de página ilegible. Es una definición estricta: incluye lecturas donde
el número se leyó con un dígito cambiado, que el producto taparía igual
porque sigue teniendo forma de DNI. Donde importa, se separan.

## 1. ¿Aparece un veredicto equivocado?

No.

| Conjunto | PDF | Sin veredicto | Con veredicto | Correcto | Equivocado |
|---|---:|---:|---:|---:|---:|
| Corpus de ADR-190 (`full`, `header`, `signature`) | 48 | 0 | 48 | 48 | 0 |
| Corpus de ADR-190 (`two-lines`) | 16 | 16 | 0 | 0 | 0 |
| Geometrías nuevas (N1 a N8) | 64 | 64 | 0 | 0 | 0 |
| **Total** | **128** | **80** | **48** | **48** | **0** |

Los 48 veredictos son los mismos PDF de la campaña anterior. Lo nuevo es que
las ocho geometrías escasas no producen ninguno: sobre una página con uno a
tres renglones, el OSD dice que no sabe. El riesgo aceptado necesita que
afirme un ángulo y se equivoque, y eso no se pudo provocar.

**Límite.** Son páginas sintéticas y limpias. No se midió con escaneos
reales, con manchas, sellos o texto manuscrito alrededor.

## 2. Qué entrega el producto hoy, sin forzar nada

Recupera los datos en 120 de 128 PDF. Los otros 8 salen sin aviso:

| PDF | Qué pasó |
|---|---|
| N1 a 150 y 300 dpi, girada 90° y 270° (4) | **Hueco real.** Ver abajo. |
| N4 a 300 dpi, los cuatro giros (4) | El OCR eligió el ángulo correcto y leyó «34.507.391» en vez de «34.567.891». Es un error de lectura de dígitos en letra de 36 pt, no de orientación. El número conserva la forma de DNI: el producto lo tapa. |

**El hueco de N1.** Un renglón de 12 pt en una hoja A4, escaneado de costado:

1. El OSD no da veredicto.
2. La primera lectura, a 0°, devuelve cero palabras: Tesseract no lee un
   renglón vertical.
3. La tinta mide 0,0012 a 0,0018, debajo de 0,002. Para el producto, la
   página no tiene tinta.
4. La rama «sin veredicto» de ADR-190 prueba los otros ángulos si la primera
   lectura trae alguna palabra confiable **o** si hay tinta. No se cumple
   ninguna de las dos.
5. La página se entrega vacía, sin aviso, y se exporta sin tapar.

La misma hoja derecha o cabeza abajo se recupera: ahí la primera lectura
trae alguna palabra confiable y se prueban los cuatro ángulos. En el corpus
hay 52 PDF debajo del umbral de tinta (N1, N2, N5, N8, `two-lines` y la
mitad de N3). Se recuperaron 48, y los 48 por la misma razón: su primera
lectura trajo alguna palabra confiable, aunque fuera basura. Los 4 que no la
trajeron son estos.

El umbral de tinta no se puede bajar sin más. El ruido de escáner del
control `noise` mide hasta 0,0011, y N2, N5 y N8 miden desde 0,0008 o
0,0009: un renglón de letra chica pesa lo mismo que el ruido.

## 3. Si el veredicto fuera equivocado

384 observaciones: tres ángulos equivocados por cada uno de los 128 PDF.

| Resultado | Observaciones |
|---|---:|
| Recupera los datos solo | 190 |
| Avisa (página ilegible) | **0** |
| Sale sin los datos y sin aviso | **194** |

102 de los 128 PDF tienen al menos una fuga.

Qué son las 194:

| Qué entrega | Casos |
|---|---:|
| Basura con alguna palabra confiable | 155 |
| Página vacía con tinta debajo del umbral (el mismo mecanismo del hueco de N1) | 16 |
| El DNI esperado, con el resto del texto incompleto | 16 |
| Un número con forma de DNI, con algún dígito cambiado | 7 |

Las dos últimas filas suman 23 lecturas con el DNI esperado o con forma de
DNI. Solo las primeras 16 tienen `dniEntity=true`, que compara el valor
con el DNI esperado. Las otras siete no prueban por ese indicador ni la
ausencia de todas las entidades ni su cobertura. La tabla clasifica lecturas;
el arnés no lee el PDF exportado ni registra todas las cajas. Por ello no se
atribuyen datos tapados o visibles a esas 23 ni a las otras 171 sin una
verificación final adicional.

Por geometría:

| Geometría | Observaciones | Recupera | Fuga | PDF con alguna fuga |
|---|---:|---:|---:|---:|
| N1 | 24 | 0 | 24 | 8 de 8 |
| N2 | 24 | 16 | 8 | 8 de 8 |
| N3 | 24 | 19 | 5 | 5 de 8 |
| N4 | 24 | 4 | 20 | 8 de 8 |
| N5 | 24 | 16 | 8 | 8 de 8 |
| N6 | 24 | 10 | 14 | 6 de 8 |
| N7 | 24 | 9 | 15 | 7 de 8 |
| N8 | 24 | 16 | 8 | 8 de 8 |
| `full` | 48 | 12 | 36 | 12 de 16 |
| `header` | 48 | 44 | 4 | 4 de 16 |
| `signature` | 48 | 12 | 36 | 12 de 16 |
| `two-lines` | 48 | 32 | 16 | 16 de 16 |

Por distancia entre el ángulo afirmado y el correcto: 46 de 128 a 90°, 102
de 128 a 180°, 46 de 128 a 270°. Por dpi no hay diferencia: 71 de 144 a 150,
23 de 48 a 200, 23 de 48 a 250 y 77 de 144 a 300.

En 103 de las 194 el producto probó un solo ángulo, el afirmado. En 52 de
esas el ángulo afirmado era 0°: es el hueco que ADR-190 dejó escrito («si el
OSD dice 0 sobre una página escasa que en realidad está girada»).

`full` es la página densa. Fuga igual: con un veredicto equivocado sobre una
página completa, la basura trae más de cien «palabras» confiables.

**Control: el ángulo correcto, afirmado.** Recupera 122 de 128. Las 6 que no:

- 3 son el error de dígitos de N4 a 300 dpi, ya descrito.
- 3 son un defecto de la cadena con el OSD acertando (N4 a 150 y 300 dpi y
  N7 a 150 dpi, las tres giradas 180°). El paso 2 de ADR-190 lee también a
  0° y se queda con la lectura que tiene más palabras confiables. La lectura
  correcta tiene 2 o 4 palabras; la basura de 0°, 3, 4 o 6. Gana la basura.

En producción estas tres páginas se recuperan, porque su OSD natural no da
veredicto y van por la otra rama, que compara por confianza de página.

## 4. Señales sobre la primera lectura

La pregunta era si algo de la primera lectura permite decidir cuándo probar
los otros ángulos. Hay 384 primeras lecturas en ángulo equivocado y 128 en
el correcto.

| Señal | Dispara en equivocadas (de 384) | Atrapa fugas (de 194) | Dispara de más en correctas (de 128) |
|---|---:|---:|---:|
| Menos de 5 palabras confiables | 136 | 110 | 80 |
| Menos de 10 palabras confiables | 278 | 145 | 80 |
| Menos de 20 palabras confiables | 308 | 158 | 112 |
| Confianza de página menor que 0,5 | 239 | 81 | 0 |
| Confianza de página menor que 0,7 | 356 | 170 | 0 |
| Confianza de página menor que 0,8 | 376 | 188 | 0 |
| Tinta menor que 0,005 | 288 | 134 | 96 |
| Tinta menor que 0,01 | 312 | 143 | 104 |
| Pocas palabras (10) **o** confianza baja (0,7) | 371 | 185 | 80 |
| Pocas palabras (10) **y** confianza baja (0,7) | 263 | 130 | 0 |

- **Cantidad de palabras confiables.** Dispara de más en todas las páginas
  escasas bien orientadas, porque una página escasa tiene pocas palabras por
  definición. No sirve.
- **Tinta.** Es la misma en los cuatro ángulos de un PDF. No distingue
  orientación.
- **Confianza de página.** Es la mejor de las tres, pero los dos grupos se
  pisan. Las lecturas correctas van de 0,85 a 0,96. Las equivocadas llegan a
  0,91: hay 8 entre 0,87 y 0,91, todas en `full` y `signature` a 150 dpi, y
  6 de ellas son fugas. Un umbral de 0,8 las deja pasar; uno de 0,92
  dispararía de más en 13 páginas bien orientadas. De las 384 lecturas
  equivocadas, 224 tienen confianza de página 0.

**El «0 de 128» de la confianza es de este corpus.** Son páginas sintéticas,
con letra nítida. En un escaneo real bien orientado la confianza de página
suele ser más baja, así que el costo real de un umbral de 0,8 no está
medido.

### Comparar las cuatro lecturas en vez de poner un umbral

Se leen los cuatro ángulos y se elige uno.

| Cómo se elige | Elige el correcto | Elige otro |
|---|---:|---:|
| Primero confianza de página, después palabras confiables | **128 de 128** | 0 |
| Primero palabras confiables, después confianza de página | 51 de 128 | 77 |

La primera es la que ya usa la rama «sin veredicto» desde la enmienda del
2026-09-28, que la había medido en 64 de 64. La segunda es la que usa el
resto de la cadena. La comparación acierta también en las 8 lecturas
equivocadas de confianza alta: la correcta del mismo PDF tiene 0,95.

## 5. Cuánto cuesta leer tres ángulos más

Tiempo de tres lecturas adicionales en una página mal orientada, tomando las
que dispara la señal de confianza de página menor que 0,7.

| Medición | Mediana | p90 | Máximo |
|---|---:|---:|---:|
| En frío (cada lectura en su propia instancia; cota alta) | 3,7 s | 9,0 s | 15,7 s |
| En caliente (lecturas que no fueron la primera de su instancia) | 1,2 s | 3,5 s | 4,6 s |

La de caliente es una estimación: tiene muestra en unas 120 de las 512
primeras lecturas. Una lectura suelta vale 0,8 s de mediana a 150 dpi y 1,8
s a 300 dpi, en frío.

Hoy el producto ya paga ese costo en las páginas escasas: en 60 de las 64
geometrías nuevas, producción hizo cuatro reconocimientos.

**No se midió memoria.** El plan la dejó para una segunda tanda, solo para
la señal que quede como candidata.

## 6. Controles sin texto

| Control | Observaciones | Aviso de página ilegible | Termina con una palabra confiable |
|---|---:|---:|---:|
| `blank` | 20 | 0 | 0 |
| `noise` | 20 | 0 | 0 |
| `shapes` | 20 | 16 | 4 |

`blank` y `noise` no disparan nada, con veredicto forzado o sin él. Las 4
`shapes` que no avisan son el `>` falso de confianza cercana a 0,68 que ya
estaba registrado en ADR-190; aparecen solo con veredicto forzado.

## Qué deja para decidir

1. **El riesgo aceptado de ADR-190** (veredicto equivocado y basura
   confiable). La búsqueda no lo encontró: 48 veredictos, 48 correctos, y
   ninguna afirmación sobre 80 páginas escasas. Si ocurriera, el producto no
   avisa. Cerrarlo con una señal pide antes medir cuánto dispara de más
   sobre escaneos reales, y la memoria.
2. **El renglón solo escaneado de costado** (§2). No es el riesgo aceptado:
   es una página que hoy sale sin leer y sin aviso sin que nada se
   equivoque. Cerrarlo pide probar los otros ángulos aunque la página esté
   debajo del umbral de tinta, y eso lo pagan también las páginas en blanco
   con ruido de escáner. Ese costo no está medido.
3. **Cómo elige el paso 2 de la cadena** (§3, control). Elegir por confianza
   de página en vez de por cantidad de palabras confiables acertó 128 de 128
   y habría evitado las 3 fallas del control. La confianza de página no
   cuenta las palabras que rescatan las pasadas de margen de ADR-121: una
   página con texto solo en el margen hay que mirarla aparte antes de
   cambiarlo.

## M-O2 — lo que faltaba medir (2026-10-09)

El mantenedor decidió, con M-O1: cerrar el renglón de costado, cambiar el
comparador del paso 2 si el caso del margen no lo contradice, y medir una
señal sobre documentos reales antes de decidir sobre el riesgo aceptado.
M-O2 mide las tres cosas. El diseño está en el plan (Frente 3, «M-O2»).

**Las tres reglas candidatas.** Se evalúan con una simulación sobre las
lecturas medidas. No son el producto.

- **RC, renglón de costado.** Sin veredicto, con la primera lectura vacía y
  tinta mayor que cero, se prueban los otros tres ángulos aunque la tinta
  quede debajo de 0,002.
- **CP, comparador.** Entre lecturas con alguna palabra confiable gana la de
  mayor confianza de página, y después la de más palabras confiables.
- **SV, señal con veredicto.** Con veredicto, si la lectura elegida tiene
  confianza de página menor que T, se leen los ángulos que falten y se elige
  con CP.

**Validez.** 645 de 645 observaciones sobre 129 páginas: 24 hojas de ruido,
24 páginas con sello en el margen y 81 páginas de cuatro documentos reales.
Cero fallas del instrumento. Ocho tandas el 2026-10-09 entre las 06:47 y las
09:53 UTC, con el mismo build y los mismos PDF en todas. **Provisional**: el
producto tenía sin commitear el patrón de direcciones de ADR-217, que no
toca el OCR; la corrida lleva el aviso `product-tree-uncommitted`. La
simulación de la cadena de hoy se comparó contra lo medido: mismos ángulos
leídos en 1345 de 1345 observaciones y misma lectura final en 1317 de 1317
(en las otras 28 corrió el reintento agrandado, que no se simula). Sesión
cruda: `.measure/osd-verdict/campana-m-o2/`.

**Documentos reales.** Entraron por `ANONLY_REAL_DOC_R1` a `R4`. R1 es un
escaneo de 20 páginas, leído a su resolución. R2 a R4 son digitales (61
páginas), rasterizados a 150 dpi: tienen la composición de una página real
con píxeles limpios, y se informan aparte. Los registros de estas páginas no
guardan texto, y nada derivado de ellas quedó en disco bajo el repo. Acá hay
solo agregados.

### A. El renglón de costado: quién paga

Seis tipos de hoja sin texto, con ruido, a 150 y 300 dpi, derechas y
giradas.

| Hoja | Tinta a 150 dpi | Tinta a 300 dpi | Lecturas hoy |
|---|---:|---:|---|
| Motas | 0,00109 | 0,00035 | 1 |
| Sombra de borde | 0,00484 | 0,00403 | 4, con aviso de ilegible |
| Perforaciones | 0,00077 | 0,00067 | 1 |
| Doblez | 0,00171 | 0,00114 | 1 |
| Motas densas | 0,00191 | 0,00069 | 1 |
| Motas con sombra | 0,00751 | 0,00599 | 4, con aviso de ilegible |

- **RC recupera los 4 PDF de N1.** Sobre los 128 PDF con texto de M-O1, la
  recuperación pasa de 120 a 124. No cambia ninguna otra página con texto.
- **Lo pagan 20 hojas sin texto**: las de motas, perforaciones, doblez y
  motas densas, y el control `noise` de M-O1. Cada una pasa de una lectura a
  cuatro. Las hojas con sombra de borde ya hacían cuatro hoy.
- **Ninguna lectura de ruido inventa texto.** 0 de 96 primeras lecturas
  traen alguna palabra, y de ahí no sale ninguna entidad. Con RC esas hojas
  siguen sin aviso, porque quedan debajo del umbral de tinta.
- **Tiempo de las tres lecturas de más, por hoja.** En frío, 2,1 s de
  mediana a 150 dpi y 5,7 s a 300 dpi. En caliente, medido en las hojas que
  hoy ya hacen cuatro lecturas (4 por resolución): 0,9 s y 4,2 s.
- **En el escaneo real**, 1 página de 20 quedó debajo del umbral de tinta
  (0,00049), sin palabras. Es la que pagaría RC.

Un piloto con motas mucho más densas (tinta 0,0066, que ya está sobre el
umbral y hoy hace las cuatro lecturas) mostró que el reintento agrandado sí
inventa de 8 a 10 palabras confiables. No es de RC: pasa hoy. No entró en la
campaña.

### B. La señal sobre páginas reales

| | R1, escaneo (20) | R2 a R4, rasterizados (61) |
|---|---|---|
| Confianza de página de la lectura bien orientada | 0,87 a 0,94 | 0,84 a 0,95 |
| Confianza de página de las lecturas en ángulo equivocado | 0,47 a 0,63 | 0,00 a 0,71 |
| Veredicto natural igual al ángulo de referencia | 19 de 19 | 60 de 60 |
| Sin veredicto | 0 | 1 |
| Sin lectura fiable en ningún ángulo | 1 | 0 |

El ángulo de referencia de cada página es el que elige CP entre sus cuatro
lecturas. **Ningún veredicto natural fue equivocado**: con los 48 de M-O1,
son 127 de 127.

Cuántas páginas bien orientadas dispararía SV (el costo) y cuántas lecturas
equivocadas se le escapan, según T. Cada celda es «dispara de más / se le
escapan».

| Conjunto | T = 0,6 | T = 0,7 | T = 0,8 | T = 0,85 |
|---|---|---|---|---|
| Sintético de M-O1 (128 páginas, 384 equivocadas) | 0 / 94 | 0 / 28 | 0 / 8 | 0 / 8 |
| R1 (19 páginas, 57 equivocadas) | 0 / 4 | 0 / 0 | 0 / 0 | 0 / 0 |
| R2 a R4 (61 páginas, 183 equivocadas) | 0 / 33 | 0 / 1 | 0 / 0 | 1 / 0 |
| Margen (24 páginas, 72 equivocadas) | 4 / 36 | 7 / 20 | 7 / 20 | 7 / 20 |

- En las páginas reales, entre 0,71 y 0,84 no hay ninguna lectura: T = 0,7
  y T = 0,8 separan casi igual. Con T = 0,85 ya dispara una página bien
  orientada.
- Las 8 que se escapan en el sintético son las lecturas equivocadas de
  confianza 0,87 a 0,91 de las páginas densas a 150 dpi. Ningún T las
  atrapa.
- En el conjunto de margen SV dispara de más en 7 de 24: son páginas cuyo
  texto está solo o casi solo en el sello, donde la confianza de página es
  0. El costo ahí son tres lecturas más.

**Dos límites de esta parte.**

- Son 81 páginas de cuatro documentos, y un solo escaneo. No hay ningún
  escaneo de mala calidad (fax, fotocopia, manuscrito). En una página así la
  confianza de una lectura bien orientada puede caer debajo de T, y SV le
  suma tres lecturas. Ese costo no está medido.
- Todas las páginas reales están derechas. Con un veredicto equivocado
  forzado, el producto de hoy termina en el ángulo de referencia en 235 de
  240, porque el paso 2 lee siempre a 0°, que acá es el correcto. No prueban
  el caso de una página girada con veredicto «derecha».

### C. El comparador, solo y con la señal

Qué entrega la cadena en los 128 PDF de M-O1. Cada celda es «recupera / sale
sin aviso».

| Escenario | Hoy | Con CP | Con SV (T = 0,7) y CP | Con SV (T = 0,8) y CP |
|---|---|---|---|---|
| Producción (128) | 120 / 8 | 120 / 8 | — | — |
| Veredicto correcto forzado (128) | 122 / 6 | 124 / 4 | — | — |
| Veredicto equivocado forzado (384) | 190 / 194 | **172 / 212** | 335 / 49 | 362 / 22 |

- **CP solo empeora el caso del veredicto equivocado**: cierra 2 fugas y
  abre 20. Las 20 son la página de encabezado (16) y N3 a 150 dpi (4). Hoy
  esas páginas se recuperan con una lectura en ángulo equivocado, porque el
  dato cae en una franja de margen y lo rescatan las pasadas de ADR-121. La
  confianza de página no cuenta esas palabras, así que CP prefiere otra
  lectura, con más confianza y sin el dato.
- **CP elige bien cuando el ángulo correcto está entre los que compara.**
  Entre las cuatro lecturas acertó 128 de 128 (M-O1). El problema aparece
  cuando compara solo dos y ninguna es la correcta.
- **SV le da a CP las cuatro lecturas.** Juntas dejan 49 fugas con T = 0,7
  y 22 con T = 0,8, de 194.
- En producción CP no cambia ningún resultado: los 8 que salen sin aviso
  son los 4 de N1, que cierra RC, y los 4 de N4 con el dígito mal leído, que
  el producto tapa igual.

**Con el sello en el margen** (24 páginas; cuerpo y sello se cuentan por
separado):

- En producción, la cadena de hoy entrega cuerpo y sello en las 24. CP no
  cambia ninguna.
- Con el veredicto correcto forzado, la página que tiene solo el sello lo
  pierde en 4 de 8 hoy y en 3 de 8 con CP.
- Con el veredicto equivocado forzado: 38 fugas de 72 hoy, 36 con CP, y 5
  con SV y CP (con T = 0,7 o más).

### Qué deja M-O2 para decidir

1. **RC** hace lo que se buscaba y lo pagan las hojas sin texto con ruido
   suelto: tres lecturas más por hoja, entre 1 y 6 segundos según la
   resolución.
2. **CP no conviene solo.** No cambia nada en producción y empeora el caso
   hipotético. Conviene junto con SV.
3. **SV con CP** cierra la mayor parte del riesgo aceptado en el sintético
   (de 194 a 49 o a 22) y no dispara en ninguna de las 208 páginas bien
   orientadas medidas, con T hasta 0,8. Queda sin medir su costo en escaneos
   de mala calidad, y la memoria.

## Cómo repetirla

```bash
# M-O1
export ANONLY_OSD_VERDICT_OUTPUT_DIR=.measure/osd-verdict/<nombre>
./tests/perf/run-osd-verdict.sh
# M-O2 (con ANONLY_REAL_DOC_R1 a R4; sin ellas corre solo lo sintético)
ANONLY_OSD_VERDICT_SET=m2 ./tests/perf/run-osd-verdict.sh
```

Se repite la misma llamada hasta que el resumen diga «COMPLETA»; cada una
hace hasta 80 observaciones. El resumen se puede regenerar sin volver a
correr: `pnpm exec tsx tests/perf/support/summarizeOsdVerdictCli.ts <carpeta>`.
