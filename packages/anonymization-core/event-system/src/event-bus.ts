/**
 * @anonly/event-system — Implementación del Event Bus tipado.
 *
 * Fuente de verdad: docs/adr/ADR-007-Event-Bus.md y docs/core/Contracts.md §3.2.
 *
 * Reglas (ADR-007):
 * - Sin dependencias externas.
 * - Tipado end-to-end: el TS falla si alguien emite un evento con payload incorrecto.
 * - Canales como string (EventChannel de @anonly/shared).
 * - `emit` es fire-and-forget: el emisor no bloquea.
 * - `emitAsync` retorna Promise (para allow await en callers; handlers son sync).
 * - Handlers no pueden lanzar: si lanzan, se loguea y el bus continúa.
 * - Sin loops: el bus no se auto-suscribe.
 * - Inmutabilidad: el payload se trata como readonly; el bus no lo freezea (costo runtime),
 *   el contrato se garantiza por tipos TS y tests.
 */

import {
  type EngineEvents,
  type EventPayloadMap,
  type IEventBus,
  type EventHandler,
  type Unsubscribe,
  type EventChannelLike,
  type ILogger,
} from "@anonly/shared";

type HandlerSet<E extends EngineEvents> = Set<EventHandler<E>>;
type EventMap<E extends EngineEvents> = Map<E, HandlerSet<E>>;
type ChannelMap = Map<EventChannelLike, EventMap<EngineEvents>>;

export interface EventBusOptions {
  /**
   * Logger opcional para reportar handlers que lanzan.
   * Si no se provee, se usa console.error (solo para errores de handler).
   * En el Core, el Orchestrator inyecta un logger real vía EngineContext.
   */
  readonly logger?: ILogger;
}

export class EventBus implements IEventBus {
  private readonly channels: ChannelMap = new Map();
  private readonly logger: ILogger | undefined;
  private disposed = false;

  constructor(options: EventBusOptions = {}) {
    this.logger = options.logger;
  }

  on<E extends EngineEvents>(
    channel: EventChannelLike,
    event: E,
    handler: EventHandler<E>,
  ): Unsubscribe {
    this.assertNotDisposed();
    this.addHandler(channel, event, handler);
    return () => this.off(channel, event, handler);
  }

  once<E extends EngineEvents>(
    channel: EventChannelLike,
    event: E,
    handler: EventHandler<E>,
  ): Unsubscribe {
    this.assertNotDisposed();
    const wrapper: EventHandler<E> = (payload) => {
      this.off(channel, event, wrapper);
      this.invokeHandler(handler, payload, channel, event);
    };
    return this.on(channel, event, wrapper);
  }

  off<E extends EngineEvents>(channel: EventChannelLike, event: E, handler: EventHandler<E>): void {
    this.assertNotDisposed();
    const eventMap = this.channels.get(channel);
    if (!eventMap) return;
    const handlers = eventMap.get(event);
    if (!handlers) return;
    handlers.delete(handler as EventHandler<EngineEvents>);
    if (handlers.size === 0) {
      eventMap.delete(event);
    }
    if (eventMap.size === 0) {
      this.channels.delete(channel);
    }
  }

  emit<E extends EngineEvents>(
    channel: EventChannelLike,
    event: E,
    payload: EventPayloadMap[E],
  ): void {
    this.assertNotDisposed();
    const handlers = this.getHandlers(channel, event);
    if (!handlers) return;
    // Copiar el set para soportar unsubscribe durante la iteración.
    const snapshot = Array.from(handlers);
    for (const handler of snapshot) {
      this.invokeHandler(handler, payload, channel, event);
    }
  }

  emitAsync<E extends EngineEvents>(
    channel: EventChannelLike,
    event: E,
    payload: EventPayloadMap[E],
  ): Promise<void> {
    this.assertNotDisposed();
    // Actualmente handlers son sync (void). emitAsync permite await en callers
    // y deja la puerta abierta a handlers async futuros sin romper el contrato.
    this.emit(channel, event, payload);
    return Promise.resolve();
  }

  dispose(): void {
    this.assertNotDisposed();
    this.channels.clear();
    this.disposed = true;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Cantidad de suscriptores para un (channel, event).
   * Útil para tests de contrato de la matriz emisor→receptor.
   */
  subscriberCount(channel: EventChannelLike, event: EngineEvents): number {
    return this.getHandlers(channel, event)?.size ?? 0;
  }

  /**
   * Cantidad de canales activos. Útil para tests.
   */
  channelCount(): number {
    return this.channels.size;
  }

  // ─── Internos ───

  private addHandler<E extends EngineEvents>(
    channel: EventChannelLike,
    event: E,
    handler: EventHandler<E>,
  ): void {
    let eventMap = this.channels.get(channel);
    if (!eventMap) {
      eventMap = new Map() as EventMap<EngineEvents>;
      this.channels.set(channel, eventMap);
    }
    let handlers = eventMap.get(event);
    if (!handlers) {
      handlers = new Set() as HandlerSet<EngineEvents>;
      eventMap.set(event, handlers);
    }
    handlers.add(handler as EventHandler<EngineEvents>);
  }

  private getHandlers<E extends EngineEvents>(
    channel: EventChannelLike,
    event: E,
  ): HandlerSet<E> | undefined {
    const eventMap = this.channels.get(channel);
    if (!eventMap) return undefined;
    return eventMap.get(event) as HandlerSet<E> | undefined;
  }

  private invokeHandler<E extends EngineEvents>(
    handler: EventHandler<E>,
    payload: EventPayloadMap[E],
    channel: EventChannelLike,
    event: E,
  ): void {
    try {
      handler(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.logger) {
        this.logger.error("Handler lanzó en EventBus", {
          channel,
          event,
          error: msg,
        });
      } else {
        // Fallback: solo para errores de handler, no para loguear contenido del documento.
        console.error(`[EventBus] Handler en channel="${channel}" event="${event}" lanzó: ${msg}`);
      }
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("EventBus fue dispuesto. Llamá a createEventBus() para obtener uno nuevo.");
    }
  }
}

/**
 * Factory público. Preferido sobre `new EventBus()` para permitir
 * cambios internos sin romper callers.
 */
export function createEventBus(options?: EventBusOptions): EventBus {
  return new EventBus(options ?? {});
}
