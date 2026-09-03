<!-- CONTEXT: scope=adr | dependencias=ui/Components.md,core/Regex_Engine.md,adr/ADR-061-Entidad-Manual-Y-Busqueda-Literal.md,adr/ADR-089-La-Regla-De-Matcheo-De-La-Busqueda.md,adr/ADR-110-El-Renglon-Es-Un-Grupo-No-Una-Coordenada.md,adr/ADR-113-El-Renglon-Se-Corta-Donde-Hay-Una-Columna.md | audiencia=humanos+IA | fase=11 -->

# ADR-114 — La selección del mouse es de un renglón, y dice si no encontró nada

- **Estado**: Accepted
- **Fecha**: 2026-09-02
- **Decidido por**: El humano, que intentó marcar a mano `TRIBUNAL DE CASACIÓN PENAL` sobre el sello de su expediente y reportó *"no termina de reconocerlo, desconozco bien el por qué"*.
- **Relacionado con**: **ADR-061 §4/§6** (el hit-test sobre el original y la entidad manual), **ADR-089 §1/§2** (la regla de matcheo por ventana de sub-tokens), ADR-110/ADR-113 (el agrupado en renglones, que es de donde sale la definición que se reusa acá)
- **Parte de**: Hito 11, calidad de detección

## Contexto

### 1. El motor encuentra la frase; la UI arma un valor que no existe

Medido con el matcher real sobre las 18 páginas del escaneo donde el sello dice `TRIBUNAL DE CASACIÓN PENAL`:

| holgura del arrastre | valor que arma la UI | apariciones que encuentra |
|---|---|---|
| exacta o +2 pt | `TRIBUNAL DE CASACIÓN PENAL` | **18/18** |
| **+4 pt** | `PROVINCIA DE BUENOS AIRES TRIBUNAL DE CASACIÓN PENAL` | **0/18** |

O sea: `findLiteral` funciona perfecto y el problema es el **valor** que se le pasa.

`WordSelectionOverlay` arma el valor con `wordsInRect(...).map((w) => w.text).join(" ")`, sin mirar de qué renglón viene cada palabra. En el sello de un expediente los renglones están a **4–6 pt**, así que un arrastre de mouse normal roza el de arriba. Y una cadena de dos renglones **no puede matchear nunca**: `slideWordWindowMatches` (ADR-089 §1) exige sub-tokens consecutivos en el orden de lectura y, entre palabras de `Word` distintas, exige además `sharesVerticalBand`. No es una limitación del matcher: es que ese texto no existe en el documento.

### 2. Y la UI no dice nada, ni cuando encuentra ni cuando no

El camino del arrastre tiene **dos salidas silenciosas**:

```ts
if (words.length === 0) return;                        // no pasa nada, sin aviso
…
void actions.addManualEntity({ value, entityType });    // promesa suelta, sin leer el resultado
```

`AddEntityDialog` —la otra vía de entrada al mismo `addManualEntity`— sí distingue los tres casos con `manualEntityFeedback` y muestra "no se encontró". El arrastre cierra el popover igual encuentre 18 apariciones o ninguna. Por eso el reporte fue *"desconozco bien el por qué"*: no hay nada que leer.

## Decisión

### 1. La selección se recorta al renglón dominante

De las palabras que el rectángulo tocó se conserva **un solo renglón**: la corrida con más **área seleccionada**.

Un renglón se reconoce con lo que `Page.words` ya trae, no re-derivando geometría en la UI: las palabras de un renglón son **consecutivas** (ADR-110/ADR-113) y **avanzan hacia la derecha**. La corrida se corta cuando aparece una palabra no seleccionada o cuando la `x` **retrocede** — el retorno de carro. Las dos condiciones hacen falta: dos renglones seguidos de la misma columna son contiguos en `Page.words`, que es justo el caso del sello (`PROVINCIA…AIRES` y `TRIBUNAL…PENAL` van pegados).

**El desempate es por área y no por cantidad de palabras**, y no es un detalle: los dos renglones del sello tienen cuatro palabras cada uno, así que empatan en cantidad y "el primero" devolvería el equivocado. El área mide lo que el usuario cubrió de verdad.

Restringir a un renglón no saca nada que funcionara: un valor de dos renglones tenía 0 coincidencias posibles por construcción (§1).

### 2. El resultado se espera y se muestra

`handleConfirm` pasa a `await` y usa `manualEntityFeedback` —el mismo helper que ya usa `AddEntityDialog`—: con `not-found` el popover **queda abierto** con "No se encontró ese valor en el documento"; con `added` se cierra como siempre.

Se deja como está el `return` silencioso de un arrastre sobre papel en blanco: ahí no hay ninguna intención que reportar.

## Consecuencias

- El arrastre sobre una frase del sello arma un valor que el motor encuentra en las 18 páginas, en vez de uno que no encuentra en ninguna.
- Cuando el valor no aparece —porque el OCR lo leyó distinto en esa página, que es un caso real de este documento— el usuario lo ve.

**En contra**

- **Ya no se puede seleccionar dos renglones a la vez con un arrastre.** No es una pérdida medible (esa selección producía 0 coincidencias), pero es un cambio de comportamiento: antes el popover aparecía con el valor de las dos líneas.
- **El recorte es una regla de la UI, no del motor.** Un caller que arme el valor por otra vía (el diálogo, la lupa) sigue pudiendo pasar cualquier cadena; lo que este ADR arregla es la vía del mouse.
- La corrida se corta por retroceso de `x`, así que **un renglón con la última palabra desplazada hacia atrás** (no visto en el corpus) se partiría en dos. El desempate por área elige el trozo mayor.

**Lo que no toca**: `findLiteral`, `slideWordWindowMatches`, `wordsInRect`, ni ningún contrato. El cambio vive en `apps/react-client`.

## Qué hay que cubrir con tests

- Un arrastre que cubre un renglón y roza el de arriba devuelve **solo** el renglón cubierto.
- Un arrastre limpio devuelve el renglón entero, sin recortar.
- Con dos renglones empatados en cantidad de palabras, gana el que tiene más área seleccionada — falla si el desempate se hace por cantidad.
- Sin el corte por retroceso de `x`, dos renglones contiguos de la misma columna salen como uno solo.
- Una selección de una sola palabra, y una vacía, pasan tal cual.
