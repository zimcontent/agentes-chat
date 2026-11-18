import { describe, expect, test } from "bun:test";
import {
  FRONT_MAX,
  frontOf,
  gridOf,
  pillsInHalves,
  pinsOf,
  readPins,
  type ToolsOn,
  togglePin,
  toolsHere,
  waitingBehind,
  withPins,
} from "../../src/features/chats/all-tools";

const ALL_ON: ToolsOn = { whatsapp: true, media: true, portal: true, calendar: false, member: true, hidden: [] };
const keysOf = (on: ToolsOn) => toolsHere(on).map((t) => t.key);

describe("the tools in Tudo", () => {
  test("in the design's order, Agenda behind its switch", () => {
    expect(keysOf(ALL_ON)).toEqual([
      "whatsapp",
      "proposals",
      "issues",
      "review",
      "portal",
      "team",
      "routines",
      "dashboards",
      "wiki",
      "media",
      "drive",
      "vault",
      "computer",
      "people",
      "settings",
      "search",
    ]);
    expect(keysOf({ ...ALL_ON, calendar: true })[1]).toBe("calendar");
  });

  test("WhatsApp, Mídia and Portal only where on; the workspace's pages only for a member", () => {
    const keys = keysOf({ ...ALL_ON, whatsapp: false, media: false, portal: false, member: false });
    for (const k of ["whatsapp", "media", "portal", "vault", "computer", "people"]) expect(keys).not.toContain(k);
    expect(keys).toContain("settings");
  });

  test("an admin's hidden tools leave, the phone's own pages stay", () => {
    const keys = keysOf({ ...ALL_ON, hidden: ["whatsapp", "review", "team", "drive", "settings", "vault"] });
    expect(keys).not.toContain("whatsapp");
    expect(keys).not.toContain("review");
    expect(keys).not.toContain("team");
    expect(keys).not.toContain("drive");
    expect(keys).toContain("settings");
    expect(keys).toContain("vault");
  });

  test("Buscar is the sheet's field: a tile only while editing", () => {
    const tools = toolsHere(ALL_ON);
    expect(gridOf(tools, false).map((t) => t.key)).not.toContain("search");
    expect(gridOf(tools, true).map((t) => t.key)).toContain("search");
  });

  test("tabs are gone to, the rest pushed", () => {
    const tabs = toolsHere(ALL_ON).filter((t) => t.tab);
    expect(tabs.map((t) => t.href)).toEqual(["/reviews", "/portal"]);
  });
});

describe("Início's front row", () => {
  test("before anyone chose, today's order, the next taking an absent tool's place", () => {
    expect(frontOf(toolsHere(ALL_ON), null)).toEqual(["whatsapp", "media", "search", "issues"]);
    expect(frontOf(toolsHere({ ...ALL_ON, whatsapp: false }), null)).toEqual(["media", "search", "issues", "drive"]);
    expect(frontOf(toolsHere({ ...ALL_ON, whatsapp: false, media: false }), null)).toEqual([
      "search",
      "issues",
      "drive",
      "team",
    ]);
  });

  test("the person's pins, in their order, among what is here", () => {
    const tools = toolsHere({ ...ALL_ON, whatsapp: false });
    expect(frontOf(tools, ["settings", "whatsapp", "wiki"])).toEqual(["settings", "wiki"]);
    expect(frontOf(tools, [])).toEqual([]);
  });

  test("pinning: in at the end, out wherever, never past four", () => {
    expect(togglePin(["issues"], "wiki")).toEqual({ pins: ["issues", "wiki"], full: false });
    expect(togglePin(["issues", "wiki"], "issues")).toEqual({ pins: ["wiki"], full: false });
    const four = ["issues", "wiki", "drive", "team"] as const;
    expect(togglePin(four, "media")).toEqual({ pins: four, full: true });
    expect(togglePin(four, "drive").pins).toEqual(["issues", "wiki", "team"]);
  });

  test("Mais counts what waits behind it, not what the row shows", () => {
    const tools = toolsHere(ALL_ON);
    const counts = { issues: 2, review: 3, whatsapp: 4, proposals: 1 };
    expect(waitingBehind(tools, ["whatsapp", "media", "search", "issues"], counts)).toBe(4);
    expect(waitingBehind(tools, ["review"], counts)).toBe(7);
  });
});

describe("the pins on the phone", () => {
  test("kept per workspace", () => {
    const one = withPins(null, "org-a", ["wiki", "drive"]);
    const two = withPins(one, "org-b", ["settings"]);
    expect(pinsOf(two, "org-a")).toEqual(["wiki", "drive"]);
    expect(pinsOf(two, "org-b")).toEqual(["settings"]);
    expect(pinsOf(two, "org-c")).toBeNull();
  });

  test("anything unreadable or unknown is dropped", () => {
    expect(pinsOf("not json", "org-a")).toBeNull();
    expect(pinsOf(null, "org-a")).toBeNull();
    expect(withPins("[1,2]", "org-a", ["wiki"])).toBe('{"org-a":["wiki"]}');
    expect(readPins(["wiki", "nope", "wiki", 3, "drive", "team", "media", "issues"])).toEqual([
      "wiki",
      "drive",
      "team",
      "media",
    ]);
    expect(readPins("wiki")).toBeNull();
    expect(FRONT_MAX).toBe(4);
  });
});

describe("the sheet's pills, two to a row only while their words fit", () => {
  test("Criar's two on a 390 phone sit side by side; on a 320 one they stack instead of cutting a word", () => {
    expect(pillsInHalves(["Nova conversa", "Novo agente"], 338)).toBe(true);
    expect(pillsInHalves(["Nova conversa", "Novo agente"], 268)).toBe(false);
  });
  test("a conversation's four short ones stay in halves at 320", () => {
    expect(pillsInHalves(["GIFs", "Missão", "Resumo", "Lembrete"], 268)).toBe(true);
  });
  test("three (Fotos, Câmera, Arquivo) are never halves: they lie as wide as their words", () => {
    expect(pillsInHalves(["Fotos", "Câmera", "Arquivo"], 338)).toBe(false);
  });
});
