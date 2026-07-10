<!-- CONTEXT: scope=regex-engine | dependencias=core/Contracts.md,architecture/06_Pipeline.md | audiencia=IA-implementador | fase=3 -->

# Regex Engine — Spec de Motor

> Detecta patrones determinísticos (DNI, CUIT, teléfono, email, IBAN, tarjeta, fecha, matrícula, patente) en el texto de cada página. Emite `Occurrence[]` con `source: "regex"` y `confidence: 1.0`. Es determinista: mismo input → mismo output.

**EngineId**: `regex`
**Versión del spec**: 1.0.1
**Última actualización**: 2026-07-10

---

## 1. Objetivo

Recorrer el `Document` (con texto ya fusionado PDF+OCR) y emitir `Occurrence[]` para cada patrón matcheado, mapeando el match a `BoundingBox` en la página.

---

## 2. Responsabilidades

- Cargar los patrones default de tipos argentinos (DNI, CUIT/CUIL, teléfono, email, IBAN, tarjeta, fecha, matrícula, patente).
- Aplicar cada patrón a `Page.text` y mapear matches a `Occurrence` con `bbox`, `pageIndex`, `entityType`.
- Soportar patrones custom del usuario (con validación: regex válida + `entityType` válido).
- Validar con checksum cuando aplique (CUIT con dígito verificador, tarjeta con Luhn).
- Emitir `ENTITY_FOUND` por ocurrencia (evento **interno**, solo escuchado por Grouping Engine).
- Emitir `REGEX_FINISHED` al final.
- Normalizar el `normalizedValue` de cada ocurrencia (sin puntuación redundante, lowercase) para agrupación consistente.

---

## 3. Fuera de alcance

- Detectar personas, organizaciones ni direcciones (es tarea de NER).
- Agrupar ocurrencias (es tarea de Grouping Engine).
- Renderizar el PDF.
- Conocer React ni UI.
- Persistir nada.
- Hacer OCR.

---

## 4. Dependencias permitidas

- `@anonly/shared`
- Tipos de `core/Contracts.md`: `IEngine`, `EngineContext`, `Document`, `Page`, `Word`, `Occurrence`, `EntityType`, `DetectionSource`, `BoundingBox`
- `architecture/04_Event_System.md`: `ENTITY_FOUND`, `REGEX_FINISHED`

No requiere dependencias externas: usa `RegExp` nativo de JS.

---

## 5. Dependencias prohibidas

- `react`, `react-dom`, `react/jsx-runtime`
- `apps/react-client`
- Cualquier otro motor
- `pdfjs-dist`, `tesseract.js`, `@xenova/transformers`, `onnxruntime-web`, `pdf-lib`
- Node builtins, libs de network
- Libs de regex externas (`xregexp`, etc.) sin ADR

---

## 6. Interfaces públicas

```ts
export interface RegexPattern {
  readonly id: string;                    // "dni-ar", "cuit-ar", etc.
  readonly entityType: EntityType;
  readonly pattern: RegExp;
  readonly checksum?: (value: string) => boolean;  // validación adicional (CUIT, tarjeta)
  readonly normalizer: (value: string) => string;  // produce normalizedValue
  readonly maskFormat: string;            // "XX.XXX.XXX" — referenciado por Render/Export
}

export interface RegexEngineConfig {
  readonly patterns: ReadonlyArray<RegexPattern>;
  readonly customPatterns: ReadonlyArray<RegexPattern>;  // del usuario
}

export interface RegexEngineInput {
  readonly document: Document;
}

export interface RegexEngineOutput {
  readonly documentId: string;
  readonly occurrenceCount: number;
  readonly durationMs: number;
}

export class RegexEngine implements IEngine {
  readonly id = EngineId.Regex;
  init(ctx: EngineContext): Promise<void>;
  process(input: RegexEngineInput, ctx: EngineContext): Promise<RegexEngineOutput>;
  addPattern(pattern: RegexPattern): void;       // runtime, para UI
  removePattern(patternId: string): void;
  dispose(): Promise<void>;
}
```

Patrones default exportados desde `index.ts`:

```ts
export const DEFAULT_PATTERNS_AR: ReadonlyArray<RegexPattern>;
```

---

## 7. Eventos que emite

| Evento | Cuándo | Payload | Sync/Async | Idempotente |
|---|---|---|---|---|
| `ENTITY_FOUND` | por cada ocurrencia detectada | `EntityFound` con `occurrence.source = "regex"`, `confidence = 1.0` | async | sí |
| `REGEX_FINISHED` | al finalizar todas las páginas | `RegexFinished` | async | sí |

Canal: `EventChannel.Regex`.

---

## 8. Eventos que consume

No consume eventos.

---

## 9. Entradas

```ts
RegexEngineInput {
  document: Document;   // inmutable, con Page.text y Page.words ya fusionados
}
```

**Restricciones**:
- `document.pages` no vacío (si está vacío, retorna con `occurrenceCount = 0`).
- `Page.text` debe estar normalizado (NFC) por la etapa 3 del pipeline.

---

## 10. Salidas

```ts
RegexEngineOutput {
  documentId: string;
  occurrenceCount: number;
  durationMs: number;
}
```

Las `Occurrence` individuales no se retornan; se emiten vía `ENTITY_FOUND`. Cada `Occurrence`:

```ts
{
  id: string;                  // UUID v4
  value: string;               // texto matcheado, sin normalizar de presentación
  normalizedValue: string;     // para agrupar (sin puntuación redundante, lowercase)
  bbox: BoundingBox;           // mapeado desde el span en Page.words
  pageIndex: number;
  source: DetectionSource.Regex;
  confidence: 1.0;
  entityType: EntityType;      // según el patrón que matcheó
  wordSpan?: WordSpan;         // referencia a Page.words[startIndex, endIndexExclusive)
}
```

---

## 11. Errores posibles

| Code | Clase | Cuándo | Recuperable | Acción |
|---|---|---|---|---|
| `REGEX_INVALID_PATTERN` | `RegexInvalidPatternError` | patrón custom del usuario con regex inválida | no | descartar el patrón con warning, continuar con los demás |
| `ENGINE_NOT_INITIALIZED` | `EngineNotInitializedError` | `process` antes de `init` | no | bug del caller |
| `ENGINE_DISPOSED` | `EngineDisposedError` | `process` tras `dispose` | no | bug del caller |
| `INVALID_INPUT` | `InvalidInputError` | input null/undefined | no | bug del caller |

Regex es determinista: si la regex compila, no hay errores de runtime. Errores de un patrón custom no bloquean los demás.

`retryable`: todos `false` (no tiene sentido reintentar un cálculo determinista).

---

## 12. Consideraciones de rendimiento

- **Corre en main thread** (no en Worker). Es ligero: < 5% del total del pipeline.
- Costo: 5–50 ms por página dependiendo del número de patrones y densidad de texto.
- Memoria: < 10 MB (solo estructuras de output).
- Sin transferencia de buffers (trabaja sobre `Document` en memoria).
- Procesa página por página; entre páginas chequea `abortSignal` para cancelación.
- Para patrones custom complejos (catastrophic backtracking), se envuelve en `try/catch` con timeout de 1000 ms por página por patrón. Si timeout, se descarta el patrón custom con warning.

---

## 13. Casos límite

1. **Documento vacío (0 páginas)**: retorna `occurrenceCount = 0` sin emitir nada.
2. **Página sin texto**: 0 ocurrencias en esa página.
3. **DNI con y sin puntos (`34.567.891` y `34567891`)**: ambos matchean; `normalizedValue = "34567891"` para ambos → Grouping los unifica.
4. **CUIT inválido (dígito verificador incorrecto)**: el patrón matchea pero `checksum` falla → se descarta el match (no se emite `ENTITY_FOUND`).
5. **Tarjeta con Luhn inválido**: idem.
6. **Email edge case (`a@b.c`)**: el patrón default es RFC 5322 simplificado; requiere al menos `x@y.zz`. `a@b.c` no matchea.
7. **Patente AR vieja (`ABC 123`) vs Mercosur (`AB 123 CD`)**: dos patrones distintos; ambos emitirán `EntityType.Plate`.
8. **Patrón custom con regex inválida**: lanza `RegexInvalidPatternError` (capturado por el caller), se descarta el patrón, los demás siguen.
9. **Patrón custom con catastrophic backtracking**: timeout 1000 ms por página, se descarta el patrón con warning.
10. **Overlap entre dos patrones (DNI dentro de un CUIT)**: el CUIT es más específico; el motor prioriza el match más largo en el mismo span. Solo se emite el CUIT.
11. **Cancelación entre páginas**: aborta en < 50 ms (no requiere Worker, basta no iterar más).
12. **`process` tras `dispose`**: lanza `EngineDisposedError`.
13. **100 patrones custom activos**: el costo escala lineal con #patrones; 100 patrones × 50 páginas = 5000 ejecuciones de regex. Mitigado: compilar todas las regex al `init`, reutilizar instancias `RegExp` compiladas.

---

## 14. Casos de prueba

| Test | Archivo | Tipo | Descripción |
|---|---|---|---|
| `emits ENTITY_FOUND per match` | `contract.test.ts` | contract | invariante |
| `emits REGEX_FINISHED after all pages` | `contract.test.ts` | contract | invariante |
| `occurrence.source === "regex"` | `contract.test.ts` | contract | invariante |
| `occurrence.confidence === 1.0` | `contract.test.ts` | contract | invariante |
| `DNI with and without dots normalizes to same` | `unit.test.ts` | unit | caso 3 |
| `CUIT with invalid checksum is discarded` | `edge.test.ts` | edge | caso 4 |
| `Credit card with invalid Luhn is discarded` | `edge.test.ts` | edge | caso 5 |
| `invalid email does not match` | `edge.test.ts` | edge | caso 6 |
| `AR plate vieja and Mercosur both match as Plate` | `edge.test.ts` | edge | caso 7 |
| `custom invalid regex throws and is discarded` | `edge.test.ts` | edge | caso 8 |
| `custom catastrophic regex times out and is discarded` | `edge.test.ts` | edge | caso 9 |
| `DNI inside CUIT only emits CUIT` | `edge.test.ts` | edge | caso 10 |
| `cancel between pages within 50ms` | `cancel.test.ts` | cancel | caso 11 |
| `throws EngineDisposedError after dispose` | `edge.test.ts` | edge | caso 12 |
| `100 custom patterns complete within perf budget` | `perf.test.ts` (en `tests/perf/`) | perf | caso 13 |
| `empty document returns 0 occurrences` | `edge.test.ts` | edge | caso 1 |
| `textless page returns 0 occurrences` | `edge.test.ts` | edge | caso 2 |
| `snapshot of occurrences for text-10p.pdf stable` | `snapshot.test.ts` | snapshot | fixture |

Fixtures: `tests/fixtures/text-10p.pdf` (con DNIs, CUITs, emails, teléfonos conocidos).

---

## 15. Checklist de implementación

- [ ] 1. Crear paquete `packages/anonymization-core/regex-engine/`.
- [ ] 2. Definir `types.ts` con `RegexPattern`, `RegexEngineConfig`, `RegexEngineInput`, `RegexEngineOutput`.
- [ ] 3. Definir `errors.ts` con `RegexInvalidPatternError`.
- [ ] 4. Implementar `DEFAULT_PATTERNS_AR` en `patterns/default-ar.ts` con todos los patrones y sus `checksum`/`normalizer`/`maskFormat`.
- [ ] 5. Implementar `regex.engine.ts` respetando `IEngine` y la firma pública de §6.
- [ ] 6. Implementar `init` (compilar todas las regex al cargar, incluyendo custom).
- [ ] 7. Implementar `process` recorriendo páginas, aplicando patrones, mapeando matches a `bbox` vía `Word` positions, emitiendo `ENTITY_FOUND` por match, `REGEX_FINISHED` al final.
- [ ] 8. Implementar priorización de match más largo en overlap (caso 10).
- [ ] 9. Implementar timeout por patrón custom (1000 ms).
- [ ] 10. Implementar `addPattern`/`removePattern` (recompila la lista activa).
- [ ] 11. Implementar `dispose` (limpia lista de patrones, sin recursos externos que liberar).
- [ ] 12. Escribir `contract.test.ts` con todos los tests contractuales.
- [ ] 13. Escribir `unit.test.ts` con cobertura ≥ 85%.
- [ ] 14. Escribir `edge.test.ts` con todos los casos límite.
- [ ] 15. Escribir `snapshot.test.ts` con occurrences de `text-10p.pdf`.
- [ ] 16. Ejecutar `pnpm lint && pnpm typecheck && pnpm test` verde.
- [ ] 17. Verificar `index.ts` exporta solo `RegexEngine`, tipos, `DEFAULT_PATTERNS_AR`, errores.
- [ ] 18. Verificar imports sin dependencias prohibidas.

---

## Patrones default (especificación exacta)

Los patrones exactos viven en `patterns/default-ar.ts` y son parte del contrato público. Resumen:

| Tipo | Pattern (resumen) | Checksum | Normalizer |
|---|---|---|---|
| DNI (AR) | `\b\d{1,2}\.?\d{3}\.?\d{3}\b` | – | strip dots → "34567891" |
| CUIT/CUIL (AR) | `\b\d{2}-?\d{8}-?\d\b` | algoritmo módulo 11 | strip dashes → "20123456789" |
| Phone (AR mobile) | `(?:\+?54)?[\s-]?\b\d{2}[\s-]?\d{4}[\s-]?\d{4}\b` | – | strip no-digit → "541112345678" |
| Phone (AR landline) | `\b0\d{1,4}[\s-]?\d{6,8}\b` | – | strip no-digit |
| Email | `\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b` | – | lowercase |
| IBAN | `\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b` | ISO 13616 check | uppercase, strip spaces |
| CreditCard | `\b(?:\d[ -]*?){13,19}\b` | Luhn | strip non-digit |
| Date (AR) | `\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b` | validación rango (día 1-31, mes 1-12) | normaliza a "DD/MM/YYYY" |
| License (AR) | `\b[A-Z]{1,3}-?\d{4,8}-?\d?\b` (matrícula profesional) | – | uppercase, strip dashes |
| Plate (AR vieja) | `\b[A-Z]{3}\s?\d{3}\b` | – | uppercase, strip spaces |
| Plate (AR Mercosur) | `\b[A-Z]{2}\s?\d{3}\s?[A-Z]{2}\b` | – | uppercase, strip spaces |

La implementación debe respetar estos patrones y checksums. Cualquier cambio requiere ADR nuevo.

> El patrón "Phone (AR mobile)" fue corregido en la versión 1.0.1 del spec agregando límites de
> palabra (`\b`) en ambos extremos, consistente con los otros 10 patrones de la tabla. Ver
> `adr/ADR-022-Regex-Phone-AR-Word-Boundaries.md` para el detalle del problema (rompía el caso
> límite 3, §13) y la decisión.

---

## Referencias

- `architecture/06_Pipeline.md` §6 (etapa 4, Regex)
- `03_Data_Model.md` §7 (Occurrence), §16 (DetectionSource)
- `04_Event_System.md` §5 (eventos `ENTITY_FOUND`, `REGEX_FINISHED`)
- `adr/ADR-011-Grouping-First.md` (por qué Regex emite a Grouping, no a UI)
- `adr/ADR-012-Replacement-Modes.md` (maskFormat por tipo)
- `adr/ADR-022-Regex-Phone-AR-Word-Boundaries.md` (corrección del patrón Phone AR mobile, v1.0.1)
