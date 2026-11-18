import { describe, expect, test } from "bun:test";
import type { ClientBrand, Instance, Me } from "../src/api/types";
import { clientLookOf, NO_CLIENT, productName } from "../src/lib/client-custom";

const meWith = (client: ClientBrand | null) => ({ user: {}, organizations: [], client }) as unknown as Me;
const instanceWith = (client: Instance["client"]) => ({ name: "agentes.chat", client }) as unknown as Instance;

const EXAMPLE: ClientBrand = { name: "Padaria Aurora", accent: "#C2410C" };

describe("a server's client look (ADR doug-0023)", () => {
  test("no client anywhere reads as NO_CLIENT", () => {
    expect(clientLookOf(meWith(null), instanceWith(null))).toEqual(NO_CLIENT);
    expect(clientLookOf(undefined, undefined)).toEqual(NO_CLIENT);
  });

  test("`me` wins; the instance fills in for a reader that only has it", () => {
    expect(clientLookOf(meWith(EXAMPLE))).toEqual(EXAMPLE);
    expect(clientLookOf(null, instanceWith({ name: "Café Sol", accent: "#0F766E" }))).toEqual({
      name: "Café Sol",
      accent: "#0F766E",
    });
  });

  test("the product's name: the client's, else the build's", () => {
    expect(productName(EXAMPLE, "DougBot")).toBe("Padaria Aurora");
    expect(productName(NO_CLIENT, "DougBot")).toBe("DougBot");
    expect(productName({ ...NO_CLIENT, name: "   " }, "DougBot")).toBe("DougBot");
  });
});
