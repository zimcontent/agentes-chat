import { BRAND_NAME } from "@agenteschat/i18n/brand";
import {
  type HelpBlock,
  type HelpDocument,
  type HelpInline,
  type HelpSlug,
  helpDocument,
  helpInline,
  isHelpSlug,
} from "@agenteschat/i18n/help";

/**
 * DougBot's own docs (`/docs`): the help pages this repository already holds (`@agenteschat/i18n/help`), shown under
 * DougBot's name. The pages' text stays as the original project wrote it, in every language, so its updates keep
 * arriving: the name is swapped as a page is read (`brandProse`), and the one page that says where the work comes
 * from (`open-source`, the attribution the NOTICE asks for) is written here.
 */
export const BRAND = BRAND_NAME;

export const ABOUT_SLUG = "open-source";
export type DocSlug = HelpSlug | typeof ABOUT_SLUG;

/** The docs' menu, in order: each group and its pages. */
export const DOC_GROUPS: { id: "using" | "cloud" | "selfhost" | "about"; pages: DocSlug[] }[] = [
  { id: "using", pages: ["import", "wiki", "memory", "approvals", "who-answers", "apps-de-ia", "computers"] },
  { id: "cloud", pages: ["workspace-computer"] },
  { id: "selfhost", pages: ["install-on-a-server", "run-on-your-computer", "jev"] },
  { id: "about", pages: [ABOUT_SLUG] },
];

/** Addresses the original site uses for a page that has another name here. */
const ALIASES: Record<string, DocSlug> = { "ai-apps": "apps-de-ia" };

export function docSlug(slug: string): DocSlug | undefined {
  if (slug === ABOUT_SLUG || isHelpSlug(slug)) return slug;
  return ALIASES[slug];
}

/**
 * Sections that keep the original project's name: they say where a self-hosted server sends its usage report, and
 * that address is the original project's (`TELEMETRY_URL`). Another name there would be a false statement.
 */
const NAMED: Partial<Record<DocSlug, string[]>> = { "install-on-a-server": ["data"] };

const NAME = /agentes\.chat/g;
/** The installer and its compose file, which this server hands out itself (`/install`). */
const INSTALL = /https:\/\/agentes\.chat\/install/g;

/**
 * The other project's own package and image (`npx @agenteschat/setup`, its container registry): a second way to run
 * the same setup as the installer. DougBot publishes neither under its name, so those blocks stay out.
 */
const THEIRS = /@agenteschat\/|ghcr\.io\/agentes-chat\//;
const ours = (block: HelpBlock) => !THEIRS.test(typeof block === "string" ? block : "code" in block ? block.code : "");

/** Words a person reads: the product's name becomes DougBot. */
export const brandProse = (text: string) => text.replace(NAME, BRAND);

/**
 * A command or a value to type: only the installer's address changes, to this server's. Folder, program, package and
 * image names stay as they are on disk and in the registry, or the command wouldn't run.
 */
export const brandCode = (text: string, origin: string) => text.replace(INSTALL, `${origin}/install`);

/** Where a link of the pages goes here: `/help/<page>` is `/docs/<page>`, the rest as written. */
export const docHref = (href: string) => href.replace(/^\/help(?=\/|$)/, "/docs");

/** A line as pieces to draw, already under DougBot's name. */
export function docInline(line: string, origin: string, named = false): HelpInline[] {
  const words = (text: string) => (named ? text : brandProse(text));
  return helpInline(line).map((part) =>
    part.kind === "code"
      ? { ...part, text: brandCode(part.text, origin) }
      : part.kind === "link"
        ? { ...part, text: words(part.text), href: docHref(part.href) }
        : { ...part, text: words(part.text) },
  );
}

export interface DocSection {
  id: string;
  heading: string;
  blocks: HelpBlock[];
  /** Keeps the original project's name (`NAMED`). */
  named: boolean;
}
export interface DocPage {
  slug: DocSlug;
  title: string;
  summary: string;
  sections: DocSection[];
}

/** A docs page in `locale` (English where that language has none), its headings under DougBot's name. */
export function docPage(slug: DocSlug, locale: string): DocPage {
  const doc: HelpDocument = slug === ABOUT_SLUG ? aboutPage(locale) : helpDocument(slug, locale);
  const named = slug === ABOUT_SLUG ? doc.sections.map((s) => s.id) : (NAMED[slug] ?? []);
  const words = (text: string) => (slug === ABOUT_SLUG ? text : brandProse(text));
  return {
    slug,
    title: words(doc.title),
    summary: words(doc.summary),
    sections: doc.sections.map((s) => ({
      id: s.id,
      heading: words(s.heading),
      blocks: slug === ABOUT_SLUG ? s.blocks : s.blocks.filter(ours),
      named: named.includes(s.id),
    })),
  };
}

const portuguese = (locale: string) => locale.toLowerCase().startsWith("pt");

/** The docs' own words (menu, titles), in Portuguese and English: the pages themselves come in every language. */
export function docsWords(locale: string) {
  return portuguese(locale)
    ? {
        title: `Documentação do ${BRAND}`,
        summary: `Como o ${BRAND} funciona: computadores, importação, wiki, memória, aprovações, quem responde e como rodar o seu.`,
        short: "Documentação",
        menu: "Páginas da documentação",
        groups: { using: `Usando o ${BRAND}`, cloud: `${BRAND} Cloud`, selfhost: "No seu servidor", about: "Sobre" },
      }
    : {
        title: `${BRAND} docs`,
        summary: `How ${BRAND} works: computers, importing, the wiki, memory, approvals, who answers and how to run your own.`,
        short: "Docs",
        menu: "Docs pages",
        groups: { using: `Using ${BRAND}`, cloud: `${BRAND} Cloud`, selfhost: "On your server", about: "About" },
      };
}

/** Where DougBot comes from: the attribution of the NOTICE (AGPL-3.0 section 7(b)), with our name beside it. */
function aboutPage(locale: string): HelpDocument {
  return portuguese(locale)
    ? {
        title: "Código aberto",
        summary: `O ${BRAND} é feito sobre um projeto de código aberto.`,
        sections: [
          {
            id: "based-on",
            heading: "De onde vem",
            blocks: [
              `O ${BRAND} é baseado no agentes.chat, da Codari Global, LLC (https://agentes.chat), um projeto de código aberto sob a licença AGPL-3.0.`,
              "Esta documentação parte da documentação desse projeto, adaptada ao nosso produto.",
            ],
          },
          {
            id: "ours",
            heading: "O que é nosso",
            blocks: [
              `O nome ${BRAND}, a identidade visual e as mudanças feitas sobre o projeto são nossos.`,
              "“agentes”, “agentes.chat” e os logotipos deles são marcas da Codari Global, LLC, citadas aqui só para dizer de onde o trabalho vem.",
            ],
          },
          {
            id: "license",
            heading: "Licença e código-fonte",
            blocks: [
              `O ${BRAND} é distribuído sob a mesma licença, a AGPL-3.0. O código-fonte desta versão está em **Configurações › Sobre**, em **Código-fonte**.`,
            ],
          },
        ],
      }
    : {
        title: "Open source",
        summary: `${BRAND} is built on an open source project.`,
        sections: [
          {
            id: "based-on",
            heading: "Where it comes from",
            blocks: [
              `${BRAND} is based on agentes.chat by Codari Global, LLC (https://agentes.chat), an open source project under the AGPL-3.0 license.`,
              "These docs start from that project's docs, adapted to our product.",
            ],
          },
          {
            id: "ours",
            heading: "What is ours",
            blocks: [
              `The ${BRAND} name, the visual identity and the changes made on top of the project are ours.`,
              "“agentes”, “agentes.chat” and their logos are trademarks of Codari Global, LLC, named here only to say where the work comes from.",
            ],
          },
          {
            id: "license",
            heading: "License and source code",
            blocks: [
              `${BRAND} is distributed under the same license, AGPL-3.0. This version's source code is in **Settings › About**, under **Source code**.`,
            ],
          },
        ],
      };
}
