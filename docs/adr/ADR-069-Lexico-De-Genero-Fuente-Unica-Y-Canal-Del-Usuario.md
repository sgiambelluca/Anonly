<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Grouping_Engine.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,architecture/08_Security_Model.md,adr/ADR-018-First-Party-Assets.md,adr/ADR-028-IndexInType-Renumeracion-Canonica.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md,adr/ADR-060-Reemplazo-Por-Genero.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=10.6 -->

# ADR-069 — El léxico de género: fuente única, cómo viaja y cómo lo fija el usuario

- **Estado**: Accepted
- **Fecha**: 2026-08-14
- **Decidido por**: El humano, sobre las **dos ambigüedades que el implementador del PR 11 reportó** (`AI_Development_Guide.md` §5) y un **tercer defecto que no reportó nadie**, que apareció al verificar el artefacto generado contra las fuentes reales. Eligió Buenos Aires como fuente única y definitoria —"es la que tiene únicamente nombres completos"—, dejar la variante anglosajona anotada como opción futura con umbral de 1.000 apariciones, y modelar el tercer estado del selector como una opción explícita más ("neutral") en vez de como ausencia de información.
- **Relacionado con**: **ADR-060** (lo completa y **supersede sus §9 y §10**; §1-§8, §11 y §12 quedan vigentes), ADR-057 §3 (la indirección `resolveLabelSet`, intacta), ADR-028 (la renumeración canónica, donde se engancha el disparador de §6), ADR-038 §2 (`reopenSession`, que obliga a que la elección del humano sea recordada), ADR-018 y ADR-048 §7 (por qué el artefacto se commitea y no se espeja)
- **Parte de**: Hito 10.6, PR 11

> Convención de citas: `ADR-069 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-069, Contexto §N`.

## Contexto

### 1. Dos ambigüedades reportadas, y las dos son errores de especificación

El implementador del PR 11 se detuvo en dos puntos y no improvisó ninguno. Los dos son errores míos, no suyos:

**Ambigüedad 1 — el canal existe en el ADR, el tipo nunca se agregó.** ADR-060 §6 dice que el selector escribe `personGender` "vía `GROUP_UPDATE_REQUESTED`, como cualquier otra edición de grupo", pero la lista "Docs actualizados" del propio ADR-060 solo nombra `Contracts.md §5` (el tipo `PersonGender`), nunca la forma del evento. Por eso `GroupUpdateRequested.patch` sigue siendo `Partial<Pick<EntityGroup, "replacementMode" | "replacementValue" | "enabled" | "canonicalValue">>` en `Contracts.md` §8, en `04_Event_System.md` §10 y en `shared/src/events.ts`. **Sin ese campo, el selector del PR 12 no tiene por dónde emitir la elección** y el §13 caso 34 de `Grouping_Engine.md` es inimplementable.

**Ambigüedad 2 — se decidió cómo viaja el léxico, nunca cómo entra al motor.** ADR-060 §10 fijó el patrón de transporte ("carga a demanda + Cache Storage, mismo patrón que el modelo de NER") pero `Grouping_Engine.md` §6 no declara ningún canal en `EngineContext`/`GroupingConfig`, y ningún doc dice **quién dispara la inferencia ni en qué punto del ciclo**. El implementador hizo lo correcto dejando `inferPersonGender(canonicalValue, lexicon)` como función pura que recibe el léxico por parámetro (P-6/P-7, R-10) — pero **nada la llama**. Mergeado tal cual, el Hito 10.6 entrega los tokens `MUJER`/`HOMBRE` y el selector manual, y la inferencia automática no ocurre nunca: cada `Person` de cada documento habría que marcarla a mano, que es exactamente la alternativa "solo manual, sin léxico" que ADR-060 rechazó por escrito.

### 2. El artefacto real contradice el comportamiento que ADR-060 §4 promete

Este no lo reportó nadie. El artefacto generado por `scripts/build-gender-lexicon.ts` (137.080 entradas) responde:

| Consulta | Artefacto generado | Lo que exigen ADR-060 §4 y `Grouping_Engine.md` §13 caso 32 |
|---|---|---|
| `j.` / `j` / `a.` / `m.` | **`m`** | sin determinar — "iniciales (`J. Pérez`) no tienen respuesta" |
| `mr.` / `mrs.` / `ms.` / `miss.` | `m` / `f` / `f` / `f` | sin determinar |
| `andrea` | `ambiguo` | `f` — "**Andrea sí resuelve `f`**" |
| `cruz` | `m` | sin determinar — "nombre marcado ambiguo (`Andrea`, `Cruz`)" |

La primera fila es la grave y es un defecto de producto, no de estilo: **`inferPersonGender("J. Pérez", <artefacto real>)` devuelve `m`, y el documento entregado a un tercero saldría con `[HOMBRE 03]`**. Es el ejemplo que ADR-060 Contexto §4 usa para justificar que no haya heurísticas.

Origen: la fuente de UCI son registros de nacimientos donde el campo "nombre" contiene cosas que no son nombres. Son 130 claves —letras sueltas, iniciales con punto, títulos— y **las 130 devuelven un género determinado**. La fuente de Buenos Aires no tiene ninguna: es el registro civil.

### 3. Ningún test podía verlo

Los tests del PR 11 (`unit.test.ts`, `edge.test.ts`, `tests/scripts/build-gender-lexicon.test.ts`) construyen a mano un léxico sintético de dos o tres entradas por test. Preguntarle `"J. Pérez"` a `new Map([["andrea","ambiguous"]])` devuelve `undefined` correctamente, y el test pasa. **Ningún test le pregunta nada al artefacto commiteado**, que es el único que corre en producción. El PR estaba con 95% de cobertura y todos los gates en verde.

Es la misma familia de fallas que `Hito10.8_Handoff.md` §"lecciones" ya registró: *"dos de ellas habrían dejado la feature sin efecto en silencio, con los tests en verde"*.

### 4. Los ejemplos de ADR-060 §9 no estaban verificados contra las fuentes

Verificado bajando `nombres-permitidos.csv` (2026-08-14):

| Nombre | Registro de Buenos Aires | Lo que afirma ADR-060 |
|---|---|---|
| `ANDREA` | **`A`** (unisex) | §9: "`F` en Buenos Aires, casi seguro `M` en UCI" |
| `CRUZ` | **`M`** | Contexto §4: ambiguo |
| `GUADALUPE` | **`F`** | Contexto §4: ambiguo |
| `RENE` | **`M`** | Contexto §4: ambiguo |
| `TRINIDAD` / `ROSARIO` | `A` / `A` | Contexto §4: ambiguos ✔ |
| `MARIA` | **`A`** | — (no previsto: "María Gómez" cae a sin determinar) |

O sea: el argumento de fondo de §9 —**el registro local manda y no se contrasta contra datos anglosajones**— sigue siendo correcto, pero **el ejemplo con el que lo justifiqué es falso**, y sobre ese ejemplo están escritos `Grouping_Engine.md` §13 caso 32, el checklist 15e, `MVP.md` §4 y un test del PR 11 llamado `'Andrea resolves to f: the local registry is authoritative over anglophone data'`.

El ejemplo verdadero existe y es mejor: **`JOAN`** figura `M` en el registro porteño (Joan Manuel Serrat) y es femenino con 495.559 registros en los datos anglosajones. `JEAN` (`M` acá, femenino allá) es el segundo. Hay 129 discrepancias de esa forma.

### 5. UCI aporta mucho menos de lo que ADR-060 §9 suponía

Medido sobre las dos fuentes completas:

- De 24 nombres extranjeros probados (Giuseppe, Vladimir, Olena, Fátima, Mohammed, Chen, Hyun, Aiko, Ingrid, Dieter, Mustafá, Aisha, Matteo, Siobhan, Björn, …), **Buenos Aires ya resuelve 21**. UCI agrega tres (Piotr, Kwame, Katarzyna) y, sobre otros dos (Wei, Nguyen), agrega `ambiguo`, que es indistinguible de no tenerlos.
- **69.697 de las 133.899 entradas de UCI las llevan menos de 20 personas** en todo el corpus: grafías inventadas una sola vez en un formulario de nacimiento (`aarza`, `ahlayna`, `adayshia`). Son la mitad del peso del artefacto y no van a aparecer en un expediente argentino.

El registro de nombres permitidos de un país de inmigración ya es internacional. La premisa de §9 —"UCI cubre los nombres extranjeros que la base no tiene"— es cierta en teoría y marginal en la práctica.

## Decisión

### 1. Buenos Aires es la fuente única del léxico

Se retira UCI del alcance del Hito 10.6. El artefacto se construye **solo** con el recurso "Nombres Permitidos" de Buenos Aires Data (CC-BY-2.5-AR), que declara `F`, `M` o `A` por nombre.

| | Valor |
|---|---|
| Entradas | **9.788** (`f` 4.335 · `m` 4.972 · `ambiguo` 481) |
| Tamaño | **129 KB crudo · 30 KB gzip · 25 KB brotli** |
| Nombres compuestos preservados | 121 (`maria jose`, `ana de las ermitas`, `maria de la o`, `ben hur`) |

**Esto supersede la regla de fusión de ADR-060 §9 entera**: no hay fusión, no hay umbral de probabilidad, no hay "por encima/por debajo", no hay columna `Count` ni `Probability`. Lo único que sobrevive de §9 es lo que era su fundamento: **`A` → sin determinar** (es una propiedad del nombre, no una tercera categoría de persona) y **el registro local es autoritativo**.

Con una fuente sola, "Buenos Aires no se contrasta contra UCI" deja de ser una regla que haya que defender: no hay nada contra qué contrastar.

**Variante registrada para el futuro, no implementada** (va a `roadmap/Future_Ideas.md`): si alguna vez se quiere cobertura de nombres anglosajones, la forma correcta es agregar UCI **filtrado a nombres con 1.000 apariciones o más**, no los umbrales más finos. Medido: **17.156 entradas, 230 KB crudo / 50 KB gz**, +6.413 nombres determinados sobre Buenos Aires. Los umbrales de 20 y 100 apariciones (68.003 y 42.194 entradas, 183 y 115 KB gz) se descartan por la misma razón que se descarta UCI hoy: multiplican el peso por cinco para cubrir casos que el usuario resuelve con un clic.

### 2. El léxico viaja **dentro del bundle**, como módulo generado

`scripts/build-gender-lexicon.ts` deja de emitir un JSON suelto en `packages/anonymization-core/grouping-engine/assets/` y pasa a emitir un **módulo TypeScript generado** que el motor importa como cualquier otra tabla del paquete. Sin `fetch`, sin URL configurable, sin `GroupingConfig` nuevo, sin copia a `apps/react-client/public/`, sin Cache Storage y sin ninguna ruta de fallo por descarga.

**Esto supersede ADR-060 §10 en todo lo que describe transporte.** Sobrevive lo que no era transporte: los CSV originales **no entran al repo**, el artefacto derivado **sí**, el script es determinista y commiteado, y del build no sobrevive nada más que `nombre → f | m | ambiguo` (ni origen, ni significado, ni conteos).

Motivo: toda la maquinaria de §10 —carga perezosa, Cache Storage, medición contra el gate— existía para 1,9 MB. **Para 30 KB gz sobre un presupuesto de 800 KB gz (`MVP.md` §5) no se justifica ni una línea de ella.** El párrafo de §10 sobre PWA y app de escritorio pierde objeto: un módulo del bundle ya está en el precache de la PWA y dentro del instalador, sin nada que decidir.

**Medición para el checklist de ADR-060 §10** (el PR debía medir y reportar): +30 KB gz sobre el bundle inicial, 3,75% del gate. Reportado acá.

**Lo que esto no cambia**: la app sigue sin pedirle nada a ningún dominio externo en runtime (ADR-002, `08_Security_Model.md` §3.2). Antes tampoco lo hacía —el archivo se servía desde el propio origen—; ahora directamente no hay ni un pedido HTTP separado.

**El artefacto se marca como generado** en `.gitattributes` (`linguist-generated=true`): son 9.805 líneas que GitHub pliega en el diff del PR y excluye de las estadísticas de lenguaje y de la búsqueda de código, para que el revisor no tenga que atravesar una tabla de nombres propios para llegar al código escrito a mano. Es solo presentación —el archivo se commitea y se importa exactamente igual—, y es la mitigación que hace innecesario sacarlo del repo (ver §Alternativas: "generar el artefacto en build y gitignorearlo"). También está excluido de los thresholds de cobertura en `vitest.config.ts`: es una tabla de datos, no código con ramas que probar.

### 3. Saneamiento del léxico: dos candados independientes

**En el build** (una vez, sobre la fuente): se descarta toda clave con un token que contenga un punto o un dígito. Sobre Buenos Aires son 8 entradas, todas abreviaturas del registro (`franc.de caracciolo`, `atahualpa d.l.andes`, `maria d.l.concepcion`). **No** se filtra por longitud de token: `maria de la o` es un nombre real del registro y tiene que sobrevivir.

**En runtime** (`inferPersonGender`, defensa en profundidad): **una clave de búsqueda de un solo token que mida un carácter o contenga un punto no se consulta nunca** — `j`, `j.`, `j.m.`. Cae directo a sin determinar sin tocar la tabla.

Los dos candados son deliberadamente redundantes. El de runtime es el que hace que `"J. Pérez"` sea **imposible** de resolver aunque mañana alguien regenere el artefacto con otro criterio o se sirva uno viejo — que es exactamente lo que pasó acá.

**No hace falta lista de títulos**: `DON` y `DOÑA` figuran en el registro como nombres propios (`M` y `F`), así que "Don Juan Pérez" resuelve masculino por el camino normal y el resultado es correcto. Los `mr.`/`mrs.`/`dr` que motivaban la lista venían todos de UCI y se van con ella.

### 4. `GroupUpdateRequested.patch` gana `personGender`, con el tercer estado como **valor explícito**

```ts
/** El tercer estado del selector de ADR-060 §6 viaja como valor, no como ausencia. */
export type PersonGenderChoice = PersonGender | "neutral";

export interface GroupUpdateRequested {
  readonly documentId: string;
  readonly groupId: string;
  readonly patch: Partial<
    Pick<EntityGroup, "replacementMode" | "replacementValue" | "enabled" | "canonicalValue">
  > & {
    /** Solo sobre grupos `Person`. `"neutral"` = volver al token `PERSONA` (ADR-069 §4). */
    readonly personGender?: PersonGenderChoice;
  };
}
```

El almacenamiento **no cambia**: `EntityGroup.personGender?: PersonGender` sigue siendo `"f" | "m"` con ausencia = sin determinar (ADR-060 §2, ya mergeado en el PR 10). El motor traduce: `"f"`/`"m"` escriben el campo, **`"neutral"` lo borra**.

Por qué un valor explícito y no la ausencia de la clave: los otros cuatro campos del patch son `string`/`boolean`/enum y siempre vienen con valor, así que `applyGroupUpdate` los resuelve con `if (patch.x !== undefined)`. Con ese patrón, "volver a neutral" —que ADR-060 §6 exige como **una de las tres posiciones del control**— sería indistinguible de "no toqué ese campo", y el usuario no podría deshacer su elección. Las dos alternativas evaluadas (`null` como centinela, o semántica de presencia de clave con `"personGender" in patch`) resuelven lo mismo con un truco que hay que recordar; un valor nombrado dice lo que hace, sobrevive un round-trip a JSON y es el que la UI ya muestra.

Sobre un grupo de `type` distinto de `Person`, `patch.personGender` se **ignora con `logger.warn`** y no altera `replacementValue` (ADR-060 §2, `Grouping_Engine.md` §13 caso 34).

### 5. El motor recuerda que la elección la hizo el humano

`InternalGroup` gana un `personGenderUserSet: boolean` — **bookkeeping interno, nunca expuesto** en `EntityGroup` ni en ningún evento, mismo criterio que `normalizedValues`/`aliasFrequency`/`aliasFirstSeen`.

Sin él, la promesa de ADR-060 §4 ("el override del usuario gana siempre y es permanente") es falsa en el caso que más importa: un usuario que elige **"neutral"** deja el campo vacío, que es indistinguible de "todavía no se infirió", y la próxima inferencia se lo pisa. `Grouping_Engine.md` §13 caso 34 pide explícitamente que sobreviva a `finishSession`, a `reopenSession` y a una re-inferencia posterior.

Ciclo de vida: se enciende en `applyGroupUpdate` con `patch.personGender` presente; sobrevive `finishSession` y `reopenSession` (que no tocan los grupos); se limpia con la sesión en `closeSession`. En una **fusión** (`applyGroupMerge`), el grupo resultante hereda el `personGender` y el flag del grupo que sobrevive (el de menor `indexInType`, ADR-060 §13 caso 5): una elección del humano no se pierde por fusionar.

### 6. Cuándo corre la inferencia

`inferPersonGender` sigue siendo la función pura que el PR 11 dejó escrita. El motor la invoca en dos puntos, y **nunca** sobre un grupo con `personGenderUserSet`:

1. **Cuando se asigna o cambia el `canonicalValue` de un grupo `Person`** — al crearlo, al fusionar, y en la edición manual de `patch.canonicalValue` (§13 caso 18). Es el disparador natural: el género es una función del nombre canónico.
2. **En `finishSession`, antes de `renumberGroupsCanonically`**, sobre todos los grupos `Person` sin elección del humano. Es la red que garantiza convergencia: pase lo que pase durante la detección, al cerrar la sesión todos los grupos tienen el género que les corresponde, y la renumeración canónica de ADR-028 —que ya recalcula `replacementValue`— pinta los tokens definitivos en la misma pasada.

El punto 2 es el que hace que los tokens **no parpadeen** delante del usuario a mitad del análisis: `[PERSONA 03]` → `[MUJER 03]` ocurre en el mismo momento en que ADR-028 ya podía correr los índices (§13 caso 21), que el spec declara aceptado.

La inferencia es idempotente y determinista: misma tabla + mismo `canonicalValue` ⇒ mismo resultado. Un grupo cuyo género inferido cambia dispara el recálculo de `replacementValue` y los eventos que ya emite cualquier mutación de grupo (`ENTITY_GROUP_UPDATED` + `GROUP_REPLACEMENT_CHANGED`).

### 7. Los tests le preguntan a la tabla real — regla permanente

Dos reglas nuevas, que valen de acá en adelante y no solo para este hito:

**(a) Todo comportamiento del léxico se prueba contra el artefacto commiteado**, no solo contra tablas sintéticas. Las tablas sintéticas siguen siendo válidas para probar el **orden de los pasos** (§4 de ADR-060: secuencia de pila antes que primer token), porque ahí la tabla es el fixture del algoritmo. Pero **todo enunciado sobre qué contesta el léxico** —iniciales, ambiguos, nombres compuestos, un nombre que resuelve `f`— exige un test contra la tabla real. Son los tests que faltaban y que habrían encontrado el defecto de Contexto §2 en el primer minuto.

**(b) Ningún ejemplo con nombre propio entra a un doc sin verificarse contra la fuente.** `ANDREA`, `CRUZ`, `GUADALUPE` y `RENE` entraron a ADR-060 desde mi intuición sobre el español, no desde el CSV, y de ahí se propagaron a un spec, a un checklist, al roadmap y al nombre de un test. El costo de verificarlos era un `grep`.

### 8. Errata a ADR-060

Se corrigen, sin cambiar ninguna decisión de fondo:

| Dónde | Dice | Debe decir |
|---|---|---|
| Contexto §4 | "«Cruz», «Guadalupe», «Trinidad», «Rosario» y «René» son ambiguos" | Solo `TRINIDAD` y `ROSARIO` lo son. `CRUZ` y `RENE` son `M`, `GUADALUPE` es `F`, y `MARIA` —que el ADR no menciona— es `A` |
| §9 | "«Andrea» — `F` en Buenos Aires, casi seguro `M` en UCI" | `ANDREA` es **`A`**. El ejemplo real de discrepancia es **`JOAN`** (`M` acá, femenino con 495.559 registros allá) |
| §9 (tabla de fusión) | 4 reglas de fusión con umbral de probabilidad | Superseded por §1 de este ADR: fuente única |
| §10 | carga a demanda + Cache Storage + medición contra el gate | Superseded por §2 de este ADR: módulo del bundle |
| §13 (tests) | "«Andrea» resuelve `f`"; "un nombre ausente de Buenos Aires y presente en UCI…" | Reescritos contra la fuente única y la tabla real (§7) |

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Mantener las dos fuentes como estaban** | Es de donde salen las 130 entradas que hacen que `J. Pérez` imprima `[HOMBRE 03]` (Contexto §2), multiplica el peso por 14 (384 KB gz vs 30 KB) y aporta 3 nombres útiles sobre 24 probados (Contexto §5). |
| **UCI recortado a ≥20 o ≥100 apariciones** | 183 y 115 KB gz. Sigue siendo cinco veces el peso de la fuente sola para cubrir nombres cada vez más raros, y obliga a defender por qué 20 y no 50. Si alguna vez hace falta, la variante correcta es ≥1.000 (§1). |
| **`GroupingConfig.genderLexiconUrl` + `fetch` en el motor** | Era la opción correcta para 1,9 MB y tiene precedente (`NerConfig.wasmPaths`, ADR-039; el kernel de NER bajando su modelo). Para 30 KB agrega un campo de config, un script de copia a `public/`, una ruta de fallo por descarga y un stub de `fetch` en los tests, a cambio de nada. |
| **El host carga el léxico y lo inyecta por un método nuevo** | Deja el motor sin `fetch` (R-10 al pie de la letra), pero agrega un método público fuera de `IEngine`, acopla `apps/react-client` a la existencia del léxico y pone la carga perezosa en manos de la app. Un `import` no tiene ninguno de esos costos. |
| **Generar el artefacto en build y gitignorearlo** (patrón `mirror-assets` + `assets.lock.json`, ADR-018) | *Evaluada el 2026-08-14, al preparar el PR del hito: el módulo generado son 9.805 líneas / 193 KB, el 78% del diff de la branch, y la pregunta "¿por qué no se genera en el build?" merece respuesta escrita.* Es la opción intermedia que §2 no consideró explícitamente: mismo resultado en el bundle, pero el archivo vive gitignoreado y se regenera con `pnpm lexicon:build`. Se rechaza por tres razones independientes. **(a)** Lo que hace seguro al patrón de ADR-018 es que `assets.lock.json` fija un hash por asset contra CDNs que sirven artefactos **versionados e inmutables**; la fuente de acá es una URL sin versión que sirve "el CSV de hoy", y `build-gender-lexicon.ts` **escribe** el `sha256` en el provenance en vez de verificarlo contra uno esperado. Falta justamente la mitad que da la garantía: "generar en build" sería "usar lo que el servidor haya servido esta mañana". **(b)** Rompe §7 de este ADR, que es la regla que existe por el defecto de `J. Pérez`: los tests contra la tabla real pasarían a probar lo que el registro civil publicó ese día, y un CI verde dejaría de significar "el léxico contesta esto" para significar "contestaba esto cuando corrió". Además ataría el typecheck y los tests de `grouping-engine` —hoy sin ninguna dependencia de red— a la disponibilidad de un servidor gubernamental. **(c)** Un checkout de un commit viejo no podría reconstruir el léxico que ese commit usaba. El costo que motivaba la alternativa es de *review*, no de repositorio, y se resuelve marcando el archivo como `linguist-generated=true` en `.gitattributes` (§2). |
| **Diferir la inferencia automática a un hito posterior** | Desbloqueaba el PR 12 de inmediato, pero deja al Hito 10.6 entregando "solo manual, sin léxico", que ADR-060 §"Alternativas" ya había rechazado: en un expediente con veinte nombres nadie marca uno por uno. |
| **`null` como centinela, o presencia de clave, para el tercer estado** | Los dos funcionan. `"neutral"` dice lo que hace sin que haya que recordar una convención, sobrevive un round-trip a JSON y es la palabra que el control ya le muestra al usuario (§4). |
| **Guardar `"neutral"` en `EntityGroup.personGender`** | Convertiría el campo en cuatro estados (`f`/`m`/`neutral`/ausente) y obligaría a `resolveLabelSet` a distinguir dos formas de "sin género" que producen el mismo token. El flag interno de §5 separa las dos cosas que de verdad son distintas —qué se muestra y quién lo decidió— sin tocar el dato público. |

## Consecuencias

**Positivas**: el Hito 10.6 pasa a entregar de verdad la inferencia automática, que es su objetivo declarado; el problema de transporte de ADR-060 §10 desaparece entero en vez de resolverse (sin config nueva, sin `fetch`, sin copia de assets, sin ruta de fallo); `J. Pérez` queda imposible de resolver por dos caminos independientes; el peso baja de 384 KB gz a 30 KB; y la atribución CC-BY se simplifica a una sola licencia.

**Negativas**: se pierde cobertura de nombres extranjeros ausentes del registro porteño (Piotr, Katarzyna, Kwame y similares), que caen a `[PERSONA nn]` con el selector manual al lado — es la red de seguridad que ADR-060 §5 diseñó, pero es más trabajo manual en documentos con nombres de otras lenguas; `MARIA` es `A` en el registro, así que "María Gómez" a secas cae a sin determinar, lo que va a sorprender (es correcto: el registro declara que ese nombre no determina género, y "María José" sí resuelve); y el léxico pasa a estar siempre en el bundle, incluso para quien anonimiza solo patentes y CUITs (30 KB, 3,75% del gate).

**Neutras**: `EntityGroup.personGender` no cambia de forma; `ReplacementMode`, `indexInType` y ADR-028 no se tocan; `resolveLabelSet` y la escalera de ADR-057 quedan exactamente como el PR 11 las dejó; la leyenda de ADR-059 sigue absorbiendo los prefijos sin cambios.

## Docs actualizados por este ADR

- `adr/ADR-060-Reemplazo-Por-Genero.md` — errata de §8 acá: Contexto §4, §9, §10, §13; notas de superseded en §9 y §10.
- `core/Contracts.md` §5 (`PersonGenderChoice`) y §8 (`GroupUpdateRequested.patch`).
- `architecture/04_Event_System.md` §10 — la fila de `GROUP_UPDATE_REQUESTED`.
- `architecture/03_Data_Model.md` §9 — `personGender`: quién lo escribe, qué significa la ausencia, y que la elección del humano es recordada aparte.
- `core/Grouping_Engine.md` → v1.4.0: nota de cabecera, §6 (`applyGroupUpdate`), §8, §13 (casos 32 y 34 reescritos contra la fuente única), §14 (los tests contra la tabla real de §7), §15 (checklist 15d/15e), §"Escalera de abreviaturas".
- `roadmap/MVP.md` §4 — bloque del Hito 10.6: fuente única, el PR 11 se parte, la medición del léxico ya está hecha.
- `roadmap/Future_Ideas.md` — la variante UCI ≥1.000 apariciones (§1).
- `NOTICE` y `README.md` — atribución **solo** de Buenos Aires Data; se retira la de UCI al retirarse el dato (lo hace el PR de implementación, junto con el artefacto regenerado).

## Validación

- Los tests de §7 contra la tabla real, en particular: `J. Pérez` → sin determinar; `Andrea` → sin determinar (`A` en el registro); `María José` → `f` y `José María` → `m`; `Joan` → `m`.
- Un `personGender` elegido por el humano —incluido `"neutral"`— sobrevive a `finishSession`, a `reopenSession`, a una re-inferencia y a una fusión (§5, §13 caso 34).
- No-regresión: un documento donde ningún grupo resuelve género produce exactamente los mismos `replacementValue` que antes de ADR-060.
- El artefacto se regenera determinísticamente con el script commiteado y produce el mismo hash (ADR-060 §11, vigente).
- ~~Atribución CC-BY-2.5-AR visible en el producto y procedencia completa en el repo (ADR-060 §11, vigente).~~ **Hecho (PR 12b, ADR-070)**.
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`.

## Referencias

- `adr/ADR-060` §1-§8, §11, §12 (vigentes) — §9, §10 (superseded por §1 y §2 de acá)
- `adr/ADR-018` — `adr/ADR-028` — `adr/ADR-038` §2 — `adr/ADR-039` — `adr/ADR-048` §7 — `adr/ADR-057` §3 — `adr/ADR-059` §2
- `core/Contracts.md` §5, §8 — `core/Grouping_Engine.md` §6, §13, §14, §15 — `architecture/03_Data_Model.md` §9 — `architecture/04_Event_System.md` §10 — `architecture/08_Security_Model.md` §9.1
- Fuente: [Nombres — Buenos Aires Data](https://data.buenosaires.gob.ar/dataset/nombres), recurso "Nombres Permitidos", CC-BY-2.5-AR
- Código: `scripts/build-gender-lexicon.ts` — `packages/anonymization-core/grouping-engine/src/gender.ts` — `packages/anonymization-core/grouping-engine/src/grouping.engine.ts` — `packages/anonymization-core/shared/src/events.ts`
