/**
 * Text people typed or agents wrote (a workspace, person or agent name, an address, an event or approval
 * title, a note) as an email prints it. Some of these emails reach people outside the workspace (an
 * invitation), and a mail client turns a bare domain, an address or a phone number into a link, so that
 * text must never become one.
 *
 * Ported from MillionSend (`packages/core/src/customer-text.ts`, AGPL-3.0): `inertText` and what it calls.
 * Changes: the length cap is a parameter; a separator gets its break only inside a token, so a sentence's
 * last period stays as typed; and a long run with no break gets one.
 */

/**
 * U+200A HAIR SPACE, set after a ".", "@", ":" or "\" inside a token. Mail clients link by scanning text
 * (Gmail's linkifier, Apple Mail's data detectors, Outlook, the plain-text part), so markup does not stop
 * them, and a zero-width character is no break to all of them: linkify-it counts it as a letter, and
 * IDNA's mapping deletes it. Whitespace ends every scheme, host and address grammar, and NFKC turns a hair
 * space into a space, which still ends them. It is about 1/24 em wide, so "acme.dev" reads as acme.dev.
 */
export const BREAK = "\u200a";
const SEPARATORS = new Set([".", ":", "@", "\\"]);

/**
 * The longest run of characters with no break, for the plain-text part and a client that ignores the layout's
 * `word-break`: a table cell grows to its longest word, past a phone's screen.
 */
const RUN_MAX = 30;

/** Zero-width, bidi and the other format and default-ignorable characters, except those writing uses. */
const INVISIBLE = /(?!\u200c|\u200d|\ufe0e|\ufe0f)[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
/**
 * Those stay only where writing puts them: a presentation selector right after an emoji, a joiner inside
 * an emoji sequence or between letters of a script that shapes with it (Persian ZWNJ, Indic ZWJ).
 */
const STRAY_SELECTOR = /(?<!\p{Extended_Pictographic})(?:\ufe0e|\ufe0f)/gu;
const STRAY_JOINER =
  /(?<![\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Lo}\p{M}])(?:\u200c|\u200d)|(?:\u200c|\u200d)(?![\p{Extended_Pictographic}\p{Lo}])/gu;
/** Controls (newlines, tabs) and line or paragraph separators. */
const LINE_BREAKING = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
/** Combining marks past the fourth in a row: a flood of them is one character the length cap would never cut. */
const MARK_FLOOD = /(\p{M}{4})\p{M}+/gu;
/**
 * Digits joined only by spaces and punctuation, the way phone numbers are written and the way iOS Mail's
 * data detectors and the Gmail and Outlook apps find numbers to call; a modifier letter joins them too, as
 * libphonenumber reads the katakana prolonged sound mark (U+30FC). A run of seven or more keeps its first
 * four, and the rest print as "•", unless it is exactly one date or span of years.
 */
const DIGIT_RUN = /\p{N}(?:[^\p{Lu}\p{Ll}\p{Lt}\p{Lo}\p{N}]*\p{N})*/gu;
/** What may follow a separator that ends a sentence or a quote: whitespace and closing punctuation. */
const CLOSING = /[\s\p{Pe}\p{Pf}"'!?,;]/u;

/** Invisible characters out; the joiners and selectors writing uses kept. */
function dropInvisible(value: string): string {
  // Every character the set holds lies outside ASCII.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the ASCII range is the test
  if (!/[^\x00-\x7f]/.test(value)) return value;
  return value.replace(INVISIBLE, "").replace(STRAY_SELECTOR, "").replace(STRAY_JOINER, "");
}

/** One line of visible text: line breaks and controls become spaces, invisible characters go. */
export function stripInvisible(value: string): string {
  return dropInvisible(value.replace(LINE_BREAKING, " ")).replace(/\s+/g, " ").trim();
}

/**
 * One line of visible text with its spacing kept as typed, for text whose own lines matter (`inertLines`): the
 * controls go but the spaces between words stay.
 */
function stripInvisibleInPlace(value: string): string {
  const kept = value.replace(/[\p{Zl}\p{Zp}]/gu, "\n").replace(/\p{Cc}/gu, (c) => (c === "\n" ? c : " "));
  return dropInvisible(kept);
}

/** ".", ":", "@" or "\", or a character whose compatibility form is one ("．" "＠" "﹕"), or "。". */
function isSeparator(c: string): boolean {
  return SEPARATORS.has(c.normalize("NFKC").replace("。", "."));
}

/**
 * Whether a digit run is exactly one date in ASCII digits with one separator throughout ("09/10/2026"
 * either way round, "9.10.2026", "2026-10-09"; years 1900–2099) or one span of up to ten years
 * ("2025-2026", "2025–2026", "2025/2026"). Names and titles carry them, and the shape fixes too many digits
 * to spell a chosen number.
 */
function isDateOrYears(run: string): boolean {
  const dayMonth = /^(\d\d?)([/.-])(\d\d?)\2(?:19|20)\d\d$/.exec(run);
  if (dayMonth) {
    const [low = 0, high = 0] = [Number(dayMonth[1]), Number(dayMonth[3])].sort((a, b) => a - b);
    return low >= 1 && low <= 12 && high <= 31;
  }
  const yearFirst = /^(?:19|20)\d\d([/.-])(\d\d?)\1(\d\d?)$/.exec(run);
  if (yearFirst) {
    const [month, day] = [Number(yearFirst[2]), Number(yearFirst[3])];
    return month >= 1 && month <= 12 && day >= 1 && day <= 31;
  }
  const years = /^((?:19|20)\d\d)[-–/]((?:19|20)\d\d)$/.exec(run);
  const span = Number(years?.[2]) - Number(years?.[1]);
  return span >= 1 && span <= 10;
}

function maskNumbers(text: string): string {
  return text.replace(DIGIT_RUN, (run) => {
    if ((run.match(/\p{N}/gu)?.length ?? 0) < 7 || isDateOrYears(run)) return run;
    let kept = 0;
    return run.replace(/\p{N}/gu, (digit) => (++kept > 4 ? "•" : digit));
  });
}

/** A break after the RUN_MAX-th character of any run with none, cut between whole characters. */
function breakLongRuns(text: string): string {
  if (!new RegExp(`\\S{${RUN_MAX + 1}}`, "u").test(text)) return text;
  let run = 0;
  let out = "";
  for (const { segment } of new Intl.Segmenter().segment(text)) {
    if (/\s/u.test(segment)) run = 0;
    else if (++run > RUN_MAX) {
      out += BREAK;
      run = 1;
    }
    out += segment;
  }
  return out;
}

/**
 * Typed text for an email's body, the same string in the HTML and the plain-text part (the layout escapes
 * it for HTML): one line, at most `max` characters, nothing a mail client turns into a link or offers to
 * call, and no run of more than 30 characters without a break. Look-alike separators break like the ASCII
 * ones and keep their form, so "ｅｖｉｌ．ｃｏｍ" and "evil。com" link no more than evil.com does.
 *
 * `numbers: false` leaves digits as they were typed, for text a person asked to send as it is (a support
 * request): a phone number or an order id there is a fact to read, not a number nobody may link.
 */
export function inertText(value: string, max = 64, { numbers = true }: { numbers?: boolean } = {}): string {
  const mask = numbers ? maskNumbers : (s: string) => s;
  const text = mask(stripInvisible(value).replace(MARK_FLOOD, "$1"));
  // Cut on grapheme boundaries, so an emoji or an accented letter stays whole.
  const parts = text.length > max ? Array.from(new Intl.Segmenter().segment(text), (s) => s.segment) : [];
  const cut =
    parts.length > max
      ? `${parts
          .slice(0, max - 1)
          .join("")
          .trimEnd()}…`
      : text;
  // A joined chain (emoji linked by zero-width joiners, Indic consonants by viramas) is one grapheme
  // however long it runs, so the cut also stops at four code points a character.
  const points = Array.from(cut);
  const capped =
    points.length > max * 4
      ? `${points
          .slice(0, max * 4 - 1)
          .join("")
          .replace(STRAY_JOINER, "")}…`
      : cut;
  // A cut through a date can leave seven of its digits, which are no date.
  return breakLongRuns(breakSeparators(mask(capped)));
}

/** A break after every ".", ":", "@" or "\" inside a token: what stops a client reading its word as a link. */
function breakSeparators(text: string): string {
  const chars = Array.from(text);
  return chars
    .map((c, i) => {
      const next = chars[i + 1];
      return isSeparator(c) && next !== undefined && !CLOSING.test(next) ? `${c}${BREAK}` : c;
    })
    .join("");
}

/**
 * A person's own words for an email's body (a support request), kept as they wrote them: their line breaks stay,
 * at most `max` characters in all, and no ".", ":" or "@" inside a word survives without a break after it, so a
 * mail client links nothing. Nothing is masked and nothing cut to one line: they asked for these words to travel.
 */
export function inertLines(value: string, max = 64): string {
  const lines = stripInvisibleInPlace(value.replace(/\r\n?/g, "\n").replace(MARK_FLOOD, "$1"))
    .split("\n")
    .map((line) => line.replace(/\t/g, " ").replace(/ {2,}/g, " ").trim())
    // One blank line between paragraphs is enough; the ends carry none.
    .filter((line, i, all) => line !== "" || (all[i - 1] !== "" && all.slice(i + 1).some((l) => l !== "")));
  // The limit counts what the person wrote, not the breaks this file adds after "." ":" "@" (a log full of
  // them would lose its end, where the error is): cut first, then break.
  const raw = lines.join("\n");
  if (Array.from(raw).length <= max) return breakSeparators(raw);
  // Cut on grapheme boundaries and say that it was cut.
  const parts = Array.from(new Intl.Segmenter().segment(raw), (s) => s.segment);
  return breakSeparators(
    `${parts
      .slice(0, Math.max(0, max - 1))
      .join("")
      .trimEnd()}…`,
  );
}
