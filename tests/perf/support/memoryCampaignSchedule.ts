export type MemoryCampaignProfile =
  | { readonly count: 1; readonly distribution: "one-per-page" }
  | { readonly count: 10; readonly distribution: "one-per-page" }
  | { readonly count: 50; readonly distribution: "one-per-page" }
  | { readonly count: 50; readonly distribution: "many-same-page" };

export type MemoryCampaignRun = MemoryCampaignProfile & {
  readonly round: 1 | 2 | 3;
  /** Zero-based order within its round. */
  readonly orderIndex: 0 | 1 | 2 | 3;
};

const PROFILES: ReadonlyArray<MemoryCampaignProfile> = [
  { count: 1, distribution: "one-per-page" },
  { count: 10, distribution: "one-per-page" },
  { count: 50, distribution: "one-per-page" },
  { count: 50, distribution: "many-same-page" },
];

/** Three rounds that alternate all four distinct workload profiles. */
export function buildMemoryCampaignSchedule(): ReadonlyArray<MemoryCampaignRun> {
  const runs: MemoryCampaignRun[] = [];
  for (const round of [1, 2, 3] as const) {
    const rotation = round - 1;
    for (const orderIndex of [0, 1, 2, 3] as const) {
      const profile = PROFILES[(orderIndex + rotation) % PROFILES.length];
      if (profile === undefined) throw new Error("Perfil ausente del scheduler de memoria.");
      runs.push({ ...profile, round, orderIndex });
    }
  }
  return runs;
}
