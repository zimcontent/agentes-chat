import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { cleanup, render, within } from "@testing-library/react";
import { Chip, DougOutline, OUTLINE_LAP_MS, OUTLINE_TRAIL, outlinePhase, PixelSpinner, Spinner } from "../src";
import {
  DOUG_OUTLINE_BOX,
  DOUG_OUTLINE_PATH,
  dougOutline,
  outlinePoint,
  outlineSlice,
} from "../src/brand/doug-outline";

afterEach(cleanup);

describe("PixelSpinner", () => {
  test("the outline is the Doug's head, closed and clockwise, measured in laps", () => {
    const { points, at } = dougOutline();
    expect(at).toHaveLength(points.length + 1);
    expect(at[0]).toBe(0);
    expect(at.at(-1)).toBeCloseTo(1, 10);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(DOUG_OUTLINE_BOX.x - 0.01);
      expect(x).toBeLessThanOrEqual(DOUG_OUTLINE_BOX.x + DOUG_OUTLINE_BOX.w + 0.01);
      expect(y).toBeGreaterThanOrEqual(DOUG_OUTLINE_BOX.y - 0.01);
      expect(y).toBeLessThanOrEqual(DOUG_OUTLINE_BOX.y + DOUG_OUTLINE_BOX.h + 0.01);
    }
    // Clockwise on screen (y down): the shoelace sum is positive.
    const area = points.reduce((sum, [x, y], i) => {
      const [nx, ny] = points[(i + 1) % points.length] ?? [0, 0];
      return sum + (x * ny - nx * y);
    }, 0);
    expect(area).toBeGreaterThan(0);
  });

  test("a stretch of the outline starts and ends where asked, also past the start", () => {
    const slice = outlineSlice(0.9, 1.1);
    expect(slice[0]).toEqual(outlinePoint(0.9));
    expect(slice.at(-1)).toEqual(outlinePoint(0.1));
    expect(slice.length).toBeGreaterThan(2);
    // Every corner it passes is between its two ends: its length is a fifth of the lap.
    const { points, at } = dougOutline();
    const lap = points.reduce((sum, [x, y], i) => {
      const [nx, ny] = points[(i + 1) % points.length] ?? [0, 0];
      return sum + Math.hypot(nx - x, ny - y);
    }, 0);
    const len = slice
      .slice(1)
      .reduce((sum, [x, y], i) => sum + Math.hypot(x - (slice[i]?.[0] ?? 0), y - (slice[i]?.[1] ?? 0)), 0);
    expect(len / lap).toBeCloseTo(0.2, 6);
    expect(at.length).toBeGreaterThan(40);
  });

  test("the light laps the head every 1.3 s, its trail three stretches long", () => {
    expect(outlinePhase(0)).toBe(0);
    expect(outlinePhase(OUTLINE_LAP_MS / 2)).toBe(0.5);
    expect(outlinePhase(OUTLINE_LAP_MS)).toBe(0);
    expect([...OUTLINE_TRAIL]).toEqual([...OUTLINE_TRAIL].sort((a, b) => a - b));
    expect(OUTLINE_TRAIL.at(-1)).toBeLessThan(0.5);
  });

  test("DougOutline is the same head, still, in the text color", () => {
    const { container } = render(<DougOutline size={12} />);
    const svg = container.querySelector("svg.ac-dougline") as SVGElement;
    expect(svg.getAttribute("width")).toBe("12");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelector("path")?.getAttribute("d")).toBe(DOUG_OUTLINE_PATH);
  });

  test("decorative by default; a label makes it an image; sizes are the box", () => {
    const { container } = render(<PixelSpinner size={24} />);
    const canvas = container.querySelector("canvas.ac-pixspin") as HTMLCanvasElement;
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(canvas.style.width).toBe("24px");
    expect(canvas.style.height).toBe("24px");
    render(<PixelSpinner size={32} label="Trabalhando" color="violet" />);
    const named = within(document.body).getByRole("img", { name: "Trabalhando" });
    expect(named.getAttribute("data-color")).toBe("violet");
  });

  test("Spinner (buttons, uploads) is the same outline, snapped to 14/16/24/32", () => {
    const { container } = render(
      <>
        <Spinner size={10} />
        <Spinner />
        <Spinner size={40} />
      </>,
    );
    const sizes = [...container.querySelectorAll("canvas")].map((c) => (c as HTMLElement).style.width);
    expect(sizes).toEqual(["14px", "16px", "32px"]);
  });

  test("a chip can lead with the agent's outline instead of its icon", () => {
    const { container } = render(
      <Chip icon="spinner" lead={<PixelSpinner size={14} color="amber" />}>
        Trabalhando
      </Chip>,
    );
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(container.querySelector("canvas")?.getAttribute("data-color")).toBe("amber");
    expect(container.querySelector("svg")).toBeNull();
  });
});
