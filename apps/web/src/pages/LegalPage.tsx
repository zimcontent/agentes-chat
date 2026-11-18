import { useLegalFacts } from "@agenteschat/client";
import { headingId, parseMarkdown } from "@agenteschat/client/lib/markdown";
import { Alert, Logo, Select } from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BRAND } from "@/docs/doug-docs";
import { type LocaleCode, usePageT } from "@/i18n";
import { fillLegal, type LegalDoc, type LegalLang, legalText, stripDraftBanner } from "@/legal/text";
import { useDocumentTitle } from "@/lib/desktop";
import { Markdown } from "@/lib/markdown";
import "./legal.css";

const LANGS: { value: LegalLang; label: string }[] = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "en", label: "English" },
];

/** The two documents' pages and the other one's, for the link at the foot. */
const PATHS: Record<LegalDoc, { pt: string; en: string }> = {
  terms: { pt: "/termos", en: "/terms" },
  privacy: { pt: "/privacidade", en: "/privacy" },
};

/** The first `#` heading of a document, its title. */
function docTitle(source: string): string {
  const first = parseMarkdown(source, { details: true })[0];
  return first?.type === "heading" ? first.text.trim() : "";
}

/** The `##` sections of a document, for the contents list: each id matches what `Markdown` gives its heading. */
function docSections(source: string): { id: string; heading: string }[] {
  return parseMarkdown(source, { details: true }).flatMap((b) =>
    b.type === "heading" && b.level === 2 ? [{ id: `h-${headingId(b.text)}`, heading: b.text.trim() }] : [],
  );
}

/**
 * DougBot's Terms of Use and Privacy Policy (`/termos`, `/privacidade`, and their English addresses `/terms` and
 * `/privacy`): public pages and no sign-in needed. The text is the Markdown under `docs/legal/`, so legal review
 * edits the files and not the code (`@/legal/text`). The company's own fields (`LEGAL_*`, `GET /api/app/legal`) are
 * filled in where the server has them, and read `[a preencher]` where it does not, which keeps the draft a draft.
 */
export function LegalPage({ kind, lang: initial }: { kind: LegalDoc; lang: LegalLang }) {
  const [lang, setLang] = useState<LegalLang>(initial);
  const facts = useLegalFacts().data;
  const t = usePageT(lang as LocaleCode);
  const { t: words } = useTranslation();
  const other: LegalDoc = kind === "terms" ? "privacy" : "terms";
  const text = useMemo(() => stripDraftBanner(fillLegal(legalText(kind, lang), facts, lang)), [kind, lang, facts]);
  const title = useMemo(() => docTitle(text), [text]);
  const sections = useMemo(() => docSections(text), [text]);
  const otherTitle = useMemo(() => docTitle(fillLegal(legalText(other, lang), facts, lang)), [other, lang, facts]);
  useDocumentTitle(title ? `${title} · ${BRAND}` : BRAND);

  return (
    <div className="legal" lang={lang}>
      <header className="legal__bar">
        <Link to="/" aria-label={t("legal.home")}>
          <Logo size={24} />
        </Link>
        <Select
          size="sm"
          aria-label={words("shell.language")}
          value={lang}
          onValueChange={(v) => setLang(v === "en" ? "en" : "pt-BR")}
          options={LANGS}
        />
      </header>
      <main className="page page--narrow">
        <header className="legal__head">
          <h1 className="page-title">{title}</h1>
          <Alert tone="neutral" className="legal__draft">
            {t("legal.draft")}
          </Alert>
        </header>
        {sections.length > 2 && (
          <nav className="legal__toc" aria-label={t("legal.contents")}>
            <ol>
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>{s.heading}</a>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <article className="md legal__doc">
          <Markdown source={text} title={title} />
        </article>
        <footer className="legal__foot">
          <Link to={PATHS[other][lang === "en" ? "en" : "pt"]}>{otherTitle}</Link>
        </footer>
      </main>
    </div>
  );
}
