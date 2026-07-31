<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/NER_Engine.md,architecture/05_Worker_Architecture.md,ai/Code_Standards.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-042-WorkerOutbound-Completed-Result-Unknown.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md,adr/ADR-045-OcrEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-046-NerEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-047-ExportEngine-Ensamblador-Worker-Dedicado.md,adr/ADR-049-Errores-Cruzando-Worker-Discriminacion-Por-Code.md | audiencia=humanos+IA | fase=10-cierre -->

# ADR-055 — El resultado que cruza un Worker se decodifica con un guard, nunca con un cast

- **Estado**: Accepted
- **Fecha**: 2026-07-31
- **Decidido por**: El planificador, sobre un bug crítico que el humano reportó probando la app ("dejó de detectar entidades") y que el planificador rastreó hasta un desajuste de sobre entre el `NerWorker` y su host. El humano eligió explícitamente escribir el ADR **antes** del fix, para que el fix nazca en la forma definitiva.
- **Relacionado con**: ADR-042 (que hizo `COMPLETED.result` un `unknown` a nivel de transporte — este ADR es su otra mitad, la del consumidor), ADR-049 (mismo problema en el canal de **errores**: la identidad de clase no sobrevive al `postMessage`, y se resolvió discriminando por `code`), ADR-043/045/046/047 (los cuatro repartos host/worker que crearon los puertos internos que este ADR angosta), ADR-036 §2/§3 (el transporte)

> Convención de citas: `ADR-055 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-055, Contexto §N`.

## Contexto

### 1. El bug: NER no detecta absolutamente nada, en silencio

Desde que los motores pasaron a Web Workers reales, al escanear un PDF de texto solo aparecen las entidades de Regex. Ninguna de NER —personas, ubicaciones— llega nunca a la UI. Sin error visible, con el pipeline llegando a `Ready` normalmente.

La cadena, leída en el código:

1. `ner-engine/src/worker/entry.ts:104` postea `COMPLETED` con `result: { spans }`. Eso es **correcto**: es lo que manda ADR-046 §1 y lo que documenta el comentario de `NerKernelSpan` en `shared/src/types.ts`.
2. `ner.engine.ts:526` tipa el despacho como `ReadonlyArray<NerKernelSpan>` y en la línea 535 itera el resultado directo.
3. `WorkerPool.dispatch` resuelve con `resolve(result as TResult)` (`worker-pool.ts:509`, y el `COMPLETED` en la 662): un cast a ciegas sobre un valor que acaba de cruzar un `postMessage`.
4. En modo remoto llega el objeto `{ spans }` → `for...of` sobre algo no iterable → **`TypeError`**.
5. Ese error no es un `EngineError`, así que `normalizeNerError` lo deja pasar tal cual; no es `NerTimeoutError`, así que no se reintenta; termina en `NerPageFailedError`, que `processPages` traga con `ctx.logger.warn` (`ner.engine.ts:423`) — y el logger de producción es el nulo (P-4).

Resultado: once páginas fallando una por una sin dejar rastro, `NER_FINISHED` con `occurrenceCount: 0`, y una UI que se ve sana.

Los otros cuatro motores no tienen el bug hoy: OCR, PDF, Render y Export postean `result` pelado y sus hosts lo consumen con la misma forma. NER es el único que envuelve — por decisión de ADR-046 §1, que es la correcta: el host es quien tiene las `Word[]` para mapear spans a `Occurrence`.

### 2. El bug no es el problema; el problema es que nadie podía detectarlo

El bug pasó los 911 tests, los 203 de contrato y los 12 escenarios E2E. No por casualidad:

- Los unit de `ner-engine` usan pools fake que ejecutan `run()`, o sea el camino in-process, que devuelve el array pelado. **Nunca cruzan el sobre.**
- `worker/__tests__/entry.test.ts:291` assertea `expect(viaWorker).toEqual({ spans: viaDirect })`: testea el sobre y lo da por bueno, sin nadie del otro lado que lo abra.
- El E2E tampoco: el Escenario 1 dice textualmente que assertea un DNI de Regex *"sin depender de NER"*; los Escenarios 5 y 9 assertan sobre `NER_MODEL_LOADING`, que viaja por el canal `PROGRESS` y **sí** funciona; y el Escenario 8 assertea **ausencia** de entidades NER, así que pasa igual de verde con el bug presente.

**No existe, en ningún nivel de la pirámide, un test que verifique que una entidad detectada por NER llega a la UI.** Ese es el agujero de fondo, y es más grave que el bug puntual.

### 3. Es una clase, no un caso

`dispatch<T>` deja que cada motor **declare** el tipo que espera y TypeScript se lo cree. El parámetro de tipo es una afirmación que el compilador no puede verificar, porque del otro lado hay un `postMessage`. Los cinco motores comparten ese cast.

Hoy solo NER lo rompe. Nada impide que el próximo cambio de forma en cualquiera de los otros cuatro vuelva a producir un fallo mudo idéntico, y el revisor no lo vería porque el tipo *parece* correcto en el call site.

ADR-042 ya había hecho la mitad del trabajo —declarar `COMPLETED.result` como `unknown` a nivel de transporte— pero no obligó a nadie a tratarlo como tal del lado del consumidor. Y ADR-049 resolvió exactamente este mismo problema para el canal de **errores** (la identidad de clase no sobrevive al boundary; se discrimina por `code`). Este ADR es el equivalente para el canal de **resultados**.

### 4. Un ADR que solo enuncie el principio no sirve

"Decodificá con un guard" es una regla que hay que recordar. Dentro de seis meses alguien escribe `dispatch<Foo>(...)`, el revisor no lo nota, y estamos igual. La única forma de que la regla no se erosione es que **el compilador la imponga**.

## Decisión

### 1. Invariante

Ningún valor que haya cruzado la frontera de un Worker se consume sin decodificar. Decodificar significa **verificar la forma en runtime**, no afirmarla con un tipo.

Aplica al `result` de `COMPLETED` y a cualquier `partial` de `PROGRESS` que un motor interprete. El canal de errores ya está cubierto por ADR-049.

### 2. Mecanismo: cada motor angosta su propio puerto a `unknown`

Los puertos internos de despacho —`NerJobPool` (`ner.engine.ts:176`), `OcrJobPool`, `RenderJobPool` y el equivalente de Export— dejan de ser genéricos y pasan a devolver `Promise<unknown>`.

A partir de ahí **el compilador obliga a decodificar**: no hay forma de escribir el consumidor sin pasar por un guard, porque `unknown` no se puede iterar, indexar ni desestructurar.

Tres propiedades que hacen que esto sea implementable sin romper nada:

- **Esos puertos viven dentro del archivo de su motor.** No hay que tocar `worker-pool.ts` ni el façade, así que cada motor se migra en su propio PR sin violar R-1/R-5.
- **`create-core.ts` no cambia.** `WorkerPool.dispatch<TResult>` es genérico; contra un puerto que declara `Promise<unknown>` instancia `TResult = unknown` y sigue siendo asignable. La inyección compila igual.
- **El fallback in-process queda cubierto por el mismo decoder.** Sin pool real, el puerto devuelve lo que produce `run()` (el array pelado, en NER); con pool real devuelve el sobre. El decoder acepta las dos formas, y eso **es** la prueba de paridad entre los dos caminos.

### 3. Qué hace el decoder ante una forma inesperada: lanzar

Un decoder que ante algo que no reconoce devuelva `[]`, `undefined` o un default **está prohibido**. Ese es literalmente el modo de falla de Contexto §1: el sistema siguió funcionando y no detectó nada durante semanas.

Ante una forma que no matchea, se lanza un `EngineError` de la subclase que corresponda (`InvalidInputError` si no hay una específica — nunca un `Error` genérico, `Code_Standards.md` §7). Que falle ruidosamente es el punto.

### 4. NER es el primer adoptante, y ahí se arregla el bug

El PR de `ner-engine` angosta `NerJobPool`, escribe el decoder y con eso el bug de Contexto §1 desaparece.

**El worker no se toca.** `{ spans }` es el contrato correcto (ADR-046 §1, `shared/src/types.ts`), y R-21 prohíbe editar el spec de un motor desde un PR de implementación. El decoder acepta `{ spans: [...] }` (camino remoto) y `[...]` (camino in-process), y lanza ante cualquier otra cosa.

### 5. Test de sobre, obligatorio por motor

Cada motor migrado incorpora un test que **cruza el sobre**: un pool fake que **ignora `run()`** y resuelve exactamente lo que postea el `entry.ts` de ese motor. Es la pieza que no existía y que habría detectado el bug el día que se introdujo.

Más, por motor: el mismo fake resolviendo la forma del camino in-process (paridad), y el fake resolviendo basura (`{}`, `null`, un string) verificando que se lanza y que el error **no** se traga en silencio aguas arriba.

### 6. Y el agujero de fondo: un E2E que verifique una entidad NER en la UI

Independiente del mecanismo, y no negociable: tiene que existir al menos un escenario E2E que assertee que **una entidad detectada por NER aparece en el panel de Entidades**. Hoy no hay ninguno (Contexto §2).

El candidato natural es el Escenario 9, que ya espera a que NER haya corrido de verdad. Requisitos: el fixture tiene que contener un nombre de persona inequívoco, y la aserción tiene que ser sobre la existencia de **al menos un grupo de tipo Persona**, no sobre un valor puntual.

Salvedad honesta: esa aserción depende del comportamiento de un modelo real, que no es perfectamente determinista entre versiones. Si resulta inestable, el reemplazo **no** es borrarla sino bajarla un nivel: un test de integración a nivel de façade con un worker stub que emita el sobre real y verifique que `ENTITY_FOUND` llega al bus. Lo que no puede volver a pasar es que no haya nada.

### 7. Los otros cuatro motores: serie de endurecimiento, sin urgencia

Ninguno tiene el bug hoy. Su migración al puerto `unknown` es un PR por motor (R-1), sin fecha, después de que el de NER cierre. El valor es preventivo: cuando lleguen, el compilador ya no deja escribir el bug.

### 8. Qué **no** cambia

`worker-pool.ts` no se toca: sigue exponiendo `dispatch<TResult>` genérico y resolviendo con el cast. Es la capa de **transporte**, y el transporte no sabe qué forma tiene el payload de cada motor — pretender que lo sepa sería meterle conocimiento de dominio. La responsabilidad de decodificar es del motor, que es el único que conoce el contrato de su propio worker.

ADR-042 queda intacto (este ADR lo completa, no lo revisa). ADR-046 §1 queda intacto: el sobre `{ spans }` es correcto. ADR-049 no se toca: los errores se siguen discriminando por `code`. Ningún contrato público, evento ni payload cambia. `entry.ts` de ningún motor se toca.

### 9. Alcance

| # | PR | Módulo | Prioridad |
|---|---|---|---|
| 1 | Puerto `unknown` + decoder + tests de §5; arregla el bug de Contexto §1 | `ner-engine` | **Crítica** |
| 2 | E2E que verifica una entidad NER en la UI (§6) | `tests/e2e/` | Alta |
| 3-6 | Mismo patrón, uno por motor | `ocr-engine`, `render-engine`, `pdf-engine`, `export-engine` | Preventiva, sin fecha |

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **Arreglar NER y no escribir el ADR** | Deja viva la clase (Contexto §3): los cinco motores comparten el cast y nada impide que vuelva a pasar con un fallo igual de mudo. |
| **Un ADR que solo enuncie "decodificá con un guard"** | Es una regla que hay que recordar; no impide escribir el bug (Contexto §4). El mecanismo es la decisión, no el principio. |
| **Que el worker postee el array pelado** | Contradice ADR-046 §1 y el comentario de `NerKernelSpan` en `shared/src/types.ts`; exigiría enmendar un ADR aceptado para acomodar un bug del consumidor. Y no cierra la clase: el próximo motor que envuelva vuelve al mismo lugar. |
| **Decodificar centralizado en `worker-pool.ts`** | El transporte no conoce el contrato de cada motor; meterle esa lógica lo acopla a los cinco. Además tocaría un archivo compartido por todos, o sea un PR que cruza cinco motores (R-1/R-5). |
| **`dispatch` con un parámetro `decode` obligatorio** | Cambia la firma de `worker-pool.ts` y con ella los cinco call sites en un solo PR: mismo choque con R-1. El puerto por motor logra lo mismo sin tocar nada compartido (§2). |
| **Validar con un schema (zod o similar)** | Dependencia externa nueva (R-12) para lo que son guards de treinta líneas, en un Core que no tiene dependencias de validación. |

## Consecuencias

**Positivas**: NER vuelve a detectar; la clase de bug queda cerrada **por tipos** y no por disciplina; el fallo mudo se convierte en un fallo ruidoso; y el sistema gana la prueba que le faltaba —que una entidad NER llega a la UI— sin la cual cualquier regresión futura de la misma familia volvería a ser invisible.

**Negativas**: un decoder por motor (treinta líneas, más sus tests) que a un lector desprevenido le va a parecer ceremonia sobre un valor "que obviamente tiene esa forma" — de ahí que cada uno lleve comentario a este ADR. Y cuatro PRs preventivos sobre motores que hoy no tienen ningún bug, con el costo de revisión que eso implica.

**Neutras**: ningún contrato público, evento ni payload cambia; `worker-pool.ts` y los `entry.ts` quedan intactos; ADR-042, ADR-046 §1 y ADR-049 se conservan.

## Docs actualizados por este ADR

- `core/NER_Engine.md`: nota de versión + el decoder y los tests de §5 en la sección de tests.
- `architecture/05_Worker_Architecture.md`: el invariante de §1 junto a la descripción de `COMPLETED`.
- `ai/Code_Standards.md`: la regla de §3 (un decoder nunca devuelve un default en silencio) junto a las de manejo de errores.
- `adr/ADR-042`: nota de que su `unknown` de transporte tiene ahora una obligación correspondiente del lado del consumidor.
- `roadmap/MVP.md` y `roadmap/Hito10_Observaciones_Revision.md`: los PRs de §9.

## Validación

- Los tests de §5 verdes en `ner-engine`, en particular el de sobre remoto: revirtiendo el decoder, ese test tiene que fallar. Si no falla, el test no está probando lo que dice.
- El E2E de §6 verde, con una entidad de tipo Persona visible en el panel.
- Verificación manual: cargar el PDF de prueba del humano y confirmar que aparecen personas y ubicaciones, no solo la patente de Regex.
- Grep de control: ningún `as` sobre el resultado de un `dispatch` en el motor migrado.
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`, más el piso de cobertura de `ner-engine`.

## Referencias

- `core/Contracts.md` §4 — `core/NER_Engine.md` §14 — `architecture/05_Worker_Architecture.md` §2 — `ai/Code_Standards.md` §7
- `adr/ADR-036` §2-§3 — `adr/ADR-042` — `adr/ADR-046` §1 — `adr/ADR-049`
- Código: `packages/anonymization-core/ner-engine/src/ner.engine.ts:176` (`NerJobPool`), `:497-545` (`runInferenceInBatches`), `:423` (el `warn` que traga) — `packages/anonymization-core/ner-engine/src/worker/entry.ts:104` — `packages/anonymization-core/src/worker-pool.ts:509,662` — `packages/anonymization-core/shared/src/types.ts` (`NerKernelSpan`) — `tests/e2e/scenario-1-import-edit-export.spec.ts:9`, `scenario-8-ner-disabled.spec.ts`, `scenario-9-ner-runtime-reanalyze.spec.ts`
