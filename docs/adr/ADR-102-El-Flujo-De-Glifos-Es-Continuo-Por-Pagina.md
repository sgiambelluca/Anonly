<!-- CONTEXT: scope=adr | dependencias=core/PDF_Engine.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md,adr/ADR-068-Origen-De-Run-Corrido-Por-Word-Spacing.md,adr/ADR-097-El-Avance-Real-De-Cada-Glifo-Reemplaza-Al-Promedio.md,roadmap/Post_Hito10.8_Pendientes.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-102 — El flujo de glifos es continuo por página

- **Estado**: Accepted
- **Fecha**: 2026-08-27
- **Decidido por**: El humano, tras el gate visual sobre un expediente real (`Post_Hito10.8_Pendientes.md` §24).
- **Relacionado con**: **ADR-097 §1/§2 (superseded en su mecanismo)**, ADR-020 §1 (el prorrateo, que sigue siendo el camino de reserva), ADR-068 (la corrección de origen), ADR-063 §3 (el eje de avance)
- **Parte de**: Hito 11, calidad de detección

## Contexto

### 1. ADR-097 funciona en los fixtures y es inerte en documentos reales

ADR-097 empalma cada `TextItem` con **un run** de `showText`, exigiendo **cadena exacta + origen**. Sobre los 28 fixtures del repo da 100 %. Sobre documentos reales:

| documento | empalme |
|---|---|
| cuento (11 pp) | **0,2 %** |
| pericia (5 pp) | **27,4 %** |
| fallo judicial (51 pp) | **2,9 %** |

La causa, medida: `getTextContent()` **re-segmenta el flujo de texto en fronteras propias**, distintas de las operaciones de dibujo. No es 1:1 ni N:1 sino muchos a muchos:

```
item = "1"                              run  = " "
item = "No Tengo Boca. Y Debo Gritar."   runs = "1 No Tengo Boca. Y Debo Gritar. "
```

Los fixtures salen de `pdf-lib`, que escribe **una operación por línea**. Un procesador de texto no.

### 2. Y el defecto que ADR-097 venía a arreglar sigue vivo, con evidencia visual

Gate manual sobre el PDF exportado de la pericia, con todas las entidades activas: **cinco fugas en una sola página**, de uno a tres caracteres del original a la izquierda del token, sobre nombres de profesionales, una institución y un topónimo (§24). Medido a ciegas sobre el mismo documento: el corrimiento supera el ancho del primer glifo en el **11,4 %** de las palabras de items multi-palabra.

### 3. La segmentación es el problema; la posición no

Los glifos que dibuja la página **están todos ahí**, en orden, con su avance real. Lo único que no coincide es **dónde corta** `getTextContent` respecto de dónde corta el operator list. Exigir que las dos segmentaciones coincidan —lo que hace ADR-097 §2— es exigir algo que el formato no promete.

## Decisión

### 1. Un flujo continuo de glifos por página, no una tabla por run

El recorrido del operator list (ADR-066 §1, el mismo de siempre) deja de emitir una tabla **por run** y pasa a emitir **una sola secuencia por página**, en orden de dibujo:

```ts
interface PageGlyph {
  readonly unicode: string;   // un carácter
  readonly x: number;         // posición absoluta en espacio de página
  readonly y: number;
  readonly advance: number;   // su propio avance, en unidades de página
}
```

Sin fronteras de run: las fronteras eran justamente lo que no coincidía.

### 2. El item se ubica por su origen y se alinea carácter a carácter

1. Se busca en el flujo el glifo cuya posición coincide con el origen que reporta `getTextContent`, con la misma tolerancia de ADR-068 (**0,05 pt**).
2. Desde ahí se camina el flujo **alineando con `item.str`**. Un espacio de la cadena que no tiene glifo detrás —los que pdf.js **sintetiza** cuando el productor separó palabras moviendo el cursor— se saltea del lado de la cadena, no del flujo.
3. Si la alineación llega hasta el final, cada carácter del item tiene su glifo: de ahí salen el origen y el ancho de cada token.

`origen del token = glifo[inicio]`; `ancho = suma de los avances de sus glifos`. Las dos cosas son exactas, no prorrateadas.

### 3. La alineación **es** el guard, y eso está medido

Aflojar la tolerancia del origen no mejora nada: los fallos de "origen no ubicado" se convierten en fallos de "cadena no alinea", con el total de empalmes **igual o peor**.

| tolerancia | Ellison: empalmados | sin origen | no alinea |
|---|---|---|---|
| 0,05 pt | 448 | 7 | 0 |
| 0,5 pt | 448 | 4 | 3 |
| 2,0 pt | 448 | 0 | 7 |

O sea: con una tolerancia laxa el buscador encuentra el glifo **equivocado**, y la alineación lo rechaza. No hay forma de colar un empalme incorrecto aflojando la búsqueda — que es exactamente la propiedad que se le pide a un guard.

Se conserva **0,05 pt** porque es la más estricta sin costo.

### 4. Sin alineación, el prorrateo de ADR-020 §1 sigue intacto

Igual que en ADR-097 §3: si no se ubica el origen o la cadena no alinea —`/ActualText`, normalización agresiva, un productor raro— ese item queda **exactamente como antes**. El peor caso sigue siendo el statu quo.

El camino de anotaciones (ADR-066 §1) tampoco cambia: ahí la cadena y la geometría salen de la misma fuente y no hay dos segmentaciones que reconciliar.

### 5. Qué queda de ADR-097

**Superseded su mecanismo (§1 tabla por run, §2 empalme por cadena exacta).** Se conservan:

- Su **aritmética de avance** por glifo (§1), que es la misma y está verificada contra las métricas AFM de Helvetica.
- Su **§3** (el prorrateo como reserva) y su **§4** (`Tw` fuera de la tabla, por consistencia con ADR-068).
- Su **§5** (la instrumentación del empalme), que es lo que permitió descubrir que el mecanismo no servía. Sigue.

## Consecuencias

**Medido** — items multi-palabra empalmados:

| documento | ADR-097 | **ADR-102** |
|---|---|---|
| `qa-stamp.pdf` (fixture) | 100 % | **100 %** |
| pericia (5 pp, real) | 27,4 % | **89,3 %** |
| cuento (11 pp, real) | 0,2 % | **98,5 %** |
| fallo judicial (51 pp, real) | 2,9 % | **100 %** |

**En contra**

- Memoria por página proporcional al **texto**, no al número de runs: un objeto por carácter dibujado. Se descarta al terminar la página.
- La búsqueda del origen es sobre el flujo entero. Se indexa por posición cuantizada para no pagar O(items × glifos) en una página densa.
- La alineación puede fallar a mitad de un item largo y descartar trabajo ya hecho. Es el precio de que el guard sea estricto.

**Lo que sigue sin medirse**

- Si las palabras que el empalme **no** alcanza son entidades. En la pericia queda un 10,7 %.
- El **ancho** de la caja se corrige por la misma vía, pero el gate visual mostró que también tapa de menos por la derecha: falta rehacer ese gate con esta decisión aplicada para confirmar que se cerró.
