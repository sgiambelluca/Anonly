<!-- CONTEXT: scope=adr | dependencias=core/NER_Engine.md,ui/React_Client.md,adr/ADR-046-Ner-Kernel-Pool.md | audiencia=humanos+IA | fase=11.5 -->

# ADR-135 — El ciclo del modelo se deduplica entero, no a medias

- **Estado**: Accepted
- **Fecha**: 2026-09-04
- **Decidido por**: El humano, sobre lo que observó usando el instalador en Windows 11.
- **Relacionado con**: `core/NER_Engine.md` §13 caso 17, ADR-046 §4 (el kernel reporta el ciclo del modelo), `ui/React_Client.md` (indicador de estado)
- **Parte de**: Hito 11.5 — Escritorio

## Contexto

### 1. El cartel de carga se quedaba prendido

El estado al lado de Cancelar/Exportar decía "Preparando el detector de nombres… N%" mientras la app **ya estaba escaneando páginas**. No siempre: a veces sí, a veces no.

### 2. La dedup estaba puesta de un solo lado

Con `nerPoolSize > 1` cada worker carga su propio modelo. El motor ya sabía que eso no es un cambio de estado observable y deduplicaba `NER_MODEL_READY` con el flag `modelWarm` (caso 17):

> Deduplica NER_MODEL_READY: con `nerPoolSize > 1`, cada worker carga su propio modelo y reportaría un model-ready propio que no es un cambio de estado observable.

Pero **`NER_MODEL_LOADING` no tenía esa guarda**. La secuencia que rompe:

1. Worker A carga → `LOADING` → el cliente prende "Preparando el detector…".
2. Worker A listo → `READY` → el cliente lo apaga.
3. Worker B arranca su primer job → `LOADING` → **el cliente lo vuelve a prender**.
4. Worker B listo → `READY` **deduplicado**, no se emite.
5. Nadie lo apaga nunca.

Y como el label del cliente le da prioridad absoluta a `modelLoading` sobre el `stage`, tapaba el estado real del pipeline hasta el final.

La intermitencia se explica sola: depende de que el segundo worker arranque **después** de que el primero quedó listo. Con un solo worker en la pool no pasa nunca.

### 3. No es del contenedor

Es un defecto viejo del motor, independiente del cliente. El escritorio lo hizo más visible —el modelo carga desde disco y las ventanas de carrera cambian— pero la web tenía exactamente el mismo agujero.

## Decisión

**`NER_MODEL_LOADING` se deduplica con el mismo flag `modelWarm` que `NER_MODEL_READY`.**

El argumento es el que el propio motor ya usaba, aplicado al otro evento: si el `model-ready` de un segundo worker "no es un cambio de estado observable", su `model-loading` tampoco lo es. Lo que el usuario espera cuando ve ese cartel es que el detector esté listo **para empezar**; que un worker adicional se caliente en segundo plano mientras el pipeline ya detecta no es algo que él esté esperando.

## Consecuencias

**A favor**

- El indicador vuelve a reflejar el estado real. Deja de tapar `stage` con una carga que ya terminó.
- Vale para todos los clientes: el arreglo es del motor, no del cliente.
- El test de regresión falla sin la guarda, verificado quitándola.

**En contra**

- **Se pierde visibilidad del calentamiento del segundo worker.** Si algún día ese segundo modelo tardara muchísimo o fallara, nada lo mostraría. Es aceptable porque el pipeline ya está produciendo resultados con el primero, pero conviene saberlo.
- La dedup es **por instancia del motor**. Un cliente que recree el Core (ADR-125) reinicia el flag, que es lo correcto: ahí el modelo sí se carga de nuevo.

**Lo que no toca**: el contrato de eventos, los códigos de error, ni el cliente.
