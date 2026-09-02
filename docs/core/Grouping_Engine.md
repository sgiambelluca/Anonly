<!-- CONTEXT: scope=grouping-engine | dependencias=core/Contracts.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,ADR-011-Grouping-First.md,ADR-012-Replacement-Modes.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-073-Difuso-Solo-Para-Tipos-De-Texto-Libre.md,adr/ADR-074-Una-Entidad-Partida-En-Varias-Lineas.md,adr/ADR-076-La-Edicion-Manual-Del-Valor-De-Reemplazo-Gana.md | audiencia=IA-implementador | fase=3 (fase 10.9: §2/§13 caso 40/§14/§15 15m y el pseudocódigo de Matching por ADR-073 —el pase difuso solo para Person/Organization/Address—; §13 casos 41-42/§14/§15 15n y la línea "la edición manual gana siempre" de la escalera por ADR-076 —`replacementValueUserSet` y la precedencia completa del campo en los once puntos de recálculo—; §13 caso 43/§14/§15 15o y la fórmula de selección de nivel por ADR-074 §7 —`OccurrenceRef.fragments` y la escalera midiendo por fragmento—; §13 caso 36 en fase 10.7: ocurrencia manual, ADR-061; §2/§6/§7/§13 actualizados en fase 10: reopenSession/dropOccurrences/dedup por identidad/finishSession re-ejecutable, ADR-038 §2-§4; fase 10.5: escalera de abreviaturas del placeholder + resolveLabelSet por grupo, ADR-057; fase 10.6: §"replacementValue por modo"/§13 casos 38-39/§14/§15 15i-15k por ADR-072 —la semilla del sintetizador pasa de indexInType a EntityGroup.id— y ADR-071 —el modo synthetic respeta personGender, y dos guardas de recálculo se abren a placeholder|synthetic—; personGender e inferencia por léxico, ADR-060, y §8/§13 caso 32/34/37 + §14/§15 por fuente única, canal del usuario y disparo de la inferencia, ADR-069),adr/ADR-094-Lo-Que-El-Detector-Duda-No-Se-Tira-En-Silencio.md,adr/ADR-116-Un-Valor-Que-El-Documento-Ya-Confirmo-No-Se-Descarta.md,adr/ADR-117-Una-Ocurrencia-Contenida-No-Aporta-Tinta.md -->

# Grouping Engine — Spec de Motor

> Agrupa las `Occurrence` emitidas por Regex y NER en `EntityGroup` por tipo y valor canónico. Detecta conflictos. Expone grupos a la UI (la unidad de operación). Resuelve reemplazos según `ReplacementMode` y `Rule`.

**EngineId**: `grouping`
**Versión del spec**: 1.10.0
**Última actualización**: 2026-09-02

> **Nota (v1.10.0, ADR-117, 2026-09-02 — una ocurrencia contenida no aporta tinta)**: `findOverlapConflict` **saltea los pares del mismo tipo** (`if (rec.entityType === occurrence.entityType) continue;`) y el dedup por identidad exige **bbox idéntico** (ADR-038 §3), así que una ocurrencia contenida entera dentro de otra del mismo tipo no la frenaba nadie. El caso medido: agregar a mano el apellido del imputado sumaba **10** ocurrencias nuevas y **las 10** estaban adentro de `Bartolomé Arturo Suarez`, `Mariela Suarez` o `Leonardo Suarez` — `findLiteral` tokeniza en sub-tokens y matchea el apellido aunque esté dentro de un nombre más largo (ADR-089 §3), con lo que el apellido de tres personas distintas terminaba en un mismo grupo y salía del export con el mismo token. Ahora `processOccurrence` descarta —en silencio, con un `debug`, como el dedup por identidad— toda ocurrencia **contenida entera** en otra del **mismo tipo** ya registrada. Contención **estricta** (un solapamiento parcial sí se registra) y medida sobre los **fragmentos**, no sobre la envolvente (ADR-107). Medido sobre 8 documentos / 763 ocurrencias del pipeline automático: **1** contención (basura: `Person "I"` dentro de `Person "Juez X.Y"`) y **0** solapamientos parciales del mismo tipo — la contención es un artefacto del barrido literal, no del detector, así que descartarla no cuesta ninguna detección. El orden lo garantiza el Orchestrator (regex → NER → manual, que exige `stage: Ready`): en 11 de 11 casos el contenedor llegó primero. Ver §13 caso 24 y §14.

> **Nota (v1.9.0, ADR-116, 2026-09-02 — un valor que el documento ya confirmó no se descarta)**: `handleLowConfidence` emitía el `CONFLICT_DETECTED` y **volvía sin registrar la ocurrencia**, incluso cuando su `normalizedValue` era **idéntico** al de un grupo ya abierto por una detección sobre el umbral. Medido sobre un expediente escaneado: el apellido del imputado quedaba a la vista en la **única** página de veinte donde el modelo le dio **0,612** (umbral 0,7), con el sello leído al 96 %, el orden de lectura correcto y la caja bien mapeada — todo bien salvo un número. `findMatchingGroup` devuelve un grupo por dos vías de fuerza muy distinta (clave exacta, o Levenshtein ≥ `similarityThreshold`) y tratarlas igual es lo que hacía que un valor ya confirmado se llamara "conflicto". Ahora, **con clave exacta la ocurrencia entra al grupo** y el conflicto se emite igual; con coincidencia **solo difusa** no cambia nada. La regla **nunca crea un grupo** ni enciende uno apagado: solo agrega apariciones a grupos que el documento ya abrió, así que la superficie de falsos positivos no crece. Medido sobre 8 documentos / 115 páginas: de **54** ocurrencias bajo el umbral, **9** tienen clave exacta y entran, **0** llegaban por el pase difuso, y **45** siguen el camino de ADR-094 sin cambios. Ver §13 caso 9 y §14.

> **Nota (v1.6.0, ADR-073 + ADR-076 + ADR-074, 2026-08-15 — qué se agrupa, qué se recalcula y contra qué mide la escalera)**: tres cambios independientes, ninguno de contrato público, los tres salidos de la prueba manual sobre la pericia real.
>
> **(1) El pase difuso corre solo para `Person`, `Organization` y `Address`** (ADR-073 §1). El umbral no compara tipos, compara largos: sobre un `normalizedValue` de 9 caracteres o más, un carácter de diferencia ya supera 0.88. Dos CUIT distintos (`1 - 1/11 = 0.909`), dos fechas (`0.900`), dos tarjetas, dos IBAN y dos emails se fusionaban en un grupo — y un grupo tiene **un** `replacementValue`, así que el documento anonimizado afirma que dos entidades distintas son la misma. El DNI se salvaba por 0,005, no por diseño. Para los otros diez tipos el matcheo pasa a ser **exacto** por `normalizedValue`, que es lo que ya unifica `34.567.891` con `34567891` vía el `normalizer` del patrón (caso 3). La fusión manual (caso 5) es la salida para el OCR malo, y la asimetría es deliberada: de más grupos no sale ninguna fuga.
>
> **Nota (ADR-078, 2026-08-19 — el flag deja de ser interno)**: `replacementValueUserSet` **se expone** en `EntityGroup`, de solo lectura (no entra en `GroupUpdatePatch`). La semántica de ADR-076 no cambia —cuándo se enciende, cuándo se apaga, qué protege—: lo único nuevo es que `toPublicGroup()` lo proyecta, para que la UI pueda pintar el indicador de `ui/UX_Guidelines.md` §3.3 y ofrecer "restaurar valor calculado". La regla que decide qué flag `*UserSet` sale: **sale el valor, no la procedencia — salvo que el valor no delate la procedencia**, que es el caso de `replacementValue` (`[P1]` a mano y `[P1]` calculado son idénticos) y no el de `personGender` (quien eligió "femenino" lee `[MUJER 01]`). Por eso `personGenderUserSet` sigue adentro. Ver ADR-078 §1-§2.

> **(2) `replacementValueUserSet`** (ADR-076 §1): ADR-057 §7 promete en negrita que *"la edición manual gana siempre"* y el motor no lo cumplía — `renumberGroupsCanonically` pisa el valor escrito a mano si el índice cambia, e `inferGendersOnFinish` hace lo mismo cuando infiere un género. La edición sobrevivía **por accidente**, gracias a la guarda `if (newIndex === group.indexInType) return;` de ADR-028. Se agrega el flag interno —mismo patrón que `personGenderUserSet` de ADR-069 §5, y por el mismo motivo— y se decide la precedencia completa del campo en los **once** call sites de `computeReplacementValue` (ADR-076 §4): un valor escrito por el usuario sobrevive a todo recálculo automático, y lo reemplaza únicamente un cambio del `replacementMode` **efectivo**, que además apaga el flag. **La guarda de `renumberGroupsCanonically` que ADR-072 §4 decidió no levantar sigue sin levantarse**: este ADR agrega la que faltaba, no libera la que hay.
>
> **(3) La escalera de abreviaturas mide por fragmento** (ADR-074 §7): `OccurrenceRef` gana `fragments` —la descomposición por línea de una ocurrencia que cruza un renglón— y el peor caso de ADR-057 §4 pasa a evaluarse sobre `fragments ?? [bbox]` de cada member, no sobre una envolvente de 557 pt que no aprieta nada. `toOccurrenceRef` lo propaga desde la `Occurrence`. Ver §13 casos 40-43, §14 y §15 (15m-15o).

> **Nota (v1.5.0, ADR-072 + ADR-071, 2026-08-14 — el valor sintético identifica al grupo, y empieza a usar el género)**: dos cambios en `computeReplacementValue`, ninguno en la escalera ni en la inferencia. **(1) La semilla del sintetizador deja de ser `indexInType` y pasa a ser `EntityGroup.id`** (ADR-072 §1): `indexInType` es un ordinal que la renumeración canónica de ADR-028 mueve, así que el valor sintético de un grupo podía cambiar por una operación ajena a ese grupo —renumerar, agregar una entidad a mano (ADR-061), tocar una regla—. Con la identidad como semilla, recalcular es idempotente y la estabilidad deja de depender de saltearse recálculos. `synthesize` pasa a recibir un objeto (`SyntheticRequest`, `Contracts.md` §5) y **se declara en el contrato**, que hasta ahora no la tenía. **(2) El modo `synthetic` respeta `personGender`** (ADR-071 §5): el modo ya imprimía un género —al azar, y posiblemente el equivocado—, así que filtrar el pool de nombres de pila corrige un dato falso en vez de agregar divulgación. El género **no** entra a la semilla: solo elige de qué array se sortea. **(3) Dos guardas de recálculo atadas a `placeholder` se liberan a `placeholder | synthetic`** (ADR-071 §6), en `applyGroupUpdate` y en la pasada de `finishSession`; sin eso el género se guarda y el token no cambia, con todos los gates en verde. **La guarda de `renumberGroupsCanonically` NO se toca** (ADR-072 §4): ya no hace falta, y levantarla ensancharía el defecto de las ediciones manuales (`roadmap/Post_Hito10.8_Pendientes.md` §10). Ver §"`replacementValue` por modo", §13 casos 38-39, §14 y §15 (15i-15k).
>
> **Nota (v1.4.0, ADR-069, 2026-08-14 — el léxico de género: fuente única, cómo viaja y cómo lo fija el usuario)**: cierra las dos ambigüedades que el PR 11 reportó y un defecto que no reportó nadie. **(1) Fuente única**: el léxico se construye solo con el registro de Buenos Aires (9.788 nombres, 129 KB / 30 KB gz); UCI sale del alcance —aportaba 3 de 24 nombres extranjeros probados y las 130 entradas basura que hacían resolver las iniciales— y queda anotada como opción futura en `roadmap/Future_Ideas.md`. **(2) Viaja dentro del bundle** como módulo generado que el motor importa: sin `fetch`, sin config nueva, sin Cache Storage. **(3) Saneamiento con dos candados**: el build descarta claves con punto o dígito (preservando compuestos como `maria de la o`), y `inferPersonGender` **nunca consulta una clave de un solo token que mida un carácter o tenga punto** (`j`, `j.`, `j.m.`) — sin esto, "J. Pérez" imprimía `[HOMBRE 03]` contra la tabla real. **(4) `GroupUpdateRequested.patch` gana `personGender`** con el tercer estado como valor explícito `"neutral"` (el almacenamiento no cambia: `"neutral"` borra el campo). **(5) El motor recuerda que la elección la hizo el humano** (`personGenderUserSet`, interno) — sin ese flag, un "neutral" elegido a mano es indistinguible de "no inferido todavía" y la próxima inferencia lo pisa. **(6) La inferencia corre** al asignar/cambiar `canonicalValue` de un grupo `Person` y en `finishSession` antes de la renumeración canónica, nunca sobre un grupo con elección del humano. **(7) Los tests le preguntan a la tabla real**, no solo a léxicos sintéticos. Supersede ADR-060 §9 y §10. Ver §13 casos 32-34, §14 y §15.
>
> **Nota (v1.3.0, ADR-060, 2026-08-06 — reemplazo por género para `Person`)**: `EntityGroup` gana `personGender?: "f" | "m"` (`03_Data_Model.md` §9), que cambia el label resuelto del `placeholder` a `MUJER`/`HOMBRE`. **No es un `ReplacementMode` nuevo**: el modo sigue siendo `placeholder` y ni el selector de modo ni las `Rule` ni su resolución por prioridad se tocan. Resuelve el problema de que el texto anonimizado pierde su coherencia referencial —"[PERSONA 03] y [PERSONA 04] arreglaron para juntarse en la casa de ella" deja de ser interpretable—. El género se infiere de un léxico first-party sobre el `canonicalValue` (secuencia completa de nombres de pila primero, primer token después) y **ante cualquier duda no se decide**: nombre ausente, ambiguo ("Andrea", "Cruz") o iniciales → sin determinar, token neutro y marca en el árbol. Sin heurística de terminación: el costo de equivocarse es imprimirlo en un documento que va a manos de un tercero. El override del usuario gana siempre y es permanente. `indexInType` **no** se segmenta por género (§13 caso 35). Se apoya en la indirección `resolveLabelSet` que ADR-057 §3 dejó puesta; sin ella habría que reescribir la escalera. Ver §"Escalera de abreviaturas", §13 casos 32-35 y §14.
>
> **Nota (v1.2.0, ADR-057, 2026-08-06 — escalera de abreviaturas del `placeholder`)**: `[<TYPE> <NN>]` deja de ser el único formato y pasa a ser el **nivel 0** de una escalera de tres (`[PERSONA 01]` → `[PERS 01]` → `[PRS-01]`). El nivel se elige **por grupo** con la ocurrencia más apretada de `members[].bbox` y se aplica a **todas** las ocurrencias, para conservar el invariante de ADR-012 (mismo grupo → mismo `replacementValue`): abreviar por ocurrencia haría que el mismo dato apareciera con dos nombres distintos en el mismo documento. La medición es necesariamente una **estimación** (este motor no tiene canvas ni debe tenerlo, `estimateTokenWidth` en `Contracts.md` §6) y por eso la escalera es una optimización, no una garantía: quien garantiza que el texto no se derrame es el render (ADR-058 §1). `<NN>` no se abrevia nunca; `mask`/`synthetic`/`redact` no participan; la edición manual gana siempre. La resolución del label pasa de ser por **tipo** a ser por **grupo** (`resolveLabelSet`), indirección que ADR-060 necesita. Cierra además la ambigüedad que `labels.ts` documentaba desde su implementación: ADR-012 solo daba 4 ejemplos de los 13 tipos y la tabla completa queda ratificada acá. Ver §"Escalera de abreviaturas", §13 casos 27-31 y §14.

> **Nota (ADR-026, 2026-07-11)**: el tipo de config canónico es `GroupingConfig` (Contracts.md §6); el alias `GroupingEngineConfig` de §6/§15.2 queda eliminado (mismo patrón que ADR-021 §2 para OCR y ADR-023 §1 para NER).
>
> **Nota (ADR-028, 2026-07-11)**: `indexInType` es **provisional durante la sesión** (orden de llegada, `nextIndex = max + 1`) y se **renumera canónicamente una sola vez en `finishSession`** por orden de primera aparición documental, antes de emitir `GROUPING_FINISHED`. Resuelve la contradicción con `06_Pipeline.md` §8. Ver §Algoritmos y caso límite 21.
>
> **Nota (ADR-029, 2026-07-11)**: el formato del modo `mask` se resuelve por grupo desde `Occurrence.maskFormat` (campo nuevo que Regex puebla desde el patrón matcheado; caso Plate vieja vs Mercosur), con fallback a `MASK_FORMAT_BY_TYPE[type]`. Ver §`replacementValue` por modo y caso límite 22.
>
> **Nota (ADR-034, 2026-07-16)**: quién invoca la sesión — `startSession(documentId)` lo llama el **Orchestrator** al iniciar la etapa de detección (antes de despachar Regex/NER). `finishSession` se dispara solo (auto-finish al recibir `REGEX_FINISHED` + `NER_FINISHED`) o lo invoca el Orchestrator tras `REGEX_FINISHED` cuando `config.ner.enabled === false` (sin ese wiring, con NER off la sesión no cerraría nunca). `finishSession` es defensivo ante sesión inexistente/ya finalizada (warn + no-op). Sin cambios de firma ni de comportamiento del motor.
>
> **Nota (ADR-038, 2026-07-17)**: soporte de re-análisis parcial (`Orchestrator.reanalyze`, `core/Orchestrator.md` §2/§6/§13.18-§13.22) sin perder ediciones del usuario. Tres piezas nuevas: `reopenSession` (reabre una sesión existente —grupos, reglas, conflictos y ediciones intactos— para una segunda pasada de detección, en vez de crear una sesión nueva); `dropOccurrences` (elimina selectivamente ocurrencias que dejaron de ser válidas, p. ej. las NER al desactivar NER); y un invariante permanente de **dedup por identidad** en el manejo de `ENTITY_FOUND` que hace real la idempotencia declarada en `04_Event_System.md` §5 (una ocurrencia con la misma identidad `(entityType, pageIndex, bbox, normalizedValue)` que ya está en la sesión se descarta en silencio). `finishSession` pasa a ser **re-ejecutable**: tras un `reopenSession`, el próximo cierre vuelve a correr la renumeración canónica de ADR-028 sobre la unión de ocurrencias. Ver §6, §13.23-§13.26.

> **Nota (v1.8.0, ADR-107, 2026-08-27 — el conflicto se mide sobre los fragmentos)**: `findOverlapConflict` comparaba **envolventes** (`bboxIntersectionRatio(rec.bbox, occurrence.bbox)`) cuando el contrato fija lo contrario — *"Quien PINTA usa `fragments ?? [bbox]`, nunca la envolvente sola"* (`Contracts.md`, nota de `fragments`; ADR-074 §1). Una entidad partida por un salto de renglón tiene una envolvente que **abarca el bloque de texto entero**: medido sobre una pericia real, un nombre de 18 caracteres y 3 palabras produce una envolvente de **561 pt**, media página. Contra esa envolvente, el motor levantó **3 conflictos `overlap` falsos** contra vecinas que la entidad no toca — y un conflicto falso no es cosmético: `conflictWinnerIsNew` elige un ganador, así que la perdedora **no llega a formar grupo**. Con `fragments` el conteo de solapamientos reales en ese documento es **cero**. El solapamiento pasa a medirse entre `fragments ?? [bbox]` de las dos, quedándose con el mayor ratio de los pares; `SessionOccurrenceRecord` gana `fragments` para que la comparación pueda verlos. **El umbral (`> 0,5` sobre el área menor) y la resolución de ADR-083 no cambian**: lo único distinto es sobre qué rectángulos se mide, y para una entidad de una sola línea el cálculo es idéntico al de antes. Ver §13 y §14.

> **Nota (v1.7.0, ADR-094, 2026-08-26 — lo que el detector duda no se tira en silencio)**: `handleLowConfidence`, cuando la ocurrencia de NER está por debajo del umbral **y no hay grupo candidato**, hacía un `logger.warn` y `return`. El logger de producción es nulo: la herramienta veía un nombre propio y lo descartaba sin dejar rastro — sobre la carátula de `qa-stamp.pdf`, `Pérez` con 0,5924 y `Juan` con 0,6991. Ahora **crea el grupo con `enabled: false` y `needsReview: true`**, o sea que **no cambia qué se tapa** —un grupo apagado no toca el export— sino qué se le muestra al usuario. Tres compuertas evitan que el panel se llene de ruido: solo tipos de texto libre (los tres de ADR-073 §1), por encima de `MIN_SUGGESTION_CONFIDENCE`, y para `Person` que el primer token esté en `GENDER_LEXICON` (ADR-091). **El piso no está medido** y es el número más flojo del ADR: se calibra con el evaluador de recall/precisión cuando exista. Y hay una regla que, omitida, deja el producto peor que antes: `findMatchingGroup` **no filtra por `enabled`**, así que un grupo sugerido absorbe igual una ocurrencia confiable posterior — por eso se **promueve** (`enabled: true`, `needsReview: false`) cuando eso pasa. La marca significa "nadie decidió todavía": tildar o destildar la casilla la limpia, en los dos sentidos. Ver §13 caso 9, §14 y `Contracts.md` §5.

---

## 1. Objetivo

Recibir el stream de `ENTITY_FOUND` (ocurrencias crudas de Regex y NER) y producir `EntityGroup[]` con `indexInType` secuencial, `canonicalValue`, `aliases` y `members`, exponiéndolos a la UI incrementalmente. Resolver conflictos y aplicar reglas para determinar el `replacementMode` y `replacementValue` final de cada grupo.

---

## 2. Responsabilidades

- Escuchar `ENTITY_FOUND` en el canal `regex` y `ner`.
- Para cada `Occurrence`, encontrar un `EntityGroup` existente del mismo `entityType` por `normalizedValue` **exacto** — y, **solo para `Person`, `Organization` y `Address`**, también por fuzzy (Levenshtein normalizado con umbral `GROUPING_SIMILARITY_THRESHOLD`). Para los otros diez tipos el pase difuso **no corre**: en un identificador estructurado, un carácter de diferencia es otra entidad, y las variantes legítimas de escritura ya las colapsa el `normalizer` de su patrón (ADR-073 §1-§2, caso 3).
- Si encuentra grupo, agregar la ocurrencia como `OccurrenceRef` (y como alias si el `value` difiere).
- Si no encuentra, crear grupo nuevo con `indexInType = nextIndex(type)`.
- Asignar `canonicalValue` (alias más frecuente; en empate, el más largo).
- Resolver `replacementMode` y `replacementValue` aplicando `Rule[]` en orden de prioridad (group > type > global > manual > default placeholder).
- Detectar conflictos (`overlap`, `disagree`, `low_confidence`, `ambiguous_canonical`) y emitir `CONFLICT_DETECTED`.
- Resolver conflictos automáticamente con política default (ver §13 de `06_Pipeline.md`).
- Procesar inputs del usuario: `GROUP_UPDATE_REQUESTED`, `GROUP_MERGE_REQUESTED`, `GROUP_SPLIT_REQUESTED`, `RULE_CREATED`, `RULE_UPDATED`, `RULE_DELETED`, `CONFLICT_RESOLVE_REQUESTED`.
- Emitir `ENTITY_GROUP_CREATED`, `ENTITY_GROUP_UPDATED`, `ENTITY_GROUP_REMOVED`, `GROUP_REPLACEMENT_CHANGED`, `GROUP_TOGGLED`, `CONFLICT_RESOLVED`, `GROUPING_FINISHED`.
- Mantener `indexInType` estable: si un grupo se elimina, su índice se saltea; si dos se fusionan, el resultante conserva el menor.
- Renumerar `indexInType` canónicamente en `finishSession` (por orden de primera aparición documental) antes de emitir `GROUPING_FINISHED`, recalculando `replacementValue` de los grupos en modo `placeholder` afectados (ADR-028). `finishSession` es re-ejecutable: tras un `reopenSession`, vuelve a renumerar sobre la unión de ocurrencias (ADR-038 §2).
- Reabrir una sesión existente (`reopenSession`) para una segunda pasada de detección sin perder grupos, reglas, conflictos ni ediciones (ADR-038 §2).
- Eliminar selectivamente ocurrencias que dejaron de ser válidas (`dropOccurrences`), recalculando o eliminando los grupos afectados según corresponda (ADR-038 §2).
- Descartar en silencio, como invariante permanente, cualquier `ENTITY_FOUND` cuya identidad `(entityType, pageIndex, bbox, normalizedValue)` ya esté registrada en la sesión (dedup real de la idempotencia de `04_Event_System.md` §5, ADR-038 §3).

---

## 3. Fuera de alcance

- Detectar entidades (Regex/NER).
- Renderizar el PDF.
- Conocer React ni UI.
- Persistir nada.
- Hacer OCR.
- Cambiar `canonicalValue` sin intervención del usuario (excepto al crear/fusionar).

---

## 4. Dependencias permitidas

- `@anonly/shared`
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `Occurrence`, `OccurrenceRef`, `EntityGroup`, `EntityType`, `ReplacementMode`, `Rule`, `Conflict`, `ConflictReason`, `Annotation`, `GroupingConfig`, `PersonGender` (ADR-060 §2), `PersonGenderChoice` (ADR-069 §4, entra por `GroupUpdateRequested.patch`) y `SyntheticRequest` (ADR-072 §2, la entrada de `synthesize`)
- De `@anonly/shared`: `estimateTokenWidth` y sus constantes `REPLACEMENT_FONT_HEIGHT_RATIO`/`AVG_GLYPH_ADVANCE_RATIO` (`Contracts.md` §6, ADR-057 §5). **Este motor no tiene canvas ni debe tenerlo**: no puede medir texto, así que la selección de nivel usa esta estimación pura. La comparte con `render-engine` a través de `shared` porque P-1 impide que un motor importe a otro — y **no se duplica**. **ADR-109 §4**: `REPLACEMENT_FONT_HEIGHT_RATIO` bajó de 0,7 a 0,64 porque `bbox.height` pasó a ser el alto de tinta y no el cuerpo. Este motor **no cambia**: el producto `ratio × height` queda igual (×1,006 medido sobre el corpus), así que la escalera elige los mismos niveles.
- `architecture/04_Event_System.md`: todos los eventos de grouping + UI inputs
- Sin dependencias externas nuevas: usa algoritmos propios (Levenshtein). El léxico de nombres (ADR-069 §1, que supersede ADR-060 §9) son **datos commiteados en el repo**, no un paquete de npm. **Desde ADR-091 §1 vive en `@anonly/shared`**, no en este motor: tiene un segundo consumidor (`regex-engine`, como compuerta del patrón de carátula) que no puede importar otro motor. Lo que se queda acá es `inferPersonGender` — el dato se comparte, la política no. El R-12 de procedencia y licencia **está cerrado**: `shared/assets/gender-lexicon.provenance.json` (URL, licencia CC-BY-2.5-AR, fecha de descarga y `sha256` del artefacto), `NOTICE`, y la atribución visible en el producto que entregó ADR-070.

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- Cualquier otro motor
- `pdfjs-dist`, `tesseract.js`, `@huggingface/transformers`, `onnxruntime-web`, `pdf-lib`
- Node builtins, libs de network
- Libs de fuzzy matching externas (`fuse.js`, `fast-levenshtein`) sin ADR

---

## 6. Interfaces públicas

```ts
// GroupingConfig es el tipo canónico de Contracts.md §6 (re-exportado por @anonly/shared);
// se reproduce aquí solo para documentar sus defaults (ADR-026).
export interface GroupingConfig {
  readonly similarityThreshold: number;   // default 0.88
  readonly minAliasFrequency: number;      // default 1
}

export interface GroupingEngineInput {
  readonly documentId: string;
  // No se pasa input directo; el motor escucha ENTITY_FOUND del bus.
}

export interface GroupingEngineSnapshot {
  readonly documentId: string;
  readonly groups: ReadonlyArray<EntityGroup>;
  readonly conflicts: ReadonlyArray<Conflict>;
  readonly rules: ReadonlyArray<Rule>;
}

// ADR-038 §2: re-análisis parcial preservando ediciones.
export interface ReopenSessionOptions {
  readonly expectRegex: boolean;  // la pasada re-correrá Regex (esperar REGEX_FINISHED)
  readonly expectNer: boolean;    // la pasada re-correrá NER (esperar NER_FINISHED)
}

export interface DropOccurrencesFilter {
  readonly source?: DetectionSource;
  readonly pageIndices?: ReadonlyArray<number>;
  // Al menos un campo; ambos presentes = AND.
}

export class GroupingEngine implements IEngine {
  readonly id = EngineId.Grouping;
  init(ctx: EngineContext): Promise<void>;
  startSession(documentId: string): void;
  getSnapshot(documentId: string): GroupingEngineSnapshot;
  finishSession(documentId: string): Promise<void>;  // emite GROUPING_FINISHED; re-ejecutable (ADR-038 §2)
  // Reabre una sesión existente (grupos/reglas/conflictos/ediciones intactos) para
  // una segunda pasada de detección. Sesión inexistente → warn + no-op (ADR-038 §2).
  reopenSession(documentId: string, options: ReopenSessionOptions): void;
  // Elimina del registro de sesión las ocurrencias que matchean el filtro y sus
  // members de los grupos; recalcula/elimina grupos afectados (ADR-038 §2).
  // Filtro sin campos → InvalidInputError; sesión inexistente → warn + no-op.
  dropOccurrences(documentId: string, filter: DropOccurrencesFilter): void;
  applyGroupUpdate(req: GroupUpdateRequested): Promise<EntityGroup>;
  applyGroupMerge(req: GroupMergeRequested): Promise<EntityGroup>;
  applyGroupSplit(req: GroupSplitRequested): Promise<{ merged: EntityGroup; created: EntityGroup }>;
  applyRuleCreated(req: RuleCreated): Promise<void>;
  applyRuleUpdated(req: RuleUpdated): Promise<void>;
  applyRuleDeleted(req: RuleDeleted): Promise<void>;
  applyConflictResolve(req: ConflictResolveRequested): Promise<Conflict>;
  closeSession(documentId: string): Promise<void>;
  dispose(): Promise<void>;
}
```

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Idempotente |
|---|---|---|---|---|
| `ENTITY_GROUP_CREATED` | al crear un grupo nuevo | `EntityGroupCreated` | async | no |
| `ENTITY_GROUP_UPDATED` | al mutar un grupo por patch, fusión o regla | `EntityGroupUpdated` | async | sí |
| `ENTITY_GROUP_REMOVED` | al eliminar un grupo (fusión, cierre, o `dropOccurrences` que deja un grupo sin members) | `EntityGroupRemoved` | async | sí |
| `GROUP_REPLACEMENT_CHANGED` | cuando `replacementMode` o `replacementValue` cambian | `GroupReplacementChanged` | async | sí |
| `GROUP_TOGGLED` | cuando `enabled` cambia | `GroupToggled` | async | sí |
| `CONFLICT_DETECTED` | al detectar un conflicto | `ConflictDetected` | async | sí |
| `CONFLICT_RESOLVED` | al resolver un conflicto (auto o manual) | `ConflictResolved` | async | sí |
| `GROUPING_FINISHED` | cuando Regex + NER terminaron y no hay más `ENTITY_FOUND` pendientes; puede repetirse tras un `reopenSession` (ADR-038 §2) | `GroupingFinished` | async | sí |

Canal: `EventChannel.Grouping`.

---

## 8. Eventos que consume

| Evento | Cuándo | Acción |
|---|---|---|
| `ENTITY_FOUND` (canales `regex` y `ner`) | cada ocurrencia detectada | si su identidad `(entityType, pageIndex, bbox, normalizedValue)` ya está registrada en la sesión, descartar en silencio (dedup, ADR-038 §3); si no, agregar a grupo existente o crear nuevo; emitir `ENTITY_GROUP_CREATED` o `ENTITY_GROUP_UPDATED` |
| `REGEX_FINISHED` (canal `regex`) | Regex terminó | marcar regex done |
| `NER_FINISHED` (canal `ner`) | NER terminó | marcar ner done; si ambos done, emitir `GROUPING_FINISHED` |
| `GROUP_UPDATE_REQUESTED` (canal `ui`) | usuario edita grupo | `applyGroupUpdate`. Con `patch.personGender` (ADR-069 §4): `"f"`/`"m"` escriben el campo, `"neutral"` lo borra, y en los tres casos se marca la elección como del humano para que ninguna inferencia posterior la pise (§13 caso 34). Sobre un grupo de `type` distinto de `Person`, se ignora con `warn` |
| `GROUP_MERGE_REQUESTED` (canal `ui`) | usuario fusiona | `applyGroupMerge` |
| `GROUP_SPLIT_REQUESTED` (canal `ui`) | usuario divide | `applyGroupSplit` |
| `RULE_CREATED` (canal `ui`) | usuario crea regla | `applyRuleCreated` + recompute modos |
| `RULE_UPDATED` (canal `ui`) | usuario edita regla | `applyRuleUpdated` + recompute |
| `RULE_DELETED` (canal `ui`) | usuario borra regla | `applyRuleDeleted` + recompute |
| `CONFLICT_RESOLVE_REQUESTED` (canal `ui`) | usuario resuelve conflicto | `applyConflictResolve` |
| `DOCUMENT_CLOSED` (canal `ui`) | usuario cierra doc | `closeSession` |

Canales escuchados: `EventChannel.Regex`, `EventChannel.Ner`, `EventChannel.UI`.

---

## 9. Entradas

No recibe input directo en `process`. Recibe datos vía eventos del bus:

- `EntityFound.occurrence: Occurrence` (con `entityType`, `value`, `normalizedValue`, `bbox`, `pageIndex`, `source`, `confidence`).
- Inputs de UI: `GroupUpdateRequested`, `GroupMergeRequested`, etc.

**Restricciones**:
- `Occurrence.normalizedValue` debe estar poblado (lo provee Regex/NER).
- `Occurrence.entityType` debe ser válido.
- `GroupUpdateRequested.patch` no puede contener campos no permitidos (`id`, `type`, `members`, `indexInType`, `createdAt` son inmutables).

---

## 10. Salidas

No retorna output directo. Emite eventos y mantiene un snapshot consultable vía `getSnapshot`:

```ts
GroupingEngineSnapshot {
  documentId: string;
  groups: ReadonlyArray<EntityGroup>;
  conflicts: ReadonlyArray<Conflict>;
  rules: ReadonlyArray<Rule>;
}
```

Cada `EntityGroup` cumple las invariantes de `03_Data_Model.md` §9:
- `members.length >= 1`
- `indexInType` único por `(documentId, type)`
- `canonicalValue ∈ aliases` (excepto edición manual explícita)
- `replacementValue` consistente con `replacementMode`

---

## 11. Errores posibles

| Code | Clase | Cuándo | Recuperable | Acción |
|---|---|---|---|---|
| `GROUPING_INVALID_PATCH` | `GroupingInvalidPatchError` | `GroupUpdateRequested.patch` contiene campos inmutables o inválidos | no | rechazar el request, loguear warn |
| `GROUPING_GROUP_NOT_FOUND` | `GroupingGroupNotFoundError` | `groupId` referenciado no existe (fue eliminado o nunca existió) | no | rechazar el request, loguear warn |
| `ENGINE_NOT_INITIALIZED` | `EngineNotInitializedError` | operación antes de `init` | no | bug del caller |
| `ENGINE_DISPOSED` | `EngineDisposedError` | operación tras `dispose` | no | bug del caller |
| `INVALID_INPUT` | `InvalidInputError` | input null/undefined | no | bug del caller |

Grouping es determinista dadas las ocurrencias y reglas; sin errores de runtime esperados.

`retryable`: todos `false`.

---

## 12. Consideraciones de rendimiento

- **Corre en main thread** (no en Worker). Es ligero: < 5% del total del pipeline.
- Costo: 0.5–2 ms por `Occurrence` procesada (búsqueda en grupos del mismo tipo + fuzzy matching si no hay match exacto).
- Memoria: 1–10 MB por documento activo (grupos + refs + reglas + conflictos).
- Sin transferencia zero-copy (trabaja sobre estructuras en memoria).
- Para fuzzy matching: el algoritmo de Levenshtein se aplica solo cuando no hay match exacto. Se acota a grupos del mismo `entityType`. Para 1000 grupos del mismo tipo, costo O(1000 × len) por ocurrencia — aceptable. Si supera 5000 grupos, se optimiza con index por longitud o n-gramas (futuro).
- Cancelación: entre procesamientos de `ENTITY_FOUND`. SLA < 50 ms (no requiere Worker).
- Snapshot inmutable: `getSnapshot` retorna una copia defensiva para que la UI no mute el estado interno.

---

## 13. Casos límite

1. **Documento sin ocurrencias**: 0 grupos, `GROUPING_FINISHED` con `groupCount = 0`.
2. **Una sola ocurrencia**: un grupo con `members.length = 1`, `indexInType = 1`, `aliases = [value]`.
3. **Mismo DNI con y sin puntos (`34.567.891` y `34567891`)**: `normalizedValue` idéntico → mismo grupo, `aliases = ["34.567.891", "34567891"]`, `canonicalValue = "34.567.891"` (más frecuente o primero).
4. **"J. Pérez" y "Juan Pérez" en el mismo documento**: son `Person`, o sea uno de los tres tipos donde el pase difuso **sí** corre (ADR-073 §1). El match exacto falla y el fuzzy con umbral 0.88 tampoco alcanza: "juan perez" vs "j. pérez" da Levenshtein normalizado > 0.12 → no se agrupan automáticamente. El usuario puede fusionar manualmente con `GROUP_MERGE_REQUESTED`.
5. **Fusión manual**: dos grupos se fusionan en uno. El resultante conserva el menor `indexInType`, sus `aliases` se unen, `canonicalValue` se elige por frecuencia. El otro grupo se elimina con `ENTITY_GROUP_REMOVED`.
6. **División manual**: un grupo se divide; las ocurrencias seleccionadas van a un grupo nuevo con `indexInType = nextIndex(type)`. El grupo original conserva las demás. **El grupo nuevo hereda el `replacementMode` del original**, incluido uno puesto a mano, y después pasa por `resolveMode` como cualquier grupo — así que una regla de grupo/tipo/global sigue ganando sobre lo heredado, con la precedencia de siempre. El `replacementValue` se computa de cero para el grupo nuevo (su `id` y sus `members` son otros), no se copia.

   > **Decidido el 2026-08-14, al implementar el Hito 10.6.** Esta sección solo hablaba del `indexInType` y el modo del grupo nuevo **no estaba especificado**: el código lo creaba en `placeholder` y recién después le corría `resolveMode`, con lo cual las reglas se heredaban pero **un modo puesto a mano en ese grupo no**. Se veía así: un grupo en `synthetic` mostrando un nombre falso se dividía, y la mitad nueva salía como `[PERSONA 04]` — las dos mitades de lo que el usuario venía tratando como una sola cosa quedaban en modos distintos. El comportamiento ya se conocía —el test de ADR-029 lo esquiva usando una regla de tipo "para que el grupo NUEVO que cree el split también nazca en modo mask"— pero nunca se había decidido. Se resuelve heredando, por dos razones: **la fusión ya preserva** el `replacementMode` del grupo que sobrevive, así que heredar deja las dos operaciones con el mismo criterio; y dividir no es "apareció una entidad nueva" sino "esto que yo trataba como una cosa son dos", donde el modo elegido para el todo es la mejor conjetura para cada parte. La alternativa —seguir cayendo al default— es defendible (nadie expresó una preferencia *sobre el grupo nuevo*) pero obliga al usuario a reponer el modo cada vez que divide.
7. **Conflicto `overlap`**: dos ocurrencias de distinto tipo se solapan de verdad. El solapamiento se mide entre los `fragments ?? [bbox]` de las dos —nunca contra la envolvente sola (ADR-107; `Contracts.md`, nota de `fragments`)—, quedándose con el mayor ratio de los pares; el umbral sigue siendo `> 0,5` sobre el área menor. Para una entidad de una sola línea el cálculo es idéntico al de antes de ADR-107. Se emite `CONFLICT_DETECTED`. Resolución default: gana el de mayor `confidence`, en empate Regex. El usuario puede overridear.
8. **Conflicto `disagree`**: Regex dice DNI, NER dice Person en el mismo span. Gana Regex. Conflicto emitido.
9. **Conflicto `low_confidence`**: NER con `confidence < 0.7`. **Con** grupo candidato al que parecerse: se emite `CONFLICT_DETECTED` para auditoría y, **desde ADR-116**, si la coincidencia es por `normalizedValue` **exacto** la ocurrencia **entra al grupo** (nunca lo crea ni lo enciende); si es **solo difusa** (Levenshtein ≥ `similarityThreshold`), se descarta como siempre. **Sin** grupo candidato (ADR-094 §1): deja de descartarse en silencio y se **sugiere** — grupo con `enabled: false` y `needsReview: true`, `ENTITY_GROUP_CREATED` normal, y ningún conflicto (no hay grupo contra el cual plantearlo). La sugerencia solo procede si el tipo es de texto libre, la confianza está por encima de `MIN_SUGGESTION_CONFIDENCE`, y —para `Person`— el primer token del valor está en `GENDER_LEXICON`; si alguna falla, se sigue descartando con el `warn` de siempre. **Promoción** (ADR-094 §3): si después entra al grupo una ocurrencia que no es de baja confianza, pasa a `enabled: true` / `needsReview: false`. **Decisión del usuario** (ADR-094 §4): un `patch.enabled`, en cualquiera de los dos sentidos, limpia `needsReview`.
24. **Una ocurrencia contenida entera en otra del mismo tipo** (ADR-117): no se registra, en silencio (`debug`, mismo criterio que el dedup por identidad de ADR-038 §3) — no emite `CONFLICT_DETECTED`, porque no hay conflicto: la tinta ya está tapada por la entidad que la contiene. La contención es **estricta** (todos los fragmentos de la nueva adentro de algún fragmento de la vieja, y bboxes no idénticos); un solapamiento **parcial** del mismo tipo **sí** se registra, y una contención de tipo **distinto** sigue yendo a los casos 7-8. Se mide sobre los **fragmentos** y no sobre la envolvente (ADR-107): contra la envolvente de una entidad multi-línea, cualquier vecina de esas dos líneas parecería contenida. **Límite**: protege cuando el contenedor ya está registrado; agregar a mano un valor largo sobre una detección corta ya registrada deja el duplicado.
10. **Conflicto `ambiguous_canonical`**: dos aliases con misma frecuencia. `canonicalValue` se elige arbitrariamente (el primero encontrado) y se marca conflicto para que el usuario confirme.
11. **Edición de `replacementMode`**: `GROUP_UPDATE_REQUESTED` con `patch.replacementMode = "synthetic"`. El motor recalcula `replacementValue` con el sintetizador (seed por sesión). Emite `ENTITY_GROUP_UPDATED` + `GROUP_REPLACEMENT_CHANGED`.
12. **Regla `type` nueva**: `RULE_CREATED` con `scope = "type"`, `entityType = DNI`, `mode = "mask"`. Todos los grupos DNI sin regla `group` específica pasan a `mask`. Emite `ENTITY_GROUP_UPDATED` por cada grupo afectado.
13. **Regla `global`**: aplica a todos los grupos sin regla más específica.
14. **Regla `group` vs `type` vs `global`**: gana la más específica (group > type > global). `priority` desempata dentro del mismo scope.
15. **`indexInType` estable tras eliminar grupo**: si elimino el grupo `DNI 02`, los grupos `DNI 01` y `DNI 03` conservan sus índices. No se reasigna.
16. **`indexInType` tras fusión**: fusionar `DNI 02` en `DNI 01` → `DNI 01` conserva índice 1 y se enriquece; `DNI 02` se elimina; `DNI 03` conserva índice 3.
17. **Edición mientras NER sigue corriendo**: el usuario edita un grupo; llega un nuevo `ENTITY_FOUND`. Si matchea ese grupo, se agrega **sin perder la edición del usuario** (gana el `replacementMode` del usuario).
18. **`canonicalValue` editado manualmente**: el usuario puede setear `canonicalValue` arbitrario vía `patch.canonicalValue`. A partir de ahí, `canonicalValue ∉ aliases` es válido (es una excepción explícita).
19. **`closeSession` libera todo**: tras `DOCUMENT_CLOSED`, el motor limpia grupos, reglas, conflictos y alias de la sesión.
20. **`process` tras `dispose`**: lanza `EngineDisposedError`.
21. **Renumeración canónica en `finishSession` (ADR-028)**: llegan ocurrencias fuera de orden documental (NER procesa por prioridad visible). Los índices provisionales reflejan el orden de llegada; al cerrar, la renumeración deja "Persona 1" como la primera del documento (`pageIndex`/`bbox.y`/`bbox.x`), emite `ENTITY_GROUP_UPDATED` por cada índice que cambió y recalcula el `replacementValue` de los placeholders afectados. Las ediciones del usuario hechas durante la sesión (caso 17) se preservan; solo puede cambiar el número.
22. **Máscara por variante de patente (ADR-029)**: un grupo `Plate` cuyos members llevan `maskFormat: "XXX XXX"` (patente vieja `ABC 123`) enmascara `XXX XXX`; uno Mercosur (`AB 123 CD`, `maskFormat: "XX XXX XX"`) enmascara `XX XXX XX`. Grupo mixto (solo posible por fusión manual): gana el `maskFormat` más frecuente; empate → el del member con primera aparición documental. Sin `maskFormat` en ningún member: fallback `MASK_FORMAT_BY_TYPE[type]`.
23. **Dedup por identidad (ADR-038 §3)**: llega un `ENTITY_FOUND` cuya `(entityType, pageIndex, bbox, normalizedValue)` ya está registrada en la sesión (p. ej. una re-pasada de Regex tras `reopenSession`) → se descarta en silencio (`logger.debug`, sin eventos, sin tocar frecuencias ni `aliases`). No es exclusivo de sesiones reabiertas: es un invariante siempre activo.
24. **`reopenSession` sobre grupos editados**: se reabre la sesión con `dropOccurrences({ source: DetectionSource.NER })` previo (desactivar NER) → los grupos cuyos únicos members eran NER se eliminan (`members.length ≥ 1`, `03_Data_Model.md` §9) aunque el usuario los haya editado; los grupos con members Regex restantes conservan sus ediciones intactas (ADR-038 §5.2, Q1 de ADR-038).
25. **`dropOccurrences` por `pageIndices`** (re-OCR de páginas, ADR-038 §5.3): se eliminan todas las ocurrencias (Regex y NER) de esas páginas, incluidas las que un usuario ya fusionó o cuyo grupo editó; grupos que quedan sin members se eliminan con `ENTITY_GROUP_REMOVED`; conflictos **cuyo grupo se eliminó** se descartan con `CONFLICT_RESOLVED` (ver la salvedad de abajo). No renumera `indexInType`: eso ocurre en el próximo `finishSession`. `dropOccurrences` con filtro sin campos → `InvalidInputError`; sesión inexistente → warn + no-op.

    > **Salvedad estructural (errata 2026-08-19)**: la redacción anterior decía "conflictos cuyo grupo **o candidatos** referencian ocurrencias eliminadas". La segunda mitad **no es implementable con el contrato actual** y nunca lo fue: `ConflictCandidate` (`03_Data_Model.md` §9) tiene `{source, entityType, confidence, value}` — sin `occurrenceId` y sin `bbox`—, así que no hay forma de preguntar si un candidato hablaba de una de las ocurrencias que se acaban de borrar. Lo que **sí** se descarta es el conflicto cuyo **grupo** desapareció, que es identificable por `groupId`.
    >
    > **Qué queda cuando el grupo sobrevive**: un conflicto "stale" en el snapshot, apuntando a un grupo vivo con candidatos que describen una ocurrencia que ya no existe. El usuario ve un ⚠ que, al resolverlo, no cambia nada. **No corrompe datos y no produce fuga**: es ruido en la UI.
    >
    > **Decisión (2026-08-19)**: se acota la promesa del spec en vez de ampliar el contrato. Meter `occurrenceId` en `ConflictCandidate` toca `shared` + `grouping-engine` + la UI para eliminar un ⚠ huérfano e inofensivo; el costo no lo justifica. Si algún día el conflicto stale produce un síntoma real, la ampliación tiene su propio ADR.
26. **`finishSession` re-ejecutado tras `reopenSession`**: la renumeración canónica corre de nuevo sobre la unión de ocurrencias vigentes; el resultado final es indistinguible de una corrida fresca con la config final más las ediciones del usuario (mismo invariante de determinismo de ADR-028, extendido a múltiples pasadas). Los índices de placeholder pueden correrse respecto de lo que el usuario ya vio (aceptado, ADR-038 §5, Q2).
27. **Grupo con una sola ocurrencia apretada (ADR-057 §4)**: un grupo con 40 apariciones holgadas y una sobre un bbox angosto baja al nivel que entra en **esa**, y el token corto se aplica a las 41. Es deliberado: elegir por ocurrencia rompería el invariante de que todas las `Replacement` de un grupo comparten valor.
28. **Ni el nivel 2 entra (ADR-057 §4)**: el grupo se queda en nivel 2 sin error ni warning. Grouping no tiene otra carta; el shrink-to-fit del render (ADR-058 §1) es quien garantiza que no se derrame.
29. **Tipos con niveles degenerados (ADR-057 §2)**: `DNI`, `CUIT` e `IBAN` tienen niveles 0 y 1 idénticos, y `MUJER` tiene 0 y 1 idénticos. La selección devuelve el primero que entra, así que los niveles repetidos se saltean solos — no hay rama especial ni error por la igualdad.
30. **`replacementValue` editado a mano frente a la escalera (ADR-057 §7, implementado por ADR-076)**: el usuario escribe `[P1]` para un grupo; la selección de nivel no lo toca, ni en ese momento ni en un `finishSession` posterior — **tampoco si el `indexInType` del grupo cambia en la renumeración**, que es lo que hasta ADR-076 no se cumplía. La precedencia completa está en los casos 40-41; ADR-057 §7 prometía esto y el motor lo cumplía solo por accidente, mientras el índice no se moviera.
31. **Re-análisis que cambia el nivel (ADR-057 §7)**: tras `reopenSession` + `finishSession`, un member nuevo más angosto puede bajar el nivel del grupo y cambiar su token respecto de lo que el usuario ya vio. Aceptado por el mismo criterio que el corrimiento de `indexInType` (caso 26): el estado post-`finishSession` es el canónico.
32. **Género inferido, ambiguo y sin determinar (ADR-060 §4, ADR-069 §1/§3)**: `"Julia Gomez"` → `personGender: "f"` → `[MUJER 03]`. Caen a **sin determinar** —token neutro `[PERSONA 03]` y marca en el árbol— cuatro situaciones distintas: nombre marcado `A` en el registro (`ANDREA`, `MARIA`, `TRINIDAD`, `ROSARIO`), nombre ausente del registro (`KATARZYNA`), **iniciales** (`"J. Pérez"`, `"J.M. Pérez"`) y un `canonicalValue` sin ningún token utilizable. Nunca se elige un género dudoso: el error se imprimiría en un documento que va a manos de un tercero.
    **Las iniciales están cortadas dos veces** (ADR-069 §3): el build no deja entrar claves con punto o dígito, y `inferPersonGender` no consulta una clave de un solo token que mida un carácter o contenga un punto. La redundancia es deliberada — con una sola fuente de verdad, un artefacto regenerado con otro criterio volvería a imprimir `[HOMBRE 03]` sobre `"J. Pérez"`, que es exactamente lo que pasó en el PR 11.
    **El registro local es autoritativo** y por eso `"Joan"` resuelve `m` (Joan Manuel Serrat) aunque en datos anglosajones sea abrumadoramente femenino. **`"Andrea"` no resuelve `f`**: el registro la declara `A`. *(Este caso decía lo contrario hasta ADR-069 §8; el ejemplo estaba escrito de memoria y no contra el CSV.)*
33. **Orden de resolución del nombre de pila (ADR-060 §4)**: "José María Gómez" → `m` y "María José Gómez" → `f`. Se busca primero la secuencia completa de nombres de pila y recién después el primer token solo; si los tokens conocidos discrepan, sin determinar.
34. **`personGender` puesto por el usuario (ADR-060 §4, ADR-069 §4/§5)**: llega por `GROUP_UPDATE_REQUESTED` con `patch.personGender` ∈ `"f" | "m" | "neutral"`. Gana sobre cualquier inferencia y sobrevive a `finishSession`, a `reopenSession`, a una re-inferencia posterior y a una fusión (el grupo que sobrevive conserva su elección). Sobre un grupo de `type` distinto de `Person`, se ignora con `warn` y no altera el `replacementValue`.
    **`"neutral"` es una elección, no una ausencia**: borra `personGender` —el grupo vuelve a `[PERSONA 03]`— pero queda registrado que lo decidió el humano. Sin esa distinción, un "neutral" elegido a mano sería indistinguible de un grupo todavía no inferido y la próxima pasada lo pisaría con `[MUJER 03]`. El registro es interno (`personGenderUserSet`), no viaja en `EntityGroup` ni en ningún evento, y se limpia con la sesión en `closeSession`.
35. **Secuencia única de `Person` con género (ADR-060 §7)**: `[MUJER 03]` y `[HOMBRE 04]` son la tercera y la cuarta persona del documento. No se abren secuencias por género — coexistirían `[MUJER 01]` y `[HOMBRE 01]`, rompiendo la unicidad de `indexInType` que `08_Security_Model.md` §9 exige.
36. **Ocurrencia manual sobre un grupo existente (ADR-061 §6)**: llega un `ENTITY_FOUND` con `source: DetectionSource.Manual` cuyo valor ya tiene grupo. No hay camino nuevo: el matching de siempre lo suma como member, y si la identidad `(entityType, pageIndex, bbox, normalizedValue)` ya estaba, el dedup de ADR-038 §3 la descarta en silencio. **Es lo que hace segura la repetición**: agregar dos veces el mismo valor, o uno que el detector ya había encontrado, es idempotente sin escribir nada para eso.
37. **Cuándo corre la inferencia de género (ADR-069 §6)**: en dos puntos, y nunca sobre un grupo con elección del humano. **(a)** Al asignar o cambiar el `canonicalValue` de un grupo `Person` — creación, fusión, y edición manual de `patch.canonicalValue` (caso 18). **(b)** En `finishSession`, sobre todos los grupos `Person` sin elección del humano, **antes** de `renumberGroupsCanonically`: es la red que garantiza convergencia, y la que hace que los tokens no parpadeen durante la detección, porque `[PERSONA 03]` → `[MUJER 03]` ocurre en el mismo cierre en que ADR-028 ya podía correr los índices (caso 21). Idempotente: misma tabla + mismo `canonicalValue` ⇒ mismo resultado. Un género que cambia recalcula `replacementValue` y emite `ENTITY_GROUP_UPDATED` + `GROUP_REPLACEMENT_CHANGED`, como cualquier otra mutación de grupo.
38. **El valor sintético sobrevive a la renumeración (ADR-072 §1)**: un grupo en modo `synthetic` cuyo `indexInType` cambia —en la renumeración canónica de `finishSession` (ADR-028), al agregarse una entidad manual (ADR-061) o al recalcularse los modos por un cambio de reglas— **conserva su `replacementValue`**. Sale de que la semilla es `EntityGroup.id` y no el número: recalcular da el mismo string, así que no hay nada que preservar a mano. Una **fusión** conserva el valor del sobreviviente (conserva su `id`); una **división** le da uno propio al grupo nuevo. Excepción declarada: `Custom`, cuyo valor **interpola** el índice (`custom-3`) y por lo tanto queda desactualizado igual que antes de este ADR (ADR-072 §3).
39. **Género en modo `synthetic` (ADR-071 §5/§6)**: sobre un grupo `Person` con `personGender` resuelto, el sintetizador sortea del pool filtrado por ese género — "María Gómez" deja de poder salir "Carlos Sánchez". Con el género **sin determinar** sigue sorteando del pool completo: no hay nombre de pila neutro en español al cual caer, y el modo fabrica datos falsos por definición (ADR-012), así que el piso es exactamente el comportamiento previo. **El recálculo del valor cuando el género cambia ya no está atado a `placeholder`**: vale para `placeholder | synthetic`, tanto en `applyGroupUpdate` (elección del usuario) como en la pasada de `finishSession` (género inferido). Sin esa liberación el campo se guarda, el token no cambia y todos los gates quedan verdes — la misma falla silenciosa que ADR-069 Contexto §3 registró para la inferencia.
40. **Dos identificadores estructurados que difieren en un carácter no se fusionan (ADR-073 §1)**: `20-12345678-9` y `20-12345679-9` producen **dos** grupos `CUIT`, con `indexInType` y `replacementValue` propios. Lo mismo para `Date` (`01/07/2026` vs `07/07/2026`, el caso medido sobre la pericia), `Phone`, `CreditCard`, `IBAN`, `Email`, `DNI`, `License`, `Plate` y `Custom`. Si de verdad eran el mismo —un OCR que se comió un dígito—, el usuario los fusiona con `GROUP_MERGE_REQUESTED` (caso 5), que es un paso y es reversible. **La asimetría es la decisión**: de más grupos no sale ninguna fuga; de menos, el documento afirma que dos entidades distintas son la misma. El texto libre no cambia: `"Pablo Roman"` y `"Pablo R0man"` siguen agrupando (caso 4).
41. **Precedencia del `replacementValue` escrito a mano (ADR-076 §3)**: un valor que el usuario escribió (`GROUP_UPDATE_REQUESTED` con `patch.replacementValue`, incluido `""`) **sobrevive a todo recálculo automático** — renumeración canónica de `finishSession` aunque el índice cambie (caso 21), inferencia de género en `finishSession` (caso 37), fusión (el sobreviviente lo conserva), división (el remanente lo conserva; el grupo nuevo nace con valor calculado), `dropOccurrences`, `reopenSession` y la escalera de abreviaturas (caso 30). Lo reemplaza **únicamente un cambio del `replacementMode` efectivo**, que además apaga la marca: una edición explícita del modo sobre ese grupo, o una regla que cambie el modo efectivo — incluida la que pase a aplicar tras una **reclasificación de tipo** (ADR-082 §4), que si no cambia el modo efectivo conserva la edición. `applyConflictResolve` estaba en esta lista hasta ADR-083 §2 y salió: resolver un conflicto elige el tipo, no el modo. El motivo es que `replacementValue` es el valor **de un modo** —un grupo en `mask` mostrando `[P1]` es una inconsistencia que nadie pidió— y es coherente con que las reglas ya ganen sobre el modo puesto a mano (§"Resolución de modo").
42. **Cómo se vuelve al valor automático (ADR-076 §5)**: tocando el selector de modo. Elegir otro modo y volver recalcula el valor y apaga la marca. No hay un canal dedicado en `GroupUpdateRequested.patch` para "restaurar automático": sería un cambio de contrato y un control más en la fila más cargada del árbol, para algo que se hace con los controles que ya están.
43. **La escalera mide por fragmento, no por envolvente (ADR-074 §7)**: un member cuya ocurrencia cruza un salto de línea lleva `fragments` (`03_Data_Model.md` §8), y el peor caso de ADR-057 §4 se evalúa sobre `fragments ?? [bbox]` de cada member. Sin esto, una envolvente de 557 pt de ancho no aprieta nada y el grupo se queda en nivel 0 aunque su ocurrencia real sea angosta. Se miden **todos** los fragmentos, no solo el que va a llevar el token (que es el más ancho, ADR-074 §5): el nivel es uno solo para todo el grupo y sus members mezclan ocurrencias de una y de varias líneas, así que medir de menos ahí es cómo se llega a un token que no entra. `toOccurrenceRef` propaga el campo desde la `Occurrence` — es un salto de la cadena y se propaga explícitamente, por el precedente de ADR-066 §6.

44. **El usuario reclasifica un grupo (`patch.type`, ADR-082)**: el tipo gobierna el label del token, la secuencia `indexInType`, qué regla de scope `type` aplica y de qué pool sortea el sintetizador, así que el cambio recalcula en este orden: índice nuevo del tipo destino (el viejo queda como hueco a propósito — lo compacta `renumberGroupsCanonically` en el próximo `finishSession`, ADR-028); modo efectivo re-resuelto contra las reglas; `replacementValue` con el label set nuevo, **salvo** `replacementValueUserSet` (ADR-076 §3, ratificado por ADR-082 §4 — con la salvedad de que si el modo efectivo cambió aplica la fila 4 y el valor se recalcula apagando el flag); y `personGender` borrado al salir de `Person` / re-inferido al entrar. Tipo igual al vigente = no-op sin eventos. **Los `SessionOccurrenceRecord` NO siguen al grupo** (ADR-082 §3): conservan el tipo del **detector**, porque es contra lo que el detector vuelve a emitir en un `reanalyze` — si siguieran al grupo, el dedup por identidad (que corre antes que la detección de conflictos) dejaría de reconocer la ocurrencia re-emitida y esta caería en `findOverlapConflict` contra su propio grupo. Consecuencia conocida: `findMatchingGroup` empareja por tipo, así que una ocurrencia **nueva** del mismo valor que el detector siga emitiendo con el tipo original crea un grupo nuevo en vez de caer en el reclasificado.
45. **Resolver un conflicto elige el tipo, no el modo (ADR-083)**: `applyConflictResolve` aplica el `entityType` elegido por la **misma vía** que el caso 44 y marca el conflicto `resolved` con `resolvedType`. Sin `entityType` en la request, gana el candidato de mayor `confidence` (empate a `regex`) — que con el `confidence: 1.0` que emite `regex-engine` coincide con la resolución automática que el motor ya tomó al crear el conflicto, o sea que **confirmar es un no-op sobre los datos**. Si el tipo elegido es el vigente, no se emite `ENTITY_GROUP_UPDATED`. `applyConflictResolve` **dejó de tocar el `replacementMode`**, así que salió de la lista de disparadores del caso 41.

---

## 14. Casos de prueba

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `emits ENTITY_GROUP_CREATED on first occurrence of a value` | `contract.test.ts` | contract | invariante |
| `emits ENTITY_GROUP_UPDATED on second occurrence of same value` | `contract.test.ts` | contract | invariante |
| `emits GROUPING_FINISHED after REGEX_FINISHED + NER_FINISHED` | `contract.test.ts` | contract | invariante |
| `indexInType unique per (document, type)` | `contract.test.ts` | contract | invariante |
| `canonicalValue ∈ aliases` | `unit.test.ts` | unit | invariante |
| `members.length ≥ 1` | `unit.test.ts` | unit | invariante |
| `DNI with and without dots groups together` | `unit.test.ts` | unit | caso 3 |
| `J. Pérez and Juan Pérez do not auto-merge` | `edge.test.ts` | edge | caso 4 |
| `manual merge preserves lower indexInType` | `edge.test.ts` | edge | caso 5/16 |
| `manual split creates new group with nextIndex` | `edge.test.ts` | edge | caso 6 |
| `overlap conflict detected` | `edge.test.ts` | edge | caso 7 |
| `disagree conflict resolved in favor of regex` | `edge.test.ts` | edge | caso 8 |
| `low_confidence occurrence with an EXACT key joins the group, and still emits the conflict` | `edge.test.ts` | edge | caso 9 (ADR-116) — **reemplaza** a `low_confidence occurrence discarded`: el caso medido es el apellido que quedaba a la vista en una página de veinte |
| `low_confidence occurrence that matches only FUZZILY is still discarded` | `edge.test.ts` | edge | caso 9 (ADR-116) — la puerta floja queda cerrada |
| `an occurrence fully inside another of the same type is not recorded` | `edge.test.ts` | edge | caso 24 (ADR-117) — el caso medido: el apellido arrancado de adentro de tres nombres completos |
| `a PARTIAL overlap of the same type is still recorded` | `edge.test.ts` | edge | caso 24 (ADR-117) — el límite de la regla estricta |
| `containment of a DIFFERENT type still goes through the overlap conflict` | `edge.test.ts` | edge | caso 24 (ADR-117) — los casos 7-8 no se tocan |
| `does not treat a neighbour inside the ENVELOPE of a multi-line entity as contained` | `edge.test.ts` | edge | caso 24 (ADR-117) — ADR-107 aplicado a la contención |
| `a low_confidence occurrence does not switch on a suggested group` | `edge.test.ts` | edge | caso 9 (ADR-116) — la promoción de ADR-094 §3 no se hereda |
| **`low_confidence occurrence with no candidate group is suggested, not discarded`** | `edge.test.ts` | edge | caso 9 (ADR-094 §1) — el grupo nace apagado y marcado |
| **`does not suggest below the confidence floor, outside free-text types, or without a known given name`** | `edge.test.ts` | edge | caso 9 (ADR-094 §2) — las tres compuertas; sin ellas el panel se llena de ruido |
| **`promotes a suggested group when a confident occurrence joins it`** | `edge.test.ts` | edge | caso 9 (ADR-094 §3) — **sin este test el ADR se puede implementar dejando el producto peor que antes** |
| **`clears needsReview once the user toggles the group either way`** | `edge.test.ts` | edge | caso 9 (ADR-094 §4) — la marca es "nadie decidió todavía" |
| `ambiguous_canonical conflict emitted` | `edge.test.ts` | edge | caso 10 |
| `replacementMode change recalculates replacementValue` | `edge.test.ts` | edge | caso 11 |
| `type rule overrides default mode for all groups of type` | `edge.test.ts` | edge | caso 12 |
| `global rule applies to groups without more specific rule` | `edge.test.ts` | edge | caso 13 |
| `group rule wins over type rule wins over global` | `edge.test.ts` | edge | caso 14 |
| `indexInType stable after group removal` | `edge.test.ts` | edge | caso 15 |
| `user edit preserved when new ENTITY_FOUND arrives` | `edge.test.ts` | edge | caso 17 |
| `manual canonicalValue override allowed` | `edge.test.ts` | edge | caso 18 |
| `closeSession clears state` | `contract.test.ts` | contract | caso 19 |
| `throws GroupingInvalidPatchError on immutable field patch` | `edge.test.ts` | edge | invariantes |
| `throws GroupingGroupNotFoundError on missing groupId` | `edge.test.ts` | edge | – |
| `throws EngineDisposedError after dispose` | `edge.test.ts` | edge | caso 20 |
| `empty document emits GROUPING_FINISHED with 0 groups` | `edge.test.ts` | edge | caso 1 |
| `single occurrence creates group with indexInType 1` | `edge.test.ts` | edge | caso 2 |
| `final indexInType deterministic regardless of event arrival order` | `contract.test.ts` | contract | invariante ADR-028 |
| `mask uses occurrence maskFormat over type fallback` | `unit.test.ts` | unit | caso 22 (ADR-029) |
| `mixed maskFormat group resolves by frequency then document order` | `edge.test.ts` | edge | caso 22 (ADR-029) |
| `canonical renumbering at finishSession emits updates and recomputes placeholders` | `edge.test.ts` | edge | caso 21 |
| `cancel between ENTITY_FOUND within 50ms` | `cancel.test.ts` | cancel | SLA |
| `snapshot of groups for text-10p.pdf stable` | `snapshot.test.ts` | snapshot | fixture |
| `duplicate ENTITY_FOUND with same identity is dropped silently` | `edge.test.ts` | edge | caso 23 (ADR-038 §3) |
| `reopenSession preserves existing groups/rules/edits` | `contract.test.ts` | contract | ADR-038 §2 |
| `dropOccurrences by source removes NER-only groups, keeps edited Regex groups` | `edge.test.ts` | edge | caso 24 (ADR-038 §5.2) |
| `dropOccurrences by pageIndices discards stale conflicts` | `edge.test.ts` | edge | caso 25 (ADR-038 §5.3) |
| `dropOccurrences with empty filter throws InvalidInputError` | `edge.test.ts` | edge | caso 25 |
| `finishSession re-run after reopenSession renumbers over union of occurrences` | `contract.test.ts` | contract | caso 26 (ADR-028 extendido) |
| `all three abbreviation levels respect their format for the 13 entity types` | `contract.test.ts` | contract | ADR-057 §1-§2 |
| `all members of a group share the same replacementValue` | `contract.test.ts` | contract | invariante ADR-012, re-asertado por ADR-057 §4 |
| `group with only wide bboxes stays at level 0 (no behaviour change)` | `unit.test.ts` | unit | ADR-057 §4 — **no-regresión**: donde no había problema, el token no cambia |
| `one narrow member lowers the level for the whole group` | `unit.test.ts` | unit | caso 27 (ADR-057 §4) |
| `group where not even level 2 fits stays at level 2 without error` | `edge.test.ts` | edge | caso 28 (ADR-057 §4) |
| `degenerate levels (DNI/CUIT/IBAN) produce expected tokens` | `edge.test.ts` | edge | caso 29 (ADR-057 §2) |
| `hand-edited replacementValue survives finishSession and level selection` | `edge.test.ts` | edge | caso 30 (ADR-057 §7) |
| `mask/synthetic/redact values unchanged by the abbreviation ladder` | `edge.test.ts` | edge | ADR-057 §6 |
| `reopenSession + finishSession with a narrower member changes the level` | `edge.test.ts` | edge | caso 31 (ADR-057 §7) |
| `unambiguously feminine/masculine name infers personGender` | `unit.test.ts` | unit | caso 32 (ADR-060 §4) |
| `"José María" → m and "María José" → f` | `unit.test.ts` | unit | caso 33 (ADR-060 §4) — protege el orden de los pasos |
| `name absent from lexicon, unisex name ("A") and initials → undetermined + neutral token` | `unit.test.ts` | unit | caso 32 (ADR-060 §4/§5) |
| `initials are never looked up: "J. Pérez" and "J.M. Pérez" against the REAL table` | `unit.test.ts` | unit | caso 32 (ADR-069 §3/§7) — el que encuentra el defecto del PR 11 |
| `"Andrea" is undetermined and "Joan" is m, against the REAL table` | `unit.test.ts` | unit | caso 32 (ADR-069 §1/§7) — el registro local manda, y `A` no se resuelve |
| `"José María"/"María José" resolve against the REAL table` | `unit.test.ts` | unit | caso 33 (ADR-069 §7) — el orden de los pasos, sobre datos reales |
| `user-set personGender survives finishSession, reopenSession, re-inference and merge` | `edge.test.ts` | edge | caso 34 (ADR-060 §4, ADR-069 §5) |
| `user-set "neutral" is not overwritten by a later inference` | `edge.test.ts` | edge | caso 34 (ADR-069 §4/§5) — sin el flag interno, este test se cae |
| `inference runs on canonicalValue change and at finishSession, never over a user choice` | `edge.test.ts` | edge | caso 37 (ADR-069 §6) |
| `personGender on a non-Person group does not alter replacementValue` | `edge.test.ts` | edge | caso 34 (ADR-060 §2) |
| `gendered groups keep the single Person indexInType sequence` | `edge.test.ts` | edge | caso 35 (ADR-060 §7) |
| `gendered labels use the same ladder, no extra branches` | `edge.test.ts` | edge | ADR-060 §3 |
| `synthetic value survives canonical renumbering at finishSession` | `edge.test.ts` | edge | caso 38 (ADR-072 §1) — **el test que define ADR-072** |
| `adding a manual entity that shifts indexInType leaves synthetic values untouched` | `edge.test.ts` | edge | caso 38 (ADR-072 §1, ADR-061) |
| `merge keeps the survivor's synthetic value; split gives the new group its own` | `edge.test.ts` | edge | caso 38 (ADR-072 §1) |
| `a rule change that triggers recomputeAllGroupModes does not move synthetic values` | `edge.test.ts` | edge | caso 38 (ADR-072 §1) |
| `Person group with personGender resolved gets a matching synthetic first name` | `unit.test.ts` | unit | caso 39 (ADR-071 §5) |
| `changing personGender in synthetic mode recomputes replacementValue and emits` | `edge.test.ts` | edge | caso 39 (ADR-071 §6) — **sin esto la feature no tiene efecto** |
| `gender inferred at finishSession repaints the token in synthetic mode` | `edge.test.ts` | edge | caso 39 (ADR-071 §6) |
| `Person group without personGender in synthetic mode is unchanged` | `edge.test.ts` | edge | caso 39 (ADR-071 §5) — no-regresión |
| `split inherits the parent's replacementMode, including a manually set one` | `edge.test.ts` | edge | caso 6 — el que cubre el vacío de spec cerrado el 2026-08-14 |
| **`two Dates differing in one character produce two groups`** | `unit.test.ts` | unit | caso 40 (ADR-073 §1) — **el test que define ADR-073**: `01/07/2026` y `07/07/2026`, el caso medido sobre la pericia |
| `one-character difference produces two groups for CUIT, Phone, CreditCard, IBAN and Email` | `unit.test.ts` | unit | caso 40 (ADR-073 §2) |
| **`"Pablo Roman" and "Pablo R0man" still group together`** | `unit.test.ts` | unit | caso 4 — **no-regresión del texto libre**: si esto se cae, ADR-073 rompió lo que vino a proteger. Ídem `Organization` y `Address` |
| `DNI with and without dots still groups by the EXACT pass` | `unit.test.ts` | unit | caso 3 — separa "los unificó el `normalizer`" de "los unificó el difuso" |
| `Custom does not fuzzy-group` | `edge.test.ts` | edge | caso 40 (ADR-073 §1) |
| `DNI does not fuzzy-group even with similarityThreshold at 0.80` | `edge.test.ts` | edge | caso 40 — la protección deja de depender del número |
| `two groups that no longer auto-merge can still be merged by hand` | `edge.test.ts` | edge | caso 40 + caso 5 — la salida documentada tiene que estar cubierta |
| **`hand-edited replacementValue survives a finishSession that DOES change indexInType`** | `edge.test.ts` | edge | caso 41 (ADR-076 §8) — **el test que define ADR-076**, y la **corrección** del test de ADR-057 §Tests: el escenario anterior pasaba sin mover el índice, o sea sin ejercitar la condición |
| **`hand-edited replacementValue survives gender inference at finishSession`** | `edge.test.ts` | edge | caso 41 — el segundo camino (ADR-076, Contexto §3): sin este test el arreglo tapa la mitad del defecto |
| `hand-edited replacementValue survives inference in synthetic mode too` | `edge.test.ts` | edge | caso 41 — que el arreglo no quede atado a `placeholder` (ADR-071 §6) |
| `hand-edited replacementValue survives merge, split, dropOccurrences and reopenSession` | `edge.test.ts` | edge | caso 41 (ADR-076 §4) |
| `an explicit replacementMode change replaces the hand-edited value and clears the flag` | `edge.test.ts` | edge | caso 41/42 (ADR-076 §3) — y volver al modo original da el valor calculado, no el manual |
| `a rule that changes the effective mode replaces it; one that does not, leaves it` | `edge.test.ts` | edge | caso 41 (ADR-076 §4, punto 11) |
| `applyConflictResolve preserves the hand-edited value when the effective mode does not change` | `edge.test.ts` | edge | caso 41 (ADR-076 §4 punto 10, **enmendado por ADR-083 §2**: la resolución elige el tipo, así que el valor manual sobrevive salvo cambio del modo efectivo) |
| `a patch with both replacementMode and replacementValue keeps the user's value` | `edge.test.ts` | edge | caso 41 (ADR-076 §2) |
| `an empty-string replacementValue counts as a manual edit` | `edge.test.ts` | edge | caso 41 (ADR-076 §2) |
| `cambia el tipo, toma índice del tipo nuevo y recalcula el token` | `unit.test.ts` | unit | ADR-082 §2 |
| `un patch con el tipo vigente es no-op: no emite ENTITY_GROUP_UPDATED` | `unit.test.ts` | unit | ADR-082 §1 |
| `salir de Person borra personGender; volver a Person lo re-infiere` | `unit.test.ts` | unit | ADR-082 §2 paso 4 |
| `una edición manual del replacementValue sobrevive al cambio de tipo` | `unit.test.ts` | unit | ADR-082 §4 (ratifica ADR-076 §3) |
| `re-emitir la misma ocurrencia tras un cambio de tipo no duplica ni crea conflicto` | `unit.test.ts` | unit | **ADR-082 §3** — el test que corrigió la decisión: los `SessionOccurrenceRecord` conservan el tipo del **detector**, no el del grupo |
| `una ocurrencia nueva del mismo valor cae en el grupo reclasificado, sin crear uno paralelo` | `unit.test.ts` | unit | ADR-085 §1(a) — escenario B de ADR-082 |
| `un grupo recreado tras borrarse nace con el tipo corregido` | `unit.test.ts` | unit | ADR-085 §1(b) — escenario C: es lo único que `absorbedTypes` no cubre |
| `el difuso hereda la corrección en un tipo de texto libre` | `unit.test.ts` | unit | ADR-085 §3 |
| `el difuso NO hereda la corrección en un tipo estructurado (ADR-073)` | `unit.test.ts` | unit | ADR-085 §3. Los valores tienen **10 dígitos** a propósito: a distancia 1 dan 0.900, sobre el umbral 0.88. Con 8 darían 0.875 y el test pasaría por casualidad sin ejercitar el guard — verificado falseando la implementación |
| `ni absorbedTypes ni typeCorrections salen en el snapshot` | `unit.test.ts` | unit | ADR-085 §8 |
| `un cambio de tipo que borra personGender lo reporta en changes` | `unit.test.ts` | unit | ADR-082 §5 — el campo se borraba sin avisarle a la UI |
| `applyConflictResolve sin entityType aplica el default de mayor confidence` | `edge.test.ts` | edge | ADR-083 §4 — la rama que el diálogo usa al confirmar sin elegir |
| `tras un cambio de tipo, finishSession renumera sin colisiones de (type, indexInType)` | `unit.test.ts` | unit | ADR-082 §2 paso 1 + ADR-028 |
| `replacementValueUserSet is exposed in snapshots and event payloads` | `contract.test.ts` | contract | **ADR-078 §1 — invierte el test de ADR-076 §1**, que afirmaba lo contrario. El flag sale; `personGenderUserSet` sigue sin salir (ver la fila siguiente) |
| `personGenderUserSet never appears in snapshots or event payloads` | `contract.test.ts` | contract | ADR-069 §5, ratificado por ADR-078 §2: su valor asociado sí delata quién lo escribió, así que el flag se queda adentro |
| `a group starts with replacementValueUserSet false and turns true after a manual replacementValue edit` | `unit.test.ts` | unit | ADR-078 §1 |
| `re-applying the same replacementMode clears replacementValueUserSet and restores the computed value` | `unit.test.ts` | unit | ADR-078 §3 — es la acción "restaurar valor calculado" de la UI, que no necesita API nueva |
| `fragments survive from Occurrence to OccurrenceRef and reach getSnapshot` | `unit.test.ts` | unit | caso 43 (ADR-074 §1) |
| `a narrow fragment hidden by a wide envelope lowers the abbreviation level` | `unit.test.ts` | unit | caso 43 (ADR-074 §7) — sin esto la escalera mide contra 557 pt y nunca baja |

Fixtures: `tests/fixtures/text-10p.pdf` con entidades conocidas que generan grupos predecibles.

> **Regla de tests del léxico (ADR-069 §7)**: las tablas sintéticas armadas a mano siguen siendo válidas para probar el **orden de los pasos** de la inferencia (ADR-060 §4), donde la tabla es el fixture del algoritmo. Pero **todo enunciado sobre qué contesta el léxico** —iniciales, ambiguos, compuestos, un nombre que resuelve `f`— exige un test contra el **artefacto commiteado**, que es el único que corre en producción. La lista original de esta sección se cubría entera con léxicos de dos entradas inventados por test, y por eso el PR 11 pasó todos los gates mientras `"J. Pérez"` resolvía masculino contra la tabla real. Corolario para los docs: ningún ejemplo con nombre propio entra a un spec o a un ADR sin verificarse antes contra la fuente.

---

## 15. Checklist de implementación

- [ ] 1. Crear paquete `packages/anonymization-core/grouping-engine/`.
- [ ] 2. Definir `types.ts` con `GroupingEngineInput`, `GroupingEngineSnapshot` (`GroupingConfig` viene de `@anonly/shared`/Contracts.md §6; ADR-026).
- [ ] 3. Definir `errors.ts` con `GroupingInvalidPatchError`, `GroupingGroupNotFoundError`.
- [ ] 4. Implementar `grouping.engine.ts` respetando `IEngine` y la firma pública de §6.
- [ ] 5. Implementar `init` (suscribirse a `ENTITY_FOUND` en `regex` y `ner`, a `REGEX_FINISHED`/`NER_FINISHED`, a eventos de UI en `ui`).
- [ ] 6. Implementar `startSession`/`closeSession` (gestión de estado por `documentId`).
- [ ] 7. Implementar algoritmo de matching: exacto por `normalizedValue`, luego fuzzy Levenshtein normalizado con umbral `similarityThreshold`.
- [ ] 8. Implementar asignación de `indexInType` secuencial y estable (no reasigna tras eliminación).
- [ ] 8b. Implementar la renumeración canónica de `indexInType` en `finishSession` (orden documental, `ENTITY_GROUP_UPDATED` por índice cambiado, recálculo de placeholders; ADR-028, §Algoritmos).
- [ ] 9. Implementar cálculo de `canonicalValue` (alias más frecuente, en empate el más largo).
- [ ] 10. Implementar detección de conflictos (`overlap`, `disagree`, `low_confidence`, `ambiguous_canonical`).
- [ ] 11. Implementar resolución default automática de conflictos (ver §13 de `06_Pipeline.md`).
- [ ] 12. Implementar resolución de `replacementMode` por `Rule[]` en orden group > type > global > manual > default.
- [ ] 13. Implementar `applyGroupUpdate`/`Merge`/`Split`/`RuleCreated`/`Updated`/`Deleted`/`ConflictResolve`.
- [ ] 14. Implementar `getSnapshot` (copia defensiva).
- [ ] 15. Implementar `dispose` (dessuscribir todos los handlers del bus).
- [ ] 15b. Implementar `reopenSession`/`dropOccurrences` y el dedup por identidad en el handler de `ENTITY_FOUND`; hacer `finishSession` re-ejecutable sobre la unión de ocurrencias (ADR-038 §2-§4, casos 23-26).
- [ ] 15c. (Hito 10.5, PR 3 — ADR-057) Tablas de los tres niveles en `labels.ts`; reemplazar el acceso directo a `TYPE_LABEL_ES` por `resolveLabelSet(group)`; selección de nivel por peor caso de `members[].bbox` con `estimateTokenWidth` de `@anonly/shared`, enganchada en `computeReplacementValue` sin agregar disparadores nuevos. La edición manual del usuario no se toca. Casos 27-31 en §13.
- [x] 15d. (Hito 10.6, PR 11b — ADR-060) `personGender` en la resolución de `resolveLabelSet`; inferencia por secuencia de nombres de pila y luego primer token, con caída a "sin determinar" ante ausencia o ambigüedad. Sin heurística de terminación. Casos 32-35 en §13. **Hecho en el PR 11**; lo que falta de género está en 15f-15h.
- [x] 15e. (Hito 10.6, PR 11b — ADR-069 §1-§3, supersede la versión ADR-060 §9-§11 de este ítem) Script de build determinista sobre **una sola fuente**: Buenos Aires Data, recurso "Nombres Permitidos" (CC-BY-2.5-AR), que declara `F`/`M`/`A` por nombre — la `A` cae a "sin determinar". Emite un **módulo TypeScript generado** con la tabla `nombre → f | m | ambiguo` (9.788 entradas, 129 KB / 30 KB gz) que el motor **importa**: no hay carga a demanda, ni Cache Storage, ni URL configurable, ni copia a `public/`. **Saneamiento en el build**: se descartan las claves con punto o dígito (8 abreviaturas del registro), **preservando los compuestos** (`maria de la o`, `ana de las ermitas`). **Los CSV originales no entran al repo; el artefacto sí.** **Precondición que no es un detalle**: atribución CC-BY-2.5-AR visible en el producto (PR 12), más procedencia y hash auditables al estilo ADR-018 — y **retirar la atribución de UCI** al retirarse el dato.
- [x] 15f. (Hito 10.6, PR 11a — ADR-069 §4) En `shared`: `PersonGenderChoice = PersonGender | "neutral"` y `personGender?: PersonGenderChoice` en `GroupUpdateRequested.patch` (`Contracts.md` §8, `04_Event_System.md` §10). Cambio de contrato: va en su propio PR, antes del motor y antes del PR 12.
- [x] 15g. (Hito 10.6, PR 11c — ADR-069 §3/§5/§6) Guard de iniciales en `inferPersonGender` (una clave de un solo token que mida un carácter o contenga un punto no se consulta); `personGenderUserSet` interno en `InternalGroup` con su ciclo de vida (fusión incluida); `applyGroupUpdate` acepta `patch.personGender` con `"neutral"` borrando el campo, y lo ignora con `warn` fuera de `Person`; disparo de la inferencia en los dos puntos del caso 37.
- [x] 15h. (Hito 10.6, PR 11c — ADR-069 §7) Tests contra el **artefacto commiteado**, no solo contra léxicos sintéticos: iniciales, `A`, compuestos y el par `Joan`/`Andrea`. Ver la regla al pie de §14.
- [x] 15i. (Hito 10.6, PR 14a — ADR-072 §1-§3 y ADR-071 §5) En `shared`, **un solo cambio de firma**: `synthesize` pasa a recibir `SyntheticRequest` (`Contracts.md` §5), su semilla pasa de `indexInType` a `groupId`, y la tabla de nombres de pila lleva el género por entrada **conservando el orden actual** para que el caso sin género no dependa del filtro. `indexInType` sobrevive solo para `Custom` y el fallback. Cambio de contrato: va en su propio PR, antes del motor.
- [x] 15j. (Hito 10.6, PR 14b — ADR-072 §1 y ADR-071 §5/§6) En el motor: `computeReplacementValue` pasa `group.id` y `group.personGender`; las guardas de recálculo por cambio de género en `applyGroupUpdate` y en la pasada de `finishSession` se abren de `placeholder` a `placeholder | synthetic`. **La guarda de `renumberGroupsCanonically` no se toca** — ADR-072 §4 explica por qué levantarla sería el arreglo equivocado. Casos 38-39 en §13.
- [x] 15k. (Hito 10.6, PR 14b — ADR-072 §8) Los tests de estabilidad del valor sintético frente a renumeración, agregado manual, fusión, división y cambio de reglas. Es el conjunto que convierte "la semilla es estable" de afirmación en garantía; ver §14.
- [x] 15l. (Hito 10.7, PR 8 — ADR-061 §2 errata) `gender.ts` consume `normalizeForComparison` de `@anonly/shared` (`Contracts.md` §6) y borra `normalizeForLexicon`, cuyo cuerpo se promovió **verbatim** — misma secuencia NFC → minúsculas → NFD → strip de combinantes → `trim` → colapso de espacios, así que **no hay wrapper y no hay cambio de comportamiento**. Es de-dup puro: `regex-engine` necesitaba la misma normalización y `shared` es el único lugar desde el que los dos motores la alcanzan (P-2). La equivalencia la prueban los tests que ya existen, incluidos los que corren contra el **artefacto commiteado** (ítem 15h): si la normalización cambiara aunque sea en un caso, las claves del léxico dejarían de matchear y esos tests se caen. **Diferible**: no bloquea el Hito 10.7. El guard de iniciales de ADR-069 §3 (`isBlockedInitialsKey`) **no** se promueve — es una regla del léxico de género, no una normalización de texto, y no tiene otro consumidor.
- [x] 15m. (Hito 10.9, PR 2 — ADR-073 §1/§2) `FUZZY_MATCHING_TYPES = { Person, Organization, Address }` como constante del motor, y la guarda en `findMatchingGroup`: el segundo pase corre solo si `occurrence.entityType` está en el set. **No** tocar el pase exacto, ni `levenshtein.ts`, ni el default ni la semántica de `GroupingConfig.similarityThreshold` (§6), ni el dedup por identidad de ADR-038 §3. Caso 40 en §13, siete filas en §14.
- [x] 15n. (Hito 10.9, PR 15 — ADR-076 §1-§4) `replacementValueUserSet` en `InternalGroup` (interno, nunca expuesto — mismo tratamiento que `personGenderUserSet` del ítem 15g, incluido su ciclo de vida en fusión y división); se enciende en `applyGroupUpdate` cuando `patch.replacementValue !== undefined`, incluido `""`. Los **once** call sites de `computeReplacementValue` quedan decididos por la tabla de ADR-076 §4: respetan el flag `renumberGroupsCanonically`, `inferGendersOnFinish`, la rama de `personGender` de `applyGroupUpdate`, `applyGroupMerge`, el remanente de `doApplyGroupSplit` y `dropOccurrences`; lo apagan y recalculan la rama de `replacementMode` de `applyGroupUpdate` y `applyConflictResolve`; `recomputeAllGroupModes` **no necesita mirarlo** porque su `if (effectiveMode === before) continue;` ya es la condición correcta. **La guarda de modo de `renumberGroupsCanonically` no se toca** (ADR-072 §4). Casos 41-42 en §13, diez filas en §14 — una de ellas es la **corrección** del test de ADR-057 §Tests, no una fila nueva.
- [x] 15o. (Hito 10.9, PR 7 — ADR-074 §1/§7) `toOccurrenceRef` propaga `fragments` de la `Occurrence` al `OccurrenceRef`; `buildPlaceholderValue`/la selección de nivel de ADR-057 §4 evalúan el peor caso sobre `fragments ?? [bbox]` de cada member. **No** agregar disparadores de recálculo (ADR-057 §7) ni tocar `bbox`. El PR de `shared` que declara el campo (Hito 10.9 PR 4) es precondición. Caso 43 en §13, dos filas en §14.
- [x] 15p. (Hito 10.10 — ADR-082 §1-§5) `patch.type` en `GroupUpdateRequested`; `changeGroupType` con sus cinco recálculos **en el orden correcto** (índice → modo efectivo → **género** → valor), devolviendo los campos cambiados para que el caller los ponga en `ENTITY_GROUP_UPDATED.changes` — `personGender` incluido, que es el que se escapaba. Los `recordedOccurrences` **NO** siguen al grupo (§3): conservan el tipo del detector, o cada `reanalyze` produce un conflicto espurio del grupo consigo mismo. `applyConflictResolve` (ADR-083 §2) delega en el mismo método en vez de abrir un segundo camino. Casos nuevos en §13, siete filas en §14.
- [x] 15q. (Hito 10.10 — ADR-085 §1-§7) `InternalGroup.absorbedTypes` (consultado en el filtro de candidatos de `findMatchingGroup`, por ocurrencia) + `Session.typeCorrections` (consultado **solo** en `createGroup`, o sea una vez por grupo creado). `createGroup` siembra `absorbedTypes` con los dos tipos, así el mapa no se vuelve a tocar para ese valor. El guard difuso es **simétrico**: mira `occurrence.entityType` **y** el `detectorType` guardado en la corrección — una corrección sobre un valor estructurado no se hereda por parecido a un nombre. Ninguna de las dos piezas se expone. **Dónde NO se consulta** (§6, la parte que se puede hacer mal): ni en `isDuplicateIdentity`, ni en `findOverlapConflict`, ni en `recordOccurrence`. Cinco filas en §14.
- [ ] 16. Escribir `contract.test.ts` con todos los tests contractuales.
- [ ] 17. Escribir `unit.test.ts` con cobertura ≥ 85%.
- [ ] 18. Escribir `edge.test.ts` con todos los casos límite.
- [ ] 19. Escribir `snapshot.test.ts` con grupos de `text-10p.pdf`.
- [ ] 20. Ejecutar `pnpm lint && pnpm typecheck && pnpm test` verde.
- [ ] 21. Verificar `index.ts` exporta solo `GroupingEngine`, tipos, errores.
- [ ] 22. Verificar imports sin dependencias prohibidas.

---

## Algoritmos clave (resumen)

### Matching

```text
para cada Occurrence entrante:
  // candidatos = grupos del mismo entityType, MÁS los que absorbieron ese
  // tipo por una reclasificación del usuario (ADR-085 §1a)
  candidatos = grupos g donde g.type == occurrence.entityType
                            or occurrence.entityType in g.absorbedTypes
  // 1. match exacto — los TRECE tipos
  for g in candidatos:
    if g.aliases contiene occurrence.normalizedValue:
      agregar a g, return
  // 2. match fuzzy — SOLO Person, Organization y Address (ADR-073 §1)
  if occurrence.entityType in FUZZY_MATCHING_TYPES:
    for g in candidatos:
      for alias in g.aliases:
        sim = levenshteinNormalized(occurrence.normalizedValue, alias)
        if sim >= GROUPING_SIMILARITY_THRESHOLD:
          agregar a g como nuevo alias si value difiere, return
  // 3. crear grupo nuevo — el ÚNICO punto donde se consulta la memoria de
  //    reclasificación por documento (ADR-085 §1b/§2)
  tipoEfectivo = session.typeCorrections[occurrence.normalizedValue]
                 // y, solo si occurrence.entityType in FUZZY_MATCHING_TYPES,
                 // un pase difuso sobre las claves del mapa (ADR-085 §3)
                 ?? occurrence.entityType
  crear grupo con type = tipoEfectivo,
                  indexInType = nextIndex(tipoEfectivo),
                  absorbedTypes = { occurrence.entityType, tipoEfectivo }
```

**Memoria de reclasificación (ADR-085)**. Cuando el usuario corrige el tipo de un grupo ("Cambiar categoría" de ADR-082, o elegir el tipo al resolver un conflicto de ADR-083), el motor lo recuerda **por documento y en RAM** con dos piezas de bookkeeping interno, ninguna expuesta:

| Pieza | Dónde vive | Cuándo se consulta | Qué cubre |
|---|---|---|---|
| `InternalGroup.absorbedTypes` | el grupo | filtro de candidatos, **por ocurrencia** (barato: un `Set.has` con cortocircuito) | una ocurrencia **nueva** del mismo valor cae en el grupo corregido en vez de crear uno paralelo |
| `Session.typeCorrections` | la sesión | **solo** en "crear grupo nuevo", o sea una vez por grupo | un grupo borrado por `dropOccurrences` —lo que ocurre al **apagar NER**— se recrea con el tipo corregido |

El guard difuso del mapa es el **mismo** `FUZZY_MATCHING_TYPES` de arriba y se evalúa sobre `occurrence.entityType` (lo que emite el detector), no sobre el tipo destino: el riesgo que ADR-073 identificó vive en el **valor** que se compara.

**Dónde NO se consulta, y es la parte que se puede hacer mal**: ni en el dedup por identidad, ni en `findOverlapConflict`, ni al registrar la ocurrencia. Ahí el `entityType` es la **huella del detector** (ADR-082 §3) y tiene que seguir siendo la cruda. Sobrescribir el tipo de la ocurrencia al entrar —antes del dedup— hace que la ocurrencia re-emitida en un `reanalyze` no matchee su propio registro, entre como nueva, y genere un **conflicto espurio del grupo consigo mismo**. Ver ADR-085 §6.

`FUZZY_MATCHING_TYPES = { Person, Organization, Address }` es una **lista cerrada y explícita**, no una regla derivada (ADR-073 §1): una condición del estilo "los que no tienen `checksum`" volvería a atar el comportamiento a una propiedad que puede cambiar por otra razón, y movería un tipo de un lado al otro en silencio. Son los tres tipos que emite NER, y los únicos donde una diferencia de un carácter puede ser ruido del canal —un OCR que lee `"Pablo R0man"`— en vez de dato. `Custom` queda **afuera**: su valor lo define un patrón del usuario y el motor no tiene base para decidir si un carácter de diferencia es un typo o un identificador distinto.

### Levenshtein normalizado

```text
levenshteinNormalized(a, b) = 1 - levenshtein(a, b) / max(a.length, b.length)
```

Para strings vacíos: si ambos vacíos, sim = 1.0; si uno vacío, sim = 0.0.

### `canonicalValue`

```text
frequency(alias) = count de members con normalizedValue == alias
canonicalValue = argmax_frequency(alias); en empate, argmax_length(alias)
```

### `indexInType`

```text
// Fase incremental (durante la sesión) — índices PROVISIONALES (ADR-028):
nextIndex(type) = (max indexInType entre grupos del tipo) + 1
si no hay grupos del tipo, nextIndex = 1

// Renumeración canónica (una sola vez, en finishSession, antes de GROUPING_FINISHED):
para cada entityType:
  firstPos(g) = min sobre g.members de (pageIndex, bbox.y, bbox.x)  // lexicográfico
  ordenar grupos por firstPos asc; empate: normalizedValue asc
  asignar indexInType = 1..N contiguo
  por cada grupo cuyo índice cambió:
    emitir ENTITY_GROUP_UPDATED (changes incluye "indexInType")
    si mode = placeholder: recalcular replacementValue, emitir GROUP_REPLACEMENT_CHANGED

// Después de la renumeración (estabilidad, sin cambios):
tras eliminar grupo: el índice se saltea (no se reasigna)
tras fusionar A en B: B conserva min(A.index, B.index); A se elimina
tras dividir: el grupo nuevo recibe nextIndex(type)

// Invariante (ADR-028): mismo conjunto de Occurrence ⇒ mismos índices finales,
// sin importar el orden de llegada de los ENTITY_FOUND.
```

### Resolución de modo

```text
function resolveMode(group, rules):
  rules_group = rules.filter(r => r.scope == "group" && r.target.groupId == group.id && r.enabled)
  if rules_group.length > 0: return rules_group.sort(by priority desc)[0].mode
  rules_type = rules.filter(r => r.scope == "type" && r.target.entityType == group.type && r.enabled)
  if rules_type.length > 0: return rules_type.sort(by priority desc)[0].mode
  rules_global = rules.filter(r => r.scope == "global" && r.enabled)
  if rules_global.length > 0: return rules_global.sort(by priority desc)[0].mode
  if group.replacementMode != default: return group.replacementMode  // editado manualmente
  return ReplacementMode.Placeholder
```

### `replacementValue` por modo

| Modo | replacementValue |
|---|---|
| `placeholder` | `[<LABEL> <NN>]` con `NN = pad2(indexInType)`, en uno de **tres niveles de abreviatura** elegidos por grupo (ADR-057; ver el bloque siguiente) |
| `mask` | resolución por grupo (ADR-029): si algún member lleva `Occurrence.maskFormat`, el más frecuente entre los que lo llevan (empate → el del member con primera aparición documental, mismo orden que ADR-028); si ninguno, fallback `MASK_FORMAT_BY_TYPE[type]` (ADR-012; `Plate` → `XX XXX XX` Mercosur) |
| `synthetic` | `synthesize({ type, groupId, seed, indexInType, personGender })` — determinista por **la identidad del grupo**, no por su número (ADR-072 §1); sobre `Person` con género resuelto, el pool de nombres de pila se filtra por ese género (ADR-071 §5) |
| `redact` | `""` |

El sintetizador está en `shared/synthesizer.ts`, exportado desde `@anonly/shared` y declarado en `Contracts.md` §5-§6. **Su único caller es este motor** (`computeReplacementValue`): la versión previa de esta línea decía "delegado a `shared` **o** `export-engine`", y `export-engine` nunca lo usó — corregido por ADR-072 §2.

**Qué hace estable al valor sintético** (ADR-072 §1): la semilla es `EntityGroup.id`, un UUID asignado al crear el grupo y estable de por vida. Consecuencias que no hay que programar, salen de la elección de semilla:

- renumerar en `finishSession` (ADR-028), agregar una entidad a mano (ADR-061) o cambiar una regla **no mueven ningún valor sintético**;
- una **fusión** conserva el valor del grupo que sobrevive, porque conserva su `id`;
- una **división** le da un valor propio al grupo nuevo, que es lo correcto: es otra entidad.

`indexInType` sigue siendo entrada, pero **solo lo leen los tipos cuyo valor lo interpola** — `Custom` (`custom-3`) y el fallback. Ésos siguen dependiendo del número, con la contracara de que un `Custom` renumerado en modo `synthetic` conserva el valor viejo (ADR-072 §3, anotado en `roadmap/Future_Ideas.md`).

**El género no entra a la semilla** (ADR-071 §5): solo elige el array del que sortea `pick`. Por eso un grupo sin género resuelto produce **el mismo valor** que produciría sin el campo, y ningún tipo distinto de `Person` se entera.

### Escalera de abreviaturas del `placeholder` (ADR-057)

Tres niveles, por longitud decreciente. El nivel 2 además colapsa el separador (espacio → guion):

```
nivel 0:  [<LABEL> <NN>]     [PERSONA 01]
nivel 1:  [<ABREV> <NN>]     [PERS 01]
nivel 2:  [<CORTO>-<NN>]     [PRS-01]
```

Tabla canónica por `EntityType` — ratifica y completa ADR-012 §"Formato para `placeholder`", que solo daba 4 ejemplos de los 13 tipos (la ambigüedad que `labels.ts` arrastraba documentada desde su implementación queda cerrada acá):

| `EntityType` | Nivel 0 | Nivel 1 | Nivel 2 |
|---|---|---|---|
| `Person` | `PERSONA` | `PERS` | `PRS` |
| `Organization` | `ORGANIZACION` | `ORGA` | `ORG` |
| `Address` | `DIRECCION` | `DIRE` | `DIR` |
| `DNI` | `DNI` | `DNI` | `DNI` |
| `CUIT` | `CUIT` | `CUIT` | `CUIT` |
| `Phone` | `TELEFONO` | `TELE` | `TEL` |
| `Email` | `EMAIL` | `MAIL` | `EML` |
| `IBAN` | `IBAN` | `IBAN` | `IBAN` |
| `CreditCard` | `TARJETA` | `TARJ` | `TRJ` |
| `Date` | `FECHA` | `FECH` | `FEC` |
| `License` | `MATRICULA` | `MATR` | `MAT` |
| `Plate` | `PATENTE` | `PATE` | `PAT` |
| `Custom` | `CUSTOM` | `CUST` | `CST` |
| `Person` + `personGender: "f"` (ADR-060 §3) | `MUJER` | `MUJER` | `MUJ` |
| `Person` + `personGender: "m"` (ADR-060 §3) | `HOMBRE` | `HOMB` | `HOM` |

**Las columnas repetidas son correctas, no un descuido.** Para `DNI`, `CUIT` e `IBAN` el label ya es una sigla y acortarla más produce tokens ilegibles a cambio de un carácter; para `MUJER` pasa lo mismo con el nivel 1. La selección elige el primero que entra, así que los niveles degenerados se saltean solos, sin ninguna rama especial.

**Selección del nivel** (ADR-057 §4):

```
nivelElegido(group) =
  el primer nivel L ∈ [0, 1, 2] tal que, para TODOS los rectángulos R de
  TODOS los members del grupo — donde los rectángulos de un member son
  `member.fragments ?? [member.bbox]` (ADR-074 §7) —,
  estimateTokenWidth(len(tokenDeNivel_L), R.height) ≤ R.width;
  si ninguno cumple, nivel 2.
```

Reglas que la gobiernan:

- **Se mide por rectángulo pintable, no por ocurrencia** (ADR-074 §7). Un member que cruza un salto de línea lleva `fragments`, y su `bbox` es una envolvente que puede tener el ancho de la página: medir contra ella deja al grupo en nivel 0 aunque su ocurrencia real sea angosta. Se miden **todos** los fragmentos y no solo el que va a llevar el token (el más ancho, ADR-074 §5), porque el nivel es uno solo para todo el grupo y sus members mezclan ocurrencias de una y de varias líneas — es una estimación conservadora, que es lo que esta escalera es.
- **Se elige por el peor caso y se aplica a todo el grupo.** Un grupo con 40 apariciones holgadas y una apretada baja de nivel entero. La alternativa —abreviar por ocurrencia— rompe el invariante de ADR-012 (todas las `Replacement` de un grupo comparten valor) y, peor, haría que el mismo dato apareciera con dos nombres distintos en el mismo documento.
- **`<NN>` no se abrevia nunca.** Es lo único que distingue dos entidades del mismo tipo.
- **El nivel 2 no garantiza que entre.** Si ni `[PRS-01]` cabe, el grupo se queda en nivel 2; quien resuelve es el render (ADR-058 §1, shrink-to-fit con `measureText` real). Esta escalera es una **optimización**, no la garantía.
- **Es una estimación, y no puede ser otra cosa**: este motor no tiene canvas ni debe tenerlo. `estimateTokenWidth` y sus constantes viven en `@anonly/shared` (`Contracts.md` §6) y las comparten Grouping y Render sin duplicarlas (P-1 impide que un motor importe a otro; los dos pueden importar `shared`).
- **Invariante a la escala**: el criterio compara dos magnitudes del mismo bbox, así que el nivel elegido no depende del zoom al que se renderice después.
- **Se recalcula donde ya se recalculaba `replacementValue`** — sin disparadores nuevos —, incluida la renumeración canónica de `finishSession` (ADR-028).
- **La edición manual gana siempre**: un `replacementValue` escrito por el usuario (caso 17) no lo toca la escalera, ni en ese momento ni en un `finishSession` posterior — **ni siquiera si el `indexInType` del grupo cambia en la renumeración**. Eso lo garantiza `replacementValueUserSet` desde ADR-076; hasta entonces la promesa estaba escrita acá y en ADR-057 §7 y el motor la cumplía **por accidente**, gracias a una guarda de ADR-028 que existe para otra cosa. La precedencia completa —qué la respeta, qué la reemplaza y cómo se vuelve al valor automático— está en los casos 41-42.
- **`mask`, `synthetic` y `redact` no participan** (ADR-057 §6): el formato de `mask` *es* la información que transmite, un `synthetic` abreviado deja de ser plausible y `redact` no tiene texto.

**La resolución del label es por grupo, no por tipo** (ADR-057 §3). El acceso directo a `TYPE_LABEL_ES` se reemplaza por `resolveLabelSet(group)`, que hoy es un lookup por `group.type` y desde ADR-060 considera además `personGender`. La indirección existe para eso: sin ella, el género obligaría a reescribir la escalera entera.

---

## Referencias

- `architecture/06_Pipeline.md` §8, §9 (etapas 6 y 7)
- `architecture/03_Data_Model.md` §9 (EntityGroup), §13 (Rule), §15 (Conflict)
- `architecture/04_Event_System.md` §6, §10
- `adr/ADR-011-Grouping-First.md`
- `adr/ADR-012-Replacement-Modes.md`
- `adr/ADR-008-Immutability.md`
- `adr/ADR-028-IndexInType-Renumeracion-Canonica.md` (renumeración canónica, extendida a re-análisis)
- `adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md` (`reopenSession`/`dropOccurrences`/dedup, decisiones de la v1.1.0)
- `core/Orchestrator.md` §2, §6, §13.18-§13.22 (`reanalyze`, quién invoca estos métodos)
