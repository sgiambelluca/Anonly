<!-- CONTEXT: scope=adr | dependencias=core/NER_Engine.md,core/Contracts.md,core/Grouping_Engine.md,adr/ADR-115-La-Puntuacion-Pegada-No-Es-Parte-Del-Valor.md,adr/ADR-073-Matcheo-Difuso-Solo-Para-Texto-Libre.md,adr/ADR-060-Lexico-De-Genero.md,roadmap/OCR_Escaneos_Handoff.md | audiencia=humanos+IA | fase=11 -->

# ADR-118 — La clave de agrupado tiene una sola definición

- **Estado**: Accepted
- **Fecha**: 2026-09-02
- **Decidido por**: El humano, cerrando el hueco que ADR-115 dejó anotado por alcance: "el mismo nombre puede llegar con dos claves según qué detector lo encontró".
- **Relacionado con**: **ADR-115 §1** (que unificó la mitad regex/manual y dejó ésta abierta por R-1), ADR-073 §1 (el pase difuso y su umbral), ADR-060 §4 (por qué `normalizeForComparison` no puede cambiar), ADR-111 §3 (que ya alinea los spans del NER a borde de palabra)
- **Parte de**: Hito 11, calidad de detección

> **Los nombres de este documento son ficticios.** El expediente sobre el que se midió es real y no se transcribe acá (`08_Security_Model.md` §10.2: nada de contenido de documento fuera de RAM, y una herramienta de anonimización no es lugar para datos de una causa penal). Los reemplazos **preservan largo y cantidad de diacríticos**, porque varias distancias citadas son Levenshtein normalizado por longitud: con otro nombre, el número dejaría de verificar. Precedente: ADR-084.

## Contexto

### 1. Dos funciones para el mismo campo del contrato

`Occurrence.normalizedValue` es la clave con la que `grouping-engine` agrupa, y se calculaba distinto según el productor:

| productor | función | ¿recorta bordes? | ¿saca diacríticos? |
|---|---|---|---|
| `regex-engine` / vía manual | `normalizeEntityValue` (`@anonly/shared`, ADR-115) | sí, por clase Unicode | **sí** |
| `ner-engine` | `normalizeNerValue` (copia local del kernel) | sí, por una **lista** de signos | **no** |

ADR-115 cerró la mitad de la divergencia —la puntuación— y dejó la otra abierta a propósito: tocar `normalizeNerValue` es un cambio en otro motor (R-1) y cambia la clave de **todas** las ocurrencias del NER de todo documento, así que pedía su propia medición.

### 2. Cuánto costaba, medido

Sobre 8 documentos / 115 páginas, 683 ocurrencias del NER por encima del umbral:

| | |
|---|---|
| ocurrencias cuyo valor lleva diacríticos | **108** |
| que el pase difuso **rescata** (≥ 0,88 contra su par sin acento) | 85 |
| que **se parten en dos grupos** | **23** |

Los que se parten, con su distancia real:

```
[PERSON]       "Muñíz"        muñíz   vs muniz      0,600
[ADDRESS]      "Perú"         perú    vs peru       0,750
[PERSON]       "Ríos"         ríos    vs rios       0,750
[ADDRESS]      "Lanús"        lanús   vs lanus      0,800
[PERSON]       "Simón Tomás"  simón tomás vs simon tomas  0,818
[PERSON]       "Millán"       millán  vs millan     0,833
[PERSON]       "Gaitán"       gaitán  vs gaitan     0,833
[ADDRESS]      "México"       méxico  vs mexico     0,833
[ADDRESS]      "Guzmán"       guzmán  vs guzman     0,833
[PERSON]       "Valentín"     valentín vs valentin  0,875
[ORGANIZATION] "Casación"     casación vs casacion  0,875
[ORGANIZATION] "Fiscalía"     fiscalía vs fiscalia  0,875
```

Cuanto **más corto** el nombre, peor: el pase difuso normaliza por longitud, así que un apellido de cinco letras con una `ñ` cae a 0,600. `Muñíz` no es un caso de borde inventado — es un apellido corriente, y el modo de falla es que la herramienta muestre dos grupos para la misma persona y el usuario tape uno solo.

### 3. Y unificar no colapsa nada que hoy esté separado

La pregunta inversa —¿sacar acentos junta cosas que no deberían juntarse?— también se midió, sobre las mismas 683 ocurrencias:

| | hoy | unificada |
|---|---|---|
| claves distintas | **247** | **247** |
| claves que colapsan en una sola | — | **0** |
| colisiones nuevas entre valores impresos distintos | — | **0** |

Cero. Dentro de la salida del propio NER, unificar **no cambia absolutamente nada**: no hay dos variantes acentuadas del mismo valor conviviendo. Todo el efecto del cambio es cruzado, contra la vía manual — que es exactamente donde estaba el hueco.

## Decisión

**`ner-engine` deja de tener su propia normalización y usa `normalizeEntityValue` de `@anonly/shared`.** No es "agregarle un `.replace`": es que las dos funciones pasan a ser **la misma función**, que es la única forma de que no vuelvan a divergir.

De paso cierra el segundo agujero de `normalizeNerValue`, el que ADR-115 §1 ya había nombrado: recortaba los bordes con una **lista** de signos (`.,;:!?()"'«»`) que no incluye las comillas tipográficas de una carátula. La compartida recorta por clase Unicode, así que no hay lista a la que le falte uno.

**`normalizeForComparison` sigue sin tocarse**: es la normalización del léxico de género, donde el script de build y el lookup de runtime tienen que coincidir carácter a carácter (ADR-060 §4). Esa separación es la que ADR-115 §1 estableció y este ADR la respeta.

## Consecuencias

**Lo que se ve en pantalla no cambia.** `canonicalValue` y los `aliases` de un grupo salen de `Occurrence.value` —el texto impreso—, no de la clave (`createGroup`, `grouping.engine.ts`). `Muñíz` se sigue mostrando con su acento; lo único que cambia es con quién agrupa.

**Lo que se arregla**: los 23 grupos partidos de §2, y cualquier futuro `Peña`/`Pena` que el OCR lea de las dos formas en el mismo documento — que en un escaneo es lo normal, porque el acento es lo primero que se pierde.

**En contra**

- **Dos apellidos que difieren solo en un diacrítico pasan a ser el mismo grupo.** `Peña` y `Pena` son dos familias distintas y ahora colisionan. Es un costo real, y se acepta por dos razones: el producto **ya lo aceptaba** para la vía manual y para el léxico de género desde ADR-061 §2, así que esto no abre una clase de error nueva sino que extiende una existente; y sobre documentos escaneados —el caso al que apunta el producto— perder el acento en el OCR es más frecuente que la homonimia por acento. Medido acá: **0 colisiones nuevas** en 8 documentos.
- **Cambia la clave de todas las ocurrencias del NER**, incluidas las de los `typeCorrections` de una sesión reabierta (ADR-085). Como el cambio es simultáneo en los dos productores, la memoria de reclasificación sigue siendo consistente consigo misma dentro de una sesión; una sesión persistida entre versiones no existe (nada de esto sale de RAM, `08_Security_Model.md` §10.2).
- **Un snapshot se movió**, y solo en lo esperado: `juan pérez` → `juan perez` y `maría gómez` → `maria gomez`. Ninguna otra línea.

**Lo que no toca**: `Occurrence.value` (el texto impreso viaja intacto), `normalizeForComparison` y el léxico de género, el umbral `similarityThreshold`, el pase difuso, y ningún contrato público — `normalizedValue` sigue siendo `string`.

## Qué hay que cubrir con tests

- `normalizeEntityValue` sobre las tres formas de un apellido con `ñ` y acento (`Muñíz`, `MUÑÍZ,`, `muñíz`) da una sola clave.
- Un span del kernel sale con `value` **con** diacríticos y `normalizedValue` **sin** ellos: es la distinción que hace que la UI no cambie.
- Los tests que fijaban la clave acentuada se actualizan, no se borran: `juan pérez` → `juan perez` en el fixture compartido, `echeverría` → `echeverria` en el de ADR-111 §3, y el snapshot de `text-10p.pdf`. Que fallen si se revierte el cambio es la prueba de que la clave es observable.
