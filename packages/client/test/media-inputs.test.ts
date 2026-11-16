import { describe, expect, test } from "bun:test";
import {
  fitMediaFiles,
  type MediaFileSet,
  type MediaRefFile,
  mediaAspects,
  mediaDropTarget,
  mediaInputs,
  mediaMissing,
  mediaModeFor,
  mediaModeSpec,
  mediaModes,
  mediaRequestFiles,
  mediaServiceMode,
  pickMediaMode,
} from "../src/media/inputs";
import { type MediaModel, mediaPrice } from "../src/media/types";

// What the Mídia page offers for each model (ADR doug-0011): the Zim Studio's input modes read from the catalog, what
// each mode takes, and the files that stay when the model, the quality or the mode changes.

const base = {
  label: "Model",
  description: "",
  defaultQuality: "720p",
  aspects: ["16:9"],
  durations: { min: 5, max: 10, default: 5 },
  audio: "none" as const,
  prices: { "720p": { perSecond: true, credits: 40, silentCredits: 40 } },
};
const ALL = ["text_to_video", "multi_reference", "first_n_last_frames", "edit", "extend"];
/** Seedance 2.5 as the real catalog has it. */
const seedance25: MediaModel = {
  ...base,
  id: "seedance-2.5",
  kind: "video",
  qualities: ["720p", "1080p"],
  inputs: { images: 30, videos: 10, audios: 10, firstFrame: true, lastFrame: true },
  modesByQuality: { "720p": ALL, "1080p": ALL },
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
const h3: MediaModel = {
  ...base,
  id: "minimax-h3",
  kind: "video",
  qualities: ["768p"],
  defaultQuality: "768p",
  inputs: { images: 9, videos: 3, audios: 0, firstFrame: true, lastFrame: false },
  modesByQuality: { "768p": ["text_to_video", "multi_reference", "video_reference", "first_n_last_frames"] },
};
const omni: MediaModel = {
  ...base,
  id: "omni-flash",
  kind: "video",
  qualities: ["720p"],
  inputs: { images: 1, videos: 1, audios: 0, firstFrame: true, lastFrame: true },
  modesByQuality: { "720p": ["text_to_video", "first_n_last_frames", "multi_reference", "edit"] },
};
const grok: MediaModel = {
  ...base,
  id: "grok-video",
  kind: "video",
  qualities: ["720p", "1080p"],
  inputs: { images: 7, videos: 0, audios: 0, firstFrame: true, lastFrame: false, imagesByQuality: { "1080p": 1 } },
  modesByQuality: { "720p": ["text_to_video", "multi_reference"], "1080p": ["text_to_video", "first_n_last_frames"] },
};
const kling3: MediaModel = {
  ...base,
  id: "kling-3",
  kind: "video",
  qualities: ["720p"],
  inputs: { images: 3, videos: 0, audios: 0, firstFrame: true, lastFrame: true, firstFrameOnly: true },
};
const veo: MediaModel = { ...base, id: "veo", kind: "video", qualities: ["720p"], firstFrame: true };
const picture: MediaModel = {
  ...base,
  id: "nano",
  kind: "image",
  qualities: ["1K"],
  maxRefs: 14,
  prices: { "1K": 10 },
};

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
const tokens = (files: MediaFileSet) => mediaRequestFiles(files);

describe("the modes a model offers", () => {
  test("the Studio's modes, by model and quality", () => {
    expect(mediaModes(seedance25, "720p")).toEqual(["text", "first", "frames", "references", "edit", "extend"]);
    // H3 takes no last frame: a first frame alone, and its own video reference.
    expect(mediaModes(h3)).toEqual(["text", "first", "references", "video_reference"]);
    expect(mediaModes(omni)).toEqual(["text", "first", "frames", "references", "edit"]);
    // Grok: references at 720p, a first frame only at 1080p.
    expect(mediaModes(grok, "720p")).toEqual(["text", "references"]);
    expect(mediaModes(grok, "1080p")).toEqual(["text", "first"]);
    // No modes listed: what the inputs say (Kling 3's only picture is the opening frame).
    expect(mediaModes(kling3)).toEqual(["text", "first"]);
    expect(mediaModes(veo)).toEqual(["text", "first"]);
    // A quality with modes listed and no text_to_video offers no prompt-only mode.
    expect(mediaModes(seedance, "720p")).toEqual(["first", "frames", "references", "video_reference"]);
    expect(mediaModes(picture)).toEqual(["references"]);
  });

  test("what each mode takes", () => {
    expect(mediaModeSpec(seedance25, "720p", "text")).toMatchObject({ firstFrame: false, video: false, images: 0 });
    expect(mediaModeSpec(seedance25, "720p", "first")).toMatchObject({ firstFrame: true, lastFrame: false });
    expect(mediaModeSpec(seedance25, "720p", "frames")).toMatchObject({ firstFrame: true, lastFrame: true });
    expect(mediaModeSpec(seedance25, "720p", "references")).toMatchObject({ images: 30, videos: 10, audios: 10 });
    // Edit: the clip, and references beside it where the model takes more than the one video.
    expect(mediaModeSpec(seedance25, "720p", "edit")).toMatchObject({ video: true, images: 30, videos: 0, audios: 10 });
    expect(mediaModeSpec(seedance25, "720p", "extend")).toMatchObject({ video: true, images: 0, audios: 0 });
    // Omni Flash edits the clip alone, as in the Studio.
    expect(mediaModeSpec(omni, "720p", "edit")).toMatchObject({ video: true, images: 0, audios: 0 });
    expect(mediaModeSpec(h3, "768p", "video_reference")).toMatchObject({ video: true, images: 0 });
    expect(mediaModeSpec(h3, "768p", "references")).toMatchObject({ images: 9, videos: 3, audios: 0 });
    expect(mediaModeSpec(picture, "1K", "references")).toMatchObject({ images: 14 });
    // The service's names: both frame modes are one.
    expect(mediaServiceMode("first")).toBe("first_n_last_frames");
    expect(mediaServiceMode("frames")).toBe("first_n_last_frames");
    expect(mediaServiceMode("references")).toBe("multi_reference");
    expect(mediaServiceMode("text")).toBe("text_to_video");
    expect(mediaServiceMode("edit")).toBe("edit");
  });

  test("a mode the new choice lacks gives way to the nearest one", () => {
    expect(pickMediaMode(seedance25, "720p", "edit")).toBe("edit");
    // Seedance 2.5's frames on H3, which has no last frame: the first frame stays.
    expect(pickMediaMode(h3, "768p", "frames")).toBe("first");
    // An edit on H3: the clip becomes its video reference.
    expect(pickMediaMode(h3, "768p", "edit")).toBe("video_reference");
    // H3's video reference on Seedance 2.5: its references (they take videos).
    expect(pickMediaMode(seedance25, "720p", "video_reference")).toBe("references");
    // Grok at 1080p has no references: the first frame.
    expect(pickMediaMode(grok, "1080p", "references")).toBe("first");
    // Nothing near: the prompt alone.
    expect(pickMediaMode(veo, "720p", "extend")).toBe("text");
  });
});

describe("the files a mode keeps", () => {
  test("frames stay frames, the rest moves by kind, what finds no room goes", () => {
    // References to frames: the pictures in order become the first and last frames.
    const refs: MediaFileSet = { images: [file("i1"), file("i2"), file("i3")], videos: [], audios: [] };
    const frames = fitMediaFiles(refs, mediaModeSpec(seedance25, "720p", "frames"));
    expect(frames.firstFrame?.token).toBe("i1");
    expect(frames.lastFrame?.token).toBe("i2");
    expect(frames.images).toEqual([]);
    // And back: the frames become references.
    const back = fitMediaFiles(frames, mediaModeSpec(seedance25, "720p", "references"));
    expect(back.images.map((f) => f.token)).toEqual(["i1", "i2"]);
    expect(back.firstFrame).toBeUndefined();
    // A reference video becomes the clip of an edit, the references beside it keep what the edit takes.
    const edit = fitMediaFiles(full, mediaModeSpec(seedance25, "720p", "edit"));
    expect(edit.video?.token).toBe("v1");
    expect(edit.videos).toEqual([]);
    expect(edit.images.map((f) => f.token)).toEqual(["first", "last", "i1", "i2"]);
    expect(edit.audios.map((f) => f.token)).toEqual(["a1"]);
    // The prompt alone keeps nothing.
    expect(fitMediaFiles(full, mediaModeSpec(seedance25, "720p", "text"))).toEqual({
      images: [],
      videos: [],
      audios: [],
    });
    // A smaller maximum cuts the list: Seedance at 1080p takes one reference image.
    expect(fitMediaFiles(full, mediaModeSpec(seedance, "1080p", "references")).images.map((f) => f.token)).toEqual([
      "first",
    ]);
    // A frame alone in its slot keeps its place.
    const lastOnly: MediaFileSet = { lastFrame: file("last"), images: [], videos: [], audios: [] };
    expect(fitMediaFiles(lastOnly, mediaModeSpec(seedance25, "720p", "frames"))).toMatchObject({
      lastFrame: { token: "last" },
    });
    expect(fitMediaFiles(lastOnly, mediaModeSpec(seedance25, "720p", "frames")).firstFrame).toBeUndefined();
  });

  test("what a mode still needs, the Studio's checks", () => {
    const empty: MediaFileSet = { images: [], videos: [], audios: [] };
    expect(mediaMissing(mediaModeSpec(seedance25, "720p", "text"), empty)).toBeNull();
    expect(mediaMissing(mediaModeSpec(seedance25, "720p", "first"), empty)).toBe("firstFrame");
    expect(mediaMissing(mediaModeSpec(seedance25, "720p", "frames"), { ...empty, firstFrame: file("f") })).toBe(
      "lastFrame",
    );
    expect(mediaMissing(mediaModeSpec(seedance25, "720p", "references"), empty)).toBe("reference");
    expect(mediaMissing(mediaModeSpec(seedance25, "720p", "edit"), empty)).toBe("editVideo");
    expect(mediaMissing(mediaModeSpec(seedance25, "720p", "extend"), empty)).toBe("extendVideo");
    expect(mediaMissing(mediaModeSpec(h3, "768p", "video_reference"), empty)).toBe("videoReference");
    // An image model's references are optional.
    expect(mediaMissing(mediaModeSpec(picture, "1K", "references"), empty)).toBeNull();
  });

  test("the request: the clip first among the reference videos", () => {
    const edit: MediaFileSet = { video: file("clip", "video"), images: [file("i1")], videos: [], audios: [] };
    expect(tokens(edit)).toEqual({ refs: ["i1"], videoRefs: ["clip"] });
    expect(tokens({ firstFrame: file("f"), lastFrame: file("l"), images: [], videos: [], audios: [] })).toEqual({
      firstFrame: "f",
      lastFrame: "l",
    });
  });

  test("a dropped file goes where its kind goes, or asks for the mode that takes it", () => {
    const empty: MediaFileSet = { images: [], videos: [], audios: [] };
    const frames = mediaModeSpec(seedance25, "720p", "frames");
    expect(mediaDropTarget(frames, empty, "image")).toBe("firstFrame");
    expect(mediaDropTarget(frames, { ...empty, firstFrame: file("f") }, "image")).toBe("lastFrame");
    expect(mediaDropTarget(frames, { ...empty, firstFrame: file("f"), lastFrame: file("l") }, "image")).toBeNull();
    expect(mediaDropTarget(frames, empty, "video")).toBeNull();
    const edit = mediaModeSpec(seedance25, "720p", "edit");
    expect(mediaDropTarget(edit, empty, "video")).toBe("video");
    expect(mediaDropTarget(edit, { ...empty, video: file("v", "video") }, "video")).toBeNull();
    expect(mediaDropTarget(edit, empty, "audio")).toBe("audios");
    // On the prompt alone: a picture opens the first frame, a clip the references, on H3 a sound nothing.
    expect(mediaModeFor(seedance25, "720p", "image")).toBe("first");
    expect(mediaModeFor(seedance25, "720p", "video")).toBe("references");
    expect(mediaModeFor(grok, "720p", "image")).toBe("references");
    expect(mediaModeFor(h3, "768p", "audio")).toBeNull();
  });
});

describe("what a model takes", () => {
  test("inputs by quality, the modes narrowing them, and the older fields", () => {
    expect(mediaInputs(seedance, "720p")).toMatchObject({ images: 9, videos: 3, audios: 3, firstFrame: true });
    expect(mediaInputs(seedance, "1080p").images).toBe(1);
    expect(mediaInputs(kling3)).toMatchObject({ images: 0, firstFrame: true, lastFrame: false });
    expect(mediaInputs(veo)).toMatchObject({ images: 0, firstFrame: true, lastFrame: false, videos: 0 });
    expect(mediaAspects(seedance, "1080p")).toEqual(["16:9", "9:16"]);
    expect(mediaAspects(seedance, "720p")).toEqual(["16:9"]);
  });

  test("a reference video leaves the price to the server's quote", () => {
    expect(mediaPrice(omni, { seconds: 5 })).toBe(200);
    expect(mediaPrice(omni, { seconds: 5, videoRefs: ["ref_x"] })).toBeNull();
  });
});
