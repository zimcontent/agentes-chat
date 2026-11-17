/** Types for doug-icons.js, the DougBot app icons drawn by the identity's drawer (SVG). */

import type { DougBotOlhar } from "./dougbot-avatar.js";

export type IconGround = "day" | "night";
export type IconColor = "green" | "yellow" | "orange" | "pink" | "violet" | "blue" | "cyan" | "white";
export type IconFace =
  | "normal"
  | "happy"
  | "wink"
  | "surprised"
  | "unimpressed"
  | "sad"
  | "angry"
  | "aside"
  | "laugh"
  | "asleep";
export type IconPose = "front" | "peek";

export interface DougIcon {
  ground: IconGround;
  color: IconColor;
  face: IconFace;
  pose: IconPose;
}

export type IconLayer = "whole" | "back" | "front" | "mono" | "tinted" | "favicon";
export type ReadyIconId = "night" | "moon" | "sky" | "peekNight" | "peekSky";

export const SIDE: number;
export const ICON_GROUNDS: IconGround[];
export const ICON_COLORS: IconColor[];
export const ICON_FACES: IconFace[];
export const ICON_POSES: IconPose[];
export const ICON_HEX: Record<IconColor, string>;
export const ICON_LOOKS: Record<IconFace, DougBotOlhar>;
export const SHIPPED_ICON: DougIcon;
export const READY_ICONS: Record<ReadyIconId, { light: DougIcon; dark: DougIcon }>;

export function iconSvg(icon: Partial<DougIcon>, layer?: IconLayer): string;
export function madeIconId(icon: DougIcon): string;
export function madeIcons(): DougIcon[];
