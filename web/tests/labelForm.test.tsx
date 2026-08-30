// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LabelInput } from "../src/types/label";
import { LabelForm } from "../src/components/LabelForm";

// Regression: Line 2 in Image mode with nothing selected fell through to the
// text branch and printed the hidden line-2 text field's value on the label.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => act(() => root?.unmount()));

const click = (el: Element | null | undefined) => {
  if (!el) throw new Error("nothing to click");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

it("emits an empty line 2 in image mode with no image selected", () => {
  const emitted: LabelInput[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root!.render(<LabelForm onGenerate={async () => {}} onPreviewChange={(l) => emitted.push(l)} />);
  });
  const last = () => emitted[emitted.length - 1];
  const button = (text: string) =>
    Array.from(container.querySelectorAll("button")).find((b) => b.textContent === text);

  // Mounts in Image mode with a screw profile pre-selected.
  expect(last().line2).toBe("");
  expect(last().line2Svg).toBeTruthy();

  // The hidden text field is not empty — this is the value the bug leaked.
  click(button("Text"));
  expect(last().line2).toBe("Screw");

  // Back to Image, then click the selected tile to deselect it.
  click(button("Image"));
  const selected = container.querySelector('.symbol-picker-compact button[aria-pressed="true"]');
  click(selected);
  expect(container.querySelector('.symbol-picker-compact button[aria-pressed="true"]')).toBeNull();

  // Image mode with nothing selected: no image, and no leaked text.
  expect(last().line2Svg).toBeUndefined();
  expect(last().line2).toBe("");
});
