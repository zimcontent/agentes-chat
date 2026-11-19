import { requestLocale } from "@dougbot/engine";
import { serverText } from "@dougbot/i18n";
import { type AppLocale, appLocale } from "@dougbot/i18n/locale";
import { filePath } from "@dougbot/tokens/message-links";
import { dougMark } from "@dougbot/ui/brand/dougbot-files";
import type { Context, MiddlewareHandler } from "hono";
import { signInPage } from "../routes/app/context";

/**
 * A link a person opens in a browser (a file, a download, an export, an invite, a provider's return) that the API
 * answers with an error: a page in the product's look and the person's language, with the real cause and one way
 * out, in place of the JSON (ADR 0157). Same status. Programs (the apps, agents, scripts) keep the JSON.
 */

/** A person's browser opening an address (a link, the address bar), never a program reading JSON or a download. */
export function isPageRequest(headers: Headers, method: string): boolean {
  if (method !== "GET") return false;
  const mode = headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate" && (headers.get("sec-fetch-dest") ?? "document") === "document";
  const accept = headers.get("accept") ?? "";
  const html = accept.indexOf("text/html");
  const json = accept.indexOf("application/json");
  return html >= 0 && (json < 0 || html < json);
}

export type PageCause = "signIn" | "file" | "link" | "version" | "format" | "busy" | "server" | "other";

/** What went wrong, from the API's answer: a file's absence and no access to it are one cause, as the API keeps them. */
export function causeOf(status: number, code: string, path: string): PageCause {
  if (status === 401) return "signIn";
  if (code === "artifact.version_not_found") return "version";
  if (code === "artifact.format_unavailable") return "format";
  if (status === 429) return "busy";
  if (status >= 500) return "server";
  if (status === 403 || status === 404 || status === 410) return /\/artifacts\//.test(path) ? "file" : "link";
  return "other";
}

/** The page's language: the person's saved one when signed in, else the landing's cookie, else the browser's. */
export function pageLocale(c: Context): AppLocale {
  const saved = (c.var as { user?: { locale?: string | null } }).user?.locale;
  const cookie = /(?:^|;\s*)agentes_locale=([\w-]+)/.exec(c.req.header("cookie") ?? "")?.[1];
  return appLocale([saved, cookie]) ?? requestLocale(c.req.header("accept-language")) ?? "en";
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);

/**
 * The app's signature (`Logo` in packages/ui): the Doug close up, as the identity's code draws him, then the name.
 * Drawn in the page itself: nothing loads.
 */
const LOGO = `<span class="logo" role="img" aria-label="DougBot">${dougMark("dbe")}<span aria-hidden="true"><b>Doug</b>Bot</span></span>`;

/** DougBot's colors (packages/ui/src/styles/dougbot-tokens.css): dark is the identity's own, light from the system. */
const DARK =
  "--db-palco:#0a0a0a;--db-palco-2:#121212;--db-linha:#262626;--db-texto:#ededed;--db-texto-2:#999999;--db-texto-3:#6b6b6b;--db-verde-acento:#9cfa05";
const LIGHT =
  "--db-palco:#f4f6f2;--db-palco-2:#ffffff;--db-linha:#dde0d8;--db-texto:#0a0a0a;--db-texto-2:#565a52;--db-texto-3:#8a8e85;--db-verde-acento:#3f6600";

const CSS = `:root{color-scheme:dark;${DARK};--db-verde:#9cfa05;--db-verde-tinta:#0a0a0a;--db-verde-botao:linear-gradient(180deg,#c5ff52,#9cfa05 55%,#84e407);--font-sans:Onest,"Segoe UI",system-ui,sans-serif}
@media (prefers-color-scheme:light){:root{color-scheme:light;${LIGHT}}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:flex;justify-content:center;padding:96px 16px 34vh;background:radial-gradient(60% 45% at 50% 42%,color-mix(in srgb,var(--db-verde-acento) 8%,transparent),transparent 70%),var(--db-palco);color:var(--db-texto);font:15px/1.5 var(--font-sans);-webkit-font-smoothing:antialiased}
.logo{position:absolute;top:24px;left:28px;display:inline-flex;align-items:center;gap:.36em;font:500 22px/1 Manrope,var(--font-sans);letter-spacing:-.035em}
.logo svg{width:1.42em;height:1.42em;flex:none}
.logo b{font-weight:800}
main{display:flex;flex-direction:column;align-items:flex-start;gap:12px;width:min(100%,460px);margin:auto 0}
h1{margin:0;font-size:24px;line-height:30px;font-weight:700;letter-spacing:-.03em;text-wrap:balance}
p{margin:0;color:var(--db-texto-2)}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-self:stretch;margin-top:8px}
.btn{display:inline-flex;align-items:center;justify-content:center;height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--db-linha);background:var(--db-palco-2);color:var(--db-texto);font-size:14px;font-weight:600;line-height:normal;text-decoration:none}
.btn--primary{border-color:transparent;background:var(--db-verde-botao);color:var(--db-verde-tinta);box-shadow:0 6px 22px color-mix(in srgb,var(--db-verde) 22%,transparent)}
.btn:hover{filter:brightness(1.06)}
.btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--db-palco),0 0 0 4px var(--db-verde-acento)}
.id{font-size:13px;color:var(--db-texto-3);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
@media (max-width:639px){body{padding-top:72px}.logo{top:20px;left:16px}.btn{flex:1 1 100%}}`;

/** Only its own styles: nothing else loads, nothing runs. */
export const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export interface ErrorPageInput {
  cause: PageCause;
  locale: AppLocale;
  /** Where its one way out goes: sign in and come back, the latest version, this address again, the app. */
  action: string;
  /** The request's id, said on a failure of ours. */
  errorId?: string;
}

/** The button each cause offers. */
const ACTION_KEY: Record<PageCause, string> = {
  signIn: "signIn",
  file: "open",
  link: "open",
  version: "latest",
  format: "file",
  busy: "retry",
  server: "retry",
  other: "open",
};

export function errorPageHtml({ cause, locale, action, errorId }: ErrorPageInput): string {
  const say = (key: string, vars?: Record<string, string>) => escapeHtml(serverText(locale, `linkErrors.${key}`, vars));
  const title = say(`${cause}.title`);
  const id = cause === "server" && errorId ? `<p class="id">${say("errorId", { id: errorId })}</p>` : "";
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
${LOGO}
<main>
<h1>${title}</h1>
<p>${say(`${cause}.text`)}</p>
${id}<div class="actions"><a class="btn btn--primary" href="${escapeHtml(action)}">${say(`action.${ACTION_KEY[cause]}`)}</a></div>
</main>
</body>
</html>`;
}

/** The app's address of a file (the Drive with it open), from a file route's path: `/api/app/organizations/<org>/artifacts/<id>/…`. */
function fileAppLink(base: string, path: string): string | null {
  const m = /^\/api\/app\/organizations\/([0-9a-f-]{36})\/artifacts\/([0-9a-f-]{36})(?:\/|$)/i.exec(path);
  return m?.[1] && m[2] ? `${base}${filePath(m[1], m[2])}` : null;
}

/**
 * After every API route: a browser's navigation answered with an API error gets the page instead, with the same
 * status. The JSON's code says the cause; the request decides the way out.
 */
export function errorPages(publicUrl: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const res = c.res;
    if (res.status < 400 || !isPageRequest(c.req.raw.headers, c.req.method)) return;
    const base = (publicUrl ?? new URL(c.req.url).origin).replace(/\/$/, "");
    if (!res.headers.get("content-type")?.startsWith("application/json")) return;
    const code = await res
      .clone()
      .json()
      .then((b: unknown) => {
        const said = (b as { error?: { code?: unknown } } | null)?.error?.code;
        return typeof said === "string" ? said : "";
      })
      .catch(() => "");
    const cause = causeOf(res.status, code, c.req.path);
    const file = fileAppLink(base, c.req.path);
    const here = `${base}${c.req.path}${new URL(c.req.url).search}`;
    const action =
      cause === "signIn"
        ? signInPage(base, here)
        : cause === "version" || cause === "format"
          ? (file ?? `${base}/`)
          : cause === "busy" || cause === "server"
            ? here
            : `${base}/`;
    const html = errorPageHtml({ cause, locale: pageLocale(c), action, errorId: c.get("requestId") as string });
    c.res = new Response(html, {
      status: res.status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": PAGE_CSP,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        vary: "accept, sec-fetch-mode, cookie",
      },
    });
  };
}
