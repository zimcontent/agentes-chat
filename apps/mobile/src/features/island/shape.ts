/** From this top inset an iPhone has the camera's island (14 Pro and later); below it, a notch or nothing. */
export const CAMERA_INSET = 59;

/** The island's shapes: gone, a notice's pill, a waiting request's small island, open with its answer. */
export type IslandShape = "none" | "pill" | "small" | "open";

/** Whether the phone has the camera's island the notices grow out of (an iPhone 14 Pro or later). */
export function hasCameraIsland(os: string, topInset: number): boolean {
  return os === "ios" && topInset >= CAMERA_INSET;
}

/**
 * The island's shape now. A request waiting on me stays as a small island only beside the camera's island, in the
 * status bar's line. A phone without one (a notch, an older iPhone, Android) has no room there: kept up, it sat over
 * the screen's bar, on its back button and title, until the person decided. There it goes once its pill has shown,
 * and the request keeps waiting in Pendentes, with its count.
 */
export function islandShape(input: { lead: boolean; open: boolean; small: boolean; camera: boolean }): IslandShape {
  if (!input.lead) return "none";
  if (input.open) return "open";
  if (input.small) return input.camera ? "small" : "none";
  return "pill";
}
