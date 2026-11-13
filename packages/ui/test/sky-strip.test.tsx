import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { cleanup, render } from "@testing-library/react";
import { SkyStrip } from "../src";

afterEach(() => cleanup());

describe("the agent's sky strip", () => {
  // DougBot draws it as a line of green glass (doug.css), no canvas of pixels in the agent's colors.
  test("a quiet line, its light running only while the agent works and never in a person's control", () => {
    const { container, rerender } = render(<SkyStrip color="sky" moving />);
    const strip = container.querySelector(".ac-sky-strip");
    expect(strip?.tagName).toBe("SPAN");
    expect(container.querySelector("canvas")).toBeNull();
    expect(strip?.getAttribute("aria-hidden")).toBe("true");
    expect(strip?.hasAttribute("data-moving")).toBe(true);
    rerender(<SkyStrip color="sky" moving={false} muted />);
    const still = container.querySelector(".ac-sky-strip");
    expect(still?.hasAttribute("data-moving")).toBe(false);
    expect(still?.classList.contains("is-muted")).toBe(true);
  });
});
