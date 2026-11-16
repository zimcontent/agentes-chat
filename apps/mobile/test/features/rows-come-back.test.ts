import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forgetKeptSizes, keepOpen, keptOpen } from "../../src/features/chat/kept-sizes";
import { keptTurn, rememberTurn, SHOWN_MAX } from "../../src/features/chat/turn";

const src = (path: string) => readFileSync(join(import.meta.dir, "../../src", path), "utf8");

afterEach(forgetKeptSizes);

describe("a row comes back as the person left it", () => {
  test("its fades play for what changes while it shows, never again on a scroll back", () => {
    const row = src("features/chat/MessageRow.tsx");
    expect(row).toMatch(
      /export const MessageRow = memo\(function MessageRow\(props: RowProps\) \{\s*return \(\s*<LayoutAnimationConfig skipEntering>\s*<RowBody \{\.\.\.props\} \/>/,
    );
  });

  test("a reply shows the work it showed the first time, however late it comes back", () => {
    const items = [{ kind: "say" as const, key: "s1", text: "Vou olhar" }];
    rememberTurn("run-k1", { items, quotes: {}, at: 1000 });
    expect(keptTurn("msg-k1", "run-k1", 2000)?.items).toEqual(items);
    // A minute later, the same reply still finds it; another reply of an old run doesn't.
    expect(keptTurn("msg-k1", "run-k1", 61_000)?.items).toEqual(items);
    expect(keptTurn("msg-k2", "run-k1", 61_000)).toBeNull();
    // What it showed stays even if its run's work moved on.
    rememberTurn("run-k1", {
      items: [...items, { kind: "say" as const, key: "s2", text: "Pronto" }],
      quotes: {},
      at: 70_000,
    });
    expect(keptTurn("msg-k1", "run-k1", 71_000)?.items).toEqual(items);
    expect(SHOWN_MAX).toBeGreaterThan(0);
    expect(src("features/chat/MessageRow.tsx")).toContain("keptTurn(m.id, m.agentRunId, Date.now())");
  });

  test("its tools left open come back open", () => {
    expect(keptOpen("tools:m1")).toBe(false);
    keepOpen("tools:m1", true);
    expect(keptOpen("tools:m1")).toBe(true);
    keepOpen("tools:m1", false);
    expect(keptOpen("tools:m1")).toBe(false);
    expect(keptOpen(undefined)).toBe(false);
    const tools = src("features/chat/ToolCalls.tsx");
    expect(tools).toContain("const [open, setOpen] = useState(() => defaultOpen || keptOpen(keep));");
    expect(tools).toContain("const [open, setOpen] = useState(() => line.defaultOpen === true || keptOpen(keep));");
    expect(tools).toContain("const [open, setOpen] = useState(() => keptOpen(keep));");
    expect(tools.match(/keepOpen\(keep, !open\);/g)?.length).toBe(2);
    const row = src("features/chat/MessageRow.tsx");
    expect(row.match(/keep=\{`tools:\$\{m\.id\}`\}/g)?.length).toBe(2);
  });
});
