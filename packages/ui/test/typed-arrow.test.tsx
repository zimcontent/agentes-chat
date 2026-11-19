import { afterEach, expect, test } from "bun:test";
import { setupDom } from "../testing/dom";

setupDom();

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Composer } from "../src/components/Composer";
import { typedArrow } from "../src/typed-arrow";

afterEach(() => cleanup());

// Doug: "->" in the composer becomes "→".
test("a > typed after a - becomes an arrow, the caret after it", () => {
  expect(typedArrow("a -", "a ->", 4)).toEqual({ value: "a →", start: 3, end: 3 });
  expect(typedArrow("x - y", "x -> y", 4)).toEqual({ value: "x → y", start: 3, end: 3 });
});

test("no arrow for a paste, for --> or <->, or for a > on its own", () => {
  expect(typedArrow("", "a ->", 4)).toBeNull();
  expect(typedArrow("a --", "a -->", 5)).toBeNull();
  expect(typedArrow("a <-", "a <->", 5)).toBeNull();
  expect(typedArrow("a ", "a >", 3)).toBeNull();
});

test("code keeps its -> as typed", () => {
  expect(typedArrow("`a -", "`a ->", 5)).toBeNull();
  expect(typedArrow("```\nf = x -", "```\nf = x ->", 12)).toBeNull();
  // A closed span before it does not count.
  expect(typedArrow("`a` b -", "`a` b ->", 8)).toEqual({ value: "`a` b →", start: 7, end: 7 });
});

function Box() {
  const [value, setValue] = useState("");
  return <Composer value={value} onChange={setValue} onSend={() => {}} label="Mensagem" sendLabel="Enviar" />;
}

test("the composer turns -> into →", () => {
  render(<Box />);
  const box = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: "a -", selectionStart: 3, selectionEnd: 3 } });
  box.setSelectionRange(4, 4);
  fireEvent.change(box, { target: { value: "a ->", selectionStart: 4, selectionEnd: 4 } });
  expect(box.value).toBe("a →");
});
