import { describe, expect, test } from "bun:test";
import { blockOpenPhone, blockOpenWeb } from "../src/lib/block-open";

const A = "0190f0c2-1111-7000-8000-000000000001";
const C = "0190f0c2-2222-7000-8000-000000000002";

describe("a card's open buttons (docs/adr/doug-0020-doug-sector-cards.md)", () => {
  test("a WhatsApp conversation on the web and on the phone", () => {
    expect(blockOpenWeb("o", { place: "whatsapp", id: A, sub: C })).toEqual({
      kind: "app",
      path: "/org/o/whatsapp",
      search: { account: A, chat: C },
    });
    expect(blockOpenPhone({ place: "whatsapp", id: A, sub: C })).toEqual({
      kind: "app",
      path: "/whatsapp/chat",
      search: { account: A, chat: C },
    });
    expect(blockOpenPhone({ place: "whatsapp", id: A })).toEqual({ kind: "app", path: `/whatsapp/${A}` });
  });

  test("an id that isn't one opens the list; an address that isn't https opens nothing", () => {
    expect(blockOpenWeb("o", { place: "whatsapp", id: "../x" })).toEqual({ kind: "app", path: "/org/o/whatsapp" });
    expect(blockOpenWeb("o", { place: "task", id: "12" })).toEqual({ kind: "app", path: "/org/o/issues/12" });
    expect(blockOpenPhone({ place: "review", id: "nope" })).toEqual({ kind: "app", path: "/reviews" });
    expect(blockOpenWeb("o", { place: "link", href: "javascript:alert(1)" })).toBeNull();
    expect(blockOpenPhone({ place: "link", href: "https://meet.google.com/x" })).toEqual({
      kind: "outside",
      href: "https://meet.google.com/x",
    });
    expect(blockOpenPhone({ place: "calendar" })).toBeNull();
  });
});
