import { describe, expect, test } from "bun:test";
import { modelBrand } from "../src/media/brand";

describe("the logo beside a model's name (ADR doug-0011)", () => {
  test("every model of the catalog has its maker, by id or label", () => {
    const cases: [string, string, string][] = [
      ["seedance-2.5", "Seedance 2.5", "bytedance"],
      ["seedream-5", "Seedream 5.0", "bytedance"],
      ["nano-banana-2-1", "Nano Banana 2.1", "google"],
      ["veo-3-1", "Google Veo 3.1", "google"],
      ["omni-flash", "Gemini Omni 1.1 Flash", "google"],
      ["minimax-h3-lite", "MiniMax H3 Lite", "minimax"],
      ["kling-4", "Kling 4.0", "kling"],
      ["grok-imagine", "Grok Imagine 1.5", "xai"],
      ["gpt-image-2-6", "GPT Image 2.6", "openai"],
      ["wan-3-standard", "Wan 3.0 Standard", "qwen"],
      ["qwen-image-3", "Qwen Image 3", "qwen"],
      ["muse-image-1", "Muse Images 1.0", "meta"],
      ["vertigo", "Vertigo 1.0", "zim"],
      ["recraft-v4", "Recraft V4", "recraft"],
      ["ideogram-3", "Ideogram 3.0", "ideogram"],
    ];
    for (const [id, label, brand] of cases) expect([id, modelBrand(id, label)]).toEqual([id, brand]);
  });

  test("an unknown model gets no logo", () => {
    expect(modelBrand("something-new", "Something New")).toBeNull();
    expect(modelBrand(undefined)).toBeNull();
  });
});
