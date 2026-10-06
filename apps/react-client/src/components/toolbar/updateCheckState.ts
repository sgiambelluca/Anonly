import type { UpdateEvent } from "../../updater/index.js";

export type ManualUpdateCheckState = "idle" | "checking" | "up-to-date" | "unavailable";

export function transitionManualUpdateCheck(
  state: ManualUpdateCheckState,
  event: UpdateEvent,
): ManualUpdateCheckState {
  switch (event.type) {
    case "check-unavailable":
      return state === "checking" ? "unavailable" : state;
    case "update-not-available":
      return state === "checking" ? "up-to-date" : state;
    case "update-available":
    case "update-downloaded":
    case "error":
      return "idle";
    default:
      return state;
  }
}
