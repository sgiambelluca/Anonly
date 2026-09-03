# @anonly/test-utils

Dobles de test compartidos por las suites de los motores del Core (ADR-129).

> **Nunca se publica ni se bundlea.** Es `private: true` y entra en cada motor
> como `devDependency`: un import suyo desde `src/` fuera de `__tests__` es una
> dependencia de desarrollo usada en producción, y eso lo rompe el build antes
> que cualquier revisión.

## Qué vive acá, y qué no

Solo lo que era **idéntico** entre los ocho `test-helpers.ts` del Core:
`createMockLogger` y `createMockCache` (byte a byte en los seis motores),
`createMockBus`, las dos formas de `createEngineContext` y los defaults de
`createMockConfig`.

Los helpers **propios de cada motor** —`mockTesseractWorker`,
`mockGetDocumentResult`, `createMockPdfLibDocument`, los builders de
`Word`/`Occurrence` con la forma que ese motor necesita— se quedan en su
paquete. Unificar una coincidencia es un error, no una mejora.

## Por qué existe

Cuando `EngineConfig` gana un campo hay que actualizar cada `createMockConfig`
a mano. El que quede con el shape viejo **no falla**: sigue compilando contra
un `EngineConfig` que ya no es el real, y esconde el bug detrás de un doble
desactualizado en vez de mostrarlo. Con un solo lugar, el resto lo hereda.

No puede vivir en `@anonly/shared` porque estos dobles usan `vi.fn()` y ese
paquete declara "sin dependencias externas" y se bundlea a producción.

## Las dos formas de `createEngineContext`

- `createEngineContext` — bus **mockeado**. Para los motores que solo verifican
  qué emitieron.
- `createEngineContextWithRealBus` — bus **real**. Lo necesita
  `grouping-engine`, el único motor que además **consume** eventos, y por eso
  sus tests necesitan un bus que de verdad entregue.
