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

  test("a name with a `$` in it reaches the screen as typed: it is not read as a replacement pattern", () => {
    setClientProductName("Doces R$1 & Cia $&");
    expect(brandText("Welcome to agentes.chat")).toBe("Welcome to Doces R$1 & Cia $&");
    expect(brandText("Open DougBot.")).toBe("Open Doces R$1 & Cia $&.");
    // `$&` would stand for the whole match and `$1` for the captured character: neither does.
    expect(brandText("agentes.chat")).toBe("Doces R$1 & Cia $&");
  });

  test("branding twice reads the same, also for a name that holds the build's own", () => {
    setClientProductName("DougBot Padaria");
    const once = brandText("Welcome to agentes.chat · DougBot is ready");
    expect(once).toBe("Welcome to DougBot Padaria · DougBot Padaria is ready");
    expect(brandText(once)).toBe(once);
    expect(brandTree(brandTree({ a: "agentes.chat" }))).toEqual({ a: "DougBot Padaria" });
  });

  test("with no client, branding twice reads the same too", () => {
    const once = brandText("Welcome to agentes.chat");
    expect(once).toBe("Welcome to DougBot");
    expect(brandText(once)).toBe(once);
  });
});
