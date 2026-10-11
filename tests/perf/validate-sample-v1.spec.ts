/** M-V1: cold original -> product export -> a new cold Electron reimport.
 * Real derivatives exist only in memory. M2 measures Electron processes;
 * the exported Buffer retained by the Node harness is excluded explicitly.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ConflictReason } from "@anonly/anonymization-core";
import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { PDFDocument } from "pdf-lib";

import {
  defaultCandidate,
  spellingChoices,
} from "../../apps/react-client/src/components/conflicts/conflictResolution.js";
import { expect, openApp, type ElectronFixtures } from "../e2e/support/electronApp.js";
import type { E2eFilePayload } from "../e2e/support/fixtures.js";
import { installSettingsOverride } from "../e2e/support/settingsOverride.js";
import { generateText10p, generateText50p } from "../fixtures/generate.js";

import { hashBytes } from "./support/adr190Fixtures.js";
import { closeDocument, measureColdImport } from "./support/memoryProfile.js";
import { readRealDocument } from "./support/osdVerdictFixturesM2.js";
import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";
import {
  captureV1Import,
  installV1Collector,
  readV1ExportProbe,
} from "./support/validateSampleBrowser.js";
import {
  checkV1,
  importIssues,
  importProductFailed,
  V1_DOCS,
  V1_PAGES,
  v1Key,
  v1Plan,
  type V1Doc,
  type V1Export,
  type V1Run,
} from "./support/validateSampleCampaign.js";
import {
  conflictDialogDefaultMatches,
  conflictPreparationInvariants,
  heldManualConflictCount,
  unresolvedConflictCount,
  type V1GroupingSnapshot,
} from "./support/validateSampleConflictPreparation.js";
import {
  installV1ExportBlobReaderInPage,
  readV1ExportBlobInPage,
  restoreV1ExportBlobReaderInPage,
} from "./support/validateSampleExportBlob.js";
import { inspectV1RunFiles, invalidV1BatchSeals } from "./support/validateSampleIdentity.js";
import {
  projectV1Manifest,
  projectV1Run,
  safeV1ErrorName,
  sanitizeV1Report,
  V1_BATCH_PATTERN,
} from "./support/validateSamplePrivacy.js";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
const OPT_IN = process.env.ANONLY_VALIDATE_SAMPLE_V1 === "1";
const OUTPUT_DIR = process.env.ANONLY_VALIDATE_SAMPLE_OUTPUT_DIR ?? "";
const BATCH_ID = process.env.ANONLY_VALIDATE_SAMPLE_BATCH_ID ?? "unidentified";
const ONLY = process.env.ANONLY_VALIDATE_SAMPLE_ONLY ?? "";
const LIMIT = Number(process.env.ANONLY_VALIDATE_SAMPLE_LIMIT ?? "0");
const TIMEOUT_MS = 1_200_000;
const SHELL_DIR = resolve("apps/desktop-shell");
const ELECTRON_BIN = resolve(SHELL_DIR, "node_modules/.bin/electron");
const closedSessions = new WeakSet<ElectronApplication>();

function captureGroupingSnapshotInPage(): V1GroupingSnapshot {
  const core = globalThis.__anonlyCore;
  const documentId = globalThis.__anonlyMemoryRun?.documentId;
  if (core === undefined || documentId === undefined)
    throw new Error("M-V1 grouping snapshot unavailable");
  const view = core as typeof core & {
    engines: { grouping: { getSnapshot: (id: string) => V1GroupingSnapshot } };
  };
  const snapshot = view.engines.grouping.getSnapshot(documentId);
  return { groups: snapshot.groups, conflicts: snapshot.conflicts };
}

async function prepareConflictsByUi(
  page: Page,
): Promise<NonNullable<V1Run["conflictPreparation"]>> {
  const started = performance.now();
  const before = await page.evaluate(captureGroupingSnapshotInPage);
  const pendingBefore = unresolvedConflictCount(before);
  const heldManualCount = heldManualConflictCount(before);
  const groupCount = before.groups.length;
  const base = {
    durationMs: 0,
    pendingBefore,
    pendingAfter: pendingBefore,
    resolvedCount: 0,
    heldManualCount,
    defaultInconsistentCount: 0,
    groupCount,
    groupInvariantsPreserved: true,
    conflictInvariantsPreserved: true,
    exportEnabled: false,
  };
  if (pendingBefore === 0) {
    const exportEnabled = await page
      .getByRole("button", { name: "Exportar", exact: true })
      .isEnabled();
    return {
      ...base,
      status: exportEnabled ? "not-needed" : "blocked-default-inconsistent",
      durationMs: performance.now() - started,
      exportEnabled,
      defaultInconsistentCount: exportEnabled ? 0 : 1,
    };
  }
  if (heldManualCount > 0)
    return { ...base, status: "blocked-held-manual", durationMs: performance.now() - started };

  for (const conflict of before.conflicts.filter((value) => !value.resolved)) {
    const group = before.groups.find((value) => value.id === conflict.groupId);
    if (
      group === undefined ||
      conflict.heldManual === true ||
      defaultCandidate(conflict).entityType !== group.type ||
      (conflict.reason === ConflictReason.AmbiguousCanonical &&
        !spellingChoices(conflict).includes(group.canonicalValue))
    ) {
      return {
        ...base,
        status: "blocked-default-inconsistent",
        defaultInconsistentCount: 1,
        durationMs: performance.now() - started,
      };
    }
  }

  let snapshot = before;
  let resolvedCount = 0;
  const deadline = Date.now() + 60_000;
  while (unresolvedConflictCount(snapshot) > 0 && Date.now() < deadline) {
    const conflict = snapshot.conflicts.find((value) => !value.resolved);
    if (conflict === undefined) break;
    const group = snapshot.groups.find((value) => value.id === conflict.groupId);
    if (group === undefined) break;
    // Locate the exact group row by its canonical tree-node id and open its product conflict dialog.
    const escapedGroupId = group.id.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    const button = page
      .locator(`[data-tree-node-id="group:${escapedGroupId}"]`)
      .getByRole("button", { name: "Conflicto sin resolver" });
    await button.click({ timeout: 5_000 });
    const dialog = page.getByRole("dialog", { name: "Revisar entidad" });
    try {
      await expect(dialog).toBeVisible({ timeout: 5_000 });
    } catch {
      return {
        ...base,
        status: "blocked-default-inconsistent",
        pendingAfter: unresolvedConflictCount(snapshot),
        resolvedCount,
        defaultInconsistentCount: 1,
        durationMs: performance.now() - started,
      };
    }
    const groupChoices = dialog.getByRole("radio");
    const selected = await groupChoices.evaluateAll((inputs) =>
      inputs
        .filter((input) => input instanceof HTMLInputElement && input.checked)
        .map((input) => (input as HTMLInputElement).value),
    );
    const expectedType = defaultCandidate(conflict).entityType;
    const defaultsMatch = conflictDialogDefaultMatches(conflict, group, selected);
    if (!defaultsMatch) {
      await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
      return {
        ...base,
        status: "blocked-default-inconsistent",
        pendingAfter: unresolvedConflictCount(snapshot),
        resolvedCount,
        defaultInconsistentCount: 1,
        durationMs: performance.now() - started,
      };
    }
    const beforePending = unresolvedConflictCount(snapshot);
    await dialog.getByRole("button", { name: /^(Aplicar|Descartar)$/ }).click();
    await expect
      .poll(
        async () => {
          const current = await page.evaluate(captureGroupingSnapshotInPage);
          snapshot = current;
          return unresolvedConflictCount(current);
        },
        { timeout: 5_000 },
      )
      .toBe(beforePending - 1);
    const resolvedConflict = snapshot.conflicts.find((value) => value.id === conflict.id);
    if (resolvedConflict?.resolved !== true || resolvedConflict.resolvedType !== expectedType)
      return {
        ...base,
        status: "blocked-default-inconsistent",
        pendingAfter: unresolvedConflictCount(snapshot),
        resolvedCount,
        defaultInconsistentCount: 1,
        durationMs: performance.now() - started,
      };
    resolvedCount += 1;
    const invariant = conflictPreparationInvariants(before, snapshot);
    if (!invariant.groupsPreserved || !invariant.conflictsPreserved)
      return {
        ...base,
        status: "blocked-default-inconsistent",
        pendingAfter: unresolvedConflictCount(snapshot),
        resolvedCount,
        defaultInconsistentCount: 1,
        groupInvariantsPreserved: invariant.groupsPreserved,
        conflictInvariantsPreserved: invariant.conflictsPreserved,
        durationMs: performance.now() - started,
      };
  }
  const pendingAfter = unresolvedConflictCount(snapshot);
  const invariants = conflictPreparationInvariants(before, snapshot);
  const exportEnabled = await page
    .getByRole("button", { name: "Exportar", exact: true })
    .isEnabled();
  const ok =
    pendingAfter === 0 &&
    resolvedCount > 0 &&
    invariants.groupsPreserved &&
    invariants.conflictsPreserved &&
    exportEnabled;
  return {
    ...base,
    status: ok
      ? "prepared"
      : Date.now() >= deadline
        ? "blocked-timeout"
        : "blocked-default-inconsistent",
    durationMs: performance.now() - started,
    pendingAfter,
    resolvedCount,
    groupInvariantsPreserved: invariants.groupsPreserved,
    conflictInvariantsPreserved: invariants.conflictsPreserved,
    exportEnabled,
  };
}
async function closeSession(app: ElectronApplication): Promise<void> {
  if (closedSessions.has(app)) return;
  try {
    await app.close();
    closedSessions.add(app);
  } catch (error: unknown) {
    throw new Error(`M-V1 session close: ${safeV1ErrorName(error)}`);
  }
}
// Dedicated ownership: the initial instance closes before reimport, and its
// fixture teardown observes the same close flag instead of invoking close twice.
const test = base.extend<ElectronFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature
  electronUserDataDir: async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), "anonly-mv1-original-"));
    try {
      await use(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  electronApp: async ({ electronUserDataDir }, use) => {
    const app = await electron.launch({
      args: [SHELL_DIR, `--user-data-dir=${electronUserDataDir}`, "--remote-debugging-port=0"],
      executablePath: ELECTRON_BIN,
    });
    try {
      await use(app);
    } finally {
      await closeSession(app);
    }
  },
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await use(page);
  },
});
if (!Number.isInteger(LIMIT) || LIMIT < 0) throw new Error("M-V1 invalid limit");
if (OPT_IN && !V1_BATCH_PATTERN.test(BATCH_ID)) throw new Error("M-V1 neutral batch ID required");
const docs = V1_DOCS.filter(
  (doc) => (doc !== "R1" && doc !== "R4") || (process.env[`ANONLY_REAL_DOC_${doc}`] ?? "") !== "",
);
const invalidBatchIds: string[] = (() => {
  const file = join(OUTPUT_DIR, "validity.json");
  if (!existsSync(file)) return [];
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      !("affectedRunIds" in value) ||
      !Array.isArray(value.affectedRunIds)
    )
      throw new Error();
    if (
      value.affectedRunIds.some(
        (id: unknown) => typeof id !== "string" || !V1_BATCH_PATTERN.test(id),
      )
    )
      throw new Error();
    return value.affectedRunIds.filter((id: unknown): id is string => typeof id === "string");
  } catch {
    throw new Error("M-V1 invalid suspension record");
  }
})();
function batchSealed(id: string): boolean {
  try {
    const file = join(OUTPUT_DIR, `batch-${id}.json`);
    const seal: unknown = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    return invalidV1BatchSeals([id], { [id]: seal }).length === 0;
  } catch {
    return false;
  }
}
function alreadyComplete(key: string): boolean {
  const file = join(OUTPUT_DIR, `${key}.json`);
  if (!existsSync(file)) return false;
  try {
    // Read-only boundary validated and projected before any field can reach output.
    const run = projectV1Run(JSON.parse(readFileSync(file, "utf8")) as V1Run);
    const check = checkV1([run], [run.doc], invalidBatchIds);
    return (
      v1Key(run) === key &&
      check.issues.length === 0 &&
      check.invalidRuns.length === 0 &&
      batchSealed(run.batchId)
    );
  } catch {
    return false;
  }
}
function requireCoherentRunInventory(): void {
  if (existsSync(OUTPUT_DIR) && inspectV1RunFiles(readdirSync(OUTPUT_DIR)).issues.length > 0)
    throw new Error("M-V1 unexpected run file; neutral campaign inventory invalid");
}
const pending = (() => {
  if (!OPT_IN || OUTPUT_DIR === "") return [];
  // Reject incoherent extra records before retaining any completed cell, even
  // when every expected record exists and there would otherwise be no work.
  requireCoherentRunInventory();
  const only = (() => {
    try {
      return ONLY === "" ? null : new RegExp(ONLY);
    } catch {
      throw new Error("M-V1 invalid neutral selection filter");
    }
  })();
  const selected = v1Plan(docs).filter((id) => only === null || only.test(v1Key(id)));
  if (selected.length === 0) throw new Error("M-V1 filter selects no available cells");
  const list = selected.filter((id) => !alreadyComplete(v1Key(id)));
  return LIMIT === 0 ? list : list.slice(0, LIMIT);
})();
const payloads = new Map<V1Doc, E2eFilePayload>();
const FIXED_DATE = new Date("2026-01-01T00:00:00.000Z");
async function canonicalDates(bytes: Uint8Array): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  source.setCreationDate(FIXED_DATE);
  source.setModificationDate(FIXED_DATE);
  return source.save();
}
async function buildDocument(doc: V1Doc): Promise<E2eFilePayload> {
  try {
    let buffer: Buffer;
    if (doc === "R1" || doc === "R4")
      buffer = Buffer.from(await readRealDocument(process.env[`ANONLY_REAL_DOC_${doc}`] ?? ""));
    else {
      const source = doc.endsWith("10")
        ? await canonicalDates(await generateText10p())
        : await generateText50p();
      buffer = doc.startsWith("scan")
        ? Buffer.from(
            await canonicalDates(
              (
                await getOrGenerateScannedFixture(
                  doc === "scan50" ? "p2-scanned-50p" : "mv1-scanned-10p",
                  source,
                )
              ).buffer,
            ),
          )
        : Buffer.from(source);
    }
    const pages = (await PDFDocument.load(buffer, { updateMetadata: false })).getPageCount();
    if (pages !== V1_PAGES[doc]) throw new Error("M-V1 source page count mismatch");
    return { name: `${doc}.pdf`, mimeType: "application/pdf", buffer };
  } catch (error: unknown) {
    throw new Error(`M-V1 fixture ${doc}: ${safeV1ErrorName(error)}`);
  }
}
async function hashTree(directory: string): Promise<Array<{ path: string; hash: string }>> {
  const files: Array<{ path: string; hash: string }> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await hashTree(path)));
    else files.push({ path, hash: hashBytes(await readFile(path)) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  // Run/checkpoint writes are constructed through the exact allowlist; manifests
  // contain only explicit instrument constants, identity hashes and neutral IDs.
  const projected =
    typeof value === "object" && value !== null && "repetition" in value
      ? projectV1Run(value as V1Run)
      : value;
  await writeFile(`${path}.tmp`, `${JSON.stringify(projected, null, 2)}\n`);
  await rename(`${path}.tmp`, path);
}

async function exportInMemory(
  page: Page,
): Promise<{ readonly bytes: Buffer; readonly report: V1Export }> {
  // Original-import samplers have stopped before entering this function.
  await page.evaluate(installV1ExportBlobReaderInPage);
  try {
    return await exportWithExactBlobReference(page);
  } finally {
    await page.evaluate(restoreV1ExportBlobReaderInPage);
  }
}

async function exportWithExactBlobReference(
  page: Page,
): Promise<{ readonly bytes: Buffer; readonly report: V1Export }> {
  console.log("M-V1 export step: open-dialog");
  await page.getByRole("button", { name: "Exportar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Exportar documento anonimizado" });
  await expect(dialog).toBeVisible();
  console.log("M-V1 export step: submit");
  await dialog.getByRole("button", { name: "Exportar", exact: true }).click();
  let noGroupsConfirmationShown = false;
  let unreadableConfirmationShown = false;
  // Product preflight confirmations are handled without changing their defaults.
  const noGroups = page.getByRole("dialog", { name: "Exportar sin nada anonimizado" });
  const unreadable = page.getByRole("dialog", { name: "Páginas que no se pudieron leer" });
  await expect
    .poll(
      async () =>
        (await noGroups.isVisible()) ||
        (await unreadable.isVisible()) ||
        (await readV1ExportProbe(page)).requestedAt !== null,
      { timeout: 10_000 },
    )
    .toBe(true);
  console.log("M-V1 export step: confirmations");
  if (await noGroups.isVisible()) {
    noGroupsConfirmationShown = true;
    await noGroups.getByRole("button", { name: "Continuar", exact: true }).click();
  }
  await expect
    .poll(
      async () =>
        (await unreadable.isVisible()) || (await readV1ExportProbe(page)).requestedAt !== null,
      { timeout: 10_000 },
    )
    .toBe(true);
  if (await unreadable.isVisible()) {
    unreadableConfirmationShown = true;
    await unreadable.getByRole("button", { name: "Exportar", exact: true }).click();
  }
  await page.waitForFunction(
    () => {
      const state = globalThis.__anonlyV1;
      return state !== undefined && (state.export.finishedAt !== null || state.export.failed);
    },
    undefined,
    { timeout: TIMEOUT_MS },
  );
  console.log("M-V1 export step: finished-probe");
  const probe = await readV1ExportProbe(page);
  if (
    probe.failed ||
    probe.durationMs === null ||
    probe.sizeBytes === null ||
    probe.options === null ||
    probe.requestedAt === null ||
    probe.finishedAt === null
  ) {
    console.log("M-V1 export metadata absent", {
      failed: probe.failed,
      durationObserved: probe.durationMs !== null,
      sizeObserved: probe.sizeBytes !== null,
      optionsObserved: probe.options !== null,
      requestedObserved: probe.requestedAt !== null,
      finishedObserved: probe.finishedAt !== null,
    });
    throw new Error("M-V1 export failed or metadata missing");
  }
  let download = page
    .getByRole("dialog", { name: "Exportar documento anonimizado" })
    .getByRole("link", { name: "Descargar" });
  if (!(await download.isVisible())) {
    await page.getByRole("button", { name: "Exportar", exact: true }).click();
    download = page
      .getByRole("dialog", { name: "Exportar documento anonimizado" })
      .getByRole("link", { name: "Descargar" });
  }
  await expect(download).toBeVisible();
  console.log("M-V1 export step: read-blob");
  const href = await download.getAttribute("href");
  if (href === null || !href.startsWith("blob:")) throw new Error("M-V1 export blob unavailable");
  const base64 = await page.evaluate(readV1ExportBlobInPage, {
    href,
    expectedBytes: probe.sizeBytes,
  });
  const bytes = Buffer.from(base64, "base64");
  console.log("M-V1 export step: parse-buffer");
  if (bytes.byteLength !== probe.sizeBytes) throw new Error("M-V1 export byte length mismatch");
  const pages = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
  const report: V1Export = {
    ...probe.options,
    durationMs: probe.durationMs,
    wallDurationMs: probe.finishedAt - probe.requestedAt,
    sizeBytes: bytes.length,
    sha256: hashBytes(bytes),
    pages,
    noGroupsConfirmationShown,
    unreadableConfirmationShown,
  };
  // Listo belongs to the post-download panel. Memory-only export closes via
  // the actual dialog close control without activating the download link.
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(dialog).toBeHidden();
  return { bytes, report };
}

test.describe("M-V1 reading the exported PDF in a new cold process", () => {
  test.skip(!OPT_IN, "Opt-in M-V1 campaign");
  test.beforeAll(async () => {
    if (OUTPUT_DIR === "") throw new Error("M-V1 output directory required");
    await mkdir(OUTPUT_DIR, { recursive: true });
    requireCoherentRunInventory();
    const manifestPath = join(OUTPUT_DIR, "manifest.json");
    const previous = await (async () => {
      try {
        return existsSync(manifestPath)
          ? projectV1Manifest(JSON.parse(await readFile(manifestPath, "utf8")))
          : null;
      } catch {
        throw new Error("M-V1 unreadable or incomplete manifest");
      }
    })();
    if (previous !== null && JSON.stringify(previous.docs) !== JSON.stringify(docs))
      throw new Error("M-V1 available documents changed");
    // Recheck source bytes also for completed cells. Otherwise a changed real
    // source could be silently accepted when every old result was skipped.
    const needed = new Set(docs);
    const hashes: Record<string, string> = { ...previous?.fixtureHashes };
    for (const doc of needed) {
      const file = await buildDocument(doc);
      payloads.set(doc, file);
      const hash = hashBytes(file.buffer);
      if (hashes[doc] !== undefined && hashes[doc] !== hash)
        throw new Error(`M-V1 fixture identity changed: ${doc}`);
      hashes[doc] = hash;
    }
    const buildHash = hashBytes(
      Buffer.from(
        JSON.stringify([
          ...(await hashTree(resolve("apps/react-client/dist"))),
          ...(await hashTree(SHELL_DIR + "/dist")),
        ]),
      ),
    );
    if (previous !== null && previous.buildHash !== buildHash)
      throw new Error("M-V1 build changed");
    await atomicJson(manifestPath, {
      schema: 1,
      phase: "M-V1",
      createdAtUtc: previous?.createdAtUtc ?? new Date().toISOString(),
      buildHash,
      docs,
      docsMissing: ["R1", "R4"].filter((doc) => !docs.includes(doc as V1Doc)),
      fixtureHashes: hashes,
      pages: V1_PAGES,
      scanSourceDpi: 216,
      syntheticMetadataNormalization: {
        fields: ["CreationDate", "ModDate"],
        value: FIXED_DATE.toISOString(),
        scope:
          "digital10 and scan10/scan50, in memory before hashing/import; no real source or export changed",
      },
      instrument:
        "measureColdImport/runImport of memoryProfile plus post-Ready UI confirmation of existing conflict defaults before export; RSS150ms, CDP heap, M2 and postReady, NER enabled",
      approximation:
        "Reimport includes NER and grouping; OCR duration is reported separately. No verifier exists yet.",
      bufferAccounting:
        "M2 includes Electron only; exported bytes retained by Node are excluded and reported as export size.",
      batches:
        previous?.batches.some((batch) => batch.id === BATCH_ID) === true
          ? previous.batches
          : [...(previous?.batches ?? []), { id: BATCH_ID, pendingRuns: pending.length }],
    });
    console.log(`M-V1: ${pending.length} pending runs; documents ${docs.join(",")}`);
  });
  // With no pending cells Playwright otherwise omits beforeAll. This no-fixture
  // sentinel rechecks all source/build identities without launching Electron
  // or inventing a 37th measurement record.
  if (OPT_IN && pending.length === 0)
    test("M-V1 validate completed campaign identity", async () => {
      console.log("M-V1 completed records retained after source/build identity check");
    });
  for (const id of pending)
    test(v1Key(id), async ({ page, electronApp, electronUserDataDir }) => {
      test.setTimeout(TIMEOUT_MS * 4);
      const file = payloads.get(id.doc);
      if (file === undefined) throw new Error("M-V1 fixture unavailable");
      let stage: "original" | "conflicts" | "export" | "reimport" = "original";
      let run: V1Run = {
        schema: 1,
        ...id,
        capturedAtUtc: new Date().toISOString(),
        batchId: BATCH_ID,
        fixtureSha256: hashBytes(file.buffer),
        fixtureBytes: file.buffer.length,
        sourcePages: V1_PAGES[id.doc],
        original: null,
        exported: null,
        conflictPreparation: null,
        reimport: null,
        failedAt: null,
        failureKind: null,
        errorName: null,
        issues: [],
      };
      const outputPath = join(OUTPUT_DIR, `${v1Key(id)}.json`);
      const checkpointPath = join(OUTPUT_DIR, `${v1Key(id)}-checkpoint.json`);
      if (existsSync(outputPath)) {
        let oldBatch = "tanda-unknown";
        try {
          oldBatch = projectV1Run(JSON.parse(await readFile(outputPath, "utf8")) as V1Run).batchId;
        } catch {
          /* Invalid record is remeasured under a neutral archive ID. */
        }
        const safeBatch = oldBatch;
        const reason =
          invalidBatchIds.includes(oldBatch) || !batchSealed(oldBatch) ? "invalid" : "failure";
        await rename(outputPath, join(OUTPUT_DIR, `${v1Key(id)}-${reason}-${safeBatch}.json`));
      }
      try {
        await installSettingsOverride(page, { performancePreset: id.preset, nerEnabled: true });
        await openApp(page, "networkidle");
        const original = {
          report: sanitizeV1Report(
            await measureColdImport(page, electronApp, electronUserDataDir, file, TIMEOUT_MS, [
              installV1Collector,
            ]),
          ),
          snapshot: await captureV1Import(page),
        };
        run = { ...run, original };
        await atomicJson(checkpointPath, run);
        const originalIssues = importIssues(
          original,
          run.sourcePages,
          id.doc === "R1" || id.doc.startsWith("scan"),
        );
        if (originalIssues.length > 0) {
          run = { ...run, issues: originalIssues };
          throw new Error("M-V1 original incomplete");
        }
        if (importProductFailed(original)) {
          await atomicJson(outputPath, {
            ...run,
            failedAt: "original",
            failureKind: "product",
            errorName: null,
          });
          await rm(checkpointPath, { force: true });
          return;
        }
        stage = "conflicts";
        const conflictPreparation = await prepareConflictsByUi(page);
        run = { ...run, conflictPreparation };
        await atomicJson(checkpointPath, run);
        if (conflictPreparation.status.startsWith("blocked-")) {
          await atomicJson(outputPath, {
            ...run,
            failedAt: "conflicts",
            failureKind:
              conflictPreparation.status === "blocked-held-manual" ? "blocked" : "instrument",
            errorName: null,
          });
          await rm(checkpointPath, { force: true });
          return;
        }
        stage = "export";
        const exported = await exportInMemory(page);
        run = { ...run, exported: exported.report };
        await atomicJson(checkpointPath, run);
        await closeDocument(page);
        await closeSession(electronApp);
        stage = "reimport";
        const reimportDir = await mkdtemp(join(tmpdir(), "anonly-mv1-"));
        try {
          const coldApp = await electron.launch({
            args: [SHELL_DIR, `--user-data-dir=${reimportDir}`, "--remote-debugging-port=0"],
            executablePath: ELECTRON_BIN,
          });
          try {
            const coldPage = await coldApp.firstWindow();
            await coldPage.waitForLoadState("domcontentloaded");
            await installSettingsOverride(coldPage, {
              performancePreset: id.preset,
              nerEnabled: true,
            });
            await openApp(coldPage, "networkidle");
            const exportFile = {
              name: `${id.doc}-export.pdf`,
              mimeType: "application/pdf",
              buffer: exported.bytes,
            };
            const reimport = {
              report: sanitizeV1Report(
                await measureColdImport(coldPage, coldApp, reimportDir, exportFile, TIMEOUT_MS, [
                  installV1Collector,
                ]),
              ),
              snapshot: await captureV1Import(coldPage),
            };
            run = { ...run, reimport };
            await atomicJson(checkpointPath, run);
            const issues = importIssues(reimport, exported.report.pages, true);
            if (exported.report.pages !== run.sourcePages)
              issues.push("export-page-count-mismatch");
            if (issues.length > 0) {
              run = { ...run, issues };
              throw new Error("M-V1 reimport incomplete");
            }
            if (importProductFailed(reimport)) {
              await atomicJson(outputPath, {
                ...run,
                failedAt: "reimport",
                failureKind: "product",
                errorName: null,
              });
              await rm(checkpointPath, { force: true });
              return;
            }
            await closeDocument(coldPage);
          } finally {
            await closeSession(coldApp);
          }
        } finally {
          await rm(reimportDir, { recursive: true, force: true });
        }
        await atomicJson(outputPath, run);
        await rm(checkpointPath, { force: true });
        console.log(
          `M-V1 ${v1Key(id)}: original ${run.original?.report.readyDurationMs}ms / ${run.original?.report.peakSumBytes}B; export ${run.exported?.sizeBytes}B; reimport ${run.reimport?.report.readyDurationMs}ms / ${run.reimport?.report.peakSumBytes}B`,
        );
      } catch (error: unknown) {
        const name = safeV1ErrorName(error);
        const instrumentLine =
          error instanceof Error
            ? error.stack
                ?.split("\n")
                .find((line) => /^\s+at /.test(line) && line.includes("validate-sample-v1.spec"))
                ?.match(/:(\d+):\d+\)?$/)?.[1]
            : undefined;
        console.log(
          `M-V1 ${v1Key(id)} ${stage}: ${name}; instrument-line=${instrumentLine ?? "unavailable"}`,
        );
        const failureKind =
          stage === "conflicts"
            ? "instrument"
            : stage === "export" &&
                (await readV1ExportProbe(page).catch(() => null))?.failed === true
              ? "product"
              : "instrument";
        await atomicJson(outputPath, { ...run, failedAt: stage, failureKind, errorName: name });
        if (failureKind === "product") return;
        throw new Error(`M-V1 ${v1Key(id)} ${stage}: ${name}`);
      }
    });
});
