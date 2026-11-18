import { useLegalFacts } from "@agenteschat/client";
import { headingId, parseMarkdown } from "@agenteschat/client/lib/markdown";
import { Alert, Logo, Select, Skeleton, SkeletonGroup } from "@agenteschat/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
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
 * filled in where the server has them, and read `[a preencher]` where it does not, and each paragraph that depends on
 * a setting (a backup bucket, the usage report, an outside service) shows only where the server has it. The language
 * is the address's: the switch moves to the other language's address, so a link shared from here opens in the same one.
 */
export function LegalPage({ kind, lang }: { kind: LegalDoc; lang: LegalLang }) {
  const navigate = useNavigate();
  const loaded = useLegalFacts();
  const facts = loaded.data;
  const t = usePageT(lang as LocaleCode);
  const { t: words } = useTranslation();
  const other: LegalDoc = kind === "terms" ? "privacy" : "terms";
  const ready = facts !== undefined;
  const text = useMemo(
    () => (ready ? stripDraftBanner(fillLegal(legalText(kind, lang), facts, lang)) : ""),
    [kind, lang, facts, ready],
  );
  const title = useMemo(() => docTitle(text), [text]);
  const sections = useMemo(() => docSections(text), [text]);
  const otherTitle = useMemo(() => docTitle(fillLegal(legalText(other, lang), facts, lang)), [other, lang, facts]);
  // The static heading of the document (before the facts arrive) keeps the tab and the page from showing nothing.
  const heading = title || docTitle(legalText(kind, lang));
  useDocumentTitle(heading ? `${heading} · ${BRAND}` : BRAND);
  // The page's language is the document's, for screen readers and the browser's hyphenation, and the app's own comes back.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.lang;
    root.lang = lang;
    return () => {
      root.lang = before;
    };
  }, [lang]);

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
          onValueChange={(v) => {
            const next = v === "en" ? "en" : "pt-BR";
            if (next !== lang) void navigate({ to: PATHS[kind][next === "en" ? "en" : "pt"], replace: true });
          }}
          options={LANGS}
        />
      </header>
      <main className="page page--narrow">
        <header className="legal__head">
          <h1 className="page-title">{heading}</h1>
          {facts?.draft && (
            <Alert tone="neutral" className="legal__draft">
              {t("legal.draft")}
            </Alert>
          )}
        </header>
        {!ready && (
          <SkeletonGroup label={t("common.loading")} className="legal__loading">
            <Skeleton width="100%" height={14} />
            <Skeleton width="92%" height={14} />
            <Skeleton width="96%" height={14} />
            <Skeleton width="60%" height={14} />
          </SkeletonGroup>
        )}
        {ready && sections.length > 2 && (
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
        {ready && (
          <article className="md legal__doc">
            <Markdown source={text} title={title} />
          </article>
        )}
        <footer className="legal__foot">
          <Link to={PATHS[other][lang === "en" ? "en" : "pt"]}>{otherTitle}</Link>
        </footer>
      </main>
    </div>
  );
}
