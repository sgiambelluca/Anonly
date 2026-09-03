/**
 * Mocks y builders compartidos por los tests de @anonly/grouping-engine.
 *
 * A diferencia de regex-engine/ner-engine (motores que solo EMITEN eventos),
 * Grouping Engine también CONSUME `ENTITY_FOUND`/`REGEX_FINISHED`/
 * `NER_FINISHED` vía `ctx.bus.on(...)` dentro de `init()`. Para ejercitar esa
 * ruta de entrada sin duplicar la lógica de despacho del bus, `createEngineContext`
 * usa el `EventBus` REAL de `@anonly/event-system` (permitido en `__tests__`,
 * excepción explícita de la regla P-2) en vez de un mock de `IEventBus`: los
 * tests emiten `ENTITY_FOUND` con `ctx.bus.emit(...)` y eso dispara el handler
 * registrado por el engine, exactamente como en producción. Las aserciones
 * sobre lo que el engine emite hacia afuera (`ENTITY_GROUP_CREATED`, etc.) se
 * hacen con `vi.spyOn(ctx.bus, "emit")`, que sigue registrando la llamada real
 * (spyOn no reemplaza la implementación por default) — mismo criterio que
 * regex-engine/ner-engine usan sobre su bus mockeado.
 */
import { DetectionSource, EntityType, ReplacementMode, type BoundingBox, type EntityGroup, type Occurrence, type Rule, type RuleScope } from "@anonly/shared";
import type { EngineConfig, EngineContext } from "@anonly/shared";
import { createEngineContextWithRealBus as sharedCreateEngineContextWithRealBus, createMockConfig as sharedCreateMockConfig } from "@anonly/test-utils";

/*
 * ADR-129: los dobles genéricos viven en `@anonly/test-utils`. Se re-exportan
 * acá para que cada suite siga importando de un solo lugar.
 */
export {
  createMockCache,
  createMockLogger,
} from "@anonly/test-utils";

/*
 * `createEngineContext` de este motor arma un bus **real**, no mockeado, y por
 * eso se aliasa en vez de heredar el genérico: `grouping-engine` es el único
 * que además de emitir **consume** eventos (`ENTITY_FOUND`, los requests de la
 * UI), así que sus tests necesitan un bus que de verdad entregue. Heredar el de
 * bus mockeado los dejaría sin recibir nada, en silencio.
 */

let occurrenceSeq = 0;

export function makeBBox(x = 10, y = 100, width = 60, height = 12): BoundingBox {
  return { x, y, width, height };
}

/**
 * Construye una `Occurrence` válida con defaults razonables (tipo DNI). Cada
 * llamada sin `id` explícito genera uno distinto (`occ-N`) para que las
 * aserciones que comparan `members`/`occurrenceId` no choquen entre tests.
 *
 * El `bbox` por defecto varía por llamada (`y` corrido por `occurrenceSeq`):
 * dos `Occurrence` sin bbox explícito representan ubicaciones DISTINTAS del
 * documento (ADR-038 §3: la identidad de dedup es (entityType, pageIndex,
 * bbox, normalizedValue) con igualdad estricta de bbox — dos llamadas con el
 * mismo bbox por "casualidad" del default colisionarían con el invariante de
 * dedup permanente). Los tests que necesitan a propósito el MISMO bbox
 * (overlap/disagree, o el propio test de dedup) lo pasan explícito vía
 * `overrides.bbox`, que siempre gana sobre este default.
 */
export function makeOccurrence(overrides?: Partial<Occurrence>): Occurrence {
  occurrenceSeq += 1;
  return {
    id: `occ-${occurrenceSeq}`,
    value: "34.567.891",
    normalizedValue: "34567891",
    bbox: makeBBox(10, 100 + occurrenceSeq * 20, 60, 12),
    pageIndex: 0,
    source: DetectionSource.Regex,
    confidence: 1.0,
    entityType: EntityType.DNI,
    ...overrides,
  };
}

let groupSeq = 0;

/**
 * Construye un `EntityGroup` válido directamente (sin pasar por el motor),
 * para probar funciones puras de `labels.ts`/`gender.ts` (`resolveLabelSet`,
 * `buildPlaceholderValue`, `inferPersonGender`) que solo necesitan la forma
 * pública del grupo — no un `InternalGroup` de sesión real. Precedente:
 * `makeOccurrence`/`makeRule` en este mismo archivo.
 */
export function makeEntityGroup(overrides?: Partial<EntityGroup>): EntityGroup {
  groupSeq += 1;
  const now = Date.now();
  return {
    id: `group-${groupSeq}`,
    type: EntityType.Person,
    canonicalValue: "Julia Gomez",
    members: [
      {
        occurrenceId: `occ-group-${groupSeq}`,
        value: "valor",
        pageIndex: 0,
        bbox: makeBBox(0, 0, 200, 20),
        source: DetectionSource.Regex,
      },
    ],
    needsReview: false,
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "",
    indexInType: 1,
    enabled: true,
    aliases: ["Julia Gomez"],
    replacementValueUserSet: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

let ruleSeq = 0;

/** Construye una `Rule` válida. `scope`/`target.kind` siempre coinciden. */
export function makeRule(
  scope: RuleScope,
  mode: ReplacementMode,
  options?: {
    readonly groupId?: string;
    readonly entityType?: EntityType;
    readonly priority?: number;
    readonly enabled?: boolean;
  },
): Rule {
  ruleSeq += 1;
  const now = Date.now();
  return {
    id: `rule-${ruleSeq}`,
    scope,
    target: {
      kind: scope,
      ...(options?.groupId !== undefined ? { groupId: options.groupId } : {}),
      ...(options?.entityType !== undefined ? { entityType: options.entityType } : {}),
    },
    mode,
    priority: options?.priority ?? 1,
    enabled: options?.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
}

/*
 * ADR-129: el `workerPool` —idéntico en los seis motores— sale del doble
 * compartido; acá quedan **solo** los campos que este motor necesita distintos,
 * con los mismos valores que tenía su copia propia.
 */
export function createMockConfig(overrides?: Partial<EngineConfig>): EngineConfig {
  return sharedCreateMockConfig({
    ner: {
      modelId: "test-model",
      quantization: "q8",
      confidenceThreshold: 0.7,
      batchSize: 256,
      enabled: true,
    },
    ocr: { languages: ["spa", "eng"], dpi: 300 },
    ...overrides,
  });
}

/*
 * El `EngineContext` compartido arma su config internamente, así que hay que
 * pasarle la de este motor: si no, `ctx.config` sale con los defaults genéricos
 * y no con los que sus tests necesitan (ADR-129).
 * Usa el de **bus real**: `grouping-engine` es el único motor que además de
 * emitir **consume** eventos, así que sus tests necesitan un bus que de
 * verdad entregue, no uno que registre llamadas.
 */
export function createEngineContext(overrides?: Partial<EngineContext>): EngineContext {
  return sharedCreateEngineContextWithRealBus({ config: createMockConfig(), ...overrides });
}
