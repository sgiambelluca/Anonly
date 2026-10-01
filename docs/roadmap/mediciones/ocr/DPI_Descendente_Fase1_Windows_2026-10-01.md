<!-- CONTEXT: scope=campana-ocr-dpi-descendente | dependencias=../../OCR_DPI_Descendente_Campana_Plan.md,../../Perfiles_Rendimiento_Revision.md,../../MVP.md,../../../adr/ADR-163-El-DPI-De-OCR-No-Supera-Al-Raster-Fuente.md,../../../adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md,../../../../tests/perf/README.md | audiencia=humanos+IA | fase=11 -->

# Campaña de DPI descendente, fase 1 (calidad) — Windows nativo

**Estado:** medición terminada. **Ninguna resolución pasa. El humano cerró
la campaña el 2026-10-01: la resolución del OCR no se baja por defecto.** La
fase 2 completa (tiempo y memoria) no se corre.

**Ejecución:** Windows nativo (i5-12400, 12 hilos, 16 GB), 2026-10-01, commit
`5e7c9e8` con el árbol limpio. Protocolo y regla de decisión:
`OCR_DPI_Descendente_Campana_Plan.md` §6. La matriz completa fueron 56
celdas en 27 minutos, en una sola carpeta, sin relanzar ningún corpus.

El `summary.json` de la corrida no se guarda en el repo: sus números están en
este informe. `R2` es el documento real; de él solo hay conteos y agregados.

## 1. Veredicto

Línea final del resumen:

`complete=true matriz=completa 150=no-pasa 200=no-pasa 250=no-pasa cobertura=0.95 discriminantControlFailed=false no-evaluado=250@R2 salvedades=0`

| Brazo | Veredicto | Criterios que fallan |
|---|---|---|
| 250 | no pasa | `S8`: cobertura mínima 0,9439. `SR`: pierde 10 entidades que `300` detecta; cobertura mínima 0,9444. No se evalúa en `R2` |
| 200 | no pasa | `SR`: pierde 9. `R2`: pierde 24; cobertura mínima 0,9487 |
| 150 | no pasa | `S8`: pierde 2. `SR`: pierde 4; cobertura mínima 0,9421. `R2`: pierde 18; cobertura mínima 0,8589 |

- Matriz completa, sin celdas inválidas ni ausentes, sin criterios
  indeterminados y sin salvedades. Detección de suspensión disponible.
- Control discriminante en orden: `150` pierde dos emails en `S8`.
- Criterio 3 (cadena de ADR-190): sin fallos en ningún brazo.
- `SD` (fotocopia degradada, 80 entidades): los cuatro brazos leen las 80.
  No discriminó nada.
- `S12`, `S10` y `SE`: sin pérdidas ni coberturas bajo 0,95 en ningún brazo.

## 2. Hallazgo: al bajar la resolución se pierden emails

Es lo único que se pierde **contra la verdad** de los sintéticos (con una
excepción de un CUIT en `S6`). A 300 dpi no se pierde ninguna entidad en
ningún sintético.

| Corpus | 300 | 250 | 200 | 150 |
|---|---|---|---|---|
| `SR` (20 páginas, 12 pt) | 0 | 1 email | 4 emails | 1 email |
| `S8` (8 pt) | 0 | 0 | 0 | 2 emails |
| `S6` (6 pt, no decide) | 0 | 0 | 1 email y 1 CUIT | 2 emails |
| `S12`, `S10`, `SE`, `SD1` a `SD5` | 0 | 0 | 0 | 0 |

- La pérdida **no es monótona** con la resolución: en `SR`, 200 dpi pierde
  más que 150.
- En `S8` a 150 dpi, uno de los emails perdidos reaparece recortado: se
  detecta `suarez@example.com` en lugar de `marina.suarez@example.com`. Una
  detección parcial deja parte del dato sin tapar.
- Un email perdido es un dato personal que se exporta sin anonimizar. Por
  eso este hallazgo alcanza, por sí solo, para no bajar la resolución.
- **Causa no verificada.** No se sabe si falla la lectura del OCR (por
  ejemplo, la `@` o los puntos) o el patrón de Regex ante una lectura
  apenas distinta. En la Mac, durante el desarrollo del arnés, `S6` perdía
  un email ya a 300 dpi y `S10` perdía dos a 150; en Windows no pasa
  ninguna de las dos cosas.
- **Sin medir:** si un escaneo cuya resolución nativa ya es de unos 200 dpi
  sufre la misma pérdida. Los sintéticos son de 300 dpi y se bajan al
  rasterizar; un escaneo real de 200 dpi no es lo mismo.

Queda como ítem ABIERTO en `MVP.md`, Hito 11.

## 3. Lo que la regla no pudo juzgar

El criterio 1 («el brazo no pierde ninguna entidad que `300` detecta») no
separa degradación de vaivén en un documento real:

- **`R2` es un escaneo de unos 200 dpi.** El tope de página dio 201 en las
  20 páginas (la inferencia anterior, «unos 240 dpi o menos», era una cota).
  El brazo `300` se despacha a 201 dpi y el brazo `200` a 200: **1 dpi de
  diferencia**.
- Con esa diferencia, `200` «pierde» 24 de las 227 entidades de `300` y
  agrega 25. Los totales por tipo casi no cambian (228 contra 227). El
  recall de tokens es 0,987 y la precisión 0,984.
- Las dos repeticiones de `300` coinciden 227 de 227, con cobertura 1 en las
  497 cajas comparadas de toda la matriz. El control mide repetibilidad, no
  sensibilidad a un cambio mínimo de la imagen.
- En `SR`, de las 10 pérdidas de `250` contra `300`, 8 son `ORGANIZATION`
  que `300` detecta y que no están en la verdad (`300` agrega 15 entidades
  no esperadas). Perder un falso positivo cuenta como pérdida.

No se verificó de dónde sale el vaivén (lectura del OCR, NER o el
emparejamiento de entidades del arnés).

**Consecuencia.** Los «no pasa» de `R2`, y la parte de `SR` que no son
emails, no prueban que la lectura empeore. Tampoco prueban lo contrario. Si
la campaña se reabre, hace falta una regla nueva, escrita antes de medir,
con un control de perturbación (por ejemplo, un brazo de 299 dpi) que fije
el piso de vaivén. Estos resultados no se releen con otra regla.

## 4. Tabla completa

Pérdidas contra la verdad / pérdidas contra `300` / cobertura mínima de caja.

| Corpus | 250 | 200 | 150 |
|---|---|---|---|
| `S12` | 0 / 0 / 0,9613 | 0 / 0 / 0,9707 | 0 / 0 / 0,9690 |
| `S10` | 0 / 0 / 0,9639 | 0 / 0 / 0,9630 | 0 / 0 / 0,9666 |
| `S8` | 0 / 0 / 0,9439 | 0 / 0 / 0,9500 | 2 / 2 / 0,9583 |
| `S6` (no decide) | 0 / 0 / 0,9322 | 2 / 2 / 0,9450 | 2 / 2 / 0,9545 |
| `SD1` a `SD5` | 0 / 0 / 0,9658 o más | 0 / 0 / 0,9606 o más | 0 / 0 / 0,9629 o más |
| `SE` | 0 / 0 / 0,9669 | 0 / 0 / 0,9643 | 0 / 0 / 0,9951 |
| `SR` | 1 / 10 / 0,9444 | 4 / 9 / 0,9662 | 1 / 4 / 0,9421 |
| `R2` | no evaluado | sin verdad / 24 / 0,9487 | sin verdad / 18 / 0,8589 |

Pérdidas contra `300` por tipo:

| Brazo | `SR` | `R2` |
|---|---|---|
| 250 | EMAIL 1, ORGANIZATION 8, PERSON 1 | — |
| 200 | EMAIL 4, ORGANIZATION 3, PERSON 2 | ADDRESS 5, ORGANIZATION 9, PERSON 10 |
| 150 | EMAIL 1, ORGANIZATION 3 | ADDRESS 4, DNI 1, ORGANIZATION 6, PERSON 7 |

Entidades detectadas en `R2` por tipo:

| Brazo (DPI despachado) | ADDRESS | DATE | DNI | ORGANIZATION | PERSON |
|---|---:|---:|---:|---:|---:|
| 300 (201) | 28 | 9 | 1 | 32 | 157 |
| 200 | 27 | 9 | 1 | 31 | 160 |
| 150 | 27 | 9 | 1 | 30 | 164 |

En `R2` a 150 dpi, 21 entidades quedan con cobertura de caja bajo 0,95.

## 5. Otros datos de la corrida

- **DPI efectivo.** En las 56 celdas, todos los despachos salieron al DPI
  esperado; ningún reintento de ADR-190 usó otro DPI ni `upscale`. Tope de
  página de los sintéticos: 301.
- **`S6`.** Un paso de recuperación de ADR-190 en los cuatro brazos y en las
  dos repeticiones de `300` (el OSD da 180 sobre una página derecha), sin
  `unreadableInk`. Igual que en la Mac.
- **`SR`.** NER reconoce las 38 personas esperadas en todos los brazos. Sin
  timeouts ni despachos fallidos. La página en blanco se despacha y termina
  sin `unreadableInk`.
- **`controlIncompleteCorpora`** vacío: `300` no pierde nada contra la
  verdad. `fixtureHashMismatches` vacío.
- **Higiene.** Las celdas de `R2` traen solo conteos por tipo,
  distribuciones, la huella del archivo y metadatos de despacho. Ni su ruta
  ni su nombre aparecen en ningún artefacto.

## 6. Pasos previos

- **Humo de la fase 1** (`S10`, 300 y 150): válido en todo, salvo que `150`
  leyó 16 de 16 y el humo marcó `DETENER-CAMPANA=true`. Un humo de un solo
  corpus no puede decidir el control discriminante; la condición estaba mal
  puesta en el encargo, no en el arnés.
- **Sonda del control** (`S8`, `SD1`, 300 y 150): `150` pierde dos emails en
  `S8`. Con eso se corrió la matriz.
- **Humo de la fase 2** (`P2H`, dos reconocedores, una corrida por brazo):

  | DPI | Reserva por página | Páginas en 128 MiB | OCR | `Ready` |
  |---|---:|---:|---:|---:|
  | 300 | 34.809.280 B | 3 | 16,2 s | 19,2 s |
  | 200 | 15.465.468 B | 8 | 7,0 s | 9,9 s |

  Es una corrida por brazo: orienta, no mide. Las huellas del OCR a 200 dpi
  difieren de las de 300.

## 7. Qué queda

- La resolución del OCR no cambia: `ocr.dpi` sigue en 300, con el tope
  nativo de ADR-163.
- Los techos de memoria por perfil se definen a 300 dpi, con el tope de
  imágenes vivas por perfil (`Perfiles_Rendimiento_Revision.md`).
- La pérdida de emails se investiga aparte (§2). Si tiene arreglo en la
  detección, 200 dpi vuelve a ser candidata: el humo de la fase 2 sugiere
  que el OCR tarda menos de la mitad.
- El arnés queda en `tests/perf/` para una eventual reapertura, con la regla
  nueva de §3.
