<!-- CONTEXT: scope=adr | dependencias=core/Grouping_Engine.md,core/Contracts.md,adr/ADR-094-Lo-Que-El-Detector-Duda-No-Se-Tira-En-Silencio.md,adr/ADR-073-Matcheo-Difuso-Solo-Para-Texto-Libre.md,adr/ADR-085-Memoria-De-Reclasificacion.md,adr/ADR-115-La-Puntuacion-Pegada-No-Es-Parte-Del-Valor.md,roadmap/OCR_Escaneos_Handoff.md | audiencia=humanos+IA | fase=11 -->

# ADR-116 — Un valor que el documento ya confirmó no se descarta

- **Estado**: Accepted
- **Fecha**: 2026-09-02
- **Decidido por**: El humano, que sobre un expediente escaneado encontró **una sola página** —la 6 de 20— donde el apellido del imputado seguía sin taparse, con el mismo sello que en las otras diecinueve.
- **Relacionado con**: **ADR-094** (que abrió la puerta de "lo que el detector duda no se tira en silencio" y este ADR termina de cruzar), ADR-073 §1 (el pase difuso es solo para texto libre), ADR-085 §1(a) (`findMatchingGroup` y los tipos absorbidos), ADR-115 (que unificó la clave de agrupado de la vía manual)
- **Parte de**: Hito 11, calidad de detección

> **Los nombres de este documento son ficticios.** El expediente sobre el que se midió es real y no se transcribe acá (`08_Security_Model.md` §10.2: nada de contenido de documento fuera de RAM, y una herramienta de anonimización no es lugar para datos de una causa penal). Los reemplazos **preservan largo y cantidad de diacríticos**, porque varias distancias citadas son Levenshtein normalizado por longitud: con otro nombre, el número dejaría de verificar. Precedente: ADR-084.

## Contexto

### 1. Una página de veinte, y no es el OCR

Radiografía de la página 6, con el motor real de punta a punta:

```
renglones del encabezado
  y~105.0   PROVINCIA DE BUENOS AIRES
  y~110.9   SUAREZ, BARTOLOME ARTURO S/ RECURSO DE
  y~117.8   TRIBUNAL DE CASACION PENAL

palabra del sello: <<SUAREZ,>>  x=256.8  y=107.3  conf=96

spans del NER en el encabezado
  [ADDRESS] conf=1.000              <<PROVINCIA DE BUENOS AIRES>>
  [PERSON ] conf=0.612 BAJO-UMBRAL  <<SUAREZ>>       -> palabras [21,22) = <<SUAREZ,>>
  [PERSON ] conf=0.939              <<BARTOLOME ARTURO S>>
```

Todo está bien salvo un número: el OCR lo lee al 96 %, el orden de lectura es correcto (ADR-113), el mapeo a palabras y la caja son exactos. **El NER lo detecta** — con **0,612**, contra un `confidenceThreshold` de 0,7.

### 2. Y ahí se descarta, aunque el documento ya tenga ese grupo

`handleLowConfidence` busca un grupo candidato, lo encuentra (`suarez` existe, abierto por 23 ocurrencias de las otras páginas), emite un `CONFLICT_DETECTED` de `LowConfidence` marcado como resuelto… y **vuelve sin registrar la ocurrencia**. El grupo nunca la ve, así que en la página 6 no se pinta nada.

El rastro del descarte queda —eso lo arregló ADR-094, que cerró el `warn` mudo— pero el rastro no tapa un apellido.

Lo confirma el propio síntoma que reportó el humano: al agregar el apellido a mano, el grupo `SUAREZ` pasa de **23 a 34** ocurrencias. `findLiteral` emite con `confidence: 1.0`, así que no pasa por este camino; y de paso barre el documento entero y rellena todos los huecos que el NER había dejado por lo mismo.

### 3. "Conflicto" no describe lo que pasa acá

`findMatchingGroup` devuelve un grupo por dos vías de fuerza muy distinta: **`normalizedValue` exacto**, o Levenshtein ≥ `similarityThreshold` (0,88). Tratar a las dos igual es lo que hace que un valor **idéntico** a uno ya confirmado por el documento se llame "conflicto".

No hay tal conflicto: es el mismo valor, en el mismo documento, en un grupo que el usuario ya está viendo y que ya tapa en otras páginas.

## Decisión

**Una ocurrencia bajo el umbral cuya clave coincide EXACTO con la de un grupo ya existente entra al grupo.** El `CONFLICT_DETECTED` se sigue emitiendo igual, con la misma forma —el rastro no se pierde—, pero además se registra la ocurrencia.

Si la coincidencia es **solo difusa**, no cambia nada: se emite el conflicto y se descarta, como hoy.

**La regla nunca crea un grupo.** Solo agrega ocurrencias a grupos que el documento ya abrió con una detección **por encima** del umbral. Esa es la propiedad que acota el riesgo: la superficie de falsos positivos no crece, porque el grupo equivocado —si lo hubiera— ya existe, ya está encendido y ya tapa en otro lado. Lo único que cambia es cuántas de sus apariciones se tapan.

## Consecuencias

**Medido antes de implementar**, sobre 8 documentos / 115 páginas (el fallo escaneado por OCR, dos pericias, una apelación, un oficio, dos fallos nativos y un cuento):

| | |
|---|---|
| ocurrencias por debajo del umbral | **54** |
| de esas, con clave **exacta** contra un grupo ya abierto → **entran** | **9** |
| con coincidencia **solo difusa** → siguen afuera | **0** |
| sin ningún grupo candidato → camino de ADR-094, sin cambios | **45** |

Que la columna del difuso dé **cero** es el dato que hace barata la distinción: separar las dos vías no le quita nada a nadie hoy, y deja cerrada la puerta más floja.

Las 9 que entran, una por una:

```
escaneo p6   [PERSON]       conf=0.612  <<SUAREZ>>      <- el defecto reportado
pericia p2   [ADDRESS]      conf=0.677  <<Quilmes>>
scba p24     [ADDRESS]      conf=0.600  <<Mercedes>>
scba p25     [ADDRESS]      conf=0.573  <<Mercedes>>
scba p6      [ORGANIZATION] conf=0.587  <<Tribunal>>
scba p46     [ORGANIZATION] conf=0.551  <<NNyA>>
scba p50     [PERSON]       conf=0.648  <<Fiscal>>
oficio p3    [ORGANIZATION] conf=0.491  <<Ud>>
cuento p6    [PERSON]       conf=0.559  <<AM>>
```

Seis son correctas sin discusión. Las tres discutibles —`Ud` como organización, `Fiscal` como persona, `AM` como persona— **ya son grupos del documento**, creados por una detección de alta confianza que este ADR no toca: apagarlos es un clic, y ese clic ya hacía falta antes. Ninguna de las nueve crea un grupo nuevo.

**En contra**

- **El umbral pierde una parte de su significado.** `confidenceThreshold` sigue gobernando qué abre un grupo, pero ya no gobierna del todo qué entra a uno. Es deliberado: lo que el umbral protege es la decisión de *inventar una entidad*, no la de reconocer otra aparición de una que el documento ya tiene.
- **El `value` de una ocurrencia dudosa entra a la lista de alias del grupo** y participa del recuento que elige el `canonicalValue`. Con clave exacta los alias son variantes de caja o puntuación del mismo texto, así que el canónico puede cambiar de caja. No cambia a qué entidad se refiere el grupo.
- **No arregla la causa de fondo del 0,612.** El NER ve el sello como una oración corrida —`Page.text` se arma con `join(" ")`, sin ningún salto de renglón— precedida por la basura del código de barras, y ahí la confianza baja. Este ADR hace que eso deje de costar un dato a la vista; no hace que el modelo lea mejor un sello.

**Lo que no toca**: `confidenceThreshold` ni ningún default de config, el camino de ADR-094 (sugerencia cuando no hay grupo candidato), la resolución de conflictos de solapamiento/desacuerdo, el pase difuso de `findMatchingGroup`, y ningún contrato público — `CONFLICT_DETECTED` se sigue emitiendo con la misma forma y en el mismo momento.

## Qué hay que cubrir con tests

- Una ocurrencia bajo el umbral con clave **exacta** contra un grupo existente: entra al grupo **y** emite `CONFLICT_DETECTED`. Las dos cosas, no una.
- Una ocurrencia bajo el umbral que solo coincide **difuso**: emite el conflicto y **no** entra — la no regresión de la puerta floja.
- Una ocurrencia bajo el umbral **sin** grupo candidato: sigue el camino de ADR-094 (sugerencia apagada + `needsReview`, o descarte si no es sugerible).
- El grupo que absorbe una ocurrencia dudosa **no se enciende solo** si estaba apagado: la promoción de ADR-094 §3 es para ocurrencias por encima del umbral, y este camino no la hereda.
