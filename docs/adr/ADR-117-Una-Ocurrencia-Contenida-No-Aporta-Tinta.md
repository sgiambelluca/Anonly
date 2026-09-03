<!-- CONTEXT: scope=adr | dependencias=core/Grouping_Engine.md,core/Contracts.md,core/Regex_Engine.md,adr/ADR-061-Entidad-Manual-Y-Busqueda-Literal.md,adr/ADR-089-Buscar-No-Es-Agregar.md,adr/ADR-107-El-Conflicto-Se-Mide-Sobre-Los-Fragmentos.md,adr/ADR-115-La-Puntuacion-Pegada-No-Es-Parte-Del-Valor.md,adr/ADR-116-Un-Valor-Que-El-Documento-Ya-Confirmo-No-Se-Descarta.md | audiencia=humanos+IA | fase=11 -->

# ADR-117 — Una ocurrencia contenida no aporta tinta

- **Estado**: Accepted
- **Fecha**: 2026-09-02
- **Decidido por**: El humano, que al agregar a mano el apellido del imputado vio al grupo saltar de **24 a 34** ocurrencias y preguntó qué eran las diez de más — y después pidió medir la decisión antes de tomarla.
- **Relacionado con**: **ADR-089 §3** (un match entra con las palabras enteras), ADR-061 §6 (la vía manual barre el documento entero), **ADR-107** (el solapamiento se mide sobre los fragmentos, no sobre la envolvente), ADR-115/ADR-116 (los dos ADRs previos de esta misma campaña sobre agrupado)
- **Parte de**: Hito 11, calidad de detección

> **Los nombres de este documento son ficticios.** El expediente sobre el que se midió es real y no se transcribe acá (`08_Security_Model.md` §10.2: nada de contenido de documento fuera de RAM, y una herramienta de anonimización no es lugar para datos de una causa penal). Los reemplazos **preservan largo y cantidad de diacríticos**, porque varias distancias citadas son Levenshtein normalizado por longitud: con otro nombre, el número dejaría de verificar. Precedente: ADR-084.

## Contexto

### 1. Diez ocurrencias de más, y ninguna era un dato sin tapar

Al agregar a mano `SUAREZ,` sobre un expediente escaneado de 20 páginas, el barrido literal encuentra 34 apariciones. Medido, una por una:

```
apariciones que encuentra el barrido: 34
  ya cubiertas por una ocurrencia del NER (se deduplican): 24
  nuevas: 10

  de las nuevas, DENTRO de un nombre completo de otra entidad: 10
     p 1  <<Suarez>>    DENTRO de [PERSON] <<Bartolomé Arturo Suarez>>
     p 3  <<Suarez,>>   DENTRO de [PERSON] <<Mariela Suarez>>
     p 6  <<Suarez,>>   DENTRO de [PERSON] <<Mariela Suarez>>
     p 6  <<Suarez>>    DENTRO de [PERSON] <<Bartolomé Arturo Suarez>>
     p 7  <<Suarez,>>   DENTRO de [PERSON] <<Leonardo Suarez>>
     p10  <<Suarez>>    DENTRO de [PERSON] <<Leonardo Suarez>>
     p10  <<Suarez,>>   DENTRO de [PERSON] <<Leonardo Suarez>>
     p12  <<Suarez>>    DENTRO de [PERSON] <<Leonardo Suarez>>
     p17  <<Suarez>>    DENTRO de [PERSON] <<Bartolomé Arturo Suarez>>
     p17  <<Suarez>>    DENTRO de [PERSON] <<Bartolomé Arturo Suarez>>

  de las nuevas, apellido suelto: 0
```

**Cero** eran un apellido que el detector se hubiera perdido. Las diez son el apellido arrancado de adentro de un nombre completo que el detector **ya había separado bien**: `findLiteral` tokeniza la consulta en sub-tokens (`["suarez"]`) y la ventana deslizante lo matchea esté donde esté, incluido adentro de un nombre más largo; cada match entra con la palabra entera (ADR-089 §3).

El costo no es cosmético. El apellido de `Mariela Suarez` y el de `Leonardo Suarez` quedan en el grupo del imputado: con ese grupo encendido, **tres personas distintas comparten un token de reemplazo sobre la misma palabra**, y eso no se ve en la UI — se ve leyendo el PDF exportado.

### 2. Hoy nadie lo frena, y por una línea

```ts
private findOverlapConflict(session, occurrence) {
  for (const rec of session.recordedOccurrences) {
    if (rec.pageIndex !== occurrence.pageIndex) continue;
    if (rec.entityType === occurrence.entityType) continue;   // <-- acá
```

El chequeo de solapamiento **saltea los pares del mismo tipo**: el diseño asumía que dos detecciones del mismo tipo sobre la misma tinta son la misma entidad, y para eso está el dedup por identidad — que exige **bbox idéntico** (ADR-038 §3). `Suarez` adentro de `Leonardo Suarez` no tiene el mismo bbox, así que no dedupea; y como es del mismo tipo, tampoco entra al conflicto. Se registra.

## Decisión

**Una ocurrencia contenida enteramente dentro de otra del mismo tipo ya registrada no se registra.**

Va **antes** que todo lo demás en `processOccurrence` —incluida la rama de baja confianza de ADR-116— porque no es una decisión sobre cuál entidad es la buena: es que no hay entidad nueva que decidir.

Tres precisiones, cada una con su medición detrás:

### 1. Contención **estricta**, no solapamiento parcial

Todos los pedazos de la nueva tienen que entrar en los de la ya registrada, y las dos no pueden ser el mismo rectángulo (ese caso ya lo cubre el dedup por identidad). Si asoma tinta que la otra no cubre, hay entidad nueva.

No es una restricción teórica: medido sobre 8 documentos, hay **0 solapamientos parciales del mismo tipo**. Elegir la regla estricta no le quita nada a nadie hoy y deja cerrada la puerta más ancha.

### 2. Se mide sobre los **fragmentos**, no sobre la envolvente

Mismo criterio que ADR-107, por la misma razón: la envolvente de una entidad partida por un salto de renglón abarca el bloque de texto entero, y contra ella **cualquier** vecina de esas dos líneas parecería contenida. Cada pedazo de la nueva tiene que caer dentro de **algún** pedazo de la vieja.

### 3. El tipo tiene que coincidir

Dos entidades de tipos **distintos** sobre la misma tinta son un desacuerdo entre detectores, y eso ya lo resuelve `findOverlapConflict` con su propia regla (casos 7-8 de §13). Este ADR no la toca.

### Por qué no se reusó `findOverlapConflict` quitándole el `continue`

Era la alternativa obvia y se descartó por dos razones medidas. **(a)** Con 0 solapamientos parciales del mismo tipo en el corpus, esa vía no cubriría hoy ningún caso que ésta no cubra: la única diferencia práctica sería el rastro de auditoría. **(b)** Su desempate es `conflictWinnerIsNew`, que decide por **fuente y confianza** — un `Person` de regex contra uno de NER se resuelve como `Disagree` y *gana regex siempre*, sin mirar cuál cubre más texto. Resolver "una entidad contiene a la otra" con un criterio que no habla de extensión es prestado, no razonado.

## Consecuencias

**Medido antes de implementar**, sobre 8 documentos / 763 ocurrencias del pipeline automático (el fallo escaneado por OCR, dos pericias, una apelación, un oficio, dos fallos nativos y un cuento):

| | contenciones mismo tipo | solapamientos parciales mismo tipo |
|---|---|---|
| **pipeline automático solo** | **1** | **0** |
| \+ el agregado manual del apellido | **11** | **0** |

La única del pipeline automático es basura: `[PERSON] "I"` dentro de `[PERSON] "Juez X.Y"`. Descartarla es una mejora.

**Por qué el número es tan chico, y no es casualidad**: `aggregateTokensToSpans` emite spans **disjuntos** dentro de una página, y `resolveOverlaps` ya se queda con el más largo en regex. La contención es un artefacto del barrido literal, no del detector. Por eso descartar la contenida no puede costar una detección que hoy funcione.

**El orden está garantizado por construcción, no por suerte.** El Orchestrator corre regex completo (`orchestrator.ts:1098`), después NER completo (`:1122`), y `addManualEntity` **exige `stage: Ready`** — el guard impide que la vía manual corra mientras el documento se analiza. Medido: en **11 de 11** contenciones el contenedor llegó primero. Cero contraejemplos.

**En contra**

- **Límite conocido y deliberado**: esto protege cuando el contenedor **ya está registrado**. Agregar a mano un valor **largo** sobre una detección corta ya registrada deja el duplicado, igual que antes de este ADR. No empeora nada; tampoco lo cierra. Cerrarlo pediría poder **sacar** una ocurrencia de un grupo, que es un mecanismo que el motor no tiene.
- **El descarte es silencioso** (un `debug`, como el dedup por identidad de ADR-038 §3). No emite `CONFLICT_DETECTED`: no hay conflicto que mostrarle al usuario — la tinta ya está tapada por la entidad que la contiene. Si algún día hiciera falta explicar "por qué mi búsqueda encontró 34 y el grupo tiene 24", el lugar es el resultado de `addManualEntity`, no un conflicto.
- **Dos fixtures de test eran geométricamente imposibles** y este ADR los destapó: `unit.test.ts` y `contract.test.ts` apilaban a `Andrea Perez` y `Andrea Diaz` —dos personas **distintas**— en el mismo origen, porque solo les importaba comparar anchos. Se les dio un renglón propio; lo que miden no cambia.

**Lo que no toca**: `findOverlapConflict` y su regla de desempate, el dedup por identidad de ADR-038 §3, el camino de baja confianza de ADR-116, `findLiteral` (que sigue barriendo el documento entero: lo que cambia es qué se registra, no qué se encuentra) y ningún contrato público.

## Qué hay que cubrir con tests

- Una ocurrencia contenida entera dentro de otra del mismo tipo **no se registra**: queda un solo grupo, con su nombre completo.
- Un solapamiento **parcial** del mismo tipo **sí** se registra — el límite de la regla estricta.
- Una contención de **tipo distinto** sigue yendo al conflicto de solapamiento de siempre.
- Una vecina que cae dentro de la **envolvente** de una entidad multi-línea pero **no** dentro de ninguno de sus fragmentos **no** se considera contenida (ADR-107 aplicado a la contención).
