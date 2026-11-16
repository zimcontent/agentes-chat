import { describe, expect, test } from "bun:test";
import { fitMediaFiles, type MediaFileSet, type MediaRefFile, mediaAspects, mediaInputs } from "../src/media/inputs";
import { type MediaModel, mediaPrice } from "../src/media/types";

// What the Mídia page offers for each model (ADR doug-0011): the same reading of the catalog as the server's, and
// the files that stay when the choice changes.

const base = {
  label: "Model",
  description: "",
  defaultQuality: "720p",
  aspects: ["16:9"],
  durations: { min: 5, max: 10, default: 5 },
  audio: "none" as const,
  prices: { "720p": { perSecond: true, credits: 40, silentCredits: 40 } },
};
const seedance: MediaModel = {
  ...base,
  id: "seedance",
  kind: "video",
  qualities: ["720p", "1080p"],
  aspectsByQuality: { "1080p": ["16:9", "9:16"] },
  inputs: { images: 9, videos: 3, audios: 3, firstFrame: true, lastFrame: true, imagesByQuality: { "1080p": 1 } },
  modesByQuality: { "720p": ["multi_reference", "first_n_last_frames", "video_reference"] },
};
const kling4: MediaModel = {
  ...base,
  id: "kling-4",
  kind: "video",
  qualities: ["720p"],
  inputs: { images: 4, videos: 1, audios: 0, firstFrame: true, lastFrame: true, framesOrRefs: true },
};
const kling3: MediaModel = {
  ...base,
  id: "kling-3",
  kind: "video",
  qualities: ["720p"],
  inputs: { images: 3, videos: 0, audios: 0, firstFrame: true, lastFrame: true, firstFrameOnly: true },
};
const veo: MediaModel = { ...base, id: "veo", kind: "video", qualities: ["720p"], firstFrame: true };

const file = (token: string, kind: MediaRefFile["kind"] = "image"): MediaRefFile => ({
  token,
  kind,
  name: token,
  url: `blob:${token}`,
});
const full: MediaFileSet = {
  firstFrame: file("first"),
  lastFrame: file("last"),
  images: [file("i1"), file("i2")],
  videos: [file("v1", "video")],
  audios: [file("a1", "audio")],
};

describe("what a model takes", () => {
  test("inputs by quality, the modes narrowing them, and the older fields", () => {
    expect(mediaInputs(seedance, "720p")).toEqual({
      images: 9,
      videos: 3,
      audios: 3,
      firstFrame: true,
      lastFrame: true,
      // Frames and references never go in one request: a model that takes both makes the person pick.
      framesOrRefs: true,
    });
    // No modes listed at 1080p: the catalog's inputs, with that quality's own image count.
    expect(mediaInputs(seedance, "1080p").images).toBe(1);
    expect(mediaInputs(kling3)).toMatchObject({ images: 0, firstFrame: true, lastFrame: false });
    expect(mediaInputs(veo)).toMatchObject({ images: 0, firstFrame: true, lastFrame: false, videos: 0 });
    expect(mediaAspects(seedance, "1080p")).toEqual(["16:9", "9:16"]);
    expect(mediaAspects(seedance, "720p")).toEqual(["16:9"]);
  });

  test("changing the model drops what the new one doesn't take", () => {
    expect(fitMediaFiles(full, mediaInputs(veo), "frames")).toEqual({
      firstFrame: full.firstFrame,
      lastFrame: undefined,
      images: [],
      videos: [],
      audios: [],
    });
    expect(fitMediaFiles(full, mediaInputs(seedance, "1080p"), "frames").images).toEqual([]);
    expect(fitMediaFiles(full, mediaInputs(seedance, "1080p"), "refs").images.map((f) => f.token)).toEqual(["i1"]);
    // Kling 4.0: frames or references, the side the person picked.
    const frames = fitMediaFiles(full, mediaInputs(kling4), "frames");
    expect(frames.firstFrame?.token).toBe("first");
    expect(frames.images).toEqual([]);
    const refs = fitMediaFiles(full, mediaInputs(kling4), "refs");
    expect(refs.firstFrame).toBeUndefined();
    expect(refs.lastFrame).toBeUndefined();
    expect(refs.videos.map((f) => f.token)).toEqual(["v1"]);
    expect(refs.audios).toEqual([]);
  });

  test("a last frame never stays without its first", () => {
    const { firstFrame: _, ...noFirst } = full;
    expect(fitMediaFiles(noFirst, mediaInputs(seedance, "720p"), "frames").lastFrame).toBeUndefined();
  });

  test("a reference video leaves the price to the server's quote", () => {
    expect(mediaPrice(kling4, { seconds: 5 })).toBe(200);
    expect(mediaPrice(kling4, { seconds: 5, videoRefs: ["ref_x"] })).toBeNull();
  });
});
