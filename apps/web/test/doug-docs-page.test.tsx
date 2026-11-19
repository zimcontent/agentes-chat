import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@dougbot/ui/testing/dom";

setupDom();

import { cleanup } from "@testing-library/react";
import { createFakeApi, seedState } from "./fake-api";
import { renderApp, screen } from "./render";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const OLD = /agentes\.chat/;

test("/docs lists the pages and /docs/<page> shows one, signed out", async () => {
  const api = createFakeApi(seedState({ me: null }));
  await renderApp("/docs", { api });
  expect(await screen().findByRole("heading", { level: 1, name: "Documentação do DougBot" })).toBeTruthy();
  expect(
    screen()
      .getByRole("link", { name: /Código aberto/ })
      .getAttribute("href"),
  ).toBe("/docs/open-source");
  cleanup();
  await renderApp("/docs/ai-apps", { api });
  expect(await screen().findByRole("heading", { level: 1, name: "Apps de IA" })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(OLD);
});
