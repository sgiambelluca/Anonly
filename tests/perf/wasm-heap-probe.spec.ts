/**
 * Paso 0 de T-8 (`docs/roadmap/AB_Intercalado_Plan.md` §2ter): ¿se puede leer
 * el tamaño de la memoria lineal de WebAssembly sin preguntarle al sistema
 * operativo?
 *
 * ADR-159 §8 ya cerró una puerta, midiendo: `Runtime.getHeapUsage` de CDP **no
 * ve** `WebAssembly.Memory` — por eso `memory.spec.ts` publica "no atribuido
 * (WASM + nativo)" como cota y no como medición. Esta sonda prueba la vía que
 * quedó sin probar: `performance.measureUserAgentSpecificMemory()`, que
 * desglosa por tipo e incluye WebAssembly, y que solo exige
 * `crossOriginIsolated` — que esta aplicación ya tiene (ADR-100/130/132).
 *
 * **Control discriminante** (ADR-149 §2, y el método que ADR-159 §7 exigió
 * antes de confiar en un instrumento): no alcanza con que la API devuelva un
 * número. Se reserva una `WebAssembly.Memory` de tamaño conocido con todas sus
 * páginas escritas, se mide, se la hace crecer, y se vuelve a medir. Si el
 * número no se mueve en la magnitud esperada, la vía no sirve y se descarta por
 * escrito. Un instrumento que mide mal no tira error: devuelve un número
 * plausible.
 *
 * No es un gate y no toca producto: vive entero en `tests/perf/`.
 */
import { expect, openApp, test } from "../e2e/support/electronApp.js";

/** 20 MB: 320 páginas de 64 KiB. Mismo tamaño que usó ADR-159 §8, para que los dos resultados se lean juntos. */
const INITIAL_PAGES = 320;
/** +10 MB. */
const GROW_PAGES = 160;
const PAGE_BYTES = 64 * 1024;

const MB = 1_000_000;
const fmt = (bytes: number | null): string =>
  bytes === null ? "—" : `${(bytes / MB).toFixed(2)} MB`;

test("Paso 0 — ¿measureUserAgentSpecificMemory() ve la memoria de WebAssembly?", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openApp(page, "networkidle");

  const environment = await page.evaluate(() => ({
    crossOriginIsolated: globalThis.crossOriginIsolated,
    hasApi:
      typeof (performance as unknown as Record<string, unknown>).measureUserAgentSpecificMemory ===
      "function",
    userAgent: navigator.userAgent,
  }));

  console.log(
    [
      "",
      "=== Paso 0 — entorno ===",
      `  crossOriginIsolated: ${environment.crossOriginIsolated}`,
      `  performance.measureUserAgentSpecificMemory: ${environment.hasApi ? "presente" : "AUSENTE"}`,
    ].join("\n"),
  );

  if (!environment.hasApi || !environment.crossOriginIsolated) {
    console.log(
      "  -> vía descartada acá mismo: sin la API o sin aislamiento no hay nada que medir.\n",
    );
    return;
  }

  const result = await page.evaluate(
    async ({ initialPages, growPages, pageBytes }) => {
      const measure = async (): Promise<{
        ok: boolean;
        reason?: string;
        totalBytes: number | null;
        wasmBytes: number | null;
        breakdownTypes: string[];
      }> => {
        try {
          const api = (
            performance as unknown as {
              measureUserAgentSpecificMemory: () => Promise<{
                bytes: number;
                breakdown: ReadonlyArray<{ bytes: number; types?: ReadonlyArray<string> }>;
              }>;
            }
          ).measureUserAgentSpecificMemory;
          const sample = await api.call(performance);
          const types = new Set<string>();
          let wasm = 0;
          for (const entry of sample.breakdown) {
            for (const t of entry.types ?? []) types.add(t);
            if ((entry.types ?? []).some((t) => /wasm|webassembly/i.test(t))) wasm += entry.bytes;
          }
          return {
            ok: true,
            totalBytes: sample.bytes,
            wasmBytes: wasm,
            breakdownTypes: [...types],
          };
        } catch (err) {
          return {
            ok: false,
            reason: (err as Error).message,
            totalBytes: null,
            wasmBytes: null,
            breakdownTypes: [],
          };
        }
      };

      const baseline = await measure();

      // Reservar y ESCRIBIR todas las páginas: una página nunca tocada puede no
      // estar respaldada, y entonces no se mediría lo que se cree.
      const memory = new WebAssembly.Memory({ initial: initialPages });
      const touch = (buf: ArrayBuffer, fromPage: number, toPage: number): void => {
        const view = new Uint8Array(buf);
        for (let p = fromPage; p < toPage; p += 1) view[p * pageBytes] = (p % 251) + 1;
      };
      touch(memory.buffer as ArrayBuffer, 0, initialPages);
      const afterAlloc = await measure();

      memory.grow(growPages);
      touch(memory.buffer as ArrayBuffer, initialPages, initialPages + growPages);
      const afterGrow = await measure();

      // El `byteLength` del propio buffer: la ruta 1 de §2ter, medida de paso.
      // Es exacta por construcción; lo que hay que ver es si es alcanzable
      // para el módulo REAL de ONNX Runtime, no para uno creado acá.
      return {
        baseline,
        afterAlloc,
        afterGrow,
        bufferByteLength: (memory.buffer as ArrayBuffer).byteLength,
      };
    },
    { initialPages: INITIAL_PAGES, growPages: GROW_PAGES, pageBytes: PAGE_BYTES },
  );

  const expectedAllocBytes = INITIAL_PAGES * PAGE_BYTES;
  const expectedGrowBytes = GROW_PAGES * PAGE_BYTES;
  const deltaAlloc =
    result.afterAlloc.totalBytes !== null && result.baseline.totalBytes !== null
      ? result.afterAlloc.totalBytes - result.baseline.totalBytes
      : null;
  const deltaGrow =
    result.afterGrow.totalBytes !== null && result.afterAlloc.totalBytes !== null
      ? result.afterGrow.totalBytes - result.afterAlloc.totalBytes
      : null;

  console.log(
    [
      "",
      "=== Paso 0 — control discriminante ===",
      `  esperado por la reserva: ${fmt(expectedAllocBytes)}   por el grow: ${fmt(expectedGrowBytes)}`,
      "",
      `  total  base       : ${fmt(result.baseline.totalBytes)}`,
      `  total  tras alloc : ${fmt(result.afterAlloc.totalBytes)}   (delta ${fmt(deltaAlloc)})`,
      `  total  tras grow  : ${fmt(result.afterGrow.totalBytes)}   (delta ${fmt(deltaGrow)})`,
      "",
      `  wasm   base       : ${fmt(result.baseline.wasmBytes)}`,
      `  wasm   tras alloc : ${fmt(result.afterAlloc.wasmBytes)}`,
      `  wasm   tras grow  : ${fmt(result.afterGrow.wasmBytes)}`,
      "",
      `  buffer.byteLength : ${fmt(result.bufferByteLength)}  (exacto por construcción)`,
      `  tipos vistos en el breakdown: ${result.afterGrow.breakdownTypes.join(", ") || "(ninguno)"}`,
      result.afterGrow.ok ? "" : `  ERROR de la API: ${result.afterGrow.reason ?? "?"}`,
      "",
    ].join("\n"),
  );

  // El control se afirma SOLO si la API contestó. Si lanzó "not available", el
  // resultado de la sonda es negativo y se registra como tal (plan §2ter: el
  // negativo también se escribe) — no es un rojo del arnés.
  if (result.baseline.ok) {
    expect(
      deltaAlloc,
      "la API contesta pero no se mueve con una reserva de WASM: no sirve para esto",
    ).toBeGreaterThan(expectedAllocBytes * 0.5);
    expect(
      deltaGrow,
      "la API no refleja el grow(): ve la reserva inicial pero no el crecimiento",
    ).toBeGreaterThan(expectedGrowBytes * 0.5);
  }

  // Lo único que se exige siempre: que el control haya montado de verdad la
  // memoria que dice haber montado. Si esto falla, el negativo de arriba no
  // vale nada porque no había nada que medir.
  expect(result.bufferByteLength).toBe((INITIAL_PAGES + GROW_PAGES) * PAGE_BYTES);
});
