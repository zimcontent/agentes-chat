import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCENE_FACES, SCENE_LINES } from "@dougbot/client/lib/purpose-scene";

// A personal workspace's onboarding drawings and agent screens on the phone (ADR 0159 §2, §3): the web's, the same data.
const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("the first question's drawings", () => {
  test("two cards side by side, drawn from the web's numbers, you as your photo or initial", () => {
    const flow = read("src/features/onboarding/OnboardingFlow.tsx");
    expect(flow).toContain("<PurposeScene kind={mode} chosen={on} width={cardWidth} you={{ name: youName, photo }} />");
    expect(flow).toContain("const photo = usePersonPhoto(me.data?.user.image);");
    const scene = read("src/features/onboarding/PurposeScene.tsx");
    expect(scene).toContain('from "@dougbot/client/lib/purpose-scene"');
    expect(scene).toContain("<PersonAvatar name={you.name} size={size} photo={you.photo} />");
    expect(scene).toContain('mode={chosen ? "idle" : "sleep"}');
    // You amid six agents, each joined to you; a chart of five lines under you.
    expect(SCENE_FACES.personal.filter((f) => "look" in f)).toHaveLength(6);
    expect(SCENE_LINES.personal).toHaveLength(6);
    expect(SCENE_LINES.team).toHaveLength(5);
  });
});
