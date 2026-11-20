/*
 * Addresses inside a message's words, found the same way on the web and the phone (the WhatsApp screens, docs/adr/
 * doug-0001-whatsapp-numbers.md): plain text has no markdown to carry a link, so the apps find them.
 */

/** A piece of a message's words: plain, or an address a tap opens (`href`, what the phone is handed). */
export type TextPart = { text: string; href?: string };

// Addresses as WhatsApp underlines them: with a scheme, starting "www.", or an e-mail. Punctuation that ends a
// sentence or closes a bracket stays outside the link.
const LINK_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gi;
const TRAIL_RE = /[.,;:!?…'"”’)\]}>]+$/;

/** A message's words split into plain text and the addresses in it, in order. */
export function linkParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const match of text.matchAll(LINK_RE)) {
    let found = match[0];
    const start = match.index ?? 0;
    // A closing bracket is kept when the address opened one itself (Wikipedia's "Foo_(bar)").
    const trail = TRAIL_RE.exec(found)?.[0] ?? "";
    if (trail) {
      let cut = trail.length;
      if (trail.startsWith(")") && found.slice(0, -cut).includes("(")) cut -= 1;
      found = found.slice(0, found.length - cut);
    }
    if (!found || found.endsWith("://")) continue;
    if (start > at) parts.push({ text: text.slice(at, start) });
    const mail = !/^(https?:\/\/|www\.)/i.test(found);
    parts.push({ text: found, href: mail ? `mailto:${found}` : /^www\./i.test(found) ? `https://${found}` : found });
    at = start + found.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts.length > 0 ? parts : [{ text }];
}
