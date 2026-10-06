import { describe, expect, it } from "vitest";

import { buildMemoryCampaignSchedule } from "./memoryCampaignSchedule.js";

function profileKey(profile: { readonly count: number; readonly distribution: string }): string {
  return `${profile.count}:${profile.distribution}`;
}

describe("memory campaign schedule", () => {
  it("interleaves four unique profiles over three rounds with coherent ranks", () => {
    const schedule = buildMemoryCampaignSchedule();
    expect(schedule).toHaveLength(12);
    expect(new Set(schedule.map(profileKey))).toEqual(
      new Set(["1:one-per-page", "10:one-per-page", "50:one-per-page", "50:many-same-page"]),
    );
    expect(
      [1, 2, 3].map((round) =>
        schedule.filter((run) => run.round === round).map((run) => profileKey(run)),
      ),
    ).toEqual([
      ["1:one-per-page", "10:one-per-page", "50:one-per-page", "50:many-same-page"],
      ["10:one-per-page", "50:one-per-page", "50:many-same-page", "1:one-per-page"],
      ["50:one-per-page", "50:many-same-page", "1:one-per-page", "10:one-per-page"],
    ]);
    for (const round of [1, 2, 3] as const) {
      expect(schedule.filter((run) => run.round === round).map((run) => run.orderIndex)).toEqual([
        0, 1, 2, 3,
      ]);
    }
  });
});
