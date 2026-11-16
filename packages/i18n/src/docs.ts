import type { AppLocale } from "./locale";

/** The public docs site (the landing): the same for every edition, self-hosted servers included. */
export const DOCS_SITE = "https://agentes.chat";

/** The landing's language folders: English at the root, Chinese under `zh/`, Portuguese under `pt/`. */
const FOLDER: Partial<Record<AppLocale, string>> = { en: "", "pt-BR": "pt/", "zh-Hans": "zh/" };

/** A docs page (the index without `slug`) in `locale`, at a section. */
export const docsUrl = (locale: AppLocale, slug?: string, section?: string) =>
  `${DOCS_SITE}/${FOLDER[locale] ?? `${locale}/`}docs${slug ? `/${slug}` : ""}${section ? `#${section}` : ""}`;

/**
 * DougBot: this instance's own site, where a person is sent to read. Its app serves the same help pages under its own
 * name (`/docs`, `/docs/<page>`) and its own download page (`/download`), so the apps' links stay here instead of
 * leaving for the original project's site. `DOCS_SITE` above stays for what must name that project: the "based on"
 * line of the About screen and the installer's own pointers.
 */
export const BRAND_SITE = "https://time.zimcontent.com";

/** A help page on this instance's site (the index without `slug`), at a section: the page reads the reader's language. */
export const appDocsUrl = (slug?: string, section?: string) =>
  `${BRAND_SITE}/docs${slug ? `/${slug}` : ""}${section ? `#${section}` : ""}`;

/** The desktop app's download page, on this instance's site. */
export const DOWNLOAD_URL = `${BRAND_SITE}/download`;
