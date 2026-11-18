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
 * The name this server's client gives the product (`clients/<code>/config.json`, ADR doug-0023), set once by each app
 * when it learns it (the web before its strings load). Null: the build's own name. Module state on purpose: every
 * string and every signature goes through `brandText`/`brandName`, and passing the name through every call would leave
 * the one the app doesn't know about still saying the build's name.
 */
let clientProductName: string | null = null;

/** The product's name here: the client's, else this build's. */
export const brandName = (): string => clientProductName ?? BRAND_NAME;

/**
 * Sets the client's name for everything drawn from now on (`brandName`, and the strings `brandTree` builds after it).
 * Called by an app once it read `GET /me` or `GET /api/instance`; a server with no client leaves it as it is. A name
 * equal to the build's, or blank, clears it.
 */
export function setClientProductName(name: string | null | undefined): void {
  const next = name?.trim() || null;
  clientProductName = next === BRAND_NAME ? null : next;
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

/** `text` with the product's name as this server's, addresses left alone. */
export function brandText(text: string): string {
  const name = brandName();
  const branded = text.includes(UPSTREAM_NAME) ? text.replace(UPSTREAM_WORD, `$1${name}`) : text;
  return name === BRAND_NAME ? branded : branded.replace(BRAND_WORD, `$1${name}`);
}

/**
 * Every string of a tree of words (objects, arrays) through `brandText`. A branch with nothing to rename comes back
 * as the same object, so a tree that never names the product is returned untouched. Functions and other values stay.
 */
export function brandTree<T>(tree: T): T {
  if (typeof tree === "string") return brandText(tree) as T;
  if (Array.isArray(tree)) {
    let changed = false;
    const out = tree.map((item) => {
      const next = brandTree(item);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? (out as T) : tree;
  }
  if (tree && typeof tree === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(tree)) {
      const next = brandTree(value);
      if (next !== value) changed = true;
      out[key] = next;
    }
    return changed ? (out as T) : tree;
  }
  return tree;
}
