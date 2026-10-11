<!-- CONTEXT: scope=medicion-ocr-m-o3 | dependencias=../../hardening/Confianza_Cierre_2026-10-08.md,../../../adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md,../../../adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,Veredicto_De_Orientacion_Equivocado_2026-10-09.md,../../../../tests/perf/README.md | audiencia=planificador+implementador+revisor | fase=12 -->

# M-O3 — cuánto cuesta verificar los cuatro ángulos (Windows)

**Decisión posterior del 2026-10-10:** RC fue incorporado y su costo
confirmado en una campaña aislada; SV/CP quedó diferido hasta disponer de
más documentos/escaneos, con riesgo residual aceptado para esta
actualización. Ver [evidencia y retoma](../../ocr/Orientacion_SV_CP_Retoma_2026-10-10.md).
Las propuestas y decisiones intermedias siguientes conservan su fecha;
no son la decisión vigente.

**Estado: completa y válida; resultados provisionales por árbol sin commitear.**
Las 30 corridas terminaron el 2026-10-10 a las 04:20 UTC, con una importación
fría y otra caliente cada una. No hubo importaciones fallidas, registros
faltantes, duplicados, inesperados ni incoherencias. La detección de suspensión
de Windows estuvo disponible y la guarda cerró sin eventos invalidantes.
La retoma conservó los tres registros originales y completó los otros 27 en
`.measure/osd-verdict/campana-m-o3/`, carpeta ignorada.

El peor caso cuesta entre 3,4 y 4,4 veces el tiempo del control. P2 queda debajo
de su techo de 3.000 MB, con margen menor que el ruido de medición. C sobre P2
con ruido aumenta la mediana fría de M2 en 444,6 MB, con rangos separados.
**No se cumple la condición de adoptar RC automáticamente si C no mueve el
pico.** Hace falta decidir el costo y la combinación SV/CP. No se modificó OCR.

## Método e identidad

Se fuerza «sin veredicto» de orientación con el OCR y pipeline reales. NER
activo, nivel `medium`, tres repeticiones por celda, frío y caliente. El orden
intercala brazos dentro de cada documento y repetición.

- **A:** producto actual con observador de transporte.
- **A0:** producto actual sin observador, solo P2.
- **B:** ausencia de veredicto forzada, con la tinta medida.
- **C:** además se eleva la tinta informada al umbral para forzar trabajo en
  hojas casi vacías y de ruido. Sus avisos no validan la regla candidata RC.

R1 es el escaneo real de 20 páginas. R4 es el digital real de 51 páginas
rasterizado a 300 dpi. Son los resultados principales. P2 mantiene el perfil
normativo de 50 páginas y su techo de 3.000 MB decimales. P2N agrega 10 hojas
de ruido: sus 60 páginas se informan aparte, sin aplicarles el techo de P2
aunque el resumen del CLI los agrupe bajo esa etiqueta.

M2 usa `memoryProfile.ts`: suma de working sets de Electron dentro de las fases,
RSS cada 150 ms. Ruido de referencia: 345 MB. El pico posterior a `Ready` se
informa aparte.

- Windows x64, Intel Core i5-12400, 12 procesadores lógicos,
  16.935.129.088 bytes de RAM.
- Commit base: `aceb72ef9e03f24541daad9768bf08033245672b`.
- Identidad del producto:
  `1b2a57683dda17583a67107bda4c27a5dcc7cb33cecd7a6c669702fc87e5f47d`.
- Guardas de producto, arnés, builds y fixtures antes de reanudar. Salvedad
  `product-tree-uncommitted`: repetir sobre el commit antes de publicar
  resultados definitivos.
- Reales por `ANONLY_REAL_DOC_*`; reportes con IDs neutros, hashes, cantidades,
  tiempos y memoria. Ningún texto, nombre, ruta ni PDF derivado.

La presión del sistema se conserva antes y después de cada tanda en
`system-pressure.txt`. En la retoma, la memoria física libre pasó de 5.000.408
a 7.931.032 KB y el uso actual del archivo de paginación de 389 a 379 MB;
su máximo fue 559 MB en ambos extremos. El registro compacto no conserva serie
RSS ni presión por importación. No se acredita presión constante durante toda
la tanda ni se explica una variación puntual del control con esos extremos.

## Memoria M2

MB decimales; **mediana (mínimo–máximo)** de tres corridas por celda.

| Documento | Brazo | Frío (MB) | Caliente (MB) |
| --- | --- | ---: | ---: |
| R1 | A | 2.012,0 (1.997,6–2.175,8) | 2.401,7 (2.332,6–2.554,9) |
| R1 | B | 1.976,0 (1.945,4–2.148,6) | 2.430,7 (2.327,3–2.471,4) |
| R1 | C | 1.936,2 (1.863,1–2.045,8) | 2.380,9 (2.367,1–2.502,7) |
| R4 | A | 2.414,1 (2.357,9–3.180,6) | 3.311,2 (3.246,6–3.820,9) |
| R4 | B | 2.909,3 (2.657,6–3.027,3) | 3.866,6 (3.372,9–3.899,6) |
| P2 | A0 | 2.100,4 (2.089,0–2.233,3) | 2.859,0 (2.804,0–2.869,4) |
| P2 | A | 2.156,0 (2.086,7–2.245,5) | 2.817,3 (2.745,8–2.849,5) |
| P2 | B | 2.137,5 (2.125,2–2.146,9) | 2.802,4 (2.747,2–2.824,1) |
| P2N | A | 2.317,0 (2.314,3–2.429,1) | 3.184,8 (3.104,2–3.230,4) |
| P2N | C | 2.761,6 (2.751,4–2.867,1) | 3.229,2 (3.138,3–3.431,2) |

En R1, B−A da −36,0/+29,0 MB en frío/caliente; C−A da −75,8/−20,9 MB:
diferencias dentro del ruido. En R4, B−A da +495,2/+555,3 MB, pero **los rangos
se superponen** y la tercera A registró 3.180,6/3.820,9 MB. No se descarta ese
control ni se atribuye toda la diferencia mediana a los ángulos. El máximo
caliente fue 3.899,6 MB en B, frente a 3.820,9 MB en A. R4 no es P2: se declara
el consumo sin contarlo como incumplimiento del techo normativo.

En P2, B−A da −18,5/−14,9 MB. El observador A−A0 da +55,6/−41,7 MB: ambos
dentro del ruido. Los máximos A0/A/B son 2.869,4/2.849,5/2.824,1 MB. Cumplen,
con márgenes de 130,6/150,5/175,9 MB, todos menores que 345 MB. No acredita un
margen holgado de RAM para otros documentos o equipos.

En P2N, C−A da **+444,6 MB en frío**, y el máximo sube 438,0 MB. Los rangos
fríos no se superponen: se distingue del ruido de referencia. En caliente la
mediana sube 44,4 MB y el máximo 200,8 MB, dentro de ese ruido. El máximo C
es 3.431,2 MB. P2N no tiene el techo normativo de P2, pero el aumento importa
para decidir RC.

## Tiempo y trabajo

Segundos hasta `Ready`, **mediana (mínimo–máximo)**. Reconocimientos por
importación, iguales en las tres repeticiones frías y calientes.

| Documento | Brazo | Frío (s) | Caliente (s) | Reconocimientos |
| --- | --- | ---: | ---: | ---: |
| R1 | A | 46,4 (45,3–50,3) | 45,2 (44,8–45,8) | 20 |
| R1 | B | 160,1 (157,7–163,2) | 157,8 (156,3–159,6) | 77 |
| R1 | C | 158,0 (155,6–162,2) | 154,9 (154,5–160,1) | 80 |
| R4 | A | 149,5 (148,9–149,6) | 149,9 (149,3–150,1) | 51 |
| R4 | B | 531,8 (526,9–532,5) | 529,8 (528,3–532,7) | 204 |
| P2 | A0 | 20,4 (20,3–20,5) | 20,1 (19,2–20,3) | 50 |
| P2 | A | 20,5 (20,4–20,7) | 19,6 (19,6–19,9) | 50 |
| P2 | B | 85,7 (85,0–86,6) | 86,3 (84,8–86,4) | 200 |
| P2N | A | 27,1 (27,1–27,5) | 27,0 (26,6–28,7) | 60 |
| P2N | C | 110,8 (110,6–111,1) | 111,2 (110,9–112,0) | 240 |

B/A multiplica el tiempo mediano por 3,45/3,49 en R1, 3,56/3,53 en R4 y
4,19/4,40 en P2 (frío/caliente). C/A da 3,41/3,43 en R1 y 4,08/4,11 en P2N.
R4 llega a unos 8 minutos 50 segundos en este peor caso. R1 B hace cuatro
lecturas en 19 páginas y una en la casi vacía; C hace cuatro también ahí.

## Pico posterior a Ready

Separado de M2. **Mediana / máximo**, MB decimales, tres corridas por fila.
No faltan valores; la base caliente asentó en las 30 corridas.

| Documento | Brazo | Frío (MB) | Caliente (MB) |
| --- | --- | ---: | ---: |
| R1 | A | 1.899,1 / 1.912,6 | 1.866,2 / 1.897,2 |
| R1 | B | 1.648,8 / 1.756,8 | 1.662,3 / 1.743,0 |
| R1 | C | 1.658,1 / 1.784,1 | 1.670,3 / 1.767,4 |
| R4 | A | 2.568,1 / 2.625,6 | 2.648,4 / 2.664,4 |
| R4 | B | 2.620,0 / 2.692,3 | 2.660,4 / 2.670,6 |
| P2 | A0 | 1.985,9 / 1.988,7 | 2.049,3 / 2.134,4 |
| P2 | A | 2.013,1 / 2.014,2 | 2.098,1 / 2.142,6 |
| P2 | B | 1.876,5 / 1.935,1 | 1.924,1 / 1.950,9 |
| P2N | A | 2.248,5 / 2.302,2 | 2.360,2 / 2.403,5 |
| P2N | C | 1.965,7 / 1.970,0 | 1.995,0 / 2.012,5 |

## Entrega y límites

A/B en R1, R4 y P2 no cambia hashes del texto, cantidades de palabras,
ángulos elegidos, entidades por tipo ni avisos. El control entre repeticiones
A también da cero cambios. Se compararon tres repeticiones frías y calientes.

A/C tampoco cambia texto, palabras, ángulos ni entidades. C agrega un aviso
por importación en R1 y diez en P2N: seis y sesenta respectivamente contando
frío y caliente. **Los induce elevar la tinta informada**, que también cambia
`unreadableInk`. RC conservaría la tinta real para avisar. C incluye páginas
de tinta cero que RC no reintentaría. C no hace upscale: al forzar también
ausencia de veredicto entra en la rama de cuatro ángulos al mismo DPI.
Las 1.920 lecturas observadas de C conservaron escala 1. Es un ensayo
de trabajo y costo, no una validación
de la salida de RC. No aparecen palabras ni entidades inventadas en esas hojas.

No se mide la frecuencia de SV en escaneos malos reales: hay un solo escaneo
real, de buena calidad. Tampoco se prueba el consumo de «Validar muestra» con
el documento original abierto.

## Propuesta que requiere decisión

M-O2 refutó **CP solo**. Se propone combinar:

- **RC:** sin veredicto, primera lectura vacía y tinta real mayor que cero:
  probar los otros tres ángulos, sin upscale en esta rama y conservando el
  umbral actual del aviso.
- **SV con umbral 0,8:** con veredicto y tinta mayor que cero, si la confianza de página queda
  debajo del umbral, probar los ángulos que faltan.
- **CP:** seleccionar por confianza de página dentro de esa cadena.

En M-O2, SV/CP a 0,8 redujo las lecturas sin texto esperado y sin aviso de
194 a 22 sobre 384 casos de veredicto equivocado forzado; no son 22 fugas
demostradas automáticamente. Quedan además cinco casos del ensayo de márgenes
equivocados. No disparó lecturas adicionales en las 208 páginas bien orientadas
de los corpus sintético y real principales, pero sí en siete de 24 páginas
con texto en el margen. RC sobre ruido cuesta tres lecturas adicionales y
entre uno y seis segundos por hoja. Sus cuatro fallos naturales del renglón
escaso y girado se recuperan en el ensayo.

La propuesta reduce el riesgo, con fallos residuales declarados. Requiere
aceptar el aumento frío observado en C y el peor caso de tiempo; el consumo
exacto de RC y SV se mide otra vez sobre la regla implementada. Las alternativas
son incorporar solo RC y conservar el riesgo de veredictos equivocados, o
reducir primero el costo. No se implementa CP por separado. Después de decidir:
enmienda de ADR-190 y spec de OCR, implementación, M-O1 y gates afectados,
medición del costo real. Los resultados provisionales se repiten sobre el commit.

**Respuesta del mantenedor (2026-10-10):** pide aclarar si el tiempo extra
es excesivo y la frecuencia del fallback de ruido; todavía no acepta.
RC cumple su condición en 1/20 páginas del escaneo R1 y 0/61 páginas de los
digitales R2–R4 rasterizados en M-O2. No es una estimación poblacional.
El ruido sintético suma entre uno y seis segundos por hoja; los 8 minutos
50 segundos de R4 y 444,6 MB de P2N son el peor caso de todo el documento,
no el costo aislado de una hoja casi vacía. Se prepara el
[experimento aislado de RC](../../ocr/Costo_RC_Aislado_Protocolo_2026-10-10.md)
para decidir con ese costo directo, sin adoptar OCR.
