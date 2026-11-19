import { type AgentAppearance, botDoAgente, DougBot } from "@dougbot/ui";

/**
 * A workspace's agent as the app icon (ADR 0179, redrawn for DougBot in doug-0010): the agent's own DougBot (the
 * identity's bot for its name, or its free bot), drawn by the identity's code on the brand's black stage, as the
 * Doug's own icons are. No pixel art. The desktop app can't draw: it is sent the Dock's and the windows' pictures.
 */
export interface AgentIcon {
  orgId: string;
  id: string;
  name: string;
  look: AgentAppearance;
}

/** The brand's stage (`--db-palco`) and a touch of light at the top, as the Doug's night icons. */
const STAGE = "#0A0A0A";
const STAGE_TOP = "#1A1A1A";

function canvas(px: number) {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  return c;
}

/** The agent's bot as SVG text, `px` wide (no title: an icon has no words). */
function botSvg(look: AgentAppearance, name: string | undefined, px: number) {
  const bot = botDoAgente({ name: name ?? "", look: look.shape ? look : null });
  return DougBot.avatar({ ...bot, estado: "ok", tamanho: px, brilho: false, id: `icon${px}` }).replace(
    /<title>[^<]*<\/title>/,
    "",
  );
}

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** The icon's square scene at `px`: the stage, then the bot, 80% of the side, centered. */
async function scene(px: number, look: AgentAppearance, name?: string) {
  const c = canvas(px);
  const g = c.getContext("2d");
  if (!g) return c;
  const ground = g.createLinearGradient(0, 0, 0, px);
  ground.addColorStop(0, STAGE_TOP);
  ground.addColorStop(1, STAGE);
  g.fillStyle = ground;
  g.fillRect(0, 0, px, px);
  const side = Math.round(px * 0.8);
  const img = await loadImage(svgUrl(botSvg(look, name, side)));
  if (img) g.drawImage(img, (px - side) / 2, (px - side) / 2, side, side);
  return c;
}

/** The picker's and the row's picture (a square; CSS rounds it like the others). */
export async function agentIconPicture(look: AgentAppearance, px = 160, name?: string) {
  return (await scene(px, look, name)).toDataURL("image/png");
}

/** The tab's icon: the agent's bot as SVG on the brand's black tile (a vector favicon, sharp at any size). */
export function agentFavicon(look: AgentAppearance, N: 16 | 32 = 32, name?: string) {
  const bot = botSvg(look, name, 26);
  const inner = encodeURIComponent(bot);
  const tile = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${N}" height="${N}" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${STAGE}"/><image x="3" y="3" width="26" height="26" href="data:image/svg+xml;charset=utf-8,${inner}"/></svg>`;
  return svgUrl(tile);
}

/** macOS's shape on Apple's grid (as the generator's `macLayers`): a superellipse of 824 at 100, a soft shadow under. */
function squircle(g: CanvasRenderingContext2D, px: number) {
  const u = px / 1024;
  const a = 412 * u;
  const c = 512 * u;
  g.beginPath();
  for (let i = 0; i <= 360; i++) {
    const t = (i / 360) * Math.PI * 2;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const x = c + a * Math.sign(cos) * Math.abs(cos) ** (2 / 5);
    const y = c + a * Math.sign(sin) * Math.abs(sin) ** (2 / 5);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

const base64Of = (c: HTMLCanvasElement) => c.toDataURL("image/png").slice("data:image/png;base64,".length);

/** The pictures the desktop app keeps for an agent: the Dock's (512, macOS's shape) and the windows' (256, rounded). */
export async function agentDesktopPictures(look: AgentAppearance, name?: string) {
  const art = await scene(1024, look, name);
  const dock = canvas(512);
  const d = dock.getContext("2d");
  if (d) {
    const u = 512 / 1024;
    d.save();
    squircle(d, 512);
    d.shadowColor = "rgba(0, 0, 0, 0.3)";
    d.shadowBlur = 26 * u;
    d.shadowOffsetY = 10 * u;
    d.fillStyle = STAGE;
    d.fill();
    d.restore();
    squircle(d, 512);
    d.clip();
    d.drawImage(art, 100 * u, 100 * u, 824 * u, 824 * u);
  }
  const window = canvas(256);
  const w = window.getContext("2d");
  if (w) {
    w.beginPath();
    w.roundRect(0, 0, 256, 256, 256 * 0.22);
    w.clip();
    w.drawImage(art, 0, 0, 256, 256);
  }
  return { dock: base64Of(dock), window: base64Of(window) };
}

/** Whether two looks draw the same agent (a name or look changed on the server redraws the icon). */
export const sameAgent = (a: AgentIcon, b: AgentIcon) =>
  a.name === b.name &&
  (a.look.color ?? "") === (b.look.color ?? "") &&
  (a.look.eyes ?? "") === (b.look.eyes ?? "") &&
  (a.look.accessory ?? "") === (b.look.accessory ?? "") &&
  (a.look.shape ?? "") === (b.look.shape ?? "");
