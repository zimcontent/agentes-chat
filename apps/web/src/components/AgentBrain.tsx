import type { BrainOption } from "@dougbot/client";
import { planModelById } from "@dougbot/client/lib/plans";

/** The model's label for a brain ("Opus 5.5"), a coding plan's model by its name, else the value as typed. */
export function brainModelLabel(option: BrainOption | undefined, model: string | null) {
  const value = model ?? option?.defaultModel ?? null;
  if (!value) return "";
  return option?.models.find((m) => m.value === value)?.label ?? planModelById(value)?.label ?? value;
}
