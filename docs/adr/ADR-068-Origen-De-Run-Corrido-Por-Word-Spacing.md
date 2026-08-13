<!-- CONTEXT: scope=adr | dependencias=core/PDF_Engine.md,architecture/03_Data_Model.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=10.8 -->

# ADR-068 — El origen que reporta `getTextContent()` se corrige contra el operator list

- **Estado**: Accepted
- **Fecha**: 2026-08-13
- **Decidido por**: El humano, tras probar el hito sobre la pericia **original de 5 páginas** y encontrar que el reemplazo de `La Plata` en la página 2 se pinta a la izquierda del texto.
- **Relacionado con**: ADR-020 §1 (el prorrateo por token, que consume este origen), ADR-063 §2 (la envolvente, que parte de este origen), ADR-066 §2 y su corrección (el `TextState` que este ADR reutiliza), ADR-065 §1 (el operator list que ya se recorre)
- **Parte de**: Hito 10.8, paso 5

> Convención de citas: `ADR-068 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-068, Contexto §N`.

## Contexto

### 1. El reemplazo cae 58 pt a la izquierda del texto

Página 2 de la pericia, línea `La Plata, 1 de julio de 2026`. Medido:

```
getTextContent() -> transform[4] = 190.20   width = 111.21
tinta del render ->  x de 248.5 a 359.0     (ancho 110.5)
```

El **ancho es correcto** (111,21 contra 110,5 medidos). Lo único equivocado es el **origen**: 58,3 pt a la izquierda. Como `convertTextItemsToWords` construye toda la geometría del `Word` a partir de ese origen (ADR-020 §1, ADR-063 §2), la caja negra se pinta fuera del texto y el dato queda a la vista.

### 2. La causa: `Tw` aplicado a espacios que después se descartan

Los ops del run:

```
setTextMatrix [1.29051, 0, 0, 1, 14.025, 587.113]
setFont       ["g_d0_f1", 8.08989]
setWordSpacing [-0.505618]                 ← negativo
showText      "<90 espacios>La Plata, 1 de julio de 2026"
```

`getTextContent()` entrega `str = "La Plata, 1 de julio de 2026"` —con los 90 espacios **descartados**— pero calcula el `transform` **aplicándoles el word spacing**. Reproduciendo la aritmética sobre el operator list:

```
avanzando los 90 espacios SIN aplicar Tw -> x = 248.93   ≈ la tinta real (248.5)
avanzando los 90 espacios CON  Tw        -> x = 190.20   = lo que reporta getTextContent
```

Las dos cuentas dan, al centésimo, los dos números observados. **El renderer no aplica `Tw` y `getTextContent()` sí.**

El renderer es el que tiene razón: PDF 32000-1 §9.3.3 restringe el word spacing al **código de un solo byte 32**, y no aplica a los códigos de dos bytes de una fuente compuesta. Y además es el criterio operativo correcto para Anonly: el export es reconstrucción raster (ADR-009 §1), o sea que **lo que el renderer dibuja es literalmente el documento final**.

Ninguna opción de la API lo evita: `disableNormalization` e `includeMarkedContent` devuelven los mismos `190.20`.

### 3. La maquinaria para calcularlo bien ya está en el motor

La corrección de ADR-066 §2 introdujo `TextState`, que mantiene `Tm` (`setTextMatrix`, `Td`, `TD`, `T*`, `TL`), `Tfs`, `Th` y las respeta en `save`/`restore`. Sumarle `Tc` y `Tw` alcanza para reproducir las dos cuentas de Contexto §2. Y el operator list **ya se recorre** en cada página (compuerta 1 de ADR-065 §1 + anotaciones de ADR-066 §1): no hay una pasada nueva ni un costo nuevo.

## Decisión

### 1. El recorrido del operator list emite correcciones de origen, no words

De cada `showText`/`showSpacedText` **de página** (fuera de toda anotación) se calcula el avance de los glifos que preceden al primer glifo visible, en dos variantes: aplicando `Tw` y sin aplicarlo. Si difieren, se emite un par:

- **`from`**: el origen que `getTextContent()` va a reportar (avance **con** `Tw`).
- **`to`**: el origen que el renderer dibuja (avance **sin** `Tw`).

El texto sigue saliendo de `getTextContent()`. De este recorrido **no** sale ni una palabra: solo la corrección geométrica. Los ajustes de kerning de un `TJ` se suman a las dos variantes por igual — no dependen de `Tw`.

### 2. La corrección se aplica solo si el origen reportado coincide con un `from`

`convertTextItemsToWords` busca, para cada item, una corrección cuyo `from` coincida con `transform[4]`/`[5]` dentro de 0,05 pt. Si la encuentra, usa `to`; si no, deja el item **exactamente** como está.

Esa condición es lo que hace la corrección segura: se aplica únicamente cuando el motor pudo **reproducir al centésimo el número equivocado de pdf.js**, que es la prueba de que entendió el caso. Consecuencias:

- Un documento sin `Tw` no tiene ni una corrección: cero cambios, y el snapshot no se mueve.
- Si una versión futura de `pdf.js` arregla el defecto, los `from` dejan de coincidir y el motor vuelve solo al comportamiento sin corregir. No queda una compensación aplicándose sobre un dato ya corregido.
- Si la reproducción falla por un caso no contemplado, el resultado es el de hoy — nunca uno peor.

### 3. Solo se corrige el origen

`item.width` se conserva: está medido correcto (Contexto §1). Este ADR no toca el prorrateo por token de ADR-020 §1 ni la envolvente de ADR-063 §2 — les cambia el punto de partida, nada más.

### 4. El texto de anotaciones no participa

Los runs dentro de `beginAnnotation`/`endAnnotation` ya se extraen del operator list con su geometría propia (ADR-066 §1), sin pasar por `getTextContent()`: no tienen este defecto y quedan fuera.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Corregir el origen contra el operator list | Derivar **toda** la geometría del texto nativo del operator list | Es la solución de fondo, pero obliga a reimplementar el layout de texto de pdf.js (anchos de glifo, `Tc`/`Tw`/kerning, selección de fuente) y cambiaría el bbox de **todos** los documentos, snapshot incluido. Riesgo desproporcionado para un defecto que se localiza en un solo dato. |
| Corregir el origen | Alguna opción de `getTextContent()` | Medido: `disableNormalization` e `includeMarkedContent` devuelven el mismo `190.20`. |
| Emparejar por el origen reportado | Emparejar item ↔ op por orden de aparición | El orden coincide en la práctica, pero un item que pdf.js parta o fusione desalinea todo el resto de la página **en silencio**. Emparejar por el valor exige reproducir el número equivocado, que es una condición mucho más fuerte y falla de forma local. |
| Emparejar por el origen reportado | Corregir todos los items de la página por el mismo delta | El `Tw` y la cantidad de espacios cambian run por run; un delta global movería texto que estaba bien. |
| No tocar `width` | Recalcular también el ancho desde los glifos | El ancho ya es correcto; recalcularlo solo agrega superficie de error. |

## Consecuencias

**Positivas**:

- El reemplazo vuelve a caer sobre el texto en documentos con word spacing. Medido: `La Plata` pasa de `x = 190,2` a `x = 248,9`, contra 248,5 de tinta real.
- Ningún item que hoy sale bien se mueve: verificado sobre la misma página, `Departamento Judicial Quilmes` (14,0), `Sr. Juez` (14,0) y `CATALINA SMERNOFF` (294,0) quedan idénticos.
- Costo nulo: es el mismo operator list que ADR-065 §1 y ADR-066 §1 ya piden.
- El motor deja de depender de que `getTextContent()` sea consistente con el renderer en el único punto donde se comprobó que no lo es.

**Negativas**:

- El motor pasa a reproducir un comportamiento **defectuoso** de una dependencia para poder detectarlo. Mitigado por §2: si el defecto desaparece, la corrección se desactiva sola.
- Queda una asimetría: el origen sale del operator list y el ancho de `getTextContent()`. Es deliberado (§3) y está acotado a un dato.
- No cubre un `Tw` que afecte a espacios **interiores** del texto visible: ahí el ancho reportado ya es correcto (Contexto §1), así que no hay nada que corregir hoy, pero es un supuesto que este ADR no verifica en general.

## Validación

- Test unit (`pdf-engine`): un run con `Tw` y espacios iniciales mueve el `Word` al origen que dibuja el renderer, no al reportado.
- Test unit: sin `Tw` el origen queda **intacto** — la garantía de no regresión.
- Test unit: un item cuyo origen no coincide con ninguna corrección queda intacto (§2, el guard).
- El snapshot de `pdf-engine` **no se regenera**.
- Cobertura ≥ 85% líneas en `pdf-engine`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract` verdes.

## Referencias

- `core/PDF_Engine.md` §12, §13 caso 41, §14
- `architecture/03_Data_Model.md` §4 (`Word.bbox`)
- `adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md` §1 (prorrateo por token)
- `adr/ADR-063-Bbox-De-Texto-Rotado.md` §2 (la envolvente parte de este origen)
- `adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md` §2 y su corrección (`TextState`)
- `adr/ADR-009-Export-Strategy.md` §1 (el export es raster: el renderer es el documento final)
- `ai/AI_Development_Guide.md` R-1, R-2, R-13, R-19, R-21
