import { type ModelBrand, modelBrand } from "@dougbot/client";

/**
 * The maker's logo beside a model's name, as the Zim Studio's picker shows it. The files are in
 * `public/brands/models` (see `public/brands/README.md`). A one-color mark is drawn as a mask over the text's
 * color, so it reads on the light and the dark theme; the others keep their own colors.
 */
const MARKS: Record<ModelBrand, { name: string; file: string; mono?: boolean }> = {
  zim: { name: "Zim", file: "zim.png" },
  meta: { name: "Meta", file: "meta-color.svg" },
  bytedance: { name: "ByteDance", file: "bytedance-color.svg" },
  google: { name: "Google", file: "gemini-color.svg" },
  minimax: { name: "MiniMax", file: "minimax-color.svg" },
  kling: { name: "Kling", file: "kling-color.svg" },
  recraft: { name: "Recraft", file: "recraft.svg", mono: true },
  ideogram: { name: "Ideogram", file: "ideogram.svg", mono: true },
  xai: { name: "xAI", file: "grok.svg", mono: true },
  openai: { name: "OpenAI", file: "openai.svg", mono: true },
  qwen: { name: "Qwen", file: "qwen-color.svg" },
};

export function ModelMark({ id, label }: { id: string; label?: string }) {
  const brand = modelBrand(id, label);
  if (!brand) return null;
  const mark = MARKS[brand];
  const src = `/brands/models/${mark.file}`;
  if (mark.mono)
    return <span className="media-mark media-mark--mono" style={{ maskImage: `url(${JSON.stringify(src)})` }} />;
  return <img className="media-mark" src={src} alt="" />;
}
