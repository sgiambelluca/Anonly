/**
 * `polyfills.test.ts` — `installPromiseWithResolvers` (ADR pendiente; ver
 * `polyfills.ts` para el porqué: Safari < 17.4 no lo trae y sin esto
 * `pdfjs-dist` 4.x no parsea ningún PDF).
 */
import { describe, expect, it, vi } from "vitest";

import { installPromiseWithResolvers } from "../polyfills.js";

/**
 * Un `PromiseConstructor` sin `withResolvers`, como el de Safari 17.0.
 *
 * `delete` no alcanza: una subclase **hereda** los estáticos de `Promise` por
 * la cadena de prototipos, así que no hay propiedad propia que borrar y el
 * método seguía estando. Hay que **taparlo** con una propiedad propia.
 */
function safari17(): PromiseConstructor {
  class P extends Promise<unknown> {}
  // `Reflect` y no `Object`: este último devuelve la clase, que al extender
  // Promise el linter lee como una promesa suelta. `Reflect` devuelve boolean.
  Reflect.defineProperty(P, "withResolvers", { value: undefined, configurable: true });
  return P as unknown as PromiseConstructor;
}

describe("installPromiseWithResolvers", () => {
  it("lo instala cuando el navegador no lo trae", () => {
    const target = safari17();
    expect(typeof target.withResolvers).toBe("undefined");

    installPromiseWithResolvers(target);

    expect(typeof target.withResolvers).toBe("function");
  });

  it("resuelve: la promesa devuelta adopta el valor que se le pasa a resolve", async () => {
    const target = safari17();
    installPromiseWithResolvers(target);

    const { promise, resolve } = target.withResolvers!<string>();
    resolve("listo");

    await expect(promise).resolves.toBe("listo");
  });

  it("rechaza: reject propaga el motivo", async () => {
    const target = safari17();
    installPromiseWithResolvers(target);

    const { promise, reject } = target.withResolvers!<never>();
    const motivo = new Error("no");
    reject(motivo);

    await expect(promise).rejects.toBe(motivo);
  });

  it("resolve y reject ya existen cuando withResolvers retorna", () => {
    // El bug clásico de una implementación ingenua que asigna en un `then`:
    // el executor de Promise corre SINCRÓNICAMENTE, y de eso depende que
    // pdfjs pueda guardarse el `resolve` para llamarlo más tarde.
    const target = safari17();
    installPromiseWithResolvers(target);

    const d = target.withResolvers!<number>();

    expect(typeof d.resolve).toBe("function");
    expect(typeof d.reject).toBe("function");
  });

  it("no pisa la implementación nativa cuando el navegador ya la trae", () => {
    const nativa = vi.fn();
    const target = safari17();
    Object.defineProperty(target, "withResolvers", { value: nativa, configurable: true });

    installPromiseWithResolvers(target);

    expect(target.withResolvers).toBe(nativa);
  });
});
