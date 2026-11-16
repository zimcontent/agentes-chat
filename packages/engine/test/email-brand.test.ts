import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND_NAME, brandText } from "@agenteschat/i18n/brand";
import { LOCALE_CODES } from "@agenteschat/i18n/locale";
import { defaultEmailFrom, type EmailTemplate, emailArtAt, renderEmail } from "../src";
import { EMAIL_SAMPLES, PERSONAL_EMAIL_SAMPLES } from "./email-samples";

/**
 * DougBot: no email names the original project to the person who reads it. The samples are the emails as their jobs
 * carry them, moved to this instance's own address (the samples' own is the original project's site, and an address
 * is never renamed).
 */
const HOME = "https://time.zimcontent.com";
const UPSTREAM = "agentes.chat";

const ours = (sample: EmailTemplate): EmailTemplate =>
  JSON.parse(
    JSON.stringify(sample).replaceAll("https://agentes.chat", HOME).replaceAll("@agentes.chat", "@zimcontent.com"),
  ) as EmailTemplate;

/** What a person reads of an HTML email: its text and the words read aloud for a picture, never an address. */
function visible(html: string): string {
  const body = html.replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const spoken = [...body.matchAll(/\b(?:alt|title|aria-label)="([^"]*)"/gi)].map((m) => m[1]).join(" ");
  return `${body.replace(/<[^>]+>/g, " ")} ${spoken}`;
}

const render = (sample: EmailTemplate) => {
  const e = renderEmail(ours(sample), emailArtAt(HOME));
  return { subject: e.subject, preheader: e.preheader, text: e.text, seen: visible(e.html) };
};

const ALL = { ...EMAIL_SAMPLES, ...PERSONAL_EMAIL_SAMPLES };

describe("emails under this instance's name", () => {
  test("the main ones: invitation, address check, password reset, the approvals digest and a notice", () => {
    for (const id of [
      "invitation.en",
      "invitation.pt-BR",
      "invitation-starts.en",
      "verify_email.en",
      "verify_email.pt-BR",
      "password_reset.en",
      "password_reset.pt-BR",
      "approval_digest-one.en",
      "approval_digest-many.en",
      "approval_digest-many.pt-BR",
      "budget-warning.en",
    ]) {
      const sample = EMAIL_SAMPLES[id];
      expect(sample, id).toBeDefined();
      const e = render(sample as EmailTemplate);
      for (const [part, words] of Object.entries(e)) expect(words, `${id}: ${part}`).not.toContain(UPSTREAM);
    }
  });

  test("every email, in every language", () => {
    for (const locale of LOCALE_CODES) {
      for (const [id, sample] of Object.entries(ALL)) {
        const e = render({ ...sample, locale } as EmailTemplate);
        const named = Object.entries(e)
          .filter(([, words]) => words.includes(UPSTREAM))
          .map(([part]) => part);
        expect({ id, locale, named }).toEqual({ id, locale, named: [] });
      }
    }
  });

  test("the name a person reads is ours: the sender, the subject and the footer", () => {
    expect(defaultEmailFrom(HOME)).toBe(`${BRAND_NAME} <ping@time.zimcontent.com>`);
    const invite = render(EMAIL_SAMPLES["invitation.en"] as EmailTemplate);
    expect(`${invite.subject}\n${invite.text}`).toContain(BRAND_NAME);
  });

  test("an email whose words named the original project would still leave as ours", () => {
    // What `renderEmail` does to its words: a word merged from the original project is renamed, a link is not.
    expect(brandText("Welcome to agentes.chat\nhttps://agentes.chat/invite/T7xQ")).toBe(
      `Welcome to ${BRAND_NAME}\nhttps://agentes.chat/invite/T7xQ`,
    );
    // The samples as they are, at the original project's own address: its links are kept, to the letter.
    const e = renderEmail(EMAIL_SAMPLES["password_reset.en"] as EmailTemplate);
    expect(`${e.html}\n${e.text}`).toContain("https://agentes.chat/reset-password?token=Qm9h3x9TZkLw");
  });
});

describe("the other words the server sends to a person", () => {
  /** Files of words with no single place they leave from: a merge that brings the old name there fails here. */
  const dirs = ["../src/push/messages", "../src/email/words"];

  test("push and email words don't name the original project", () => {
    for (const dir of dirs) {
      const at = join(import.meta.dir, dir);
      for (const file of readdirSync(at).filter((f) => f.endsWith(".ts"))) {
        const named = readFileSync(join(at, file), "utf8")
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => !/^\s*(\/\/|\/?\*)/.test(line) && brandText(line) !== line)
          .map(([n]) => n);
        expect({ file: `${dir}/${file}`, named }).toEqual({ file: `${dir}/${file}`, named: [] });
      }
    }
  });
});
