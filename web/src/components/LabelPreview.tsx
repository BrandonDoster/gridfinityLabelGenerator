import type { LabelInput } from "../types/label";
import { getPreviewLayout, getProfile } from "../services/profiles";
import { DEFAULT_PLACEMENTS, adjustBox } from "../services/placement";
import { centerBox, hasLine2 } from "../services/layout";

// Fallback viewBox for a line-2 SVG that arrives without its own crop. The
// screw SVG (screw_lowHead.svg) has an A4-sized viewBox (793×1122); the actual
// screw path occupies approx x:34.72..110.31, y:19.17..34.29 (≈5:1 AR). This
// crops to that area, matching the line-2 box aspect ratio.
const SCREW_SVG_VIEWBOX = "32.4 18.7 80.2 16";

const FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";

function fittingFontSize(text: string, maxW: number, maxH: number): number {
  const len = text.length || 1;
  return Math.min((maxW * 1.7) / len, maxH);
}

interface LabelPreviewProps {
  label: LabelInput | null;
}

export function LabelPreview({ label }: LabelPreviewProps) {
  // Per-profile preview layout (boxes + outline) comes straight from the
  // profile registry — same source the 3D generator reads.
  const layout = getPreviewLayout(getProfile(label?.baseProfileId));
  // Every box carries its own placement nudge.
  const placement = label?.placement ?? DEFAULT_PLACEMENTS;
  const ICON_BOX = adjustBox(layout.iconBox, placement.icon);
  const LINE2_BOX = adjustBox(layout.line2Box, placement.line2);
  // Line 2 off → line 1 sits midway between the two slots (services/layout.ts).
  // Centred against the profile's default line-2 slot, not the nudged one.
  const line1Base =
    label && !hasLine2(label) ? centerBox(layout.line1Box, layout.line2Box) : layout.line1Box;
  const LINE1_BOX = adjustBox(line1Base, placement.line1);
  const VB = `${-layout.vbMargin} ${-layout.vbMargin} ${layout.width + layout.vbMargin * 2} ${layout.height + layout.vbMargin * 2}`;

  function renderLabelShape() {
    return layout.renderOutline();
  }

  function renderIcon() {
    if (!label) return null;

    if (label.iconSvg) {
      const encoded = encodeURIComponent(label.iconSvg);
      if (label.iconViewBox) {
        return (
          <svg
            x={ICON_BOX.x}
            y={ICON_BOX.y}
            width={ICON_BOX.w}
            height={ICON_BOX.h}
            viewBox={label.iconViewBox}
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <filter id="icon-to-white">
                <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0" />
              </filter>
            </defs>
            <image
              href={`data:image/svg+xml;charset=utf-8,${encoded}`}
              x="0"
              y="0"
              width="793.70079"
              height="1122.5197"
              filter="url(#icon-to-white)"
            />
          </svg>
        );
      }
      return (
        <image
          href={`data:image/svg+xml;charset=utf-8,${encoded}`}
          x={ICON_BOX.x}
          y={ICON_BOX.y}
          width={ICON_BOX.w}
          height={ICON_BOX.h}
          preserveAspectRatio="xMidYMid meet"
          filter="url(#lp-to-white)"
        />
      );
    }

    return null;
  }

  function renderLine1() {
    if (!label?.line1) return null;
    const fs = fittingFontSize(label.line1, LINE1_BOX.w, LINE1_BOX.h);
    return (
      <text
        x={LINE1_BOX.x + LINE1_BOX.w / 2}
        y={LINE1_BOX.y + LINE1_BOX.h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fs}
        fill="#e2e8f0"
        fontWeight="bold"
        fontFamily={FONT}
      >
        {label.line1}
      </text>
    );
  }

  function renderLine2() {
    if (!label) return null;

    if (label.line2Svg) {
      // Nested <svg> with a viewBox cropped to the content area.
      // label.line2ViewBox overrides the default SCREW_SVG_VIEWBOX for TRP images.
      const vb = label.line2ViewBox ?? SCREW_SVG_VIEWBOX;
      const encoded = encodeURIComponent(label.line2Svg);
      return (
        <svg
          x={LINE2_BOX.x}
          y={LINE2_BOX.y}
          width={LINE2_BOX.w}
          height={LINE2_BOX.h}
          viewBox={vb}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <filter id="line2-to-white">
              <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0" />
            </filter>
          </defs>
          <image
            href={`data:image/svg+xml;charset=utf-8,${encoded}`}
            x="0"
            y="0"
            width="793.70079"
            height="1122.5197"
            filter="url(#line2-to-white)"
          />
        </svg>
      );
    }

    if (!label.line2) return null;
    const fs = fittingFontSize(label.line2, LINE2_BOX.w, LINE2_BOX.h);
    return (
      <text
        x={LINE2_BOX.x + LINE2_BOX.w / 2}
        y={LINE2_BOX.y + LINE2_BOX.h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fs}
        fill="#e2e8f0"
        fontWeight="bold"
        fontFamily={FONT}
      >
        {label.line2}
      </text>
    );
  }

  return (
    <svg
      className="preview-svg"
      viewBox={VB}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Safari-compatible white filter for SVG <image> elements */}
        <filter id="lp-to-white">
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0" />
        </filter>
      </defs>
      {renderLabelShape()}
      {renderIcon()}
      {renderLine1()}
      {renderLine2()}
    </svg>
  );
}
