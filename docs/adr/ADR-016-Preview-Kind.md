<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,architecture/04_Event_System.md,core/Render_Engine.md,ui/React_Client.md | audiencia=humanos+IA | fase=5 -->

# ADR-016 — `kind` en el payload de `PREVIEW_UPDATED`

- **Estado**: Accepted
- **Fecha**: 2026-07-07
- **Decidido por**: Planificador (resolución de gap de contrato pre-Hito 7/10)

## Contexto

La UI muestra dos visores lado a lado: PDF original y PDF anonimizado. El Render Engine renderiza ambos lados (`RenderPageInput.kind: "original" | "anonymized"`) y `RenderPageOutput` conserva ese `kind`. Pero el evento `PREVIEW_UPDATED` — la vía por la que la UI recibe cada preview — tenía payload `{ documentId, pageIndex, canvasBlobUrl }` **sin `kind`**: el receptor no podía saber a qué visor corresponde el blob.

El gap era visible en el propio UI Contract: `ViewerSlice.setPreview(pageIndex, kind, blobUrl)` exige un `kind` que el bridge de ejemplo no podía proveer (el snippet de `React_Client.md` §2.2 no compilaba contra el payload).

## Decisión

Agregar `kind` al payload de `PREVIEW_UPDATED`:

```ts
export interface PreviewUpdated {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly kind: "original" | "anonymized";
  readonly canvasBlobUrl: string;
}
```

Actualizados en el mismo cambio (orden R-19: contratos primero): `core/Contracts.md` §8, `architecture/04_Event_System.md` §7, `core/Render_Engine.md` §7, `ui/React_Client.md` §2.2, y la implementación en `packages/anonymization-core/shared/src/events.ts`.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Dos eventos (`PREVIEW_ORIGINAL_UPDATED` / `PREVIEW_ANONYMIZED_UPDATED`) | Duplica filas en la tabla de eventos, handlers y tests para transportar un solo bit. `kind` como campo es más barato y consistente con `RenderPageInput`/`RenderPageOutput`, que ya usan el mismo union type. |
| Que la UI infiera el `kind` correlacionando con el `RENDER_REQUESTED` que originó el render | Frágil: los renders son asíncronos, con delta render y prioridades el orden de llegada no se corresponde con el orden de pedido. Estado implícito irrecuperable ante races. |
| Codificar el `kind` en `canvasBlobUrl` (query param o convención) | Contrato implícito no tipado; exactamente lo que el bus tipado existe para evitar. |

## Consecuencias

**Positivas**: la UI enruta cada preview a su visor sin estado auxiliar; el bridge del UI Contract compila tal como está escrito; simetría total entre `RenderPageInput`, `RenderPageOutput` y el evento.

**Negativas**: cambio de contrato público. Costo real: cero — el Render Engine (emisor) y la UI (receptor) aún no están implementados; solo se tocó `shared`.

**Neutras**: el union `"original" | "anonymized"` queda inline (como en `RenderPageInput`). Si un tercer consumidor lo necesita, se promueve a un tipo nombrado en `Contracts.md` con un PR de docs.

## Validación

- Typecheck de `@anonly/shared` con el campo nuevo.
- Contract test del Render Engine (Hito 7): todo `PREVIEW_UPDATED` emitido incluye `kind` coherente con el `RenderPageInput` que lo originó.

## Referencias

- `core/Contracts.md` §8 (`PreviewUpdated`)
- `architecture/04_Event_System.md` §7
- `core/Render_Engine.md` §6, §7
- `ui/React_Client.md` §2.2, §3.5
- `ai/AI_Development_Guide.md` R-19 (contratos primero)
