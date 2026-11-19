import { describe, expect, test } from "bun:test";
import type { VideoReviewNote } from "@dougbot/client";
import {
  clampStep,
  designNotesOf,
  editable,
  openOn,
  pinNumbers,
  pinsOn,
  sourceUrlOf,
} from "../../src/features/review/design-logic";

const note = (over: Partial<VideoReviewNote>): VideoReviewNote => ({
  id: "n",
  version: 1,
  atMs: null,
  endMs: null,
  page: null,
  kind: null,
  x: null,
  y: null,
  body: "",
  attachments: [],
  voice: false,
  author: null,
  sent: false,
  createdAt: "",
  ...over,
});

describe("design review on the phone", () => {
  const notes = [
    note({ id: "w", page: null }),
    note({ id: "b", page: 2, x: 0.5, y: 0.5 }),
    note({ id: "a", page: 1, x: 0.1, y: 0.2 }),
    note({ id: "c", page: 2, sent: true }),
    note({ id: "old", version: 2, page: 1 }),
  ];

  test("notes go by slide, the whole piece last, and pins are numbered in that order", () => {
    const shown = designNotesOf(notes, 1);
    expect(shown.map((n) => n.id)).toEqual(["a", "b", "c", "w"]);
    expect([...pinNumbers(shown)]).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  test("a slide's pins need a point; its count is what was not sent", () => {
    expect(pinsOn(notes, 2).map((n) => n.id)).toEqual(["b"]);
    expect(openOn(notes, 2)).toBe(1);
  });

  test("only the newest version in review, with its page, opens in the editor", () => {
    const v = (version: number, source: boolean) => ({
      version,
      artifactId: "x",
      note: "",
      light: false,
      pages: [],
      source,
      editedBy: null,
      createdAt: "",
    });
    const review = { versions: [v(1, true), v(2, true)], status: "in_review" as const, version: 2 };
    expect(editable(review, 2)).toBe(true);
    expect(editable(review, 1)).toBe(false);
    expect(editable({ ...review, status: "changes" }, 2)).toBe(false);
    expect(editable({ ...review, versions: [v(1, true), v(2, false)] }, 2)).toBe(false);
  });

  test("the page's address comes from a slide's, and steppers stay in range", () => {
    expect(sourceUrlOf("https://x/api/app/organizations/o/video-reviews/r/versions/3/pages/12")).toBe(
      "https://x/api/app/organizations/o/video-reviews/r/versions/3/source",
    );
    expect(clampStep(98, 5, 0, 100)).toBe(100);
    expect(clampStep(3, -5, 0, 100)).toBe(0);
  });
});
