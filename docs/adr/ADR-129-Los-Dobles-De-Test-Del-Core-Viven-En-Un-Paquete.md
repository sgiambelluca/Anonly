<!-- CONTEXT: scope=adr | dependencias=ai/Code_Standards.md,core/Contracts.md,roadmap/Duplicacion_De_Logica.md,adr/ADR-128-El-Esqueleto-De-Un-Worker-Se-Escribe-Una-Vez.md | audiencia=humanos+IA | fase=11 -->

# ADR-129 — Los dobles de test del Core viven en un paquete

- **Estado**: Accepted
- **Fecha**: 2026-09-03
- **Decidido por**: El humano, que pidió cerrar el inventario de `roadmap/Duplicacion_De_Logica.md` dejando afuera solo §2, por falta de forma de medirlo.
- **Relacionado con**: `Duplicacion_De_Logica.md` §5, ADR-128 (el ítem anterior del mismo inventario), `ai/Code_Standards.md` §5
- **Parte de**: Hito 11

## Contexto

### 1. Ocho copias, y las que más importan son idénticas

Cada motor tiene su `src/__tests__/fixtures/test-helpers.ts`. Entre los ocho suman **3559 líneas**. Medido sobre el árbol, función por función:

| helper | copias idénticas |
|---|---|
| `createMockLogger` | **6 de 6**, byte a byte |
| `createMockCache` | **6 de 6**, byte a byte |
| `createMockBus` | **5 de 5** que lo tienen |
| `createEngineContext` | **5 de 5** que lo tienen con bus mockeado |
| `createMockConfig` | 6 versiones distintas — **pero el bloque `workerPool` es idéntico en las 6** |

Lo que difiere de `createMockConfig` es un puñado de campos que cada motor sí quiere distintos (`ner.modelId`, `ocr.languages`, `render.*`). Lo que se repite es el resto: los cuatro pool sizes, los cinco timeouts, los cinco maxRetries, los delays y los SLA.

### 2. El riesgo no es el output, es que un mock viejo esconda un bug

Cuando `EngineConfig` gana un campo —pasó con ADR-037, ADR-039 y otros—, hay que actualizar **ocho** `createMockConfig` a mano. El que quede con el shape viejo no falla: sigue compilando contra un `EngineConfig` que ya no es el real, y **esconde** el bug detrás de un doble desactualizado en vez de mostrarlo.

Es el mismo mecanismo que ADR-128 describió para los `entry.ts`, con una diferencia que lo hace peor: ahí el código repetido corría en producción y al menos el E2E lo ejercitaba. Acá el código repetido **es el que decide si un test dice la verdad**.

### 3. Por qué no puede vivir en `@anonly/shared`

Los dobles usan `vi.fn()`. `shared` declara "sin dependencias externas" (`Code_Standards.md` §5) y **se bundlea a producción**: meterlos ahí arrastraría `vitest` al bundle de la app.

Tampoco pueden vivir en `tests/`: el `typecheck` de cada motor corre `tsc` sobre su propio paquete, y un import que salga del paquete hacia un directorio del repo no resuelve por el grafo de dependencias, que es justamente lo que mantiene honestas las fronteras.

## Decisión

### 1. Un paquete de workspace, privado y solo de desarrollo

`@anonly/test-utils`, en `packages/anonymization-core/test-utils/`. **Nunca se publica** (`private: true`) y entra en cada motor como `devDependency`.

> **Errata (2026-09-03)**: esta sección decía que un import suyo desde `src/` fuera de `__tests__` *"lo rompe el build antes que cualquier revisión"*. **Es falso, y no por el build roto.** Medido con el build ya arreglado: `tsc` resuelve `@anonly/test-utils` por `node_modules` —está linkeado por el workspace— y **compila sin una queja**. ESLint tampoco lo frenaba: su único reclamo era `import/order`, o sea el orden del import, no el import. Con el import bien ordenado no lo agarraba nada.
>
> La contención no existía: la afirmación describía un gate que nadie había ejercitado. Ahora existe y es **`no-restricted-imports`**, el mismo mecanismo con el que el repo ya prohíbe importar el bus (P-2): `@anonly/test-utils` queda vedado en los dos bloques de producción —los siete motores y el façade— y permitido en `__tests__`. Verificado a mano en los dos, provocando el error. Es un gate mejor que el build, además: `pnpm lint` **sí** está en CI y es bloqueante.

Resuelve por `main`/`types` apuntando al `src/index.ts`, igual que `@anonly/shared`: no necesita build propio porque nadie lo compila a `dist`.

### 2. Solo se muda lo que es idéntico

`createMockLogger`, `createMockCache`, `createMockBus`, `createEngineContext`, `createEngineContextWithRealBus` y `createMockConfig`.

Los helpers **propios de cada motor** —`mockTesseractWorker`, `mockGetDocumentResult`, `createMockPdfLibDocument`, los builders de `Word`/`Occurrence` con la forma que ese motor necesita— **se quedan donde están**. Unificar una coincidencia es un error, no una mejora: es el mismo criterio con el que `Duplicacion_De_Logica.md` deja afuera `bboxIntersectionRatio` vs `overlapRatioWithRect`.

### 3. `createMockConfig` centraliza los defaults y cada motor pasa lo suyo

La versión compartida trae el `EngineConfig` completo con los valores que hoy son idénticos en las seis copias. Cada motor sigue eligiendo sus campos por `overrides`, que es el mecanismo que esas copias ya usaban — lo único que cambia es que ahora **el `workerPool` tiene un solo lugar donde actualizarse**.

### 4. Las dos formas de `createEngineContext` son dos, y se quedan las dos

Con bus mockeado (`createEngineContext`) y con bus real (`createEngineContextWithRealBus`). No es duplicación: `grouping-engine` es el único motor que **consume** eventos, así que sus tests necesitan un bus que de verdad entregue; los demás solo verifican qué se emitió. `render-engine` ya tenía las dos.

### 5. La regla que prohíbe importar el bus se afloja **solo** para este paquete

`no-restricted-imports` bloquea `@anonly/event-system` en todo
`packages/anonymization-core/**` salvo los `__tests__` (P-2: un motor usa el
`IEventBus` que le inyecta `ctx`, no la implementación). `test-utils` entra en
esa misma excepción, y por la misma razón: **no es un motor**, y
`createEngineContextWithRealBus` existe justamente para armar ese bus.

La contención es la que ya tiene el paquete: `private: true` y `devDependency`.
La prohibición sigue rigiendo intacta para los siete motores, que es a quienes
apunta la regla.

## Consecuencias

- Un solo lugar donde actualizar el `EngineConfig` de prueba cuando el contrato gana un campo. El resto de los motores lo hereda, en vez de quedarse en silencio con el shape viejo.
- Un motor nuevo arranca con dobles que ya están bien, en vez de copiar 200 líneas del vecino.

**En contra**

- **Un paquete más en el workspace**, con su `package.json`, su `tsconfig` y su entrada en el `pnpm-workspace`. Es el costo de la única salida legal: la alternativa era seguir copiando.
- **Un doble compartido es más difícil de cambiar**: tocar `createMockCache` ahora impacta a los seis motores a la vez. Es exactamente la propiedad que se busca —que un cambio llegue a todos— y también su riesgo, porque un cambio pensado para un motor puede romper a otro. La contención es que solo se muda lo idéntico: lo que un motor necesita distinto se queda en su archivo.

**Lo que no toca**: los helpers propios de cada motor, la estructura de `src/__tests__/`, los thresholds de cobertura, ni ningún contrato público del Core — `@anonly/test-utils` no exporta nada que la app pueda usar.

## Qué hay que cubrir con tests

El paquete **no lleva tests propios**, y es deliberado: sus consumidores son las ocho suites del Core, que lo ejercitan en cada corrida. Un test de un doble prueba el doble, no el sistema.

Lo que sí es un gate: **`pnpm test` completo tiene que dar el mismo número de tests antes y después de cada migración**. Si un motor pierde tests al migrar, es que su doble cambió de comportamiento.
