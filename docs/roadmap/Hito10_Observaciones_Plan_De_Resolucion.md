<!-- CONTEXT: scope=roadmap-hito10-observaciones-plan | dependencias=roadmap/Hito10_Observaciones_Revision.md,roadmap/MVP.md,ai/AI_Development_Guide.md,adr/ADR-046-NerEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-047-ExportEngine-Ensamblador-Worker-Dedicado.md,adr/ADR-048-Cierre-E2E-Hito10-Fixtures-Assets-Escenarios.md,adr/ADR-049-Errores-Cruzando-Worker-Discriminacion-Por-Code.md,adr/ADR-050-Password-Del-PDF-Protegido-Hasta-RenderEngine.md,adr/ADR-055-Decodificacion-Del-Resultado-Que-Cruza-Un-Worker.md | audiencia=humanos+IA | fase=post-10.9 -->

# Plan de resolución de las observaciones no bloqueantes del Hito 10

> **Qué es esto.** `Hito10_Observaciones_Revision.md` (633 líneas, 25 entradas de PR) acumuló durante todo el Hito 10 las observaciones que el revisor y el implementador marcaron como **no bloqueantes**. Muchas se cerraron dentro del propio hito o quedaron superadas por hitos posteriores (10.5 a 10.9). Este documento hace el barrido completo: **verifica cada observación contra el árbol de hoy**, decide si amerita arreglo, y —para las que sí— dice exactamente cómo.
>
> **Método.** Ninguna entrada de abajo es una cita del documento original: cada una está verificada contra el código actual con el archivo y la línea a la vista. Donde la observación ya no aplica, se dice por qué y se cierra.
>
> **Orden de trabajo.** §2 (bugs de comportamiento) → §3 (tests) → §4 (comentarios falsos en código) → §5 (specs desactualizados) → §6 (**Necesita ADR**: no se toca nada, se reporta al humano).
>
> **Regla que gobierna el reparto**: R-1/R-5 (un PR = un módulo). Los grupos de abajo están armados por módulo, no por tema, justamente por eso.
>
> ## Estado — 2026-08-18: §2 a §5 implementados
>
> Las 25 correcciones de §2 a §5 están **aplicadas** en el working tree, repartidas en los seis PRs de §8. Gates verdes de primera mano sobre el árbol completo: `pnpm lint`, `pnpm typecheck` (incluido `tests/e2e/tsconfig.json`), `pnpm test` (**1442** tests / 90 archivos, +1 sobre el baseline: el test nuevo de §3.4), `pnpm test:contract` (**292** / 10).
>
> El test nuevo de §3.4 se verificó **falsando la implementación a propósito** (routear el `PROGRESS` a todos los jobs pendientes en vez de correlacionar por `jobId`): falla por el motivo correcto, no de forma incidental. Implementación restaurada y suite re-corrida en verde.
>
> **§6 no se tocó**, por diseño: son las 13 que necesitan ADR.
>
> Sin `git commit` — pendiente de autorización explícita del humano (I-9).
>
> ## Estado — 2026-08-19: seis de §6 implementados, con ADR
>
> El humano tomó **#3, #6, #8, #10, #11 y #12** de §6. Cada uno se hizo por el camino del repo: ADR primero, specs después, código al final (R-19).
>
> | § | Observación | ADR | Módulos tocados |
> |---|---|---|---|
> | 6.1 F | Código de error para crash de worker | **ADR-077** | `shared` → `src` |
> | 6.1 C | La edición manual visible en la UI | **ADR-078** | `shared` → `grouping-engine` → `apps/react-client` |
> | 6.3 H | Transferencia real de `ArrayBuffer` | **ADR-079** | `src` → `render`/`ocr`/`export` |
> | 6.3 J | Idle-dispose de los pools del façade | **ADR-080** | `src` |
> | 6.3 K | Sancionar `NerDispatchDecodeFailure` | **enmienda §11 de ADR-055** | solo docs |
> | 6.3 L | Patch combinado de `reanalyze` | **ADR-081** | `src` |
>
> Gates verdes de primera mano: `pnpm lint`, `pnpm typecheck`, `pnpm test` (**1451** / 90 archivos), `pnpm test:contract` (**295** / 10).
>
> **Los cinco tests nuevos se verificaron falsando su implementación a propósito** (`retryable: false` en `WorkerCrashedError`; sin transfer list en `dispatchRemote`; sin armar el temporizador de idle; sin el guard del patch combinado; el flag proyectado siempre en `false`): los cinco fallan por el motivo correcto. Árbol restaurado y suite re-corrida en verde.
>
> **Dos hallazgos del propio trabajo**, que corrigieron el encuadre inicial:
> - **#1 es más grave de lo que decía §6.1 A**: `applyConflictResolve` no toca el `entityType`, y la ocurrencia perdedora de un conflicto **se descarta y nunca se registra**. O sea que el `ConflictDialog` es informativo disfrazado de accionable, y "Usar NER" exigiría retener datos que hoy se tiran — no agregar un campo a un evento.
> - **#3 eran dos señales, no una**: `UX_Guidelines.md` §3.3 conflacionaba "el `replacementValue` lo escribió el usuario" (computable, y lo que ADR-078 implementa) con "el `replacementMode` difiere del default de las reglas" (que sigue sin ser computable sin reimplementar `resolveMode`). El spec ahora las separa, con la segunda marcada como no implementada y su razón.
>
> Quedan **siete** en §6 sin tocar: #1, #2, #4, #5, #7, #9 y #13.
>
> Sin `git commit` — pendiente de autorización explícita del humano (I-9).
>
> ## Estado — 2026-08-19 (segunda tanda): #1, #2 y #4 cerrados + una funcionalidad nueva
>
> | § | Observación | ADR | Módulos |
> |---|---|---|---|
> | 6.1 A | El panel de conflicto elige **tipo**, no modo | **ADR-083** | `shared` → `grouping-engine` → `apps/react-client` |
> | 6.1 B | "Ver ocurrencias" | **ADR-084** | `apps/react-client` |
> | 6.1 D | Conflictos stale de `dropOccurrences` | errata de spec (sin ADR, por decisión del humano) | solo docs |
> | — | **"Cambiar categoría"** (pedido nuevo) | **ADR-082** | `shared` → `grouping-engine` → `apps/react-client` |
>
> **Hallazgo que definió el reparto**: #1 y "Cambiar categoría" resultaron ser **la misma capacidad faltante** — `GroupUpdateRequested.patch` no tenía `type`. Por eso ADR-082 decide el mecanismo y ADR-083 lo consume con una UI restringida a los candidatos del conflicto, en vez de abrir dos caminos para cambiar el tipo de un grupo.
>
> **Dos correcciones que salieron del propio trabajo**:
> - **El default pedido ("mayor confidence") no era un cambio**: `regex-engine` emite siempre `confidence: 1.0`, así que "mayor confidence, empate a Regex" ya es lo que `conflictWinnerIsNew` hace. `conflictWinnerIsNew` no se tocó.
> - **ADR-082 §3 se decidió al revés en el primer borrador**, y lo corrigió el test de regresión: los `SessionOccurrenceRecord` **conservan el tipo del detector**, no siguen al grupo. Si siguieran, el dedup por identidad —que corre antes que la detección de conflictos— dejaría de reconocer la ocurrencia re-emitida en un `reanalyze` y esta generaría un conflicto del grupo contra sí mismo. El razonamiento equivocado quedó escrito en el ADR para que no se repita.
>
> Gates verdes de primera mano: `pnpm lint`, `pnpm typecheck`, `pnpm test` (**1463** / 91 archivos), `pnpm test:contract` (**295** / 10). Tests nuevos verificados falsando su implementación — incluido uno que **pasaba vacío** en su primera versión (la aserción de `indexInType` era `> 0`, que el índice viejo también cumple) y se fortaleció hasta fallar contra la implementación rota.
>
> **#9 (idempotencia del `save`) NO se tocó**, a pedido del humano hasta evaluar su gravedad. Quedan sin tocar en §6: #5, #7, #9 y #13.
>
> Sin `git commit` — pendiente de autorización explícita del humano (I-9).

---

## 1. Resumen del barrido

De las ~70 observaciones no bloqueantes del documento original:

| Estado | Cantidad | Dónde |
|---|---|---|
| Ya cerradas por hitos posteriores o por el propio Hito 10 | ~30 | §1.1 |
| Ameritan arreglo, sin ADR | 25 | §2 a §5 |
| Necesitan ADR (no se tocan) | 13 | §6 |
| No ameritan arreglo (documentadas a propósito) | ~8 | §1.2 |

### 1.1 Cerradas — verificado, sin acción

- **PR4, supersede de render**: resuelto 2026-07-19 (`participatesInSupersede`), con tests de regresión.
- **PR5, `initCore` sin `EngineConfig`**: cerrado por PR16.5 (`settingsToEngineConfig.ts` existe y `App.tsx` lo cablea).
- **PR7, scroll sincronizado y sus tres defectos**: superados por **ADR-054** (scroll independiente por panel; `scrollSync.ts` eliminado, `ScrollSyncToggle.tsx` en su lugar).
- **PR7, "pool de canvas reutilizables"**: la frase ya no está en `Components.md` §5.3 ni en `07` §3 — la redacción se ajustó.
- **PR7, doble emisión de `RENDER_REQUESTED`**: cerrada por **ADR-056** (`kind` por panel).
- **PR10, comentario stale de `scenario-1` y `tests/e2e/` fuera de `typecheck`**: los aplicó PR17.
- **PR17.3 sin fila en `MVP.md`**: hoy la tiene (`MVP.md:202`).
- **Bug 2 del cierre (texto como cuadrados `.notdef`)**: cerrado por **ADR-053** — `render-engine/src/worker/kernel.ts:1115` tiene `disableFontFace: true` + `cMapUrl`/`standardFontDataUrl`.
- **Bug 4 del cierre (`ERR_FILE_NOT_FOUND` de blob URLs)**: cerrado por **ADR-056**.
- **PR A1 (`ner-engine`), los dos hallazgos del rechazo**: el campo se llama `decodeError` (no `cause`) y el abort está acotado a la falla de decodificación (`ner.engine.ts:591`, `:821`).
- **`viewer-scroll-jump.spec.ts` en rojo**: el spec fue reescrito por ADR-054 §8; el mecanismo que fallaba ya no existe.

### 1.2 No ameritan arreglo — decisión ya tomada, se conservan como están

- Sobre-emisión de `ENTITY_GROUP_UPDATED.changes` en `dropOccurrences` (evento idempotente).
- Dedup O(n²) en `recordedOccurrences` (mismo patrón que `findOverlapConflict`; sin perfilado que lo señale).
- Guard `patch == null` en `validateReanalyzePatch` (inalcanzable vía la firma tipada).
- Sincronización por página y no por píxel en el visor: **retirada** por ADR-054, ya no aplica.
- `reprimeWorkers` reenvía a todos los workers vivos (recarga determinística, ADR-030).
- `modelWarm` y `kernelDispose()` como estado de módulo compartido entre instancias: no se manifiesta con pool real (una instancia por `createCore`).
- `isNerKernelSpan` valida contra el `EntityType` completo: permisivo a propósito en un decoder.
- Ciclo de import type-only `types.ts` ↔ `interfaces.ts` en `shared`: correcto bajo `verbatimModuleSyntax`; se extrae a un tercer archivo **si el patrón se repite**, no antes.

---

## 2. Bugs reales de comportamiento — `apps/react-client`

Los tres son del mismo módulo, así que van en un PR (R-1 se cumple: un módulo, un PR).

### 2.1 `SettingsDialog`: el store se persiste antes de que el `reanalyze` resuelva

**Verificado** (`components/toolbar/SettingsDialog.tsx:141-175`): `handleConfirmReanalyze` hace `applyToStore(next)` **dentro del `try`, antes** del loop `await actions.reanalyze(patch)`.

**Por qué es un bug y no un matiz.** Si el primer patch (OCR) rechaza, el `catch` pinta el error pero el store ya quedó persistido con **los dos** cambios. El segundo patch (NER) nunca se envió. Un segundo click en "Guardar" recalcula `diffReanalyzeChange(previous, next)` contra el store ya mutado → diff vacío → `needsReanalyze === false` → cierra el diálogo **sin reanalizar nada**. El usuario queda con un store que afirma una configuración que el Core no tiene, y sin forma de reintentar desde la UI.

Empeoró con PR16.5: desde que el bootstrap deriva `EngineConfig` de `settings.store`, ese store mentiroso se convierte en la config real del próximo `createCore`.

**Fix.** Mover `applyToStore(next)` a **después** del loop de `await`, junto al `setConfirmOpen(false)`/`onClose()` del camino feliz. El `catch` no necesita reseteo: si el store nunca se tocó, el diff sigue siendo válido y el reintento funciona. Es la primera de las dos opciones que el propio reporte de PR6 ya proponía.

**Riesgo de la alternativa descartada** (aplicar en el `try` y resetear en el `catch`): deja una ventana en la que un lector del store ve la config nueva mientras el Core todavía tiene la vieja. Mover la escritura al final no tiene esa ventana.

**Test**: no hay infraestructura de render de componentes en este repo (`vitest.config.ts` usa `environment: node`) — misma limitación que `React_Client.md` ya documenta para el orden `load()`/`initCore`. El fix descansa en revisión de código, como los precedentes del mismo archivo.

### 2.2 El banner "Desactivar NER y reanalizar" no toca `settings.store.nerEnabled`

**Verificado** (`components/toolbar/PipelineStatus.tsx:57-64`): el botón llama `actions.reanalyze({ ner: { enabled: false } })` y nada más.

**Por qué ahora sí importa.** Cuando se anotó (PR6) la observación decía "sin efecto real hoy dado el gap de PR5". **Ese gap lo cerró PR16.5**: hoy `App.tsx` deriva los overrides de `settings.store` en el bootstrap. Consecuencias vivas:

1. El toggle de `SettingsDialog` sigue mostrando NER activado después de desactivarlo desde el banner.
2. Al recargar la pestaña, el bootstrap vuelve a arrancar el Core **con NER activado** — el usuario desactivó NER porque el modelo no cargaba, y vuelve al mismo error.
3. `diffReanalyzeChange` compara contra un store que no refleja la config del Core: el usuario que después cambia solo el idioma dispara un diff que incluye NER sin quererlo.

**Fix.** Antes del `reanalyze`, escribir el store igual que hace `SettingsDialog.applyToStore`: `useSettingsStore.setState({ nerEnabled: false })` + `persist()`. Es exactamente la recuperación que `React_Client.md` §3.7 y §8 describen ("Desactivar NER y reanalizar"), que hoy queda a medias.

**Orden**: el `reanalyze` es la acción que puede fallar, así que se escribe el store **después** de despacharlo, por el mismo criterio de §2.1. `actions.reanalyze` devuelve promesa; el botón la ignora hoy con `void`. Se conserva el `void` (el banner no tiene UI de error propia) pero el store se escribe en el `.then` del camino feliz, no antes.

### 2.3 Estado vacío binario: "Sin documento" con un documento cargado

**Verificado** (`App.tsx:75-92`): `LeftPanel` decide con `hasAnyGroup(state.groupsByType)` a secas. Un documento que llegó a `Ready` sin ninguna entidad detectada muestra el `EmptyState` "Sin documento / Cargá un PDF para empezar a detectar entidades".

**Qué dice el spec.** `UX_Guidelines.md` §11 tiene dos filas distintas:

| Estado | UI |
|---|---|
| App recién abierta, sin documento | Hero + "Arrastra un PDF aquí" |
| Documento cargado, sin entidades | "No se detectaron entidades. Revisa los patrones en Settings." |

**Fix.** El dato para distinguirlas ya existe y ya se usa en el mismo archivo: `useDocumentStore((s) => s.id !== null)` (`RightPanel` lo lee para elegir entre Hero y visores). `LeftPanel` pasa a un estado ternario: sin grupos **y** sin documento → el `EmptyState` actual; sin grupos **con** documento → el mensaje de la fila 2; con grupos → `EntitiesPanel`.

**Por qué `document.store.id` y no `pipeline.store.stage`** (que era lo que sugería el reporte de PR8): `stage` distingue además "cargando" de "listo", lo que obligaría a decidir un tercer texto que ningún spec define. `id !== null` es exactamente la pregunta que la fila de la tabla hace ("documento cargado"), y es el criterio que el panel derecho ya usa — dos paneles con el mismo criterio, sin inventar nada.

**Test**: `hasAnyGroup` vive en `entityTree.ts` y está testeado. La rama nueva es JSX puro sobre dos booleanos ya disponibles; sin infraestructura de render, no hay test de componente que agregar (misma situación que §2.1).

---

## 3. Tests y fixtures

### 3.1 `tests/e2e` — la aserción de "Teléfono" del Escenario 8 fija un falso positivo

**Verificado** (`scenario-8-ner-disabled.spec.ts:73`): `expect(page.getByRole("treeitem", { name: "20-12345678" })).toBeVisible(); // Teléfono`.

**Qué está pasando realmente.** Comprobado ejecutando los patrones de `default-ar.ts` sobre el texto del fixture:

```
phone-mobile-ar  " 20-12345678"      índice 54
phone-mobile-ar  "+54 11 1234-5678"  índice 79
cuit             "20-12345678-9"     índice 55
```

El CUIT del fixture falla su propio checksum AFIP (dígito verificador 6, no 9) y el motor lo descarta bien. Lo que el test afirma como "Teléfono" son **los diez primeros dígitos del CUIT rechazado**, capturados por `phone-mobile-ar`. O sea: el test pinea un falso positivo como comportamiento esperado.

**El teléfono real del fixture está partido en dos líneas.** `tests/fixtures/generate.ts` envuelve a 95 caracteres, y para la página 0 el corte cae exactamente adentro del teléfono:

```
"Juan Pérez vive en Belgrano 1234, DNI 34.567.891, CUIT 20-12345678-9, teléfono +54 11"
"1234-5678, email juan.perez@example.com."
```

Eso es la misma clase de caso que **ADR-074** (una entidad partida en varias líneas), implementado en el Hito 10.9 con `fragments` — o sea que el comportamiento actual puede diferir de lo que el revisor observó en julio.

**Fix (el que recomendó el revisor).** Quitar la aserción de "Teléfono": DNI + Email ya cubren lo que el Escenario 8 tiene que probar (con NER off, solo Regex detecta), y el comentario del docblock que la justifica pasa a explicar **por qué no se afirma ningún teléfono** en este fixture.

**Lo que este PR no hace, a propósito**: afirmar el teléfono real en su lugar. Requiere una corrida de Playwright contra el árbol de hoy para saber si ADR-074 ya lo arregló, y esa corrida necesita `pnpm assets:mirror` (219 MB). Queda anotado en §7 como verificación pendiente, con el diagnóstico ya hecho.

### 3.2 `tests/e2e` — `scenario-3` usa un selector sin scope

**Verificado** (`scenario-3-protected-pdf.spec.ts:82,96,103`): tres `expect(page.getByRole("button", { name: "Cerrar documento" })).toHaveCount(0)` sin acotar.

Desde PR17.7 ese nombre accesible ya no es exclusivo del banner de error: el `CloseDocumentButton` del Toolbar (ADR-051) lo tiene también, visible con `stage ∈ {Ready, Done, Failed, Cancelled}`. Hoy no rompe porque los tres checkpoints son mid-pipeline, pero es una bomba de tiempo: la aserción dice "no hay banner de error" y en realidad dice "no hay ningún botón con ese nombre en toda la página".

**Fix.** La forma robusta ya existe en el repo — `scenario-6-corrupt-pdf.spec.ts:38` acota con `errorBanner.getByRole(...)`. Se alinea `scenario-3` al mismo patrón: localizar el banner (`role="alert"`) y afirmar sobre él.

### 3.3 `tests/e2e` — `wrapText` y las constantes de layout duplicadas

**Verificado**: `tests/e2e/support/fixtures.ts:98` define su propio `wrapText`, copiado de `tests/fixtures/generate.ts:119`, más seis constantes de layout. Y sin embargo la línea 19 del mismo archivo **ya importa** `TEXT_10P_PAGES` de ese módulo.

O sea: el borde de import existe y está en uso; la duplicación no compra nada y desincroniza en silencio (`textTenPagesWithPersonFile` puede dejar de parecerse a `text-10p.pdf` sin que ningún test falle).

**Fix.** Exportar `wrapText` y las constantes de layout desde `tests/fixtures/generate.ts` e importarlas, borrando las copias. Cambio mecánico, sin cambio de comportamiento: los fixtures generados quedan byte a byte iguales.

### 3.4 `packages/anonymization-core/src` — falta el caso negativo de correlación de `PROGRESS`

**Verificado** (`__tests__/unit.test.ts:816,858`): existen la rama positiva (`PROGRESS` con `jobId` correcto llega a su `onProgress`) y la de job ya resuelto (se descarta sin lanzar). **No** existe el caso discriminante: un `PROGRESS` con un `jobId` **distinto** al del job pendiente no debe llegar a su `onProgress`.

El ADR-046 no lo pedía, pero con `nerPoolSize: 2` hay dos jobs concurrentes en vuelo y ese es el escenario donde una correlación rota se manifiesta: el progreso de carga de modelo de un worker traducido como progreso del otro.

**Fix.** Un test más junto a los otros dos, mismo patrón: se extrae el `jobId` real del `RUN` posteado (no hardcodeado, como ya hacen sus vecinos), se emite un `PROGRESS` con `jobId + "-otro"`, y se verifica que el spy no se llamó y que nada lanzó.

---

## 4. Comentarios y docstrings que hoy son falsos

Un comentario que afirma algo que el código ya no hace es peor que ningún comentario: es la trampa que ADR-049 quiso evitar para el próximo lector. Los seis están verificados como falsos contra el árbol de hoy.

| # | Archivo | Qué afirma | Qué es verdad |
|---|---|---|---|
| 4.1 | `apps/react-client/src/core-adapter/settingsToEngineConfig.ts:61-63` | que `{ workerPool: undefined }` "sí pisaría los defaults en el merge" | `mergeEngineConfig` hace spread (`{ ...base.workerPool, ...overrides.workerPool }`) y difundir `undefined` es un **no-op**. El comportamiento implementado es correcto; la razón escrita, no. Se reemplaza por la real: omitir la clave mantiene el tipo honesto bajo `exactOptionalPropertyTypes` y evita afirmar en el tipo un override que no existe. |
| 4.2 | `apps/react-client/src/components/toolbar/SettingsDialog.tsx:24-27` | que `core-adapter/index.ts` "no deriva `EngineConfig` de `settings.store` todavía, gap heredado de PR5" | Es exactamente el gap que **cerró PR16.5**. Hoy `App.tsx` llama `load()` → `deriveEngineConfigOverrides` → `initCore(overrides)`. |
| 4.3 | `packages/anonymization-core/src/worker-pool.ts:168-176` (`DispatchParams.isRetryable`) | que `PdfPasswordRequiredError` "lo marca `retryable: true`" y que "el dispatch de `pdf-parse` pasa un override acá" | PR17.1 lo puso en `false` y PR17.2 retiró el override. Las dos afirmaciones son falsas desde el mismo lote. |
| 4.4 | `packages/anonymization-core/shared/src/errors.ts:54-55` (`EngineError.deserialize`) | que "los motores específicos pueden override para devolver su subclase concreta" | **ADR-049 decidió lo contrario**: `deserialize()` no se toca y se discrimina por `code`. `Contracts.md` §4 ya tiene la redacción corregida; el código quedó atrás. |
| 4.5 | `packages/anonymization-core/ocr-engine/src/worker/kernel.ts:77-84` | que `resolveTesseractPath` es no-op "sin `self`/`self.location`" | En el hilo principal de un browser `self === window` y sí tiene `location`, así que absolutiza igual. El no-op estricto aplica solo al entorno Node de los tests. Mismo texto replicado en el header de `scenario-2-scanned-ocr.spec.ts`. |
| 4.6 | `tests/e2e/scenario-5-edit-during-ner.spec.ts:11,45` | que el fixture es `text-10p.pdf`, y que "240 s vs. 480 s" son tiempos de corrida | El fixture real es `textTenPagesWithPersonFile` (`text-10p-person.pdf`). Los dos números son presupuestos de `test.setTimeout`; los runtimes medidos por el revisor fueron ~13.8 s y ~14.7 s. El argumento (elegir el escenario más barato) se sostiene; los números citados no son lo que dicen ser. |

**Reparto por módulo (R-1)**: 4.1/4.2 y 4.6 con el PR de `apps/react-client` y el de `tests/e2e` respectivamente; 4.3 en `packages/anonymization-core/src`; 4.4 en `shared` (PR propio — es el paquete que ADR-049 explícitamente dejó afuera); 4.5 en `ocr-engine`.

---

## 5. Specs y ADRs desactualizados

Ninguno cambia un contrato: los diez corrigen documentación que describe un estado que el código ya superó. Autoría del planificador (`AI_Development_Guide.md` §7), que es el rol en el que se hacen.

| # | Documento | Corrección |
|---|---|---|
| 5.1 | `ADR-046` §7 | "sus **dos** call sites (`runDetectionStage` y `runReanalyzeNerOnFlow`)" → **tres**, agregando `runReanalyzeOcrFlow`. Errata fáctica: el implementador de PR15 aplicó la misma transformación a los tres (omitir el tercero habría reintroducido el retry duplicado en el flujo de reanalyze por OCR) y el revisor lo confirmó. |
| 5.2 | `ADR-047` §2 | `maxQueue: EXPORT_QUEUE_LIMIT` → `maxQueue: 8`. El nombre sugiere una constante publicada en `Contracts.md` §6 que **no existe** (`MAX_QUEUE_PER_POOL` solo lista `{pdf, ocr, ner, render}`), cosa que el propio ADR-047 §2 dice dos párrafos después. |
| 5.3 | `Components.md` §2.1 vs §2.4 | §2.1 agrega "(+ `CancelButton` si hay jobs remanentes)" en la fila `{Ready, Done}`; §2.4 dice `stage ∉ {Idle, Done, Failed, Cancelled}` sin ese matiz. No hay ningún campo en `pipeline.store` que represente "jobs remanentes" y ninguno planificado. Se elimina el matiz de §2.1 y se anota por qué, que es lo que `CancelButton.tsx:4-9` ya implementa y documenta. |
| 5.4 | `OCR_Engine.md` §14 | Faltan las dos filas de los tests de PR17.6 (`worker-entry.test.ts:333` y `:369` — `workerPath` al archivo, y absolutización contra `self.location.origin`). `Render_Engine.md`/`Orchestrator.md` sí listan los suyos. |
| 5.5 | `Orchestrator.md` §2 (línea 62) y `06_Pipeline.md` §73/§196 | Describen `loadDocument(documentId, buffer)` en prosa. Desde **ADR-050** la firma tiene un tercer parámetro opcional `password`. No es incorrecto (es opcional) pero deja fuera de la prosa la pieza que ADR-050 agregó. |
| 5.6 | `Orchestrator.md` items 19/20/21 y `PDF_Engine.md` items 20/21 | Checkboxes `[ ]` sin marcar pese a estar implementados y aprobados (PR12, 17.1, 17.2, 17.5, 17.8). |
| 5.7 | `07_Performance_Strategy.md` §11.3 item 4 | El item 7 recibió su nota de reparto ("el E2E ejercita el flujo; la métrica es del gate `test:leak`"); el item 4 tiene el mismo reparto (el SLA de 200 ms es de `tests/cancel/`, Hito 11) y **no** la nota, así que el spec se lee como incumplido por el Escenario 4. |
| 5.8 | `tests/fixtures/README.md` | "Entidades esperadas" lista 1 CUIT, 1 Teléfono, 1 IBAN y 1 Tarjeta que el pipeline **no** produce: el CUIT falla su checksum AFIP a propósito, el teléfono queda partido por el wrap a 95 caracteres, y con NER off el IBAN y la tarjeta de la página 2 tampoco aparecen. Se corrige la tabla a lo que el motor de verdad detecta, con la razón de cada ausencia. Insumo directo del dataset de referencia del Hito 11. |
| 5.9 | `tests/e2e/README.md` | **No existe**. Es el único item de ADR-048 que no se entregó. El prerequisito (`pnpm assets:mirror` antes de `test:e2e`) sí quedó documentado en `07` §11.4 y en `tests/fixtures/README.md`, así que no se perdió información — pero el directorio que lo necesita no lo dice. |
| 5.10 | `React_Client.md` §2 | El árbol de `core-adapter/` lista 4 archivos; hay 5 desde PR16.5 (`settingsToEngineConfig.ts`). |
| 5.11 | `08_Security_Model.md` §6.3 y `ADR-050` §3 | La lista enumerada del grep de password tiene dos huecos verificados: `ImportDocumentInput.password` / `retryWithPassword` en `shared/src/types.ts`, y el filtro `grep -v` no cubre los identificadores PascalCase (`PdfPasswordRequiredError`). Se cierran los dos en la lista. **La automatización del grep como gate de CI no entra acá** — ver §7. |
| 5.12 | `Orchestrator.md` §14 | El test del caso 24 se llama `"loadDocument failure during export emits PIPELINE_FAILED, no hang"`, pero desde el fix de PR13 dispara vía `getSnapshot` (`loadDocument` ya no puede fallar durante el export de un documento recién importado). El mecanismo que prueba sigue siendo el correcto; el nombre quedó más específico que su disparador. Se relabela. |

---

## 6. Necesita ADR — **no se toca nada de esto**

Trece observaciones no se pueden resolver sin decidir antes algo que ningún doc decide. Por R-2/R-19 (contrato primero, código después) y R-12 (sin dependencias nuevas sin ADR), quedan acá, sin implementación, para decisión del humano. La explicación de **por qué** cada una necesita ADR está en la columna derecha.

### 6.1 Cambian un contrato público de `Contracts.md` / `03_Data_Model.md`

| # | Observación | Por qué necesita ADR |
|---|---|---|
| **A** | **Atajos "Usar Regex"/"Usar NER" en `ConflictDialog`** (PR8; `UX_Guidelines.md` §6 los menciona) | `ConflictResolveRequested` transporta hoy `{documentId, conflictId, mode: ReplacementMode}`. **No hay forma de expresar "qué fuente ganó"** sin agregar un campo al payload del evento, que está publicado en `Contracts.md` y `04_Event_System.md` §10. Cambio de contrato ⇒ ADR + docs antes que código (R-2/R-19). |
| **B** | **"Ver ocurrencias" en el panel de entidades** (PR8) | `OccurrenceRef` (`03_Data_Model.md` §8) tiene `pageIndex` y `bbox` pero **no** `value`. Mostrar el texto de cada ocurrencia obliga a agregar el campo — y eso arrastra una decisión de privacidad, no solo de tipos: `08_Security_Model.md` §7 prohíbe loguear `Occurrence.value`, así que ampliar el ref a valores de documento tiene que decidirse explícitamente. |
| **C** | **Indicador "editado manualmente"** (punto azul, `UX_Guidelines.md` §3.3) | El dato **ya existe** desde ADR-076: `replacementValueUserSet` en `grouping.engine.ts:266`. Pero es `InternalGroup`, bookkeeping interno **nunca expuesto** — exactamente como ADR-069 §5 hizo con `personGenderUserSet`. Exponerlo en `EntityGroup` invierte esa decisión deliberada de dos ADRs, así que la revierte un ADR, no un PR. |
| **D** | **`dropOccurrences` para el caso "el grupo sobrevive"** (PR2) | Verificado: `ConflictCandidate` (`shared/src/types.ts:250`) sigue teniendo solo `{source, entityType, confidence, value}` — sin `occurrenceId` ni `bbox`, no hay forma de detectar que un `candidate` puntual referenciaba una ocurrencia eliminada. **Hay dos salidas y son incompatibles**: (i) ampliar `ConflictCandidate` (ADR + `Contracts.md`), o (ii) acotar la redacción de `03_Data_Model.md` §13.25 y ADR-038 §2 a lo estructuralmente posible. Elegir entre "arreglar el código" y "arreglar la promesa" es precisamente lo que un ADR decide; hacerlo por cuenta propia sería improvisar. |
| **E** | **Evento de confirmación/rechazo de reglas** (PR9) | `core-adapter/actions.ts` muta `rules.store` directo además de emitir al bus, porque los tres `RULE_*` son UI→Grouping sin evento de vuelta. Si Grouping alguna vez rechazara una regla, el store divergiría en silencio. Cerrarlo es **un evento nuevo** en `04_Event_System.md` §6/§10 ⇒ ADR. |
| **F** | **`EngineErrorCode` para "crash de transporte"** (PR11, deuda explícitamente diferida) | `handleWorkerTransportError` rechaza con `InvalidInputError` porque **no existe** un code para crash de worker (verificado contra `shared/src/enums.ts`: todos son por-motor o 4 genéricos que no encajan) — y con esa clasificación nunca reintenta, contra lo que `05_Worker_Architecture.md` §9 promete. Agregar un `EngineErrorCode` es cambio de `Contracts.md` (I-4/R-19). El humano ya difirió esto una vez, a los PR12-16; los PR12-16 ya pasaron. |

### 6.2 Agregan una dependencia externa

| # | Observación | Por qué necesita ADR |
|---|---|---|
| **G** | **`GroupContextMenu` sobre `@radix-ui/react-dropdown-menu`** (PR8) | `Components.md` §13.7 pide que los interactivos pasen por wrappers de Radix; el menú está hand-rolled y por eso no tiene navegación por flechas ni gestión de foco. Agregar la dependencia es **prohibición absoluta sin ADR** (P-9/R-12). La decisión tiene dos salidas legítimas —agregar la dep, o sancionar formalmente el hand-roll y ajustar §13.7—, y ninguna es obvia. |

### 6.3 Cambian una invariante de transporte ya sancionada por un ADR

| # | Observación | Por qué necesita ADR |
|---|---|---|
| **H** | **`ArrayBuffer` "transferido" es structured clone, no transfer real** (PR16) | Ni el helper `post()` que comparten los cinco entry-points ni `WorkerPool.dispatchRemote` pasan transfer list, pese a que los specs y ADR-047 dicen "transferido". El fix **no es mecánico**: un transfer real *detacha* el buffer en el emisor, que es exactamente la causa raíz del bug #6 del PR10 (buffer detachment en `runExport`). Decidir qué buffers son seguros de transferir, por payload, es diseño de transporte ⇒ ADR. Además toca los 5 módulos a la vez (R-1/R-5). |
| **I** | **`save` no es idempotente ante un timeout del host** (PR16, ADR-047 §4) | `append-page` sí lo es por diseño; `save` no: si el host lo da por perdido pero el worker lo completó, el worker ya limpió su estado y el reintento choca con `ExportFailedError`. La simetría natural (que el worker retenga el último `ArrayBuffer` serializado por `documentId`) **cambia el contrato de estado del ExportWorker** que ADR-047 fijó ("ensamblador de un documento a la vez, limpieza tras `save`") ⇒ enmienda de ADR-047. |
| **J** | **Idle-dispose de los pools construidos por el façade** (deuda del Hito 10) | Los cuatro pools (render/ocr/ner/export) perdieron el temporizador de 60 s de `05_Worker_Architecture.md` §8 al salir de `WorkerPoolManager`. Restaurarlo obliga a decidir **quién es el dueño del temporizador** ahora que cada motor tiene su pool, y qué pasa con un `Worker` liberado a mitad de un ciclo `load-document`/re-priming (ADR-043 §5). Toca `create-core.ts` + cuatro motores ⇒ ADR. |
| **K** | **Sancionar el patrón `NerDispatchDecodeFailure`** (PR A1, recomendación del revisor) | Es un patrón de manejo de errores nuevo, sin ADR propio (R-18), que hoy vive **solo como comentario** en `ner.engine.ts:396-410`. ADR-055 §7 deja los otros cuatro motores como serie de endurecimiento pendiente, y van a copiarlo. Enmendar ADR-055 para dejarlo escrito **antes** de que se replique cuatro veces es más barato que corregirlo después en cinco lugares. |
| **L** | **Gap de `reanalyze` con patch combinado `{ner, ocr}`** (PR3) | `SettingsDialog` lo mitiga emitiendo dos llamadas secuenciales (y esa mitigación sigue viva, verificada en `SettingsDialog.tsx:151-155`), pero el gap del Core sigue abierto: un patch combinado no logra la equivalencia con una corrida fresca en dos sub-casos, y **ADR-038 §5.4 no los detalla**. Cerrarlo es definir semántica de `reanalyze` que ningún doc define; la alternativa (rechazar el patch combinado) es un cambio de precondición publicada. Cualquiera de las dos ⇒ ADR. |
| **M** | **pdf.js degrada a "fake worker" dentro de todo Web Worker** (bug 3 del cierre) | Confirmado como limitación de `pdfjs-dist@4.10.38` (`PDFWorker._initialize` referencia `window`, que no existe en un Worker). Solo cuesta rendimiento. El único workaround conocido es **definir un `window` mínimo en el scope global del worker antes de importar pdf.js**: un monkey-patch sobre una librería de terceros, que el propio documento original ya marcó como "no debe aplicarse sin ADR propio". Candidato natural a Hito 11, cuando el render sea el cuello de botella. |

### 6.4 Decisión abierta que no es ni bug ni ADR de contrato

| # | Observación | Qué hace falta |
|---|---|---|
| **N** | **`viewer.store.sideBySide`** (`React_Client.md` §3.5, default `true`) | Declarado, sin setter y sin consumidor desde PR7. **ADR-054 §7 decidió no reutilizarlo** para el control de sincronización (que usa un campo propio), pero no decidió qué hacer con él. Quedan dos salidas: cablearlo a algo, o **eliminarlo del store y del spec**. Es una línea de código en cada lado; lo que falta es que alguien elija. No es ADR (no hay contrato de motor en juego), es una decisión de producto de una línea — por eso está acá y no en §6.1. |

---

## 7. Verificaciones pendientes que este plan no puede cerrar

Dos cosas quedan anotadas, sin acción, porque necesitan una corrida que este PR no puede hacer:

1. **¿El teléfono real de `text-10p.pdf` se detecta hoy?** El diagnóstico está cerrado (§3.1: partido en dos líneas por el wrap a 95 caracteres), pero saber si **ADR-074** ya lo arregló exige correr el Escenario 8 contra el árbol de hoy, y eso exige `pnpm assets:mirror` (219 MB, de los cuales 178 MB son el modelo NER). Si resulta que sí se detecta, la aserción que §3.1 quita puede volver **apuntando al teléfono real**, que es la que el test siempre quiso tener.

2. **Automatizar el grep de `08_Security_Model.md` §6.3 como gate de CI.** Hoy está documentado y **no es ejecutable** — se verifica a mano. §5.11 cierra los dos huecos de la lista enumerada, que es la mitad barata. La otra mitad (script + fila en la tabla canónica de gates de `07` §11.4 + paso en `ci.yml`) **no necesita ADR**, pero sí necesita que el humano acepte un gate nuevo que puede poner CI en rojo por un falso positivo de grep. Se propone, no se hace.

---

## 8. Reparto en PRs

Un PR por módulo, R-1/R-5:

| PR | Módulo | Contenido |
|---|---|---|
| **O1** | `docs/` | §5 completo (las 12 correcciones de spec/ADR) + este documento. Va **primero**: docs antes que código, patrón del repo. |
| **O2** | `apps/react-client` | §2.1, §2.2, §2.3 (los tres bugs) + §4.1, §4.2 (comentarios falsos del mismo módulo). |
| **O3** | `packages/anonymization-core/src` | §3.4 (test de correlación de `PROGRESS`) + §4.3 (JSDoc de `isRetryable`). |
| **O4** | `packages/anonymization-core/shared` | §4.4 (comentario de `deserialize`). PR propio: es el paquete que ADR-049 dejó explícitamente afuera, por R-1. |
| **O5** | `packages/anonymization-core/ocr-engine` | §4.5 (comentario de `resolveTesseractPath`). |
| **O6** | `tests/e2e` + `tests/fixtures` | §3.1, §3.2, §3.3 + §4.6 + el `README.md` de §5.9. |

**Gates por PR** (`07` §11.4): `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`. El PR **O6** no puede correr `pnpm test:e2e` en este entorno (assets no mirroreados) — sus cambios son de selector, de comentario y de import, todos verificables por typecheck y lectura; queda anotado que la corrida real de Playwright es el cierre pendiente de ese PR.
