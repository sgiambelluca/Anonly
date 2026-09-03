<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,architecture/03_Data_Model.md,core/Regex_Engine.md,core/NER_Engine.md,ui/Components.md,adr/ADR-104-La-Referencia-Lleva-El-Valor-Que-La-UI-Muestra.md,roadmap/Post_Hito10.8_Pendientes.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-105 — El contexto viaja con la ocurrencia

- **Estado**: Accepted
- **Fecha**: 2026-08-27
- **Decidido por**: El humano, tras ver que el valor solo no alcanza cuando el mismo texto se repite.
- **Relacionado con**: **ADR-104** (el valor, que esto completa), ADR-061 §2 errata (el precedente de mover una primitiva a `shared` en vez de duplicarla)
- **Parte de**: Hito 11, UX de detección

## Contexto

### 1. El valor solo empata cuando el texto se repite

ADR-104 puso el valor en `OccurrenceRef` y con eso el separador dejó de ser ciego para el caso reportado: dos entidades distintas fusionadas se distinguen por su valor.

Pero hay un caso que el valor no resuelve, y es probablemente el más frecuente para **separar**:

```
☐  Juan     Página 3
☐  Juan     Página 7
☐  Juan     Página 9
```

Dos personas que se llaman igual, o el mismo topónimo usado como ciudad y como nombre de un organismo — que es exactamente el anidamiento reportado en `Post_Hito10.8_Pendientes.md` §27 punto 7. Ahí el valor no distingue nada y el usuario vuelve a estar donde estaba.

Lo único distinto entre esas apariciones es **la frase que las rodea**.

### 2. Quién puede armarlo

`grouping-engine` no puede: solo recibe eventos `ENTITY_FOUND`, sin `Document` ni `Page.text`.

Los **detectores** sí. `regex-engine` trabaja sobre `page.text` y su `RawMatch` lleva `startIndex`/`endIndexExclusive`; `ner-engine` suma `chunk.startIndex` a los spans del kernel y termina con offsets sobre el mismo `input.text`. Los dos tienen el texto y la posición.

## Decisión

### 1. La primitiva vive en `shared`, no en cada motor

`buildOccurrenceContext(text, startIndex, endIndexExclusive)` se declara en `Contracts.md` §6 y vive en `@anonly/shared`.

**Es lo que evita el problema que el repo acaba de documentar**: dos motores que no pueden importarse entre sí (P-1/P-2) necesitan la misma lógica, y la salida es una sola implementación compartida — mismo criterio y mismo lugar que `sharesVerticalBand` y `normalizeForComparison` (ADR-061 §2 errata). Duplicarla sería inaugurar la entrada número siete de `roadmap/Duplicacion_De_Logica.md` el mismo día que se escribió.

### 2. Dos cadenas, no una con offsets

```ts
export interface OccurrenceContext {
  readonly before: string;
  readonly after: string;
}
```

La UI arma `…{before}` **{value}** `{after}…` sin aritmética. La alternativa —una cadena única más los offsets del valor adentro— obliga a cada consumidor a recortar bien, y un off-by-one ahí parte una palabra en pantalla.

El valor **no se repite** adentro del contexto: ya está en `OccurrenceRef.value` (ADR-104).

### 3. Ventana de caracteres, no detección de oraciones

`OCCURRENCE_CONTEXT_CHARS = 40` a cada lado, recortado al **límite de palabra** más cercano para no cortar por la mitad.

Se evaluó cortar por oración, que se lee mejor. Se descarta: partir oraciones en español jurídico es un problema propio —`Dr.`, `N°`, `art.`, `I.P.P.` son todos puntos que no terminan nada— y ese es exactamente el tipo de heurística que esta sesión aprendió a no inventar sin medir. Una ventana es predecible y no falla raro.

### 4. Opcional en los dos tipos

`context?` en `Occurrence` y en `OccurrenceRef`. Opcional y no requerido, al revés que `value` (ADR-104 §1): una ocurrencia puede nacer sin texto alrededor —el agregado manual de ADR-061, una página de una sola palabra— y forzar una cadena vacía obligaría a distinguir "no hay contexto" de "el contexto es vacío" en cada consumidor.

### 5. Esta decisión autoriza tocar los dos detectores

R-1 pide un módulo por PR. Acá el cambio es **el mismo, dos veces**: cada motor llama a la primitiva compartida con los offsets que ya tiene. Partirlo dejaría la mitad de las ocurrencias con contexto y la otra mitad sin él, que es peor que no tenerlo — el usuario no sabría por qué unas filas muestran la frase y otras no. Mismo criterio que ADR-099 §5.

## Consecuencias

**A favor**

- El separador distingue apariciones del **mismo** valor, que es su caso más frecuente.
- Ayuda a diagnosticar §27 punto 7 (tokens anidados): ver la frase alrededor dice si dos detecciones son la misma frase o dos distintas.
- Una sola implementación para los dos motores.

**En contra**

- Más contenido del documento viajando en el `EntityGroup`: hasta 80 caracteres por ocurrencia. No es una categoría nueva de exposición —ya viajan `canonicalValue`, `aliases` y ahora `value`— pero es volumen.
- Dos motores tocados por un cambio de campo.

**Lo que no cambia**

- Nada se persiste (`08_Security_Model.md` §10.2). Es memoria de sesión, igual que el resto del grupo.
