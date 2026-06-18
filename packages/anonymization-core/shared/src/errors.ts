/**
 * @anonly/shared — Jerarquía de errores del Core.
 *
 * Fuente de verdad: docs/core/Contracts.md §4 y docs/ai/Code_Standards.md §7.
 *
 * Reglas:
 * - Toda función pública que puede fallar retorna Result<T, EngineError> O lanza
 *   una subclase de EngineError (nunca Error genérico ni string).
 * - Toda subclase setea code, engineId, retryable y details.
 * - details es Readonly<Record<string, unknown>> y se freezea en el constructor.
 */

import { EngineErrorCode, type EngineId } from "./enums.js";

export interface SerializedEngineError {
  readonly code: EngineErrorCode;
  readonly engineId: EngineId | "core";
  readonly message: string;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>>;
}

export abstract class EngineError extends Error {
  abstract readonly code: EngineErrorCode;
  abstract readonly engineId: EngineId | "core";
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(message: string, retryable: boolean, details?: Record<string, unknown>) {
    // EngineError es abstract: las subclases concretas setean `code` y `engineId`.
    // DeserializedEngineError es la única instanciación directa permitida (vía deserialize()).
    if (new.target === EngineError) {
      throw new TypeError(
        "EngineError es abstract. Usá una subclase concreta (InvalidInputError, EngineNotInitializedError, etc.).",
      );
    }
    super(message);
    this.name = this.constructor.name;
    this.retryable = retryable;
    this.details = Object.freeze({ ...(details ?? {}) });
  }

  serialize(): SerializedEngineError {
    return {
      code: this.code,
      engineId: this.engineId,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }

  static deserialize(serialized: SerializedEngineError): EngineError {
    // Reconstruye un error genérico tipado a partir de su forma serializada.
    // Los motores específicos pueden override para devolver su subclase concreta.
    return new DeserializedEngineError(serialized);
  }
}

class DeserializedEngineError extends EngineError {
  readonly code: EngineErrorCode;
  readonly engineId: EngineId | "core";

  constructor(serialized: SerializedEngineError) {
    super(serialized.message, serialized.retryable, { ...serialized.details });
    this.code = serialized.code;
    this.engineId = serialized.engineId;
  }
}

// Errores genéricos compartidos por todos los motores.

export class EngineNotInitializedError extends EngineError {
  readonly code = EngineErrorCode.ENGINE_NOT_INITIALIZED;
  readonly engineId = "core" as const;

  constructor(engineId: EngineId) {
    super(`Engine ${engineId} no está inicializado. Llamá init() antes de process().`, false, {
      engineId,
    });
  }
}

export class EngineDisposedError extends EngineError {
  readonly code = EngineErrorCode.ENGINE_DISPOSED;
  readonly engineId = "core" as const;

  constructor(engineId: EngineId) {
    super(`Engine ${engineId} fue dispuesto. No se puede usar después de dispose().`, false, {
      engineId,
    });
  }
}

export class InvalidInputError extends EngineError {
  readonly code = EngineErrorCode.INVALID_INPUT;
  readonly engineId = "core" as const;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, false, details);
  }
}

export class CancelledError extends EngineError {
  readonly code = EngineErrorCode.CANCELLED;
  readonly engineId = "core" as const;

  constructor(jobId?: string) {
    super("Operación cancelada por el usuario.", false, { jobId });
  }
}
