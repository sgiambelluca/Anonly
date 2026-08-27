<!-- CONTEXT: scope=roadmap-pendientes | dependencias=roadmap/MVP.md,roadmap/Hito10.8_Handoff.md,adr/ADR-011-Grouping-First.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-073-Difuso-Solo-Para-Tipos-De-Texto-Libre.md,adr/ADR-074-Una-Entidad-Partida-En-Varias-Lineas.md,adr/ADR-075-Fechas-En-Texto-Y-Tramos-De-Identificadores.md,adr/ADR-076-La-Edicion-Manual-Del-Valor-De-Reemplazo-Gana.md,adr/ADR-087-La-Herramienta-Tiene-Tres-Momentos-No-Cuatro-Paneles.md | audiencia=humanos+IA | fase=post-10.8 (§1, §2, §4, §4bis y §10 adoptados como Hito 10.9 el 2026-08-15, cada uno con su ADR; el diagnóstico original se conserva porque es la medición sobre el documento real) -->

# Pendientes acordados para después del Hito 10.8

> Gaps preexistentes que el humano decidió explícitamente diferir porque **no pertenecen al hito donde aparecieron**. Los §1-§9 salieron de la prueba manual sobre la pericia real durante el Hito 10.8; del §10 en adelante entran hallazgos de otros orígenes, con su procedencia indicada en la entrada. Ninguno es regresión de ningún hito.
>
> Orden **no** significativo a partir del §10: los §1-§9 están ordenados por daño real, y las entradas nuevas se agregan al final para no romper las referencias cruzadas por número que ya existen en otros docs. La severidad de cada una está declarada en su propio texto.
>
> **Estado (2026-08-13)**: el §3 quedó **cerrado dentro del hito** por ADR-067 — se conserva tachado, con el porqué. El resto sigue vigente, y el §2 quedó **medido** sobre la pericia de 5 páginas en la segunda prueba manual.
>
> **Estado (2026-08-14)**: entra el §10, de la planificación del Hito 10.6 (ADR-072).
>
> **Estado (2026-08-21, cuarta tanda)**: entra el **§21**. Su causa raíz está **cerrada** (a pdf.js le faltaba una `CanvasFactory` en el Worker), pero deja **dos cosas abiertas y anotadas ahí**: no hay ningún fixture con imágenes/transparencias —por eso 57 tests en verde convivían con un visor gris para cualquier PDF real— y un fallo de render **no llega a la UI de ninguna forma**, porque el `warn` del motor va a un logger nulo.
>
> **Estado (2026-08-21, tercera tanda)**: entra el **§20**, **ya cerrado**: el documento quedaba inutilizable tras exportar bien, por una transición de stage que se guardaba pero no se emitía. Es un defecto del Core anterior al rediseño; se anota por el rastro de cómo apareció.
>
> **Estado (2026-08-21, segunda tanda)**: entra el **§19**, y es **la única regresión de todo el documento**: ADR-087 §2 retiró `SideBySideViewer`, que cargaba la única conducta responsive de la app, sin escribir el reemplazo. Necesita una decisión de producto (qué ancho mínimo se soporta), no de implementación.
>
> **Estado (2026-08-21)**: entran el **§17** (tokens de reemplazo pisándose en el preview) y el **§18** (ruido de detección sin distinguir de los aciertos), los dos de la prueba manual del rediseño de UX (**ADR-087**). Ninguno es regresión de ese rediseño: el §17 se vuelve más visible porque el visor pasó a ocupar todo el ancho, y el §18 está anotado en ADR-087 "Fuera del alcance" §7 — acá va con el detalle medido.
>
> **Estado (2026-08-15) — cinco entradas dejan de ser pendientes**: el humano tomó los **§1, §2, §4, §4bis y §10** como **Hito 10.9** (`MVP.md` §4). Cada una tiene ahora su ADR y su propagación a specs: §1 → **ADR-073**, §2 → **ADR-074**, §4 y §4bis → **ADR-075** (juntos, porque tocan la misma tabla de patrones y el propio §4bis lo pedía), §10 → **ADR-076**. Se conservan acá, con el diagnóstico original intacto y una nota al pie de cada una: son la medición sobre el documento real, y el ADR se escribió contra ellas. Siguen **abiertos** el §5 (recall de NER, que no es un bug), el §6 (marca de agua, sin construir por decisión), el §7 (solapamiento, ADR-063 §6), el §8 (rotación de página, sin datos para calibrar) y el §9 (variantes de ops de imagen).

---

## 1. Matching difuso fusiona entidades numéricas distintas — **el más grave** · *adoptado: ADR-073, Hito 10.9 PR 2*

**Qué pasa.** Dos fechas distintas (`1/7/2026` y `7/7/2026`) salen como un solo grupo, `Fecha 01`.

**Causa, verificada.** `findMatchingGroup` (`grouping-engine/src/grouping.engine.ts`) tiene un segundo pase por **Levenshtein normalizado ≥ 0.88** cuando ningún grupo tiene el valor exacto. La fórmula es `1 - distancia / longitud` (`levenshtein.ts`). Las dos fechas normalizan a `01/07/2026` y `07/07/2026`: 10 caracteres, difieren en uno.

```
1 - 1/10 = 0.90  ≥  0.88  →  mismo grupo
```

**No es solo la fecha.** La misma cuenta, por tipo:

| Tipo | Largo normalizado | Similitud con 1 dígito distinto | ¿Se fusionan? |
|---|---|---|---|
| CUIT | 11 | 0.909 | **sí** |
| Tarjeta de crédito | 16 | 0.937 | **sí** |
| Teléfono | 10 | 0.900 | **sí** |
| Fecha | 10 | 0.900 | **sí** |
| DNI | 8 | 0.875 | no — **por 0,005** |

Dos CUIT distintos que difieran en un dígito se fusionan en un grupo: el documento anonimizado afirma que dos empresas distintas son la misma. En una pericia judicial eso **distorsiona la evidencia**, no es cosmético. Y el DNI se salva por casualidad, no por diseño.

**Dirección de arreglo.** El pase difuso debe correr **solo para tipos de texto libre** (Persona, Organización, Dirección), donde tolera un OCR imperfecto ("Pablo Rornan"), y **nunca** para los estructurados, donde un carácter distinto significa otra entidad. Cambia semántica documentada de Grouping → **ADR propio**.

---

## 2. Una entidad partida en dos líneas tapa las dos líneas enteras · *adoptado: ADR-074, Hito 10.9 PRs 3-11*

**Qué pasa.** Con "Pablo Roman" al final de una línea y "Fortes" al inicio de la siguiente, la censura tapa **ambas líneas completas**, destruyendo texto ajeno.

**Causa, verificada.** `mapSpanToWords` (`regex-engine/src/regex.engine.ts`, ~línea 185) calcula un **único** bbox como min/max sobre las palabras del match:

```
minX = min(word.bbox.x)   maxX = max(word.bbox.x + width)
minY = min(word.bbox.y)   maxY = max(word.bbox.y + height)
```

Con palabras en dos líneas, esa unión es un rectángulo que abarca de la izquierda de una a la derecha de la otra, y todo el alto de las dos.

**Por qué no tiene arreglo local.** `Occurrence.bbox` es **un** `BoundingBox`. Expresar "un rectángulo por línea" es cambio de contrato: toca `shared`, `regex-engine`, `grouping-engine` y `render-engine` → **ADR propio**.

Es la misma clase de falla que ADR-063 —censura que cubre lo que no debe— por otra causa.

**Medido (2026-08-13, segunda prueba manual sobre la pericia de 5 páginas)**. Página 2, entidad `Pablo Román Fortes` detectada por NER: `Pablo` cierra una línea (`x = 524,4`) y `Román Fortes,` abre la siguiente (`x = 14,0`). La unión da **557,2 × 18,2 pt** — prácticamente el ancho útil de la página, dos líneas de alto. En el panel anonimizado es una barra negra que atraviesa el documento.

Confirma que **tapa de más, nunca de menos**: no hay fuga, pero destruye contenido no sensible. Aplica igual al `mapSpanToWords` de `ner-engine`, que es la copia adaptada del de `regex-engine`.

---

## 3. ~~Orden de lectura para texto vertical~~ — **CERRADO en el Hito 10.8 (ADR-067)**

> **Resuelto, no diferido.** Este ítem se escribió cuando el orden de lectura parecía requerir tocar tres motores. **ADR-067** lo cerró dentro del propio Hito 10.8, con alcance de **un** motor. Se conserva la entrada para que quien venga no vuelva a plantearlo como pendiente.

El diagnóstico original era correcto: `sortWordsByReadingOrder` ordenaba por `y` asc, lo que **invierte** un run de texto a 90° y lo intercala con los demás; un nombre multi-palabra dentro de una firma vertical quedaba irreconocible para NER (`Albarracin, Rocio de los Milagros` llegaba como `… Milagros … los … de … Rocio … Albarracin,`).

Lo que estaba mal era el **costo estimado**. El argumento de ADR-063 §4 —"cambia un invariante compartido con `ocr-engine`"— dejó de valer por dos hechos que no existían cuando se escribió:

1. `BoundingBox` ya tiene `rotation` (ADR-066 §6), o sea que hay una señal en el dato para distinguir un word vertical sin re-derivarlo de la matriz.
2. **`ocr-engine` nunca puebla `rotation`**: Tesseract no reporta orientación por palabra y el kernel no la infiere. Un orden que se ramifica por ese campo no lo alcanza — cero cambios en ese motor.

Ver `adr/ADR-067-Orden-De-Lectura-Por-Runs-Rotados.md` y `MVP.md` §4, Hito 10.8 paso 4.

---

## 4. Fechas escritas en texto · *adoptado: ADR-075 §1, Hito 10.9 PR 13*

`"Quilmes, 07 de julio de 2026"` está en el content stream de la página 1 y **no se detecta**: `date-ar` es `/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/`, solo numéricas.

**Arreglo.** Un patrón `/\b\d{1,2}\s+de\s+(enero|febrero|…)\s+de\s+\d{4}\b/i` con un normalizador que lo lleve a `dd/mm/yyyy`, para que agrupe junto con la fecha numérica equivalente. Media hora de código. La cabecera de la tabla de patrones (`patterns/default-ar.ts`) exige **ADR** para cualquier cambio de esa tabla.

---

## 4bis. Los patrones numéricos matchean partes del número de expediente · *adoptado: ADR-075 §2, Hito 10.9 PR 13*

Verificado sobre la pericia real: `PP-13-00-027653-24/00` produce una ocurrencia **`[PHONE] "00-027653"`**. Los patrones de `default-ar.ts` no tienen forma de distinguir un tramo de número de causa de un teléfono.

Es un falso positivo benigno en cuanto a fuga (tapa de más, no de menos), pero ensucia la lista de entidades y probablemente explique el "aparecen tres fechas" que reportó el humano. Conviene revisarlo junto con el punto 4, que toca la misma tabla y ya requiere ADR.

---

## 5. Recall de NER sobre nombres

No se detecta "FORTES Pablo Roman" (apellido primero, mayúsculas) ni se unifica con "Dr. Pablo Roman Fortes" de otra página.

**No es un bug.** `MVP.md` §5 declara el recall del NER como métrica **informativa** hasta v1.0, y el roadmap asume que se escapan entidades. La red de contención está diseñada y **sin implementar**: es el **Hito 10.7** (ADR-061 — agregado manual, selección sobre el visor, buscador).

**Recomendación**: implementar 10.7 rinde más que perseguir el recall del modelo. No mejora la detección, pero le da al usuario la herramienta para tapar lo que se escapa.

---

## 6. Marca de agua detectada de forma inconsistente

Se detecta en 2 de 5 páginas siendo el mismo string. El humano decidió **no construir nada**: si no la quiere tapar, deselecciona el grupo.

Queda anotado porque es **síntoma del punto 3**, no un problema propio: el mismo run cae entre vecinos distintos en cada página según el orden de lectura.

---

## 7. Riesgo latente: censura sobre texto superpuesto

Registrado en **ADR-063 §6**, sin mitigación por decisión explícita del humano. Un bbox correcto sobre un sello que pisa el cuerpo del texto tapa lo que hay debajo — medido en 10-14 fragmentos por página en la pericia real. Hoy **inactivo**: nada dentro de ese sello se detecta.

La heurística obvia ("si se repite en todas las páginas, ignoralo") es **insegura**: un pie de página con el nombre de un fiscal cumple la misma condición y sí hay que taparlo.

---

## 8. Discrepancia abierta: rotación a nivel de página

Registrada en **ADR-063 §7**. `Render_Engine.md` §13 caso 15 afirma que "los bbox están en coords de página ya rotada (lo garantiza PDF Engine)"; el motor **no** lo garantiza — nunca aplica `viewport.transform`. Para un PDF con `/Rotate ≠ 0` las coordenadas saldrían mal.

Sin datos para calibrar: las cinco páginas medidas tienen `rotate = 0`. Requiere medición sobre un PDF con `/Rotate ≠ 0` **antes** de escribir el ADR.

---

## 9. Variantes de ops de imagen fuera de alcance

Registrado en la errata de **ADR-065 §1**. La compuerta 1 maneja `paintImageXObject`, `paintImageMaskXObject` y `paintInlineImageXObject`, y **no** las variantes agrupadas/repetidas del optimizador de pdf.js (`paintImageXObjectRepeat`, `paintImageMaskXObjectGroup`, `paintImageMaskXObjectRepeat`, `paintInlineImageXObjectGroup`, `paintSolidColorImageMask`).

Sus argumentos tienen otra forma, así que soportarlas es un cálculo de rectángulo por variante. El modo de falla es un **falso negativo idéntico al comportamiento previo a ADR-065**: cobertura incompleta, no regresión. Cerrar solo si un documento real lo dispara.

---

## 10. Una edición manual de `replacementValue` se pierde si el grupo se renumera — **el spec promete lo contrario** · *adoptado: ADR-076, Hito 10.9 PR 15*

> **Procedencia**: planificación del Hito 10.6 (ADR-072, 2026-08-14). Apareció al analizar por qué `renumberGroupsCanonically` no recalcula el valor en modo `synthetic`. **No es del Hito 10.6** —no tiene nada que ver con el género ni con el sintetizador— y se difiere por eso, no por costo.
>
> **Severidad**: alta. No es cobertura incompleta ni un falso positivo benigno: destruye en silencio un dato que el usuario escribió a mano.

**Qué pasa.** El usuario edita el `replacementValue` de un grupo (escribe `[P1]` en vez de `[PERSONA 03]`). Si ese grupo cambia de `indexInType` en la renumeración canónica de un `finishSession` posterior, su texto se reemplaza por el token calculado. Sin aviso y sin forma de recuperarlo.

**Hay más de un camino, y el segundo se encontró después.** Este ítem se escribió sobre `renumberGroupsCanonically`, pero **`inferGendersOnFinish` hace lo mismo**: recalcula sin preguntar quién escribió el valor. Repro (revisión de la branch del Hito 10.6, 2026-08-14): grupo `Person` con `canonicalValue` "Andrea Ruiz" (sin determinar) → el usuario edita `replacementValue` a mano a `[P1]` → llegan dos ocurrencias "Julia Ruiz" con el mismo `normalizedValue` y el `canonicalValue` evoluciona **por frecuencia de alias**, que no es ninguno de los tres disparadores de inferencia inmediata → `finishSession` infiere `f` y pisa `[P1]` con `[MUJER 01]`. La dirección de arreglo de abajo ya lo cubre —el flag lo consultan **todos** los puntos de recálculo—, pero el diagnóstico tiene que nombrar los dos caminos o el que lo implemente va a tapar solo uno.

**Causa, verificada.** `renumberGroupsCanonically` (`grouping-engine/src/grouping.engine.ts`) tiene dos guardas anidadas y ninguna pregunta quién escribió el valor:

```ts
if (newIndex === group.indexInType) return;              // ADR-028
…
if (group.replacementMode === ReplacementMode.Placeholder) {
  group.replacementValue = computeReplacementValue(…);   // pisa la edición manual
}
```

La cabecera del propio motor (nota 12) ya lo dice: *"No hay tracking de 'este valor fue editado a mano' más allá de ese guard heredado"*. O sea que la edición sobrevive **por accidente**, solo cuando el índice no se mueve.

**Por qué es un incumplimiento y no una limitación.** ADR-057 §7 lo promete en negrita —*"**La edición manual gana siempre.** … la escalera no lo toca — ni en ese momento ni en un `finishSession` posterior"*— y `Grouping_Engine.md` §13 caso 30 lo repite. El código no lo cumple. **Hay que cerrar la brecha en una dirección o en la otra**: implementar la promesa, o corregir los dos docs para que digan lo que el motor hace.

**El test que lo cubre no puede verlo.** `ADR-057 §Tests` pide "un `replacementValue` editado a mano sobrevive a `finishSession`", y ese test pasa porque en su escenario el índice **no** cambia — la guarda de afuera corta antes de llegar a la de adentro. Es la misma forma de agujero que ADR-069 Contexto §3 documentó para el léxico: verde sin ejercitar la condición que dispara el defecto.

**Por qué importa más de lo que parece.** Editar el `replacementValue` a mano es la salida que ADR-058 §4 y ADR-062 le ofrecen al usuario cuando se enciende la marca de reemplazo degradado. El remedio documentado para un token roto se deshace solo. Y el **Hito 10.7** lo agrava: ADR-061 renumera cada vez que se agrega una entidad a mano, así que la condición pasa de rara a rutinaria.

**Dirección de arreglo.** `InternalGroup` gana un `replacementValueUserSet: boolean` — bookkeeping interno nunca expuesto, exactamente el patrón que ADR-069 §5 ya usa con `personGenderUserSet` y por el mismo motivo. Se enciende en `applyGroupUpdate` con `patch.replacementValue` presente y lo consultan **todos** los puntos de recálculo.

**Por qué necesita ADR propio.** El alcance no es la guarda: son los seis o siete sitios que recalculan `replacementValue`, o sea la precedencia completa del campo. Y obliga a contestar lo que ni ADR-057 §7 ni ADR-028 contestan: ¿la edición manual sobrevive también a un cambio de modo? ¿A un re-análisis que le suma members al grupo? ¿A una fusión? Hasta que eso esté decidido, no hay implementación posible sin improvisar.

---

## 11. Tres de los cuatro `ConflictReason` no llegan a la UI

> **Procedencia**: cierre de las observaciones del Hito 10 (2026-08-20), al implementar ADR-083. **Severidad: baja**, y medida — ver abajo.
>
> **Decisión del humano (2026-08-20): se deja como está, anotado.**

`Overlap`, `Disagree` y `LowConfidence` nacen `resolved: true` (el motor ya eligió ganador y descartó al perdedor); `EntityGroupItem` solo muestra el ⚠ para los **no** resueltos. Así que el único conflicto visible es `AmbiguousCanonical`, cuyos candidatos comparten el tipo del grupo — y por lo tanto no ofrece los radios de ADR-083 §5, solo "Descartar".

Consecuencia: **el flujo de elección de tipo de ADR-083 no tiene puerta de entrada**, aunque el motor lo implementa bien.

**Por qué es baja**: se midieron **0** conflictos de `Overlap`/`Disagree` en un documento de 4 páginas con NER y Regex sobre texto realista; hubo que fabricar un `AmbiguousCanonical` para ver un solo ⚠. Y "Cambiar categoría" (ADR-082 §6) ya cubre el valor práctico: corregir el tipo de cualquier grupo, con o sin conflicto.

El análisis completo y las tres salidas posibles están en **ADR-083 §8**. Revisitar si un documento real produce `Disagree`.

---

## 12. Sin evento de confirmación/rechazo de reglas

> **Procedencia**: observación del PR9 del Hito 10, ratificada en el barrido de 2026-08-19 (§6.1 punto E del plan).
>
> **Decisión del humano (2026-08-20): no se desarrolla ahora.** Anotado.

`core-adapter/actions.ts` muta `rules.store` directamente **además** de emitir el evento al bus, porque los tres `RULE_*` son estrictamente UI→Grouping y no hay evento de vuelta. Si Grouping alguna vez rechazara una regla, el store divergiría del Core en silencio: no hay nada con qué reconciliar.

**Hoy es teórico**: Grouping **nunca rechaza una regla**. El riesgo se activa el día que valide algo — un patrón inválido escrito por el usuario, una colisión de prioridad.

**Cuándo hacerlo**: no ahora, y no como ADR aislado. Lo correcto es que **el PR que agregue la primera validación de reglas traiga el evento de vuelta con él**; escribirlo antes es diseñar contra un requisito que no existe. Requiere ADR por ser un evento nuevo en `04_Event_System.md` §6/§10.

---

## 13. Tres observaciones del Hito 10 que siguen necesitando ADR

> **Procedencia**: barrido de `Hito10_Observaciones_Revision.md` (2026-08-19), §6 del plan. De las trece que necesitaban ADR, el humano tomó nueve; el §12 de arriba es la décima. Estas tres quedan.

1. **Retener las ocurrencias perdedoras de un conflicto.** Hoy `if (!newWins) return;` las descarta sin registrarlas. Para que "usar la otra detección" signifique quedarse con **su span** —y no solo con su tipo, que es lo que ADR-083 ya hace— Grouping tendría que retener datos que hoy tira, y existir una operación de reasignación que no existe. Caro, y sin demanda: más aún dado el §11 de arriba.

2. **`OccurrenceRef.value`.** La mitad útil de "ver ocurrencias" la resolvió ADR-084 reusando el buscador. Lo que falta es el texto literal **por ocurrencia**, que arrastra la decisión de privacidad de `08_Security_Model.md` §7 (prohíbe loguear `Occurrence.value`). `EntityGroup.aliases` ya cubre "qué variantes de texto hay en este grupo".

3. **pdf.js degrada a "fake worker" dentro de todo Web Worker.** `PDFWorker._initialize` referencia `window`, que no existe en un Worker, así que el parser corre en el mismo hilo que rasteriza. **Solo cuesta rendimiento.** El único workaround conocido es un monkey-patch de `window` sobre una librería de terceros. **Antes de gastar el ADR, chequear si pdf.js 5.x lo arregló upstream** — sería gratis.

---

## 14. Cerrado el 2026-08-20: la marca de reemplazo degradado (ADR-062)

> **Procedencia**: era el último pendiente que quedaba de ADR-058/ADR-062 y el complemento natural del aviso de longitud que ADR-076 metió en `EditReplacementDialog`.

**Qué estaba pasando.** ADR-062 estaba **completamente especificado** —`Contracts.md` §`PreviewUpdated`, `Components.md` §3.3 con sus tres reglas de consumo, `UX_Guidelines.md` §3.3— y **nada de eso existía en el código**. El kernel de Render calculaba el veredicto (`fitted.finalSizePx / fitted.naturalSizePx < DEGRADED_FONT_RATIO`), lo usaba para pintar un recuadro de aviso **solo en modo `preview`**, y después lo tiraba. El comentario del kernel lo decía en voz alta: "ADR-062 dejó la marca accionable del árbol fuera de este hito".

El resultado práctico: el reemplazo se encogía **en silencio**. El usuario escribía un texto largo, Render lo achicaba hasta que entrara, y se enteraba abriendo el PDF exportado y haciendo zoom página por página — que es exactamente lo que `UX_Guidelines.md` §3.3 describe como el motivo de existir de la marca.

**Qué se implementó, de punta a punta.**

1. `KernelRenderResult.degraded` — el kernel devuelve el veredicto en vez de descartarlo.
2. `InternalCacheEntry.degraded` en `render.engine.ts`. **Esta es la parte que se rompe sola si alguien la "simplifica"**: `emitPreviewUpdated` corre también en los **cache hits**, así que sin guardar el veredicto en la entrada del cache, cada hit emitiría `[]` y borraría la marca. Es literalmente la advertencia de ADR-062 §2.
3. `PreviewUpdated.degraded?: ReadonlyArray<Annotation>` (ya estaba en `Contracts.md`; ahora está en `events.ts`).
4. `degraded.store.ts` — la conversión de "veredicto por página" a "marca por grupo", con las tres reglas de ADR-062 §2/§3 y un test por cada una, los tres **falsificados** contra la implementación ingenua correspondiente.
5. `DegradedBadge.tsx` + `degradedMessage.ts` en el árbol de entidades, con las tres salidas de `Components.md` §3.3 (acortar el texto, pasar a `redact`, deshabilitar).
6. `closeDocument` resetea el store: el veredicto es del documento abierto.

**La decisión de redacción, que es la mitad del valor.** El pedido explícito fue que el aviso "de después" lo entienda alguien que **no sabe qué es un token**. Así que el texto no dice token, ni placeholder, ni bbox, ni degradado, ni umbral: dice *"En la página 3, el texto que reemplaza a «Juan Pérez» no entraba en el espacio disponible y hubo que achicarlo. Puede quedar difícil de leer en el documento final."*, más una línea que aclara que **el dato sigue oculto** —esto es legibilidad, no privacidad—, que es la duda que la palabra "degradado" provoca y no contesta. Las páginas se cuentan desde 1. `describePages` vive en un `.ts` aparte justamente para poder testear eso (`environment: node`, sin tests de render), y uno de sus tests afirma que el texto no filtra jerga.

Con esto, las dos mitades del aviso están: `EditReplacementDialog` avisa **antes** ("puede no entrar", estimado sin `measureText`), y esta marca avisa **después**, con la medición real de Render.

## 15. Cerrado el 2026-08-20: `role="menu"` sin la navegación que promete

`GroupContextMenu` es un disclosure hecho a mano (no hay `@radix-ui/react-dropdown-menu` en el proyecto; agregarlo requiere ADR, P-9) y anunciaba `role="menu"` + `role="menuitem"`. Ese rol es un **contrato con el lector de pantalla**: promete navegación por flechas, Home/End y foco gestionado con un solo tab stop. Nada de eso está implementado — los items se recorren con Tab.

Un rol prometido y no cumplido es peor que no anunciar nada: deja al usuario de teclado apretando flechas contra un panel que no responde. Ahora es `role="group"` con `aria-label`, y los items son botones: se comportan exactamente como el lector anuncia. Si algún día entra Radix, trae el rol **y** el manejo de foco juntos, que es la única forma correcta de tener el primero.

---

## 16. ~~NECESITA ADR~~ **DECIDIDO (ADR-086)** — el detector de degradación casi nunca se dispara en texto corriente

> **Cerrado el 2026-08-20 por `adr/ADR-086-El-Detector-De-Degradacion-Mide-El-Ancho.md`.** El humano eligió las opciones **1 y 3** de las tres que este punto dejaba abiertas: medir la compresión horizontal, y que el piso de dibujo escale con el render. La 2 (quitarle el piso a `naturalSizePx`) no queda descartada sino **absorbida**: bajo el criterio nuevo la referencia no se dibuja nunca, así que el piso ahí no tiene razón de existir.
>
> Lo que el ADR agregó y este punto no tenía: el producto de las dos compresiones **se simplifica exactamente** a `anchoDisponible / anchoNatural` (el tamaño final se cancela), así que no son dos mediciones sino una; la invariancia resultante es **exacta**, verificada a seis decimales sobre seis escalas; y `DEGRADED_FONT_RATIO` **baja a 0,5**, porque con 0,6 el criterio nuevo marcaría placeholders normales en cajas apretadas (`[PERSONA 01]` da 0,579) — sobre-marcar erosiona la única señal que el usuario tiene.
>
> Lo que sigue abajo es el diagnóstico original, conservado como registro de cómo se encontró.

### Diagnóstico original

> **Procedencia**: verificación en navegador de la marca del §14, el 2026-08-20. La marca funciona; lo que falla es **la señal que consume**. Encontrado midiendo, no leyendo.

**Qué se verificó.** Con la marca ya cableada, se instrumentó `PREVIEW_UPDATED` en el navegador con un documento real de 4 páginas. El campo `degraded` **llega bien** en cada evento (`kind: "anonymized"` y también `"original"`, que confirma para qué existe la guarda de ADR-062 §3). Después se editó a mano el reemplazo de un grupo a un texto de 68 caracteres sobre una ocurrencia de ~18. El panel anonimizado lo dibujó como una **mancha ilegible**, el aviso "de antes" del `EditReplacementDialog` avisó correctamente… y `degraded` llegó **vacío**. La marca no se encendió, y tenía razón en no encenderse: el veredicto que le llega dice que no hay nada degradado.

**Por qué.** El criterio de `Contracts.md` §6 es `finalSizePx / naturalSizePx < DEGRADED_FONT_RATIO` (0.6), y los dos términos salen de `fitReplacementFontSized`:

```
naturalSizePx = max(REPLACEMENT_MIN_FONT_PX, round(boxHeight * 0.7))   // piso = 8px
finalSizePx   = ese valor, bajando de a 1px MIENTRAS size > REPLACEMENT_MIN_FONT_PX
```

Los dos términos chocan contra **el mismo piso de 8px**. Cuando la caja es chica, `naturalSizePx` ya nace clavado en 8 y el bucle no puede bajar ni un píxel: `finalSizePx === naturalSizePx`, **ratio 1.00 por construcción**, sin importar cuán largo sea el texto. Medido sobre `fitReplacementFontSized` con el mismo texto de 68 caracteres:

| `boxHeight` (px ya escalados) | natural | final | ratio | ¿degradado? |
|---|---|---|---|---|
| 10 | 8 | 8 | 1.00 | no |
| 12 | 8 | 8 | 1.00 | no |
| 14 | 10 | 8 | 0.80 | no |
| 16 | 11 | 8 | 0.73 | no |
| 20 | 14 | 8 | 0.57 | **sí** |
| 24 | 17 | 8 | 0.47 | **sí** |

El umbral solo es alcanzable con `boxHeight ≳ 20px`, o sea **texto de título**. Una línea de cuerpo de documento —10 a 14px— es estructuralmente incapaz de dar un veredicto de degradado. Y sin embargo se ve ilegible: el encogido que la arruina no es el de la fuente, es el **squeeze horizontal de `fillText(..., maxWidth)`**, que es la red de seguridad de ADR-058 §1 para que el token no se derrame… y que **el cociente no observa en absoluto**. El detector mide la única de las dos compresiones que en cuerpo de texto no ocurre.

**El corolario más incómodo: la invariancia de escala documentada es falsa cerca del piso.** El comentario del kernel (`kernel.ts`, en el `if` del veredicto) y ADR-062 §6 afirman que el cociente es invariante a la escala, y de ahí sale la conclusión de que lo que se ve en el preview vale para el PDF exportado. Pero el piso de 8px es una **constante absoluta que no escala**, mientras que `boxHeight` sí. Misma página, mismo texto, misma caja de 12px:

| escala de render | natural | final | ratio | ¿degradado? |
|---|---|---|---|---|
| 1 | 8 | 8 | 1.00 | no |
| 1.5 | 13 | 8 | 0.62 | no |
| 2 | 17 | 8 | 0.47 | **sí** |
| 3 | 25 | 8 | 0.32 | **sí** |

O sea: la misma ocurrencia se declara sana o degradada **según a qué zoom se la mire**. El test de invariancia de `unit.test.ts` pasa porque usa cajas grandes, lejos del piso — es exactamente el régimen donde la invariancia sí vale, y el único que se probó.

**Por qué necesita ADR y no un parche.** El criterio está en `Contracts.md` §6 y `DEGRADED_FONT_RATIO` es público: cambiarlo es cambiar un contrato (R-2/R-19). Además hay que **elegir** entre opciones que no son equivalentes:

1. **Medir el squeeze horizontal**, no el vertical: comparar `measureWidth(font, texto)` contra el ancho disponible y degradar cuando el texto haya que comprimirlo por debajo de una fracción. Es lo que de verdad arruina la legibilidad, y no tiene piso absoluto contra el que chocar.
2. **Quitarle el piso a `naturalSizePx`** (que el piso aplique solo a `finalSizePx`). Una línea, arregla la tabla 1 — pero **no** arregla la invariancia de escala, porque el piso sigue estando en el denominador de hecho.
3. **Escalar `REPLACEMENT_MIN_FONT_PX` con la escala de render.** Arregla la invariancia, pero toca cómo se dibuja el reemplazo, no solo cómo se lo juzga — es el cambio de mayor alcance.

La 1 y la 3 son complementarias y probablemente sean las dos que hacen falta. Ninguna se decide desde un PR de implementación.

**Mientras tanto, qué hay.** La marca del §14 está completa y correcta de punta a punta: cuando el veredicto dice que hay degradación, se muestra, se explica en castellano llano y ofrece las tres salidas. Se enciende hoy en títulos y en previews a escala ≥ 2. Lo que no cubre es el caso más común, y **el aviso "de antes" del `EditReplacementDialog` sí lo cubre** —`estimateReplacementFit` mide anchos, que es justamente lo que al detector le falta—, así que el usuario que edita a mano no queda a ciegas. El que llega a un reemplazo largo por la escalera automática de ADR-057, sí.

---

## 17. Los tokens de reemplazo se pisan entre sí en el preview anonimizado — **más visible desde ADR-087**

**Procedencia**: prueba manual del rediseño de UX (ADR-087), 2026-08-21, sobre `text-10p.pdf`.

**Qué se ve.** El panel anonimizado dibuja los tokens superpuestos, con tamaños dispares y huecos, sobre la primera línea de la página 0 del fixture:

```
[HOMBRE 01] ; vive en [HOMBRE 01] 1234, DNI : [DNI 01]   CUIT  [TELEFONO 01] , teléfono +
1234-5678, email ju.    [EMAIL 01],
```

Hay al menos tres síntomas distintos ahí, y conviene no confundirlos:

1. **`[HOMBRE 01]` aparece dos veces**, la segunda donde iba `Belgrano` (una `Address`). O el bbox de una ocurrencia está mal atribuido, o dos `Replacement` distintos comparten rectángulo de pintado.
2. **Los tokens se solapan con el texto que queda**: `[DNI 01]` encima de `1234`, `[TELEFONO 01]` donde iba el CUIT.
3. **Tamaños inconsistentes** entre tokens de la misma línea, que es el shrink-to-fit de ADR-058 §1 actuando de a uno.

**Por qué no es simplemente el §16.** El §16 es sobre el **veredicto** (cuándo se enciende la marca de degradado). Esto es sobre el **dibujo**: los tokens no solo quedan chicos, quedan en el lugar equivocado. Puede tener que ver con el repintado de línea de ADR-058 §1 —que es conservador por diseño y sobre esta línea probablemente no se activa— o con la atribución de bboxes de ADR-074 (entidad partida en varias líneas: el wrap a 95 caracteres de `generate.ts` corta la página 0 justo adentro del teléfono, `tests/fixtures/README.md` lo documenta).

**Por qué sube de prioridad ahora.** No es una regresión de ADR-087 — el comportamiento es el mismo de antes. Pero hasta el rediseño el preview anonimizado vivía en media pantalla, compartida con el original; desde ADR-087 §2 ocupa **todo el ancho** y es la única cosa que el usuario mira cuando conmuta el toggle. Lo que antes era un detalle borroso ahora es lo primero que se ve, y un usuario que no distingue "fallback documentado" de "bug" va a concluir que la herramienta rompió su documento.

**Qué haría falta.** Reproducirlo con un caso mínimo (una línea, dos entidades adyacentes) y decidir si el defecto está en la atribución de bbox, en el repintado, o en los dos. Es trabajo de `render-engine` y necesita medición antes que decisión.

---

## 18. El ruido de detección se muestra con el mismo peso visual que los aciertos

**Procedencia**: auditoría de UI contra las heurísticas de Nielsen (ADR-087, "Fuera del alcance" §7), 2026-08-21. Se anota acá con el detalle medido.

**Qué pasa.** Sobre `text-10p.pdf`, el árbol muestra estas dos filas junto a las correctas, indistinguibles de ellas:

| Fila | Qué es en realidad |
|---|---|
| `Teléfonos (1) → 20-12345678` | Falso positivo: son los diez primeros dígitos del **CUIT rechazado** por checksum, matcheando `phone-mobile-ar`. Ya documentado en `tests/fixtures/README.md` y en `scenario-8-ner-disabled.spec.ts`. |
| `Organizaciones (2) → DNI` | Error de NER: clasificó la **sigla "DNI"** como organización. |

Las dos tienen checkbox marcado, cuentan para el total de "N datos encontrados", y se exportarían anonimizadas si el usuario no las revisa una por una.

**Por qué importa.** El árbol es la superficie donde el usuario decide qué se anonimiza. Si el ruido y los aciertos se ven igual, la única forma de encontrar el ruido es leer las N filas — que es exactamente el trabajo que la herramienta existe para ahorrar. En un expediente con cientos de entidades, nadie lo hace.

**El dato existe y no se muestra.** `Occurrence.confidence` viaja hasta el conflicto (`ADR-083 §6` decidió **no imprimirlo** ahí, y con razón: en un conflicto la confidence ordena las opciones pero no es lenguaje del usuario). Eso no resuelve el caso de arriba, donde **no hay conflicto**: hay una detección única, con confidence baja, presentada como cualquier otra.

**Qué NO hacer**, porque ya está decidido: mostrar un número de confidence en la fila. ADR-083 §6 lo descartó como vocabulario de implementación, y ese criterio sigue valiendo.

**Direcciones posibles**, ninguna elegida — necesita ADR:

1. **Agrupar el ruido aparte**: una sección "Revisar" al final del árbol con las detecciones por debajo de un umbral, colapsada por defecto y **deshabilitadas por default** (invierte UX-7 solo para ese conjunto).
2. **Marca por fila**, del mismo tipo que la de degradado (§14): discreta, con umbral, y con la salida a mano (deshabilitar o cambiar categoría, que ya existen).
3. **No tocar la UI y subir los umbrales de los patrones** — resuelve el falso positivo del teléfono pero no el error de NER, y arriesga recall.

La 1 y la 2 no son excluyentes. Lo que hay que decidir primero es **de dónde sale el umbral**, porque hoy `EntityGroup` no expone confidence: es de `Occurrence`, y un grupo tiene varias.

---

## 19. Cerrado el 2026-08-22: el layout no tenía estrategia responsive — **regresión introducida por ADR-087 §2**

> **Cerrado.** Decisión del humano: **cajón + aviso**. Por debajo de 1024 px la barra lateral pasa a
> abrirse encima del visor a pedido; por debajo de 640 px, un aviso. La decisión y su porqué viven
> ahora en `ui/UX_Guidelines.md` §2.1; el umbral y los tres modos, en
> `components/screens/layoutMode.ts`, con tests. Se descartó la opción 3 de abajo (declarar mínimo
> y avisar, a secas) porque abandonaba el rango 768–1023 px, que es uso real —una ventana en media
> pantalla— y que solo estaba roto por el `min-w` que no cedía. Lo que sigue es el registro de lo
> que se rompió y cómo se decidió.

**Procedencia**: prueba manual del rediseño, 2026-08-21. **A diferencia del §17 y el §18, esto sí es una regresión**, y se anota como tal.

**Qué se rompió.** `SideBySideViewer` cargaba la **única** conducta responsive de la app: por debajo de `lg` (1024 px) alternaba los dos visores con tabs (`Components.md` §5.1, "Mobile (< 1024 px): tabs en lugar de lado a lado"). ADR-087 §2 lo retira —correctamente, porque con un solo visor no hay dos paneles que alternar— pero **no lo reemplaza por nada**: el layout de ②b es ahora una barra lateral de ancho fijo (`min-w-[340px]`) más el visor, sin ningún breakpoint.

**Medido a 375 px**: la barra lateral ocupa 340 de los 375 px, el visor queda reducido a una tira de ~35 px, y la toolbar se desborda con scroll horizontal. A 900 px funciona, pero apretado: los nombres de personas con control de género se truncan ("María Gó…").

**Lo que ya se corrigió** en el mismo PR, porque era solapamiento y no una decisión de diseño: el bloque del logo no encogía y los botones se le montaban encima. Ahora encoge y la bajada se oculta por debajo de `sm`.

**Lo que NO se decidió, y necesita decisión del humano**: qué hace el layout por debajo de `lg`. Tres opciones, no excluyentes:

1. **Tabs "Entidades | Documento"**, que es el equivalente directo de lo que hacía `SideBySideViewer`: una sola región visible a la vez, con el toggle Original/Anonimizado adentro de la de documento.
2. **Barra lateral como cajón** (off-canvas) sobre el visor, con un botón para abrirla. Conserva el visor siempre visible, que es lo que se está revisando.
3. **Declarar un ancho mínimo soportado** y mostrar un aviso por debajo. Es una herramienta de trabajo de escritorio —anonimizar una pericia de 200 páginas en un teléfono no es un caso de uso— y fingir que funciona es peor que decir que no.

La 3 es defendible y la más barata, pero **es una decisión de producto**, no de implementación: implica declarar en qué anchos la herramienta se sostiene. Hasta que se decida, el rediseño **asume escritorio** y el spec (`UX_Guidelines.md` §2) no dice nada sobre el tema — que es en sí parte del gap: la sección que retiró el layout de cuatro paneles retiró también su párrafo de mobile sin escribir el reemplazo.

---

## 20. Cerrado el 2026-08-21: el documento quedaba inutilizable tras exportar bien

**Procedencia**: prueba manual del rediseño. **Se cierra en el mismo día**; se anota porque el defecto vivía en el Core desde antes del rediseño y conviene que quede el rastro de cómo se encontró.

**Síntoma**: tras un export exitoso, "Exportar" desaparecía de la toolbar, "Cancelar" quedaba visible, el estado decía "Exportando…" para siempre, y el archivo recién generado **no se podía descargar**. La única salida era cerrar el documento y perder la sesión de edición.

**Causa**: `handleExportFinished` (`orchestrator.ts`) hacía `this.state.update(documentId, { stage: Done })` en vez de `this.setStage(...)`. El estado interno pasaba a `Done` correctamente, pero **`PIPELINE_STAGE_CHANGED` nunca se emitía**, así que la UI seguía creyendo que el stage era `Exporting`. Todas las demás transiciones del archivo ya usaban `setStage`.

`Orchestrator.md` §8 (fila `EXPORT_FINISHED`) ya decía "stage → `Done`": el spec estaba bien y el código no lo cumplía. Corregido sin cambio de contrato, con un test que afirma la **emisión** y no el estado interno.

**Por qué no se había visto antes**: el gate de `ExportButton` es `{Ready, Done}` desde ADR-040, y `CancelButton` ocultaba `Ready` recién desde ADR-087 §7. Con el layout anterior el síntoma era menos visible —quedaban más caminos abiertos en la toolbar— y ningún test cubría la emisión del stage post-export: el único test de `EXPORT_FINISHED` afirmaba sobre el revoke del blob al cerrar.

**Defecto de UI encontrado en el mismo camino, también corregido**: cerrar el diálogo de export tras terminar reseteaba `submitted`, así que reabrirlo mostraba un formulario en blanco. El `blobUrl` seguía vivo en `pipeline.store` y **la UI no tenía ningún camino de vuelta a él**. Ahora reabrir con un resultado vigente muestra el resultado, con el nombre que se usó.

---

## 21. Cerrado el 2026-08-21: el visor quedaba gris con cualquier PDF real

**Procedencia**: prueba manual sobre un expediente propio de 50 páginas (2,3 MB), reportada como "el preview del normal ni anonimizado se muestra, pero cuando lo descargo lo veo bien". **Cerrado el mismo día**; se anota por el rastro, porque el defecto vivía desde ADR-053 y **ningún test podía verlo**.

### Causa raíz

`getDocument()` del kernel de render recibía `CMapReaderFactory` y `StandardFontDataFactory` propias —ADR-053 §2 las agregó exactamente por esta clase de problema— pero **no `CanvasFactory`**. pdf.js cae entonces a su `DOMCanvasFactory`, que hace `document.createElement("canvas")`, y dentro de un Worker `document` no existe.

pdf.js pide canvas auxiliares cuando la página los necesita: **grupos de transparencia, soft masks, patrones de mosaico y fuentes Type3**. Una página que solo dibuja texto y vectores nunca los pide.

### Por qué ningún test lo agarró, y qué hacer al respecto

**Todos los fixtures del repo son texto plano generado con `pdf-lib`** (`tests/fixtures/generate.ts`). Ninguno tiene una imagen, una transparencia ni un patrón, así que ninguno ejercita el camino que falla. El motor tenía 57 tests de unidad pasando mientras cualquier PDF salido de un convertidor real fallaba en **todas** sus páginas.

**Esto sigue abierto y es la parte que importa del §21**, y el intento de cerrarlo dejó un dato:

- Se agregó `image-alpha-3p.pdf` (imagen con `/SMask`, imagen + texto, rectángulos con `opacity`) y **no reproduce el defecto**: con la `CanvasFactory` quitada a propósito, renderiza igual. Un SMask de imagen simple no alcanza. El camino se dispara con **grupos de transparencia**, **patrones de mosaico** o **fuentes Type3**, y `pdf-lib` no produce ninguna de las tres.
- Lo que sí guarda la omisión concreta es un test de unidad del kernel que afirma que `getDocument()` recibe la factory (verificado: falla si se la saca). Es un guard sobre **ese** olvido, no sobre la familia.

**Conclusión**: el hueco no se cierra con un fixture sintético. Necesita un PDF real —el `scanned-10p.pdf` que el README lista como pendiente por requerir tools externos es el candidato— y un test de render en browser (Playwright) sobre él, porque el kernel no se puede ejercitar en Node: no hay `OffscreenCanvas` ni DOM.

### Segundo defecto, del mismo camino: el fallo era invisible — **cerrado el 2026-08-21**

El diagnóstico inicial dijo que el problema era el `warn` a un logger nulo. Eso era el síntoma. Al ir a arreglarlo se midió la causa, y era peor: **el motor nunca llegaba a emitir `PREVIEW_PAGE_FAILED`**.

`renderPagesInternal` decidía si un fallo era recuperable con `err instanceof RenderPageFailedError`. Los renders corren en un `RenderWorker`, y un error que vuelve por `postMessage` pierde el prototipo: `EngineError.deserialize()` reconstruye siempre un `DeserializedEngineError` genérico. Medido en el navegador, con el fallo real reproducido:

```
{ ctor: "DeserializedEngineError", code: "RENDER_PAGE_FAILED",
  msg: "Fallo al renderizar la página 0: Cannot read properties of undefined (reading 'createElement')" }
```

O sea: `instanceof` daba `false` para **todo** fallo de render de producción. Consecuencias, las dos contra el spec:

1. El reintento de `Render_Engine.md` §11 ("reintentar 1 vez") **nunca corría**.
2. El error caía a la rama "no recuperable → abortar batch" y se iba por el `throw`, así que **`PREVIEW_PAGE_FAILED` no se emitía nunca** (§13 caso 12). El único rastro era el `warn` al logger nulo.

Es exactamente el bug de ADR-049 §5, en otro motor. El comentario de `shared/src/errors.ts` ya lo había anticipado palabra por palabra: ese `instanceof` "da `false` en producción y `true` en los tests que no serializan, que es exactamente cómo el bug de ADR-049 pasó todos los gates". Y volvió a pasar por lo mismo: los tests del motor hacían fallar el render con la subclase concreta, que es justo la forma que **no** ocurre cuando hay workers de verdad.

**Corregido**: discriminación por `code` (`isRenderErrorCode` / `isRetryablePageError` en `render.errors.ts`), más `createDeserializedRejectingRenderPool` en los helpers de test — el primer helper del motor que hace fallar un render con la forma deserializada real. El test de regresión afirma los dos intentos y el `PREVIEW_PAGE_FAILED`, y se verificó que falla contra el código viejo.

**Del lado de la UI**, el evento ahora tiene destino: `bus-bridge.ts` lo suscribe, `viewer.store.ts` guarda `failedPages`, `PageCanvas` dibuja un aviso en la página afectada ("No se pudo mostrar esta página — el documento no cambió") y `previewRetry.ts` deja de reintentar esa página. Verificado end-to-end quitando la `CanvasFactory` a propósito y cargando el PDF de 50 páginas del reporte: el aviso aparece; con la factory puesta, no aparece y la página se ve.

**Queda una nota, no un pendiente**: el `warn` de `handleRenderRequested` sigue yendo a un logger nulo. Ya no es la única vía —el evento cubre lo que el usuario tiene que ver—, pero un logger que en desarrollo escriba a consola seguiría ahorrando el paso de instrumentar el código para diagnosticar.

### Tercer defecto, en la UI: nadie reintentaba

`readyRenderTrigger.ts` re-pedía una sola vez al observar `Ready`. Alcanzaba mientras el visor solo se miraba después del análisis; con el pase temprano de ADR-087 §6 el usuario entra a los 6 s con el pipeline todavía en `OCRing`, sus pedidos se descartan por documento-no-cargado, y `Ready` puede estar a minutos. Corregido con `previewRetry.ts` (reintento autolimitado, con techo).

---

## 22. El árbol de entidades declara `role="tree"` y no tiene un solo tab stop

**Procedencia**: revisión de la branch de ADR-087, 2026-08-22. Se anota como **desvío aceptado a sabiendas**, no como algo que se descubrió después.

El patrón WAI-ARIA de tree pide que todo el árbol sea **un solo tab stop**: `Tab` entra y sale, y las flechas navegan adentro. El árbol de entidades implementa las flechas (verticales, laterales con la semántica correcta, `Home`/`End`, `Space`, `Enter`) pero **no** el tab stop único: cada fila tiene además su checkbox, su selector de modo, su toggle de género y su menú, todos botones con tab stop propio. Son ~5 por fila visible.

### Por qué no se arregló en ADR-087, y por qué el arreglo obvio es el equivocado

El arreglo aparente —poner `tabIndex={-1}` en esos controles— dejaría el selector de modo y el menú **inalcanzables por teclado**, porque hoy no hay ninguna otra tecla que los alcance. Sería peor accesibilidad con el patrón formalmente cumplido.

El arreglo correcto es **`role="treegrid"`**: ahí las flechas navegan filas **y celdas**, así que los controles se alcanzan con flechas en vez de con `Tab` y el árbol conserva su tab stop único. No hay disyuntiva real entre "cumplir el patrón" y "que los controles se alcancen" — esa disyuntiva solo existe si uno se queda en `role="tree"`.

Migrar a `treegrid` es un cambio grande (navegación bidimensional, `aria-colcount`/`aria-colindex`, y cada control pasa a ser una celda) y no es lo que ADR-087 vino a hacer.

### La tensión con el precedente de `role="menu"`

`Components.md` §3.4 retiró `role="menu"` del menú contextual (2026-08-20) con este argumento: *"ese rol es un contrato con el lector de pantalla … y nada de eso está implementado. Anunciarlo igual … es peor que no anunciar nada"*. Aplicado literalmente, `role="tree"` también debería salir.

Se mantiene por una diferencia de grado, y conviene decirla en voz alta porque es incómoda: aquel rol prometía navegación por flechas, `Home`/`End` y foco gestionado y **no implementaba ninguna de las tres**; éste implementa todo salvo el tab stop único, y retirarlo perdería además la estructura que el lector de pantalla sí aprovecha (nivel, expandido, tamaño del conjunto). **Si esa diferencia de grado se considera insuficiente, la salida es retirar `role="tree"`, no seguir prometiéndolo** — y sería coherente con el precedente.

**Estado**: abierto. Destino: `treegrid`.

---

## 23. El gate manual de ADR-058 §11 / ADR-086 §4 se corrió, y **no pasa**

**Procedencia**: gate manual corrido el 2026-08-22 sobre dos de los tres documentos que faltaban, con fixtures fabricados para eso (`tests/fixtures/generate.ts`: `qa-tables-justified.pdf`, `qa-stamp.pdf`). Se juzgó **sobre el PDF exportado**, no sobre el preview, como exige ADR-058 §11 — el preview dibuja anotaciones que el export no lleva, y mirarlo ahí habría dado un falso positivo.

**Los fixtures son sintéticos y eso acota la lectura**: reproducen el régimen (justificado real con espaciado irregular, celdas apretadas, texto rotado a 90°/270°, marca de agua traslúcida) pero no la suciedad de un expediente real (kerning por par, fuentes subseteadas, sellos rasterizados). Sirven para decidir que **hay defectos**; no sirven para declarar que no hay otros.

### Lo que falla, y es más grave que la costura que el gate iba a mirar

El gate preguntaba si las líneas repintadas se distinguen de las que no se tocaron. La respuesta es que sí, pero el hallazgo importante es otro: **el PDF exportado sigue conteniendo datos personales legibles**.

| # | Hallazgo | Documento | Gravedad |
|---|---|---|---|
| 23a | El **folio lateral a 270°** ("Folio 214 — Juan Pérez") no se detecta y sale **en claro** en el exportado | sello | **fuga** |
| 23b | El **sello a 90°** reemplaza el DNI pero deja "PERITO CARLOS LOPEZ" **en claro**: mayúsculas sin tilde no agrupan con "Carlos López" del cuerpo | sello | **fuga** |
| 23c | La **carátula** "Pérez, Juan c/ Empresa S.A." no se detecta — orden invertido `Apellido, Nombre`, que es la forma canónica de una carátula judicial | sello | **fuga** |
| 23d | **OCR sobre el propio PDF exportado recupera "Pérez" y "Juan"** — la fuga no es solo visible a ojo, es legible por máquina | sello | **fuga** |
| 23e | El reemplazo deja **fragmentos del original visibles** antes del token ("Ju"…, "B"…, "3"…): la caja no cubre el primer glifo | sello | alta |
| 23f | El **texto justificado fragmenta entidades**: "Empresa S.A." se detecta además como "Em" y "presa S.A", dos grupos espurios | tablas | media |
| 23g | Los tokens se dibujan **más chicos y levantados** respecto de la línea: se distinguen a simple vista, que es exactamente lo que el gate pedía que no pasara | tablas | media (es el criterio del gate) |
| 23h | La coma queda **huérfana** tras el token ("[DNI 01] ,") y el token de la fila "Contacto" **desborda el borde de la celda** | tablas | baja |

### Lectura

- **23a/23b/23c/23d son de detección, no de repintado**, y son las que impiden cerrar el hito: la herramienta promete que el dato no sale, y sale. ADR-063 arregló el **bbox** del texto rotado —por eso el DNI del sello sí se reemplaza, con sus dos ocurrencias agrupadas— pero eso no alcanza para que el **nombre** del mismo sello se detecte.
- **23e es de cobertura del reemplazo** y vale por sí sola: dejar el primer carácter del original es sistemático, no un caso de borde.
- **23f/23g/23h son lo que el gate iba a mirar**, y confirman que la costura se ve.

### Qué NO se corrió

La tercera fila del gate —documento **escaneado**, ruta OCR— quedó a medias: se ejercitó sobre el propio exportado (que es 100 % imagen, así que entra por OCR) y eso produjo 23d, pero no se completó un ciclo entero de importar-anonimizar-exportar-mirar sobre un escaneado con entidades conocidas. Queda pendiente.

**Ninguno de estos hallazgos se arregló en el mismo paso**: son de motores distintos (grouping/regex para la detección, render/export para la cobertura) y varios piden decisión antes que código. El gate estaba para producir esta lista.

### Estado al 2026-08-27

La sesión de calidad de detección cerró **siete** de los ocho. La columna que importa no es el estado sino **dónde estaba el defecto**: el gate agrupó los hallazgos por dónde se VEN, y tres estaban en otro motor.

| # | estado | dónde estaba de verdad |
|---|---|---|
| 23a | **cerrado** — ADR-088 §1 | `ner-engine`. No era detección: dos runs rotados de márgenes opuestos quedaban pegados en `Page.text` y el modelo los leía como una frase |
| 23b | **cerrado** — ADR-088 §2 | `ner-engine`. El modelo es *cased* y sobre caja alta devuelve cero tokens. No era la normalización de Grouping |
| 23c | **cerrado** — ADR-092 | `regex-engine`. El modelo ve la carátula pero por debajo del umbral; es un patrón, no un caso de modelo |
| 23d | **cerrado por consecuencia** | Era el corolario de a/b/c: cerrados esos, el OCR sobre el exportado ya no recupera esos nombres |
| 23e | **cerrado** — ADR-097, §24 | `pdf-engine`, no `render-engine`. Ancho de glifo promedio sobre fuente proporcional |
| 23f | **cerrado** — `NER_Engine.md` v1.3.1 | `ner-engine`, no la costura. Un `B-` sobre una continuación de wordpiece partía la entidad |
| 23g | **mitad cuantificada** — §25 | `render-engine`. El token sale 30 % más chico por una constante; el resto pide el gate visual |
| 23h | **abierto** — §25 | `render-engine`. Pide el gate visual: ninguna suite headless lo puede juzgar |

**Lo que hizo posible cerrarlos** fue reproducirlos primero: `tests/integration/qa-stamp-detection.test.ts` corre el pipeline con `pdfjs-dist` **sin mockear** —el único test del repo que ve un `Word` rotado de verdad— y replaya la inferencia con los tokens del modelo de producción. Los tres `it.fails` con los que nació están hoy en cero.

**Continúa en [`Calidad_De_Deteccion_Informe.md`](./Calidad_De_Deteccion_Informe.md)**, que junta estos hallazgos con dos reportes de campo sobre documentos reales —una tabla escaneada rotada que el OCR lee horizontal, y texto chico que no reconoce— y propone un orden de trabajo. Es el punto de entrada para la sesión que tome la calidad de detección.

---

## 24. Cerrado el 2026-08-27 (ADR-097): §23e era un ancho de glifo promedio

**Procedencia**: sesión de calidad de detección del 2026-08-26, al reproducir el hallazgo §23e ("el reemplazo deja fragmentos del original visibles antes del token"). La sección nació con la decisión **abierta**, para que las mediciones no se perdieran; se conserva entera porque el razonamiento que llevó a elegir sigue siendo la justificación.

> **Estado (2026-08-27)**: el humano eligió la **opción A** y está implementada — ADR-097, `PDF_Engine.md` v1.8.0. Lo que sigue vale como registro, con **dos correcciones** que la implementación produjo y que están abajo, en "Lo que la implementación corrigió de este diagnóstico".

### El diagnóstico: no es `render-engine`, y no es un redondeo

El informe de calidad suponía "un redondeo o un `x` de inicio tomado del segundo glifo del run". Es otra cosa. En `pdf-engine/src/pdf.engine.ts`, `convertTextItemsToWords`:

```ts
const charWidth = str.length > 0 ? width / str.length : 0;
const advance = charWidth * offset;
```

Un **ancho de glifo promedio uniforme**, repartido sobre una fuente proporcional. Cada palabra que no arranca al principio de su `TextItem` queda corrida, y el error **se acumula** a lo largo del item.

Medido sobre la línea 2 del cuerpo de `qa-stamp.pdf`, cuyas coordenadas reales las escribe `tests/fixtures/generate.ts` y por lo tanto se conocen:

| palabra | x real | x del motor | error |
|---|---|---|---|
| `El` | 50,00 | 50 | 0,00 |
| `Juan` | 96,75 | 105 | **+8,25** |
| `DNI` | 163,28 | 172 | +8,72 |
| `en` | 326,68 | 339 | **+12,32** |
| `Belgrano` | 343,36 | 355 | +11,64 |

El borrado del repintado arranca en `bbox.x`. Para `Juan` eso son 8,25 pt a la derecha del primer glifo, y la `J` mide 6,0 pt: quedan la `J` y parte de la `u` a la vista. Es exactamente el `Ju[HOMBRE 01]` que reportó el gate, y los otros dos casos (`B[DIRE 01]`, `DNI 3 [DNI 01]`) son el mismo número.

**El ancho también está mal**, en la otra dirección: `promueve` sale 8,43 pt más angosto que la realidad, o sea que la caja tapa de menos por la derecha.

Verificado que el modelo uniforme reproduce la salida del motor palabra por palabra: es el mecanismo, no una hipótesis.

### Esto supersede una decisión documentada

ADR-020 §1 lo eligió a sabiendas: *"El prorrateo es una aproximación lineal (no tiene en cuenta kerning ni fuentes proporcionales reales); es aceptable para el propósito de bbox de censura, que no requiere precisión tipográfica exacta."* Esa premisa está falsificada por medición: una caja corrida 8 pt no tapa el dato.

### A quién afecta, y a quién no

El daño depende de **cómo el productor escribió el PDF**, porque pdf.js v4 ya no fusiona items: un `TextItem` es una operación de dibujo.

| fixture | items | mediana | items de una palabra | error |
|---|---|---|---|---|
| `qa-stamp.pdf` | 8 | 73 chars | 0 de 8 | hasta 12,3 pt |
| `text-10p.pdf` | 2 | 85 chars | 0 de 2 | grande |
| `qa-tables-justified.pdf` | 65 | 6 chars | 60 de 65 | **≈ 0** |

Y hay una propiedad que acota más el daño, por aritmética: cuando una entidad **es** un item completo, su envolvente es exacta de los dos lados —la primera palabra arranca en `charWidth · 0` = el origen del item, y la última termina en `charWidth · str.length` = el ancho del item—. Las tres entidades de `qa-tables-justified.pdf` (`Juan Pérez`, `Empresa S.A.`, `Carlos López`) son items propios, así que **§23f/§23g/§23h no dependen de este hallazgo**.

O sea: el prorrateo solo daña palabras que caen **en el medio** de un item multi-palabra.

### Las dos opciones, y por qué la decisión quedó abierta

El motor **ya** extrae los avances reales por glifo (`.unicode`/`.width` del operator list) en la misma pasada por `getOperatorList()`, para la corrección de origen de ADR-068 y para las palabras de anotación de ADR-066. La maquinaria existe; lo que falta es usarla para el reparto.

**Las dos opciones comparten la mitad fácil** —calcular los avances, con los mismos números— y se diferencian en **de dónde sale la cadena de texto**:

**Opción A — avances reales, cadena de `getTextContent()`, empalme por origen.** Se emite una tabla de avances acumulados junto al origen de cada run de página; `convertTextItemsToWords` casa el item con su run (por origen, con la tolerancia que ADR-068 ya usa) y, si casa, usa `avances[índice]`. Si no casa, cae al prorrateo de hoy. Guarda barata contra el error silencioso: si `avances.length !== str.length`, no se casa.

**Opción B — construir las palabras enteras desde el operator list.** Sin empalme, porque hay una sola fuente. Pero obliga a **reimplementar la extracción de texto de pdf.js**: `getTextContent()` sintetiza espacios que no existen como glifo (`str.push(" ")` gobernado por `trackingSpaceMin = fontSize · TRACKING_SPACE_FACTOR`), resuelve `/ActualText` del contenido marcado y normaliza Unicode. El camino de glifos que ya existe en el motor (`buildAnnotationTextRun`) no hace ninguna de las tres y además descarta el kerning — está probado sobre líneas de firma cortas, no sobre el texto de un expediente.

**La asimetría que decide, y no depende de ninguna medición**:

| | si falla |
|---|---|
| **A** | ese item queda **exactamente como hoy**. Visible en el diff de snapshots: la caja no se movió. |
| **B** | el **texto** del documento cambia, y con él lo que detectan Regex, NER y la lupa. Silencioso: nada falla, simplemente deja de encontrarse una entidad. |

**Descartadas**: ensanchar el borrado en `render-engine` (el bbox equivocado lo consumen además el hit-test de ADR-061 §4, el modo `mask`, `sharesVerticalBand`, la detección de solapamiento de Grouping y el export — y el `width` también está mal, así que ensanchar por la izquierda no alcanza); y pedirle runs más cortos a pdf.js (`disableCombineTextItems` **no existe** en pdf.js v4; en `pdfjs-dist@4.10.38` solo queda `disableNormalization`).

### Lo que falta para decidir bien

**Un expediente real.** Los tres fixtures salen de `pdf-lib`, que escribe espacios como glifos reales, sin ligaduras y sin `ActualText`: son amables con las dos opciones. Medir la tasa de empalme de A sobre ellos daría un número alto que no dice nada sobre un documento de verdad. Los documentos que separan palabras **moviendo el cursor** en vez de con un espacio —justificados, kerneados, salidos de un procesador de texto— son justamente los que el repo no tiene.

Mientras no haya uno, **A es la única de las dos que se puede soltar sin poder verificarla**, porque su peor caso es el comportamiento actual. Si aparece ese expediente y se mide que el empalme falla seguido, B queda disponible y con evidencia que la justifique.

### Lo que la implementación corrigió de este diagnóstico

**1. La columna "x real" de la tabla de arriba es la aproximada, no el modelo.** Esos valores salieron de `font.widthOfTextAtSize` de **pdf-lib** en `tests/fixtures/generate.ts`. Contra ellos, los avances reales dejan un residuo constante de ~1,44 pt. El residuo es de la columna:

| palabra | AFM de Helvetica, a mano | avances (ADR-097) | pdf-lib |
|---|---|---|---|
| `El` | 667 + 222 = 889 → **10,67** | 10,67 | 10,67 |
| `actor,` | 556+500+278+556+333+278 = 2501 → **30,01** | 30,01 | 29,41 |
| `Juan` | 500+556+556+556 = 2168 → **26,02** | 26,02 | 25,78 |

`generate.ts` dibuja la línea entera con **un solo `drawText` en x = 50**: `widthOfTextAtSize` nunca toca el archivo, solo *predice*. La tinta la ubica el renderer con las métricas de la fuente, que son las que pdf.js reporta glifo a glifo. **El error corregido es cero, no 1,44 pt**, y así lo verifica `advances-real-pdf.test.ts` contra una tabla AFM escrita a mano.

**2. La guarda buena no es la que proponía esta sección.** Acá se proponía `avances.length !== str.length`. La implementación empalma por **cadena exacta**, que la implica y además cubre el caso que de verdad importa: si pdf.js sintetizó un espacio, resolvió un `/ActualText` o normalizó, las dos fuentes divergen **sin** cambiar de longitud.

**Lo que sigue sin medirse**: la tasa de empalme sobre un expediente real. Sobre los 28 fixtures del repo da 100 %, pero todos salen de `pdf-lib` (ver "Lo que falta para decidir bien"). ADR-097 §5 instrumenta la cuenta por página, en `debug`, para que el día que aparezca un documento de verdad el número esté ahí sin volver a instrumentar. Ese número es lo único que justificaría pagar la opción B.

### Lo que este hallazgo NO frena

Verificado item por item: no bloquea el grupo apagado de confianza baja (`grouping-engine`, no mira geometría), ni su marca en la UI, ni el hueco de característica de 3 dígitos de `phone-mobile-ar`, ni la costura §23f/§23g/§23h (arriba), ni el evaluador del dataset de referencia **siempre que matchee por valor + página y no por solapamiento de bbox** — que es lo que corresponde para una métrica de detección de texto, y este hallazgo es una razón más para elegirlo así.

---

## 25. §23f resuelto en otro motor; §23g/§23h quedan pendientes del gate visual

**Procedencia**: sesión de calidad de detección del 2026-08-26, al abordar lo que §23 llamó "la costura" — los tres hallazgos que el gate de ADR-058 §11 iba a mirar.

### §23f no era de la costura

El informe atribuía los grupos espurios `"Em"` y `"presa S.A"` al texto justificado. Reproducido con el modelo real sobre `qa-tables-justified.pdf`, la causa es la agregación BIO de `ner-engine`: el modelo etiqueta `B-ORG` sobre `##presa`, una **continuación de wordpiece**, y `aggregateTokensToSpans` le creía. **Cerrado** en la v1.3.1 del spec de NER.

Con eso, **dos de los tres hallazgos que el gate agrupó como "la costura" estaban en otro lado** (§23e en `pdf-engine`, §24; §23f en `ner-engine`). Vale como advertencia de método: el gate agrupa por **dónde se ve** el defecto, no por dónde está.

### §23g: "los tokens se dibujan más chicos", cuantificado

No es un error de calibración: es una constante. `REPLACEMENT_FONT_HEIGHT_RATIO = 0,7` (`Contracts.md` §6, ADR-057 §5) se aplica sobre `bbox.height`, que es el **cuerpo** que reporta pdf.js — no el alto visual del glifo. Medido sobre `qa-tables-justified.pdf`:

| | cuerpo | token dibujado | altura de mayúscula |
|---|---|---|---|
| cuerpo de la tabla | 12,00 pt | **8,40 pt** | 10,04 → **7,03 pt** |
| título | 14,00 pt | 9,80 pt | |

O sea que el token sale **30 % más chico** que el texto que lo rodea, por construcción y no por accidente.

**No se cambia acá, y la razón importa**: subir la razón a 1,0 haría el token del mismo tamaño y **más ancho**, con lo que dejaría de entrar más seguido — y ahí entra el shrink-to-fit y el detector de degradado de ADR-086. Es un intercambio entre "se distingue por el tamaño" y "no entra y se achica igual", y elegirlo pide ver los dos resultados. La constante además la consume `estimateTokenWidth` y el camino de shrink-to-fit, así que tocarla no es local.

### §23g ("levantados") y §23h: hasta acá llega lo headless

Lo que queda —el token levantado respecto de la línea, la coma huérfana tras el token, y el token que desborda el borde de la celda— es **juicio visual sobre el PDF exportado**, que es exactamente lo que ADR-058 §11 define como gate manual y lo que `tests/fixtures/README.md` ya dice que **ninguna suite headless puede juzgar**.

Se intentó acotarlo por cálculo y no alcanzó: `tryRepaintLine` dibuja con `textBaseline: "middle"` centrado en el medio del bbox, mientras el texto original se apoya en su línea de base. La aritmética de dónde queda cada centro depende de la relación entre `bbox.height` y las métricas reales de la fuente embebida, y sale distinta según qué se asuma. **Afirmar un diagnóstico ahí sin mirarlo sería inventar.**

**Lo que hace falta para cerrarlos**: correr el gate de ADR-058 §11 sobre `qa-tables-justified.pdf` exportado, en un browser real, con las correcciones de esta campaña ya aplicadas — varias de las cuales (§23e, §23f) cambian lo que se ve en ese mismo documento.
