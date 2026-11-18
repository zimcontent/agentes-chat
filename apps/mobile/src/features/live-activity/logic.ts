/**
 * Live Activities (docs/adr/doug-0021-lock-screen.md), the pure part: when a sent message starts one, and what the app
 * hands the native module. The server decides the rest (the run, its words, its updates and its end).
 */

/** A message sent to an agent starts one when an agent will work on it: not one steered into work already going
 * (it has its own), nor a GIF or a sticker alone (no agent answers it). */
export function startsLiveActivity(input: {
  os: string;
  toAgent: boolean;
  steered: boolean;
  mediaAlone: boolean;
}): boolean {
  return input.os === "ios" && input.toAgent && !input.steered && !input.mediaAlone;
}

/** The agent's color as the widget reads it: `#rrggbb`, else the identity's green. */
export function liveColor(color: string | null | undefined): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#9cfa05";
}
