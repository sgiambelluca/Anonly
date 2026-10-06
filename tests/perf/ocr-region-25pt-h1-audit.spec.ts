import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  assertMixedFixtureTextLayer,
  buildSmallMixedCharacterizationFixture,
  extractPdfTextLayer,
  type ExportFixture,
} from "../e2e/support/exportVerificationFixtures.js";
import { auditPdfWithIndependentOcr, type OcrAudit } from "../e2e/support/exportVerificationOcr.js";
import {
  verifyExport,
  type ExportVerificationFixture,
  type OcrDocument,
  type VerificationResult,
} from "../e2e/support/exportVerificationOracle.js";

import { containsIdentifierDigits } from "./support/ocrRegionPrototypeAudit.js";

test.setTimeout(300_000);

const NATIVE_DNI = "34.567.891";
const IMAGE_DNI = "62.938.475";
const PILOT_INPUT = process.env.ANONLY_REGION25_PILOT_INPUT;
const CAMPAIGN_ROOT = resolve(".measure/ocr-region-25pt");
const CAMPAIGN_DATE_ROOT = resolve(CAMPAIGN_ROOT, "2026-10-05");
const OUTPUT = resolve(
  CAMPAIGN_DATE_ROOT,
  `h1-audit-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${process.pid}`,
);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeVerificationFixture(
  fixture: ExportFixture,
  source: OcrDocument,
  output: OcrDocument,
  forbiddenIdentifiers: ReadonlyArray<string>,
): ExportVerificationFixture {
  return {
    id: fixture.id,
    expectedPageCount: fixture.pageSizes.length,
    neighborsByPage: fixture.neighborsByPage,
    sourceIdentifiersByPage: fixture.pageSizes.map((_page, pageIndex) =>
      fixture.targets
        .filter((target) => target.pageIndex === pageIndex && target.geometryOnly !== true)
        .map((target) => target.value),
    ),
    forbiddenIdentifiers,
    source,
    output,
  };
}

async function saveAudit(
  page: Page,
  name: string,
  pdfBytes: Uint8Array,
  fixture: ExportFixture,
): Promise<{ readonly audit: OcrAudit; readonly evidence: Record<string, unknown> }> {
  const audit = await auditPdfWithIndependentOcr(page, pdfBytes, fixture.rotations);
  const directory = resolve(OUTPUT, name);
  await mkdir(directory, { recursive: true });
  const pdfPath = resolve(directory, `${name}.pdf`);
  await writeFile(pdfPath, pdfBytes);
  const rasterEvidence: Array<Record<string, unknown>> = [];
  for (const [pageIndex, raster] of audit.rasters.entries()) {
    const pngPath = resolve(directory, `page-${pageIndex + 1}.png`);
    await writeFile(pngPath, raster.png);
    rasterEvidence.push({
      pageIndex,
      path: pngPath,
      sha256: sha256(raster.png),
      bytes: raster.png.byteLength,
      widthPt: raster.widthPt,
      heightPt: raster.heightPt,
    });
  }
  return {
    audit,
    evidence: {
      pdf: { path: pdfPath, sha256: sha256(pdfBytes), bytes: pdfBytes.byteLength },
      pages: audit.document.pages,
      textByPage: audit.textByPage,
      rasters: rasterEvidence,
      versions: audit.versions,
      assetHashes: audit.assetHashes,
    },
  };
}

function verify(
  fixture: ExportFixture,
  source: OcrDocument,
  output: OcrDocument,
  forbiddenIdentifiers: ReadonlyArray<string>,
): VerificationResult {
  return verifyExport(makeVerificationFixture(fixture, source, output, forbiddenIdentifiers));
}

test.describe("ADR-202 offline H1 audit", () => {
  test.skip(
    process.env.ANONLY_REGION25_PROTOTYPE !== "1",
    "Opt-in: set ANONLY_REGION25_PROTOTYPE=1 before the offline evidence audit.",
  );

  test("ADR-202 offline mixed audit verifies source, reference leak, and candidate export", async ({
    page,
  }) => {
    expect(
      PILOT_INPUT,
      "Set ANONLY_REGION25_PILOT_INPUT to a completed pilot directory",
    ).toBeTruthy();
    const inputRoot = resolve(PILOT_INPUT ?? "");
    expect(inputRoot.toLowerCase().startsWith(CAMPAIGN_ROOT.toLowerCase() + "\\")).toBe(true);

    const fixture = await buildSmallMixedCharacterizationFixture(page);
    expect(fixture.corpusRevision).toBe("mixed-small-v1-300x56");
    assertMixedFixtureTextLayer(fixture);
    const referenceDir = resolve(inputRoot, "reference-100/mixed-original");
    const candidateDir = resolve(inputRoot, "candidate-25/mixed-original");
    const sourceBytes = await readFile(resolve(referenceDir, "source.pdf"));
    const candidateSourceBytes = await readFile(resolve(candidateDir, "source.pdf"));
    const referenceExportBytes = await readFile(resolve(referenceDir, "export.pdf"));
    const candidateExportBytes = await readFile(resolve(candidateDir, "export.pdf"));
    expect(sha256(sourceBytes)).toBe(sha256(candidateSourceBytes));

    const forbiddenIdentifiers = fixture.targets
      .filter((target) => target.geometryOnly !== true)
      .map((target) => target.value.replaceAll(/\D/gu, ""));
    const sourceTextLayer = await extractPdfTextLayer(page, sourceBytes);
    const sourceAudit = await saveAudit(page, "source", sourceBytes, fixture);
    const referenceAudit = await saveAudit(page, "reference-export", referenceExportBytes, fixture);
    const candidateAudit = await saveAudit(page, "candidate-export", candidateExportBytes, fixture);
    const sourceResult = verify(
      fixture,
      sourceAudit.audit.document,
      sourceAudit.audit.document,
      [],
    );
    const referenceResult = verify(
      fixture,
      sourceAudit.audit.document,
      referenceAudit.audit.document,
      forbiddenIdentifiers,
    );
    const candidateResult = verify(
      fixture,
      sourceAudit.audit.document,
      candidateAudit.audit.document,
      forbiddenIdentifiers,
    );
    const injectedDniDocument: OcrDocument = {
      pages: candidateAudit.audit.document.pages.map((pageResult, pageIndex) =>
        pageIndex === 0 ? { ...pageResult, lines: [...pageResult.lines, IMAGE_DNI] } : pageResult,
      ),
    };
    const sensitivityResult = verify(
      fixture,
      sourceAudit.audit.document,
      injectedDniDocument,
      forbiddenIdentifiers,
    );

    const sourceLayerHasNativeDni = containsIdentifierDigits(sourceTextLayer, NATIVE_DNI);
    const sourceLayerHasRasterDni = containsIdentifierDigits(sourceTextLayer, IMAGE_DNI);
    const productObservation = JSON.parse(
      await readFile(resolve(candidateDir, "pipeline-observation.json"), "utf8"),
    ) as {
      readonly terminal?: {
        readonly readyDocumentId?: string | null;
        readonly failure?: string | null;
      };
      readonly observation?: {
        readonly groups?: number;
        readonly ready?: boolean;
        readonly pages?: ReadonlyArray<{ readonly productOcrText: string }>;
      };
      readonly replacementActions?: ReadonlyArray<{
        readonly identifier: string;
        readonly groupFound: boolean;
        readonly effectiveAccessibleName: string | null;
      }>;
    };
    const referenceObservation = JSON.parse(
      await readFile(resolve(referenceDir, "pipeline-observation.json"), "utf8"),
    ) as {
      readonly terminal?: {
        readonly readyDocumentId?: string | null;
        readonly failure?: string | null;
      };
      readonly observation?: { readonly ready?: boolean };
    };
    const bothArmRecords: ReadonlyArray<{
      readonly terminal?: {
        readonly readyDocumentId?: string | null;
        readonly failure?: string | null;
      };
      readonly observation?: { readonly ready?: boolean };
    }> = [referenceObservation, productObservation];
    const bothArmsReachedReady = bothArmRecords.every(
      (observation) =>
        observation.terminal?.readyDocumentId !== null &&
        observation.terminal?.readyDocumentId !== undefined &&
        observation.terminal?.failure === null &&
        observation.observation?.ready === true,
    );
    const productOcrContainsRasterDni = containsIdentifierDigits(
      [productObservation.observation?.pages?.[0]?.productOcrText ?? ""],
      IMAGE_DNI,
    );
    const uiRedactionConfirmed = [NATIVE_DNI, IMAGE_DNI].every((identifier) =>
      productObservation.replacementActions?.some(
        (action) =>
          action.identifier === identifier &&
          action.groupFound &&
          action.effectiveAccessibleName?.includes("Tapar con negro") === true,
      ),
    );

    const report = {
      inputRoot,
      settings: { performancePreset: "medium", nerEnabled: true, ocrLanguages: ["spa"] },
      settingsLimit:
        "Both arms use spa only; settings.store.ts defaults to spa+eng. This is not validation under default languages or of ADR-148.",
      fixture: {
        id: fixture.id,
        corpusRevision: fixture.corpusRevision,
        mixedGeometry: fixture.mixedGeometry,
        expectedPageCount: fixture.pageSizes.length,
        pageSizes: fixture.pageSizes,
        targets: fixture.targets,
        neighborsByPage: fixture.neighborsByPage,
        sourceTextLayer,
        layerCheck: {
          nativeDniPresent: sourceLayerHasNativeDni,
          rasterDniAbsent: !sourceLayerHasRasterDni,
          sensitivityControlDetectsRasterDniWhenInjected: containsIdentifierDigits(
            [...sourceTextLayer, `DNI ${IMAGE_DNI}`],
            IMAGE_DNI,
          ),
        },
      },
      product: {
        readyDocumentId: productObservation.terminal?.readyDocumentId ?? null,
        failure: productObservation.terminal?.failure ?? null,
        groups: productObservation.observation?.groups ?? null,
        ocrText: productObservation.observation?.pages?.[0]?.productOcrText ?? null,
        ocrFoundRasterDni: productOcrContainsRasterDni,
        redactionActions: productObservation.replacementActions ?? null,
        uiRedactionConfirmed,
      },
      bothArmsReachedReady,
      results: {
        sourceReadabilityAndIntegrity: sourceResult,
        referenceExport: referenceResult,
        candidateExport: candidateResult,
        injectedSensitiveDniControl: sensitivityResult,
      },
      audits: {
        source: sourceAudit.evidence,
        referenceExport: referenceAudit.evidence,
        candidateExport: candidateAudit.evidence,
      },
    };
    await mkdir(OUTPUT, { recursive: true });
    await writeFile(resolve(OUTPUT, "h1-audit.json"), JSON.stringify(report, null, 2), "utf8");

    expect(sourceLayerHasNativeDni).toBe(true);
    expect(sourceLayerHasRasterDni).toBe(false);
    expect(report.fixture.layerCheck.sensitivityControlDetectsRasterDniWhenInjected).toBe(true);
    expect(sourceResult.status, JSON.stringify(sourceResult)).toBe("CUMPLE");
    expect(bothArmsReachedReady).toBe(true);
    expect(productObservation.terminal?.readyDocumentId).toBeTruthy();
    expect(productObservation.terminal?.failure).toBeNull();
    expect(productOcrContainsRasterDni).toBe(true);
    expect(uiRedactionConfirmed).toBe(true);
    expect(referenceResult.status, JSON.stringify(referenceResult)).toBe("NO CUMPLE");
    expect(
      referenceResult.status === "NO CUMPLE" &&
        referenceResult.reasons.some((reason) => reason.includes("fragmento numérico prohibido")),
    ).toBe(true);
    expect(candidateResult.status, JSON.stringify(candidateResult)).toBe("CUMPLE");
    expect(sensitivityResult.status, JSON.stringify(sensitivityResult)).toBe("NO CUMPLE");
    expect(
      sensitivityResult.status === "NO CUMPLE" &&
        sensitivityResult.reasons.some((reason) => reason.includes("fragmento numérico prohibido")),
    ).toBe(true);
  });
});
