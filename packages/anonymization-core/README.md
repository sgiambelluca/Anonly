# @anonly/anonymization-core

API pública del Core de Anonly.

> Punto único de entrada para clientes (`apps/react-client`, futuros Electron/RN, extensiones). Re-exporta `@anonly/shared` y `@anonly/event-system`. Los engines individuales se agregan en hitos 2-8 y `createCore()` en el Hito 9 (Orchestrator).

## Documentación

- TAD: [`docs/architecture/01_Technical_Architecture_Document.md`](../../docs/architecture/01_Technical_Architecture_Document.md)
- UI Contract: [`docs/ui/React_Client.md`](../../docs/ui/React_Client.md) §4
- Specs de motores: [`docs/core/`](../../docs/core/)
- Roadmap MVP: [`docs/roadmap/MVP.md`](../../docs/roadmap/MVP.md)

## Estado por hito

| Hito | Contenido                         | Estado                 |
| ---- | --------------------------------- | ---------------------- |
| 1    | Fundación (shared + event-system) | ✅ este paquete existe |
| 2    | pdf-engine                        | pendiente              |
| 3    | ocr-engine                        | pendiente              |
| 4    | regex-engine                      | pendiente              |
| 5    | ner-engine                        | pendiente              |
| 6    | grouping-engine                   | pendiente              |
| 7    | render-engine                     | pendiente              |
| 8    | export-engine                     | pendiente              |
| 9    | Orchestrator + `createCore()`     | pendiente              |

## Uso (Hito 1)

```ts
import { createEventBus, EventChannel, EngineEvents } from "@anonly/anonymization-core";

const bus = createEventBus();

bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, (p) => {
  console.log("Página parseada:", p.pageIndex);
});
```

## Uso esperado (post-Hito 9)

```ts
import { createCore } from "@anonly/anonymization-core";

const core = await createCore({
  ner: { enabled: true },
  // ...
});

await core.engines.pdf.process({ documentId: "d1", buffer });
```
