import { describe, expect, test } from "bun:test";
import { BRAND_NAME as CONFIG_NAME, testConfig } from "@agenteschat/config";
import { BRAND_NAME } from "@agenteschat/i18n/brand";

/**
 * DougBot: the name is written in `@agenteschat/i18n/brand` (the apps' kit re-exports it). The config package imports
 * no other, so it holds a copy: this keeps the two the same.
 */
describe("this instance's name", () => {
  test("is one name everywhere it is held", () => {
    expect(CONFIG_NAME).toBe(BRAND_NAME);
  });

  test("the default sender reads as ours even on the original project's own hosts, at their address", () => {
    expect(testConfig({ PUBLIC_URL: "https://app.agentes.chat" }).EMAIL_FROM).toBe(`${BRAND_NAME} <ping@agentes.chat>`);
  });
});
