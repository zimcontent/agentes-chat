import type { InlinePart } from "@dougbot/adapters";
import type { AppLocale } from "@dougbot/i18n/locale";
import {
  botDoAgente,
  CORES_LIVRES,
  DougBot,
  type DougBotOpcoes,
  FORMAS_LIVRES,
  OLHOS_LIVRES,
} from "@dougbot/ui/brand/dougbot-time";
import { initialsOf } from "@dougbot/ui/names";

/** The recipient's language: every language of the app (`@dougbot/i18n/locale`). */
export type EmailLocale = AppLocale;

/**
 * Plain text; `{ b }` is bold. `{ mail }` is an address as a mailto link: already a link, no client links it on its
 * own, so it needs none of the hair spaces that break copying typed text (`inertText`). `{ nobr }` stays on one line,
 * moving to the next one whole (a host would break at its hyphens), and breaks inside only when it is longer than a
 * line, so it never widens the email. The layout escapes every string, so the words never hold HTML.
 */
export type Inline = string | { b: string } | { mail: string } | { nobr: string };
export type Text = Inline | Inline[];
export type Block =
  | { p: Text }
  | { small: Text }
  /** A section title inside the card: a heading, so screen readers can jump to it. */
  | { h2: string }
  | { steps: [title: string, text: string][] }
  | { facts: [label: string, value: Text][] }
  | { note: Text; tone?: "warn" }
  /** A name with a line under it. `agent`: who the agent is (its bot); none: a person's initials tile. */
  | { people: { name: string; detail: Text; agent?: Look }[] }
  /** The primary button, and an optional second action as a link beside it. */
  | { button: string; url: string; also?: { label: string; url: string; danger?: boolean } }
  /** For emails whose link is the point: the address to copy when the button doesn't work. */
  | { fallback: string; url: string }
  /** A one-time code to type: large in a well, selectable as one word. */
  | { code: string };

/**
 * Who an agent is, for its bot: what the app draws it from (`botDoAgente` in packages/ui/src/brand/dougbot-time.ts),
 * so an email shows the bot the app shows. `color`, `eyes` and `accessory` are the look an email queued before the
 * bots kept: none is drawn, and its colour only tells such agents apart.
 */
export interface Look {
  name?: string;
  handle?: string | null;
  role?: string | null;
  /** `right_hand`: the team's right hand (ADR 0137), the Doug whatever its name. */
  builtin?: string | null;
  color?: string;
  eyes?: string;
  accessory?: string;
}

/**
 * A picture at the card's top: the workspace's bots in a row over the headline. `computer` (the workspace's computer,
 * our words) is kept for the emails about it, which show the same row: the identity draws no computer. The words never
 * depend on the picture, so the bots have no alt text.
 */
export interface Scene {
  crew: readonly Look[];
  computer?: string;
}

export interface EmailDoc {
  lang: EmailLocale;
  subject: string;
  /** The line an inbox shows after the subject: our words only. */
  preheader: string;
  headline: string;
  scene?: Scene;
  blocks: Block[];
  /** Why this address got it, how often, who sent it. */
  footer: Text[];
}

/**
 * Where an email's pictures come from: this server's `/email/` (`base`), or attached to each message
 * (`base` null, `files` read from the web app's `email/` folder), for a server people outside can't reach.
 */
export interface EmailArt {
  /** The server's own address: the logo links there. */
  home: string;
  /** `{PUBLIC_URL}/email/`, or null when the pictures are attached. */
  base: string | null;
  /** The pictures to attach, by file name (attached mode). */
  files: Map<string, Uint8Array> | null;
}

/**
 * The pictures' version, in their file names: a changed drawing gets a new name, since Gmail's image proxy caches by
 * name and the emails already sent keep theirs. The Doug's pictures have a version of their own: his drawing changed
 * (a bot's head where his portrait was) while the other bots' did not.
 */
const ART = "1";
const DOUG_ART = "2";
/** A bot as an email shows it, in px: beside a name, and in the row over a headline. Its file is twice the larger. */
export const BOT_SHOWN = { row: 32, scene: 44 } as const;
/**
 * Every bot an email may show (`apps/mobile/scripts/email-art.ts` draws their files): the identity's team, and each
 * free bot by form, colour and eyes, which is all `botDoAgente` ever answers.
 */
export const EMAIL_BOTS: readonly DougBotOpcoes[] = [
  ...DougBot.ORDEM.map((bot) => ({ bot })),
  ...FORMAS_LIVRES.flatMap((forma) =>
    CORES_LIVRES.flatMap((cor) => OLHOS_LIVRES.map((olhos) => ({ forma, cor, olhos, sorriso: false }))),
  ),
];
export const botFile = (b: DougBotOpcoes) =>
  b.bot
    ? `bot-${b.bot}-${b.bot === "doug" ? DOUG_ART : ART}.png`
    : `bot-${b.forma}-${CORES_LIVRES.indexOf(b.cor as (typeof CORES_LIVRES)[number])}-${b.olhos}-${ART}.png`;
/** An agent's bot: the app's own answer for who it is. */
const botOf = (look: Look) =>
  botFile(
    botDoAgente({
      // An email queued before the bots has no name: its colour keeps two such agents apart.
      name: look.name ?? look.color ?? "",
      handle: look.handle,
      role: look.role,
      builtin: look.builtin,
    }),
  );
/** The team a picture shows when the workspace has no agents yet: the identity's first four, the Doug first. */
export const ONBOARDING_CREW: readonly Look[] = DougBot.ORDEM.slice(0, 4).map((name) => ({ name }));
/**
 * The signature (the Doug close up and the name) in ink on a rounded tile of the page's colour: unseen on our light
 * page, and the name still reads where a client darkens the page but not the picture (the Gmail apps, Gmail with other
 * accounts, classic Outlook), or inverts the picture too. In bone for our own dark design.
 */
export const LOGO_INK = `doug-logo-ink-${DOUG_ART}.png`;
export const LOGO_BONE = `doug-logo-bone-${DOUG_ART}.png`;
/** The Doug alone: the picture of a browser notification (`apps/web/public/sw.js`). */
export const MARK = `doug-mark-${DOUG_ART}.png`;
/** Every picture an email may show, as the web app serves them (`apps/web/public/email/`). */
export const EMAIL_PICTURES = [LOGO_INK, LOGO_BONE, ...EMAIL_BOTS.map(botFile)];
/** The app's faces, from this server's own `/email/`: Inter for the words, Manrope for the headline. */
const FONTS = [
  ["Inter", "inter-latin.woff2", "100 900"],
  ["Manrope", "manrope-latin.woff2", "200 800"],
] as const;
/** The signature as shown, in px: `name` is the name's size, which the Doug and the space between follow. */
export const LOGO = { width: 144, height: 36, name: 24, alt: "DougBot" } as const;

/**
 * The identity's colours (`packages/ui/src/styles/dougbot-tokens.css`), as the app's kit reads them
 * (`packages/ui/src/styles/doug.css`): the light stage and the dark one. Solid colours only: classic Outlook has no
 * rgba. The green is the Doug's and the main action's alone, the same in both.
 */
const L = {
  page: "#f4f6f2",
  card: "#ffffff",
  border: "#dde0d8",
  well: "#eef0eb",
  wellHair: "#dde0d8",
  ink: "#0a0a0a",
  text: "#0a0a0a",
  muted: "#565a52",
  faint: "#62665e",
  action: "#9cfa05",
  /** The main button's three greens, top to bottom (`--db-verde-botao`). */
  actionTop: "#c5ff52",
  actionEnd: "#84e407",
  onAction: "#0a0a0a",
  warnSoft: "#f6ecd2",
  warn: "#8a5a00",
  danger: "#c4282e",
};
const D: typeof L = {
  page: "#0a0a0a",
  card: "#121212",
  border: "#262626",
  well: "#1a1a1a",
  wellHair: "#262626",
  ink: "#ededed",
  text: "#ededed",
  muted: "#999999",
  faint: "#8a8a8a",
  action: "#9cfa05",
  actionTop: "#c5ff52",
  actionEnd: "#84e407",
  onAction: "#0a0a0a",
  warnSoft: "#2e2410",
  warn: "#f5b544",
  danger: "#f2555a",
};
/** The page's colour, for the tile under the ink signature. */
export const LOGO_PAGE = L.page;

/** Japanese, Chinese and Korean fall back to each system's own fonts before the generic one. */
const SANS =
  "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,'Hiragino Sans','PingFang SC','Microsoft YaHei','Apple SD Gothic Neo','Malgun Gothic',sans-serif";

/** The headline's face: the identity's titles are Manrope. */
const TITLE = `'Manrope',${SANS}`;

/**
 * The bottom margin of the card's last block, by what its lowest ink is: the room under that ink then matches the
 * room over the headline's, which is the card's padding plus the 4 px of the headline's line above its ink. A line
 * of text keeps about 2 px of its line under its descenders or its link's underline, and the button's shadow shows
 * about 2 px under it in light and none on the dark card (`.end-btn`). Whole pixels: the card's cell rounds its
 * height up, so half a pixel would count as one.
 */
const END = { text: 2, box: 4, button: 6 };

/**
 * The dark design, by class. The media query reaches Apple Mail, the Outlook apps, Samsung and Thunderbird;
 * the same rules under `[data-ogsc]`/`[data-ogsb]` reach Outlook.com and new Outlook, which stamp what
 * they recolour. No rule uses #ffffff: Apple Mail ignores it in dark rules. The Gmail apps read no media query: with a
 * Google account they keep the light design, with any other they darken it themselves, so nothing in it may depend on
 * a colour they leave alone (`EMAIL_DARK_HEAD`).
 */
const DARK = [
  `.bg{background:${D.page}!important}`,
  `.card{background:${D.card}!important;border-color:${D.border}!important}`,
  `.ink{color:${D.ink}!important}`,
  `.tx{color:${D.text}!important}`,
  `.mu{color:${D.muted}!important}`,
  `.fa{color:${D.faint}!important}`,
  `.well{background:${D.well}!important}`,
  `.wh{border-color:${D.wellHair}!important}`,
  `.num{background:${D.card}!important;border-color:${D.border}!important;color:${D.muted}!important}`,
  `.btn{background:${D.action}!important;color:${D.onAction}!important;border-color:${D.action}!important}`,
  `.btn span{color:${D.onAction}!important}`,
  `.ln{color:${D.ink}!important;text-decoration-color:${D.border}!important}`,
  `.avp{background:${D.well}!important;color:${D.text}!important;border-color:${D.border}!important}`,
  `.warn{background:${D.warnSoft}!important}`,
  `.warn-t{color:${D.warn}!important}`,
  `.ln-d{color:${D.danger}!important;text-decoration-color:${D.border}!important}`,
  `.ln-m{color:${D.muted}!important;text-decoration-color:${D.border}!important}`,
  `.end-btn{margin-bottom:${END.box}px!important}`,
  ".logo-ink{display:none!important}",
  ".logo-bone{display:block!important}",
];

const PHONE = [
  ".px{padding-left:16px!important;padding-right:16px!important}",
  ".card{padding:24px 20px!important}",
  ".h1{font-size:22px!important;line-height:28px!important}",
];

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** The muted house link. */
const LINK_MUTED = `color:${L.muted};text-decoration:underline;text-decoration-color:${L.border};text-underline-offset:3px`;

const inlines = (t: Text): Inline[] => (Array.isArray(t) ? t : [t]);
const nobr = (inner: string) => `<span style="display:inline-block">${inner}</span>`;

/**
 * A text's parts, split before its last two words: those move down together, so a wrapped text never ends on a word
 * alone (held whole, as `{ nobr }` does: a no-break space would still split "e-mail" at its hyphen). Bold words stay
 * bold on both sides. A text of one or two words, or one that ends in a `{ nobr }` of its own, isn't split.
 */
function closing(parts: Inline[]): [head: Inline[], tail: Inline[]] {
  const last = parts.at(-1);
  if (typeof last === "object" && "nobr" in last) return [parts, []];
  let spaces = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i] ?? "";
    // An address or a `{ nobr }` inside the text is one word.
    const text = typeof p === "string" ? p : "b" in p ? p.b : "";
    for (let at = text.lastIndexOf(" "); at >= 0; at = at > 0 ? text.lastIndexOf(" ", at - 1) : -1) {
      if (++spaces < 2) continue;
      const piece = (s: string): Inline[] => (!s ? [] : typeof p === "string" ? [s] : [{ b: s }]);
      return [
        [...parts.slice(0, i), ...piece(text.slice(0, at + 1))],
        [...piece(text.slice(at + 1)), ...parts.slice(i + 1)],
      ];
    }
  }
  return [parts, []];
}

const html = (t: Text, bold = `font-weight:600;color:${L.ink}`) => {
  const part = (i: Inline) =>
    typeof i === "string"
      ? esc(i)
      : "b" in i
        ? `<b class="ink" style="${bold}">${esc(i.b)}</b>`
        : "mail" in i
          ? `<a class="ln-m" href="mailto:${esc(i.mail)}" style="${LINK_MUTED}">${esc(i.mail)}</a>`
          : nobr(esc(i.nobr));
  const [head, tail] = closing(inlines(t));
  return head.map(part).join("") + (tail.length ? nobr(tail.map(part).join("")) : "");
};
const plain = (t: Text) =>
  inlines(t)
    .map((i) => (typeof i === "string" ? i : "b" in i ? i.b : "mail" in i ? i.mail : i.nobr))
    .join("");

const T = (style: string) =>
  `role="presentation" cellpadding="0" cellspacing="0" border="0"${style ? ` style="${style}"` : ""}`;
const P = `font-family:${SANS};mso-line-height-rule:exactly`;
/**
 * `P` where typed text goes: a word too long for the line breaks instead of widening the card, since a
 * table cell grows to its longest word. Not on the facts' labels: there it would let a long value squeeze
 * a label mid-word.
 */
const PW = `${P};word-break:break-word`;
/** `P` for a link button: classic Outlook clips a button whose line height is exact. */
const PB = `font-family:${SANS};mso-line-height-rule:at-least`;
/**
 * The app's primary button (`.ac-btn--primary` in `packages/ui/src/styles/doug.css`): its highlight, its darker green
 * bottom edge and the green's light under it. Every client that draws box-shadow reads rgba(); one value serves both
 * themes.
 */
const LIFT =
  "inset 0 1px 0 rgba(255,255,255,.9),inset 0 -2px 0 rgba(63,102,0,.22),0 1px 2px rgba(10,10,10,.14),0 8px 18px -8px rgba(63,102,0,.55)";

const cidOf = (file: string) => `${file.replace(/\.png$/, "")}@dougbot.app`;

/** The pictures one email shows: linked, or attached (only those its HTML names). */
function pictures(art: EmailArt) {
  const used = new Set<string>();
  const src = (file: string) => {
    used.add(file);
    return art.base ? `${art.base}${file}` : `cid:${cidOf(file)}`;
  };
  const inline = (): InlinePart[] =>
    EMAIL_PICTURES.flatMap((file) => {
      const content = art.base || !used.has(file) ? undefined : art.files?.get(file);
      return content ? [{ cid: cidOf(file), filename: file, contentType: "image/png", content }] : [];
    });
  return { src, inline };
}

function block(b: Block, src: (file: string) => string, last: boolean): string {
  const gap = (between: number, ink: keyof typeof END = "text") => (last ? END[ink] : between);
  // In a block of rows, the last block's last row keeps no room of its own: the block's margin is the room under it.
  const under = (i: number, rows: unknown[], between: number) => (last && i === rows.length - 1 ? 0 : between);
  if ("p" in b)
    return `<p class="tx" style="margin:0 0 ${gap(16)}px;${PW};font-size:16px;line-height:24px;color:${L.text}">${html(b.p)}</p>`;
  if ("small" in b)
    return `<p class="mu" style="margin:0 0 ${gap(12)}px;${P};font-size:14px;line-height:20px;color:${L.muted}">${html(b.small)}</p>`;
  if ("h2" in b)
    return `<h2 class="ink" style="margin:24px 0 12px;${P};font-size:16px;line-height:22px;font-weight:600;color:${L.ink}">${esc(b.h2)}</h2>`;
  if ("steps" in b)
    return `<table width="100%" ${T(`margin:0 0 ${gap(4)}px`)}>${b.steps
      .map(
        ([title, text], i) => `<tr>
<td width="36" valign="top" style="width:36px;padding:0 0 ${under(i, b.steps, 14)}px"><table ${T("")}><tr><td class="num" width="22" height="22" align="center" valign="middle" style="width:22px;height:22px;border:1px solid ${L.border};border-radius:7px;background:${L.card};${P};font-size:13px;line-height:22px;font-weight:600;color:${L.muted}">${i + 1}</td></tr></table></td>
<td valign="top" class="tx" style="padding:0 0 ${under(i, b.steps, 14)}px;${P};font-size:16px;line-height:24px;color:${L.text}"><b class="ink" style="font-weight:600;color:${L.ink}">${esc(title)}</b> ${html(text)}</td>
</tr>`,
      )
      .join("")}</table>`;
  if ("facts" in b)
    return `<table width="100%" class="well" ${T(`background:${L.well};border-radius:12px;margin:0 0 ${gap(20, "box")}px`)}><tr><td style="padding:4px 16px">
<table width="100%" ${T("")}>${b.facts
      .map(
        ([label, value], i) => `<tr>
<td class="mu${i ? " wh" : ""}" valign="top" style="padding:10px 12px 10px 0;${i ? `border-top:1px solid ${L.wellHair};` : ""}${P};font-size:14px;line-height:20px;color:${L.muted}">${esc(label)}</td>
<td class="ink${i ? " wh" : ""}" valign="top" align="right" style="padding:10px 0;${i ? `border-top:1px solid ${L.wellHair};` : ""}${PW};font-size:14px;line-height:20px;font-weight:600;color:${L.ink};text-align:right">${html(value)}</td>
</tr>`,
      )
      .join("")}</table></td></tr></table>`;
  if ("note" in b) {
    const warn = b.tone === "warn";
    return `<table width="100%" class="${warn ? "warn" : "well"}" ${T(`background:${warn ? L.warnSoft : L.well};border-radius:12px;margin:0 0 ${gap(16, "box")}px`)}><tr>
<td class="${warn ? "warn-t" : "tx"}" style="padding:14px 16px;${PW};font-size:15px;line-height:22px;color:${warn ? L.warn : L.text}">${html(b.note, warn ? "font-weight:700" : `font-weight:600;color:${L.ink}`)}</td></tr></table>`;
  }
  if ("people" in b)
    // The face starts 5 px down, where the name's capitals start on its 15/20 px line (4.5 to 5.7 px across Inter
    // and the system fonts): beside a name with a line under it, as the app's `.ac-captop`. Padding, not a
    // negative margin, which classic Outlook ignores.
    return `<table width="100%" ${T(`margin:0 0 ${gap(8)}px`)}>${b.people
      .map(
        (p, i) => `<tr>
<td width="44" valign="top" style="width:44px;padding:5px 0 ${under(i, b.people, 12)}px">${
          p.agent
            ? `<img src="${esc(src(botOf(p.agent)))}" width="${BOT_SHOWN.row}" height="${BOT_SHOWN.row}" alt="" style="display:block;border:0;outline:none;width:${BOT_SHOWN.row}px;height:${BOT_SHOWN.row}px">`
            : `<table ${T("")}><tr><td class="avp" width="30" height="30" align="center" valign="middle" style="width:30px;height:30px;border:1px solid ${L.border};border-radius:10px;background:${L.well};color:${L.text};${P};font-size:13px;line-height:30px;font-weight:700">${esc(initialsOf(p.name))}</td></tr></table>`
        }</td>
<td valign="top" style="padding:0 0 ${under(i, b.people, 12)}px">
<p class="ink" style="margin:0;${PW};font-size:15px;line-height:20px;font-weight:600;color:${L.ink}">${esc(p.name)}</p><p class="mu" style="margin:0;${PW};font-size:14px;line-height:20px;color:${L.muted}">${html(p.detail)}</p></td>
</tr>`,
      )
      .join("")}</table>`;
  if ("code" in b)
    // Letter spacing trails the last digit too: 8 px more on the left keeps the digits centred.
    return `<table width="100%" class="well" ${T(`background:${L.well};border-radius:12px;margin:0 0 ${gap(20, "box")}px`)}><tr>
<td class="ink" align="center" style="padding:16px 16px 16px 24px;${P};font-size:32px;line-height:40px;font-weight:700;letter-spacing:8px;font-variant-numeric:tabular-nums;color:${L.ink};text-align:center">${esc(b.code)}</td></tr></table>`;
  if ("button" in b) {
    // A link button, clickable everywhere; classic Outlook gets its own spacers, in em at the 15 px label, and draws
    // it square and flat. Its gradient comes only from the colour-scheme blocks in the head: the Gmail apps darken a
    // fill and its label but leave a gradient as drawn, which would put a darkened label on the light design's ink.
    // The border in the fill's colour is unseen in light; Gmail for Android lightens it as a line, so the button keeps
    // an edge on its darkened card. It takes 1 px of the padding: still 48 tall.
    const btn = `<a class="btn" href="${esc(b.url)}" target="_blank" style="display:inline-block;background-color:${L.action};border:1px solid ${L.action};border-radius:14px;box-shadow:${LIFT};color:${L.onAction};${PB};font-size:15px;line-height:20px;font-weight:600;text-decoration:none;padding:13px 15px;mso-padding-alt:0;text-underline-color:${L.action}"><!--[if mso]><i style="mso-font-width:107%;mso-text-raise:187%" hidden>&emsp;</i><![endif]--><span style="mso-text-raise:93%;color:${L.onAction}">${esc(b.button)}</span><!--[if mso]><i style="mso-font-width:107%" hidden>&emsp;&#8203;</i><![endif]--></a>`;
    // Four spaces too: classic Outlook ignores the span's width. The second label has no colour of its own, so the
    // dark rules reach it through the link, and classic Outlook raises it like the button's.
    const also = b.also
      ? `<span style="display:inline-block;width:16px;font-size:15px;line-height:20px">&nbsp;&nbsp;&nbsp;&nbsp;</span><a class="${b.also.danger ? "ln-d" : "ln"}" href="${esc(b.also.url)}" target="_blank" style="display:inline-block;padding:14px 0;color:${b.also.danger ? L.danger : L.ink};${PB};font-size:15px;line-height:20px;font-weight:600;text-decoration:underline;text-decoration-color:${L.border};text-underline-offset:3px;text-underline-color:${L.border}"><span style="mso-text-raise:93%">${esc(b.also.label)}</span></a>`
      : "";
    return `<table${last ? ' class="end-btn"' : ""} ${T(`margin:8px 0 ${gap(20, "button")}px`)}><tr><td>${btn}${also}</td></tr></table>`;
  }
  return `<p class="mu" style="margin:0 0 ${gap(12)}px;${P};font-size:13px;line-height:19px;color:${L.muted}">${html(b.fallback)}<br><a class="ln-m" href="${esc(b.url)}" target="_blank" style="${LINK_MUTED};word-break:break-all">${esc(b.url)}</a></p>`;
}

/**
 * The scene at the card's top: the bots in a row over the headline, the first at the text's edge. The same row with or
 * without the workspace's computer (`Scene`).
 */
function scene(s: Scene, src: (file: string) => string): string {
  const side = BOT_SHOWN.scene;
  return `<table ${T("margin:0 0 20px")}><tr>${s.crew
    .map(
      (look) =>
        `<td valign="bottom" style="padding:0 8px 0 0"><img src="${esc(src(botOf(look)))}" width="${side}" height="${side}" alt="" style="display:block;border:0;outline:none;width:${side}px;height:${side}px"></td>`,
    )
    .join("")}</tr></table>`;
}

/** The plain-text part of a block: the same words, a button as `Label: url`. */
function text(b: Block): string {
  if ("p" in b) return plain(b.p);
  if ("small" in b) return plain(b.small);
  if ("h2" in b) return b.h2;
  if ("steps" in b) return b.steps.map(([title, x], i) => `${i + 1}. ${title} ${x}`).join("\n");
  if ("facts" in b) return b.facts.map(([label, v]) => `${label}: ${plain(v)}`).join("\n");
  if ("note" in b) return plain(b.note);
  // "Theo, Merge pull request #42" would read as an order to Theo.
  if ("people" in b) return b.people.map((p) => `${p.name} · ${plain(p.detail)}`).join("\n");
  if ("code" in b) return b.code;
  if ("button" in b) return [`${b.button}: ${b.url}`, ...(b.also ? [`${b.also.label}: ${b.also.url}`] : [])].join("\n");
  // The address is already in the button's line.
  return "";
}

/**
 * Light and dark, in every email: our dark design by media query and again under Outlook.com's hooks, and the button's
 * gradients. The meta says `light only`, which the Gmail apps honour for Google accounts: they show the email as the
 * light design draws it, the same as on a computer. The only dark they draw is their own conversion of it, which
 * reads as another email (a dark green button, a grey card). `:root` still declares both schemes, so Apple Mail applies
 * our dark design. Risky rules sit in blocks of their own, so a client that drops one keeps the rest. Each gradient
 * comes after the flat fill it paints over: a client that rejects it keeps the flat fill, and Outlook.com's hooks
 * outrank the light one.
 */
export const EMAIL_DARK_HEAD = `<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light dark">
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
</style>
<style>
@media (prefers-color-scheme:dark){${DARK.join("")}}
</style>
<style>
${DARK.map((r) => `[data-ogsc] ${r}[data-ogsb] ${r}`).join("\n")}
</style>
<style>
@media (prefers-color-scheme:light){.btn{background-image:linear-gradient(180deg,${L.actionTop} 0%,${L.action} 55%,${L.actionEnd} 100%)!important}}
</style>
<style>
@media (prefers-color-scheme:dark){.btn{background-image:linear-gradient(180deg,${D.actionTop} 0%,${D.action} 55%,${D.actionEnd} 100%)!important}}
</style>`;

/** After the preheader, so the body's first words don't trail into the inbox preview (iOS and Yahoo need the last two). */
const FILLER = "&#847;&zwnj;&nbsp;&#8199;&shy;".repeat(60);

/**
 * One email in our look: the light design inline, our dark design for the clients that apply an email's
 * own (`EMAIL_DARK_HEAD`), and a plain-text part with the same words.
 */
export function renderDoc(doc: EmailDoc, art: EmailArt): { html: string; text: string; inline: InlinePart[] } {
  const { src, inline } = pictures(art);
  // The app's face from this server's own `/email/`, beside the pictures. A mail app that can't load it shows the stack
  // after it at once (`swap`). With the pictures attached the email fetches nothing, the face included: an address no
  // reader can reach would only bring remote-content warnings. Classic Outlook never sees the rule, and Gmail, which
  // loads no web font, drops this block alone.
  const fonts = art.base;
  const lang = doc.lang;
  const body = doc.blocks.map((b, i) => block(b, src, i === doc.blocks.length - 1)).join("\n");
  const logo = (file: string, cls: string, display: string, color: string) =>
    `<img class="${cls}" src="${esc(src(file))}" width="${LOGO.width}" height="${LOGO.height}" alt="${LOGO.alt}" style="display:${display};border:0;outline:none;width:${LOGO.width}px;height:${LOGO.height}px;font-family:${SANS};font-size:20px;font-weight:600;line-height:${LOGO.height}px;color:${color}">`;
  const page = `<!doctype html>
<html lang="${lang}" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
${EMAIL_DARK_HEAD}
<title>${esc(doc.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>body,table,td,p,a,span,b,h1,h2{font-family:'Segoe UI',Arial,sans-serif!important}</style><![endif]-->
<style>
body{margin:0!important;padding:0!important;width:100%!important}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
@media (max-width:620px){${PHONE.join("")}}
</style>
${fonts ? `<!--[if !mso]><!--><style>${FONTS.map(([family, file, weights]) => `@font-face{font-family:'${family}';font-style:normal;font-weight:${weights};font-display:swap;src:url('${esc(`${fonts}${file}`)}') format('woff2')}`).join("")}</style><!--<![endif]-->` : ""}
</head>
<body class="body bg" style="margin:0;padding:0;width:100%;background:${L.page};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all">${esc(doc.preheader)}${FILLER}</div>
<div role="article" aria-roledescription="email" aria-label="${esc(doc.subject)}" lang="${lang}" dir="ltr">
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${L.page}">
<tr><td align="center" class="px" style="padding:0 24px">
<!--[if mso]><table role="presentation" width="552" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:552px;margin:0 auto">
<tr><td style="padding:32px 0 20px">
<a href="${esc(art.home)}" target="_blank" style="display:inline-block;text-decoration:none">
${logo(LOGO_INK, "logo-ink", "block", L.ink)}
<!--[if !mso]><!-->${logo(LOGO_BONE, "logo-bone", "none", D.ink)}<!--<![endif]-->
</a>
</td></tr>
<tr><td class="card" style="background:${L.card};border:1px solid ${L.border};border-radius:16px;padding:32px">
${doc.scene ? scene(doc.scene, src) : ""}<h1 class="h1 ink" style="margin:0 0 16px;font-family:${TITLE};mso-line-height-rule:exactly;font-size:24px;line-height:30px;font-weight:700;letter-spacing:-0.02em;color:${L.ink}">${html(doc.headline)}</h1>
${body}
</td></tr>
<tr><td style="padding:20px 0 40px">
${doc.footer.map((f) => `<p class="fa" style="margin:0 0 6px;${PW};font-size:13px;line-height:19px;color:${L.faint}">${html(f)}</p>`).join("\n")}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>`;
  const parts = [doc.headline, ...doc.blocks.map(text).filter(Boolean), doc.footer.map(plain).join("\n")];
  return { html: page, text: `${parts.join("\n\n")}\n`, inline: inline() };
}
