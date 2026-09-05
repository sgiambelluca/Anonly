<!-- CONTEXT: scope=adr | dependencias=core/Orchestrator.md,core/Contracts.md,architecture/07_Performance_Strategy.md,adr/ADR-130-El-Contenedor-De-Escritorio-Fija-El-Motor.md | audiencia=humanos+IA | fase=11.5 -->

# ADR-134 — `Cancelled` es terminal

- **Estado**: Accepted
- **Fecha**: 2026-09-04
- **Decidido por**: El humano, sobre el hallazgo de `scenario-4` al migrar los E2E al contenedor.
- **Relacionado con**: `core/Orchestrator.md` (cancelación), `07_Performance_Strategy.md` §9 (SLA de cancelación), ADR-130
- **Parte de**: Hito 11.5 — Escritorio

## Contexto

### 1. La app decía "Cancelado" y seguía procesando

`scenario-4` toma dos capturas del estado separadas por 500 ms después de que la UI muestra "Cancelado", y verifica que sean iguales. Contra el contenedor de escritorio no lo eran:

```
Expected: "Cancelado"
Received: "Buscando datos sensibles: página 500 de 500…"
```

O sea: el pipeline volvió a una etapa de trabajo **después** de cancelarse, y llegó hasta la última página del documento.

Para una herramienta cuya promesa es que el documento no sale de la máquina **y que el usuario manda**, decirle "cancelado" mientras se sigue procesando su pericia no es un defecto cosmético.

### 2. `cancel()` estaba bien; lo que faltaba era que nadie lo pisara

`cancel()` hace lo que corresponde: aborta la señal del `abortRegistry`, escribe `stage: Cancelled` y emite `PIPELINE_CANCELLED`.

El problema es lo que pasa después. Abortar la señal no detiene los jobs **ya despachados**: siguen resolviendo, y sus handlers llamaban `setStage(Detecting)` y `emitProgress` sin preguntar si el documento seguía vivo. `setStage` no tenía ninguna guarda.

### 3. Por qué aparece en el contenedor y no en el navegador

Contra el dev server el mismo spec pasa en 4 s. La diferencia no es el mecanismo —el defecto estaba en el Orchestrator y es independiente del cliente— sino **cuánto trabajo hay en vuelo cuando se cancela**: en el contenedor los assets son locales, el pipeline arranca mucho más rápido, y para cuando el usuario aprieta Cancelar hay más páginas ya despachadas que van a resolver después.

O sea que el bug era del Core desde siempre; el escritorio lo volvió visible. La web tenía la misma bomba con la mecha más larga.

## Decisión

**Una vez que un documento entra en `PipelineStage.Cancelled`, nada lo saca.**

- `setStage` es no-op para un documento cancelado.
- `emitProgress` no emite para un documento cancelado.

La guarda va en esos dos puntos y **no en cada handler**: son muchos caminos y alcanza con que uno se olvide para reabrir el agujero.

**Se mira el `stage`, no `cancelRequested`.** `cancelReanalyze` también levanta `cancelRequested` y vuelve a `Ready` a propósito (caso 22 del spec de Orchestrator); guardar por esa bandera rompería ese camino. `cancel()` escribe el stage con `state.update` directo, así que la guarda no se bloquea a sí misma.

## Consecuencias

**A favor**

- "Cancelado" pasa a significar cancelado. `scenario-4` pasa contra el contenedor en 2,3 s.
- La corrección es del Core, así que vale para cualquier cliente — la web tenía el mismo defecto latente.
- El test de regresión falla sin la guarda (`Expected "cancelled"`, `Received "detecting"`), verificado quitándola.

**En contra**

- **No detiene el trabajo, solo deja de reportarlo.** Los jobs ya despachados siguen consumiendo CPU hasta terminar; lo que se arregla es que la app deje de mentir sobre su estado. Detener de verdad el trabajo en vuelo es que cada kernel chequee su `AbortSignal` en los puntos de corte, y eso es trabajo aparte — **queda abierto**.
- Un evento tardío legítimo después de una cancelación se descarta en silencio. Es lo correcto para el stage y el progreso, pero conviene saberlo si algún día hace falta trazar por qué un evento no llegó.

**Lo que no toca**: `cancel()`, `cancelReanalyze`, el `abortRegistry`, el contrato de eventos ni el SLA de `07_Performance_Strategy.md` §9.
