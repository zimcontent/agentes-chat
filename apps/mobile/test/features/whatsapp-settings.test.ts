import { describe, expect, test } from "bun:test";
import type { WhatsAppAccount, WhatsAppBrain } from "@agenteschat/client";
import {
  accountsOf,
  changed,
  chooseAgent,
  draftOf,
  effortShown,
  kindsOffered,
  patchOf,
  withOwn,
} from "../../src/features/whatsapp/settings-rules";
import { whatsappWords } from "../../src/features/whatsapp/words";

/** A number's settings on the phone (docs/adr/doug-0004-whatsapp-bridge.md, addendum 2026-11-17). */

const style = { waitSeconds: 8, pace: "natural" as const, messages: 2, quietMinutes: 60, voiceNotes: true };
const saved = (over: Partial<WhatsAppAccount> = {}): WhatsAppAccount =>
  ({
    id: "n1",
    label: "DOUG",
    status: "connected",
    phone: "13212048550",
    agentId: "ag1",
    agentOn: true,
    agentStyle: style,
    instructions: "# Atendimento",
    manage: true,
    mine: true,
    ...over,
  }) as WhatsAppAccount;

describe("what Save sends", () => {
  test("nothing changed: nothing to save", () => {
    const a = saved();
    expect(changed(a, draftOf(a))).toBe(false);
    expect(patchOf(a, draftOf(a))).toEqual({});
  });

  test("only what changed, a style by its own fields", () => {
    const a = saved();
    const draft = { ...draftOf(a), instructions: "# Novo", style: { ...style, pace: "fast" as const } };
    expect(patchOf(a, draft)).toEqual({ instructions: "# Novo", agentStyle: { pace: "fast" } });
  });

  test("a number with no instructions yet reads as empty, not as a change", () => {
    const a = saved({ instructions: null });
    expect(draftOf(a).instructions).toBe("");
    expect(changed(a, draftOf(a))).toBe(false);
  });

  test("only people answer: the agent goes and stops answering", () => {
    const a = saved();
    const draft = chooseAgent(draftOf(a), null);
    expect(patchOf(a, draft)).toEqual({ agentId: null, agentOn: false });
  });

  test("an agent for a number that had none starts answering; another agent keeps the switch", () => {
    const none = saved({ agentId: null, agentOn: false });
    expect(patchOf(none, chooseAgent(draftOf(none), "ag2"))).toEqual({ agentId: "ag2", agentOn: true });
    const off = saved({ agentOn: false });
    expect(patchOf(off, chooseAgent(draftOf(off), "ag2"))).toEqual({ agentId: "ag2" });
  });
});

describe("the number's AI", () => {
  const view = (over: Partial<WhatsAppBrain>) =>
    ({ brain: "model", options: [], accounts: [], ...over }) as unknown as WhatsAppBrain;

  test("an API key always; a plan only where the agent's computer offers it, or the one it has", () => {
    expect(kindsOffered(view({}))).toEqual(["model"]);
    expect(
      kindsOffered(
        view({
          options: [
            { kind: "claude_code", available: true, models: [], defaultModel: null },
            { kind: "codex", available: false, models: [], defaultModel: null },
            { kind: "cursor", available: true, models: [], defaultModel: null },
          ],
        }),
      ),
    ).toEqual(["model", "claude_code"]);
    expect(kindsOffered(view({ brain: "antigravity" }))).toEqual(["model", "antigravity"]);
  });

  test("effort: the runner's three, anything else is Automático", () => {
    expect(effortShown("high")).toBe("high");
    expect(effortShown("xhigh")).toBe("auto");
    expect(effortShown(null)).toBe("auto");
  });

  test("accounts of the kind picked", () => {
    const v = view({
      accounts: [
        { id: "c", kind: "claude_code" },
        { id: "x", kind: "codex" },
      ] as WhatsAppBrain["accounts"],
    });
    expect(accountsOf(v, "codex").map((a) => a.id)).toEqual(["x"]);
  });

  test("a value saved outside the list stays among the choices, in order", () => {
    expect(withOwn([3, 8, 15], 10)).toEqual([3, 8, 10, 15]);
    expect(withOwn([3, 8, 15], 8)).toEqual([3, 8, 15]);
  });
});

describe("words", () => {
  test("both languages say every setting, with no semicolon", () => {
    for (const w of [whatsappWords("pt-BR"), whatsappWords("en")]) {
      const flat = JSON.stringify(w.settings) + JSON.stringify(w.style);
      expect(flat).not.toContain(";");
      expect(w.settings.heard("oi")).toContain("oi");
      expect(w.settings.aiContextNote("Doug")).toContain("Doug");
    }
    expect(whatsappWords("pt-BR").settings.aiEfforts.high).toBe("Alto");
  });
});
