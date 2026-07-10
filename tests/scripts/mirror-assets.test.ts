import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mirrorAsset,
  mirrorAssets,
  readAssetsLock,
  sha256Hex,
  type AssetLockEntry,
  type AssetsLock,
} from "../../scripts/mirror-assets.js";

function sha256HexOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function makeEntry(overrides?: Partial<AssetLockEntry>): AssetLockEntry {
  const content = overrides?.sha256 === undefined ? "contenido-de-prueba" : undefined;
  return {
    id: "test-asset",
    url: "https://example.invalid/test-asset.bin",
    revision: "1.0.0",
    sha256: content !== undefined ? sha256HexOf(content) : "0".repeat(64),
    destination: "public/models/test-asset.bin",
    sizeBytes: content !== undefined ? Buffer.byteLength(content) : 0,
    ...overrides,
  };
}

// `Buffer.from(str).buffer` puede exponer el pool interno de Node (más bytes
// que el string real) en vez de un ArrayBuffer del tamaño exacto.
// `TextEncoder` siempre asigna uno nuevo del tamaño justo.
function toArrayBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

function mockFetchOnce(
  body: string,
  init?: { readonly ok?: boolean; readonly status?: number },
): void {
  const ok = init?.ok ?? true;
  const status = init?.status ?? 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok,
        status,
        arrayBuffer: () => Promise.resolve(toArrayBuffer(body)),
      }),
    ),
  );
}

describe("mirror-assets", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "anonly-mirror-assets-"));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(rootDir, { recursive: true, force: true });
  });

  describe("sha256Hex", () => {
    it("computes the correct sha256 hex digest", () => {
      expect(sha256Hex(Buffer.from("hola"))).toBe(sha256HexOf("hola"));
    });
  });

  describe("readAssetsLock", () => {
    it("parses a well-formed assets.lock.json", async () => {
      const lock: AssetsLock = { version: 1, assets: [makeEntry()] };
      const lockPath = join(rootDir, "assets.lock.json");
      await import("node:fs/promises").then((fs) => fs.writeFile(lockPath, JSON.stringify(lock)));

      const parsed = await readAssetsLock(lockPath);
      expect(parsed.assets).toHaveLength(1);
      expect(parsed.assets[0]?.id).toBe("test-asset");
    });
  });

  describe("mirrorAsset", () => {
    it("downloads and writes the asset when the destination does not exist yet", async () => {
      const content = "contenido-de-prueba";
      const entry = makeEntry();
      mockFetchOnce(content);

      const result = await mirrorAsset(entry, rootDir);

      expect(result).toBe("downloaded");
      const written = await readFile(join(rootDir, entry.destination), "utf-8");
      expect(written).toBe(content);
    });

    it("skips the download when the destination already matches the pinned hash", async () => {
      const content = "contenido-de-prueba";
      const entry = makeEntry();
      mockFetchOnce(content);
      await mirrorAsset(entry, rootDir); // primera corrida: descarga real

      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const result = await mirrorAsset(entry, rootDir); // segunda corrida: debe saltear

      expect(result).toBe("skipped");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws and does not write the file when the downloaded hash does not match the pin", async () => {
      const entry = makeEntry({ sha256: sha256HexOf("contenido-esperado") });
      mockFetchOnce("contenido-alterado");

      await expect(mirrorAsset(entry, rootDir)).rejects.toThrow(/Hash mismatch/);
      await expect(readFile(join(rootDir, entry.destination))).rejects.toThrow();
    });

    it("throws when the downloaded size does not match the pinned sizeBytes", async () => {
      const content = "contenido-de-prueba";
      const entry = makeEntry({ sha256: sha256HexOf(content), sizeBytes: 999 });
      mockFetchOnce(content);

      await expect(mirrorAsset(entry, rootDir)).rejects.toThrow(/Tamaño inesperado/);
    });

    it("throws when the HTTP response is not ok", async () => {
      const entry = makeEntry();
      mockFetchOnce("no importa", { ok: false, status: 404 });

      await expect(mirrorAsset(entry, rootDir)).rejects.toThrow(/HTTP 404/);
    });

    it("creates nested destination directories as needed", async () => {
      const content = "contenido-anidado";
      const entry = makeEntry({
        sha256: sha256HexOf(content),
        sizeBytes: Buffer.byteLength(content),
        destination: "public/wasm/tesseract/nested/asset.bin",
      });
      mockFetchOnce(content);

      await mirrorAsset(entry, rootDir);

      const written = await readFile(join(rootDir, entry.destination), "utf-8");
      expect(written).toBe(content);
    });
  });

  describe("mirrorAssets", () => {
    it("mirrors every entry in the lock and reports one outcome per asset", async () => {
      const contentA = "asset-a";
      const contentB = "asset-b";
      const lock: AssetsLock = {
        version: 1,
        assets: [
          makeEntry({
            id: "asset-a",
            sha256: sha256HexOf(contentA),
            sizeBytes: Buffer.byteLength(contentA),
            destination: "public/a.bin",
          }),
          makeEntry({
            id: "asset-b",
            sha256: sha256HexOf(contentB),
            sizeBytes: Buffer.byteLength(contentB),
            destination: "public/b.bin",
          }),
        ],
      };

      let call = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(() => {
          call += 1;
          const body = call === 1 ? contentA : contentB;
          return Promise.resolve({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(toArrayBuffer(body)),
          });
        }),
      );

      const outcomes = await mirrorAssets(lock, rootDir);

      expect(outcomes).toEqual([
        { id: "asset-a", result: "downloaded" },
        { id: "asset-b", result: "downloaded" },
      ]);
    });
  });
});
