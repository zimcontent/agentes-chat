import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createFakeEmailSender, EmailError } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import {
  createJobHandlers,
  defaultEmailFrom,
  drainOutbox,
  EMAIL_DARK_HEAD,
  EMAIL_PICTURES,
  type EmailArt,
  type EmailTemplate,
  emailArtAt,
  emailArtFor,
  emailCrew,
  grantScopes,
  postPersonMessage,
  queueApprovalDigests,
  queueBudgetEmail,
  queueEmail,
  queueInvitationEmail,
  renderEmail,
  sendQueuedEmail,
} from "../src";
import { BREAK } from "../src/email/inert";
import { EMAIL_SAMPLES } from "./email-samples";
import { addMember, type Fixture, setup } from "./fixtures";
import { ALL_GITHUB_SCOPES, fakeGithub } from "./tool-fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const art = emailArtAt("https://x.test");
const WEB_DIR = resolve(import.meta.dir, "../../../apps/web/public");
/** Every field people type or agents write. */
const TYPED = [
  "orgName",
  "inviterName",
  "inviterEmail",
  "email",
  "newEmail",
  "title",
  "agentName",
  "name",
  "approverName",
  "reason",
  "byName",
  "appName",
];
const SENTINEL = "Zq9 evil.com";
const withoutUrls = (s: string) => s.replace(/https?:\/\/\S+/g, "");
/** The headline as it reads: its last words keep together in a span of their own. */
const headline = (html: string) =>
  (html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1] ?? "?").replace(/<[^>]+>/g, "").replaceAll("&#39;", "'");
const buttons = (t: EmailTemplate) =>
  [...renderEmail(t, art).html.matchAll(/<a class="btn" href="([^"]*)"[^>]*>.*?<span[^>]*>([^<]*)<\/span>/g)].map(
    (m) => ({ url: (m[1] ?? "").replaceAll("&amp;", "&"), label: (m[2] ?? "").replaceAll("&#39;", "'") }),
  );

function poisoned(t: EmailTemplate, value = SENTINEL): EmailTemplate {
  const o = structuredClone(t) as Record<string, unknown>;
  for (const k of TYPED) if (typeof o[k] === "string") o[k] = value;
  if (Array.isArray(o.items)) o.items = o.items.map((i) => ({ ...i, agentName: value, title: value }));
  if (Array.isArray(o.orgNames)) o.orgNames = o.orgNames.map(() => value);
  for (const side of ["was", "now"]) if (o[side]) o[side] = { ...(o[side] as object), names: [value] };
  for (const list of ["topStalls", "topNoise"])
    if (Array.isArray(o[list])) o[list] = (o[list] as object[]).map((w) => ({ ...w, name: value }));
  return o as EmailTemplate;
}

describe("every email, in both languages", () => {
  for (const [id, sample] of Object.entries(EMAIL_SAMPLES)) {
    for (const locale of ["en", "pt-BR"] as const) {
      const t = { ...sample, locale } as EmailTemplate;
      test(`${id} in ${locale}`, () => {
        const e = renderEmail(t, art);
        expect(e.html).toContain(`<html lang="${locale}"`);
        expect(e.preheader.length).toBeGreaterThanOrEqual(10);
        expect(e.html).toMatch(
          new RegExp(
            `<body[^>]*>\\n<div style="[^"]*">${e.preheader.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "&#39;")}`,
          ),
        );
        expect(e.text.startsWith(headline(e.html))).toBe(true);
        for (const b of buttons(t)) expect(e.text).toContain(`${b.label}: ${b.url}`);
        expect(`${e.subject}${e.html}${e.text}`).not.toMatch(/undefined|null|\{\w+\}/);
        expect(e.html.length).toBeLessThan(60_000);
        for (const [, css = ""] of e.html.matchAll(/<style>([\s\S]*?)<\/style>/g))
          expect(css.length).toBeLessThan(8_000);
        // The other language never leaks in (a reset link holds "password").
        expect(withoutUrls(e.text)).not.toMatch(
          locale === "en" ? /você|convite|senha|e-mail/i : /\b(you|invitation|password)\b/i,
        );
        // Our words only in the subject, preheader, headline and buttons; typed words inert in the body.
        const p = renderEmail(poisoned(t), art);
        for (const s of [p.subject, p.preheader, headline(p.html)]) {
          expect(s).not.toContain("Zq9");
        }
        for (const b of buttons(poisoned(t))) expect(b.label).not.toContain("Zq9");
        expect(p.html).not.toContain("evil.com");
        expect(p.text).not.toContain("evil.com");
        // No em dashes or semicolons in our words.
        expect([e.subject, e.preheader, e.text].join("\n")).not.toMatch(/—|;/);
      });
    }
    test(`${id}: snapshot`, () => {
      expect(renderEmail(sample, art).html).toMatchSnapshot();
    });
  }

  test("every kind has a sample, so the preview and a send to a test inbox show them all", () => {
    const kinds: Record<EmailTemplate["kind"], true> = {
      verify_email: true,
      password_reset: true,
      invitation: true,
      invite_request: true,
      calendar_invite: true,
      waitlist_confirm: true,
      early_access: true,
      early_access_allowed: true,
      budget: true,
      approval_digest: true,
      computer_ready: true,
      join_request: true,
      join_answer: true,
      join_code: true,
      deletion_code: true,
      email_change_code: true,
      email_change_link: true,
      email_changed: true,
      workspace_deleting: true,
      workspace_restored: true,
      account_deleted: true,
      account_deleting: true,
      app_connected: true,
      plan_opened: true,
      plan_lent: true,
      plan_waiting: true,
      support_request: true,
      autonomy_report: true,
    };
    expect(new Set<string>(Object.values(EMAIL_SAMPLES).map((t) => t.kind))).toEqual(new Set(Object.keys(kinds)));
  });
});

describe("a support request's own words", () => {
  const request = (text: string, email = "ana@souzabakery.com"): EmailTemplate => ({
    kind: "support_request",
    locale: "en",
    url: "https://x.test",
    name: "Ana Souza",
    email,
    orgName: "Souza Bakery",
    text,
    agent: { name: "Ada", handle: "ada" },
    clientCode: "064",
    version: "1.2.3",
  });
  const body = (html: string) =>
    [...html.matchAll(/<p class="tx"[^>]*>(.*?)<\/p>/g)].map((m) => (m[1] ?? "").replace(/<[^>]+>/g, ""));

  test("past the 64 characters every other typed text keeps, all of it goes", () => {
    const words =
      "The invoicing routine stopped posting last week, and since Monday nobody in the bakery has seen a single new invoice come through.";
    expect(words.length).toBeGreaterThan(64);
    expect(body(renderEmail(request(words)).html)).toEqual([words]);
    expect(renderEmail(request(words)).text).toContain(words);
  });

  test("numbers stay as typed: an order id and a phone number are facts to read, not secrets", () => {
    const words = "Order 2026111800391 never arrived. The customer called 0800 591 2211 twice and nobody answered.";
    const { html, text } = renderEmail(request(words));
    expect(body(html)).toEqual([words]);
    expect(text).toContain("2026111800391");
    expect(text).toContain("0800 591 2211");
    expect(html).not.toContain("•");
  });

  test("their lines stay their paragraphs", () => {
    const { html, text } = renderEmail(request("First line.\n\nSecond paragraph."));
    expect(body(html)).toEqual(["First line.", "Second paragraph."]);
    expect(text).toContain("First line.\n\nSecond paragraph.");
  });

  test("a link in them is still no link", () => {
    const words = "It says to go to evil.com/fix and then reload the page.";
    const { html, text } = renderEmail(request(words));
    // The hair space after the dot keeps a client from reading it as a host, in both parts.
    expect(html).not.toContain("evil.com");
    expect(text).not.toContain("evil.com");
    expect(text).toContain(`evil.${BREAK}com`);
    // Nothing becomes an anchor of its own but the address under From.
    expect([...html.matchAll(/<a class="ln-m"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1])).toEqual(["ana@souzabakery.com"]);
  });

  test("the address under From is whole, and a mailto the client draws", () => {
    const { html } = renderEmail(request("Help.", "ana.souza@padariasouza.com.br"));
    expect(html).toContain('href="mailto:ana.souza@padariasouza.com.br"');
    expect(html).toContain(">ana.souza@padariasouza.com.br</a>");
    // Not one that is no address at all: it reads as typed, and links nothing.
    const odd = renderEmail(request("Help.", "not an address")).html;
    expect(odd).not.toContain("mailto:not an address");
    expect(odd.replace(/<[^>]+>/g, "")).toContain("Ana Souza &lt;not an address&gt;");
  });

  test("it goes in their name: the queue carries their address on Reply-To", async () => {
    f = await setup();
    const sender = createFakeEmailSender();
    await queueEmail(f.db, {
      orgId: f.org.id,
      key: `support:${crypto.randomUUID()}`,
      to: ["help@example.com"],
      replyTo: "ana@souzabakery.com",
      template: request("Help."),
    });
    await drainOutbox(f.db, createJobHandlers({ ...f.jobDeps, email: sender, emailArt: art }));
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.replyTo).toBe("ana@souzabakery.com");
    expect(sender.sent[0]?.to).toEqual(["help@example.com"]);
    // A `replyTo` that isn't an address is left out rather than handed to the provider.
    await queueEmail(f.db, {
      orgId: f.org.id,
      key: `support:${crypto.randomUUID()}`,
      to: ["help@example.com"],
      replyTo: "not an address",
      template: request("Help."),
    });
    await drainOutbox(f.db, createJobHandlers({ ...f.jobDeps, email: sender, emailArt: art }));
    expect(sender.sent[1]?.replyTo).toBeUndefined();
  });
});

describe("the look", () => {
  const verify = EMAIL_SAMPLES["verify_email.en"] as EmailTemplate;

  test("dark: every email carries our dark design and tells the Gmail apps to keep it light", () => {
    for (const [id, t] of Object.entries(EMAIL_SAMPLES)) {
      const { html } = renderEmail(t, art);
      expect(html, id).toContain(EMAIL_DARK_HEAD);
      // Gmail with an account that isn't Google's still darkens fills and text but leaves a gradient as drawn: none
      // inline, only the head's.
      expect(html, id).not.toMatch(/style="[^"]*linear-gradient/);
    }
  });

  test("dark: our design where clients apply an email's own, the bone logo hidden from classic Outlook", () => {
    const { html } = renderEmail(verify, art);
    // The meta keeps the Gmail apps light; `:root` keeps Apple Mail applying our dark design.
    expect(html).toContain('<meta name="color-scheme" content="light only">');
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark">');
    expect(html).toContain(":root{color-scheme:light dark;");
    expect(html).toContain("@media (prefers-color-scheme:dark){.bg{background:#0a0a0a!important}");
    expect(html).toContain("[data-ogsb] .logo-ink{display:none!important}");
    expect(html).toContain('<!--[if !mso]><!--><img class="logo-bone"');
  });

  test("the button is the app's primary at its large size, in layers a client can drop one by one", () => {
    const { html } = renderEmail(EMAIL_SAMPLES["join_request.en"] as EmailTemplate, art);
    const lift =
      "inset 0 1px 0 rgba(255,255,255,.9),inset 0 -2px 0 rgba(63,102,0,.22),0 1px 2px rgba(10,10,10,.14),0 8px 18px -8px rgba(63,102,0,.55)";
    // The flat green and the lift inline; the gradient only where a client reads the colour scheme.
    expect(html).toContain(`background-color:#9cfa05;border:1px solid #9cfa05;border-radius:14px;box-shadow:${lift}`);
    expect(html).toContain(
      "@media (prefers-color-scheme:light){.btn{background-image:linear-gradient(180deg,#c5ff52 0%,#9cfa05 55%,#84e407 100%)!important}}",
    );
    expect(html).not.toMatch(/style="[^"]*background-image/);
    expect(html).toContain("font-size:15px;line-height:20px;font-weight:600;text-decoration:none;padding:13px 15px");
    // Dark: the same green wherever our dark applies, and its gradient in a block of its own after Outlook's hooks.
    expect(html).toContain(".btn{background:#9cfa05!important;color:#0a0a0a!important;border-color:#9cfa05!important}");
    const gradient =
      "<style>\n@media (prefers-color-scheme:dark){.btn{background-image:linear-gradient(180deg,#c5ff52 0%,#9cfa05 55%,#84e407 100%)!important}}\n</style>";
    expect(html.indexOf(gradient)).toBeGreaterThan(html.lastIndexOf("[data-ogsb] "));
    // Classic Outlook: its spacers in em at the 15 px label, both labels raised alike, no exact line height on a link.
    expect(html).toContain('<i style="mso-font-width:107%;mso-text-raise:187%" hidden>&emsp;</i>');
    expect(html).toContain('<i style="mso-font-width:107%" hidden>&emsp;&#8203;</i>');
    expect(html).toContain('<span style="mso-text-raise:93%;color:#0a0a0a">Approve</span>');
    expect(html).toContain('<span style="mso-text-raise:93%">Deny</span>');
    expect(html).not.toMatch(/<a [^>]*mso-line-height-rule:exactly/);
    // Deny 16 px after the button, as the app spaces its actions. Four spaces where the width is ignored.
    expect(html).toContain(
      '<span style="display:inline-block;width:16px;font-size:15px;line-height:20px">&nbsp;&nbsp;&nbsp;&nbsp;</span><a class="ln-d"',
    );
  });

  test("the app's primary button is still the one the emails copy", () => {
    const styles = resolve(import.meta.dir, "../../ui/src/styles");
    // The identity's green button: its three greens, and the ink on it.
    const identity = readFileSync(`${styles}/dougbot-tokens.css`, "utf8");
    expect(identity).toContain("--db-verde-botao: linear-gradient(180deg, #c5ff52, #9cfa05 55%, #84e407);");
    expect(identity).toContain("--db-verde-tinta: #0a0a0a;");
    const css = readFileSync(`${styles}/doug.css`, "utf8");
    const at = css.indexOf("[data-theme] .ac-btn--primary {");
    const primary = css.slice(at, css.indexOf("}", at));
    expect(primary).toContain("background: var(--db-verde-botao);");
    expect(primary).toContain("color: var(--db-verde-tinta);");
    const tokens = readFileSync(`${styles}/tokens.css`, "utf8");
    for (const lg of ["--control-h-lg: 48px", "--control-r-lg: 14px", "--control-px-lg: 16px", "--control-fs-lg: 15px"])
      expect(tokens).toContain(lg);
  });

  test("the colours are the identity's, light and dark", () => {
    const identity = readFileSync(resolve(import.meta.dir, "../../ui/src/styles/dougbot-tokens.css"), "utf8");
    const [darkStage, lightStage = ""] = identity.split('[data-theme="light"]');
    const { html } = renderEmail(verify, art);
    // Light, inline: the page, the card, its edge, the words.
    for (const [token, used] of [
      ["--db-palco: #f4f6f2;", `<body class="body bg" style="margin:0;padding:0;width:100%;background:#f4f6f2;`],
      ["--db-palco-2: #ffffff;", `<td class="card" style="background:#ffffff;border:1px solid #dde0d8;`],
      ["--db-linha: #dde0d8;", "border:1px solid #dde0d8;"],
      ["--db-texto: #0a0a0a;", "font-weight:700;letter-spacing:-0.02em;color:#0a0a0a"],
      ["--db-texto-2: #565a52;", "color:#565a52"],
      ["--db-texto-leve: #62665e;", "color:#62665e"],
    ] as const) {
      expect(lightStage).toContain(token);
      expect(html).toContain(used);
    }
    // Dark, by class.
    for (const [token, used] of [
      ["--db-palco: #0a0a0a;", ".bg{background:#0a0a0a!important}"],
      ["--db-palco-2: #121212;", ".card{background:#121212!important;border-color:#262626!important}"],
      ["--db-texto: #ededed;", ".ink{color:#ededed!important}"],
      ["--db-texto-2: #999999;", ".mu{color:#999999!important}"],
      ["--db-texto-leve: #8a8a8a;", ".fa{color:#8a8a8a!important}"],
    ] as const) {
      expect(darkStage).toContain(token);
      expect(html).toContain(used);
    }
    // The headline in the identity's title face, the words in its text face.
    expect(html).toContain("<h1 class=\"h1 ink\" style=\"margin:0 0 16px;font-family:'Manrope','Inter',");
    // Nothing of the look this one replaced.
    expect(html).not.toMatch(/sky-band|logo-ink-tile|Source Sans|alt="agentes\.chat"|Sent by agentes/);
  });

  test("the preheader is hidden by display alone, never coloured like the page", () => {
    expect(renderEmail(verify, art).html).toContain(
      '<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all">One click to confirm',
    );
  });

  test("typed text is escaped and can't link, in both parts", () => {
    const e = renderEmail(
      {
        kind: "invitation",
        locale: "en",
        orgName: "Acme <script>",
        inviterName: "evil.com",
        url: "https://x/i",
        role: "member",
      },
      art,
    );
    expect(e.html).toContain("Acme &lt;script&gt;");
    expect(e.html).not.toContain("<script>");
    expect(e.text).toContain("Acme <script>");
    for (const part of [e.html, e.text]) {
      expect(part).not.toContain("evil.com");
      expect(part).toContain(`evil.${BREAK}com`);
    }
  });

  test("a long token in a typed title breaks, so it can't widen the card on a phone", () => {
    const { text } = renderEmail(EMAIL_SAMPLES["approval_digest-many.en"] as EmailTemplate, art);
    const line = text.split("\n").find((l) => l.startsWith("Atlas")) ?? "";
    expect(line).toContain("3f2a9c1e");
    expect(line).not.toMatch(/\S{31}/u);
    // "4 h ago" stays on one line.
    expect(line).toEndWith(" · 4\u00a0h\u00a0ago");
  });

  test("a long typed word wraps where it lands instead of widening the card, and never breaks a label", () => {
    const word = "W".repeat(30);
    const holders = new Set<string>();
    for (const sample of Object.values(EMAIL_SAMPLES)) {
      const { html } = renderEmail(poisoned(sample as EmailTemplate, word), art);
      for (const { index } of html.matchAll(new RegExp(word, "g"))) {
        const before = html.slice(0, index);
        const start = Math.max(before.lastIndexOf("<p "), before.lastIndexOf("<td "));
        const tag = html.slice(start, html.indexOf(">", start) + 1);
        expect(tag).toContain("word-break:break-word");
        holders.add(tag.slice(0, tag.indexOf(" style=")));
      }
      // With it, the table could squeeze a fact's label mid-word to make room for a long value.
      expect(html).not.toMatch(/<td class="mu[^>]*word-break/);
    }
    // Paragraphs, facts (first row and the rest), people's names and details, a note (a denial's reason), and the
    // footer.
    expect(holders.size).toBe(7);
  });

  test("an expired invitation link's request names nobody and still reads", () => {
    const { text } = renderEmail(EMAIL_SAMPLES["invite_request-link.en"] as EmailTemplate, art);
    expect(text).toContain("Someone with an expired invitation link to Souza Bakery asked for a new one.");
  });

  test("the join code: first in the subject, large in a well, alone on its line, and no button", () => {
    const sample = EMAIL_SAMPLES["join_code.en"] as Extract<EmailTemplate, { kind: "join_code" }>;
    for (const [locale, subject, body] of [
      ["en", "482913 is your DougBot code", "Type this code on the page to ask to join"],
      ["pt-BR", "482913 é seu código do DougBot", "Digite este código na página para pedir para entrar na"],
    ] as const) {
      const e = renderEmail({ ...sample, locale, orgName: "Acme evil.com" }, art);
      expect(e.subject).toBe(subject);
      expect(e.text).toContain(`\n\n${body} Acme evil.${BREAK}com.\n\n482913\n\n`);
      expect(e.html).toContain(
        'letter-spacing:8px;font-variant-numeric:tabular-nums;color:#0a0a0a;text-align:center">482913</td>',
      );
      expect(e.html).toContain('<table width="100%" class="well"');
      expect(e.html).not.toContain('class="btn"');
      expect(e.html).not.toContain("evil.com");
    }
  });

  test("without EMAIL_FROM, the sender is DougBot at this server's host", () => {
    expect(defaultEmailFrom("https://dougbot.app")).toBe("DougBot <ping@dougbot.app>");
    expect(defaultEmailFrom("https://chat.acme.com:8443/")).toBe("DougBot <ping@chat.acme.com>");
  });

  test("the footer says who sent it: DougBot, or a self-hosted server by its host", () => {
    expect(renderEmail(verify, emailArtAt("https://agentes.chat")).text).toContain("\nSent by DougBot.\n");
    expect(renderEmail(verify, emailArtAt("https://chat.acme.com/")).text).toContain(
      "\nSent by the DougBot server at chat.acme.com.\n",
    );
    expect(renderEmail({ ...verify, locale: "pt-BR" }, emailArtAt("https://chat.acme.com")).text).toContain(
      "Enviado pelo servidor do DougBot em chat.acme.com.",
    );
  });

  test("on a narrow screen the host moves to the next line whole, with the word before it, never split at a hyphen", () => {
    const box = emailArtAt("https://161-97-103-35.sslip.io");
    expect(renderEmail(verify, box).html).toContain(
      'Sent by the DougBot server <span style="display:inline-block">at 161-97-103-35.sslip.io.</span></p>',
    );
    expect(renderEmail({ ...verify, locale: "pt-BR" }, box).html).toContain(
      'Enviado pelo servidor do DougBot <span style="display:inline-block">em 161-97-103-35.sslip.io.</span></p>',
    );
    expect(renderEmail(verify, box).text).toContain("\nSent by the DougBot server at 161-97-103-35.sslip.io.\n");
    // Too long to share a 320 px line with the word before it, which would split it again or leave the word alone on
    // a line: it moves down alone.
    for (const host of ["ec2-203-0-113-25.compute-1.amazonaws.com", "agentes.consultoriaempresarialpaulista.com.br"]) {
      const far = emailArtAt(`https://${host}`);
      expect(renderEmail(verify, far).html).toContain(
        `Sent by the DougBot server at <span style="display:inline-block">${host}.</span></p>`,
      );
      expect(renderEmail({ ...verify, locale: "pt-BR" }, far).html).toContain(
        `Enviado pelo servidor do DougBot em <span style="display:inline-block">${host}.</span></p>`,
      );
      expect(renderEmail(verify, far).text).toContain(`\nSent by the DougBot server at ${host}.\n`);
    }
  });

  test("a closing line's last words move down together: no word alone on the last line, no e-mail split at its hyphen", () => {
    const code = EMAIL_SAMPLES["join_code.en"] as EmailTemplate;
    expect(renderEmail(code, art).html).toContain(
      'ask, <span style="display:inline-block">ignore this email.</span></p>',
    );
    expect(renderEmail({ ...code, locale: "pt-BR" }, art).html).toContain(
      'você, <span style="display:inline-block">ignore este e-mail.</span></p>',
    );
    expect(renderEmail(EMAIL_SAMPLES["join_request.pt-BR"] as EmailTemplate, art).html).toContain(
      'Todos os pedidos <span style="display:inline-block">em espera estão em Membros.</span></p>',
    );
    expect(renderEmail({ ...code, locale: "pt-BR" }, art).text).toContain(
      "\n\nVale por 10 minutos. Se não foi você, ignore este e-mail.\n\n",
    );
  });

  test("every text keeps its last two words together, in every email: none ends on a word alone", () => {
    const nobr = '<span style="display:inline-block">';
    const html = (id: string) => renderEmail(EMAIL_SAMPLES[id] as EmailTemplate, art).html;
    expect(html("verify_email.pt-BR")).toContain(`pode ignorar ${nobr}este e-mail.</span></p>`);
    expect(html("join_request.pt-BR")).toContain(`e pediu ${nobr}para entrar.</span></p>`);
    expect(html("join_code.en")).toContain(`Souza Bakery ${nobr}on DougBot.</span></p>`);
    // A name in bold moves down with its period, still bold.
    expect(html("join_code.en")).toContain(
      `to ask to join ${nobr}<b class="ink" style="font-weight:600;color:#0a0a0a">Souza Bakery</b>.</span></p>`,
    );
    expect(html("computer_ready-ai.pt-BR")).toContain(`dos seus agentes ${nobr}está pronto</span></h1>`);
    // Headlines and paragraphs of every kind, the fallback's words before its address (which breaks anywhere); the
    // plain text is as written.
    for (const id of Object.keys(EMAIL_SAMPLES)) {
      const texts = [...html(id).matchAll(/<(h1|p) class="(?:h1 ink|tx|mu|fa)"[^>]*>(.*?)<\/\1>/g)]
        .map(([, , inner = ""]) => inner.split("<br>")[0] ?? "")
        .filter((inner) => inner.replace(/<[^>]+>/g, "").split(" ").length > 2);
      expect(texts.length).toBeGreaterThan(2);
      const loose = texts.filter((inner) => {
        const tail = new RegExp(`${nobr}((?:(?!</?span)[^])*)</span>$`).exec(inner)?.[1];
        return !tail || tail.replace(/<[^>]+>/g, "").split(" ").length < 2;
      });
      expect({ id, loose }).toEqual({ id, loose: [] });
    }
    expect(renderEmail(EMAIL_SAMPLES["verify_email.pt-BR"] as EmailTemplate, art).text).toContain(
      "Se não foi você que se cadastrou, pode ignorar este e-mail.\n",
    );
  });

  test("the card's last block keeps only the room its ink needs: as much under the content as over the headline", () => {
    for (const [id, sample] of Object.entries(EMAIL_SAMPLES)) {
      const { html } = renderEmail(sample, art);
      const card = html.slice(
        html.indexOf('<td class="card"'),
        html.indexOf('\n</td></tr>\n<tr><td style="padding:20px 0 40px">'),
      );
      const last = card.slice(card.lastIndexOf("\n") + 1);
      // 2 px under a line of text; 6 px under the button for its shadow, 4 in dark, where the shadow doesn't show.
      expect({ id, last }).toEqual({
        id,
        last: expect.stringMatching(
          /^<p class="mu" style="margin:0 0 2px;|^<table class="end-btn" [^>]*"margin:8px 0 6px">/,
        ),
      });
    }
    expect(renderEmail(verify, art).html).toContain(".end-btn{margin-bottom:4px!important}");
    // Between blocks the room stays as it was.
    expect(renderEmail(EMAIL_SAMPLES["join_request.en"] as EmailTemplate, art).html).toContain(
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px">',
    );
  });
});

describe("the computer ready email's button: its first step", () => {
  const base = EMAIL_SAMPLES["computer_ready-ai.en"] as Extract<EmailTemplate, { kind: "computer_ready" }>;
  const button = (needsAi: boolean, hasAgents: boolean, url = base.url) => {
    const [b] = buttons({ ...base, needsAi, hasAgents, url });
    return `${b?.label} ${b?.url}`;
  };

  test("connect the AI, give a first task, or create an agent first, from the workspace's URL of any job", () => {
    expect(button(true, true)).toBe(`Connect your AI ${base.url}?connect=ai`);
    expect(button(false, true)).toBe(`Give a first task ${base.url}`);
    expect(button(true, false)).toBe(`Create an agent ${base.url}/agents/new`);
    expect(button(false, false)).toBe(`Create an agent ${base.url}/agents/new`);
    expect(button(true, true, `${base.url}?connect=ai`)).toBe(`Connect your AI ${base.url}?connect=ai`);
    expect(button(true, true, `${base.url}/`)).toBe(`Connect your AI ${base.url}?connect=ai`);
  });

  test("the steps count only those shown, in both parts", () => {
    const steps = (t: Partial<typeof base>) => renderEmail({ ...base, ...t }, art).text;
    expect(steps({})).toContain(
      "Next steps\n\n1. Connect your AI. Sign in with your Claude or ChatGPT plan, another AI's coding plan, or an API key. Your agents think with it.\n2. Give a first task.",
    );
    expect(steps({ needsAi: false })).toContain("Next steps\n\n1. Give a first task.");
    expect(steps({ needsAi: false })).toContain("\n2. Watch them work.");
    expect(steps({ hasAgents: false })).toContain(
      "\n1. Create an agent. It works on this computer from the start.\n2. Connect your AI.",
    );
    expect(steps({ hasAgents: false, needsAi: false })).not.toContain("Connect your AI");
    expect(steps({ locale: "pt-BR", specs: { cpus: 1, memoryGb: 7.8, diskGb: 100 } })).toContain(
      "CPUs: 1\nMemória: 7,8 GB\nDisco: 100 GB",
    );
    const html = renderEmail(base, art).html;
    expect(html.match(/<td class="num"/g)).toHaveLength(3);
    expect(html).toContain('<h2 class="ink"');
  });
});

describe("the picture over the headline", () => {
  const ready = EMAIL_SAMPLES["computer_ready-ai.en"] as Extract<EmailTemplate, { kind: "computer_ready" }>;
  /** The team a workspace with no agents shows: the identity's first four, the Doug first. */
  const TEAM = ["bot-doug-2.png 44×44", "bot-rosa-1.png 44×44", "bot-sony-1.png 44×44", "bot-mark-1.png 44×44"];
  /** The pictures between the card's top and the headline, in order: file, size and alt text. */
  const scene = (t: EmailTemplate) => {
    const { html } = renderEmail(t, art);
    const top = html.slice(html.indexOf('<td class="card"'), html.indexOf("<h1 "));
    return [
      ...top.matchAll(/<img src="https:\/\/x\.test\/email\/([^"]+)" width="(\d+)" height="(\d+)" alt="([^"]*)"/g),
    ].map(([, file, width, height, alt = ""]) => `${file} ${width}×${height} ${alt.replaceAll("&#39;", "'")}`.trim());
  };
  const shown = (crew: typeof ready.crew) => scene({ ...ready, crew });

  test("each agent is the bot the app draws for it: the team's by name or handle, its trade's form otherwise", () => {
    expect(
      shown([
        { name: "Rosa", handle: "rosa" },
        // A name of its own, the team's handle.
        { name: "Financeiro", handle: "chess" },
        // The team's right hand is the Doug, whatever it is called.
        { name: "Braço direito", handle: "bd", builtin: "right_hand" },
        { name: "Sony" },
      ]),
    ).toEqual(["bot-rosa-1.png 44×44", "bot-chess-1.png 44×44", "bot-doug-2.png 44×44", "bot-sony-1.png 44×44"]);
    // A free bot: its form from its trade (role, handle, name), its colour and eyes from its handle. Never the team's.
    const [social, dev, other] = shown([
      { name: "Social Media (ELMX)", handle: "social-elmx", role: "Posta nas redes" },
      { name: "Ada", handle: "ada", role: "Engenharia de software" },
      { name: "Ada", handle: "ada" },
    ]);
    expect(social).toMatch(/^bot-quadrado-[0-3]-(pilula|largo|meia|ponto)-1\.png 44×44$/);
    expect(dev).toMatch(/^bot-hexagono-[0-3]-(pilula|largo|meia|ponto)-1\.png 44×44$/);
    expect(other).toMatch(/^bot-squircle-[0-3]-(pilula|largo|meia|ponto)-1\.png 44×44$/);
    // The same agent, the same colour and eyes, whatever its trade says of its form.
    expect(dev?.replace("hexagono", "squircle")).toBe(other);
  });

  test("at most four agents; none, or a job queued before pictures: the identity's own team", () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((handle) => ({ name: handle, handle }));
    expect(shown(six)).toHaveLength(4);
    expect(shown([])).toEqual(TEAM);
    expect(shown(undefined)).toEqual(TEAM);
  });

  test("a look queued before the bots, a colour and no name, still shows a bot: two colours, two bots apart", () => {
    const [sky, rose, none] = shown([{ color: "sky", eyes: "round", accessory: "none" }, { color: "rose" }, {}]);
    for (const bot of [sky, rose, none])
      expect(bot).toMatch(/^bot-squircle-[0-3]-(pilula|largo|meia|ponto)-1\.png 44×44$/);
    expect(shown([{ color: "sky" }])).toEqual([sky ?? ""]);
  });

  test("the welcome emails show the workspace's agents in a row; the others show none", () => {
    const withCrew = new Set([
      "invitation.en",
      "invitation-starts.en",
      "invitation.pt-BR",
      "join_answer-joined.en",
      "join_answer-invited.en",
      "plan_waiting.pt-BR",
    ]);
    for (const [id, sample] of Object.entries(EMAIL_SAMPLES)) {
      const pictures = scene(sample);
      const has = withCrew.has(id) || id.startsWith("early_access") || id.startsWith("computer_ready");
      expect({ id, shows: pictures.length > 0 }).toEqual({ id, shows: has });
      // The Doug's picture has a version of its own (`DOUG_ART`): his drawing changed, the other bots' did not.
      for (const picture of pictures) expect(picture).toMatch(/^bot-(doug-2|[a-z0-9-]+-1)\.png 44×44$/);
    }
    expect(scene(EMAIL_SAMPLES["early_access.en"] as EmailTemplate)).toEqual(TEAM);
  });

  test("the plain-text part is the same words, with no picture in it", () => {
    const { text } = renderEmail(ready, art);
    expect(text.startsWith("Your agents' computer is ready\n\n")).toBe(true);
    expect(text).not.toContain(".png");
  });

  test("a picture's agents are the workspace's oldest four, each with who it is, the archived left out", async () => {
    f = await setup();
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 12, minute));
    await f.db
      .update(schema.agents)
      .set({ createdAt: at(5) })
      .where(eq(schema.agents.id, f.agent.id));
    const look = { color: "rose", eyes: "dots", accessory: "flower" };
    const agent = (name: string, minute: number, role: string, archived = false) => ({
      orgId: f.org.id,
      name,
      handle: name.toLowerCase(),
      role,
      model: "claude-sonnet-5-5",
      appearance: look,
      createdAt: at(minute),
      archivedAt: archived ? at(30) : null,
    });
    await f.db
      .insert(schema.agents)
      .values([
        agent("Lia", 3, "Design"),
        agent("Theo", 1, "Código"),
        agent("Gone", 0, "", true),
        agent("Ada", 2, "Financeiro"),
        agent("Atlas", 9, ""),
      ]);
    const crew = await emailCrew(f.db, f.org.id);
    expect(crew.map((c) => [c.name, c.handle, c.role])).toEqual([
      ["Theo", "theo", "Código"],
      ["Ada", "ada", "Financeiro"],
      ["Lia", "lia", "Design"],
      [f.agent.name, f.agent.handle, expect.any(String)],
    ]);
    // Each one's trade is its bot's form.
    expect(shown(crew).slice(0, 3)).toEqual([
      expect.stringMatching(/^bot-hexagono-/),
      expect.stringMatching(/^bot-moeda-/),
      expect.stringMatching(/^bot-petala-/),
    ]);
  });
});

describe("where the pictures come from", () => {
  test("every picture an email names is listed, and the web app has each one", () => {
    expect(EMAIL_PICTURES).toContain("doug-logo-ink-2.png");
    expect(EMAIL_PICTURES).toContain("bot-doug-2.png");
    // The team's seven, and every free bot: seven forms, four colours, four pairs of eyes.
    expect(EMAIL_PICTURES).toHaveLength(2 + 7 + 7 * 4 * 4);
    expect(new Set(EMAIL_PICTURES).size).toBe(EMAIL_PICTURES.length);
    for (const file of EMAIL_PICTURES)
      expect({ file, there: existsSync(join(WEB_DIR, "email", file)) }).toEqual({ file, there: true });
    for (const sample of Object.values(EMAIL_SAMPLES))
      for (const [, file = ""] of renderEmail(sample, art).html.matchAll(/src="https:\/\/x\.test\/email\/([^"]+)"/g))
        expect(EMAIL_PICTURES).toContain(file);
    // The fonts and the browser notification's picture, served from the same folder.
    for (const file of ["inter-latin.woff2", "manrope-latin.woff2", "doug-mark-2.png"])
      expect({ file, there: existsSync(join(WEB_DIR, "email", file)) }).toEqual({ file, there: true });
    expect(readFileSync(join(WEB_DIR, "sw.js"), "utf8")).toContain('const ICON = "/email/doug-mark-2.png";');
  });

  test("attached: the computer ready email carries each bot it shows once", async () => {
    const attached = await emailArtFor("http://localhost:3000", WEB_DIR, "auto");
    const ready = EMAIL_SAMPLES["computer_ready-ai.en"] as Extract<EmailTemplate, { kind: "computer_ready" }>;
    const rosa = { name: "Rosa" };
    const { html, inline } = renderEmail(
      { ...ready, crew: [rosa, rosa, { name: "Doug" }, { name: "Mark" }] },
      attached,
    );
    expect(html).toContain('src="cid:bot-rosa-1@dougbot.app"');
    expect(html).not.toContain('src="http');
    expect(inline.map((p) => p.filename)).toEqual([
      "doug-logo-ink-2.png",
      "doug-logo-bone-2.png",
      "bot-doug-2.png",
      "bot-rosa-1.png",
      "bot-mark-1.png",
    ]);
  });

  test("linked from this server's /email/, with the web font", () => {
    const { html, inline } = renderEmail(EMAIL_SAMPLES["verify_email.en"] as EmailTemplate, art);
    expect(html).toContain('src="https://x.test/email/doug-logo-ink-2.png"');
    expect(html).toContain('alt="DougBot"');
    expect(html).toContain("src:url('https://x.test/email/inter-latin.woff2')");
    expect(html).toContain("src:url('https://x.test/email/manrope-latin.woff2')");
    expect(html).toContain('<a href="https://x.test" target="_blank"');
    expect(inline).toEqual([]);
  });

  test("every email loads the app's face from this server alone, in a rule classic Outlook never reads", async () => {
    const attached = await emailArtFor("http://localhost:3000", WEB_DIR, "auto");
    // With the pictures attached nothing is fetched, the face included: no reader could reach that address.
    for (const [from, a] of [
      ["https://x.test", art],
      [null, attached],
    ] as const) {
      const { html } = renderEmail(EMAIL_SAMPLES["verify_email.en"] as EmailTemplate, a);
      const faces = [...html.matchAll(/@font-face\{[^}]*\}/g)].map((m) => m[0]);
      expect(faces).toEqual(
        from
          ? [
              `@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url('${from}/email/inter-latin.woff2') format('woff2')}`,
              `@font-face{font-family:'Manrope';font-style:normal;font-weight:200 800;font-display:swap;src:url('${from}/email/manrope-latin.woff2') format('woff2')}`,
            ]
          : [],
      );
      // Every URL a mail app may fetch is this server's: no font host, no other company.
      const fetched = [...html.matchAll(/(?:src="|url\(')(https?:\/\/[^"')]+)/g)].map(
        (m) => new URL(m[1] ?? "").origin,
      );
      expect(new Set(fetched)).toEqual(new Set(from ? [from] : []));
      // Its own style block, inside the comment classic Outlook skips. The face is the stack's first font, and
      // classic Outlook is told its own.
      if (from) expect(html).toContain(`<!--[if !mso]><!--><style>${faces.join("")}</style><!--<![endif]-->`);
      expect(html).toContain(
        "font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,'Hiragino Sans','PingFang SC','Microsoft YaHei','Apple SD Gothic Neo','Malgun Gothic',sans-serif",
      );
      expect(html).toContain("<!--[if mso]>");
      expect(html).toMatch(/<!--\[if mso\]>.*font-family:'Segoe UI',Arial,sans-serif!important.*<!\[endif\]-->/);
    }
  });

  test("attached: each message carries only the pictures its HTML names", async () => {
    const attached = await emailArtFor("http://localhost:3000", WEB_DIR, "auto");
    expect(attached.base).toBeNull();
    const { html, inline } = renderEmail(
      {
        kind: "approval_digest",
        locale: "en",
        orgName: "Acme",
        items: [{ agentName: "Rosa", agentColor: "rose", title: "Deploy", ageHours: 5 }],
        url: "http://localhost:3000/org/o/approvals?open=a",
      },
      attached,
    );
    expect(html).toContain('src="cid:doug-logo-ink-2@dougbot.app"');
    expect(inline.map((p) => p.filename)).toEqual(["doug-logo-ink-2.png", "doug-logo-bone-2.png", "bot-rosa-1.png"]);
    expect(inline[0]).toMatchObject({ cid: "doug-logo-ink-2@dougbot.app", contentType: "image/png" });
    expect([...(inline[0]?.content ?? []).slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
  });

  test("EMAIL_ART=attach on a public host; auto attaches for a private, CGNAT or privately resolving one", async () => {
    const publicDns = async () => ["93.184.216.34"];
    const at = (url: string, mode: "auto" | "attach", resolveTo = publicDns) =>
      emailArtFor(url, WEB_DIR, mode, resolveTo).then((a) => a.base);
    expect(await at("https://chat.acme.com", "auto")).toBe("https://chat.acme.com/email/");
    expect(await at("https://chat.acme.com", "attach")).toBeNull();
    expect(await at("http://localhost:3000", "auto")).toBeNull();
    expect(await at("https://100.101.102.103", "auto")).toBeNull();
    expect(await at("https://agentes.tail1234.ts.net", "auto", async () => ["100.64.1.2"])).toBeNull();
    expect(await at("https://chat.acme.internal", "auto")).toBeNull();
    expect(await at("https://10-0-0-5.sslip.io", "auto", async () => ["10.0.0.5"])).toBeNull();
    // A server without the web app's pictures keeps them linked.
    expect((await emailArtFor("http://localhost:3000", "/nonexistent", "auto")).base).toBe(
      "http://localhost:3000/email/",
    );
  });

  test("says why they're attached: asked, a private host, or a host that didn't resolve", async () => {
    const why = (url: string, mode: "auto" | "attach", resolveTo: () => Promise<string[]>) =>
      emailArtFor(url, WEB_DIR, mode, resolveTo).then((a) => a.attached);
    const publicDns = async () => ["93.184.216.34"];
    expect(await why("https://chat.acme.com", "auto", publicDns)).toBeUndefined();
    expect(await why("https://chat.acme.com", "attach", publicDns)).toBe("attach");
    expect(await why("http://localhost:3000", "auto", publicDns)).toBe("blocked");
    expect(await why("https://chat.acme.com", "auto", () => Promise.reject(new Error("ENOTFOUND")))).toBe(
      "unreachable",
    );
  });
});

describe("jobs queued before this look", () => {
  test("old payloads, with no language or new fields, still render (in English, every language's fallback)", () => {
    const e = renderEmail({ kind: "verify_email", url: "u" });
    expect(e.subject).toBe("Confirm your email for DougBot");
    expect(e.html).toContain('<html lang="en"');
    const old: EmailTemplate[] = [
      { kind: "invitation", orgName: "Acme", inviterName: "", url: "https://x/invite/t", role: "member" },
      { kind: "budget", level: "warning", agentName: "Ada", orgName: "Acme", percent: 80.4, url: "u" },
      {
        kind: "approval_digest",
        orgName: "Acme",
        items: [
          { agentName: "Ada", title: "Merge PR #42", ageHours: 5 },
          { agentName: "", title: "Deploy", ageHours: 0.2 },
        ],
        url: "u",
      },
      { kind: "invite_request", orgName: "Acme", email: "", url: "u" },
    ];
    for (const t of old) {
      const r = renderEmail(t, art);
      expect(`${r.subject}${r.html}${r.text}`).not.toMatch(/undefined|null|\{\w+\}/);
    }
    const [invitation, budget, digest] = old.map((t) => renderEmail(t, art).text);
    expect(invitation).toContain("You're invited to join Acme as a member.");
    // A percentage only: owners who aren't admins never see money.
    expect(budget).toContain("Used 80% of this month's budget · Acme");
    expect(budget).not.toContain("$");
    expect(digest).toContain(`Ada · Merge PR #42 · 5\u00a0h\u00a0ago`);
    expect(digest).toContain(`An agent · Deploy · 1\u00a0h\u00a0ago`);
    // No `afterHours`: the footer stops after its first sentence.
    expect(digest).toContain("You got this email because you can approve these requests in Acme.\n");
  });
});

describe("outbox delivery", () => {
  test("queued once per key, sent by the job with the key as idempotency key; permanent errors don't retry", async () => {
    f = await setup();
    const sender = createFakeEmailSender();
    const handlers = createJobHandlers({ ...f.jobDeps, email: sender });
    const input = {
      orgId: f.org.id,
      key: "k1",
      to: ["a@example.com"],
      template: { kind: "verify_email" as const, url: "u" },
    };
    await queueEmail(f.db, input);
    await queueEmail(f.db, input);
    await queueEmail(f.db, { ...input, orgId: null, key: "k2" });
    await drainOutbox(f.db, handlers);
    expect(sender.sent.map((m) => m.idempotencyKey).sort()).toEqual(["k1", "k2"]);
    const failing = { id: "x", delivers: true, send: async () => Promise.reject(new EmailError("bad", false, 422)) };
    await expect(sendQueuedEmail(failing, { key: "k", to: ["a@b.c"], template: input.template })).rejects.toThrow(
      "bad",
    );
  });

  test("attached pictures go with the message as inline parts", async () => {
    const sender = createFakeEmailSender();
    const attached: EmailArt = await emailArtFor("http://localhost:3000", WEB_DIR, "attach");
    await sendQueuedEmail(sender, { key: "k", to: ["a@b.c"], template: EMAIL_SAMPLES["verify_email.en"] }, attached);
    expect(sender.sent[0]?.inline?.map((p) => p.cid)).toEqual([
      "doug-logo-ink-2@dougbot.app",
      "doug-logo-bone-2@dougbot.app",
    ]);
    await sendQueuedEmail(sender, { key: "k2", to: ["a@b.c"], template: EMAIL_SAMPLES["verify_email.en"] }, art);
    expect(sender.sent[1]).not.toHaveProperty("inline");
  });

  test("budget email once per agent, month and level, with the agent's face and its budget's address", async () => {
    f = await setup();
    await f.db
      .update(schema.agents)
      .set({ appearance: { color: "rose", eyes: "round", accessory: "none" } })
      .where(eq(schema.agents.id, f.agent.id));
    const e = { agent: { ...f.agent }, level: "warning" as const, spentNanoUsd: 8e9, budgetNanoUsd: 10e9 };
    await queueBudgetEmail(f.db, "https://chat.example.com", e);
    await queueBudgetEmail(f.db, "https://chat.example.com", e);
    const jobs = (await f.db.select().from(schema.outbox)).filter((j) => j.kind === "email.send");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toMatchObject({
      template: {
        kind: "budget",
        agentColor: "rose",
        // Who it is, for the bot the app draws for it.
        agentLook: { handle: f.agent.handle, role: expect.any(String), builtin: null },
        url: `https://chat.example.com/org/${f.org.id}/agents/${f.agent.id}?tab=settings&sec=budget`,
      },
    });
  });

  test("approval digest: one email per person told for requests waiting too long, never twice, opening a lone request", async () => {
    const gh = fakeGithub();
    f = await setup({
      toolSources: [gh.source],
      reply: () => ({
        chunks: [],
        toolUses: [
          {
            name: "github_merge_pr",
            input: { repo: "a/b", pr: 1, why: "CI passed and the review is done: merging ships the fix today." },
          },
        ],
      }),
    });
    await grantScopes(f.db, f.org.id, f.agent.id, ALL_GITHUB_SCOPES);
    await addMember(f.db, f.org.id, "admin", "bia");
    await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, { body: "@dev merge" });
    await drainOutbox(f.db, f.handlers);
    const later = new Date(Date.now() + 5 * 3600_000);
    expect(await queueApprovalDigests(f.db, "https://x", 4)).toBe(0);
    // The agent's responsável (the owner), not every admin (`notifiedIds`).
    expect(await queueApprovalDigests(f.db, "https://x", 4, later)).toBe(1);
    expect(await queueApprovalDigests(f.db, "https://x", 4, later)).toBe(0);
    const [approval] = await f.db.select().from(schema.approvals);
    const digests = (await f.db.select().from(schema.outbox)).filter(
      (j) => j.kind === "email.send" && JSON.stringify(j.payload).includes("approval_digest"),
    );
    expect(digests).toHaveLength(1);
    for (const d of digests) {
      expect(d.payload).toMatchObject({
        template: { url: `https://x/org/${f.org.id}/approvals?open=${approval?.id}`, afterHours: 4 },
      });
    }
  });

  test("invitation: what it gives, named, a list cut at five places; an owner's stays an owner's (ADR 0184)", () => {
    const base = EMAIL_SAMPLES["invitation-starts.en"] as Extract<EmailTemplate, { kind: "invitation" }>;
    const said = (t: Partial<typeof base>, locale: "en" | "pt-BR" = "pt-BR") =>
      renderEmail({ ...base, ...t, locale }, art).text.replace(/\s+/g, " ");
    expect(said({})).toContain("como Suporte. Você já entra em #suporte e #chamados-urgentes. Vai trabalhar com Max.");
    expect(said({}, "en")).toContain(
      "as Suporte. You'll start in #suporte and #chamados-urgentes. You'll work with Max.",
    );
    // Only agents, or nothing past #general and the right hand: no line at all.
    expect(said({ channels: [] })).toContain("como Suporte. Vai trabalhar com Max.");
    expect(said({ channels: [], agents: [] })).not.toContain("Você já entra");
    const channels = Array.from({ length: 7 }, (_, i) => `canal-${i + 1}`);
    expect(said({ channels, roles: ["Suporte", "Financeiro"] })).toContain(
      "como Suporte e Financeiro. Você já entra em #canal-1, #canal-2, #canal-3, #canal-4 e mais 3.",
    );
    expect(said({ channels }, "en")).toContain("#canal-1, #canal-2, #canal-3, #canal-4, and 3 more.");
    expect(said({ role: "owner" })).toContain("como dono.");
  });

  test("invitation: the inviter's address goes in the body, so the invitee can judge who sent it", async () => {
    f = await setup();
    // The fixture's addresses end in a random hex suffix, which typed-text masking hides whenever it has 7 digits in a row.
    const inviterEmail = "ana.lima@example.com";
    await f.db.update(schema.users).set({ email: inviterEmail }).where(eq(schema.users.id, f.owner.id));
    await queueInvitationEmail(f.db, {
      orgId: f.org.id,
      // An id, as the function reads the invitation's note and expiry (none here: no note, keyed by the link).
      invitationId: crypto.randomUUID(),
      email: "new@example.com",
      role: "member",
      url: "https://x/invite/abcdefghijklmnop",
      inviterId: f.owner.id,
      secret: "test-secret",
    });
    const [job] = (await f.db.select().from(schema.outbox)).filter((j) => j.kind === "email.send");
    // The workspace's agents for its picture: the fixture's one, with no look (its face is sky).
    expect(job?.payload).toMatchObject({ template: { kind: "invitation", inviterEmail, crew: [{}] } });
    const payload = job?.payload as { template: EmailTemplate } | undefined;
    const text = payload ? renderEmail(payload.template, art).text : "";
    expect(text).toContain(`(${inviterEmail.replace(/([.@])/g, `$1${BREAK}`)}) convidou você para entrar na`);
  });
});
