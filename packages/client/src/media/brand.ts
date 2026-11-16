/**
 * Whose model each one is, for the logo beside its name in the model picker (ADR doug-0011). The same rules as
 * the Zim Studio's picker, matched on a piece of the id or the label: one model goes by several spellings
 * (`seedance-2.5`, "Seedance 2.5"), and a new member of a family keeps its family's name. The first rule that
 * matches wins, so the narrow ones come first. An unknown model gets no logo rather than a generic one.
 */
export type ModelBrand =
  | "zim"
  | "meta"
  | "bytedance"
  | "google"
  | "minimax"
  | "kling"
  | "recraft"
  | "ideogram"
  | "xai"
  | "openai"
  | "qwen";

const RULES: readonly (readonly [RegExp, ModelBrand])[] = [
  [/vertigo|mirage|\bzim\b/i, "zim"],
  [/muse[-_ ]?image|\bmeta\b/i, "meta"],
  [/seedance|seedream|\bsd\d|bytedance/i, "bytedance"],
  [/nano[-_ ]?banana|omni[-_ ]?flash|gemini|veo/i, "google"],
  [/minimax|\bh3\b/i, "minimax"],
  [/kling/i, "kling"],
  [/recraft/i, "recraft"],
  [/ideogram/i, "ideogram"],
  [/grok|\bxai\b/i, "xai"],
  [/gpt[-_ ]?image|openai|dall/i, "openai"],
  [/qwen|\bwan[-_ ]?\d/i, "qwen"],
];

/** The brand of a model, from its id or its label; null when no rule knows it. */
export function modelBrand(...names: (string | null | undefined)[]): ModelBrand | null {
  for (const name of names) {
    if (!name) continue;
    for (const [pattern, brand] of RULES) if (pattern.test(name)) return brand;
  }
  return null;
}
