import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { EntityGroup } from "@anonly/shared";
import type { Page } from "@playwright/test";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import type { E2eFilePayload } from "../e2e/support/fixtures.js";
import type { BrowserCore, BrowserBus } from "../measure/collect.js";

import { installRunCollector, readRun, waitForRunSettled } from "./support/memoryProfile.js";

type Profile = "R1" | "R2";

interface GroupingBrowserCore extends BrowserCore {
  readonly bus: BrowserBus;
  readonly engines: {
    readonly grouping: {
      startSession(documentId: string): void;
      getSnapshot(documentId: string): { readonly groups: ReadonlyArray<EntityGroup> };
    };
  };
}

interface RealRun {
  readonly profile: Profile;
  readonly round: number;
  readonly pdfKiB: number;
  readonly groupingSessionElapsedMs: number | null;
  readonly groupingProcessingMs: number;
  readonly groupingProcessingCalls: number;
  readonly fuzzyEligibleLookupMs: number;
  readonly fuzzyEligibleLookupCalls: number;
  readonly occurrenceCount: number;
  readonly occurrenceValueChars: number;
  readonly occurrenceValueLengthMax: number;
  readonly entityGroups: number;
  readonly aliases: number;
  readonly members: number;
  readonly maxEventLoopGapMs: number;
  readonly groupingFingerprint: string;
  readonly groupingOrderFingerprint: string;
  readonly pipelineFailed: boolean;
}

declare global {
  var __anonlyGroupingRealProbe:
    | {
        readonly profile: Profile;
        readonly round: number;
        documentId: string | null;
        groupingActive: boolean;
        startedAt: number | null;
        groupingFinishedAt: number | null;
        groupingSessionElapsedMs: number | null;
        groupingProcessingMs: number;
        groupingProcessingCalls: number;
        fuzzyEligibleLookupMs: number;
        fuzzyEligibleLookupCalls: number;
        occurrenceCount: number;
        occurrenceValueChars: number;
        occurrenceValueLengthMax: number;
        maxEventLoopGapMs: number;
        lastTickAt: number;
        timer?: ReturnType<typeof setInterval>;
      }
    | undefined;
}

const PROFILE_ENV: Readonly<Record<Profile, string>> = {
  R1: "ANONLY_REAL_DOC_R1",
  R2: "ANONLY_REAL_DOC_R2",
};

function requireSetting(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} no está configurado.`);
  return value;
}

async function installProbe(page: Page, profile: Profile, round: number): Promise<void> {
  await page.evaluate(
    ({ profile: selectedProfile, round: selectedRound }) => {
      function isRecord(value: unknown): value is Record<string, unknown> {
        return value !== null && typeof value === "object";
      }

      function isGroupingCore(value: unknown): value is GroupingBrowserCore {
        if (!isRecord(value) || !isRecord(value.bus) || !isRecord(value.engines)) return false;
        const grouping = value.engines.grouping;
        return (
          typeof value.bus.on === "function" &&
          isRecord(grouping) &&
          typeof grouping.startSession === "function" &&
          typeof grouping.getSnapshot === "function"
        );
      }

      const core = globalThis.__anonlyCore;
      if (!isGroupingCore(core)) throw new Error("El build no expuso el Core de medición.");
      const probe: NonNullable<typeof globalThis.__anonlyGroupingRealProbe> = {
        profile: selectedProfile,
        round: selectedRound,
        documentId: null,
        groupingActive: false,
        startedAt: null,
        groupingFinishedAt: null,
        groupingSessionElapsedMs: null,
        groupingProcessingMs: 0,
        groupingProcessingCalls: 0,
        fuzzyEligibleLookupMs: 0,
        fuzzyEligibleLookupCalls: 0,
        occurrenceCount: 0,
        occurrenceValueChars: 0,
        occurrenceValueLengthMax: 0,
        maxEventLoopGapMs: 0,
        lastTickAt: 0,
      };
      globalThis.__anonlyGroupingRealProbe = probe;

      const grouping = core.engines.grouping;
      const originalProcess = Reflect.get(grouping, "processOccurrence");
      if (typeof originalProcess !== "function")
        throw new Error("No se pudo instrumentar el procesamiento de Grouping.");
      const processWrapped = function (this: unknown, ...args: ReadonlyArray<unknown>): unknown {
        const startedAt = performance.now();
        try {
          return Reflect.apply(originalProcess, this, args);
        } finally {
          probe.groupingProcessingMs += performance.now() - startedAt;
          probe.groupingProcessingCalls += 1;
        }
      };
      if (!Reflect.set(grouping, "processOccurrence", processWrapped))
        throw new Error("No se pudo instalar la sonda de procesamiento.");

      const original = Reflect.get(grouping, "findMatchingGroup");
      if (typeof original !== "function") throw new Error("No se pudo instrumentar Grouping.");
      const fuzzyTypes = new Set<string>(["PERSON", "ORGANIZATION", "ADDRESS"]);
      const wrapped = function (this: unknown, ...args: ReadonlyArray<unknown>): unknown {
        const startedAt = performance.now();
        try {
          return Reflect.apply(original, this, args);
        } finally {
          const occurrence = args[1];
          if (
            occurrence !== null &&
            typeof occurrence === "object" &&
            "entityType" in occurrence &&
            typeof occurrence.entityType === "string" &&
            fuzzyTypes.has(occurrence.entityType)
          ) {
            probe.fuzzyEligibleLookupMs += performance.now() - startedAt;
            probe.fuzzyEligibleLookupCalls += 1;
          }
        }
      };
      if (!Reflect.set(grouping, "findMatchingGroup", wrapped))
        throw new Error("No se pudo instalar la sonda de Grouping.");

      core.bus.on("regex", "ENTITY_FOUND", (payload) => {
        if (
          !isRecord(payload) ||
          typeof payload.documentId !== "string" ||
          !isRecord(payload.occurrence) ||
          typeof payload.occurrence.normalizedValue !== "string" ||
          probe.documentId === null ||
          payload.documentId !== probe.documentId
        )
          return;
        probe.occurrenceCount += 1;
        probe.occurrenceValueChars += payload.occurrence.normalizedValue.length;
        probe.occurrenceValueLengthMax = Math.max(
          probe.occurrenceValueLengthMax,
          payload.occurrence.normalizedValue.length,
        );
      });
      core.bus.on("ner", "ENTITY_FOUND", (payload) => {
        if (
          !isRecord(payload) ||
          typeof payload.documentId !== "string" ||
          !isRecord(payload.occurrence) ||
          typeof payload.occurrence.normalizedValue !== "string" ||
          probe.documentId === null ||
          payload.documentId !== probe.documentId
        )
          return;
        probe.occurrenceCount += 1;
        probe.occurrenceValueChars += payload.occurrence.normalizedValue.length;
        probe.occurrenceValueLengthMax = Math.max(
          probe.occurrenceValueLengthMax,
          payload.occurrence.normalizedValue.length,
        );
      });
      core.bus.on("grouping", "GROUPING_FINISHED", (payload) => {
        if (
          !isRecord(payload) ||
          typeof payload.documentId !== "string" ||
          typeof payload.durationMs !== "number" ||
          probe.documentId === null ||
          payload.documentId !== probe.documentId
        )
          return;
        probe.groupingFinishedAt = performance.now();
        probe.groupingSessionElapsedMs = payload.durationMs;
        probe.groupingActive = false;
      });
      probe.lastTickAt = performance.now();
      probe.timer = setInterval(() => {
        const now = performance.now();
        if (probe.groupingActive)
          probe.maxEventLoopGapMs = Math.max(probe.maxEventLoopGapMs, now - probe.lastTickAt);
        probe.lastTickAt = now;
      }, 10);

      const originalStart = grouping.startSession;
      grouping.startSession = function (id: string): void {
        if (probe.documentId === null) {
          probe.documentId = id;
          probe.startedAt = performance.now();
          probe.groupingActive = true;
          probe.lastTickAt = probe.startedAt;
        }
        originalStart.call(grouping, id);
      };
    },
    { profile, round },
  );
}

async function collectReport(
  page: Page,
  profile: Profile,
  round: number,
  pdfKiB: number,
): Promise<RealRun> {
  return await page.evaluate(
    async ({ profile: selectedProfile, round: selectedRound, pdfKiB: sizeKiB }) => {
      function isRecord(value: unknown): value is Record<string, unknown> {
        return value !== null && typeof value === "object";
      }

      function isGroupingCore(value: unknown): value is GroupingBrowserCore {
        if (!isRecord(value) || !isRecord(value.bus) || !isRecord(value.engines)) return false;
        const grouping = value.engines.grouping;
        return (
          typeof value.bus.on === "function" &&
          isRecord(grouping) &&
          typeof grouping.startSession === "function" &&
          typeof grouping.getSnapshot === "function"
        );
      }

      const core = globalThis.__anonlyCore;
      const probe = globalThis.__anonlyGroupingRealProbe;
      if (!isGroupingCore(core) || probe === undefined || probe.documentId === null)
        throw new Error("Sonda Grouping no disponible.");
      if (probe.timer !== undefined) clearInterval(probe.timer);
      const snapshot = core.engines.grouping.getSnapshot(probe.documentId);
      const signatures = snapshot.groups.map(
        (group) => `${group.type}:${[...group.aliases].sort().join("|")}:${group.members.length}`,
      );
      const ordered = snapshot.groups.map(
        (group) => `${group.type}:${group.indexInType}:${[...group.aliases].sort().join("|")}`,
      );
      const digest = async (parts: ReadonlyArray<string>): Promise<string> => {
        const bytes = new TextEncoder().encode(parts.join("\n"));
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(hash), (value) =>
          value.toString(16).padStart(2, "0"),
        ).join("");
      };
      const run: RealRun = {
        profile: selectedProfile,
        round: selectedRound,
        pdfKiB: sizeKiB,
        groupingSessionElapsedMs: probe.groupingSessionElapsedMs,
        groupingProcessingMs: probe.groupingProcessingMs,
        groupingProcessingCalls: probe.groupingProcessingCalls,
        fuzzyEligibleLookupMs: probe.fuzzyEligibleLookupMs,
        fuzzyEligibleLookupCalls: probe.fuzzyEligibleLookupCalls,
        occurrenceCount: probe.occurrenceCount,
        occurrenceValueChars: probe.occurrenceValueChars,
        occurrenceValueLengthMax: probe.occurrenceValueLengthMax,
        entityGroups: snapshot.groups.length,
        aliases: snapshot.groups.reduce((sum, group) => sum + group.aliases.length, 0),
        members: snapshot.groups.reduce((sum, group) => sum + group.members.length, 0),
        maxEventLoopGapMs: probe.maxEventLoopGapMs,
        groupingFingerprint: await digest(signatures),
        groupingOrderFingerprint: await digest(ordered),
        pipelineFailed: false,
      };
      return run;
    },
    { profile, round, pdfKiB },
  );
}

test("Grouping real document control — numeric aggregates only", async ({ page }) => {
  test.setTimeout(600_000);
  const profile = requireSetting("ANONLY_GROUPING_PROFILE");
  const round = Number(requireSetting("ANONLY_GROUPING_ROUND"));
  const outputDir = resolve(requireSetting("ANONLY_GROUPING_OUTPUT_DIR"));
  if (profile !== "R1" && profile !== "R2") throw new Error("Perfil inválido.");
  if (!Number.isInteger(round) || round < 1 || round > 3) throw new Error("Ronda inválida.");
  const path = requireSetting(PROFILE_ENV[profile]);
  const pdfKiB = Math.round((await stat(path)).size / 1024);
  const file: E2eFilePayload = {
    name: `${profile.toLowerCase()}.pdf`,
    mimeType: "application/pdf",
    buffer: await readFile(path),
  };

  await openApp(page, "networkidle");
  await installProbe(page, profile, round);
  await page.getByRole("button", { name: "Elegir archivo" }).waitFor({ state: "visible" });
  await installRunCollector(page, { captureOcrWords: false });
  await page.locator('input[type="file"]').setInputFiles(file);
  await waitForRunSettled(page, 600_000);
  const run = await readRun(page);
  const report = await collectReport(page, profile, round, pdfKiB);
  const sanitized: RealRun = { ...report, pipelineFailed: run.failedAt !== undefined };
  if (!Number.isFinite(sanitized.groupingSessionElapsedMs))
    throw new Error("No se recibió GROUPING_FINISHED para el documento.");

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    resolve(outputDir, `grouping-real-${profile}-round${round}.json`),
    `${JSON.stringify(sanitized, null, 2)}\n`,
  );
  process.stdout.write(
    `Grouping ${profile} ronda ${round}: ${sanitized.groupingProcessingMs} ms, ${sanitized.entityGroups} grupos.\n`,
  );
  expect(sanitized.pipelineFailed, "pipeline real falló").toBe(false);
  expect(sanitized.occurrenceCount).toBeGreaterThan(0);
  expect(sanitized.groupingFingerprint).toMatch(/^[a-f0-9]{64}$/u);
});
