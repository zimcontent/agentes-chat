import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (path: string) => readFileSync(join(import.meta.dir, "../src", path), "utf8");

// A mark that loops while an agent works draws on the UI thread (`useLoop`), never through a React render on the
// shared frame clock: each render is a Fabric commit, and every commit has iOS walk every view of every mounted list
// on the main thread, which on a long conversation kept it past the system's 10 s allowance (0x8BADF00D).
test("the marks that loop while an agent works never re-render through the frame clock", () => {
  for (const file of ["agent/PixelMarks.tsx", "features/chat/LiveRows.tsx", "features/chat/ToolCalls.tsx"]) {
    const text = source(file);
    expect(text, file).not.toContain("useFrameTime");
    expect(text, file).toContain("useLoop(");
  }
});
