<!-- CONTEXT: scope=adr | dependencias=architecture/05_Worker_Architecture.md,architecture/07_Performance_Strategy.md,architecture/03_Data_Model.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md,adr/ADR-045-OcrEngine-Pool-Propia-Kernel-Puro.md,adr/ADR-047-ExportEngine-Ensamblador-Worker-Dedicado.md | audiencia=humanos+IA | fase=post-10.9 -->

# ADR-079 — La transferencia real de `ArrayBuffer` se decide por dirección y por payload, no en general

- **Estado**: Accepted
- **Fecha**: 2026-08-19
- **Decidido por**: El humano, al revisar las observaciones no bloqueantes del Hito 10 (`roadmap/Hito10_Observaciones_Plan_De_Resolucion.md` §6.3 punto H, observación del revisor de PR16).
- **Relacionado con**: **el bug #6 del PR10** (buffer detachment en `runExport` — la razón por la que esto no puede aplicarse a ciegas), **ADR-043 §5** (broadcast `load-document`, el caso donde transferir es imposible), ADR-045/047 (que dicen "transferido" en su prosa), **ADR-036 §2/§3** (el transporte).
- **Parte de**: cierre de las observaciones del Hito 10.

> Convención de citas: `ADR-079 §N` refiere a **Decisión §N**.

## Contexto

### 1. El spec dice "transferido" y el código hace una copia

Los cinco entry-points comparten el mismo helper, verbatim:

```ts
function post(message: WorkerOutbound): void {
  self.postMessage(message);
}
```

Sin transfer list. `WorkerPool#dispatchRemote` hace lo mismo con el `RUN`. `WorkerLike.postMessage` (`shared/src/interfaces.ts:188`) **ya acepta** el segundo parámetro `transfer?: ReadonlyArray<Transferable>` — nadie se lo pasa.

Consecuencia: todo lo que cruza un `postMessage` es **structured clone**, o sea un `memcpy` completo del buffer, con el pico de memoria de las dos copias vivas a la vez. `06_Pipeline.md` §73 ("`imageData` se transfiere") y ADR-047 §3 describen algo que no ocurre.

### 2. Lo que cuesta, medido en los payloads reales

| Payload | Dirección | Tamaño típico | Frecuencia |
|---|---|---|---|
| `LoadDocumentPayload.buffer` (el PDF entero) | host → worker | tamaño del PDF (una pericia real: 10-50 MB) | **× cada worker vivo** (es un `broadcast`), + otra vez en cada re-priming |
| `OcrPagePayload.imageData` | host → worker | página A4 a 300 dpi ≈ **8 MB** (2480×3508×4 bytes) | una por página escaneada |
| `EncodedPageImage` (preview/export) | worker → host | 100 KB - 2 MB según escala | una por página **por cada render**, o sea también en cada scroll y cada cambio de zoom |
| PDF final del `save` | worker → host | tamaño del PDF exportado | una por export |

El caso caro es el primero: con `renderPoolSize: 4` y un PDF de 50 MB, un `load-document` son ~200 MB de copias, encima de la copia `slice(0)` que el Orchestrator ya hace a propósito.

El caso **frecuente** es el tercero: cada scroll del visor dispara renders, y cada preview vuelve copiado.

### 3. Por qué no se puede "activar transferencia" y ya

Transferir un `ArrayBuffer` lo **detacha** en el emisor: queda con `byteLength === 0`. Ese es, literalmente, el bug #6 del PR10 — `pdfjs-dist` neutralizó el buffer que el Orchestrator pensaba reutilizar, `RenderEngine.loadDocument` recibió un buffer vacío, y el export se colgó para siempre sin error visible. El fix de ese bug fue **entregar siempre `slice(0)`** y no reutilizar nunca un buffer transferido.

Y hay un caso donde transferir es directamente imposible: el `broadcast` de `load-document` manda **el mismo buffer a N workers**. El primer transfer lo detacha y los N-1 restantes reciben 0 bytes.

O sea: la decisión no es "¿transferimos?", es "**¿cuáles, en qué dirección?**". Eso es lo que hace falta decidir, y por eso es un ADR y no un fix.

## Decisión

### 1. La regla: transferir solo lo que el emisor no vuelve a mirar

Un payload se transfiere **si y solo si** el emisor pierde interés en el buffer en el mismo acto de postearlo. Aplicada a los cuatro casos de Contexto §2:

| Payload | Dirección | ¿Transferir? | Por qué |
|---|---|---|---|
| **`EncodedPageImage`** (preview, export, rasterizado) | worker → host | **Sí** | El kernel lo produce y lo postea; no guarda referencia. Es el caso más frecuente. |
| **PDF final del `save`** | worker → host | **Sí** | El assembler llama `discardState()` inmediatamente después. |
| **`OcrPagePayload.imageData`** | host → worker | **Sí** | El host lo rasteriza para este job y lo suelta: `runOcrStage` no lo retiene ni lo reusa. |
| **`LoadDocumentPayload.buffer`** (el PDF) | host → worker | **NO, nunca** | Es el buffer retenido del Orchestrator, y además viaja por `broadcast` a N workers. Transferirlo reintroduce el bug #6. |

La asimetría no es casual: **worker → host siempre es seguro** (el worker muere o descarta después de postear), **host → worker requiere justificar caso por caso**.

### 2. Dónde vive el cambio

- **worker → host**: el helper `post()` de cada entry-point gana un segundo parámetro opcional `transfer`, y cada sitio que postea un `COMPLETED` con un `ArrayBuffer` en el resultado lo pasa. Cinco módulos, un PR cada uno (R-1). Los cuatro que no tienen buffers de vuelta (`pdf`, `ner`) no cambian.
- **host → worker**: `WorkerPool#dispatchRemote` gana un `transferList?: ReadonlyArray<Transferable>` en `DispatchParams`, que el motor dueño arma. **El pool no lo deduce**: no puede saber si el caller reusa el buffer. Solo `ocr-engine` lo pasa.

`broadcast()` **no** gana el parámetro. Es la garantía estructural de §1 fila 4: si no hay por dónde pasar una transfer list, nadie puede transferir un `load-document` por error.

### 3. El `slice(0)` del Orchestrator se queda

Aunque `load-document` no se transfiera, la copia defensiva del Orchestrator (`Orchestrator.md` §12) **no se retira**. Es la segunda línea de defensa contra el bug #6 y no depende de este ADR.

### 4. Qué NO cambia

- **`WorkerLike` no cambia**: el parámetro ya está en la interfaz desde ADR-036.
- **Ningún payload cambia de forma.** Un buffer transferido llega idéntico del otro lado; lo único que cambia es que el emisor se queda sin el suyo.
- **El fallback in-process** (ADR-035) no pasa por `postMessage`: no lo toca nada de esto, y su comportamiento sigue bit-idéntico.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **Transferir todo lo transferible, automáticamente** (recorrer el payload y juntar los `ArrayBuffer`) | Es la versión que reintroduce el bug #6 en el primer caller que reuse su buffer, y rompe `broadcast` de entrada. La automatización acá es exactamente lo peligroso: quita la decisión del lugar donde hay contexto para tomarla. |
| **Solo worker → host, dejar host → worker como está** | Deja afuera los 8 MB por página del `imageData` de OCR, que es el segundo payload más pesado y el más claramente seguro de los de entrada (el host lo descarta al despachar). |
| **Copiar el PDF por worker antes del broadcast y transferir cada copia** | Cambia N clones implícitos por N clones explícitos + N transfers: mismo costo de memoria, más código. |
| **`SharedArrayBuffer`** | Exige `crossOriginIsolated` (COOP/COEP), headers que PR10 descartó explícitamente y que romperían la carga de assets actual. |

## Consecuencias

**Positivas**: desaparece una copia completa por preview (el camino más frecuente de la app) y una de 8 MB por página escaneada; el spec pasa a decir la verdad; la regla de §1 queda escrita para el próximo payload que cruce.

**Negativas / riesgos asumidos**:

- **Un buffer transferido queda detachado en el emisor.** Si algún día alguien agrega un uso *posterior* al postMessage en uno de los tres casos de §1, va a encontrarse un buffer vacío. Mitigación: la lista de §1 es corta, explícita, y cada sitio lleva el comentario de por qué es seguro.
- El resultado ya no es "el mismo objeto" para el emisor. Ningún test actual depende de eso (los fakes de `WorkerLike` no implementan transferencia real), lo que es a la vez conveniente y una limitación: **los tests unitarios no pueden verificar el detachment**, solo que la transfer list se pasó con los buffers correctos. La verificación real es E2E.

## Validación

- `post()` de `render-engine`/`export-engine`/`ocr-engine` pasa el `ArrayBuffer` del resultado en la transfer list, y **solo** ese (no el mensaje entero).
- `dispatchRemote` pasa la transfer list de `DispatchParams` a `postMessage`, y no pasa ninguna cuando el campo está ausente.
- `broadcast()` no tiene forma de recibir una transfer list (garantía de tipos, no de runtime).
- El fallback in-process ignora `transferList` por completo: mismos eventos, mismo resultado.
- E2E: el Escenario 1 y el Escenario 2 siguen verdes — es la única verificación que ejercita transferencia real, porque los fakes no la implementan.

## Documentos afectados

- `architecture/05_Worker_Architecture.md` §2.2 (qué se transfiere y qué se clona, con la tabla de §1).
- `architecture/06_Pipeline.md` §73 (hoy afirma la transferencia del `imageData` que recién ahora es cierta).
- `adr/ADR-047` §3: nota de enmienda (su "transferido" pasa a ser real).
- Código: `packages/anonymization-core/src/worker-pool.ts` (**PR 1**, `DispatchParams.transferList`) → `render-engine`, `ocr-engine`, `export-engine` (**PRs 2-4**, uno por motor, en cualquier orden entre sí).
