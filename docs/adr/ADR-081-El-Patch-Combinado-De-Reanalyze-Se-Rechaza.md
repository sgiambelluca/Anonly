<!-- CONTEXT: scope=adr | dependencias=core/Orchestrator.md,core/Contracts.md,architecture/06_Pipeline.md,ui/React_Client.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md | audiencia=humanos+IA | fase=post-10.9 -->

# ADR-081 — Un `reanalyze` con `ner` y `ocr` a la vez se rechaza en vez de resolverse mal

- **Estado**: Accepted
- **Fecha**: 2026-08-19
- **Decidido por**: El humano, al revisar las observaciones no bloqueantes del Hito 10 (`roadmap/Hito10_Observaciones_Plan_De_Resolucion.md` §6.3 punto L, gap abierto desde el PR3 del Hito 10).
- **Relacionado con**: **ADR-038 §5 regla 4**, que este ADR enmienda. `reanalyzePlan.ts` (la mitigación de UI que ya existe y se conserva).
- **Parte de**: cierre de las observaciones del Hito 10.

> Convención de citas: `ADR-081 §N` refiere a **Decisión §N**.

## Contexto

### 1. La regla 4 de ADR-038 §5 promete una equivalencia que el código no da

ADR-038 §5 regla 4 dice, textualmente:

> **Patch combinado** (`ner` + `ocr`): se ejecuta como el flujo 3 con la config NER final (el orden es OCR → detección; la unión de las reglas anteriores).

"La unión de las reglas anteriores" es lo que no ocurre. Verificado en `orchestrator.ts:386-394`:

```ts
if (ocrChanged) {
  await this.runReanalyzeOcrFlow(documentId, ctx, nextEffective);
} else if (nextEffective.ner.enabled) {
  await this.runReanalyzeNerOnFlow(documentId, ctx);   // Caso 18
} else {
  await this.runReanalyzeNerOffFlow(documentId);        // Caso 19
}
```

Si ambos cambiaron se entra **solo** por la primera rama. Los flujos 1 y 2 —los que tratan el documento **completo**— nunca corren. Y `runReanalyzeOcrFlow` está escrito, correctamente, para tocar **solo las páginas re-OCR**.

### 2. Los dos sub-casos rotos, con lo que ve el usuario

**A. `{ocr: [...], ner: {enabled: false}}`** — el usuario cambia los idiomas de OCR y apaga NER en el mismo "Guardar".

`runReanalyzeOcrFlow` corre con `nextEffective.ner.enabled === false`, así que no re-corre NER sobre las páginas re-OCR. Correcto hasta ahí. Pero **nunca ejecuta el `dropOccurrences(documentId, { source: DetectionSource.NER })`** que es el corazón del flujo 2 (caso 19). Resultado: las páginas de texto nativo **conservan todas sus entidades NER**.

> El usuario apagó NER y el panel sigue mostrando personas, organizaciones y direcciones en las páginas que no eran escaneadas. Si exporta, esas entidades se censuran igual.

**B. `{ocr: [...], ner: {enabled: true}}`** — cambia idiomas de OCR y enciende NER.

`runReanalyzeOcrFlow` corre NER **solo sobre las páginas re-OCR** (es la regla 3 de ADR-038 §5, y es lo correcto *para esa regla*: las demás páginas "conservan sus ocurrencias NER válidas"). Pero NER venía **apagado**, así que las páginas de texto nativo no tienen ocurrencias NER válidas: no tienen ninguna, nunca pasaron por el motor.

> El usuario encendió NER y solo aparecen entidades en las páginas escaneadas. Las de texto nativo —normalmente la mayoría del documento— quedan sin detectar, sin ningún error.

Los dos fallan **en silencio**: el pipeline llega a `Ready`, no hay evento de fallo, y el estado resultante es indistinguible a simple vista de uno correcto.

### 3. La única UI que existe ya no lo dispara — y eso es parte del problema

`SettingsDialog` emite **dos llamadas secuenciales** (`reanalyzePlan.ts:35-36`: primero `{ocr}`, después `{ner}`), y cada una entra por su flujo completo. La mitigación es correcta y funciona.

Pero es una propiedad de un componente de UI, no del Core. El gap sigue vivo para cualquier otro consumidor: un test de integración, una automatización futura, o el próximo diálogo que alguien escriba sin leer el comentario de `reanalyzePlan.ts`. Y el spec sigue prometiendo que el patch combinado funciona, así que quien lo lea no tiene motivo para sospechar.

### 4. Por qué esto es un ADR y no un fix

Hay dos salidas y son incompatibles:

- **Implementar la equivalencia**: `runReanalyzeOcrFlow` tendría que aceptar además el tratamiento de documento completo del flujo 1 o 2 según el caso. Es reescribir el flujo más complejo del Orchestrator para un caso que ningún consumidor produce.
- **Rechazar el patch combinado**: cambia una **precondición publicada** de `IPipelineOrchestrator.reanalyze`, o sea el contrato.

Cualquiera de las dos toca lo que ADR-038 §5 promete. No hay opción que no requiera decidir.

## Decisión

### 1. `validateReanalyzePatch` rechaza el patch combinado

Si el patch trae `ner` **y** `ocr` a la vez, `reanalyze` rechaza con `InvalidInputError` antes de tocar nada:

```
"ReanalyzeConfigPatch con 'ner' y 'ocr' a la vez no está soportado:
 enviá un patch por campo, OCR primero (ADR-081)."
```

El mensaje dice **qué hacer**, no solo qué está mal: es la única forma de que quien lo reciba no tenga que leer este ADR para desbloquearse.

La validación va en `validateReanalyzePatch`, junto a las que ya existen, o sea **antes** de `effectiveConfigByDocument.set` y antes de cualquier transición de stage. Un patch rechazado no deja ningún efecto: ni config efectiva actualizada, ni evento, ni cambio de stage.

### 2. Por qué rechazar y no implementar

- **Ningún consumidor lo produce.** La única UI ya emite dos patches, y lo hace desde el PR6 del Hito 10.
- **Un rechazo ruidoso es estrictamente mejor que un resultado silenciosamente incorrecto.** Hoy el modo de falla es "el documento queda mal anonimizado y nadie se entera" — en una pericia judicial, ese es el peor modo de falla posible.
- **La equivalencia se obtiene componiendo**, no reimplementando: dos llamadas secuenciales dan exactamente el resultado que la regla 4 promete, con código que ya existe y ya está testeado.
- El costo de la alternativa (reescribir `runReanalyzeOcrFlow` para absorber los flujos 1 y 2) es alto y su beneficio es ahorrarle un `await` a un caller hipotético.

### 3. El orden queda documentado, no impuesto

El Core no puede forzar "OCR primero": son dos llamadas independientes. Lo que sí hace es **decirlo** — en el mensaje de error, en `Orchestrator.md` §6 y en `React_Client.md` §3.7.

El orden importa: `{ocr}` primero re-OCR-ea y re-detecta las páginas afectadas con la config NER **vigente**; `{ner}` después aplica el cambio de NER al documento **completo**, incluidas las páginas que el OCR acaba de reescribir. Al revés, el flujo de NER corre sobre un texto que el OCR posterior va a invalidar.

### 4. Qué NO cambia

- **Los tres flujos** (`runReanalyzeOcrFlow`, `runReanalyzeNerOnFlow`, `runReanalyzeNerOffFlow`) quedan **intactos**. Este ADR no toca ninguno: solo hace inalcanzable la combinación que los saltea.
- **`ReanalyzeConfigPatch` no cambia de forma.** Los dos campos siguen siendo opcionales; lo que cambia es la precondición de que no vengan juntos. Se documenta en el tipo, no se codifica con una unión discriminada (ver Alternativas).
- **`SettingsDialog` no cambia.** Su comentario deja de describir una "mitigación de una limitación conocida" y pasa a describir el uso normal de la API.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **Implementar la equivalencia real** (que el flujo de OCR absorba el tratamiento de documento completo) | El caso B obliga a correr NER sobre el documento entero después del OCR, que es el flujo 1 completo; el caso A obliga al `dropOccurrences` por source del flujo 2. O sea, reescribir el flujo más complejo del Orchestrator, con su cancelación y su preservación de ediciones, para un caller que no existe. |
| **Tipar la exclusión** (`{ner: X, ocr?: never} \| {ocr: Y, ner?: never}`) | Atrapa el error en compilación, que es mejor… salvo que el caller real es la UI, que arma el patch dinámicamente desde un diff — ahí la unión no ayuda y solo complica la firma. Y no protege al consumidor JS. Se prefiere el guard de runtime, consistente con las otras cuatro validaciones del mismo método. |
| **Aceptarlo y ejecutarlo como dos flujos secuenciales adentro del Orchestrator** | Es implementar la composición del lado equivocado: duplica en el Core la política que el caller ya expresa mejor, y deja abierta la pregunta de qué pasa si el segundo flujo falla después de que el primero mutó el documento (¿rollback? ¿estado intermedio?). Rechazar no tiene ese problema. |
| **Dejarlo como está y solo corregir el spec** | El spec pasaría a describir un comportamiento incorrecto como si fuera intencional. El resultado silencioso de Contexto §2 sigue disponible para el próximo consumidor. |

## Consecuencias

**Positivas**: desaparece la única forma conocida de producir un documento mal anonimizado sin ningún error visible; ADR-038 §5 regla 4 pasa de promesa incumplida a precondición explícita; cero cambios en los tres flujos ya testeados.

**Negativas / riesgos asumidos**:

- **Es un cambio incompatible** de una precondición publicada: un caller que hoy manda el patch combinado pasa de "resultado incorrecto" a "excepción". Se acepta con los ojos abiertos — verificado que no hay ningún caller así en el repo (`reanalyzePlan.ts` es el único productor de patches).
- Un caller que quiera cambiar las dos cosas paga dos ciclos de pipeline en vez de uno. Es el costo real de la corrección: el ciclo único nunca hizo el trabajo completo.

## Validación

- `reanalyze({ ner, ocr })` rechaza con `InvalidInputError` y **no** emite ningún evento, no cambia el `stage`, y no actualiza `effectiveConfigByDocument` (el estado tiene que quedar idéntico al previo).
- `reanalyze({ ner })` y `reanalyze({ ocr })` por separado siguen funcionando exactamente como antes (los tests de los casos 18/19/20 pasan sin modificación).
- El patch vacío sigue rechazando por su propia validación, sin que el guard nuevo se adelante.
- Secuencia `{ocr}` → `{ner: on}` sobre un documento con páginas escaneadas: las páginas de texto nativo **también** reciben entidades NER (es el sub-caso B de Contexto §2, ahora alcanzable solo por el camino correcto).

## Documentos afectados

- `adr/ADR-038` §5 regla 4: nota de enmienda (la regla se retira, con puntero acá).
- `core/Orchestrator.md` §6 (precondición de `reanalyze`), §13 (caso límite nuevo) y §14 (test nuevo).
- `core/Contracts.md`: `ReanalyzeConfigPatch` gana la precondición en su docstring.
- `ui/React_Client.md` §3.7: la doble llamada deja de ser "mitigación" y pasa a ser el uso documentado.
- Código, un solo módulo: `packages/anonymization-core/src/orchestrator.ts`.
