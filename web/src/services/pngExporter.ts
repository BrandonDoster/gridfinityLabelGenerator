import type { LabelInput } from "../types/label";
import { getPreviewLayout, getProfile, type PreviewBox } from "./profiles";

// Rasterizes the 2D label face to a print-ready PNG: black "ink" content on a
// transparent background, at the label's true physical size. Intended for label
// printers (e.g. Brother P-touch 12 mm tape) — see issue #3. The body outline is
// omitted; only the icon + text print, so the tape itself is the background.

const DPI = 300;
const PX_PER_MM = DPI / 25.4; // ≈ 11.81 px/mm
const INK = "#000000";
const FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
const ICON_GAP = 0.4; // mm between the two halves of an icon-text label (e.g. TX10)
const SCREW_SVG_VIEWBOX = "32.4 18.7 80.2 16"; // fallback crop for a line-2 SVG without its own
const A4_W = 793.70079; // source-SVG canvas the icon assets are drawn on
const A4_H = 1122.5197;

// Forces any embedded SVG image to solid black, preserving its alpha — so an
// icon of any source colour prints as clean black ink.
const TO_BLACK = '<filter id="ink"><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/></filter>';

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Largest font size (mm) that keeps `text` within the box. Mirrors the
// preview's heuristic so the PNG matches what the user sees.
function fittingFontSize(text: string, maxW: number, maxH: number): number {
  const len = text.length || 1;
  return Math.min((maxW * 1.7) / len, maxH);
}

function textEl(text: string, box: PreviewBox, fontSize: number): string {
  return (
    `<text x="${box.x + box.w / 2}" y="${box.y + box.h / 2}" text-anchor="middle" ` +
    `dominant-baseline="central" font-size="${fontSize}" fill="${INK}" font-weight="bold" ` +
    `font-family="${FONT}">${esc(text)}</text>`
  );
}

function imageEl(svg: string, viewBox: string, box: PreviewBox): string {
  const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return (
    `<svg x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" viewBox="${viewBox}" ` +
    `preserveAspectRatio="xMidYMid meet">` +
    `<image href="${href}" x="0" y="0" width="${A4_W}" height="${A4_H}" filter="url(#ink)"/></svg>`
  );
}

function iconEls(label: LabelInput, box: PreviewBox): string {
  if (label.iconText) {
    // Split e.g. "TX10" → ["TX", "10"] so each half fills its own row.
    const m = label.iconText.match(/^([A-Za-z]+)(\d+.*)$/);
    const parts = m ? [m[1], m[2]] : [label.iconText];
    const partH = (box.h - (parts.length > 1 ? ICON_GAP : 0)) / parts.length;
    return parts
      .map((part, i) => {
        const partBox: PreviewBox = { x: box.x, y: box.y + i * (partH + ICON_GAP), w: box.w, h: partH };
        const fs = Math.min((box.w * 1.7) / (part.length || 1), partH);
        return textEl(part, partBox, fs);
      })
      .join("");
  }
  if (label.iconSvg) {
    return imageEl(label.iconSvg, label.iconViewBox ?? `0 0 ${A4_W} ${A4_H}`, box);
  }
  return "";
}

/** Build the standalone, print-ready SVG for a label face, plus its pixel size. */
export function buildLabelFaceSvg(label: LabelInput): { svg: string; pxW: number; pxH: number } {
  const layout = getPreviewLayout(getProfile(label.baseProfileId));
  const { width, height } = layout;
  const pxW = Math.round(width * PX_PER_MM);
  const pxH = Math.round(height * PX_PER_MM);

  const body: string[] = [];
  body.push(iconEls(label, layout.iconBox));
  if (label.line1) body.push(textEl(label.line1, layout.line1Box, fittingFontSize(label.line1, layout.line1Box.w, layout.line1Box.h)));
  if (label.line2Svg) body.push(imageEl(label.line2Svg, label.line2ViewBox ?? SCREW_SVG_VIEWBOX, layout.line2Box));
  else if (label.line2) body.push(textEl(label.line2, layout.line2Box, fittingFontSize(label.line2, layout.line2Box.w, layout.line2Box.h)));

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" viewBox="0 0 ${width} ${height}">` +
    `<defs>${TO_BLACK}</defs>${body.join("")}</svg>`;
  return { svg, pxW, pxH };
}

function rasterize(svg: string, pxW: number, pxH: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = pxW;
      canvas.height = pxH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("2D canvas context unavailable"));
      ctx.drawImage(img, 0, 0, pxW, pxH); // transparent background (no fill)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))), "image/png");
    };
    img.onerror = () => reject(new Error("Failed to rasterize label SVG"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** Render a label to a print-ready PNG blob (black ink, transparent, true size). */
export async function buildLabelPng(label: LabelInput): Promise<Blob> {
  const { svg, pxW, pxH } = buildLabelFaceSvg(label);
  return rasterize(svg, pxW, pxH);
}
