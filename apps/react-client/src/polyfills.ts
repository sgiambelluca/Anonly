/**
 * `polyfills.ts` — lo que la app necesita que el navegador ya no le da.
 *
 * Se importa **primero** en `main.tsx`: los `import` de un módulo ES se
 * evalúan en orden, así que todo lo de acá corre antes de que se evalúe
 * `pdfjs-dist` y mucho antes del primer `getDocument()`.
 */

/**
 * `Promise.withResolvers` llegó a Safari en la **17.4**, y `pdfjs-dist` 4.x lo
 * usa adentro. En Safari 17.0 eso hace que **ningún** PDF se pueda parsear:
 * el worker de pdf.js lanza `Promise.withResolvers is not a function`, y
 * `pdf.engine.ts` reclasifica cualquier fallo de documento como
 * `PDF_INVALID` (ADR-020 §4), así que al usuario le llega "El archivo no es
 * un PDF válido" sobre un PDF perfectamente válido — indistinguible de uno
 * corrupto de verdad.
 *
 * Medido el 2026-08-28 sobre Safari 17.0: 100 % de los documentos rechazados.
 * No es un caso de borde de una versión vieja y rara — es la versión que
 * viene con macOS Sonoma sin actualizar.
 *
 * La implementación es la del TC39 (`promise-with-resolvers`): el executor
 * corre sincrónicamente, así que `resolve`/`reject` ya están asignados cuando
 * el constructor retorna.
 */
/**
 * El `lib` del proyecto no llega a ES2024, así que TS no conoce
 * `withResolvers`. Se declara acá —que es donde se provee— y **opcional**, a
 * propósito: si fuera requerido, el `typeof … === "function"` de abajo
 * quedaría como código muerto a ojos del compilador, y ese guard es lo único
 * que evita pisar la implementación nativa en un navegador moderno.
 */
declare global {
  interface PromiseConstructor {
    withResolvers?<T>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }
}

export function installPromiseWithResolvers(target: PromiseConstructor): void {
  if (typeof target.withResolvers === "function") return;

  Object.defineProperty(target, "withResolvers", {
    configurable: true,
    writable: true,
    value: function withResolvers<T>(this: PromiseConstructor) {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new this<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    },
  });
}

installPromiseWithResolvers(Promise);
