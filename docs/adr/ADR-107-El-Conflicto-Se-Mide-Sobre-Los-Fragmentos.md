<!-- CONTEXT: scope=adr | dependencias=core/Grouping_Engine.md,core/Contracts.md,architecture/03_Data_Model.md,adr/ADR-074-Una-Entidad-Partida-En-Varias-Lineas.md,adr/ADR-083-El-Conflicto-Se-Resuelve-Eligiendo-El-Tipo.md,roadmap/Post_Hito10.8_Pendientes.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-107 — El conflicto se mide sobre los fragmentos, no sobre la envolvente

- **Estado**: Accepted
- **Fecha**: 2026-08-27
- **Decidido por**: El humano, tras pedir explícitamente buscar la causa antes de arreglar nada (`Post_Hito10.8_Pendientes.md` §27 punto 7).
- **Relacionado con**: **ADR-074 §1** (que introdujo `fragments` por esta misma razón y cuya regla este ADR extiende), ADR-083 (la resolución del conflicto, que no cambia)
- **Parte de**: Hito 11, calidad de detección

## Contexto

### 1. La envolvente de una entidad que cruza renglón abarca el bloque entero

Cuando una entidad cae partida por un salto de línea, `bbox` es la **envolvente** de las dos líneas y `fragments` la descomposición por renglón (ADR-074 §1). La envolvente arranca donde empieza el pedazo de la primera línea y termina donde termina el de la segunda: **cubre todo el ancho del bloque de texto**.

Medido a ciegas sobre una pericia real, la ocurrencia más ancha del documento:

```
ancho  alto  tipo    det   conf  chars  palabras  líneas
  561    18  PERSON  ner  1.000     18         3       2
```

**18 caracteres, 3 palabras** — un nombre normal. Los 561 pt (media página) son su envolvente, y son correctos: es exactamente lo que ADR-074 describe.

### 2. La detección de conflictos compara envolventes

```ts
if (bboxIntersectionRatio(rec.bbox, occurrence.bbox) > 0.5) {   // grouping.engine.ts:1801
```

Cuando `Contracts.md` (nota de `fragments`) fija la regla al revés:

> *"Quien PINTA usa `fragments ?? [bbox]`, **nunca la envolvente sola**."*

### 3. Y produce conflictos falsos, medidos

Sobre la misma pericia, contando cuántos pares de grupos activos se solapan en la misma línea:

```
usando la ENVOLVENTE:  contiene 3   parcial 0
usando FRAGMENTS:      contiene 0   parcial 0
```

Y lo que el motor efectivamente hizo:

```
conflictos por razón: {"overlap": 3, "ambiguous_canonical": 1}
ocurrencias emitidas ......... 29
  en un grupo ACTIVO ......... 22
```

**Los 3 conflictos `overlap` son exactamente los 3 artefactos.** Una **sola** entidad que cruza renglón genera tres conflictos falsos contra vecinas que no toca.

Y un conflicto falso no es cosmético: `conflictWinnerIsNew` decide un ganador, así que la perdedora **no llega a formar grupo**. Es el mecanismo que la nota de `caratula-ar` ya describía — *"una entidad que abarca dos runs no solo tapa de más, hace desaparecer a su vecina"*— con otro disparador.

### 4. Esto corrige un diagnóstico previo, no solo el código

La primera lectura de este hallazgo (§27 punto 7, primera redacción) decía que había *"una entidad de 561 pt que no es un nombre"*. Era un artefacto de medir con envolventes — el mismo error que comete el motor. Se deja anotado porque explica por qué el arreglo **no** es el que parecía: levantar el salteo por tipo igual o fusionar detecciones adyacentes habría sido tratar el síntoma.

## Decisión

### 1. El solapamiento se mide entre fragmentos

`findOverlapConflict` compara `fragments ?? [bbox]` de una contra `fragments ?? [bbox]` de la otra, y se queda con el **mayor** ratio de los pares. Dos entidades entran en conflicto si **algún** pedazo real de una se solapa con **algún** pedazo real de la otra.

Para el caso mayoritario —las dos de una sola línea— es literalmente el cálculo de antes: `fragments` ausente ≡ `[bbox]`.

### 2. `SessionOccurrenceRecord` propaga `fragments`

El registro de sesión no los llevaba, así que la comparación no podía verlos. Se copian en `recordOccurrence`, con el mismo criterio de ADR-074 §1: **se propagan explícitamente**, nada viaja por una copia de campos.

### 3. El umbral y la resolución no cambian

Sigue siendo `> 0.5` sobre el área menor, y `conflictWinnerIsNew` decide igual (ADR-083). Lo único que cambia es **sobre qué rectángulos** se mide.

### 4. Lo que este ADR deliberadamente NO toca

- **El salteo por tipo igual** (`if (rec.entityType === occurrence.entityType) continue`). Con los fragmentos, este documento tiene **cero** solapamientos reales: no hay evidencia de que haga falta levantarlo, y hacerlo abriría la pregunta de quién gana entre dos detecciones del mismo tipo. Queda para cuando haya un caso medido.
- **La fusión de detecciones adyacentes**, que es lo que el humano reportó (`Departamento Judicial Quilmes` como dos tokens). Son **vecinas, no solapadas**: no hay conflicto que resolver y hace falta un mecanismo que no existe. Es otro trabajo.

## Consecuencias

**A favor**

- Desaparece una clase de conflicto falso que hace **desaparecer entidades reales**, sin tocar el umbral ni la resolución.
- El motor pasa a cumplir la regla que su propio contrato ya fijaba.
- El caso común no cambia de comportamiento: sin `fragments`, el cálculo es idéntico.

**En contra**

- La comparación pasa de un par de rectángulos a un producto de listas. En la práctica son 1×1 salvo para las entidades partidas, que son minoría (1 de 29 en el documento medido).
- Un campo más en el registro de sesión.

**Lo que sigue sin medirse**

- Cuántas de las 7 ocurrencias que no llegaron a un grupo activo se recuperan. Los 3 conflictos falsos explican como mucho 3; el resto tiene otras causas sin diagnosticar.
