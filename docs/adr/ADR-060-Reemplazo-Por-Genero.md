<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Grouping_Engine.md,architecture/03_Data_Model.md,architecture/08_Security_Model.md,ui/Components.md,adr/ADR-011-Grouping-First.md,adr/ADR-012-Replacement-Modes.md,adr/ADR-018-First-Party-Assets.md,adr/ADR-028-IndexInType-Renumeracion-Canonica.md,adr/ADR-048-Cierre-E2E-Hito10-Fixtures-Assets-Escenarios.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md,adr/ADR-059-Leyenda-Opcional-De-Marcadores.md | audiencia=humanos+IA | fase=10.6 -->

# ADR-060 — Reemplazo por género para `Person`: recuperar la coherencia referencial del texto

- **Estado**: Accepted
- **Fecha**: 2026-08-06
- **Decidido por**: El humano. Es el punto 6 de `Cambios para hacer.txt`, con su ejemplo textual: *"«[PERSONA 03] y [PERSONA 04] arreglaron para juntarse en la casa de ella.» ¿Quién es ella de las dos personas? ¿A qué se refiere? Tenés que tener el contexto del texto original para saber a quién se refiere."* Eligió léxico first-party con override manual, y que el género ambiguo caiga al token neutro **marcando** el grupo.
- **Relacionado con**: ADR-057 §3 (**dependencia dura**: la resolución de label por grupo que este ADR necesita), ADR-012 (los cuatro modos — este ADR **no** agrega un quinto), ADR-018 (assets first-party), ADR-028 (`indexInType` — que este ADR deliberadamente no toca), ADR-048 §7 (precedente de binario commiteado), ADR-059 (la leyenda, que absorbe los prefijos nuevos sin cambios)
- **Parte de**: Hito 10.6

> Convención de citas: `ADR-060 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-060, Contexto §N`.

> **Nota (ADR-069, 2026-08-14) — §9 y §10 están superseded, y hay una errata de datos.** Al implementar el PR 11 aparecieron dos ambigüedades (el canal por el que el usuario fija `personGender` nunca llegó al tipo del evento; nada declaraba cómo entra el léxico al motor ni quién dispara la inferencia) y, al verificar el artefacto generado contra las fuentes, un defecto de producto: las iniciales resolvían género. `ADR-069` los resuelve y cambia dos decisiones de acá — **la fuente pasa a ser única (solo Buenos Aires, §9 superseded)** y **el léxico viaja dentro del bundle como módulo generado (§10 superseded)**. §1-§8, §11 y §12 siguen vigentes tal cual.
>
> **Además, los ejemplos con nombres propios de Contexto §4 y §9 no estaban verificados contra el CSV y son falsos**: `ANDREA` es `A` (no `F`), `CRUZ` y `RENE` son `M`, `GUADALUPE` es `F`, y `MARIA` es `A`. Están corregidos abajo en su lugar. El ejemplo verdadero de discrepancia con datos anglosajones es **`JOAN`**. Ver `ADR-069` §8.

## Contexto

### 1. La anonimización rompe las referencias del texto, no solo los nombres

El modo `placeholder` reemplaza el nombre y deja intacto todo lo que lo rodea — incluidos los pronombres y las concordancias que apuntaban a él. El texto queda gramaticalmente entero y semánticamente roto:

> "[PERSONA 03] y [PERSONA 04] arreglaron para juntarse en la casa de ella."

El "ella" sigue ahí, pero perdió su antecedente: el género que lo desambiguaba estaba en el nombre, y el nombre ya no está. Con `[MUJER 03] y [HOMBRE 04]`, la frase vuelve a ser interpretable sin el original a mano.

Es un problema distinto del que resuelven ADR-057 y ADR-058: ahí el documento era ilegible porque los píxeles se pisaban; acá es ininteligible aunque se lea perfecto.

### 2. El género no existe en ningún lado del pipeline

Ni `Occurrence`, ni `EntityGroup`, ni `Word` lo llevan. Y no puede salir del NER: el modelo es un clasificador de tokens con etiquetas `PER`/`LOC`/`ORG` (`NER_Engine.md`), no tiene noción de género gramatical ni de identidad. Cualquier valor de género es información **nueva** que hay que producir, no derivar.

### 3. Es la primera vez que el producto *agrega* un atributo al documento anonimizado

Todo lo que hizo Anonly hasta hoy fue quitar o sustituir información. `[PERSONA 01]` revela menos que "Ana Gómez". `[MUJER 01]` revela menos que "Ana Gómez" pero **más que `[PERSONA 01]`**, y el atributo que agrega es una categoría sensible por sí misma.

`08_Security_Model.md` §9.1 ya documenta un riesgo residual de la misma familia —el conteo de ocurrencias por tipo puede decir algo aunque el valor esté oculto—. Este es más fuerte: reduce activamente el conjunto de candidatos de reidentificación, y se compone con cualquier otro atributo que sobreviva en el texto (profesión, ciudad, cargo). Un documento con un solo `[MUJER 01]` en un contexto donde hay tres personas es mucho más identificable que el mismo documento con tres `[PERSONA nn]`.

Esto **no es un bloqueante**: es un trade-off legítimo, el usuario lo elige a cambio de legibilidad, y es su documento. Pero tiene que ser una decisión explícita y documentada, no un efecto colateral que aparezca en una auditoría.

### 4. La inferencia va a equivocarse, y en español bastante

Hay nombres que no determinan género y nombres que lo determinan al revés según la lengua. "José María" es masculino y "María José" femenino, y comparten los mismos dos tokens. Iniciales ("J. Pérez") y nombres de otras lenguas no tienen respuesta.

> **Corregido (ADR-069 §8, 2026-08-14)**: la versión original de este párrafo daba como ambiguos a "Cruz", "Guadalupe", "Trinidad", "Rosario" y "René", y a "Andrea" como femenino en español. Escrito de memoria, sin abrir la fuente. Verificado contra el CSV del registro: **ambiguos (`A`) son `ANDREA`, `MARIA`, `TRINIDAD` y `ROSARIO`**; `CRUZ` y `RENE` son `M` y `GUADALUPE` es `F`. El argumento del párrafo no cambia —hay nombres que el registro declara que no determinan género, y ese es el hecho del que depende §4—, pero los ejemplos sí.

Un error acá no queda en un log: **se imprime en el documento final** y va a manos de un tercero. El costo asimétrico de equivocarse decide §4.

## Decisión

### 1. No es un `ReplacementMode` nuevo

El modo sigue siendo `placeholder`. Lo que cambia es el **label resuelto** para ese grupo.

Un quinto valor en `ReplacementMode` obligaría a tocar el selector de modo de la UI, las `Rule` y su resolución por prioridad (`group > type > global > manual > default`), la tabla de formatos por modo de `Grouping_Engine.md` y los tests de los cuatro modos — todo para expresar algo que no es un modo de reemplazo distinto, sino el mismo modo con otro nombre de tipo. Y crearía combinaciones sin sentido que habría que prohibir a mano ("regla global: género" sobre un documento de patentes).

### 2. `EntityGroup.personGender`

```ts
export type PersonGender = "f" | "m";

export interface EntityGroup {
  // …campos actuales…
  /** Solo para type === Person. Ausente = sin determinar (Contexto §4). */
  readonly personGender?: PersonGender;
}
```

Tres estados, no dos: femenino, masculino y **ausente**. "Sin determinar" no es un valor del enum sino la ausencia del campo, por la misma razón por la que `Occurrence.maskFormat` es opcional (ADR-029): no es una tercera categoría de persona, es la falta de información.

Sobre grupos de cualquier `type` distinto de `Person`, el campo se ignora.

### 3. El label se resuelve con la indirección que ADR-057 §3 dejó puesta

`resolveLabelSet(group)` deja de ser un lookup por `group.type` y pasa a considerar `personGender` cuando el tipo es `Person`. **Ese es todo el cambio en la escalera**: §1, §4 y §5 de ADR-057 no se tocan.

Las variantes entran como filas nuevas de la tabla de ADR-057 §2, con sus propios tres niveles:

| Variante | Nivel 0 | Nivel 1 | Nivel 2 |
|---|---|---|---|
| `Person` sin género (default) | `PERSONA` | `PERS` | `PRS` |
| `Person` femenino | `MUJER` | `MUJER` | `MUJ` |
| `Person` masculino | `HOMBRE` | `HOMB` | `HOM` |

`MUJER` repetido en los niveles 0 y 1 es correcto: son 5 caracteres, acortarlo a 4 no compra nada legible. La selección de nivel de ADR-057 §4 saltea los niveles degenerados sola.

**Si ADR-057 §3 no se hubiera implementado con la indirección, este ADR obligaría a reescribir la escalera entera.** Es la razón por la que ese requisito quedó marcado como no negociable en el plan del Hito 10.5.

### 4. El género sale de un léxico first-party, y ante la duda **no se decide**

Inferencia sobre el `canonicalValue` del grupo, normalizado (NFC, minúsculas, sin diacríticos):

1. Se busca la **secuencia completa de nombres de pila** (todo menos el último token, que se asume apellido). Acierto → ese género.
2. Si no hay acierto, se busca el **primer token** solo.
3. Si los tokens de pila conocidos **discrepan** entre sí, o el nombre no está en el léxico, o está marcado como ambiguo → **sin determinar**.

El paso 1 antes que el 2 es lo que resuelve "José María" vs "María José" sin heurísticas.

**No hay heurística de terminación.** Se evaluó y se descartó: "termina en -a → femenino" falla en Andrea, Cruz, Guadalupe, Nicolás y una lista larga, y por Contexto §4 el costo de ese error es imprimirlo en el documento que se le entrega a un tercero. Un nombre desconocido se declara desconocido.

**El override del usuario gana siempre y es permanente.** Se persiste en `personGender` y sobrevive a `finishSession`, a `reopenSession` y a cualquier re-inferencia posterior — misma precedencia que ADR-057 §7 da a un `replacementValue` editado a mano.

### 5. Sin determinar → token neutro, **y se marca en el árbol**

El grupo usa `PERSONA`/`PERS`/`PRS` como hoy y se señala en el panel de Entidades como "género sin determinar", con acceso directo al selector de §6.

> **Precisión sobre qué se reutiliza.** En planificación se habló de "reutilizar la maquinaria de aviso del paso 4" (ADR-058 §7). Se reutiliza la **afordancia de la UI** —la marca en el árbol de entidades y su acceso a la acción correctiva—, **no** `AnnotationKind.Degraded`: esa anotación se pinta sobre el canvas y significa "este reemplazo quedó ilegible", que es un problema de render. Un grupo sin género determinado se renderiza perfecto; lo que falta es información, no píxeles. Mezclarlas haría que el visor marcara con el mismo recuadro dos cosas que el usuario resuelve de formas distintas.

Nunca se imprime una inferencia dudosa: el peor caso de este ADR es el comportamiento actual.

### 6. Selector por grupo en el panel de Entidades

Sobre grupos `Person`, un control de tres estados (femenino / masculino / sin determinar) que escribe `personGender` vía `GROUP_UPDATE_REQUESTED`, como cualquier otra edición de grupo. El preview del token se actualiza en el acto, igual que al cambiar de modo.

Es la única forma de activar el género: **no hay ajuste global ni por tipo**. Es coherente con ADR-011 (Grouping-First: el grupo es la unidad de operación) y con Contexto §3 — un atributo sensible se divulga de a un grupo por vez, con el usuario mirando, no por una casilla que aplica a todo el documento.

### 7. `indexInType` no cambia

Los grupos `Person` siguen compartiendo **una sola** secuencia, gobernada por ADR-028. `[MUJER 03]` y `[HOMBRE 04]` son la tercera y la cuarta persona del documento.

No se abren secuencias por género. Si se abrieran, coexistirían `[MUJER 01]` y `[HOMBRE 01]` y habría dos personas con el índice 1: el número dejaría de ser único entre personas, que es lo que `08_Security_Model.md` §9 exige para evitar correlación. Además obligaría a re-numerar cada vez que el usuario cambia un género, con `ENTITY_GROUP_UPDATED` en cascada.

### 8. La leyenda de ADR-059 los absorbe sin cambios

Los prefijos `MUJER`/`MUJ`/`HOMBRE`/`HOM` aparecen en la fila de `Person` de la leyenda, junto a `PERSONA`/`PERS`/`PRS`, porque ADR-059 §2 lista *los prefijos efectivamente usados* por tipo. No hace falta tocar `buildMarkerLegend` ni `MarkerLegendEntry`.

Que la leyenda deje ver que hubo distinción de género no agrega divulgación: los tokens ya están en el cuerpo del documento.

### 9. Las dos fuentes del léxico

> **SUPERSEDED por `ADR-069` §1 (2026-08-14).** La fuente pasa a ser **una sola**: Buenos Aires Data. UCI sale del alcance, y con ella la regla de fusión de cuatro filas, el umbral de probabilidad y la columna `Count`. Motivos medidos: de 24 nombres extranjeros probados, Buenos Aires ya resolvía 21 y UCI agregaba tres; la mitad de las 133.899 entradas de UCI las llevan menos de 20 personas; y sus 130 entradas que no son nombres (letras sueltas, iniciales, títulos) hacían que `J. Pérez` resolviera masculino, violando §4. Lo que sobrevive de esta sección es su fundamento: **`A` → sin determinar** y **el registro local es autoritativo**. La variante con UCI recortada a ≥1.000 apariciones queda anotada como opción futura en `roadmap/Future_Ideas.md`. Se conserva el texto original abajo porque es el razonamiento del que ADR-069 §1 parte.

| Fuente | Licencia | Rol | Qué aporta |
|---|---|---|---|
| [**Nombres — Buenos Aires Data**](https://data.buenosaires.gob.ar/dataset/nombres), recurso "Nombres Permitidos" | **CC-BY-2.5-AR** | **Base** | Nombres de uso local con **género** declarado por el registro. Es la fuente correcta para el caso de uso: nombres que efectivamente aparecen en documentos argentinos. Se actualiza trimestralmente. |
| [**Gender by Name — UCI ML Repository**](https://archive.ics.uci.edu/dataset/591/gender+by+name) | **CC BY 4.0** | **Complemento** | 147.270 registros de EE.UU./Reino Unido/Canadá/Australia con columnas `Name / Gender / Count / **Probability**`. Cubre nombres extranjeros que la base no tiene, y —más importante— aporta la **señal de probabilidad**, que es el dato con el que se detecta la ambigüedad en vez de adivinarla. |

**Buenos Aires marca los unisex, y eso decide la regla de fusión.** Su columna de género usa tres valores: `F`, `M` y **`A`** (la terminología del propio dataset es "asexual"). O sea que la fuente base **ya distingue** los nombres que no determinan género, y no hay que inferirlo cruzando fuentes.

**Regla de fusión** (implementa §4, donde "ante la duda no se decide"):

| # | Situación | Resultado |
|---|---|---|
| 1 | Buenos Aires tiene el nombre con `F` o `M` | ese género — **es autoritativo** |
| 2 | Buenos Aires tiene el nombre con `A` | **sin determinar**, y **no se consulta UCI** |
| 3 | Ausente de Buenos Aires, presente en UCI **por encima** del umbral de probabilidad | ese género |
| 4 | Ausente de Buenos Aires y presente en UCI **por debajo** del umbral, o ausente de las dos | sin determinar (§4 paso 3) |

**Buenos Aires es autoritativo y no se contrasta contra UCI**, ni siquiera cuando discrepan. Es el registro civil del país cuyos documentos anonimiza esta herramienta, y una discrepancia con datos anglosajones **no es evidencia de ambigüedad local**: es evidencia de que el nombre se usa distinto en otro idioma, que es justamente lo que no importa acá. El caso que lo muestra es **"Joan"** — `M` en el registro porteño (Joan Manuel Serrat) y femenino con 495.559 registros en los datos anglosajones. En un documento argentino la respuesta correcta es `M`, y una regla de "discrepancia → ambiguo" la habría tirado a la basura junto con una de las inferencias más seguras que hay. Hay 129 discrepancias de esa forma; "Jean" es la segunda.

> **Corregido (ADR-069 §8, 2026-08-14)**: el ejemplo original de este párrafo era "Andrea — `F` en Buenos Aires, casi seguro `M` en UCI". Verificado contra las dos fuentes: **`ANDREA` es `A` en el registro** (no `F`) y es mayoritariamente femenino en los datos anglosajones, así que no ilustraba nada. La decisión que el párrafo defiende no cambia; el ejemplo pasó a ser "Joan", que sí es una discrepancia real y medida.

Esto reduce el rol de UCI a lo que hace bien y solo eso: **cubrir nombres extranjeros ausentes de Buenos Aires**, con su probabilidad como criterio de confianza (regla 3 vs 4). Para nombres locales, la fuente base se basta sola.

> **Sobre el valor `A`**: se mapea a **sin determinar**, no a una tercera categoría de persona. Es una propiedad del **nombre** —el registro declara que puede darse a cualquiera—, no un atributo de quien lo lleva. No genera token propio ni fila nueva en la tabla de §3: el grupo usa `PERSONA`/`PERS`/`PRS` y se marca en el árbol (§5). Inventarle un token divulgaría algo falso sobre la persona y no tendría pronombre al que anclar, que es la razón por la que §"Alternativas" ya rechazó agregar categorías.

### 10. Cómo viaja el léxico, y por qué esto no rompe el "100% local"

> **SUPERSEDED por `ADR-069` §2 (2026-08-14)** en todo lo que describe **transporte**. Con una fuente sola el artefacto pasa de 1,9 MB a **129 KB (30 KB gz)**, y a esa escala nada de esta sección se justifica: el léxico viaja **dentro del bundle**, como módulo TypeScript generado que el motor importa. Sin carga a demanda, sin Cache Storage, sin URL configurable, sin copia a `public/` y sin ruta de fallo por descarga. El párrafo sobre PWA y app de escritorio pierde objeto: un módulo del bundle ya está en el precache y dentro del instalador.
>
> **Sobrevive todo lo que no era transporte**: los CSV originales no entran al repo, el artefacto derivado sí, el script de build es determinista y commiteado, y del build no sobrevive nada más que `nombre → f | m | ambiguo`. Y la conclusión de fondo también: ningún dato del usuario sale del navegador, ni antes ni ahora.

**Lo que se commitea es un artefacto derivado, no los CSV.** Un script de build —hermano de `scripts/mirror-assets.ts`— baja las dos fuentes, normaliza (NFC, minúsculas, sin diacríticos), aplica la regla de fusión de §9 y emite una tabla `nombre → f | m | ambiguo`. **Nada más**: origen, significado, conteos por año y probabilidades se descartan en el build y nunca llegan al producto. Es lo que hace que el artefacto sea chico frente a los CSV originales.

Se commitea en vez de espejarse con `assets.lock.json`: esa infraestructura existe para binarios de cientos de MB descargados de CDNs (ADR-018), y esto son datos fuente derivados de un build determinista. Precedente: ADR-048 §7 con `protected.pdf`.

**Dos momentos distintos, y solo el primero toca internet:**

- **Build** (lo corre un desarrollador, una vez): se descargan los CSV y se genera el artefacto.
- **Runtime** (lo corre el usuario): el artefacto lo sirve **la propia app, mismo origen**, igual que el modelo de NER y los wasm de Tesseract. La CSP de `08_Security_Model.md` §3.2 bloquea cualquier request a un dominio que no sea el propio: aunque alguien quisiera consultar un servicio externo de inferencia de género, no podría. Ningún dato del usuario sale y ningún dato del léxico entra desde afuera (ADR-002, ADR-018).

**Carga a demanda + Cache Storage**, mismo patrón que el modelo de NER: se baja la primera vez que hay un grupo `Person` que evaluar y queda cacheado. A partir de ahí funciona sin red. Motivo: `roadmap/MVP.md` §5 fija bundle inicial < 800 KB gz, y un usuario que anonimiza patentes y CUITs no debería pagar nunca por el léxico. El PR **mide y reporta** el tamaño real contra ese gate, igual que ADR-053 exigió medir el costo de `disableFontFace`.

> **Precisión sobre "sin conexión a internet"**, porque es fácil asumir de más: hoy la app **entera** necesita red para cargarse la primera vez — es una web estática servida desde un CDN, y el modo PWA instalable está fuera del MVP (`MVP.md` §3). El léxico no es distinto del resto en ese aspecto. "100% local" en Anonly significa **que ningún dato del usuario sale del navegador**, no que la app arranque sin internet.
>
> Eso se resuelve por roadmap, no por este ADR, y en dos escalones: la **PWA instalable** de `Version_1.0.md` §2.7 (service worker, offline real tras la primera carga) y la **app de escritorio empaquetada** de `Version_2.0.md` §2.2 (instalador con todos los assets adentro, cero descargas posteriores). El patrón elegido acá —carga a demanda + Cache Storage, el mismo del modelo de NER— entra en el precache de la PWA sin nada extra, y en el instalador de escritorio deja de tener sentido porque el artefacto ya viaja en el paquete. **En ninguno de los dos escenarios hay que rehacer esta decisión.**

### 11. Atribución: es una obligación de licencia, no una cortesía

Las dos fuentes son **CC-BY**. Permiten uso comercial y obras derivadas, pero **exigen crédito**. El PR debe incluir:

- Aviso de atribución **visible en el producto** (créditos / "Acerca de"), no solo en el README. Un `NOTICE` en el repo no alcanza: la app se distribuye como sitio estático y quien la usa tiene que poder ver el crédito.
- Procedencia completa en el repo: URL de origen, licencia, revisión/fecha de descarga y **hash del artefacto generado**, con el mismo criterio de auditabilidad que ADR-018 aplica a los assets.
- El script de build determinista y commiteado, para que cualquiera pueda regenerar el artefacto y verificar el hash.

Es de las cosas que se pasan por alto y son incumplimiento liso y llano. Va como ítem propio del checklist, no como nota.

### 12. Alcance: tres PRs

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 10 | `PersonGender`, `EntityGroup.personGender` | `shared` | ADR-057 PR 3 mergeado |
| 11 | Léxico + inferencia (§4), variantes de label (§3), marca de "sin determinar" (§5) | `grouping-engine` | PR 10, y el punto abierto de §9 resuelto |
| 12 | Selector de género por grupo + marca en el árbol (§5, §6) | `apps/react-client` | PR 10 |

La numeración continúa la del Hito 10.5 (`roadmap/MVP.md` §4). El Hito 10.6 **no arranca antes de que el PR 3 de ADR-057 esté mergeado**: sin la indirección de §3 este ADR no tiene dónde apoyarse.

> **Actualizado por `ADR-069` (2026-08-14).** El PR 11 se parte en tres, porque el campo del patch es un cambio de contrato en `shared` y no puede ir en el mismo PR que el motor (R-1):
>
> | # | PR | Módulo | Depende de |
> |---|---|---|---|
> | 11a | `personGender` en `GroupUpdateRequested.patch` + `PersonGenderChoice` (ADR-069 §4) | `shared` | PR 10 |
> | 11b | Fuente única, artefacto en el bundle y saneamiento (ADR-069 §1-§3) | `scripts/` + `grouping-engine` | — |
> | 11c | Inferencia disparada, elección del humano recordada, tests contra la tabla real (ADR-069 §5-§7) | `grouping-engine` | 11a, 11b |
>
> El PR 12 (`apps/react-client`) depende de 11a, y arrastra la **atribución visible en el producto** de §11, que sigue pendiente.

### 13. Tests

`shared` (PR 10):

- Contract: `personGender` es opcional y `readonly`; `EntityGroup` sigue cumpliendo la inmutabilidad de ADR-008.

`grouping-engine` (PR 11):

- Contract: los tres niveles de las variantes de género respetan el formato de ADR-057 §1.
- Contract: `personGender` sobre un grupo de tipo distinto de `Person` no altera su `replacementValue` (§2).
- Unit: nombre inequívocamente femenino → `f`; masculino → `m`.
- Unit: "José María" → `m` y "María José" → `f` — el test que protege el orden de los pasos de §4.
- Unit: nombre ausente del léxico → sin determinar, token neutro (§5).
- Unit: nombre marcado como ambiguo (`A` en el registro) → sin determinar, **nunca** una elección (§4).
- Unit: iniciales ("J. Pérez") → sin determinar.

> **Reescrito por `ADR-069` §7 y §8 (2026-08-14).** Dos cambios sobre la lista de arriba y la de abajo: (a) los ejemplos con nombre propio pasan a ser los verificados contra el CSV —`ANDREA` es ambiguo, no `f`; el par que ilustra la discrepancia con datos anglosajones es `JOAN`—; y (b) **todo enunciado sobre qué contesta el léxico exige un test contra el artefacto commiteado**, no solo contra tablas sintéticas. Las tablas sintéticas siguen valiendo para probar el orden de los pasos de §4, donde son el fixture del algoritmo. La lista original de esta sección se cubría entera con léxicos inventados a mano, y por eso el PR 11 estuvo en verde mientras `J. Pérez` resolvía masculino contra la tabla real.

Construcción del artefacto (PR 11, sobre el script de build — son los tests que garantizan que la ambigüedad se **detecta** en vez de resolverse a la fuerza):

- Unit: un nombre con `A` en el registro → **sin determinar** (§9, lo único que sobrevive de esa sección).
- Unit: `A` **no** produce un token propio: el grupo usa el label neutro y queda marcado en el árbol (§5).
- Unit: el build descarta las claves con punto o dígito del registro, y **preserva los nombres compuestos** (`maria de la o`, ADR-069 §3).
- Unit: el artefacto se regenera determinísticamente — misma entrada, mismo hash (§11).
- Unit: el artefacto contiene **solo** `nombre → f | m | ambiguo`; ningún origen ni significado sobrevive al build (§10).

Contra la tabla real commiteada (PR 11, ADR-069 §7 — los que faltaban):

- Unit: `J. Pérez` → **sin determinar**. El que encuentra el defecto de ADR-069 Contexto §2.
- Unit: `Andrea` → sin determinar (`A` en el registro); `Joan` → `m`.
- Unit: `María José` → `f` y `José María` → `m` contra la tabla real, no contra un fixture.
- Edge: un `personGender` puesto por el usuario sobrevive a `finishSession` y a una re-inferencia posterior (§4).
- Edge: `[MUJER 03]` y `[HOMBRE 04]` conservan la secuencia única de `Person` (§7).
- Edge: la escalera baja de nivel sobre un grupo con género igual que sobre uno neutro (§3, sin ramas nuevas).

`export-engine` (PR 11, no-regresión):

- Unit: la leyenda lista los prefijos de género bajo la fila `Person`, sin cambios en `buildMarkerLegend` (§8).

`apps/react-client` (PR 12):

- Unit: el selector emite `GROUP_UPDATE_REQUESTED` con `patch.personGender` y refleja los tres estados.
- Unit: el selector no aparece sobre grupos de tipo distinto de `Person`.
- Unit: la marca de "sin determinar" aparece solo sobre grupos `Person` en modo `placeholder` sin género resuelto.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Un `ReplacementMode` nuevo (`gendered`)** | Obliga a tocar el selector de modo, las `Rule` y su resolución por prioridad, y la tabla de formatos por modo — para expresar algo que no es un modo distinto sino el mismo con otro label (§1). Y genera combinaciones sin sentido que habría que prohibir a mano. |
| **Heurística de terminación (-a/-o)** | Gratis y equivocada en español con demasiada frecuencia (Andrea, Cruz, Guadalupe, Nicolás). El error se imprime en un documento que va a manos de un tercero (Contexto §4). |
| **Solo manual, sin léxico** | Cero riesgo de inferencia errónea, pero convierte la función en trabajo manual sobre cada persona de cada documento, y en un expediente con veinte nombres nadie lo va a hacer. El léxico con caída a "sin determinar" tiene el mismo piso de seguridad y muchísimo mejor rendimiento. |
| **Inferir el género desde el NER** | El modelo etiqueta `PER`/`LOC`/`ORG`; no tiene noción de género (Contexto §2). Pedirle otra cosa es cambiar de modelo, con su propio ADR y su propio costo de bundle. |
| **Deducir el género del contexto del texto (pronombres cercanos)** | Es el problema inverso al que se quiere resolver, y mucho más difícil: exige resolución de correferencia. Además invierte el riesgo — una correferencia mal resuelta asigna el género de una persona a otra. |
| **Ajuste global "usar género cuando se pueda"** | Divulga un atributo sensible sobre todo el documento con una sola casilla, sin que el usuario mire caso por caso (§6, Contexto §3). Contradice ADR-011: el grupo es la unidad de operación. |
| **Secuencias de `indexInType` separadas por género** | Produce `[MUJER 01]` y `[HOMBRE 01]` coexistiendo: dos personas con índice 1, rompiendo la unicidad que `08_Security_Model.md` §9 pide. Y obliga a re-numerar en cascada cada vez que el usuario corrige un género (§7). |
| **Espejar el léxico con `assets.lock.json`** | Esa infraestructura existe para binarios pesados de CDN (ADR-018); 100 KB de datos fuente encajan mejor commiteados, con el precedente de ADR-048 §7. Espejarlos agregaría una descarga a un flujo que ya pesa 219 MB para ganar nada. |
| **Categorías adicionales más allá de femenino/masculino** | El objetivo declarado es resolver la correferencia pronominal del español, que es binaria en su morfología. Una categoría "no binario" no tiene un pronombre estándar al que anclar en el texto original, así que no resolvería el problema de Contexto §1 y sí agregaría divulgación. Un usuario que necesite otro token puede escribirlo a mano: `replacementValue` es editable por grupo (ADR-057 §7), y esa palanca cubre el caso sin comprometer al producto con una taxonomía. |

## Consecuencias

**Positivas**: el texto anonimizado recupera la coherencia referencial que el placeholder neutro rompía, que era el problema reportado; el costo de integración es bajo porque ADR-057 §3 dejó la indirección puesta a propósito; la ambigüedad nunca produce un dato falso, solo el comportamiento actual; y la leyenda de ADR-059 lo absorbe sin una línea de cambio.

**Negativas**: es la primera función del producto que **agrega** un atributo sensible al documento anonimizado y reduce el conjunto de candidatos de reidentificación (Contexto §3) — riesgo asumido, opt-in por grupo, y documentado en `08_Security_Model.md` §9.1; incorpora datos de terceros al repo bajo CC-BY, lo que obliga a mantener atribución visible en el producto y provenance auditable (§11); el léxico agrega peso a cargar, acotado por la carga a demanda pero medible; y la cobertura va a ser desigual — nombres de otras lenguas caerán a "sin determinar" con más frecuencia que los locales, lo que se ve como más trabajo manual en documentos con nombres extranjeros.

**Neutras**: los otros doce `EntityType` no se enteran; `ReplacementMode` no cambia; `indexInType` y ADR-028 no se tocan (§7); `mask`, `synthetic` y `redact` no participan; y ADR-057 §1/§4/§5 quedan idénticos.

## Docs actualizados por este ADR

- `core/Contracts.md` §5 (`PersonGender`).
- `architecture/03_Data_Model.md` §9 (`EntityGroup.personGender`, atributos e invariantes), §11 (labels de género en la escalera).
- `architecture/08_Security_Model.md` §9.1 — el riesgo residual de Contexto §3, con su carácter opt-in.
- `core/Grouping_Engine.md` → v1.3.0: nota de cabecera, §"`replacementValue` por modo", §13 (casos nuevos), §14.
- `core/Export_Engine.md` §13 — la nota de §8 (la leyenda absorbe los prefijos de género).
- `ui/Components.md` y `ui/UX_Guidelines.md` — el selector por grupo y la marca de "sin determinar".
- `roadmap/MVP.md` §4 — bloque del Hito 10.6.
- `README.md` y créditos de la app — atribución CC-BY de las dos fuentes (§11).
- ~~**Enmienda pendiente a este mismo ADR**: revisión/fecha de descarga y hash del artefacto generado, más el resultado de la verificación de §9 (§10, §11).~~ **Resuelta por `ADR-069` (2026-08-14)**, que además supersede §9 y §10 y corrige los ejemplos de Contexto §4 y §9. Procedencia y hash viven en `gender-lexicon.provenance.json`.

## Validación

- ~~Punto abierto: si el CSV de Buenos Aires marca los unisex.~~ **Resuelto (2026-08-06)**: usa `F`/`M`/`A`, y la `A` marca los que no determinan género. La regla de fusión de §9 quedó escrita sobre ese hecho, no sobre una suposición.
- Los tests de §13 verdes, en particular los de ambigüedad (§4): son los que garantizan que nunca se imprime una inferencia dudosa.
- Verificación de no-regresión: un documento sin ningún `personGender` asignado produce exactamente los mismos `replacementValue` que antes de este ADR.
- ~~Medición del impacto del léxico contra el gate de bundle de `roadmap/MVP.md` §5, reportada en el PR (§10).~~ **Hecha (ADR-069 §2)**: con la fuente única el léxico son **129 KB crudo / 30 KB gz**, 3,75% del gate de 800 KB gz, dentro del bundle inicial.
- **Atribución CC-BY visible en el producto** y procedencia completa (URL, licencia, revisión, hash) en el repo (§11). Es obligación de licencia, no opcional.
- Verificación de que el artefacto se regenera determinísticamente con el script commiteado y produce el mismo hash (§11).
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`.

## Referencias

- `core/Contracts.md` §5 — `core/Grouping_Engine.md` §"`replacementValue` por modo", §13 — `core/NER_Engine.md` (etiquetas del modelo) — `architecture/03_Data_Model.md` §9 — `architecture/08_Security_Model.md` §9, §9.1
- `adr/ADR-008` — `adr/ADR-011` — `adr/ADR-012` — `adr/ADR-018` — `adr/ADR-028` — `adr/ADR-029` — `adr/ADR-048` §7 — `adr/ADR-057` §1-§4, §7 — `adr/ADR-059` §2
- Código: `packages/anonymization-core/grouping-engine/src/labels.ts` — `packages/anonymization-core/grouping-engine/src/grouping.engine.ts` (`computeReplacementValue`, manejo de `GROUP_UPDATE_REQUESTED`) — `packages/anonymization-core/shared/src/types.ts` (`EntityGroup`) — `apps/react-client/src/components/entities/`
