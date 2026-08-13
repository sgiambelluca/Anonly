<!-- CONTEXT: scope=roadmap-pendientes | dependencias=roadmap/MVP.md,roadmap/Hito10.8_Handoff.md,adr/ADR-011-Grouping-First.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-063-Bbox-De-Texto-Rotado.md | audiencia=humanos+IA | fase=post-10.8 -->

# Pendientes acordados para después del Hito 10.8

> Hallazgos de la prueba manual sobre la pericia real que **no** son del Hito 10.8 y que el humano decidió explícitamente diferir. Ninguno es regresión del hito: son gaps preexistentes que recién se ven ahora que el OCR y la lectura de anotaciones llegan hasta ahí.
>
> Orden sugerido por daño real, no por costo.
>
> **Estado (2026-08-13)**: el §3 quedó **cerrado dentro del hito** por ADR-067 — se conserva tachado, con el porqué. El resto sigue vigente, y el §2 quedó **medido** sobre la pericia de 5 páginas en la segunda prueba manual.

---

## 1. Matching difuso fusiona entidades numéricas distintas — **el más grave**

**Qué pasa.** Dos fechas distintas (`1/7/2026` y `7/7/2026`) salen como un solo grupo, `Fecha 01`.

**Causa, verificada.** `findMatchingGroup` (`grouping-engine/src/grouping.engine.ts`) tiene un segundo pase por **Levenshtein normalizado ≥ 0.88** cuando ningún grupo tiene el valor exacto. La fórmula es `1 - distancia / longitud` (`levenshtein.ts`). Las dos fechas normalizan a `01/07/2026` y `07/07/2026`: 10 caracteres, difieren en uno.

```
1 - 1/10 = 0.90  ≥  0.88  →  mismo grupo
```

**No es solo la fecha.** La misma cuenta, por tipo:

| Tipo | Largo normalizado | Similitud con 1 dígito distinto | ¿Se fusionan? |
|---|---|---|---|
| CUIT | 11 | 0.909 | **sí** |
| Tarjeta de crédito | 16 | 0.937 | **sí** |
| Teléfono | 10 | 0.900 | **sí** |
| Fecha | 10 | 0.900 | **sí** |
| DNI | 8 | 0.875 | no — **por 0,005** |

Dos CUIT distintos que difieran en un dígito se fusionan en un grupo: el documento anonimizado afirma que dos empresas distintas son la misma. En una pericia judicial eso **distorsiona la evidencia**, no es cosmético. Y el DNI se salva por casualidad, no por diseño.

**Dirección de arreglo.** El pase difuso debe correr **solo para tipos de texto libre** (Persona, Organización, Dirección), donde tolera un OCR imperfecto ("Pablo Rornan"), y **nunca** para los estructurados, donde un carácter distinto significa otra entidad. Cambia semántica documentada de Grouping → **ADR propio**.

---

## 2. Una entidad partida en dos líneas tapa las dos líneas enteras

**Qué pasa.** Con "Pablo Roman" al final de una línea y "Fortes" al inicio de la siguiente, la censura tapa **ambas líneas completas**, destruyendo texto ajeno.

**Causa, verificada.** `mapSpanToWords` (`regex-engine/src/regex.engine.ts`, ~línea 185) calcula un **único** bbox como min/max sobre las palabras del match:

```
minX = min(word.bbox.x)   maxX = max(word.bbox.x + width)
minY = min(word.bbox.y)   maxY = max(word.bbox.y + height)
```

Con palabras en dos líneas, esa unión es un rectángulo que abarca de la izquierda de una a la derecha de la otra, y todo el alto de las dos.

**Por qué no tiene arreglo local.** `Occurrence.bbox` es **un** `BoundingBox`. Expresar "un rectángulo por línea" es cambio de contrato: toca `shared`, `regex-engine`, `grouping-engine` y `render-engine` → **ADR propio**.

Es la misma clase de falla que ADR-063 —censura que cubre lo que no debe— por otra causa.

**Medido (2026-08-13, segunda prueba manual sobre la pericia de 5 páginas)**. Página 2, entidad `Pablo Román Fortes` detectada por NER: `Pablo` cierra una línea (`x = 524,4`) y `Román Fortes,` abre la siguiente (`x = 14,0`). La unión da **557,2 × 18,2 pt** — prácticamente el ancho útil de la página, dos líneas de alto. En el panel anonimizado es una barra negra que atraviesa el documento.

Confirma que **tapa de más, nunca de menos**: no hay fuga, pero destruye contenido no sensible. Aplica igual al `mapSpanToWords` de `ner-engine`, que es la copia adaptada del de `regex-engine`.

---

## 3. ~~Orden de lectura para texto vertical~~ — **CERRADO en el Hito 10.8 (ADR-067)**

> **Resuelto, no diferido.** Este ítem se escribió cuando el orden de lectura parecía requerir tocar tres motores. **ADR-067** lo cerró dentro del propio Hito 10.8, con alcance de **un** motor. Se conserva la entrada para que quien venga no vuelva a plantearlo como pendiente.

El diagnóstico original era correcto: `sortWordsByReadingOrder` ordenaba por `y` asc, lo que **invierte** un run de texto a 90° y lo intercala con los demás; un nombre multi-palabra dentro de una firma vertical quedaba irreconocible para NER (`Albarracin, Rocio de los Milagros` llegaba como `… Milagros … los … de … Rocio … Albarracin,`).

Lo que estaba mal era el **costo estimado**. El argumento de ADR-063 §4 —"cambia un invariante compartido con `ocr-engine`"— dejó de valer por dos hechos que no existían cuando se escribió:

1. `BoundingBox` ya tiene `rotation` (ADR-066 §6), o sea que hay una señal en el dato para distinguir un word vertical sin re-derivarlo de la matriz.
2. **`ocr-engine` nunca puebla `rotation`**: Tesseract no reporta orientación por palabra y el kernel no la infiere. Un orden que se ramifica por ese campo no lo alcanza — cero cambios en ese motor.

Ver `adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md` y `MVP.md` §4, Hito 10.8 paso 4.

---

## 4. Fechas escritas en texto

`"Quilmes, 07 de julio de 2026"` está en el content stream de la página 1 y **no se detecta**: `date-ar` es `/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/`, solo numéricas.

**Arreglo.** Un patrón `/\b\d{1,2}\s+de\s+(enero|febrero|…)\s+de\s+\d{4}\b/i` con un normalizador que lo lleve a `dd/mm/yyyy`, para que agrupe junto con la fecha numérica equivalente. Media hora de código. La cabecera de la tabla de patrones (`patterns/default-ar.ts`) exige **ADR** para cualquier cambio de esa tabla.

---

## 4bis. Los patrones numéricos matchean partes del número de expediente

Verificado sobre la pericia real: `PP-13-00-027653-24/00` produce una ocurrencia **`[PHONE] "00-027653"`**. Los patrones de `default-ar.ts` no tienen forma de distinguir un tramo de número de causa de un teléfono.

Es un falso positivo benigno en cuanto a fuga (tapa de más, no de menos), pero ensucia la lista de entidades y probablemente explique el "aparecen tres fechas" que reportó el humano. Conviene revisarlo junto con el punto 4, que toca la misma tabla y ya requiere ADR.

---

## 5. Recall de NER sobre nombres

No se detecta "FORTES Pablo Roman" (apellido primero, mayúsculas) ni se unifica con "Dr. Pablo Roman Fortes" de otra página.

**No es un bug.** `MVP.md` §5 declara el recall del NER como métrica **informativa** hasta v1.0, y el roadmap asume que se escapan entidades. La red de contención está diseñada y **sin implementar**: es el **Hito 10.7** (ADR-061 — agregado manual, selección sobre el visor, buscador).

**Recomendación**: implementar 10.7 rinde más que perseguir el recall del modelo. No mejora la detección, pero le da al usuario la herramienta para tapar lo que se escapa.

---

## 6. Marca de agua detectada de forma inconsistente

Se detecta en 2 de 5 páginas siendo el mismo string. El humano decidió **no construir nada**: si no la quiere tapar, deselecciona el grupo.

Queda anotado porque es **síntoma del punto 3**, no un problema propio: el mismo run cae entre vecinos distintos en cada página según el orden de lectura.

---

## 7. Riesgo latente: censura sobre texto superpuesto

Registrado en **ADR-063 §6**, sin mitigación por decisión explícita del humano. Un bbox correcto sobre un sello que pisa el cuerpo del texto tapa lo que hay debajo — medido en 10-14 fragmentos por página en la pericia real. Hoy **inactivo**: nada dentro de ese sello se detecta.

La heurística obvia ("si se repite en todas las páginas, ignoralo") es **insegura**: un pie de página con el nombre de un fiscal cumple la misma condición y sí hay que taparlo.

---

## 8. Discrepancia abierta: rotación a nivel de página

Registrada en **ADR-063 §7**. `Render_Engine.md` §13 caso 15 afirma que "los bbox están en coords de página ya rotada (lo garantiza PDF Engine)"; el motor **no** lo garantiza — nunca aplica `viewport.transform`. Para un PDF con `/Rotate ≠ 0` las coordenadas saldrían mal.

Sin datos para calibrar: las cinco páginas medidas tienen `rotate = 0`. Requiere medición sobre un PDF con `/Rotate ≠ 0` **antes** de escribir el ADR.

---

## 9. Variantes de ops de imagen fuera de alcance

Registrado en la errata de **ADR-065 §1**. La compuerta 1 maneja `paintImageXObject`, `paintImageMaskXObject` y `paintInlineImageXObject`, y **no** las variantes agrupadas/repetidas del optimizador de pdf.js (`paintImageXObjectRepeat`, `paintImageMaskXObjectGroup`, `paintImageMaskXObjectRepeat`, `paintInlineImageXObjectGroup`, `paintSolidColorImageMask`).

Sus argumentos tienen otra forma, así que soportarlas es un cálculo de rectángulo por variante. El modo de falla es un **falso negativo idéntico al comportamiento previo a ADR-065**: cobertura incompleta, no regresión. Cerrar solo si un documento real lo dispara.
