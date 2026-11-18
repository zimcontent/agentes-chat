import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { peekDraft } from "@agenteschat/client/lib/drafts";
import { setSupportCameFrom } from "@agenteschat/client/lib/support";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { createFakeApi, LODI_ID, ORG_ID, seedState, withRightHand } from "./fake-api";
import { renderApp, screen, settle } from "./render";

/* Support under the account: how to reach whoever runs this installation (`SUPPORT_EMAIL`, `SUPPORT_WHATSAPP`) and the
   installation's own code, then "Peça ajuda ao Doug". It shows only where the operator set an address. */

afterEach(() => cleanup());

const go = async (path: string, state: ReturnType<typeof seedState>) => {
  const r = await renderApp(`/org/${ORG_ID}/${path}`, { api: createFakeApi(state) });
  await settle(6);
  return r;
};
const links = () =>
  [...document.querySelectorAll('a[href^="mailto:"], a[href^="https://wa.me/"]')].map((a) => a.getAttribute("href"));

describe("Support", () => {
  test("no address of either kind: the section shows nothing", async () => {
    await go("settings/support", seedState({ authConfig: { support: null, clientCode: null } }));
    expect(links()).toEqual([]);
  });

  test("the address and the number, each a link, and the installation's code", async () => {
    const state = seedState({
      authConfig: { support: { email: "help@example.com", whatsapp: "+55 (11) 99999-0000" }, clientCode: null },
    });
    // The code comes with the person's own session (`GET /me`), never with the sign-in's options.
    state.me = state.me && { ...state.me, clientCode: "064" };
    await go("settings/support", state);
    expect(links()).toEqual(["mailto:help@example.com", "https://wa.me/5511999990000"]);
    expect(screen().getByText("064")).toBeTruthy();
  });

  test("the number alone is enough for the section to show", async () => {
    await go(
      "settings/support",
      seedState({ authConfig: { support: { email: null, whatsapp: "+1 415 555 0142" }, clientCode: null } }),
    );
    expect(links()).toEqual(["https://wa.me/14155550142"]);
  });
});

describe("Peça ajuda ao Doug", () => {
  /** The card's ask, with the right hand in the directory so it has a name to say. */
  const askable = (config: Partial<ReturnType<typeof seedState>["authConfig"]> = {}) =>
    withRightHand(
      seedState({
        authConfig: { support: { email: "help@example.com", whatsapp: null }, clientCode: null, ...config },
      }),
    );

  test("the card names the right hand, never a placeholder of its own", async () => {
    const state = askable();
    state.me = state.me && { ...state.me, clientCode: "064" };
    await go("settings/support", state);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Peça ajuda a Doug");
    expect(text).not.toContain("{{name}}");
    expect(screen().getByRole("button", { name: /Peça ao Doug/ })).toBeTruthy();
  });

  test("the button opens the DM with the ask in words, naming the page they came from", async () => {
    const state = askable();
    // As the Sidebar and Settings record it: the page the person left for Support.
    setSupportCameFrom("/org/abc/settings/roles");
    await go("settings/support", state);
    // The settings card first: the ask it promises, in the person's language.
    expect(document.body.textContent ?? "").toContain("Peça ajuda a Doug");
    // Press it: the DM opens with the message in its box.
    const ask = screen().getByRole("button", { name: /Peça ao Doug/ });
    await act(async () => fireEvent.click(ask));
    await settle(6);
    await settle(4);
    const box = screen().getByRole("combobox", { name: /Mensagem/ }) as HTMLTextAreaElement;
    expect(box.value).toContain("Doug, preciso de ajuda com o sistema");
    expect(box.value).toContain("na página /org/abc/settings/roles");
    expect(box.value).toContain("contact_support");
    // After whatever the person was already writing in that DM: the hand-off never erases it, and the DM's own
    // composer took it (the hand-off is spent).
    expect(peekDraft(`agent:${LODI_ID}`)).toBeUndefined();
  });
});
