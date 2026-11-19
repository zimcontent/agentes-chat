import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@dougbot/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ENG_ID, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => cleanup());

const ICON = "data:image/png;base64,iVBORw0KGgo=";
const click = (el: Element) => act(async () => fireEvent.click(el));
const go = async (edit?: (state: ReturnType<typeof seedState>) => void) => {
  const state = seedState();
  edit?.(state);
  await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state) });
  await settle(8);
  return state;
};
const named = (state: ReturnType<typeof seedState>) => {
  const eng = state.channels.find((c) => c.id === ENG_ID);
  if (eng) Object.assign(eng, { displayName: "Engenharia & Deploy", icon: ICON });
};

describe("a channel's display name and photo, like a group's", () => {
  test("the sidebar, the header and the tab show the display name and the photo; #eng still names it", async () => {
    await go(named);
    const row = document.querySelector(`.sidebar a[href$="/c/${ENG_ID}"]`) as HTMLElement;
    expect(row.querySelector(".sidebar__item-label")?.textContent).toBe("Engenharia & Deploy");
    expect(row.querySelector("img.sidebar__channel-photo")?.getAttribute("src")).toBe(ICON);
    expect(row.querySelector(".sidebar__channel-icon")).toBeNull();
    expect(row.getAttribute("title")).toBe("Engenharia & Deploy · #eng");
    const header = document.querySelector(".channel__header") as HTMLElement;
    expect(within(header).getByRole("heading", { level: 1, name: "Engenharia & Deploy" })).toBeTruthy();
    expect(header.querySelector("img.channel__title-photo")).toBeTruthy();
    expect(document.title).toStartWith("Engenharia & Deploy · ");
  });

  test("without them, the name and the # as before", async () => {
    await go();
    const row = document.querySelector(`.sidebar a[href$="/c/${ENG_ID}"]`) as HTMLElement;
    expect(row.querySelector(".sidebar__item-label")?.textContent).toBe("eng");
    expect(row.querySelector("img")).toBeNull();
    expect(document.title).toStartWith("#eng · ");
  });

  test("the channel's settings save the display name (blank clears it) and send or remove the photo", async () => {
    const state = await go();
    await click(within(screen().getByRole("main")).getByRole("button", { name: "Configurações do grupo" }));
    await settle(3);
    const dialog = screen().getByRole("dialog", { name: "#eng" });
    expect(dialog.textContent).toContain("O nome técnico (#eng) continua valendo para mencionar.");
    const field = within(dialog).getByRole("textbox", { name: "Nome de exibição" }) as HTMLInputElement;
    await act(async () => fireEvent.change(field, { target: { value: "Engenharia" } }));
    await act(async () => fireEvent.blur(field));
    await settle(3);
    const updates = () => state.calls.filter((c) => c.method === "chat.update").map((c) => c.args.at(-1));
    expect(updates()).toEqual([{ displayName: "Engenharia" }]);
    await act(async () => fireEvent.change(field, { target: { value: "  " } }));
    await act(async () => fireEvent.blur(field));
    await settle(3);
    expect(updates().at(-1)).toEqual({ displayName: null });
    // No photo yet: Enviar foto opens the square crop; no Remover foto.
    expect(within(dialog).queryByRole("button", { name: "Remover foto" })).toBeNull();
    await click(within(dialog).getByRole("button", { name: "Enviar foto" }));
    await settle(2);
    expect(screen().getByRole("dialog", { name: "Foto do grupo" })).toBeTruthy();
  });

  test("with a photo: Trocar foto and Remover foto, which takes it off", async () => {
    const state = await go(named);
    await click(within(screen().getByRole("main")).getByRole("button", { name: "Configurações do grupo" }));
    await settle(3);
    const dialog = screen().getByRole("dialog", { name: "Engenharia & Deploy" });
    expect(within(dialog).getByRole("button", { name: "Trocar foto" })).toBeTruthy();
    await click(within(dialog).getByRole("button", { name: "Remover foto" }));
    await settle(3);
    expect(state.calls.some((c) => c.method === "chat.removeIcon")).toBe(true);
    expect(state.channels.find((c) => c.id === ENG_ID)?.icon).toBeNull();
  });
});
