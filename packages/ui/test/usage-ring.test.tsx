import { afterEach, expect, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { cleanup, render } from "@testing-library/react";
import { planLevel, UsageRing } from "../src";

afterEach(() => cleanup());

const fill = (c: HTMLElement) => c.querySelector(".ac-usagering__fill");

test("the outline fills by the plan's use, and its level is the plan meter's", () => {
  const { container, rerender } = render(<UsageRing used={42} level={planLevel(42)} />);
  const ring = container.querySelector(".ac-usagering");
  expect(ring?.getAttribute("data-level")).toBe("ok");
  // For the eye only: the tile it sits in says the numbers.
  expect(ring?.getAttribute("aria-hidden")).toBe("true");
  expect(fill(container)?.getAttribute("stroke-dasharray")).toBe("42 100");
  rerender(<UsageRing used={85} level={planLevel(85)} />);
  expect(container.querySelector(".ac-usagering")?.getAttribute("data-level")).toBe("almost");
  rerender(<UsageRing used={93} level={planLevel(93)} />);
  expect(container.querySelector(".ac-usagering")?.getAttribute("data-level")).toBe("critical");
  rerender(<UsageRing used={100} level={planLevel(100)} />);
  expect(container.querySelector(".ac-usagering")?.getAttribute("data-level")).toBe("limited");
});

test("nothing used draws only the track, a sliver stays visible, and it never passes the whole edge", () => {
  const { container, rerender } = render(<UsageRing used={0} level="ok" />);
  expect(fill(container)).toBeNull();
  expect(container.querySelector(".ac-usagering__track")).not.toBeNull();
  rerender(<UsageRing used={1} level="ok" />);
  expect(fill(container)?.getAttribute("stroke-dasharray")).toBe("4 100");
  rerender(<UsageRing used={140} level="limited" />);
  expect(fill(container)?.getAttribute("stroke-dasharray")).toBe("100 100");
});
