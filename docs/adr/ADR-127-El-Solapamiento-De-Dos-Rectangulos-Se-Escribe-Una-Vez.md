<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Render_Engine.md,roadmap/Duplicacion_De_Logica.md,adr/ADR-061-Agregado-Manual-De-Entidades.md | audiencia=humanos+IA | fase=11 -->

# ADR-127 — El solapamiento de dos rectángulos se escribe una vez

- **Estado**: Accepted
- **Fecha**: 2026-09-03
- **Decidido por**: El humano, que pidió eliminar código y lógica repetida a partir del inventario de `roadmap/Duplicacion_De_Logica.md`.
- **Relacionado con**: **ADR-061 §2 (errata)**, que promovió `sharesVerticalBand` y `normalizeForComparison` a `@anonly/shared` por exactamente esta razón; `Duplicacion_De_Logica.md` §3
- **Parte de**: Hito 11

## Contexto

### 1. La misma fórmula, dos veces, con una diferencia

El predicado "¿estos dos rectángulos se solapan?" está escrito dos veces en el Core:

| dónde | guarda de área cero |
|---|---|
| `shared/src/words-in-rect.ts` (`intersects`, privada del módulo) | **sí** (`width <= 0 \|\| height <= 0 → false`) |
| `render-engine/src/worker/kernel.ts` (`overlapsBbox`) | **no** |

Es la misma AABB con los términos reordenados. Lo que la vuelve elocuente es que **ese mismo archivo de `render-engine` ya importa `sharesVerticalBand` de `shared`**: el precedente de compartir geometría con este motor existe, está a cuarenta líneas, y el overlap se reimplementó igual.

### 2. La diferencia no es cosmética, y hoy no se nota

Un rectángulo sin área no se solapa con nada — es lo que dice la copia de `shared`, y es la respuesta correcta. La de `render-engine` contesta que sí puede solaparse: con `width = 0`, la comparación `b.x < a.x + a.width` se vuelve `b.x < a.x`, que para un rectángulo a la izquierda es verdadera.

Hoy no se nota porque el único consumidor de `overlapsBbox` compara bboxes de palabras y de reemplazos contra otros reemplazos, y ninguno tiene área cero en la práctica. Pero es la semilla exacta de la clase de bug que motivó la errata de ADR-061 §2: dos copias de una primitiva geométrica que ya no dan la misma respuesta, y ningún test que las compare entre sí — cada motor tiene su suite y las dos pasan.

### 3. Esto ya se había decidido al revés, sobre una premisa que resultó falsa

`Render_Engine.md` §15 item 28 —el que adoptó `sharesVerticalBand` de `shared`— dejó dicho, en la misma línea:

> *"`overlapsBbox` —el overlap 2D genérico de al lado— **no** se promueve: es otra pregunta (¿se pisan estas dos cajas?), tiene **un solo consumidor** y confundirla con la banda vertical sería el error que la promoción viene a evitar."*

Dos razones, y hay que separarlas porque solo una se cae:

- *"Es otra pregunta"* — **cierto, y este ADR lo sostiene**: `rectsOverlap` no reemplaza a `sharesVerticalBand` (§3 de la Decisión). El riesgo que ese item señalaba era confundirlas, y no se corre.
- *"Tiene un solo consumidor"* — **falso**, y por eso este ADR existe. `shared` ya tenía la misma función escrita en privado (`intersects`), en el mismo repo, con una guarda de más. Eran dos desde antes de que se escribiera esa línea; lo que faltaba era mirarlas juntas, que es lo que hizo el inventario de `Duplicacion_De_Logica.md` §3.

Este ADR supersede esa media línea del item 28, no el item.

### 4. Por qué no alcanza con copiar la guarda

Copiar la guarda a `render-engine` deja dos copias idénticas, que es el estado del que este inventario advierte que hay que salir: *"dos copias idénticas y estables valen mucho menos que dos que ya se separaron"* — pero solo porque son menos urgentes, no porque estén bien. La siguiente corrección volvería a aplicarse en un lado solo.

`intersects` no está exportada, así que compartirla es superficie pública nueva de `@anonly/shared`, y eso es contrato: R-2/R-19 piden ADR primero, `Contracts.md` después, código al final. Este es ese ADR.

## Decisión

### 1. `rectsOverlap` se promueve a `@anonly/shared`

Predicado puro, con la semántica de la copia de `shared` —la que ya estaba bien—: **solapamiento estricto** (tocarse por el borde exacto no cuenta) y **un rectángulo sin área no se solapa con nada**.

Se declara en `Contracts.md` §6 junto a `sharesVerticalBand` y `normalizeForComparison`, que llegaron ahí por el mismo camino y con el mismo argumento (ADR-061 §2 errata: *"dos primitivas que ya estaban duplicadas dentro de motores y façade por no tener lugar donde vivir"*).

### 2. Los dos consumidores la usan

`wordsInRect` (dentro de `shared`) y `overlapsBbox` de `render-engine`, que desaparece. Es el único cambio de comportamiento del ADR y va en la dirección correcta: un rectángulo sin área deja de solaparse.

### 3. `sharesVerticalBand` **no** se reimplementa en términos de ésta

Son dos preguntas distintas y tienen que poder responder distinto: `sharesVerticalBand` mira **solo el eje Y** —es la definición de "misma línea" del producto (ADR-058 §5)— y `rectsOverlap` mira los dos ejes. Que una sea el caso 1D de la otra es cierto y no importa: unificarlas ataría el criterio de "misma línea" a un cambio de geometría 2D. Mismo criterio con el que `Duplicacion_De_Logica.md` deja afuera `bboxIntersectionRatio` vs `overlapRatioWithRect`.

## Consecuencias

- Una sola definición de solapamiento 2D en el Core, con una sola guarda, y un solo lugar donde arreglarla.
- `render-engine` pierde una función privada y gana un import del paquete del que ya importaba geometría.

**En contra**

- **Un símbolo más en la superficie pública de `@anonly/shared`**, que se paga en cada motor que lo lee aunque no lo use. Es el costo que ADR-061 §2 ya aceptó dos veces por el mismo motivo.
- **Cambia una respuesta**: un bbox de área cero pasa de "puede solaparse" a "no se solapa". No hay ningún caso vivo que lo produzca —por eso el riesgo del inventario es "bajo hoy"—, así que el cambio no es observable en el producto y sí lo es en el código.

**Lo que no toca**: `sharesVerticalBand`, los dos ratios de solapamiento de `grouping-engine`/`pdf-engine` (que son reglas de negocio distintas, no duplicación), ni ningún evento o tipo.

## Qué hay que cubrir con tests

- Los dos casos que separan las copias: **borde exacto** (no se solapan) y **área cero** (no se solapa), que es la respuesta que `render-engine` daba distinta.
- Solapamiento parcial, contención total y disjuntos, en los dos ejes.
- `wordsInRect` sigue comportándose igual: es el consumidor que ya tenía esta semántica y su suite no debería moverse.
