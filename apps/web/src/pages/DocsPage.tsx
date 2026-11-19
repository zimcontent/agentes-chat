import type { HelpBlock } from "@dougbot/i18n/help";
import { Logo, Select } from "@dougbot/ui";
import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { CodeBlock } from "@/components/CodeBlock";
import { BRAND, DOC_GROUPS, type DocSlug, docInline, docPage, docSlug, docsWords } from "@/docs/doug-docs";
import { type LocaleCode, locales, usePageT } from "@/i18n";
import { useDocumentTitle } from "@/lib/desktop";
import "./legal.css";
import "./docs.css";

/**
 * DougBot's docs (`/docs`, `/docs/<page>`), public: the help pages of `@/docs/doug-docs` in the reader's language,
 * with the menu of every page beside them. Without `slug`, the list of pages.
 */
export function DocsPage({ slug }: { slug?: DocSlug }) {
  const { i18n } = useTranslation();
  const [lang, setLang] = useState<LocaleCode>(i18n.language as LocaleCode);
  const t = usePageT(lang);
  const words = docsWords(lang);
  const page = slug ? docPage(slug, lang) : undefined;
  useDocumentTitle(page ? `${page.title} · ${BRAND}` : words.title);

  return (
    <div className="legal docs" lang={lang}>
      <header className="legal__bar">
        <Link to="/" aria-label={t("legal.home")}>
          <Logo size={24} />
        </Link>
        <Select
          size="sm"
          aria-label={t("shell.language")}
          value={lang}
          onValueChange={(v) => setLang(v as LocaleCode)}
          options={locales.map((l) => ({ value: l.code, label: l.label }))}
        />
      </header>
      <div className="docs__body">
        {page && (
          <nav className="docs__menu" aria-label={words.menu}>
            <Link to="/docs" className="docs__menu-home">
              {words.short}
            </Link>
            <Menu lang={lang} current={page.slug} />
          </nav>
        )}
        <main className="page page--narrow docs__main">
          {page ? (
            <>
              <header className="legal__head">
                <Link to="/docs" className="docs__back">
                  {words.short}
                </Link>
                <h1 className="page-title">{page.title}</h1>
                <p className="page-sub">{page.summary}</p>
              </header>
              {page.sections.length > 2 && (
                <nav className="legal__toc" aria-label={t("legal.contents")}>
                  <ol>
                    {page.sections.map((s) => (
                      <li key={s.id}>
                        <a href={`#${s.id}`}>{s.heading}</a>
                      </li>
                    ))}
                  </ol>
                </nav>
              )}
              <article className="md legal__doc">
                {page.sections.map((s) => (
                  <Fragment key={s.id}>
                    <h2 id={s.id}>{s.heading}</h2>
                    {s.blocks.map((b, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: the text is fixed, its order never changes
                      <Block key={i} block={b} named={s.named} />
                    ))}
                  </Fragment>
                ))}
              </article>
            </>
          ) : (
            <>
              <header className="legal__head">
                <h1 className="page-title">{words.title}</h1>
                <p className="page-sub">{words.summary}</p>
              </header>
              <Menu lang={lang} summaries />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/** Every page by group: the menu beside a page (`current` marked), or the list of the first page with each summary. */
function Menu({ lang, current, summaries }: { lang: LocaleCode; current?: DocSlug; summaries?: boolean }) {
  const words = docsWords(lang);
  return (
    <div className={summaries ? "docs__groups docs__groups--list" : "docs__groups"}>
      {DOC_GROUPS.map((group) => (
        <section key={group.id} className="docs__group">
          <h2 className="docs__group-name">{words.groups[group.id]}</h2>
          <ul>
            {group.pages.map((slug) => {
              const page = docPage(slug, lang);
              return (
                <li key={slug}>
                  <Link
                    to="/docs/$slug"
                    params={{ slug }}
                    className="docs__item"
                    aria-current={slug === current ? "page" : undefined}
                  >
                    <span className="docs__item-title">{page.title}</span>
                    {summaries && <span className="docs__item-sub">{page.summary}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Block({ block, named }: { block: HelpBlock; named: boolean }) {
  if (typeof block === "string") return <Inline line={block} named={named} />;
  if ("code" in block) return <CodeBlock lang="sh" text={docInlineCode(block.code)} />;
  return (
    <ul>
      {block.list.map((item) => (
        <li key={item}>
          <Inline line={item} named={named} bare />
        </li>
      ))}
    </ul>
  );
}

/** A command block: the installer's address is this server's. */
const docInlineCode = (code: string) => {
  const [part] = docInline(`\`${code.replaceAll("`", "'")}\``, window.location.origin);
  return part?.kind === "code" ? part.text : code;
};

function Inline({ line, named, bare }: { line: string; named: boolean; bare?: boolean }) {
  const parts = docInline(line, window.location.origin, named).map((p, i): ReactNode => {
    // biome-ignore lint/suspicious/noArrayIndexKey: pieces of one fixed line
    if (p.kind === "bold") return <strong key={i}>{p.text}</strong>;
    if (p.kind === "code")
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: pieces of one fixed line
        <code key={i} className="ac-inlinecode">
          {p.text}
        </code>
      );
    // biome-ignore lint/suspicious/noArrayIndexKey: pieces of one fixed line
    if (p.kind === "link") return <DocLink key={i} href={p.href} text={p.text} />;
    // biome-ignore lint/suspicious/noArrayIndexKey: pieces of one fixed line
    return <Fragment key={i}>{p.text}</Fragment>;
  });
  return bare ? parts : <p>{parts}</p>;
}

/** A link of a page: another docs page and the download page stay in the app, the rest opens outside. */
function DocLink({ href, text }: { href: string; text: string }) {
  const [path = "", hash] = href.split("#");
  const to = path.startsWith("/docs/") ? docSlug(path.slice("/docs/".length)) : undefined;
  if (to)
    return (
      <Link to="/docs/$slug" params={{ slug: to }} hash={hash} className="ac-link">
        {text}
      </Link>
    );
  if (path === "/download")
    return (
      <Link to="/download" className="ac-link">
        {text}
      </Link>
    );
  if (href.startsWith("#") || href.startsWith("mailto:"))
    return (
      <a href={href} className="ac-link">
        {text}
      </a>
    );
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="ac-link">
      {text}
    </a>
  );
}
