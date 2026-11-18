import { describe, expect, test } from "bun:test";
import type { Agent, ClientCustom, Instance, Me } from "../src/api/types";
import {
  type ClientLook,
  clientHiddenAgentIds,
  clientLookOf,
  hiddenToolsWith,
  NO_CLIENT,
  productName,
  withClientTools,
} from "../src/lib/client-custom";

/** A server's `GET /me` with nothing but the given client. */
const meWith = (client: ClientCustom | null) => ({ user: {}, organizations: [], client }) as unknown as Me;
const instanceWith = (client: Instance["client"]) => ({ name: "agentes.chat", client }) as unknown as Instance;
const agent = (id: string, handle: string, builtin: string | null = null) => ({ id, handle, builtin }) as Agent;

const EXAMPLE: ClientCustom = {
  name: "Padaria Aurora",
  accent: "#C2410C",
  hiddenTools: ["wiki", "review"],
  hiddenAgents: ["otto"],
  onboardingIntro: "Bem-vindo.",
};

describe("a server's client customizations (ADR doug-0020)", () => {
  test("no client anywhere reads as NO_CLIENT: the product's own name, color and tools", () => {
    expect(clientLookOf(meWith(null), instanceWith(null))).toEqual(NO_CLIENT);
    expect(clientLookOf(undefined, undefined)).toEqual(NO_CLIENT);
  });

  test("`me` holds every field; the instance fills in the name and color for a reader that only has it", () => {
    expect(clientLookOf(meWith(EXAMPLE))).toEqual(EXAMPLE);
    expect(clientLookOf(null, instanceWith({ name: "Café Sol", accent: "#0F766E" }))).toMatchObject({
      name: "Café Sol",
      accent: "#0F766E",
      hiddenTools: [],
    });
  });

  test("the product's name: the client's, else the build's", () => {
    expect(productName(EXAMPLE, "DougBot")).toBe("Padaria Aurora");
    expect(productName(NO_CLIENT, "DougBot")).toBe("DougBot");
    expect(productName({ ...NO_CLIENT, name: "   " }, "DougBot")).toBe("DougBot");
  });

  test("the tools a sidebar leaves out are the admin's and the client's, once each", () => {
    expect(hiddenToolsWith(EXAMPLE, ["drive", "wiki"])).toEqual(["drive", "wiki", "review"]);
    expect(hiddenToolsWith(NO_CLIENT, ["drive"])).toEqual(["drive"]);
    expect(withClientTools({ hiddenTools: ["drive"] }, EXAMPLE)).toEqual({ hiddenTools: ["drive", "wiki", "review"] });
    // A workspace with none of its own still carries the client's.
    expect(withClientTools({}, EXAMPLE)).toEqual({ hiddenTools: ["wiki", "review"] });
  });

  test("the agents the client hides are the ones whose handle it names, never the right hand", () => {
    const agents = [agent("a", "Iara"), agent("b", "otto"), agent("c", "doug", "right_hand")];
    expect([...clientHiddenAgentIds(EXAMPLE, agents)]).toEqual(["b"]);
    // Hiding the right hand's handle changes nothing: it is part of the workspace (ADR 0137).
    const hidesRightHand: ClientLook = { ...EXAMPLE, hiddenAgents: ["doug", "otto"] };
    expect([...clientHiddenAgentIds(hidesRightHand, agents)]).toEqual(["b"]);
    expect([...clientHiddenAgentIds(NO_CLIENT, agents)]).toEqual([]);
  });
});
