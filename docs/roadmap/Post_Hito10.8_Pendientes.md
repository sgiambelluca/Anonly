<!-- CONTEXT: scope=roadmap-pendientes | dependencias=roadmap/MVP.md,roadmap/Hito10.8_Handoff.md,adr/ADR-011-Grouping-First.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-073-Difuso-Solo-Para-Tipos-De-Texto-Libre.md,adr/ADR-074-Una-Entidad-Partida-En-Varias-Lineas.md,adr/ADR-075-Fechas-En-Texto-Y-Tramos-De-Identificadores.md,adr/ADR-076-La-Edicion-Manual-Del-Valor-De-Reemplazo-Gana.md | audiencia=humanos+IA | fase=post-10.8 (§1, §2, §4, §4bis y §10 adoptados como Hito 10.9 el 2026-08-15, cada uno con su ADR; el diagnóstico original se conserva porque es la medición sobre el documento real) -->

# Pendientes acordados para después del Hito 10.8

> Gaps preexistentes que el humano decidió explícitamente diferir porque **no pertenecen al hito donde aparecieron**. Los §1-§9 salieron de la prueba manual sobre la pericia real durante el Hito 10.8; del §10 en adelante entran hallazgos de otros orígenes, con su procedencia indicada en la entrada. Ninguno es regresión de ningún hito.
>
> Orden **no** significativo a partir del §10: los §1-§9 están ordenados por daño real, y las entradas nuevas se agregan al final para no romper las referencias cruzadas por número que ya existen en otros docs. La severidad de cada una está declarada en su propio texto.
>
> **Estado (2026-08-13)**: el §3 quedó **cerrado dentro del hito** por ADR-067 — se conserva tachado, con el porqué. El resto sigue vigente, y el §2 quedó **medido** sobre la pericia de 5 páginas en la segunda prueba manual.
>
> **Estado (2026-08-14)**: entra el §10, de la planificación del Hito 10.6 (ADR-072).
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
