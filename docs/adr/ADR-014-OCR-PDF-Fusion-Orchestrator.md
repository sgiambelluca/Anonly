<!-- CONTEXT: scope=adr | dependencias=architecture/04_Event_System.md,core/PDF_Engine.md,core/Contracts.md,adr/ADR-007-Event-Bus.md | audiencia=humanos+IA | fase=5 -->

# ADR-014 — Fusión OCR→PDF mediada por Orchestrator

- **Estado**: Accepted
- **Fecha**: 2026-06-18
- **Decidido por**: Planificador (resolución de ambigüedad Hito 2)

## Contexto

Contradicción en el spec:
- `PDF_Engine.md` §8 + `04_Event_System.md` §4 (fila `OCR_PAGE_FINISHED`) + matriz §11 (✓ OCR→PDF) dicen que **PDF Engine recibe** `OCR_PAGE_FINISHED`.
- `04_Event_System.md` §11 **invariante** dice que ningún motor escucha a otro excepto Grouping (que escucha `ENTITY_FOUND` de Regex y NER) y Render/Export (que escuchan cambios de grupos vía Orchestrator). PDF←OCR no está listado como excepción.

Un implementador no puede resolver cuál prevalece: si el engine debe suscribirse al evento o no.

## Decisión

**Modelo B (Orchestrator-mediated).** PDF Engine **no** se suscribe a `OCR_PAGE_FINISHED` (ni a ningún evento de otro motor). Flujo:

1. `ocr-engine` emite `OCR_PAGE_FINISHED` (canal `ocr`); el `OcrPool` deposita las `Word[]` en `ctx.cache` con clave `ocr-words:<documentId>:<pageIndex>`.
2. El **Orchestrator** se suscribe a `OCR_PAGE_FINISHED`, lee las `Word[]` de `ctx.cache` e invoca `PdfEngine.fuseOcrPage(documentId, pageIndex, words)`.
3. `fuseOcrPage` (firma intacta de `PDF_Engine.md` §6) fusiona y devuelve un nuevo `Document` inmutable.

`core/Contracts.md` no cambia: `OcrPageFinished` (payload), `fuseOcrPage` (firma) e `IEventBus` quedan intactos. Sólo cambia la tabla de receptores en `04_Event_System.md` §4 y la matriz §11 (OCR→PDF = –), que es el contrato de wiring que el test de la matriz valida.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **Modelo A**: PDF Engine se suscribe a `OCR_PAGE_FINISHED` en canal `ocr` | Viola la invariante §11; rompe el patrón "vía Orchestrator" de Render/Export; crea dependencia motor→motor no listada; el test de contrato de la matriz emisor→receptor fallaría. |

## Consecuencias

**Positivas**: Refuerza la invariante §11; consistencia con Render/Export (misma política de coordinación); el test de la matriz emisor→receptor se simplifica (PDF Engine no se suscribe a canal `ocr`); `fuseOcrPage` es invocable directamente en tests sin bus.

**Negativas**: El Orchestrator asume una responsabilidad de wiring adicional (leer cache + llamar `fuseOcrPage`). Mitigado: es exactamente el rol del Orchestrator (secuencia etapas, despacha jobs, coordina motores).

## Validación

- Contract test del bus: `PdfEngine` no registra handler en `EventChannel.Ocr`.
- Contract test de `PdfEngine`: `fuseOcrPage` fusiona `Word[]` correctamente, preserva inmutabilidad, ordena por `bbox.y` luego `bbox.x`.
- Integration test (Hito 9): `OCR_PAGE_FINISHED` → Orchestrator → `fuseOcrPage` end-to-end.

## Referencias

- `architecture/04_Event_System.md` §4, §11
- `core/PDF_Engine.md` §6, §8
- `core/Contracts.md` §8 (`OcrPageFinished`)
- `adr/ADR-007-Event-Bus.md`
- `adr/ADR-008-Immutability.md`
