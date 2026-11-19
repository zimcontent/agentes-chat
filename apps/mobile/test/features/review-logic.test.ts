import { describe, expect, test } from "bun:test";
import { reviewLinksIn, type VideoReviewNote } from "@dougbot/client";
import {
  FILE_PART_MAX_BYTES,
  fitsFilePart,
  notesOf,
  pictureBox,
  reviewIdsOf,
  reviewOpen,
  ringsAt,
  unsentOf,
} from "../../src/features/review/logic";

const R = "11111111-2222-3333-4444-555555555555";
const O = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const note = (over: Partial<VideoReviewNote>): VideoReviewNote => ({
  id: "n",
  version: 1,
  atMs: 0,
  endMs: null,
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

describe("the phone's Revisor", () => {
  test("a version's notes by time, the whole video's last", () => {
    const notes = [
      note({ id: "w", atMs: null }),
      note({ id: "b", atMs: 5000 }),
      note({ id: "a", atMs: 1000 }),
      note({ id: "v2", version: 2, atMs: 0 }),
    ];
    expect(notesOf(notes, 1).map((n) => n.id)).toEqual(["a", "b", "w"]);
  });

  test("a ring shows around its moment, through a stretch, only with a point", () => {
    const at = note({ id: "p", atMs: 4000, x: 0.5, y: 0.5 });
    const span = note({ id: "s", atMs: 1000, endMs: 3000, x: 0.1, y: 0.1 });
    const none = note({ id: "n", atMs: 4000 });
    expect(ringsAt([at, span, none], 4000).map((n) => n.id)).toEqual(["p"]);
    expect(ringsAt([at, span, none], 2500).map((n) => n.id)).toEqual(["s"]);
    expect(ringsAt([at, span, none], 9000)).toEqual([]);
  });

  test("the picture keeps the video's shape inside the room", () => {
    expect(pictureBox(9 / 16, 360, 1000)).toEqual({ width: 360, height: 640 });
    expect(pictureBox(9 / 16, 360, 480)).toEqual({ width: 270, height: 480 });
    expect(pictureBox(16 / 9, 360, 480)).toEqual({ width: 360, height: 203 });
    expect(pictureBox(0, 360, 1000).height).toBe(640);
  });

  test("only the newest version in review takes notes and a decision", () => {
    expect(reviewOpen({ status: "in_review", version: 2 }, 2)).toBe(true);
    expect(reviewOpen({ status: "in_review", version: 2 }, 1)).toBe(false);
    expect(reviewOpen({ status: "approved", version: 2 }, 2)).toBe(false);
    expect(unsentOf({ version: 2, notes: [note({ version: 2 }), note({ version: 2, sent: true }), note({})] })).toBe(1);
  });

  test("a message points at the reviews it links to in this workspace, and at the one it decided", () => {
    const body = `Pronto: https://dougbot.app/org/${O}/review/${R} e de novo /org/${O}/review/${R}`;
    expect(reviewIdsOf(reviewLinksIn(body), O, null)).toEqual([R]);
    expect(reviewIdsOf(reviewLinksIn(body), "other-org", null)).toEqual([]);
    expect(reviewIdsOf([], O, { videoReview: { id: R, version: 1 } })).toEqual([R]);
    expect(reviewIdsOf(reviewLinksIn(body), O, { videoReview: { id: R } })).toEqual([R]);
  });
});

describe("a file read into memory to upload (chat, Drive, WhatsApp)", () => {
  test("up to 200 MB goes; past it the upload is refused before a byte is read; an unknown size is the server's", () => {
    expect(fitsFilePart(FILE_PART_MAX_BYTES)).toBe(true);
    expect(fitsFilePart(FILE_PART_MAX_BYTES + 1)).toBe(false);
    expect(fitsFilePart(2 * 1024 * 1024 * 1024)).toBe(false);
    expect(fitsFilePart(null)).toBe(true);
    expect(fitsFilePart(undefined)).toBe(true);
  });
});
