import type { LegalFacts } from "@agenteschat/client";
import privacyPt from "../../../../docs/legal/privacidade.pt-BR.md?raw";
import privacyEn from "../../../../docs/legal/privacy.en.md?raw";
import termsPt from "../../../../docs/legal/termos.pt-BR.md?raw";
import termsEn from "../../../../docs/legal/terms.en.md?raw";

/**
 * The DougBot's own Terms of Use and Privacy Policy, for `/termos` and `/privacidade`. The text lives in Markdown
 * files under `docs/legal/`, which legal reviewers edit without touching code: each is read here as raw text
 * (`?raw`), so an edit to a `.md` file ships with the next build and no other change.
 *
 * Two kinds of mark belong to the installation (`GET /api/app/legal`), and each paragraph that promises something says
 * only what that installation does:
 * - `{{field}}` is the company's own detail (`LEGAL_*`), or `[a preencher]` / `[to be filled]` when the server has none.
 * - `{{#if flag}}…{{else}}…{{/if}}` and `{{#unless flag}}…{{/unless}}` keep a paragraph only where the setting that
 *   makes it true is there (a backup bucket, the usage report, each optional outside service, `svc.<name>`), and
 *   `{{on:flag}}` is "Ligado" / "Desligado" for a row of Annex II. Blocks nest.
 */
export type LegalDoc = "terms" | "privacy";
export type LegalLang = "pt-BR" | "en";

const DOCS: Record<LegalLang, Record<LegalDoc, string>> = {
  "pt-BR": { terms: termsPt, privacy: privacyPt },
  en: { terms: termsEn, privacy: privacyEn },
};

/** The Markdown of one document in one language, as committed. */
export const legalText = (doc: LegalDoc, lang: LegalLang): string => DOCS[lang][doc];

/** A field with no setting, in each language. */
export const LEGAL_PLACEHOLDER = { "pt-BR": "[a preencher]", en: "[to be filled]" } as const;

/** What an Annex II row says of a service. */
const STATE = { "pt-BR": { on: "Ligado", off: "Desligado" }, en: { on: "On", off: "Off" } } as const;

/**
 * A company's own words made safe inside a code span, where the documents put every one: no backtick to close it, and
 * one line, so the value reads as text and never as Markdown (a link, a heading, a table cell).
 */
function plain(value: string): string {
  return value.replace(/`/g, "'").replace(/\s+/g, " ").replace(/\|/g, "/").trim();
}

/** An address that is safe to put in a `mailto:` link: nothing the Markdown link would end on. */
const MAIL = /^[^\s()[\]`<>,;:"\\|]+@[^\s()[\]`<>,;:"\\|]+$/;

/** The values each placeholder takes, from the installation's `LEGAL_*` settings (`GET /api/app/legal`). */
function values(facts: LegalFacts | undefined, lang: LegalLang): Record<string, string> {
  const empty = `\`${LEGAL_PLACEHOLDER[lang]}\``;
  const or = (value: string | null | undefined) => (value?.trim() ? `\`${plain(value)}\`` : empty);
  const days = (n: number | undefined, fallback: number) => String(n === undefined || Number.isNaN(n) ? fallback : n);
  const mail = facts?.dpoEmail?.trim();
  return {
    legalName: or(facts?.companyName),
    cnpj: or(facts?.taxId),
    address: or(facts?.address),
    dpo: or(facts?.dpoName),
    dpoEmail: or(facts?.dpoEmail),
    // The DPO's address as a link people can press, when it has the shape of one.
    dpoEmailLink: mail && MAIL.test(mail) ? `[${mail}](mailto:${mail})` : or(facts?.dpoEmail),
    serverLocation: or(facts?.serverLocation),
    logRetention: or(facts?.logRetention),
    backupRetentionDays: days(facts?.backupRetentionDays, 14),
    voiceRetentionDays: days(facts?.voiceRetentionDays, 90),
    companyRequestsRetentionDays: days(facts?.companyRequestsRetentionDays ?? undefined, 365),
  };
}

/** The switches a block or a row can name: the flags of the facts, and `svc.<service>` for each outside service. */
function flags(facts: LegalFacts | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {
    draft: facts?.draft ?? true,
    backup: facts?.backup ?? false,
    // 0 keeps the number out of the text: the service's own rules decide, and the policy says so.
    backupDays: (facts?.backupRetentionDays ?? 14) > 0,
    voiceDays: (facts?.voiceRetentionDays ?? 90) > 0,
    logRetention: Boolean(facts?.logRetention?.trim()),
    storageS3: facts?.storage === "s3",
    storageDisk: facts?.storage === "disk",
    storageDatabase: (facts?.storage ?? "database") === "database",
    telemetryForced: facts?.telemetryForced ?? false,
    companyRequests: facts?.companyRequestsRetentionDays != null,
  };
  for (const [name, on] of Object.entries(facts?.services ?? {})) out[`svc.${name}`] = on;
  return out;
}

const BLOCK = /\{\{#(if|unless)\s+([\w.]+)\s*\}\}((?:(?!\{\{#(?:if|unless)\b)[\s\S])*?)\{\{\/\1\s*\}\}/;

/**
 * `text` with every `{{field}}` replaced and every block resolved (an unknown field stays as written, so a reviewer
 * sees the mistake). The innermost block goes first, so blocks nest.
 */
export function fillLegal(source: string, facts: LegalFacts | undefined, lang: LegalLang): string {
  const map = values(facts, lang);
  const on = flags(facts);
  let text = source.replace(/\r\n?/g, "\n");
  for (let match = BLOCK.exec(text); match; match = BLOCK.exec(text)) {
    const [whole, kind, name = "", body = ""] = match;
    const [yes = "", no = ""] = body.split(/\{\{\s*else\s*\}\}/);
    const keep = Boolean(on[name]) === (kind === "if") ? yes : no;
    text = text.replace(whole, () => keep);
  }
  return text
    .replace(/\{\{\s*on:([\w.]+)\s*\}\}/g, (_, name: string) => STATE[lang][on[name] ? "on" : "off"])
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, name: string) => map[name] ?? whole)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * The document without its `> [!warning] Draft` callout: each file carries one, under its title, so whoever reads it in
 * the repository knows what it is. The page shows that in the kit's own notice instead (`legal.draft`), so the
 * document's text reads as one page and the banner does not show twice. Only the callout's own block goes: a `>` quote
 * anywhere else stays.
 */
export function stripDraftBanner(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^>\s*\[!warning\]/i.test(line));
  if (start === -1) return source;
  let end = start;
  while (end < lines.length && (lines[end] ?? "").startsWith(">")) end += 1;
  // One blank line where the block was, never two.
  let before = start;
  while (before > 0 && !(lines[before - 1] ?? "").trim()) before -= 1;
  let after = end;
  while (after < lines.length && !(lines[after] ?? "").trim()) after += 1;
  const head = lines.slice(0, before);
  return (
    head.length > 0 && after < lines.length ? [...head, "", ...lines.slice(after)] : [...head, ...lines.slice(after)]
  )
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}
