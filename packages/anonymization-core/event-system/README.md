# @anonly/event-system

Event Bus tipado propio del Core de Anonly.

> Implementación de `IEventBus` de `@anonly/shared`. **Único** medio de comunicación motor↔motor y Core↔UI. Sin llamadas directas.

## Documentación

- **Spec / decisión**: [`docs/adr/ADR-007-Event-Bus.md`](../../../docs/adr/ADR-007-Event-Bus.md)
- Contrato: [`docs/core/Contracts.md`](../../../docs/core/Contracts.md) §3.2
- Eventos: [`docs/architecture/04_Event_System.md`](../../../docs/architecture/04_Event_System.md)

## API

```ts
import { createEventBus } from "@anonly/event-system";
import { EventChannel, EngineEvents } from "@anonly/shared";

const bus = createEventBus();

const unsubscribe = bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, (payload) => {
  console.log("Página parseada:", payload.pageIndex);
});

bus.emit(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
  documentId: "d1",
  pageIndex: 0,
  wordCount: 10,
  requiresOCR: false,
});

unsubscribe();
bus.dispose();
```

## Reglas (ADR-007)

- Sin dependencias externas.
- Tipado end-to-end: el TS falla si el payload no coincide con `EventPayloads[E]`.
- `emit` es fire-and-forget (no bloquea al emisor).
- Handlers que lanzan se loguean y el bus continúa.
- Sin middleware, sin loops, sin auto-suscripción.
- `dispose()` libera todo y el bus no se puede usar después.

## Scripts

```bash
pnpm typecheck
pnpm test
pnpm build
```
