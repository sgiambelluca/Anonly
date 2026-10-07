<!-- CONTEXT: scope=roadmap-medicion | dependencias=roadmap/hardening/Confianza_1.0.x_Plan.md,roadmap/mediciones/ocr/DPI_Descendente_Fase1_Windows_2026-10-01.md,adr/ADR-163-El-DPI-De-OCR-No-Supera-Al-Raster-Fuente.md,roadmap/Roadmap_1.x.md,tests/perf/README.md | audiencia=humanos+IA | fase=12 (M-E1, línea de base, Windows 2026-10-07) -->

# Emails en escaneos de 200 y 150 dpi nativos — línea de base (M-E1 y M-E2)

## Resultado

- **A 200 dpi nativos no se pierde ningún email**: 25 de 25 detectados.
- **A 150 dpi nativos se pierden 2 de 25**, los dos en el texto de 8 pt, y los
  dos porque el OCR leyó la `@` como `Q`.
- A 300 dpi, el control, no se pierde ninguno.
- Las dos repeticiones dieron el mismo texto leído, byte a byte, en las 12
  combinaciones.
- **Con degradación de fotocopia (M-E2, más abajo)**: a 300 y a 200 dpi
  tampoco se pierde ninguno; a 150 dpi se pierden 4 de 10, y en 3 de esos 4
  la `Q` viene acompañada de un espacio después del punto del nombre.

Es la línea de base. Un cambio de detección se mide con el mismo arnés y se
compara contra estos números y contra los de la campaña de DPI descendente
(`DPI_Descendente_Fase1_Windows_2026-10-01.md` §2 y §2.1), donde forzar la
lectura a menos de 300 dpi perdió 11 emails.

## Qué se midió

La pregunta del plan (`roadmap/hardening/Confianza_1.0.x_Plan.md`, frente 2):
¿un escaneo cuya resolución **nativa** ya es baja pierde emails, y cómo los
lee el OCR?

- **Corpus**: los sintéticos `SR` (20 páginas, 12 pt, 19 emails), `S12`,
  `S10` y `S8` (2 emails cada uno), rasterizados a 300, 200 y 150 dpi nativos.
- **Configuración**: la de por defecto. No se fuerza `ocr.dpi`; el Core lee a
  la resolución nativa de la página (ADR-163). Es la diferencia con la
  campaña de DPI descendente, que tomaba escaneos de 300 dpi y forzaba la
  lectura a menos.
- **Diseño**: 4 corpus × 3 resoluciones × 2 repeticiones, 24 celdas, una
  instancia fría por celda, en serie.
- **Entorno**: Windows 11 nativo, 12 hilos, 16,9 GB de RAM. Producto de `develop` del
  2026-10-07, antes de cualquier cambio de detección.
  Corrida `20261007T045906Z`, unos 13,5 minutos.
- **Validez**: las 24 celdas son válidas. El DPI efectivo de cada despacho se
  comprobó con el observador de ADR-190: 300, 201 y 151. El tope de una
  página sale de píxeles sobre puntos y redondea, por eso no son números
  redondos.

Cómo se corre: `tests/perf/README.md`, «Emails en escaneos de DPI nativo
bajo» (`./tests/perf/run-ocr-emails-native.sh`).

## Tabla

Emails contra la verdad del sintético. Las dos repeticiones coinciden, así
que se muestra una fila por combinación.

| Corpus | DPI nativo | Esperados | Detectados | Perdidos | Cómo se leyeron los perdidos |
|---|---:|---:|---:|---:|---|
| `SR` | 300 | 19 | 19 | 0 | — |
| `SR` | 200 | 19 | 19 | 0 | — |
| `SR` | 150 | 19 | 19 | 0 | — |
| `S12` | 300, 200, 150 | 2 | 2 | 0 | — |
| `S10` | 300, 200, 150 | 2 | 2 | 0 | — |
| `S8` | 300 | 2 | 2 | 0 | — |
| `S8` | 200 | 2 | 2 | 0 | — |
| `S8` | 150 | 2 | 0 | **2** | la `@` como `Q`, los dos |

Los dos perdidos (valores sintéticos):

- `marina.suarez@example.com` se leyó `marina.suarezQexample.com`;
- `contacto.estudio@example.org` se leyó `contacto.estudioQexample.org`.

## Cuánto atraparía una regla tolerante

El arnés cuenta, en todo el texto leído, las cadenas con la forma
«nombre, `Q`, dominio con su terminación». La definición exacta está en
`tests/perf/support/ocrEmailsNativeReading.ts`.

| | Cadenas con esa forma | Son un email de la verdad | No lo son |
|---|---:|---:|---:|
| Las 24 celdas | 2 por repetición | 2 | **0** |

- Cambiando la `Q` por `@`, las dos cadenas reconstruyen exactamente el email
  original.
- No aparece ninguna otra cadena con esa forma en ninguno de los textos,
  tampoco en `SR`, que tiene 19 páginas leídas. En este corpus, una regla
  tolerante no inventaría ningún email.
- No hubo ningún caso de punto leído como espacio. Ese caso sí apareció al
  forzar la lectura a 150 dpi (2 de 11 en la campaña anterior).

## Otros tipos

- **Perdidos**: solo en `S8` a 150 dpi, un DNI y una persona. La persona se
  leyó con una letra cambiada (`rn` como `m`) y se detectó con ese valor.
- **Agregados**: `SR` suma entre 13 y 16 entidades que no están en la verdad,
  casi todas organizaciones, con palabras del propio texto. Pasa también a
  300 dpi, igual que en la campaña anterior. No es una pérdida ni depende de
  la resolución.

## Qué dice y qué no

- La pérdida de emails de la campaña anterior era sobre todo un efecto de
  **bajar** la resolución de un escaneo de 300 dpi. Un escaneo que ya nace a
  200 dpi no la mostró.
- La confusión de la `@` con la `Q` sí existe a resolución nativa, pero recién
  a 150 dpi y con letra de 8 pt.
- **Los sintéticos son limpios**: texto nítido, sin ruido, sin inclinación y
  sin compresión. Un escaneo real de 200 dpi puede leerse peor que estos. Los
  corpus con degradación de fotocopia (`SD1` a `SD5`) se midieron aparte, en
  M-E2.
- La muestra de pérdidas es chica: dos emails en una sola combinación. Para
  evaluar un cambio de detección conviene mirar además los 11 de la campaña
  anterior.

## M-E2 — textos con degradación de fotocopia

Pedida por el mantenedor el 2026-10-07. Mismo método que M-E1, sobre los
sintéticos `SD1` a `SD5`: el mismo texto de 10 pt con dos emails, con
desenfoque y ruido de fotocopia, y una semilla distinta por variante.

- **Diseño**: 5 corpus × 3 resoluciones nativas × 2 repeticiones, 30 celdas.
  Corrida `20261007T053053Z`, unos 10 minutos, mismo equipo y mismo
  producto.
- **Validez**: las 30 celdas son válidas, y las repeticiones coinciden en
  todas. DPI efectivo 300, 201 y 151.
- Cómo se corre: `ANONLY_OCR_EMAILS_NATIVE_SET=sd ./tests/perf/run-ocr-emails-native.sh`.

### Antes de leer los números: la degradación no es la misma a cada resolución

La receta de fotocopia está definida **en píxeles**: un desenfoque de un
píxel y un ruido fijo por píxel. Se aplica igual sobre el raster de cada
resolución. A 200 y a 150 dpi cada letra tiene menos píxeles, así que el
mismo desenfoque pesa 1,5 y 2 veces más sobre el texto que a 300 dpi.

Las celdas de 150 dpi mezclan entonces dos efectos: la resolución nativa
baja y una degradación más fuerte en términos físicos. Sirven como caso
exigente, no como «la misma fotocopia a menor resolución». Una receta en
unidades físicas sería otra medición.

### Tabla

| Corpus | DPI nativo | Esperados | Detectados | Perdidos | Cómo se leyó el perdido |
|---|---:|---:|---:|---:|---|
| `SD1` a `SD5` | 300 | 2 cada uno | 2 | 0 | — |
| `SD1` a `SD5` | 200 | 2 cada uno | 2 | 0 | — |
| `SD1` | 150 | 2 | 1 | 1 | `Q` y un espacio tras el punto |
| `SD2` | 150 | 2 | 1 | 1 | `Q` |
| `SD3` | 150 | 2 | 2 | 0 | — |
| `SD4` | 150 | 2 | 1 | 1 | `Q` y un espacio tras el punto |
| `SD5` | 150 | 2 | 1 | 1 | `Q` y un espacio tras el punto |

- A 150 dpi: 10 esperados, 6 detectados, **4 perdidos**, ninguno agregado.
- Siempre se pierde el mismo, `contacto.estudio@example.org`. El otro,
  `marina.suarez@example.com`, se detecta en las 30 celdas.
- Las lecturas: `contacto.estudioQexample.org` una vez, y
  `contacto. estudioQexample.org` tres veces.

### Cuánto atraparía la regla de ADR-211

| | Cadenas con forma de `Q` | Email completo | Solo el final de un email | Ajenas |
|---|---:|---:|---:|---:|
| Las 30 celdas | 4 por repetición | 1 | **3** | 0 |

- Ninguna cadena ajena: la regla tampoco inventaría emails acá.
- **En 3 de los 4 casos la regla recuperaría solo una parte.** Detectaría
  `estudioQexample.org` y dejaría `contacto.` sin tapar, porque el espacio
  parte el nombre. Es el caso que ADR-211 deja afuera, y en texto degradado a
  150 dpi resultó el más frecuente.

### Otros datos

- Ningún otro tipo de entidad se perdió ni se agregó en las 30 celdas.
- En `SD4` a 150 dpi la cadena de lectura de ADR-190 probó los otros tres
  ángulos y terminó aceptando la página derecha. Fue el único caso.
- Ninguna página quedó marcada como tinta ilegible.
