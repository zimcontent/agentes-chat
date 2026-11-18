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
 * The `{{field}}` placeholders belong to the company that runs the installation. `fillLegal` replaces each with its
 * `LEGAL_*` setting, or with `[a preencher]` / `[to be filled]` when the server has none, which keeps the draft
 * readable as one.
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

/** The values each placeholder takes, from the installation's `LEGAL_*` settings (`GET /api/app/legal`). */
function values(facts: LegalFacts | undefined, lang: LegalLang): Record<string, string> {
  const empty = LEGAL_PLACEHOLDER[lang];
  const or = (value: string | null | undefined) => (value?.trim() ? value.trim() : empty);
  const days = (n: number | undefined, fallback: number) => String(n === undefined || Number.isNaN(n) ? fallback : n);
  return {
    legalName: or(facts?.companyName),
    cnpj: or(facts?.taxId),
    address: or(facts?.address),
    dpo: or(facts?.dpoName),
    dpoEmail: or(facts?.dpoEmail),
    serverLocation: or(facts?.serverLocation),
    logRetention: or(facts?.logRetention),
    backupRetentionDays: days(facts?.backupRetentionDays, 14),
    voiceRetentionDays: days(facts?.voiceRetentionDays, 90),
    // The optional processor's names, each of which the installation turns on with an env var (Annex II), are left to
    // whoever installs to fill in: the document says so and shows the same placeholder.
    modelProviderName: empty,
    whatsappGateway: empty,
    emailProvider: empty,
    storageProvider: empty,
    mediaProvider: empty,
    liveVoiceProvider: empty,
    speechProvider: empty,
    pushProvider: empty,
    integratorProvider: empty,
    embeddingsProvider: empty,
    errorProvider: empty,
    telemetryProvider: empty,
    billingProvider: empty,
    hostingProvider: empty,
  };
}

/** `text` with every `{{field}}` replaced (an unknown field stays as written, so a reviewer sees the mistake). */
export function fillLegal(source: string, facts: LegalFacts | undefined, lang: LegalLang): string {
  const map = values(facts, lang);
  return source.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, name: string) => map[name] ?? whole);
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
