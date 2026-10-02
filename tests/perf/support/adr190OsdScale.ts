import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

export const OSD_SCALES = {
  historicalHalf: { label: "historical-half", factor: 0.5 },
  current1754: { label: "current-1754", factor: "current" },
  native: { label: "native", factor: 1 },
} as const;

export type OsdScaleLabel = (typeof OSD_SCALES)[keyof typeof OSD_SCALES]["label"];
export const OSD_TARGET_LONG_SIDE_PX = 1754;
export const OSD_MAX_UPSCALE = 2;
export const OSD_INK_THRESHOLD = 0.002;

export function scaleFactorForArm(arm: OsdScaleLabel, longSidePx: number): number {
  if (arm === OSD_SCALES.historicalHalf.label) return 0.5;
  if (arm === OSD_SCALES.native.label) return 1;
  if (!Number.isFinite(longSidePx) || longSidePx <= 0) return OSD_MAX_UPSCALE;
  return Math.min(OSD_MAX_UPSCALE, OSD_TARGET_LONG_SIDE_PX / longSidePx);
}

export function scaledOsdDimensions(
  widthPx: number,
  heightPx: number,
  factor: number,
): { readonly widthPx: number; readonly heightPx: number } {
  return {
    widthPx: Math.max(1, Math.round(widthPx * factor)),
    heightPx: Math.max(1, Math.round(heightPx * factor)),
  };
}

export interface CapturedOsdInput {
  readonly jobId: string;
  readonly documentId: string;
  readonly pageIndex: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly format: string;
  readonly bytesBase64: string;
}

export interface OsdScaleRun {
  readonly arm: OsdScaleLabel;
  readonly factor: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly pixelsBytes: number;
  readonly pixelSha256: string | null;
  readonly workerInitMs: number | null;
  readonly imageBuildMs: number | null;
  readonly detectMs: number | null;
  readonly rawOrientation: unknown;
  readonly rawOrientationType: string;
  readonly rawConfidence: unknown;
  readonly rawConfidenceType: string;
  readonly inkRatio: number | null;
  readonly inkPresent: boolean | null;
  readonly expectedOrientationCorrect: boolean | null;
  readonly noVerdict: boolean;
  readonly noVerdictReason: string | null;
  readonly error: string | null;
}

export interface TesseractBrowserBundle {
  readonly modulePath: string;
  readonly namespaceExport: string;
  readonly oemExport: string;
}

/** Resolve the exact browser bundle imported by the built production orientation kernel. */
export async function discoverTesseractBrowserBundle(): Promise<TesseractBrowserBundle> {
  const assetDirectory = resolve("apps/react-client/dist/assets");
  const files = await readdir(assetDirectory);
  const kernelName = files.find((file) => /^orientation-kernel-.*\.js$/.test(file));
  if (!kernelName) throw new Error("built orientation-kernel bundle is missing");
  const kernel = await readFile(resolve(assetDirectory, kernelName), "utf8");
  const imported = kernel.match(/import\{([^}]+)\}from"\.\/(tesseract-paths-[^"]+\.js)"/);
  const apiAlias = kernel.match(/\b([A-Za-z_$][\w$]*)\.createWorker\(/)?.[1];
  if (!imported || !apiAlias) throw new Error("cannot locate Tesseract import in built kernel");
  const apiExport = imported[1]
    ?.split(",")
    .map((entry) => entry.trim())
    .find((entry) => entry.endsWith(` as ${apiAlias}`))
    ?.split(" as ")[0];
  const oemAlias = kernel.match(/\b([A-Za-z_$][\w$]*)\.OEM\.TESSERACT_ONLY/)?.[1];
  const oemExport = oemAlias
    ? imported[1]
        ?.split(",")
        .map((entry) => entry.trim())
        .find((entry) => entry.endsWith(` as ${oemAlias}`))
        ?.split(" as ")[0]
    : undefined;
  if (!apiExport || !oemExport || apiExport !== oemExport)
    throw new Error("cannot resolve Tesseract API/OEM namespace from built kernel");
  return { modulePath: `/assets/${imported[2]}`, namespaceExport: apiExport, oemExport };
}

/** Run test-only scale inputs with the production browser bundle and assets. */
export async function runOsdScaleArms(
  page: Page,
  input: CapturedOsdInput,
  bundle: TesseractBrowserBundle,
  expectedCorrectionAngle: number,
  order: ReadonlyArray<OsdScaleLabel>,
): Promise<ReadonlyArray<OsdScaleRun>> {
  const plans = order.map((arm) => {
    const factor = scaleFactorForArm(arm, Math.max(input.widthPx, input.heightPx));
    return { arm, factor, ...scaledOsdDimensions(input.widthPx, input.heightPx, factor) };
  });
  return page.evaluate(
    async ({ input, bundle, expectedCorrectionAngle, plans }) => {
      type RawRecord = Record<string, unknown>;
      type BrowserWorker = {
        detect(image: OffscreenCanvas): Promise<{ data: RawRecord }>;
        terminate(): Promise<void>;
      };
      type TesseractApi = {
        readonly OEM: { readonly TESSERACT_ONLY: number };
        createWorker(
          languages: ReadonlyArray<string>,
          oem: number,
          options: Readonly<Record<string, unknown>>,
        ): Promise<BrowserWorker>;
      };
      type ScaleOutput = {
        arm: OsdScaleLabel;
        factor: number;
        widthPx: number;
        heightPx: number;
        pixelsBytes: number;
        pixelSha256: string | null;
        workerInitMs: number | null;
        imageBuildMs: number | null;
        detectMs: number | null;
        rawOrientation: unknown;
        rawOrientationType: string;
        rawConfidence: unknown;
        rawConfidenceType: string;
        inkRatio: number | null;
        inkPresent: boolean | null;
        expectedOrientationCorrect: boolean | null;
        noVerdict: boolean;
        noVerdictReason: string | null;
        error: string | null;
      };

      const imported = (await import(new URL(bundle.modulePath, location.href).href)) as Record<
        string,
        unknown
      >;
      const api = imported[bundle.namespaceExport] as TesseractApi | undefined;
      if (!api || typeof api.createWorker !== "function" || !api.OEM)
        throw new Error("Tesseract API missing from production browser bundle");
      const binary = atob(input.bytesBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      const blob = new Blob([bytes], { type: `image/${input.format}` });
      const output: ScaleOutput[] = [];
      for (const { arm, factor, widthPx, heightPx } of plans) {
        let worker: BrowserWorker | null = null;
        let workerInitMs: number | null = null;
        let imageBuildMs: number | null = null;
        let detectMs: number | null = null;
        let pixelSha256: string | null = null;
        let inkRatio: number | null = null;
        let rawOrientation: unknown = null;
        let rawConfidence: unknown = null;
        let rawOrientationType = "undefined";
        let rawConfidenceType = "undefined";
        let noVerdictReason: string | null = null;
        let error: string | null = null;
        try {
          const initStarted = performance.now();
          worker = await api.createWorker(["osd"], api.OEM.TESSERACT_ONLY, {
            langPath: new URL("/models/tesseract/", location.href).href,
            corePath: new URL("/wasm/tesseract/", location.href).href,
            workerPath: new URL("/wasm/tesseract/worker.min.js", location.href).href,
            legacyCore: true,
          });
          workerInitMs = performance.now() - initStarted;

          const imageStarted = performance.now();
          const bitmap = await createImageBitmap(blob, {
            resizeWidth: widthPx,
            resizeHeight: heightPx,
          });
          const canvas = new OffscreenCanvas(widthPx, heightPx);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("OffscreenCanvas 2D context unavailable");
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          const pixels = context.getImageData(0, 0, widthPx, heightPx).data;
          const totalPixels = widthPx * heightPx;
          let presentPixels = 0;
          for (let index = 0; index < pixels.length; index += 4) {
            if (
              pixels[index + 3] !== 0 &&
              (pixels[index] !== 255 || pixels[index + 1] !== 255 || pixels[index + 2] !== 255)
            )
              presentPixels += 1;
          }
          inkRatio = totalPixels > 0 ? presentPixels / totalPixels : 0;
          const digest = await crypto.subtle.digest("SHA-256", pixels.buffer);
          pixelSha256 = Array.from(new Uint8Array(digest), (value) =>
            value.toString(16).padStart(2, "0"),
          ).join("");
          imageBuildMs = performance.now() - imageStarted;

          const detectStarted = performance.now();
          const detected = await worker.detect(canvas);
          detectMs = performance.now() - detectStarted;
          const data = detected.data;
          rawOrientation = data.orientation_degrees ?? null;
          rawConfidence = data.orientation_confidence ?? null;
          rawOrientationType = typeof data.orientation_degrees;
          rawConfidenceType = typeof data.orientation_confidence;
          if (data.orientation_degrees === undefined || data.orientation_degrees === null)
            noVerdictReason = "DetectOS returned no orientation";
          else if (
            data.orientation_confidence === undefined ||
            data.orientation_confidence === null
          )
            noVerdictReason = "DetectOS returned no confidence";
        } catch (caught) {
          error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught);
        } finally {
          if (worker) await worker.terminate().catch(() => undefined);
        }
        const rawAngle = typeof rawOrientation === "number" ? rawOrientation : null;
        const confidence = typeof rawConfidence === "number" ? rawConfidence : null;
        output.push({
          arm,
          factor,
          widthPx,
          heightPx,
          pixelsBytes: widthPx * heightPx * 4,
          pixelSha256,
          workerInitMs,
          imageBuildMs,
          detectMs,
          rawOrientation,
          rawOrientationType,
          rawConfidence,
          rawConfidenceType,
          inkRatio,
          inkPresent: inkRatio === null ? null : inkRatio >= 0.002,
          expectedOrientationCorrect:
            rawAngle === null || confidence === null
              ? null
              : confidence >= 1 && rawAngle === expectedCorrectionAngle,
          noVerdict: rawAngle === null || confidence === null,
          noVerdictReason,
          error,
        });
      }
      return output;
    },
    { input, bundle, expectedCorrectionAngle, plans },
  );
}
