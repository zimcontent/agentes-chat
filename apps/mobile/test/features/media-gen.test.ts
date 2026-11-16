import { describe, expect, test } from "bun:test";
import { type MediaModel, mediaModeSpec, NO_MEDIA_FILES } from "@agenteschat/client";
import {
  aspectRatioOf,
  brandLogoId,
  durationsOf,
  hidesModes,
  imageRoom,
  imageTargets,
  mediaForm,
  phoneModels,
  phoneModes,
  pickPhoneMode,
  tileLook,
  tileSide,
  withPending,
} from "../../src/features/media-gen/logic";
import { mediaWords } from "../../src/features/media-gen/words";

const muse: MediaModel = {
  id: "muse-image-1",
  kind: "image",
  label: "Muse Images 1.0",
  description: "",
  qualities: ["1K", "2K"],
  defaultQuality: "1K",
  aspects: ["1:1", "16:9", "9:16"],
  maxRefs: 4,
  prices: { "1K": 10, "2K": 15 },
};

const seedance: MediaModel = {
  id: "seedance-2.5",
  kind: "video",
  label: "Seedance 2.5",
  description: "",
  qualities: ["720p"],
  defaultQuality: "720p",
  aspects: ["16:9", "9:16"],
  durations: { min: 4, max: 6, default: 5 },
  audio: "optional",
  inputs: { images: 3, videos: 2, audios: 1, firstFrame: true, lastFrame: true },
  modesByQuality: {
    "720p": ["text_to_video", "multi_reference", "first_n_last_frames", "video_reference", "edit", "extend"],
  },
  prices: { "720p": { perSecond: true, credits: 20, silentCredits: 10 } },
};

/** A model that only works on a clip: nothing the phone can send. */
const editor: MediaModel = {
  id: "omni-flash-edit",
  kind: "video",
  label: "Omni Flash Edit",
  description: "",
  qualities: ["std"],
  defaultQuality: "std",
  aspects: [],
  inputs: { images: 0, videos: 1, audios: 0, firstFrame: false, lastFrame: false },
  modesByQuality: { std: ["edit"] },
  prices: { std: 100 },
};

const file = (token: string) => ({ token, kind: "image" as const, name: token, url: `file://${token}` });

describe("the phone's modes", () => {
  test("a video model keeps the prompt and the picture modes, never the clip ones", () => {
    expect(phoneModes(seedance, "720p")).toEqual(["text", "first", "frames", "references"]);
    expect(hidesModes(seedance, "720p")).toBe(true);
    expect(hidesModes(muse, "1K")).toBe(false);
  });

  test("a video model with none of them isn't offered", () => {
    expect(phoneModels([muse, seedance, editor], "video").map((m) => m.id)).toEqual(["seedance-2.5"]);
    expect(phoneModels([muse, seedance, editor], "image").map((m) => m.id)).toEqual(["muse-image-1"]);
  });

  test("a mode the phone lacks falls back to one it has", () => {
    expect(pickPhoneMode(seedance, "720p", "edit")).toBe("references");
    expect(pickPhoneMode(seedance, "720p", "frames")).toBe("frames");
    expect(pickPhoneMode(muse, "1K", "text")).toBe("references");
  });
});

describe("the form", () => {
  test("an image starts square, at the model's quality, and waits for a prompt", () => {
    const f = mediaForm([muse], {
      kind: "image",
      audio: true,
      mode: "text",
      files: NO_MEDIA_FILES,
      prompt: "  ",
      uploading: false,
    });
    expect(f.model?.id).toBe("muse-image-1");
    expect(f.aspect).toBe("1:1");
    expect(f.quality).toBe("1K");
    expect(f.why).toBe("prompt");
    expect(f.price).toBe(10);
    expect(f.ask).toEqual({ model: "muse-image-1", quality: "1K", aspect: "1:1" });
  });

  test("a video starts 16:9 with the default length, priced per second, with or without sound", () => {
    const base = {
      kind: "video" as const,
      mode: "text" as const,
      files: NO_MEDIA_FILES,
      prompt: "a boat",
      uploading: false,
    };
    const loud = mediaForm([seedance], { ...base, audio: true });
    expect(loud.aspect).toBe("16:9");
    expect(loud.seconds).toBe(5);
    expect(loud.audioChoice).toBe(true);
    expect(loud.price).toBe(100);
    expect(loud.why).toBeNull();
    expect(loud.ask.mode).toBe("text_to_video");
    expect(mediaForm([seedance], { ...base, audio: false, seconds: 6 }).price).toBe(60);
    // A length the model doesn't offer goes back to its default.
    expect(mediaForm([seedance], { ...base, audio: true, seconds: 30 }).seconds).toBe(5);
  });

  test("frames are required, uploads hold the button, and the files ride in the request", () => {
    const base = {
      kind: "video" as const,
      audio: true,
      mode: "frames" as const,
      prompt: "zoom out",
    };
    expect(mediaForm([seedance], { ...base, files: NO_MEDIA_FILES, uploading: false }).why).toBe("firstFrame");
    expect(mediaForm([seedance], { ...base, files: NO_MEDIA_FILES, uploading: true }).why).toBe("uploading");
    const full = mediaForm([seedance], {
      ...base,
      files: { ...NO_MEDIA_FILES, firstFrame: file("a"), lastFrame: file("b") },
      uploading: false,
    });
    expect(full.why).toBeNull();
    expect(full.ask).toMatchObject({ firstFrame: "a", lastFrame: "b", mode: "first_n_last_frames" });
  });
});

describe("pictures", () => {
  test("picked pictures fill the empty frames first, then the references", () => {
    const frames = mediaModeSpec(seedance, "720p", "frames");
    expect(imageTargets(frames, NO_MEDIA_FILES, 3)).toEqual(["firstFrame", "lastFrame"]);
    const refs = mediaModeSpec(muse, "1K", "references");
    const some = { ...NO_MEDIA_FILES, images: [file("a")] };
    expect(imageRoom(refs, some)).toBe(3);
    expect(imageTargets(refs, some, 5)).toEqual(["images", "images", "images"]);
  });

  test("one on its way takes its room", () => {
    const refs = mediaModeSpec(muse, "1K", "references");
    const room = withPending(NO_MEDIA_FILES, [
      { id: "p1", target: "images", uri: "file://p1" },
      { id: "p2", target: "images", uri: "file://p2" },
    ]);
    expect(imageRoom(refs, room)).toBe(2);
  });
});

describe("the gallery", () => {
  test("a tile shows the result, the run or the failure", () => {
    expect(tileLook({ status: "succeeded", kind: "image", artifactId: "a" })).toBe("image");
    expect(tileLook({ status: "succeeded", kind: "video", artifactId: "a" })).toBe("video");
    expect(tileLook({ status: "running", kind: "video", artifactId: null })).toBe("running");
    expect(tileLook({ status: "failed", kind: "image", artifactId: null })).toBe("failed");
  });

  test("three squares across a 390 pt screen", () => {
    expect(tileSide(390)).toBe(116);
  });

  test("aspects and lengths", () => {
    expect(aspectRatioOf("16:9")).toBeCloseTo(16 / 9);
    expect(aspectRatioOf("auto")).toBeNull();
    expect(durationsOf(seedance)).toEqual([4, 5, 6]);
    expect(durationsOf({ ...seedance, durations: { min: 5, max: 10, fixed: [5, 10], default: 5 } })).toEqual([5, 10]);
  });

  test("a maker's logo: the app's mark, or the brand's initial", () => {
    expect(brandLogoId("google", "Veo 3")).toBe("gemini");
    expect(brandLogoId("qwen", "Wan 2.5")).toBe("alibaba");
    expect(brandLogoId("kling", "Kling 3")).toBe("kling");
    expect(brandLogoId(null, "Mystery")).toBe("Mystery");
  });
});

test("the words: Portuguese for pt, English for the rest", () => {
  expect(mediaWords("pt-BR").newTitle).toBe("Gerar mídia");
  expect(mediaWords("en").newTitle).toBe("Generate media");
  expect(mediaWords("de").newTitle).toBe("Generate media");
});
