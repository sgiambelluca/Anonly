# @anonly/anonymization-core

API pública del Core de Anonly.

> Punto único de entrada para clientes (`apps/react-client`, futuros Electron/RN, extensiones). Re-exporta `@anonly/shared` y `@anonly/event-system`, y expone `createCore()`, que arma el pipeline completo: los siete motores, sus pools de workers y el Orchestrator que los secuencia.
>
> **El Core no conoce React ni ninguna UI**, y no hace red ni toca el filesystem. Un cliente lo instancia, se suscribe a su bus y le manda un `ArrayBuffer`.

## Documentación

- TAD: [`docs/architecture/01_Technical_Architecture_Document.md`](../../docs/architecture/01_Technical_Architecture_Document.md)
- Contratos (tipos, eventos, error codes): [`docs/core/Contracts.md`](../../docs/core/Contracts.md)
- UI Contract: [`docs/ui/React_Client.md`](../../docs/ui/React_Client.md) §4
- Specs de motores: [`docs/core/`](../../docs/core/)

## Composición

| Paquete | Rol |
|---|---|
| [`shared/`](./shared) | Tipos, contratos, error codes y primitivas puras compartidas. Sin dependencias externas. |
| [`event-system/`](./event-system) | Event Bus tipado por canal. |
| [`pdf-engine/`](./pdf-engine) | Extracción de texto y posiciones; fusión del OCR. |
| [`ocr-engine/`](./ocr-engine) | OCR de páginas sin texto (Tesseract). |
| [`regex-engine/`](./regex-engine) | Patrones determinísticos argentinos. |
| [`ner-engine/`](./ner-engine) | NER local (Transformers.js + ONNX Runtime Web). |
| [`grouping-engine/`](./grouping-engine) | Agrupación obligatoria, conflictos y reglas. |
| [`render-engine/`](./render-engine) | Rasterizado y composición del preview. |
| [`export-engine/`](./export-engine) | Reconstrucción del PDF final. |

`src/` es el **único** lugar que importa motores: entre ellos nunca se importan (P-1/P-2, con ESLint bloqueándolo). Se comunican por el `IEventBus` que reciben en su `ctx`.

## Uso

```ts
import { createCore, EventChannel, EngineEvents } from "@anonly/anonymization-core";

const core = await createCore(
  { ner: { enabled: true }, ocr: { languages: ["spa", "eng"] } },
  { workers: { pdf: () => new PdfWorker() /* …uno por motor */ } },
);

core.bus.on(EventChannel.Grouping, EngineEvents.GROUP_CREATED, (group) => {
  // el árbol de entidades se arma escuchando el bus, no consultando al Core
});

await core.orchestrator.importDocument({ documentId, name, buffer });
```

Los dos argumentos son opcionales y tienen semánticas distintas:

- **`config`** es un `EngineConfigOverrides` **parcial**: lo que no se pasa cae a los defaults de `Contracts.md` §6.
- **`runtime`** inyecta las factories de Web Workers. **Sin ellas todo corre in-process**, con un fallback bit-idéntico (ADR-035) — que es cómo corren los tests.

`core.dispose()` libera los workers y los modelos cargados.

## Reglas del paquete

- Sin `any`, sin `@ts-ignore` sin issue, sin `console.*`, sin `export default`.
- Sin red ni filesystem: todo entra por parámetro y sale por evento.
- Todo dato público es inmutable (`readonly`, `ReadonlyArray`).
- Un tipo, evento o error code nuevo se declara **primero** en `docs/core/Contracts.md` (R-19).

Detalle en [`docs/ai/Code_Standards.md`](../../docs/ai/Code_Standards.md).
