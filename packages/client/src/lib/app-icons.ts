/**
 * The app icons a person can pick on their device (ADR 0179), in the pickers' order: the first is the icon the apps
 * ship with. DougBot draws them all from the Doug (apps/mobile/src/brand/doug-icons.js `READY_ICONS`, files written by
 * `bun apps/mobile/scripts/app-icons.ts`; docs/adr/doug-0010-doug-app-icons.md): the ids are upstream's, so the
 * phone's native side and the desktop app list the same ids, and a test keeps them equal.
 */
export const APP_ICONS = ["night", "moon", "sky", "peekNight", "peekSky"] as const;

export type AppIconId = (typeof APP_ICONS)[number];

/** The icon the apps ship with. */
export const DEFAULT_APP_ICON: AppIconId = APP_ICONS[0];

export const isAppIcon = (value: unknown): value is AppIconId =>
  typeof value === "string" && (APP_ICONS as readonly string[]).includes(value);

/** The icon's name in the pickers (`appIcon.names.*`). */
export const appIconNameKey = (id: AppIconId) => `appIcon.names.${id}` as const;

/**
 * The icons a person makes on their phone (ADR 0179; DougBot's own, docs/adr/doug-0010-doug-app-icons.md): the Doug
 * on a ground (`day`: his black head on a piece of glass of the color; `night`: his head in glass of the color on a
 * dark stage), in one of the identity's colors (the brand's green, the team's bots' colors and white), with one of
 * his faces (only his eyes change), facing or leaning in from the corner. A phone takes only icons its build
 * carries, so every combination is drawn when the app is built (320). The drawing
 * (apps/mobile/src/brand/doug-icons.js) and the phone's plugin list the same parts, and tests keep them equal.
 */
export const MADE_ICON_GROUNDS = ["day", "night"] as const;
export type MadeIconGround = (typeof MADE_ICON_GROUNDS)[number];
export const MADE_ICON_COLORS = ["green", "yellow", "orange", "pink", "violet", "blue", "cyan", "white"] as const;
export type MadeIconColor = (typeof MADE_ICON_COLORS)[number];
export const MADE_ICON_FACES = [
  "normal",
  "happy",
  "wink",
  "surprised",
  "unimpressed",
  "sad",
  "angry",
  "aside",
  "laugh",
  "asleep",
] as const;
export type MadeIconFace = (typeof MADE_ICON_FACES)[number];
/** Facing, as the shipped icon, or big and leaning in from the bottom right corner. */
export const MADE_ICON_POSES = ["front", "peek"] as const;
export type MadeIconPose = (typeof MADE_ICON_POSES)[number];

export interface MadeIcon {
  ground: MadeIconGround;
  color: MadeIconColor;
  face: MadeIconFace;
  pose: MadeIconPose;
}

/** The made icon a new pick starts from: the shipped icon's ground, color, face and pose. */
export const DEFAULT_MADE_ICON: MadeIcon = { ground: "day", color: "green", face: "normal", pose: "front" };

const within = <T extends string>(list: readonly T[], value: string | undefined): T | undefined =>
  (list as readonly string[]).includes(value ?? "") ? (value as T) : undefined;

/** Its id, as the build names its files: `made-night-pink-wink`, and `made-night-pink-wink-peek` leaning. */
export const madeIconId = (icon: MadeIcon) =>
  `made-${icon.ground}-${icon.color}-${icon.face}${icon.pose === "peek" ? "-peek" : ""}`;

/** The made icon an id stands for (null for anything else). */
export function madeIconOf(id: string): MadeIcon | null {
  const [made, rawGround, rawColor, rawFace, ...rest] = id.split("-");
  const ground = within(MADE_ICON_GROUNDS, rawGround);
  const color = within(MADE_ICON_COLORS, rawColor);
  const face = within(MADE_ICON_FACES, rawFace);
  const pose = rest.length === 0 ? "front" : rest.length === 1 && rest[0] === "peek" ? "peek" : undefined;
  if (made !== "made" || !ground || !color || !face || !pose) return null;
  return { ground, color, face, pose };
}

/** Every made icon, in the lists' order: the facing ones, then the leaning ones. */
export const madeIcons = (): MadeIcon[] =>
  MADE_ICON_POSES.flatMap((pose) =>
    MADE_ICON_GROUNDS.flatMap((ground) =>
      MADE_ICON_COLORS.flatMap((color) => MADE_ICON_FACES.map((face) => ({ ground, color, face, pose }))),
    ),
  );
