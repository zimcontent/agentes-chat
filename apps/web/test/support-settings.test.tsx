import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { cleanup } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
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
    await go(
      "settings/support",
      seedState({
        authConfig: {
          support: { email: "help@example.com", whatsapp: "+55 (11) 99999-0000" },
          clientCode: "064",
        },
      }),
    );
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
