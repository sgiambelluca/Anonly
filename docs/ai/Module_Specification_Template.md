<!-- CONTEXT: scope=plantilla-de-spec | dependencias=ai/Code_Standards.md,core/Contracts.md | audiencia=IA+humanos | fase=0 -->

# Anonly — Plantilla de Especificación de Motor

> Esta es la **plantilla canónica**. Todo `docs/core/<Engine>_Engine.md` **debe** respetar este orden de secciones y estos nombres exactos de encabezado, sin agregar ni quitar secciones. Una IA económica debe poder implementar el motor leyendo únicamente este archivo más `docs/core/Contracts.md`.

---

## Cómo usar esta plantilla

1. Copiar el bloque de las 15 secciones abajo en un nuevo `docs/core/<Engine>_Engine.md`.
2. Reemplazar `<...>` con los valores concretos del motor.
3. Mantener **todos** los encabezados. Si una sección no aplica, escribir explícitamente "No aplica" con la justificación — nunca omitir.
4. Todo tipo o interfaz mencionado debe estar definido en `docs/core/Contracts.md` o en la sección "Interfaces públicas" del propio spec.
5. Todo `EngineErrorCode` mencionado debe estar en el enum de `@anonly/shared` y en `core/Contracts.md`.
6. Todo evento mencionado debe estar en `architecture/04_Event_System.md`.

---

## Encabezado obligatorio

```markdown
<!-- CONTEXT: scope=<engine-id> | dependencias=<lista-de-contratos-y-motores> | audiencia=IA-implementador | fase=3 -->

# <EngineName> — Spec de Motor

> <Una oración que dice qué hace el motor.>

**EngineId**: `<engineId>` (valor del enum `EngineId`)
**Versión del spec**: <semver>
**Última actualización**: <ISO date>
```

---

## Las 15 secciones (orden y contenido obligatorios)

### 1. Objetivo

Qué hace este motor y por qué existe. Una o dos oraciones. Sin detalles de implementación.

### 2. Responsabilidades

Lista de viñetas con las responsabilidades **exclusivas** del motor. Cada viñeta debe empezar con un verbo. Ej: "Extraer texto y posiciones de cada página del PDF".

### 3. Fuera de alcance

Lista de viñetas explícita de lo que el motor **no** hace. Esto es tan importante como las responsabilidades para evitar que una IA agregue código fuera de contrato. Ej: "Renderizar el PDF final", "Aplicar reemplazos", "Conocer React".

### 4. Dependencias permitidas

Lista de paquetes o motores de los que el motor puede importar. Siempre incluye `@anonly/shared`. Cualquier dependencia externa debe tener su ADR.

Formato:
```markdown
- `@anonly/shared` (tipos, contratos, error codes)
- `pdfjs-dist` (ADR-XXX)
- Tipos de `core/Contracts.md`: `IEngine`, `DocumentModel`, `PageRef`
```

### 5. Dependencias prohibidas

Lista explícita. Siempre incluye al menos:
- `react`, `react-dom`, `react/jsx-runtime`
- Cualquier otro motor del Core (comunicación solo por eventos)
- `apps/react-client`

### 6. Interfaces públicas

Bloque de código TypeScript con **todas** las interfaces, tipos y funciones que el motor exporta desde `index.ts`. Deben ser implementación-agnósticas (sin tipos de librerías internas filtrados). Incluir la firma de la clase que implementa `IEngine`.

```ts
export interface PdfEngineConfig {
  readonly maxPageCount: number;
  readonly enableOCR: boolean;
}

export class PdfEngine implements IEngine {
  readonly id = EngineId.Pdf;
  init(ctx: EngineContext): Promise<void>;
  process(input: PdfEngineInput, ctx: EngineContext): Promise<PdfEngineOutput>;
  dispose(): Promise<void>;
}
```

### 7. Eventos que emite

Tabla con: nombre del evento (enum `EngineEvents`), momento en que se emite, payload exacto (tipo), si es sincrónico o async, si es idempotente.

| Evento | Cuándo | Payload | Sync/Async | Idempotente |
|---|---|---|---|---|
| `PAGE_PARSED` | al finalizar parseo de una página | `PageParsedPayload` | async | sí |

### 8. Eventos que consume

Igual formato. Si el motor no consume eventos, escribir "No consume eventos." y justificar.

### 9. Entradas

Tipos y restricciones de las entradas que el motor acepta en `process(...)`. Incluir:

- Tipos del input (con todos sus campos).
- Restricciones de tamaño, formato, encoding.
- Qué pasa si la entrada es `null`/`undefined`/vacía.

```ts
export interface PdfEngineInput {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;      // PDF binario
  readonly password?: string;        // si el PDF está protegido
}
```

### 10. Salidas

Tipos de las salidas del `process(...)` y de los eventos que emite. Mencionar inmutabilidad (`readonly`, `ReadonlyArray`).

```ts
export interface PdfEngineOutput {
  readonly document: DocumentModel;
  readonly pageCount: number;
  readonly textlessPages: ReadonlyArray<number>; // índices que requieren OCR
}
```

### 11. Errores posibles

Tabla con: código (`EngineErrorCode`), clase de error, cuándo se lanza, si es recuperable, acción recomendada del consumidor.

| Code | Clase | Cuándo | Recuperable | Acción |
|---|---|---|---|---|
| `PDF_PASSWORD_REQUIRED` | `PdfPasswordRequiredError` | PDF protegido sin password | sí | pedir password al usuario y reintentar |
| `PDF_INVALID` | `PdfInvalidError` | no es un PDF válido | no | abortar pipeline, informar al usuario |

### 12. Consideraciones de rendimiento

- Costo esperado por unidad (página, ocurrencia, etc.).
- Uso de memoria típico y pico.
- Si corre en Worker (siempre sí para el Core pesado).
- Estrategia de streaming/incrementalidad.
- Tamaño de chunk recomendado si aplica.
- Transferencia zero-copy de `ArrayBuffer` (si aplica).

### 13. Casos límite

Lista numerada de situaciones que el motor **debe** manejar correctamente. Cada una con: descripción, comportamiento esperado, evento emitido o error lanzado.

1. PDF vacío (0 páginas).
2. PDF con 1000 páginas.
3. PDF protegido con password correcto.
4. PDF protegido con password incorrecto.
5. Página sin texto (requiere OCR).
6. PDF corrupto (header inválido).
7. ...

### 14. Casos de prueba

Lista de tests **obligatorios** con nombre y descripción. Cada test debe existir en `<engine>-engine/src/__tests__/`. Mapear a tipo de test (contract/unit/snapshot/edge).

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `emits PAGE_PARSED for each page` | `contract.test.ts` | contract | valida que se emite el evento por cada página |
| `throws PdfPasswordRequiredError on protected pdf without password` | `edge.test.ts` | edge | valida el error para PDF protegido |
| ... | ... | ... | ... |

### 15. Checklist de implementación

Lista numerada que un implementador (IA o humano) debe tachar en orden. Define el camino crítico.

- [ ] 1. Crear paquete `<engine>-engine` con `package.json` y `tsconfig.json` extends base.
- [ ] 2. Definir `types.ts` con todas las interfaces de "Interfaces públicas".
- [ ] 3. Definir `errors.ts` con todas las clases de "Errores posibles".
- [ ] 4. Implementar `<engine>.engine.ts` respetando `IEngine`.
- [ ] 5. Implementar `init`, `process`, `dispose` con `AbortSignal` en cada uno.
- [ ] 6. Cablear eventos emitidos/consumidos contra `IEventBus`.
- [ ] 7. Escribir `contract.test.ts` con todos los tests de "Casos de prueba" tipo contract.
- [ ] 8. Escribir `unit.test.ts` con cobertura ≥ 85%.
- [ ] 9. Escribir `edge.test.ts` con todos los "Casos límite".
- [ ] 10. Agregar snapshot de `DocumentModel` si produce uno.
- [ ] 11. Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test` y verificar verde.
- [ ] 12. Verificar que `index.ts` exporta solo lo público.
- [ ] 13. Verificar que ninguna dependencia prohibida aparece en imports.
- [ ] 14. Actualizar `core/Contracts.md` si se agregó un tipo nuevo compartido.
- [ ] 15. Actualizar `architecture/04_Event_System.md` si se agregó un evento.

---

## Notas para quien completa la plantilla

- **No** agregar secciones extra (FAQ, Ejemplos, etc.). Si hace falta, va en un `docs/core/<Engine>_Notes.md` aparte, referenciado desde el spec.
- **No** incluir código de implementación, solo firmas. La implementación es trabajo del motor, no del spec.
- **No** mencionar nombres de librerías internas de implementación. Solo las permitidas en "Dependencias permitidas" con su ADR.
- Toda constante numérica (umbrales, timeouts, tamaños) debe estar **nombrada** en el spec, no hardcodeada en prosa. Ej: "umbral de similitud `GROUPING_SIMILARITY_THRESHOLD = 0.88`".
