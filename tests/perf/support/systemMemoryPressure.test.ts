/**
 * `systemMemoryPressure.test.ts` — cubre los parsers puros contra texto fijo
 * (capturado corriendo `vm_stat`/`sysctl vm.swapusage` reales, no inventado)
 * para no depender de en qué plataforma corre `vitest`. `readSystemMemoryPressure`
 * en sí (que shellea al SO) se cubre aparte con un smoke test acotado a la
 * plataforma actual — nunca lanza, así que alcanza con comprobar que responde.
 */
import os from "node:os";

import { describe, expect, it } from "vitest";

import {
  formatSystemMemoryPressure,
  parseMemInfo,
  parseSwapUsageOutput,
  parseVmStatOutput,
  readSystemMemoryPressure,
} from "./systemMemoryPressure.js";

const REAL_VM_STAT_OUTPUT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                7688.
Pages active:                            158823.
Pages inactive:                          150534.
Pages speculative:                        21859.
Pages throttled:                              0.
Pages wired down:                         74148.
Pages purgeable:                           4102.
"Translation faults":                  32636194.
Pages copy-on-write:                     929688.
Pages zero filled:                     17949825.
Pages reactivated:                      3194761.
Pages purged:                            182398.
File-backed pages:                       137316.
Anonymous pages:                         193900.
Pages stored in compressor:              166056.
Pages occupied by compressor:             75236.
Decompressions:                         2234058.
Compressions:                           3823283.
Pageins:                                1777893.
Pageouts:                                 21618.
Swapins:                                     28.
Swapouts:                                   432.
`;

const REAL_SWAP_USAGE_OUTPUT =
  "vm.swapusage: total = 1024.00M  used = 6.75M  free = 1017.25M  (encrypted)\n";

const REAL_MEMINFO_OUTPUT = `MemTotal:        8192000 kB
MemFree:          512000 kB
MemAvailable:    2048000 kB
Buffers:           64000 kB
Cached:           900000 kB
SwapTotal:       2097152 kB
SwapFree:        1900000 kB
`;

describe("parseVmStatOutput", () => {
  it("lee tamaño de página, páginas libres y páginas de compresor de una salida real", () => {
    expect(parseVmStatOutput(REAL_VM_STAT_OUTPUT)).toEqual({
      pageSizeBytes: 16384,
      freePages: 7688,
      compressorPages: 75236,
    });
  });

  it("undefined por campo si vm_stat no trae el patrón esperado — nunca 0 implícito", () => {
    expect(parseVmStatOutput("salida inesperada sin ninguno de los campos\n")).toEqual({
      pageSizeBytes: undefined,
      freePages: undefined,
      compressorPages: undefined,
    });
  });
});

describe("parseSwapUsageOutput", () => {
  it("convierte 'used = 6.75M' a bytes", () => {
    expect(parseSwapUsageOutput(REAL_SWAP_USAGE_OUTPUT)).toBe(Math.round(6.75 * 1024 * 1024));
  });

  it("undefined si no hay 'used=' reconocible", () => {
    expect(parseSwapUsageOutput("vm.swapusage: ???\n")).toBeUndefined();
  });
});

describe("parseMemInfo", () => {
  it("lee MemFree y calcula swap usado = SwapTotal - SwapFree", () => {
    expect(parseMemInfo(REAL_MEMINFO_OUTPUT)).toEqual({
      freeBytes: 512000 * 1024,
      swapUsedBytes: (2097152 - 1900000) * 1024,
    });
  });

  it("undefined en los dos campos si falta cualquiera de las tres líneas", () => {
    expect(parseMemInfo("MemTotal: 8192000 kB\n")).toEqual({
      freeBytes: undefined,
      swapUsedBytes: undefined,
    });
  });
});

describe("formatSystemMemoryPressure", () => {
  it("imprime libres/compresor/swap en MB cuando está disponible", () => {
    const text = formatSystemMemoryPressure({
      available: true,
      freeBytes: 125_952_000,
      compressorBytes: 1_232_666_624,
      compressorUnavailableReason: undefined,
      swapUsedBytes: 7_077_888,
    });
    expect(text).toBe("libres 126.0 MB, compresor 1232.7 MB, swap 7.1 MB");
  });

  it("marca el compresor con su motivo cuando no está disponible (nunca 0 MB)", () => {
    const text = formatSystemMemoryPressure({
      available: true,
      freeBytes: 512_000_000,
      compressorBytes: undefined,
      compressorUnavailableReason: "Linux no tiene compresor de páginas",
      swapUsedBytes: 0,
    });
    expect(text).toContain("compresor ? (Linux no tiene compresor de páginas)");
  });

  it("reporta el motivo, no un valor vacío, cuando la plataforma no está soportada", () => {
    expect(formatSystemMemoryPressure({ available: false, reason: "win32 sin lector" })).toBe(
      "no disponible (win32 sin lector)",
    );
  });
});

describe("readSystemMemoryPressure", () => {
  // Smoke test contra el SO real de este runner (darwin en desarrollo,
  // ubuntu-latest en CI — `.github/workflows/ci.yml`): las dos plataformas
  // soportadas deben devolver una lectura real, nunca `available: false` por
  // falta de lector. No corre en otras plataformas (no forma parte de la
  // matriz de CI hoy) — ahí solo se comprueba que la función no lanza.
  it("devuelve una lectura disponible en darwin/linux, o un motivo explícito en cualquier otra plataforma", async () => {
    const sample = await readSystemMemoryPressure();
    const platform = os.platform();
    if (platform === "darwin" || platform === "linux") {
      expect(sample.available).toBe(true);
      if (sample.available) {
        expect(sample.freeBytes).toBeGreaterThan(0);
        expect(sample.swapUsedBytes).toBeGreaterThanOrEqual(0);
      }
    } else {
      expect(sample.available).toBe(false);
    }
  });
});
