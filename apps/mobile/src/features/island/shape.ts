/**
 * Where the island lives at the top of the screen, and the box of DougBot's signature resting there (pure: the
 * numbers `NoticeIsland` draws and the board shows).
 */

/** The camera's island on iPhones that have one: the island grows out of it and folds back into it. */
export const CAMERA = { width: 126, height: 37, top: 11 };
/** From this top inset an iPhone has the camera's island (14 Pro and later). */
export const CAMERA_INSET = 59;
/** From this top inset, below the camera's, an iPhone has the notch (X to 14). */
export const NOTCH_INSET = 44;
/** The status bar's room under the notch: the notch reaches the top inset less this. */
const NOTCH_GAP = 14;

/**
 * The top of the screen: the camera's island, the notch the island hangs from, or neither (older iPhones, Android),
 * where it drops from under the status bar.
 */
export type TopKind = "camera" | "notch" | "plain";

export function topKindOf(os: string, insetTop: number): TopKind {
  if (os !== "ios") return "plain";
  if (insetTop >= CAMERA_INSET) return "camera";
  if (insetTop >= NOTCH_INSET) return "notch";
  return "plain";
}

/** How far down the notch reaches. */
export const notchHeight = (insetTop: number) => Math.max(insetTop - NOTCH_GAP, 0);

/** The signature's row under the camera or the notch: its Doug (21) with 4 above and 7 below. */
export const BRAND_ROW = 32;
/** Around the camera, the glass shows this much: the camera sits in it as a face in a round pill, 6 from its edges. */
export const BRAND_RING = 6;
/** The signature's box wide enough for the name and the Doug, 16 clear of both sides. */
const BRAND_WIDTH = 138;

export interface IslandBox {
  top: number;
  w: number;
  h: number;
  /** The bottom corners (and the top ones where nothing holds it to the screen's edge). */
  corner: number;
  /** Room on top for the camera or the notch, above the content. */
  clear: number;
}

/**
 * DougBot's signature at rest: glass grown out of the camera's island (wrapping it, the name under it), hanging from
 * the notch (its top flush with the screen's edge), or a small glass pill centered in the bar (`barHeight`).
 */
export function brandBox(kind: TopKind, insetTop: number, barHeight = 44): IslandBox {
  if (kind === "camera") {
    const clear = BRAND_RING + CAMERA.height;
    return {
      top: CAMERA.top - BRAND_RING,
      w: BRAND_WIDTH,
      h: clear + BRAND_ROW,
      // Concentric with the camera's own round end.
      corner: CAMERA.height / 2 + BRAND_RING,
      clear,
    };
  }
  if (kind === "notch") {
    const clear = notchHeight(insetTop);
    return { top: 0, w: BRAND_WIDTH, h: clear + BRAND_ROW, corner: 16, clear };
  }
  // Centered in the bar under the status bar (44 on an iPhone, 56 on Android).
  return {
    top: insetTop + (barHeight - BRAND_ROW) / 2,
    w: BRAND_WIDTH - 16,
    h: BRAND_ROW,
    corner: BRAND_ROW / 2,
    clear: 0,
  };
}

/** Where a notice's island starts: out of the camera, from the screen's edge under the notch, or under the bar. */
export function noticeTop(kind: TopKind, insetTop: number) {
  return kind === "camera" ? CAMERA.top : kind === "notch" ? 0 : insetTop + 6;
}

/** The room a notice keeps on top for what it grew out of. */
export function noticeClear(kind: TopKind, insetTop: number) {
  return kind === "camera" ? CAMERA.height : kind === "notch" ? notchHeight(insetTop) : 0;
}
