import { describe, expect, it, vi } from "vitest";
import type { Ink } from "../src/services/layout";
import { getIcon } from "../src/assets/icons";
import { buildLabelFaceSvg } from "../src/services/pngExporter";

// Ink metrics come from a canvas, which node has no implementation of. Swap in
// a fixed synthetic font — the assertions below are about the exporter's
// layout, and a made-up-but-known font makes the expected numbers derivable.
const CHAR_W = 0.6;
const CAP = 0.72;
vi.mock("../src/services/textMetrics", () => ({
  LABEL_FONT: "TestSans",
  measureLabelInk: (text: string, fontSize: number): Ink => ({
    width: text.length * CHAR_W * fontSize,
    ascent: CAP * fontSize,
    descent: 0,
  }),
}));

// Fixed 36x11 mm tape face at 300 DPI — the PNG is the label content only, so
// these are the numbers a P-touch expects, not any base STL's.
const FACE = { w: 36, h: 11 };
const PX = 300 / 25.4;
const ICON_BOX = { x: 1.5, y: 1, w: 9.5, h: 9.5 };
const LINE1_BOX = { x: 11, y: 1, w: 23.5, h: 4.25 };
const LINE2_BOX = { x: 11, y: 6.25, w: 23.5, h: 4.25 };

const hex = getIcon("hex")!;
const shcs = getIcon("shcs")!;
const LABEL = {
  title: "M3x10",
  line1: "M3X10",
  line2: "SCREW",
  iconSvg: hex.svg,
  iconViewBox: hex.viewBox,
};

const parse = (svg: string) => new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
const num = (el: Element, attr: string) => Number(el.getAttribute(attr));

describe("PNG face SVG", () => {
  it("is a true-size 36x11 mm face at 300 DPI", () => {
    const { svg, pxW, pxH } = buildLabelFaceSvg(LABEL);
    expect(pxW).toBe(Math.round(FACE.w * PX)); // 425
    expect(pxH).toBe(Math.round(FACE.h * PX)); // 130
    const root = parse(svg);
    expect(root.tagName).toBe("svg");
    expect(num(root, "width")).toBe(pxW);
    expect(num(root, "height")).toBe(pxH);
    // The viewBox is in mm, so the pixel size is the only thing that changes
    // with DPI — geometry below stays in physical units.
    expect(root.getAttribute("viewBox")).toBe(`0 0 ${FACE.w} ${FACE.h}`);
  });

  it("places the icon image in the icon box, forced to black ink", () => {
    const root = parse(buildLabelFaceSvg(LABEL).svg);
    const icon = root.getElementsByTagName("svg")[0];
    expect([num(icon, "x"), num(icon, "y"), num(icon, "width"), num(icon, "height")]).toEqual([
      ICON_BOX.x,
      ICON_BOX.y,
      ICON_BOX.w,
      ICON_BOX.h,
    ]);
    expect(icon.getAttribute("viewBox")).toBe(hex.viewBox);
    expect(icon.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    const image = icon.getElementsByTagName("image")[0];
    expect(decodeURIComponent(image.getAttribute("href")!)).toContain(hex.svg.slice(0, 40));
    // Any source colour has to print as ink, not as its own hue.
    expect(image.getAttribute("filter")).toBe("url(#ink)");
    expect(root.getElementsByTagName("filter")[0].getAttribute("id")).toBe("ink");
  });

  it.each([
    ["line1", LINE1_BOX, "M3X10"],
    ["line2", LINE2_BOX, "SCREW"],
  ])("centres %s's ink in its box and fits it to the limiting axis", (_name, box, text) => {
    const root = parse(buildLabelFaceSvg(LABEL).svg);
    const el = Array.from(root.getElementsByTagName("text")).find((t) => t.textContent === text)!;
    expect(el).toBeDefined();
    expect(el.getAttribute("fill")).toBe("#000000");
    expect(el.getAttribute("text-anchor")).toBe("middle");
    expect(num(el, "x")).toBeCloseTo(box.x + box.w / 2, 6);

    const size = num(el, "font-size");
    const inkW = text.length * CHAR_W * size;
    const inkH = CAP * size;
    // Fits, and fills whichever axis runs out first.
    expect(inkW).toBeLessThanOrEqual(box.w + 1e-9);
    expect(inkH).toBeLessThanOrEqual(box.h + 1e-9);
    expect(Math.max(inkW / box.w, inkH / box.h)).toBeCloseTo(1, 9);
    // Equal margin above and below the ink (descent is 0 in this font).
    const above = num(el, "y") - inkH - box.y;
    const below = box.y + box.h - num(el, "y");
    expect(above).toBeCloseTo(below, 9);
  });

  it("renders a line-2 image instead of line-2 text when one is selected", () => {
    const root = parse(buildLabelFaceSvg({ ...LABEL, line2Svg: shcs.svg, line2ViewBox: shcs.viewBox }).svg);
    expect(Array.from(root.getElementsByTagName("text")).map((t) => t.textContent)).toEqual(["M3X10"]);
    const line2 = root.getElementsByTagName("svg")[1];
    expect([num(line2, "x"), num(line2, "y"), num(line2, "width"), num(line2, "height")]).toEqual([
      LINE2_BOX.x,
      LINE2_BOX.y,
      LINE2_BOX.w,
      LINE2_BOX.h,
    ]);
    expect(line2.getAttribute("viewBox")).toBe(shcs.viewBox);
  });

  it("omits the icon entirely when there is no symbol, and re-centres line 1", () => {
    const root = parse(buildLabelFaceSvg({ ...LABEL, iconSvg: "", line2: "" }).svg);
    expect(root.getElementsByTagName("image")).toHaveLength(0);
    const line1 = root.getElementsByTagName("text")[0];
    // No symbol and no line 2: line 1 owns the whole content area, so it
    // centres on the union of all three default boxes.
    const union = { x: ICON_BOX.x, y: LINE1_BOX.y, w: LINE2_BOX.x + LINE2_BOX.w - ICON_BOX.x, h: LINE2_BOX.y + LINE2_BOX.h - LINE1_BOX.y };
    expect(num(line1, "x")).toBeCloseTo(union.x + union.w / 2, 6);
    const size = num(line1, "font-size");
    expect(Math.max(("M3X10".length * CHAR_W * size) / union.w, (CAP * size) / union.h)).toBeCloseTo(1, 9);
  });

  it("escapes text that would otherwise break the SVG", () => {
    const { svg } = buildLabelFaceSvg({ ...LABEL, line1: `A&B<C>`, line2: "" });
    expect(svg).toContain("A&amp;B&lt;C&gt;");
    const root = parse(svg);
    expect(root.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(root.getElementsByTagName("text")[0].textContent).toBe("A&B<C>");
  });
});
