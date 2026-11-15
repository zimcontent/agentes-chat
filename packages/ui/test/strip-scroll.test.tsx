import { afterEach, describe, expect, mock, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { cleanup, fireEvent, render } from "@testing-library/react";
import { Segmented } from "../src";

afterEach(cleanup);

const mouse = { pointerType: "mouse", pointerId: 1, button: 0 };

function setup(width = 800) {
  const onValueChange = mock((_v: string) => {});
  const view = render(
    <Segmented
      label="Agentes"
      value="a"
      onValueChange={onValueChange}
      options={[
        { value: "a", label: "Coding Agent" },
        { value: "b", label: "Coding Agent 02" },
        { value: "c", label: "DevOps Agent 02" },
      ]}
    />,
  );
  const track = view.getByRole("radiogroup");
  Object.defineProperty(track, "scrollWidth", { value: 2000 });
  Object.defineProperty(track, "clientWidth", { value: width });
  track.scrollLeft = 300;
  return { view, track, onValueChange };
}

describe("a row of choices too wide for its place", () => {
  test("the up-and-down wheel slides it sideways", () => {
    const { track } = setup();
    fireEvent.wheel(track, { deltaY: 100 });
    expect(track.scrollLeft).toBe(400);
    fireEvent.wheel(track, { deltaY: -50 });
    expect(track.scrollLeft).toBe(350);
  });

  test("at its end the wheel is left to the page", () => {
    const { track } = setup();
    track.scrollLeft = 0;
    const up = new WheelEvent("wheel", { deltaY: -100, cancelable: true, bubbles: true });
    track.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
  });

  test("a drag that starts on a choice slides it, and doesn't choose", () => {
    const { view, track, onValueChange } = setup();
    const option = view.getByRole("radio", { name: "Coding Agent 02" });
    fireEvent.pointerDown(option, { ...mouse, clientX: 500 });
    fireEvent.pointerMove(document, { ...mouse, clientX: 380 });
    expect(track.scrollLeft).toBe(420);
    fireEvent.pointerUp(document, { ...mouse, clientX: 380 });
    fireEvent.click(option);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  test("a click without a drag still chooses", () => {
    const { view, track, onValueChange } = setup();
    const option = view.getByRole("radio", { name: "DevOps Agent 02" });
    fireEvent.pointerDown(option, { ...mouse, clientX: 500 });
    fireEvent.pointerMove(document, { ...mouse, clientX: 501 });
    fireEvent.pointerUp(document, { ...mouse, clientX: 501 });
    fireEvent.click(option);
    expect(onValueChange).toHaveBeenCalledWith("c");
    expect(track.scrollLeft).toBe(300);
  });

  test("a row that fits is left alone", () => {
    const { track } = setup(2000);
    const down = new WheelEvent("wheel", { deltaY: 100, cancelable: true, bubbles: true });
    track.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    expect(track.scrollLeft).toBe(300);
  });
});
