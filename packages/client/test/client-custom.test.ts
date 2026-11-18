import { describe, expect, test } from "bun:test";
import type { ClientBrand, Instance, Me } from "../src/api/types";
import { clientLookOf, NO_CLIENT, productName } from "../src/lib/client-custom";

const meWith = (client: ClientBrand | undefined) => ({ user: {}, organizations: [], client }) as unknown as Me;
const instanceWith = (client: Instance["client"]) => ({ name: "agentes.chat", client }) as unknown as Instance;

const EXAMPLE: ClientBrand = { name: "Padaria Aurora", accent: "#C2410C" };

describe("a server's client look (ADR doug-0032)", () => {
  test("no client anywhere reads as NO_CLIENT", () => {
    // A server with no client sends neither (`client` absent, ADR doug-0032): it reads as one that predates the field.
    expect(clientLookOf(meWith(undefined), instanceWith(undefined))).toEqual(NO_CLIENT);
    expect(clientLookOf(undefined, undefined)).toEqual(NO_CLIENT);
    expect(clientLookOf(meWith(undefined), instanceWith(undefined))).toEqual(
      clientLookOf({ user: {}, organizations: [] } as unknown as Me, { name: "agentes.chat" } as unknown as Instance),
    );
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

  test("a color is painted only in the shape the server's config allows: `#rrggbb`, else none", () => {
    for (const accent of ["#C2410C", "#0f766e", "#FFFFFF"]) {
      expect(clientLookOf(meWith({ name: "Padaria Aurora", accent }))).toEqual({ name: "Padaria Aurora", accent });
    }
    // An old or odd server: anything that isn't `#rrggbb` is read as no color, so the page keeps the identity's green.
    for (const accent of ["red", "#C2410", "#C2410CFF", "rgb(1,2,3)", " #C2410C", ""]) {
      expect(clientLookOf(meWith({ name: "Padaria Aurora", accent })).accent).toBeNull();
    }
    // A blank name is no name: the product's own stands.
    expect(productName(clientLookOf(meWith({ name: "   ", accent: null })), "DougBot")).toBe("DougBot");
  });
});
