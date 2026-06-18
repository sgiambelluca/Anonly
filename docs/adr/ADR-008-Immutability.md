<!-- CONTEXT: scope=adr | dependencias=03_Data_Model.md,ai/Code_Standards.md | audiencia=humanos+IA | fase=2 -->

# ADR-008 — Inmutabilidad de Todo el Estado del Core

- **Estado**: Accepted
- **Fecha**: 2026-06-17
- **Decidido por**: Planificación inicial

## Contexto

El estado del Core (`Document`, `Page`, `Word`, `Occurrence`, `EntityGroup`, `Rule`, `Annotation`, `Conflict`, `Replacement`) es leído por muchos consumers: el bus, los motores, los workers, la UI. Si es mutable:

- Race conditions cuando un motor edita un `EntityGroup` mientras la UI lo renderiza.
- No se puede comparar referencias para saber si algo cambió.
- Imposible hacer snapshots deterministas para tests.
- Difícil razonar sobre quién modificó qué.

## Decisión

**Todo dato público del Core es inmutable**:

- Todas las propiedades `readonly`.
- Todas las colecciones `ReadonlyArray<T>`, `ReadonlyMap<K,V>`, `ReadonlySet<T>`.
- Toda mutación se realiza con **copia estructural** y devuelve una nueva referencia.
- Se prohíbe `Object.freeze` en hot paths (costo runtime); el contrato se garantiza por tipos TS y tests.
- Los IDs (`documentId`, `groupId`, etc.) son inmutables y estables por sesión.

```ts
// Bien
function setGroupMode(group: EntityGroup, mode: ReplacementMode): EntityGroup {
  return { ...group, replacementMode: mode, updatedAt: Date.now() };
}
// Mal (prohibido)
function setGroupMode(group: EntityGroup, mode: ReplacementMode): void {
  (group as any).replacementMode = mode;
}
```

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **Mutable + Object.freeze profundo** | Costo de runtime significativo. No escala a 50 páginas. |
| **Mutable con "disciplina"** | Frágil. Cualquier IA económica o PR apurado rompe la disciplina. |
| **Immutability con Immer** | Buena lib, pero agrega una dependencia. La copia estructural manual con spread es suficiente para nuestros tipos. |
| **Immutable.js (persistent data structures)** | Tipado TS pobre, API propia, bundle grande. Overkill. |
| **Structural sharing con lib propia** | Costo de mantenimiento alto sin beneficio claro en nuestro volumen. |

## Consecuencias

**Positivas**:
- Referencias == cambios: `if (newGroup !== oldGroup)` es suficiente.
- React/Zustand re-render óptimo sin selectors complejos.
- Snapshots deterministas para tests.
- Razonamiento local: una función que recibe un `EntityGroup` no puede romper el estado global.
- Sin race conditions por mutación compartida (queda solo la coordinación por eventos, que es explícita).

**Negativas**:
- Costo de copia en updates frecuentes. Mitigado: nuestros updates son por interacción del usuario (bajos rate) o por batch del pipeline (se puede optimizar con copia solo del slice cambiado).
- Algo de boilerplate de spread. Aceptable.

**Neutras**:
- Para colecciones muy grandes (1000+ grupos), podemos usar copia lazy o estructuras persistentes en v1.0 si perf lo pide. MVP no lo necesita.

## Reglas

1. Todo tipo público en `core/Contracts.md` es `readonly`/`ReadonlyArray`.
2. Todo parámetro de función pública del Core se trata como inmutable.
3. Toda función que "modifica" devuelve una nueva referencia; el caller debe reasignar.
4. Tests verifican que ningún tipo público tiene propiedades mutables (lint rule custom).

## Referencias

- `03_Data_Model.md` (todos los tipos son inmutables)
- `ai/Code_Standards.md` §6
- `01_Technical_Architecture_Document.md` §2 A-8
- `adr/ADR-011-Grouping-First.md` (depende de inmutabilidad para updates de grupos)
