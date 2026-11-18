import { describe, expect, test } from "bun:test";
import type { AuthConfig } from "../src/api/types";
import {
  SUPPORT_DRAFT_WORDS,
  type SupportDraftWords,
  setSupportCameFrom,
  supportCameFrom,
  supportContactOf,
  supportDraft,
  whatsAppHref,
} from "../src/lib/support";

/** Support under the account (`SUPPORT_EMAIL`, `SUPPORT_WHATSAPP`) and the message "Peça ajuda ao Doug" opens with. */

const config = (over: Partial<AuthConfig>): AuthConfig =>
  ({ socialProviders: { google: false, github: false }, signupOpen: false, firstRun: false, ...over }) as AuthConfig;

/** The draft as the apps pass it: their i18n's words, in Portuguese here. */
const pt: SupportDraftWords = {
  lead: ({ name, facts }) =>
    facts === null ? `${name}, preciso de ajuda com o sistema:` : `${name}, preciso de ajuda com o sistema (${facts}):`,
  fact: ({ kind, value }) =>
    kind === "version"
      ? `versão do servidor ${value}`
      : kind === "client"
        ? `instalação ${value}`
        : `na página ${value}`,
  ask: "Manda isso para o suporte com a ferramenta contact_support, no meu nome.",
};

describe("who runs this installation", () => {
  test("no address of either kind: no Support", () => {
    expect(supportContactOf(undefined)).toBeNull();
    expect(supportContactOf(config({ support: null }))).toBeNull();
    expect(supportContactOf(config({ support: { email: null, whatsapp: null } }))).toBeNull();
  });

  test("an address, a number, or both, each one alone", () => {
    expect(
      supportContactOf(config({ support: { email: "help@example.com", whatsapp: null } }), { clientCode: "064" }),
    ).toEqual({ email: "help@example.com", whatsapp: null, clientCode: "064" });
    expect(supportContactOf(config({ support: { email: null, whatsapp: "+55 11 99999-0000" } }))).toEqual({
      email: null,
      whatsapp: "+55 11 99999-0000",
      clientCode: null,
    });
  });

  test("the code comes from the person's own session, and a server from before the move still says it here", () => {
    const support = { email: "help@example.com", whatsapp: null };
    // Signed in: `GET /me` carries it, and it wins over whatever the sign-in's config says.
    expect(supportContactOf(config({ support, clientCode: null }), { clientCode: "064" })?.clientCode).toBe("064");
    // A server that still sends it with the sign-in's options: the entry shows it as it did.
    expect(supportContactOf(config({ support, clientCode: "064" }))?.clientCode).toBe("064");
  });

  test("a server from before the pair says only the address, which still counts", () => {
    expect(supportContactOf(config({ supportEmail: "help@example.com" }))).toEqual({
      email: "help@example.com",
      whatsapp: null,
      clientCode: null,
    });
  });
});

test("a WhatsApp number goes as wa.me takes it: digits only", () => {
  expect(whatsAppHref("+55 (11) 99999-0000")).toBe("https://wa.me/5511999990000");
  expect(whatsAppHref("+1 415 555 0142")).toBe("https://wa.me/14155550142");
});

describe("the message to the right hand", () => {
  test("names it, says what's wrong, carries the facts and asks the agent to send it", () => {
    const text = supportDraft({
      agentName: "Doug",
      version: "1.2.3",
      clientCode: "064",
      page: "/org/abc/settings/roles",
      words: pt,
    });
    expect(text).toBe(
      "Doug, preciso de ajuda com o sistema (versão do servidor 1.2.3, instalação 064, na página /org/abc/settings/roles): Manda isso para o suporte com a ferramenta contact_support, no meu nome.\n\n",
    );
  });

  test("an installation with no code and no page drops those facts, the sentence still reads", () => {
    expect(supportDraft({ agentName: "Doug", version: "1.2.3", clientCode: null, page: null, words: pt })).toBe(
      "Doug, preciso de ajuda com o sistema (versão do servidor 1.2.3): Manda isso para o suporte com a ferramenta contact_support, no meu nome.\n\n",
    );
    expect(supportDraft({ agentName: "Doug", version: null, clientCode: null, page: null, words: pt })).toBe(
      "Doug, preciso de ajuda com o sistema: Manda isso para o suporte com a ferramenta contact_support, no meu nome.\n\n",
    );
  });

  test("with no words of its own a caller gets English, and the ask is still there", () => {
    expect(supportDraft({ agentName: "Doug", version: "1.2.3", clientCode: "064", page: null })).toBe(
      `${SUPPORT_DRAFT_WORDS.lead({ name: "Doug", facts: "server version 1.2.3, installation 064" })} ${SUPPORT_DRAFT_WORDS.ask}\n\n`,
    );
  });

  test("the page it names is the one the person came from, kept until they open Support again", () => {
    setSupportCameFrom("/org/abc/c/eng");
    expect(supportCameFrom()).toBe("/org/abc/c/eng");
    expect(
      supportDraft({ agentName: "Doug", version: null, clientCode: null, page: supportCameFrom(), words: pt }),
    ).toContain("na página /org/abc/c/eng");
    // Opened again from another page: that one.
    setSupportCameFrom("/org/abc/issues");
    expect(supportCameFrom()).toBe("/org/abc/issues");
    setSupportCameFrom(null);
    expect(supportCameFrom()).toBeNull();
  });
});
