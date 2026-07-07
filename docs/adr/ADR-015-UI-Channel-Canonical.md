<!-- CONTEXT: scope=adr | dependencias=architecture/04_Event_System.md,core/Contracts.md,adr/ADR-007-Event-Bus.md | audiencia=humanos+IA | fase=5 -->

# ADR-015 — Canal `ui` canónico para todos los eventos emitidos por la UI

- **Estado**: Accepted
- **Fecha**: 2026-07-07
- **Decidido por**: Planificador (resolución de contradicción pre-Hito 7/8)

## Contexto

Contradicción en los docs, del mismo tipo que la resuelta por ADR-014:

- `04_Event_System.md` §7 listaba `RENDER_REQUESTED` en la tabla del canal `render`, y §8 listaba `EXPORT_REQUESTED` en la tabla del canal `export` — ambos con emisor UI.
- `core/Render_Engine.md` §8 y `core/Export_Engine.md` §8 declaran que esos eventos se escuchan en el canal **`ui`**.

Un implementador del Hito 7 (Render) u 8 (Export) no puede resolver en qué canal suscribirse ni en cuál debe emitir la UI. Si la UI emite en `render`/`export` y el motor escucha en `ui` (o viceversa), el evento se pierde silenciosamente.

## Decisión

**Todo evento cuyo emisor es la UI viaja por el canal `ui`**, sin excepciones. Esto incluye `RENDER_REQUESTED` y `EXPORT_REQUESTED`, que se mueven a la tabla §10 de `04_Event_System.md` (canal `ui`), junto a `GROUP_UPDATE_REQUESTED`, `RULE_CREATED`, etc. `CANCEL_REQUESTED` permanece en el canal `pipeline` porque su receptor primario es el Orchestrator y así estaba definido de forma consistente en todos los docs.

Regla derivada (para futuros eventos): **el canal se determina por el emisor, no por el receptor.** Un motor emite en su propio canal; la UI emite en `ui`; el Orchestrator emite en `pipeline`.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Canal por receptor (`RENDER_REQUESTED` en canal `render`) | Rompe la simetría con los demás eventos de UI (§10, todos en `ui`); obliga a la UI a conocer el canal de cada motor destino; la matriz emisor→receptor ya codifica el destino. |
| Canal mixto según el evento (dejar la contradicción caso por caso) | Es exactamente la ambigüedad que frenó el Hito 2 (ADR-014). Irresoluble para un implementador sin decisión canónica. |

## Consecuencias

**Positivas**: regla única y predecible ("emisor define canal") que un implementador puede aplicar sin consultar; las suscripciones de Render/Export quedan como ya estaban escritas en sus specs (§8: canal `ui`); el test de contrato de la matriz emisor→receptor se simplifica.

**Negativas**: el canal `ui` concentra más tráfico (todos los inputs del usuario). Irrelevante en volumen: son eventos de interacción humana, decenas por minuto.

**Neutras**: `EventChannel` en `core/Contracts.md` §2 no cambia (los canales `render`/`export` siguen existiendo para los eventos que esos motores **emiten**).

## Validación

- `04_Event_System.md` §7, §8 y §10 actualizados (este ADR acompaña ese cambio).
- Test de contrato del bus (Hito 9): la UI no emite en canales de motor; Render/Export se suscriben a `EventChannel.UI` para sus `*_REQUESTED`.

## Referencias

- `architecture/04_Event_System.md` §7, §8, §10, §11
- `core/Render_Engine.md` §8
- `core/Export_Engine.md` §8
- `adr/ADR-007-Event-Bus.md` (canales)
- `adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md` (precedente de resolución de contradicción)
