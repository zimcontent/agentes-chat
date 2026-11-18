/**
 * This instance's name, in one place. The fork follows the project it comes from every day, and each merge brings
 * new text that names that project: instead of editing every string (and resolving the same conflict every day),
 * the text is renamed where it leaves for a person: the apps' strings, the help pages, the emails, the pushes.
 *
 * What is never renamed: an address (`https://agentes.chat/install`, `ping@agentes.chat`, `app.agentes.chat`,
 * `/Applications/agentes.chat.app`), and the legal attribution (NOTICE, TRADEMARKS, the terms), which must keep
 * naming the project and its company. Those never go through `brandText`, or go through and stay as written.
 */
export const BRAND_NAME = "DougBot";

/** The name of the project this instance is based on, as its own text writes it. */
export const UPSTREAM_NAME = "agentes.chat";

/**
 * The name this server's client gives the product (`clients/<code>/config.json`, ADR doug-0032), set once by each app
 * when it learns it (the web before its strings load). Null: the build's own name. Module state on purpose: every
 * string and every signature goes through `brandText`/`brandName`, and passing the name through every call would leave
 * the one the app doesn't know about still saying the build's name.
 */
let clientProductName: string | null = null;

/** The product's name here: the client's, else this build's. */
export const brandName = (): string => clientProductName ?? BRAND_NAME;

/** Everything told when the name changes: a component that shows it asks again (`subscribeBrand`). */
const listeners = new Set<() => void>();

/**
 * Sets the client's name for everything drawn from now on (`brandName`, and the strings `brandTree` builds after it).
 * Called by an app once it read `GET /me` or `GET /api/instance`; a server with no client leaves it as it is. A name
 * equal to the build's, or blank, clears it. Sets nothing when the name is already that one, so a component that
 * re-reads it (a render, a second screen) never loops.
 */
export function setClientProductName(name: string | null | undefined): void {
  const next = name?.trim() || null;
  const value = next === BRAND_NAME ? null : next;
  if (value === clientProductName) return;
  clientProductName = value;
  for (const heard of listeners) heard();
}

/**
 * Calls `heard` whenever the product's name changes, and stops when the returned function is called: what
 * `useSyncExternalStore` takes, so a signature (`Logo`) redraws on its own once the client's name arrives, wherever
 * it is on the screen and without a prop carrying it down.
 */
export function subscribeBrand(heard: () => void): () => void {
  listeners.add(heard);
  return () => {
    listeners.delete(heard);
  };
}

/**
 * The upstream name as a word: not after a letter, digit or one of `@ . / : -` (an email, a subdomain, a path, a
 * scheme) and not before a letter, digit, `/`, `-` or a dot that goes on (`agentes.chat.app`, `agentes.chat/x`). A
 * dot that ends the sentence is fine. The character before is captured, not looked behind, for old engines.
 */
const UPSTREAM_WORD = /(^|[^\w@./:-])agentes\.chat(?![\w/-]|\.\w)/g;

/**
 * This build's name as a word, for a client's: the same rule, and a capital D so a lowercase address (`dougbot.app`)
 * never matches.
 */
const BRAND_WORD = /(^|[^\w@./:-])DougBot(?![\w/-]|\.\w)/g;

/**
 * `pattern`'s matches replaced by `name`, the captured character before kept. A function, never a `$`-template: a
 * client's name is text a person typed, and `"Doces R$1"` or `"A & B $&"` in it must reach the screen as written,
 * not be read as a replacement pattern.
 */
const renamed = (text: string, pattern: RegExp, name: string): string =>
  text.replace(pattern, (_match, before: string) => `${before}${name}`);

/** A character no name or string carries: it holds a client's name still while the pass looks for the others. */
const KEPT = "\u0000";

/**
 * Keys whose words are the vendor's, never the product's: `hosting.cloud.name` is the Cloud offering's own name and
 * `onboarding.import.agenteschatName` the server this instance comes from. A client's name replaces neither — the plan
 * it sells and the server it is built from stay named as they are whichever workspace reads them (ADR doug-0032 §3).
 */
export const KEPT_KEYS: ReadonlySet<string> = new Set(["hosting.cloud.name", "onboarding.import.agenteschatName"]);

/** Whether a path names one of `KEPT_KEYS`, at any depth above it: a language's tree may sit under its code. */
const keptKey = (path: readonly string[]): boolean => path.some((_, i) => KEPT_KEYS.has(path.slice(i).join(".")));

/**
 * The vendor's own phrases inside a sentence, held out of the rename: "DougBot Cloud", "DougBot plan". They name what
 * the vendor sells, not the product the client runs, so a client's name never stands in them — "Padaria Aurora Cloud"
 * would name another company's cloud. The languages put the noun first or the article between ("plano do DougBot"), so
 * the phrase is matched up to the name's end and the article before it is read as part of the words that follow.
 */
const VENDOR_PHRASES = /\bDougBot\s+(?:Cloud|plan)\b|\bplan(?:o|os)?\s+d[oa]s?\s+DougBot\b/gi;

/** A character no name or string carries: the vendor phrases stand as placeholders with it while the rename runs. */
const HELD = "\u0001";

/**
 * `text` with the product's name as this server's, addresses left alone.
 *
 * Applied twice, the text reads the same as once: the client's name already standing in it is held out, so a name
 * that itself holds the build's (`DougBot Padaria`) is not renamed again by its own tail. The build's name is also
 * renamed first, before the upstream pass writes the client's name in, which keeps a name that starts with the
 * build's (`DougBot Padaria`) from being taken for one more. A string branded by the language files when they load
 * and again for the tab's title is what needs it.
 */
export function brandText(text: string): string {
  const name = brandName();
  const upstream = (text: string) => (text.includes(UPSTREAM_NAME) ? renamed(text, UPSTREAM_WORD, name) : text);
  if (name === BRAND_NAME) return upstream(text);
  // The vendor's own phrases are held out first, whatever else the name does: the plan it sells and the cloud it runs
  // keep their name whichever client reads them (ADR doug-0032 §3). A name of free text may carry a marker itself;
  // then the text takes the plain passes, exact once, and no phrase survives as a placeholder either.
  const vendor = heldOut(text);
  const markers = vendor.held.includes(HELD) || text.includes(KEPT) || name.includes(KEPT);
  const brand = markers
    ? (text: string) => upstream(renamed(text, BRAND_WORD, name))
    : (text: string) => {
        const parts = text.split(name);
        const branded = upstream(renamed(parts.join(KEPT), BRAND_WORD, name));
        return parts.length > 1 ? branded.split(KEPT).join(name) : branded;
      };
  return vendor.restore(brand(vendor.held));
}

/** `text` with each vendor phrase swapped for `HELD` and its position, to put back after the rename. */
function heldOut(text: string): { held: string; restore: (text: string) => string } {
  const phrases: string[] = [];
  const held = text.replace(VENDOR_PHRASES, (phrase) => {
    phrases.push(phrase);
    return `${HELD}${phrases.length - 1}${HELD}`;
  });
  if (phrases.length === 0) return { held, restore: (same) => same };
  return {
    held,
    restore: (branded) =>
      branded.replace(new RegExp(`${HELD}(\\d+)${HELD}`, "g"), (_m, at: string) => phrases[Number(at)] ?? ""),
  };
}

/**
 * Every string of a tree of words (objects, arrays) through `brandText`. A branch with nothing to rename comes back
 * as the same object, so a tree that never names the product is returned untouched. Functions and other values stay.
 * A key in `KEPT_KEYS` names the vendor, not the product, and its string stays as written.
 */
export function brandTree<T>(tree: T, path: readonly string[] = []): T {
  if (typeof tree === "string") return (keptKey(path) ? tree : brandText(tree)) as T;
  if (Array.isArray(tree)) {
    let changed = false;
    const out = tree.map((item, i) => {
      const next = brandTree(item, [...path, String(i)]);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? (out as T) : tree;
  }
  if (tree && typeof tree === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(tree)) {
      const next = brandTree(value, [...path, key]);
      if (next !== value) changed = true;
      out[key] = next;
    }
    return changed ? (out as T) : tree;
  }
  return tree;
}
