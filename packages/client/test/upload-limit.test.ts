import { describe, expect, test } from "bun:test";
import { droppedLink, fitsUpload, MAX_IMPORT_FILE_BYTES, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "../src/lib/files";

const GB = 1024 * 1024 * 1024;

describe("a conversation's file (ADR 0025, 2026-11-14)", () => {
  test("up to 2 GB, whatever its type; past it refused before sending", () => {
    expect(MAX_UPLOAD_BYTES).toBe(2 * GB);
    expect(MAX_UPLOAD_MB).toBe(2048);
    expect(fitsUpload({ size: 50 * 1024 * 1024 + 1 })).toBe(true);
    expect(fitsUpload({ size: 2 * GB })).toBe(true);
    expect(fitsUpload({ size: 2 * GB + 1 })).toBe(false);
    // An agent's import keeps its own 50 MB.
    expect(MAX_IMPORT_FILE_BYTES).toBe(50 * 1024 * 1024);
  });

  test("a dragged link goes into the message as text", () => {
    const drag = (data: Record<string, string>) => ({ getData: (type: string) => data[type] ?? "" });
    expect(droppedLink(drag({ "text/uri-list": "# a comment\r\nhttps://example.com/a?b=1\r\n" }))).toBe(
      "https://example.com/a?b=1",
    );
    expect(droppedLink(drag({ "text/plain": "  http://example.com/x  " }))).toBe("http://example.com/x");
    expect(droppedLink(drag({ "text/plain": "just words" }))).toBeNull();
    expect(droppedLink(drag({ "text/uri-list": "javascript:alert(1)" }))).toBeNull();
    expect(droppedLink(null)).toBeNull();
  });
});
