import { describe, expect, test } from "bun:test";
import { agentsByAnyHandle } from "@agenteschat/client/lib/directory";
import { ROLE_DEFAULTS, ROLE_IDS } from "@agenteschat/client/lib/new-agent";
import { fullLook } from "../../src/features/agents/edit";
import { agentLook } from "../../src/features/shared/logic";

describe("an agent's look", () => {
  test("every part is set, unknown values fall back to the default agent", () => {
    expect(fullLook({ color: "rose", eyes: "happy", accessory: "crown" })).toEqual({
      color: "rose",
      eyes: "happy",
      accessory: "crown",
    });
    expect(fullLook({ color: "plaid", eyes: 3 })).toEqual({ color: "sky", eyes: "round", accessory: "none" });
    expect(fullLook(undefined)).toEqual({ color: "sky", eyes: "round", accessory: "none" });
  });

  test("a custom #rrggbb color is kept (lowercased); a malformed one falls back to sky", () => {
    expect(fullLook({ color: "#AABBCC", eyes: "round" }).color).toBe("#aabbcc");
    expect(agentLook({ appearance: { color: "#123abc", eyes: "dots" } }).color).toBe("#123abc");
    expect(fullLook({ color: "#abc", eyes: "round" }).color).toBe("sky");
    expect(agentLook({ appearance: { color: "#12345g" } }).color).toBe("sky");
  });

  test("every role starts with a look the phone can draw", () => {
    for (const id of ROLE_IDS) {
      const look = ROLE_DEFAULTS[id].look;
      expect(fullLook(look)).toEqual(look);
    }
  });
});

describe("an agent renamed", () => {
  test("a notice that names an old @ shows the agent now called by another", () => {
    const byHandle = agentsByAnyHandle([
      { id: "a1", name: "Claudio", handle: "claudio", previousHandles: ["ada"] },
      { id: "a2", name: "Atlas", handle: "atlas" },
    ]);
    expect(byHandle.get("ada")?.name).toBe("Claudio");
    expect(byHandle.get("claudio")?.name).toBe("Claudio");
    expect(byHandle.get("atlas")?.name).toBe("Atlas");
  });
});
