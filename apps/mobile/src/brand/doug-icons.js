// The DougBot app icons (ADR 0179, DougBot's own icons: docs/adr/doug-0010-doug-app-icons.md), drawn by the identity's
// drawer (dougbot-avatar.js) as SVG: the ready icons, the ones a person makes on their phone and the shipped icon's
// own files all come from here. Pure ESM with no dependency, so the phone draws a picker's preview with it
// (react-native-svg), Bun writes the committed files with it (resvg) and the phone's build plugin, under Node, draws
// the made icons with it.
//
// An icon is a ground, a color, a face and a pose:
// - ground `day`: his black head on a piece of glass of the color (the shipped icon, on green); `night`: his head in
//   glass of the color, lighting a dark stage (the shipped icon's dark look).
// - colors: the brand's green first, then the team's (the identity's other bots), and white.
// - faces: only his eyes change (the drawer's `olhar`).
// - pose `front`: in the middle, as the shipped icon; `peek`: big, leaning in from the bottom right corner.
import DougBot from "./dougbot-avatar.js";

const mix = DougBot.mix;

/** The icon's side: every scene is drawn on this square. */
export const SIDE = 1024;

/** The grounds, the colors, the faces and the poses, in the pickers' order (the first of each is the shipped icon's). */
export const ICON_GROUNDS = ["day", "night"];
export const ICON_COLORS = ["green", "yellow", "orange", "pink", "violet", "blue", "cyan", "white"];
export const ICON_FACES = [
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
];
export const ICON_POSES = ["front", "peek"];

/** Each color's glass: the brand's green, then the team's bots' own colors (Kiara, Mark, Rosa, Chess, Junin, Sony). */
export const ICON_HEX = {
  green: "#9CFA05",
  yellow: "#FACC15",
  orange: "#FB923C",
  pink: "#EC4899",
  violet: "#A78BFA",
  blue: "#60A5FA",
  cyan: "#22D3EE",
  white: "#F4F6F2",
};

/** Each face as the drawer's `olhar`. */
export const ICON_LOOKS = {
  normal: "normal",
  happy: "feliz",
  wink: "piscando",
  surprised: "surpreso",
  unimpressed: "desconfiado",
  sad: "triste",
  angry: "bravo",
  aside: "de-lado",
  laugh: "rindo",
  asleep: "dormindo",
};

/** The shipped icon. */
export const SHIPPED_ICON = { ground: "day", color: "green", face: "normal", pose: "front" };

/** His head's share of the side, and how far above the middle it sits (its shadow takes the room under it). */
const HEAD = 0.824;
const UP = -0.014;
/** On Android's layers the head stays inside the safe circle (61% of the side). */
const ADAPTIVE = { scale: 0.586, dy: -0.006 };
/** Peeking: bigger, its middle low and to the right, turned to the left around it. */
const PEEK = { scale: 1.3, x: 0.64, y: 0.68, degrees: -18 };

const hexOf = (color) => ICON_HEX[color] ?? ICON_HEX.green;

/** A drawing of the Doug's (viewBox 120) as a group: `scale` of the side, its middle at (cx, cy), turned `degrees`. */
function head(side, scale, cx, cy, degrees, opcoes, id) {
  const inner = DougBot.avatar({ bot: "doug", tamanho: 120, perto: false, brilho: false, id, ...opcoes })
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "")
    .replace(/<title>[^<]*<\/title>/, "");
  const k = (side * scale) / 120;
  const turn = degrees ? ` rotate(${degrees})` : "";
  return `<g transform="translate(${r(cx)} ${r(cy)})${turn} scale(${r(k)}) translate(-60 -60)">${inner}</g>`;
}
const r = (v) => Math.round(v * 1000) / 1000;

const blur = (id, px) =>
  `<filter id="${id}" filterUnits="userSpaceOnUse" x="-400" y="-400" width="${SIDE + 800}" height="${SIDE + 800}"><feGaussianBlur stdDeviation="${r(px)}"/></filter>`;

/**
 * The day's ground, edge to edge (the system cuts the corners): a piece of glass of the color grown to the whole
 * square, light from above and the color in depth below. The top stays pale, not white: on a white wallpaper a white
 * top loses the icon's edge. The green is the shipped icon's own stops.
 */
function glass(color) {
  const c = hexOf(color);
  const stops =
    color === "green"
      ? ["#E2FF98", "#CEFF63", c, "#72D400"]
      : color === "white"
        ? ["#FFFFFF", "#F7F8F5", "#E9EBE6", "#CFD3CC"]
        : [mix(c, "#ffffff", 0.58), mix(c, "#ffffff", 0.34), c, mix(c, "#000000", 0.2)];
  const deep = color === "green" ? "#3F8A00" : mix(c, "#000000", color === "white" ? 0.5 : 0.48);
  return `<defs>
<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${SIDE}"><stop offset="0" stop-color="${stops[0]}"/><stop offset=".3" stop-color="${stops[1]}"/><stop offset=".66" stop-color="${stops[2]}"/><stop offset="1" stop-color="${stops[3]}"/></linearGradient>
<radialGradient id="gl" gradientUnits="userSpaceOnUse" cx="512" cy="-60" r="620"><stop offset="0" stop-color="#fff" stop-opacity=".46"/><stop offset=".5" stop-color="#fff" stop-opacity=".15"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<radialGradient id="gd" gradientUnits="userSpaceOnUse" cx="512" cy="1180" r="560"><stop offset="0" stop-color="${deep}" stop-opacity="${color === "white" ? 0.22 : 0.5}"/><stop offset="1" stop-color="${deep}" stop-opacity="0"/></radialGradient>
</defs><rect width="${SIDE}" height="${SIDE}" fill="url(#g)"/><rect width="${SIDE}" height="${SIDE}" fill="url(#gl)"/><rect width="${SIDE}" height="${SIDE}" fill="url(#gd)"/>`;
}

/** The night's stage, and the light a head of `light` gives it (around where the head is). */
function stage(light, at = [512, 540]) {
  return `<defs>
<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${SIDE}"><stop offset="0" stop-color="#2A2D31"/><stop offset=".45" stop-color="#16171A"/><stop offset="1" stop-color="#08080A"/></linearGradient>
<radialGradient id="gl" gradientUnits="userSpaceOnUse" cx="${r(at[0])}" cy="${r(at[1])}" r="560"><stop offset="0" stop-color="${light}" stop-opacity=".2"/><stop offset=".5" stop-color="${light}" stop-opacity=".07"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient>
</defs><rect width="${SIDE}" height="${SIDE}" fill="url(#g)"/><rect width="${SIDE}" height="${SIDE}" fill="url(#gl)"/>`;
}

/** Where the head is and how big, for a pose and a frame (`adaptive`: Android's layers). */
function placeOf(pose, frame) {
  if (pose === "peek") return { scale: PEEK.scale, cx: SIDE * PEEK.x, cy: SIDE * PEEK.y, degrees: PEEK.degrees };
  const { scale, dy } = frame === "adaptive" ? ADAPTIVE : { scale: HEAD, dy: UP };
  return { scale, cx: SIDE / 2, cy: SIDE * (0.5 + dy), degrees: 0, dy };
}

/**
 * The head and what it does to the ground: on the day's glass, black with the shadows it casts; on the night's stage,
 * in glass of the color with the light it gives. `light` is the night's light (grey for the tinted look).
 */
function figure(icon, frame, light) {
  const c = light ?? hexOf(icon.color);
  const olhar = ICON_LOOKS[icon.face] ?? "normal";
  const p = placeOf(icon.pose, frame);
  const s = p.scale / HEAD;
  const at = (dy, scale = p.scale) => [p.cx, p.cy + dy * SIDE * (scale / HEAD)];
  const peek = icon.pose === "peek";
  if (icon.ground === "night") {
    // Lit from behind: its color around it, and on the floor under it (not when it leans in from the corner).
    const floor = p.cy + SIDE * p.scale * 0.472;
    return (
      `<defs>${blur("s1", 83 * s)}${blur("s2", 41 * s)}</defs>` +
      `<g opacity=".4" filter="url(#s1)">${head(SIDE, p.scale, p.cx, p.cy, p.degrees, { peca: false, material: "chapado", cor: c, estado: "dormindo" }, "hs")}</g>` +
      (peek
        ? ""
        : `<ellipse cx="${r(p.cx)}" cy="${r(floor)}" rx="${r(SIDE * p.scale * 0.246)}" ry="${r(SIDE * p.scale * 0.028)}" fill="${c}" opacity=".34" filter="url(#s2)"/>`) +
      head(SIDE, p.scale, p.cx, p.cy, p.degrees, { peca: false, cor: c, olhar }, "h")
    );
  }
  // By day: a wide soft shadow of its shape, and a closer one on the glass under it.
  const shade =
    icon.color === "white" ? "#3A3D38" : icon.color === "green" ? "#2C4601" : mix(hexOf(icon.color), "#000000", 0.72);
  const floor = p.cy + SIDE * p.scale * 0.455;
  const [sx, sy] = at(0.049);
  return (
    `<defs>${blur("s1", 41 * s)}${blur("s2", 23 * s)}</defs>` +
    `<g opacity="${icon.color === "white" ? 0.14 : 0.17}" filter="url(#s1)">${head(SIDE, p.scale, sx, sy, p.degrees, { peca: false, material: "chapado", cor: shade, estado: "dormindo" }, "hs")}</g>` +
    (peek
      ? ""
      : `<ellipse cx="${r(p.cx)}" cy="${r(floor)}" rx="${r(SIDE * p.scale * 0.276)}" ry="${r(SIDE * p.scale * 0.036)}" fill="${shade}" opacity=".5" filter="url(#s2)"/>`) +
    head(SIDE, p.scale, p.cx, p.cy, p.degrees, { peca: false, material: "preto", cor: hexOf(icon.color), olhar }, "h")
  );
}

/** The ground alone. */
function ground(icon, light) {
  if (icon.ground !== "night") return glass(icon.color);
  const p = placeOf(icon.pose, "icon");
  return stage(light ?? hexOf(icon.color), [p.cx, p.cy + 42]);
}

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIDE}" height="${SIDE}" viewBox="0 0 ${SIDE} ${SIDE}">${body}</svg>`;

/** A leaning head on Android's layers: the icon's square fills the middle two thirds the launcher shows. */
const inAdaptive = (body) => `<g transform="translate(${r(SIDE / 6)} ${r(SIDE / 6)}) scale(${r(2 / 3)})">${body}</g>`;

/**
 * An icon's picture, as SVG on a 1024 square:
 * - `whole`: the icon as iOS and the pickers show it (opaque, square: the system rounds it);
 * - `back`, `front`, `mono`: Android's adaptive layers (the ground; the head and its shadows or light; the head in
 *   one color with its eyes cut out, which a themed home screen tints);
 * - `tinted`: the night's picture lit in grey, which a tinted iOS home screen colors (write it in greys);
 * - `favicon`: his head alone, close and upright on its ground, in a rounded square (a browser tab).
 */
export function iconSvg(icon, layer = "whole") {
  const i = { ...SHIPPED_ICON, ...icon };
  const peek = i.pose === "peek";
  if (layer === "back") return svg(ground(i));
  if (layer === "front") return svg(peek ? inAdaptive(figure(i, "icon")) : figure(i, "adaptive"));
  if (layer === "mono") {
    const p = placeOf(i.pose, peek ? "icon" : "adaptive");
    const drawing = head(
      SIDE,
      p.scale,
      p.cx,
      p.cy,
      p.degrees,
      { peca: false, material: "chapado", cor: "#fff", olhar: ICON_LOOKS[i.face] },
      "m",
    );
    return svg(peek ? inAdaptive(drawing) : drawing);
  }
  if (layer === "tinted") {
    const n = { ...i, ground: "night" };
    return svg(ground(n, "#D8D8D8") + figure(n, "icon", "#D8D8D8"));
  }
  if (layer === "favicon") {
    // A browser tab's 16 and 32 px: his head alone, upright and close (a lean or a shadow there is a blur), on its
    // ground in a rounded square.
    const night = i.ground === "night";
    const drawing = head(
      SIDE,
      1.06,
      SIDE / 2,
      SIDE * 0.49,
      0,
      night
        ? { peca: false, cor: hexOf(i.color), olhar: ICON_LOOKS[i.face] }
        : { peca: false, material: "preto", cor: hexOf(i.color), olhar: ICON_LOOKS[i.face] },
      "f",
    );
    const plate = `<clipPath id="fp"><rect width="${SIDE}" height="${SIDE}" rx="${SIDE * 0.22}"/></clipPath>`;
    return svg(
      `<defs>${plate}</defs><g clip-path="url(#fp)">${night ? stage(hexOf(i.color)) : glass(i.color)}${drawing}</g>`,
    );
  }
  return svg(ground(i) + figure(i, "icon"));
}

/** A made icon's id, as the build names its files: `made-night-pink-wink`, and `…-peek` leaning. */
export const madeIconId = (icon) =>
  `made-${icon.ground}-${icon.color}-${icon.face}${icon.pose === "peek" ? "-peek" : ""}`;

/** Every icon a person can make, in the lists' order: the facing ones, then the leaning ones. */
export const madeIcons = () =>
  ICON_POSES.flatMap((pose) =>
    ICON_GROUNDS.flatMap((ground) =>
      ICON_COLORS.flatMap((color) => ICON_FACES.map((face) => ({ ground, color, face, pose }))),
    ),
  );

/**
 * The ready icons (the ids every app lists, ADR 0179), each in iOS's light and dark looks: the first is the shipped
 * icon, his black head on the green glass, and by night his head in green glass on the stage.
 */
export const READY_ICONS = {
  night: { light: SHIPPED_ICON, dark: { ...SHIPPED_ICON, ground: "night" } },
  moon: {
    light: { ...SHIPPED_ICON, ground: "night", face: "asleep" },
    dark: { ...SHIPPED_ICON, ground: "night", face: "asleep" },
  },
  sky: { light: { ...SHIPPED_ICON, color: "white" }, dark: { ...SHIPPED_ICON, ground: "night", color: "white" } },
  peekNight: { light: { ...SHIPPED_ICON, pose: "peek" }, dark: { ...SHIPPED_ICON, ground: "night", pose: "peek" } },
  peekSky: {
    light: { ...SHIPPED_ICON, ground: "night", face: "wink", pose: "peek" },
    dark: { ...SHIPPED_ICON, ground: "night", face: "wink", pose: "peek" },
  },
};
