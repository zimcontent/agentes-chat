import { expect, test } from "bun:test";
import { atRule, builtCss, declarations, topLevel } from "./built-css";

/**
 * The chips of "Sua marca" (docs/adr/doug-0030-time-doug.md) and the team cards' own `.tp-chip`: one height on the
 * row, the kit's 8 between them, and a target of the kit's 44 on touch without moving the desktop's picture.
 */
test("the brand step's chips hold one height on the kit's grid, and a phone's target grows past them", async () => {
  const css = await builtCss("src/styles.css", "src/pages/onboarding/brand-step.css", "src/components/team-plan.css");
  const shipped = topLevel(css);
  const touch = atRule(css, "@media (pointer: coarse)");
  const last = (sheet: string, selector: string, property: string) =>
    declarations(sheet, selector)
      .filter(([p]) => p === property)
      .at(-1)?.[1];

  // The tones are a fieldset (a block): its chips sit in a flex row, wrapping on the kit's 8, every one as tall as the
  // next, and none stretches into the row's spare width.
  expect(last(shipped, "fieldset.onb-brand__tones", "display")).toBe("flex");
  expect(last(shipped, "fieldset.onb-brand__tones", "flex-wrap")).toBe("wrap");
  expect(last(shipped, "fieldset.onb-brand__tones", "align-items")).toBe("flex-start");
  expect(last(shipped, "fieldset.onb-brand__tones", "gap")).toBe("var(--space-2)");
  expect(last(shipped, "fieldset.onb-brand__tones .tp-chip", "flex")).toBe("none");

  // A chip is 36 tall, one number for the plate and for what its target grows by; the desktop's plate never changes.
  expect(last(shipped, ".tp-chip", "--tp-chip-h")).toBe("36px");
  expect(last(shipped, ".tp-chip", "min-height")).toBe("var(--tp-chip-h)");
  expect(last(touch, ".tp-chip", "position")).toBe("relative");
  expect(last(touch, ".tp-chip::after", "content")).toBe('""');
  // Up and down only, as a small button's: two chips 8 apart never share a target.
  expect(last(touch, ".tp-chip::after", "inset")).toBe("calc((var(--tp-chip-h) - var(--touch-target)) / 2) 0");
});
