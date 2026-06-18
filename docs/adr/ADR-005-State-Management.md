<!-- CONTEXT: scope=adr | dependencias=04_Event_System.md,ui/React_Client.md | audiencia=humanos+IA | fase=2 -->

# ADR-005 — Estado UI con Zustand + Event Bus

- **Estado**: Accepted
- **Fecha**: 2026-06-17
- **Decidido por**: Planificación inicial

## Contexto

La UI de Anonly necesita estado para:
- Estado del pipeline (`PipelineState`, progreso, errores).
- Árbol de entidades (`EntityGroup[]` agrupado por tipo).
- Reglas (`Rule[]`).
- Selección y expansión de nodos del árbol.
- Vista del visor (página actual, zoom, modo lado a lado).
- Settings (idioma, performance preset, modos default).

El estado se actualiza por eventos del Core (vía `IEventBus`) y por input del usuario (que a su vez dispara eventos hacia el Core).

## Decisión

**Zustand** para el estado de la UI, organizado en **slices por dominio**:

```ts
const useDocumentStore = create<DocumentSlice>(...)
const useEntitiesStore = create<EntitiesSlice>(...)
const useRulesStore = create<RulesSlice>(...)
const usePipelineStore = create<PipelineSlice>(...)
const useViewerStore = create<ViewerSlice>(...)
const useSettingsStore = create<SettingsSlice>(...)
```

**Event Bus tipado propio** para comunicación Core↔UI y motor↔motor. El bus es la única vía de comunicación entre el Core y el cliente. Zustand nunca es mutado directamente por eventos del Core; un **adapter** escucha el bus y actualiza Zustand.

```
Core ──► Event Bus ──► UI Adapter ──► Zustand ──► React
React ──► Zustand action ──► UI Adapter ──► Event Bus ──► Core
```

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **Redux Toolkit** | Boilerplate excesivo para el scope. Actions tipadas verbosas. El bus ya es la fuente de eventos; Redux sería un segundo bus paralelo. |
| **Jotai / Recoil (atomic state)** | Bueno para estado derivado, pero nuestro estado es mayormente "lista de grupos" y "estado del pipeline", más natural como stores. |
| **MobX** | Observable implícito, más mágico. TS estricto menos limpio que Zustand. |
| **Valtio** | Proxy-based, mismo problema de mágico. |
| **Sin lib (useReducer + Context)** | Re-renders costosos sin selectors. Performance problemático con árbol de 1000 grupos. |
| **Event Bus como único estado (sin Zustand)** | El bus es fire-and-forget; no es un store consultable. Necesitamos un snapshot consultable para render. |
| **Zustand + Redux para dominios distintos** | Mezcla dos mentalidades. Sin valor agregado. |

## Consecuencias

**Positivas**:
- API simple, sin boilerplate.
- Selectores finos para evitar re-renders (crítico con árbol de grupos grande).
- Sin middleware complejo; las acciones son funciones puras.
- El bus queda como única fuente de eventos; Zustand es solo el snapshot de UI.

**Negativas**:
- Zustand no tiene devtools tan ricos como Redux Toolkit. Mitigado con `redux` middleware de Zustand para devtools.
- Requiere disciplina: nunca mutar Zustand sin pasar por el adapter del bus (regla de UI).

**Neutras**:
- CSP `style-src 'unsafe-inline'` es requerido por Tailwind; independiente de este ADR.

## Reglas de uso

1. Un slice por dominio, nunca un store gigante.
2. Selectores con `useStore(s => s.x)` para evitar re-renders.
3. Toda mutación de store por eventos del bus pasa por un adapter en `apps/react-client/src/core-adapter/`.
4. Toda acción de UI que deba afectar el Core emite un evento por el bus, no muta el Core directamente.
5. El store nunca contiene `Document` completo ni `Page` completa; solo refs y lo necesario para render.

## Referencias

- `04_Event_System.md` §10 (eventos de UI)
- `ui/React_Client.md` (UI Contract)
- `ui/Components.md`
- `01_Technical_Architecture_Document.md` §3.1
