import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  _electron as electron,
  chromium,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

import { captureDownload } from "../e2e/support/electronApp.js";
import {
  assertMixedFixtureTextLayer,
  buildSmallMixedCharacterizationFixture,
  extractPdfTextLayer,
  type ExportFixture,
} from "../e2e/support/exportVerificationFixtures.js";
import { auditPdfWithIndependentOcr } from "../e2e/support/exportVerificationOcr.js";
import { installSettingsOverride } from "../e2e/support/settingsOverride.js";

import { containsIdentifierDigits } from "./support/ocrRegionPrototypeAudit.js";
import {
  generateAlignedTextImageControls,
  type AlignedTextImageCorpus,
} from "./support/ocrSmallRegionCorpus.js";
import {
  installSmallRegionObserver,
  observeProductDocument,
  removeSmallRegionObserver,
  waitForSmallRegionReady,
} from "./support/ocrSmallRegionRuntime.js";

test.setTimeout(1_200_000);

const ROOT = resolve(".");
const CAMPAIGN = resolve(ROOT, ".measure/ocr-region-25pt/2026-10-05");
const SESSION = new Date().toISOString().replaceAll(/[:.]/gu, "-");
const OUTPUT = resolve(CAMPAIGN, `pilot-${SESSION}-${process.pid}`);
const ELECTRON_BIN = resolve(ROOT, "apps/desktop-shell/node_modules/.bin/electron");
const ALIGNED_EXPECTED_SHA256 = "a4074d8d23f45f5ecd198484c05274df8ca5072d293642cce23f2cce28259d0c";
const MIXED_DNI_NATIVE = "34.567.891";
const MIXED_DNI_IMAGE = "62.938.475";

type Arm = "reference-100" | "candidate-25";
type EventRecord = { readonly channel: string; readonly event: string; readonly payload: unknown };
type DiagnosticWindow = Window & {
  __ocrRegion25Prototype?: { readonly events: EventRecord[]; readonly unlisten: Array<() => void> };
};

interface PilotFixtures {
  readonly mixed: ExportFixture;
  readonly aligned: AlignedTextImageCorpus;
}

interface RunRecord {
  readonly arm: Arm;
  readonly fixture: "mixed-original" | "aligned-12";
  readonly fixtureSha256: string;
  readonly terminal: { readonly readyDocumentId: string | null; readonly failure: string | null };
  readonly observation: Awaited<ReturnType<typeof observeProductDocument>> | null;
  readonly events: ReadonlyArray<EventRecord>;
  readonly groupLabels: ReadonlyArray<string>;
  readonly pageWords?: ReadonlyArray<{
    readonly pageIndex: number;
    readonly words: ReadonlyArray<{
      readonly text: string;
      readonly source: string;
      readonly bbox: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
        readonly rotation?: number;
      };
    }>;
  }>;
  readonly exportSha256?: string;
  readonly sourceAuditText?: ReadonlyArray<string>;
  readonly exportAuditText?: ReadonlyArray<string>;
  readonly textLayerByPage?: ReadonlyArray<string>;
  readonly replacementActions?: ReadonlyArray<{
    readonly identifier: string;
    readonly groupFound: boolean;
    readonly effectiveAccessibleName: string | null;
  }>;
  readonly error?: string;
}

let fixtures: PilotFixtures;

interface SnapshotManifest {
  readonly label: string;
  readonly workspace: string;
  readonly runtimeConstant: string;
  readonly runtimeSourceSha256: string;
  readonly lockfileSha256: string;
  readonly electronVersion: string;
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
  }>;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizedAuditText(lines: ReadonlyArray<string> | undefined): string {
  return (lines ?? [])
    .join(" ")
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toUpperCase();
}

async function hashTree(
  directory: string,
): Promise<
  ReadonlyArray<{ readonly path: string; readonly sha256: string; readonly bytes: number }>
> {
  const entries: Array<{ readonly path: string; readonly sha256: string; readonly bytes: number }> =
    [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) {
      for (const nested of await hashTree(path))
        entries.push({ ...nested, path: `${item.name}/${nested.path}` });
    } else {
      const bytes = await readFile(path);
      entries.push({ path: item.name, sha256: sha256(bytes), bytes: bytes.byteLength });
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function validateSnapshotRuntimeSource(
  snapshot: string,
  manifest: SnapshotManifest,
  expectedConstant: 25 | 100,
): Promise<void> {
  const sourceHash = manifest.runtimeSourceSha256;
  let matchedSource = false;
  for (const root of ["apps/desktop-shell/dist", "apps/react-client/dist"]) {
    const entries = await hashTree(resolve(snapshot, root));
    for (const entry of entries) {
      if (!entry.path.endsWith(".js.map")) continue;
      const sourceMap = JSON.parse(await readFile(resolve(snapshot, root, entry.path), "utf8")) as {
        readonly sourcesContent?: ReadonlyArray<string | null>;
      };
      for (const content of sourceMap.sourcesContent ?? []) {
        if (content === null || sha256(Buffer.from(content)) !== sourceHash) continue;
        if (!content.includes(`const OCR_REGION_MIN_SIDE_PT = ${expectedConstant};`)) {
          throw new Error(`Fuente runtime de ${manifest.label} no registra ${expectedConstant} pt`);
        }
        matchedSource = true;
      }
    }
  }
  if (!matchedSource) {
    throw new Error(
      `No se pudo vincular el source runtime ${sourceHash} con sourcemaps de ${manifest.label}`,
    );
  }
}

async function validateSnapshots(): Promise<ReadonlyArray<SnapshotManifest>> {
  const manifests: SnapshotManifest[] = [];
  for (const [arm, expected] of [
    ["reference-100", 100],
    ["candidate-25", 25],
  ] as const) {
    const snapshot = resolve(CAMPAIGN, arm);
    const manifest = JSON.parse(
      await readFile(resolve(snapshot, "manifest.json"), "utf8"),
    ) as SnapshotManifest;
    if (
      manifest.label !== arm ||
      manifest.runtimeConstant !== `OCR_REGION_MIN_SIDE_PT=${expected}`
    ) {
      throw new Error(`Manifiesto incompatible para ${arm}: ${manifest.runtimeConstant}`);
    }
    if (resolve(manifest.workspace).toLowerCase() !== ROOT.toLowerCase()) {
      throw new Error(`Workspace de build no coincide: ${manifest.workspace}`);
    }
    const actual = [
      ...(await hashTree(resolve(snapshot, "apps/desktop-shell/dist"))).map((entry) => ({
        ...entry,
        path: `apps/desktop-shell/dist/${entry.path}`,
      })),
      ...(await hashTree(resolve(snapshot, "apps/react-client/dist"))).map((entry) => ({
        ...entry,
        path: `apps/react-client/dist/${entry.path}`,
      })),
    ];
    const expectedFiles = [...manifest.files].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    if (JSON.stringify(actual) !== JSON.stringify(expectedFiles)) {
      throw new Error(`Hashes del snapshot ${arm} no coinciden con su manifiesto`);
    }
    await validateSnapshotRuntimeSource(snapshot, manifest, expected);
    manifests.push(manifest);
  }
  const source = await readFile(
    resolve(ROOT, "packages/anonymization-core/pdf-engine/src/pdf.engine.ts"),
    "utf8",
  );
  if (!source.includes("const OCR_REGION_MIN_SIDE_PT = 100;")) {
    throw new Error("El workspace debe conservar la política vigente de 100 pt");
  }
  if (manifests[0]?.lockfileSha256 !== manifests[1]?.lockfileSha256) {
    throw new Error("Los artefactos se construyeron con lockfiles distintos");
  }
  const electronPackage = JSON.parse(
    await readFile(resolve(ROOT, "apps/desktop-shell/node_modules/electron/package.json"), "utf8"),
  ) as { readonly version?: unknown };
  if (typeof electronPackage.version !== "string") {
    throw new Error("No se pudo determinar la versión resuelta del ejecutable Electron");
  }
  await writeFile(
    resolve(OUTPUT, "build-validation.json"),
    JSON.stringify(
      {
        snapshots: manifests.map(
          ({
            label,
            runtimeConstant,
            runtimeSourceSha256,
            lockfileSha256,
            electronVersion,
            files,
          }) => ({
            label,
            runtimeConstant,
            runtimeSourceSha256,
            lockfileSha256,
            electronVersion,
            fileCount: files.length,
          }),
        ),
        electronVersionResolved: electronPackage.version,
        verifiedAt: new Date().toISOString(),
        workspaceRuntimeConstant: "OCR_REGION_MIN_SIDE_PT=100",
        snapshotsAreHistoricalAuditArms: manifests.map(({ label, runtimeConstant }) => ({
          label,
          runtimeConstant,
        })),
        referenceManifestPreservesPreChangeSourceHash: true,
      },
      null,
      2,
    ),
    "utf8",
  );
  return manifests;
}

function isWithin(path: string, parent: string): boolean {
  return path === parent || path.startsWith(parent + "\\") || path.startsWith(parent + "/");
}

async function ensureSnapshotDependencyJunction(arm: Arm): Promise<string> {
  const snapshot = resolve(CAMPAIGN, arm);
  const shell = resolve(snapshot, "apps/desktop-shell");
  const link = resolve(shell, "node_modules");
  const target = resolve(ROOT, "apps/desktop-shell/node_modules");
  if (!isWithin(snapshot, CAMPAIGN) || !isWithin(shell, snapshot) || !isWithin(link, snapshot)) {
    throw new Error(`Ruta de snapshot fuera de campaña: ${link}`);
  }
  if (!isWithin(target, ROOT)) throw new Error(`Dependencias fuera del workspace: ${target}`);
  const fs = await import("node:fs/promises");
  try {
    const resolved = await fs.realpath(link);
    if (resolve(resolved).toLowerCase() !== target.toLowerCase()) {
      throw new Error(`Junction preexistente con destino inesperado: ${resolved}`);
    }
  } catch (error: unknown) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    await fs.symlink(target, link, "junction");
  }
  const resolved = resolve(await fs.realpath(link));
  if (resolved.toLowerCase() !== target.toLowerCase()) {
    throw new Error(`Dependencias de Electron no resuelven al workspace esperado: ${resolved}`);
  }
  return resolved;
}

async function launchSnapshot(
  arm: Arm,
): Promise<{ readonly app: ElectronApplication; readonly userDataDir: string }> {
  const shell = resolve(CAMPAIGN, arm, "apps/desktop-shell");
  await ensureSnapshotDependencyJunction(arm);
  const userDataDir = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(join(tmpdir(), "anonly-25pt-")),
  );
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [shell, `--user-data-dir=${userDataDir}`, "--remote-debugging-port=0"],
  });
  return { app, userDataDir };
}

async function installPrototypeDiagnostics(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Core = {
      readonly bus: {
        on(channel: string, event: string, handler: (payload: unknown) => void): () => void;
      };
    };
    const core = (window as DiagnosticWindow & { __anonlyCore?: Core }).__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore ausente al instalar diagnóstico 25pt");
    const state = { events: [] as EventRecord[], unlisten: [] as Array<() => void> };
    for (const [channel, event] of [
      ["pipeline", "PIPELINE_READY"],
      ["pipeline", "PIPELINE_FAILED"],
      ["pdf", "PAGE_PARSED"],
      ["ocr", "OCR_PAGE_FINISHED"],
      ["regex", "ENTITY_FOUND"],
      ["ner", "ENTITY_FOUND"],
      ["grouping", "ENTITY_GROUP_CREATED"],
      ["grouping", "GROUPING_FINISHED"],
    ]) {
      state.unlisten.push(
        core.bus.on(channel ?? "", event ?? "", (payload) => {
          state.events.push({ channel: channel ?? "", event: event ?? "", payload });
        }),
      );
    }
    (window as DiagnosticWindow).__ocrRegion25Prototype = state;
  });
}

async function readPrototypeEvents(page: Page): Promise<ReadonlyArray<EventRecord>> {
  return page.evaluate(() => (window as DiagnosticWindow).__ocrRegion25Prototype?.events ?? []);
}

async function readProductPageWords(
  page: Page,
  documentId: string,
): Promise<RunRecord["pageWords"]> {
  return page.evaluate((id) => {
    type Box = {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rotation?: number;
    };
    type ProductWord = { readonly text: string; readonly source: string; readonly bbox: Box };
    type Core = {
      readonly orchestrator?: {
        readonly documents?: Map<
          string,
          {
            readonly pages: ReadonlyArray<{
              readonly index: number;
              readonly words: ReadonlyArray<ProductWord>;
            }>;
          }
        >;
      };
    };
    const core = (window as typeof window & { __anonlyCore?: Core }).__anonlyCore;
    const document = core?.orchestrator?.documents?.get(id);
    if (document === undefined) return [];
    return document.pages.map((item) => ({
      pageIndex: item.index,
      words: item.words.map(({ text, source, bbox }) => ({ text, source, bbox })),
    }));
  }, documentId);
}

async function removePrototypeDiagnostics(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as DiagnosticWindow;
    const state = scope.__ocrRegion25Prototype;
    if (state !== undefined) for (const unlisten of state.unlisten) unlisten();
    delete scope.__ocrRegion25Prototype;
  });
}

async function runPipeline(
  arm: Arm,
  fixture: "mixed-original" | "aligned-12",
  bytes: Uint8Array,
): Promise<RunRecord> {
  const { app, userDataDir } = await launchSnapshot(arm);
  let page: Page | undefined;
  let record: RunRecord | undefined;
  const replacementActions: Array<{
    readonly identifier: string;
    readonly groupFound: boolean;
    readonly effectiveAccessibleName: string | null;
  }> = [];
  const caseDir = resolve(OUTPUT, arm, fixture);
  await mkdir(caseDir, { recursive: true });
  const inputPath = resolve(caseDir, "source.pdf");
  await writeFile(inputPath, bytes);
  try {
    page = await app.firstWindow();
    await page.waitForLoadState("load");
    await page.setViewportSize({ width: 1440, height: 900 });
    await installSettingsOverride(
      page,
      { performancePreset: "medium", nerEnabled: true, ocrLanguages: ["spa"] },
      resolve(ROOT, "tests/perf/ocr-region-25pt-prototype.spec.ts"),
    );
    await page.reload({ waitUntil: "load" });
    await installSmallRegionObserver(page);
    await installPrototypeDiagnostics(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: `${fixture}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(bytes),
    });
    let documentId: string | null = null;
    let failure: string | null = null;
    try {
      documentId = await waitForSmallRegionReady(page);
    } catch (error: unknown) {
      failure = error instanceof Error ? error.message : String(error);
    }
    const events = await readPrototypeEvents(page);
    const labels = await page.getByRole("treeitem").allTextContents();
    const observation = documentId === null ? null : await observeProductDocument(page, documentId);
    const pageWords =
      documentId === null ? undefined : await readProductPageWords(page, documentId);
    let exportBytes: Buffer | undefined;
    if (fixture === "mixed-original" && documentId !== null && failure === null) {
      await expect(page.getByRole("tree", { name: "Entidades detectadas" })).toBeVisible({
        timeout: 30_000,
      });
      for (const target of [MIXED_DNI_NATIVE, MIXED_DNI_IMAGE]) {
        const escaped = target.replaceAll(".", "\\.");
        const card = page.getByRole("treeitem", {
          name: new RegExp(`^${escaped}(?:,|$)`, "u"),
        });
        if ((await card.count()) === 0) {
          replacementActions.push({
            identifier: target,
            groupFound: false,
            effectiveAccessibleName: null,
          });
          continue;
        }
        const mode = card.getByRole("button", { name: /^Modo de reemplazo de / });
        await mode.click();
        await page
          .getByRole("group", { name: "Modo de reemplazo" })
          .getByRole("button", { name: /^Tapar con negro/ })
          .click();
        await expect(mode).toHaveAccessibleName(/Tapar con negro/);
        replacementActions.push({
          identifier: target,
          groupFound: true,
          effectiveAccessibleName: await mode.getAttribute("aria-label"),
        });
      }
      await page.getByRole("button", { name: "Exportar" }).click();
      const dialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
      await dialog.getByRole("button", { name: "Exportar" }).click();
      const download = dialog.getByRole("link", { name: "Descargar" });
      await expect(download).toBeVisible({ timeout: 240_000 });
      exportBytes = await captureDownload(
        app,
        () => download.click(),
        resolve(caseDir, "export.pdf"),
      );
      await writeFile(resolve(caseDir, "export.pdf"), exportBytes);
    }
    const sourceTextLayer =
      fixture === "mixed-original" ? fixtures.mixed.textLayerTextByPage : undefined;
    record = {
      arm,
      fixture,
      fixtureSha256: sha256(bytes),
      terminal: { readyDocumentId: documentId, failure },
      observation,
      events,
      groupLabels: labels,
      ...(pageWords === undefined ? {} : { pageWords }),
      ...(exportBytes === undefined ? {} : { exportSha256: sha256(exportBytes) }),
      ...(sourceTextLayer === undefined ? {} : { textLayerByPage: sourceTextLayer }),
      ...(replacementActions.length === 0 ? {} : { replacementActions }),
    };
    await writeFile(
      resolve(caseDir, "pipeline-observation.json"),
      JSON.stringify(record, null, 2),
      "utf8",
    );
    if (fixture === "mixed-original" && exportBytes !== undefined) {
      const browser = await chromium.launch();
      try {
        const auditPage = await browser.newPage();
        const sourceAudit = await auditPdfWithIndependentOcr(auditPage, bytes, [0]);
        const exportAudit = await auditPdfWithIndependentOcr(auditPage, exportBytes, [0]);
        record = {
          ...record,
          sourceAuditText: sourceAudit.textByPage,
          exportAuditText: exportAudit.textByPage,
        };
        await writeFile(
          resolve(caseDir, "pipeline-observation.json"),
          JSON.stringify(record, null, 2),
          "utf8",
        );
        await auditPage.close();
      } finally {
        await browser.close();
      }
      return record;
    }
    return record;
  } catch (error: unknown) {
    const diagnostic = {
      arm,
      fixture,
      fixtureSha256: sha256(bytes),
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      ...(page === undefined ? {} : { events: await readPrototypeEvents(page).catch(() => []) }),
    };
    await writeFile(resolve(caseDir, "failure.json"), JSON.stringify(diagnostic, null, 2), "utf8");
    throw error;
  } finally {
    if (page !== undefined && app.process().exitCode === null) {
      await removePrototypeDiagnostics(page).catch(() => undefined);
      await removeSmallRegionObserver(page).catch(() => undefined);
    }
    if (app.process().exitCode === null) await app.close();
    const tempRoot = resolve(tmpdir());
    const resolvedUserDataDir = resolve(userDataDir);
    const isVerifiedTempProfile =
      resolvedUserDataDir.startsWith(tempRoot + "\\") &&
      resolvedUserDataDir.split(/[\\/]/u).at(-1)?.startsWith("anonly-25pt-") === true;
    if (isVerifiedTempProfile) {
      await rm(resolvedUserDataDir, { recursive: true, force: true });
    } else {
      await writeFile(
        resolve(caseDir, "profile-cleanup-path-rejected.json"),
        JSON.stringify({ resolvedUserDataDir, tempRoot }, null, 2),
        "utf8",
      );
    }
  }
}

test.describe("ADR-202 25 pt prototype", () => {
  test.skip(
    process.env.ANONLY_REGION25_PROTOTYPE !== "1",
    "Opt-in: set ANONLY_REGION25_PROTOTYPE=1 before fixture generation or Electron launch.",
  );

  test.beforeAll(async () => {
    await mkdir(OUTPUT, { recursive: true });
    await validateSnapshots();
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const mixed = await buildSmallMixedCharacterizationFixture(page);
      assertMixedFixtureTextLayer(mixed);
      const aligned = await generateAlignedTextImageControls();
      if (aligned.sha256 !== ALIGNED_EXPECTED_SHA256) {
        throw new Error(`Hash del corpus alineado inesperado: ${aligned.sha256}`);
      }
      const mixedTextLayer = await extractPdfTextLayer(page, mixed.bytes);
      const alignedTextLayer = await extractPdfTextLayer(page, aligned.bytes);
      if (alignedTextLayer.length !== 12 || aligned.cases.length !== 12) {
        throw new Error(
          `Corpus alineado incompleto: pages=${alignedTextLayer.length}, cases=${aligned.cases.length}`,
        );
      }
      fixtures = { mixed, aligned };
      await writeFile(
        resolve(OUTPUT, "fixture-manifest.json"),
        JSON.stringify(
          {
            generatedBeforeElectron: true,
            mixed: {
              corpusRevision: mixed.corpusRevision,
              sha256: sha256(mixed.bytes),
              bytes: mixed.bytes.byteLength,
              geometry: mixed.mixedGeometry,
              textLayerByPage: mixedTextLayer,
              targets: mixed.targets,
            },
            aligned: {
              sha256: aligned.sha256,
              bytes: aligned.bytes.byteLength,
              generator: aligned.generator,
              seed: aligned.seed,
              pageCount: aligned.cases.length,
              sourceImageHashes: aligned.cases.map((item) => item.sourceImageSha256),
              cases: aligned.cases.map((item) => ({
                id: item.id,
                pageIndex: item.pageIndex,
                heightPt: item.heightPt,
                orientation: item.orientation,
                sourceDpi: item.sourceDpi,
                imageRect: item.imageRect,
                textRect: item.textRect,
                sourceImageSha256: item.sourceImageSha256,
              })),
              textLayerByPage: alignedTextLayer,
            },
            armBuilds: ["reference-100", "candidate-25"],
            settings: { performancePreset: "medium", nerEnabled: true, ocrLanguages: ["spa"] },
            settingsInterpretation:
              "Both arms use spa only. settings.store.ts defaults to spa+eng, so mixed H1 is not validation under default languages or a validation of ADR-148. H2 remains a geometric admission comparison with identical settings.",
          },
          null,
          2,
        ),
        "utf8",
      );
      await page.close();
    } finally {
      await browser.close();
    }
  });

  test("ADR-202 first pilot: mixed and 12 aligned controls on both immutable builds", async () => {
    const records: RunRecord[] = [];
    for (const fixture of ["mixed-original", "aligned-12"] as const) {
      const bytes = fixture === "mixed-original" ? fixtures.mixed.bytes : fixtures.aligned.bytes;
      for (const arm of ["reference-100", "candidate-25"] as const) {
        records.push(await runPipeline(arm, fixture, bytes));
      }
      await writeFile(
        resolve(OUTPUT, "first-stage.json"),
        JSON.stringify(
          {
            decisionPoint: fixture,
            records,
            alignedInvariant:
              fixture === "aligned-12"
                ? records
                    .filter((record) => record.fixture === fixture)
                    .map((record) => ({
                      arm: record.arm,
                      retainedRegions: record.observation?.ocrRegions.length ?? null,
                      ocrEvents: record.observation?.ocrEvents.length ?? null,
                      nativeWordsByPage:
                        record.observation?.pages.map((page) => page.nativeWordCount) ?? null,
                    }))
                : undefined,
          },
          null,
          2,
        ),
        "utf8",
      );
    }

    const candidateMixed = records.find(
      (record) => record.arm === "candidate-25" && record.fixture === "mixed-original",
    );
    const candidateAligned = records.find(
      (record) => record.arm === "candidate-25" && record.fixture === "aligned-12",
    );
    const mixedRegionAdmitted =
      candidateMixed?.observation?.ocrRegions.some((region) => region.pageIndex === 0) ?? false;
    const mixedImageDniFound = containsIdentifierDigits(
      [candidateMixed?.observation?.pages[0]?.productOcrText ?? ""],
      MIXED_DNI_IMAGE,
    );
    const mixedTargetRedacted = [MIXED_DNI_NATIVE, MIXED_DNI_IMAGE].every(
      (identifier) => !containsIdentifierDigits(candidateMixed?.exportAuditText ?? [], identifier),
    );
    const mixedNeighborsPreserved = ["INICIO PUBLICO", "CIERRE PUBLICO", "REGION PUBLICA"].every(
      (neighbor) => normalizedAuditText(candidateMixed?.exportAuditText).includes(neighbor),
    );
    const sourceIndependentConfirmsBothDnis = [MIXED_DNI_NATIVE, MIXED_DNI_IMAGE].every(
      (identifier) => containsIdentifierDigits(candidateMixed?.sourceAuditText ?? [], identifier),
    );
    const sourceIndependentConfirmsNeighbors = [
      "INICIO PUBLICO",
      "CIERRE PUBLICO",
      "REGION PUBLICA",
    ].every((neighbor) => normalizedAuditText(candidateMixed?.sourceAuditText).includes(neighbor));
    const bothArmsReachedReady =
      records.length === 4 &&
      records.every(
        (record) =>
          record.terminal.readyDocumentId !== null &&
          record.terminal.failure === null &&
          record.observation?.ready === true,
      );
    const alignedTriggeredNewOcr =
      (candidateAligned?.observation?.ocrRegions.length ?? 0) > 0 ||
      (candidateAligned?.observation?.ocrEvents.length ?? 0) > 0;
    const decision = {
      h1MixedRegionAdmitted: mixedRegionAdmitted,
      h1MixedImageDniFoundByProductOcr: mixedImageDniFound,
      h1MixedImageDniAbsentFromExportOcr: mixedTargetRedacted,
      h2AlignedControlsTriggerNewOcr: alignedTriggeredNewOcr,
      earlyStop:
        alignedTriggeredNewOcr ||
        !mixedRegionAdmitted ||
        !mixedImageDniFound ||
        !mixedTargetRedacted ||
        !mixedNeighborsPreserved,
      h1MixedNeighborsPreserved: mixedNeighborsPreserved,
      h1IndependentSourceConfirmsBothDnis: sourceIndependentConfirmsBothDnis,
      h1IndependentSourceConfirmsNeighbors: sourceIndependentConfirmsNeighbors,
      bothArmsReachedReady,
      candidateReplacementActions: candidateMixed?.replacementActions ?? null,
      candidateExportModeIsRedact:
        candidateMixed?.replacementActions?.length === 2 &&
        candidateMixed.replacementActions.every(
          (item) =>
            item.groupFound && item.effectiveAccessibleName?.includes("Tapar con negro") === true,
        ),
      sourceTextLayerContainsNativeDniOnly:
        containsIdentifierDigits(fixtures.mixed.textLayerTextByPage ?? [], MIXED_DNI_NATIVE) &&
        !containsIdentifierDigits(fixtures.mixed.textLayerTextByPage ?? [], MIXED_DNI_IMAGE),
      alignedCounterexample: {
        candidateRegions: candidateAligned?.observation?.ocrRegions.length ?? null,
        candidateRegionPages:
          candidateAligned?.observation?.ocrRegions.map((region) => region.pageIndex) ?? null,
        candidateEvents: candidateAligned?.observation?.ocrEvents.length ?? null,
        candidateEventPages:
          candidateAligned?.observation?.ocrEvents.map((event) => event.pageIndex) ?? null,
        candidateEventWordCounts:
          candidateAligned?.observation?.ocrEvents.map((event) => event.wordCount) ?? null,
        referenceRegions:
          records.find(
            (record) => record.arm === "reference-100" && record.fixture === "aligned-12",
          )?.observation?.ocrRegions.length ?? null,
        referenceEvents:
          records.find(
            (record) => record.arm === "reference-100" && record.fixture === "aligned-12",
          )?.observation?.ocrEvents.length ?? null,
        metadataForCounterexamplePages: fixtures.aligned.cases
          .filter((item) =>
            candidateAligned?.observation?.ocrRegions.some(
              (region) => region.pageIndex === item.pageIndex,
            ),
          )
          .map((item) => ({
            caseId: item.id,
            pageIndex: item.pageIndex,
            orientation: item.orientation,
            heightPt: item.heightPt,
            sourceDpi: item.sourceDpi,
            imageRect: item.imageRect,
            textRect: item.textRect,
            sourceImageSha256: item.sourceImageSha256,
            actualPageWords:
              candidateAligned?.pageWords?.find((page) => page.pageIndex === item.pageIndex)
                ?.words ?? null,
            actualRetainedRegion:
              candidateAligned?.observation?.ocrRegions.find(
                (region) => region.pageIndex === item.pageIndex,
              ) ?? null,
          })),
      },
    };
    await writeFile(
      resolve(OUTPUT, "first-stage-decision.json"),
      JSON.stringify({ decision, records }, null, 2),
      "utf8",
    );
    expect(decision.h1MixedRegionAdmitted, JSON.stringify(decision)).toBe(true);
    expect(decision.h1MixedImageDniFoundByProductOcr, JSON.stringify(decision)).toBe(true);
    expect(decision.h1MixedImageDniAbsentFromExportOcr, JSON.stringify(decision)).toBe(true);
    expect(decision.h1MixedNeighborsPreserved, JSON.stringify(decision)).toBe(true);
    expect(decision.h1IndependentSourceConfirmsBothDnis, JSON.stringify(decision)).toBe(true);
    expect(decision.h1IndependentSourceConfirmsNeighbors, JSON.stringify(decision)).toBe(true);
    expect(decision.candidateExportModeIsRedact, JSON.stringify(decision)).toBe(true);
    expect(decision.sourceTextLayerContainsNativeDniOnly, JSON.stringify(decision)).toBe(true);
    expect(decision.bothArmsReachedReady, JSON.stringify(decision)).toBe(true);
    expect(decision.earlyStop, JSON.stringify(decision)).toBe(true);
  });
});
