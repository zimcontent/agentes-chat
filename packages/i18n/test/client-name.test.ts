import { afterEach, describe, expect, test } from "bun:test";
import { BRAND_NAME, brandName, brandText, brandTree, setClientProductName } from "../src";

/**
 * A server deployed for one client signs its name (ADR doug-0023): `setClientProductName` renames every string that
 * goes through `brandText`/`brandTree` from then on, and addresses and this build's legal names stay as they are.
 */
describe("a client's name over this build's", () => {
  afterEach(() => setClientProductName(null));

  test("the build's own name until a client gives one", () => {
    expect(brandName()).toBe(BRAND_NAME);
    expect(brandText("Welcome to agentes.chat")).toBe("Welcome to DougBot");
  });

  test("both the upstream name and the build's own read as the client's", () => {
    setClientProductName("Padaria Aurora");
    expect(brandName()).toBe("Padaria Aurora");
    expect(brandText("Welcome to agentes.chat")).toBe("Welcome to Padaria Aurora");
    expect(brandText("Open DougBot. DougBot is ready.")).toBe("Open Padaria Aurora. Padaria Aurora is ready.");
    // Addresses keep their words, as they do for this build's own name.
    for (const address of [
      "https://dougbot.app/install",
      "ping@dougbot.app",
      "dougbot.app",
      "/Applications/DougBot.app",
    ]) {
      const text = `Open ${address}`;
      expect(brandText(text)).toBe(text);
    }
  });

  test("a name equal to this build's or blank clears it", () => {
    setClientProductName(BRAND_NAME);
    expect(brandName()).toBe(BRAND_NAME);
    setClientProductName("  ");
    expect(brandName()).toBe(BRAND_NAME);
  });

  test("the trees an app builds after it read the client come under its name too", () => {
    setClientProductName("Café Sol");
    expect(brandTree({ a: "agentes.chat Cloud", b: ["DougBot's servers"] })).toEqual({
      a: "Café Sol Cloud",
      b: ["Café Sol's servers"],
    });
  });
});
