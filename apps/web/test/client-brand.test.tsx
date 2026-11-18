import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { setClientProductName } from "@agenteschat/i18n/brand";
import { Logo } from "@agenteschat/ui";
import { act, cleanup, render } from "@testing-library/react";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

/**
 * A server deployed for one client (ADR doug-0032): the name it sets at boot stays while `me` and the instance are
 * still being read (no flash of the build's own), the color it sets paints the highlight, and the signature follows
 * the name on its own (`subscribeBrand`), wherever it is drawn.
 */

afterEach(() => {
  cleanup();
  setClientProductName(null);
  document.documentElement.style.removeProperty("--client-accent");
  document.documentElement.removeAttribute("data-client-accent");
});

const EXAMPLE = { name: "Padaria Aurora", accent: "#C2410C" };
const styled = () => document.documentElement.style.getPropertyValue("--client-accent");
const marked = () => document.documentElement.hasAttribute("data-client-accent");

describe("a client's name and color in the web app (ADR doug-0032)", () => {
  test("the name the boot set is not cleared before the answers arrive, and arrives with the color", async () => {
    const api = createFakeApi(seedState());
    // main.tsx sets the name at boot, from `/api/instance`; here it is the same call, before the first render.
    setClientProductName("Padaria Aurora");
    // The render's `useClientLook` reads `me` and the instance; the instance is the one that names a client here.
    const instance = await api.system.instance();
    await renderApp(`/org/${ORG_ID}/home`, {
      api: { ...api, system: { ...api.system, instance: async () => ({ ...instance, client: EXAMPLE }) } },
    });
    // The color reached the page's own highlight variable, and is marked as a client's, so a part of the page that
    // themes itself reads it too (doug.css).
    expect(styled()).toBe(EXAMPLE.accent);
    expect(marked()).toBe(true);
    // And the name reads as the client's, not the build's.
    expect(screen().queryAllByRole("img", { name: EXAMPLE.name }).length).toBeGreaterThan(0);
  });

  test("a server with no client paints no color and keeps the build's name", async () => {
    const api = createFakeApi(seedState());
    await renderApp(`/org/${ORG_ID}/home`, { api });
    expect(styled()).toBe("");
    // No mark: a nested `[data-theme]` keeps the green of its own theme (doug.css).
    expect(marked()).toBe(false);
    expect(screen().queryAllByRole("img", { name: "DougBot" }).length).toBeGreaterThan(0);
  });
});

describe("the signature's markup (ADR doug-0032)", () => {
  test("with no client it is the identity's own: <b>Doug</b>Bot, not a name split at a space", () => {
    const { container } = render(<Logo />);
    expect(container.querySelector(".ac-logo__word")?.innerHTML).toBe("<b>Doug</b>Bot");
  });

  test("a client's name splits at its first space, the first word 800", () => {
    setClientProductName("Padaria Aurora");
    const { container } = render(<Logo />);
    expect(container.querySelector(".ac-logo__word")?.innerHTML).toBe("<b>Padaria</b> Aurora");
  });
});

describe("the signature follows the name (subscribeBrand)", () => {
  test("a Logo on screen redraws when the client's name arrives after it", async () => {
    const { getByRole } = render(<Logo />);
    expect(getByRole("img").getAttribute("aria-label")).toBe("DougBot");
    await act(async () => {
      setClientProductName("Café Sol");
      await settle();
    });
    expect(getByRole("img").getAttribute("aria-label")).toBe("Café Sol");
    // And back to the build's name, when the answers say there is no client.
    await act(async () => {
      setClientProductName(null);
      await settle();
    });
    expect(getByRole("img").getAttribute("aria-label")).toBe("DougBot");
  });
});
