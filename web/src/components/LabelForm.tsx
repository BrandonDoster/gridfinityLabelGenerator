import { useEffect, useState, type ReactNode } from "react";
import type { ExportFormat, LabelInput } from "../types/label";
import { getIcon, iconsByKind } from "../assets/icons";

// Both pickers are derived from the icon manifest (web/src/assets/icons/).
// Adding an icon there makes it appear here automatically.
const CLIPARTS = iconsByKind("symbol");
const LINE2_IMAGES = iconsByKind("line2");

interface LabelFormProps {
  onGenerate: (input: LabelInput, format: ExportFormat) => Promise<void>;
  onPreviewChange?: (label: LabelInput) => void;
  // Slots, not props: App owns the export settings and the preview label, and
  // just hands the rendered controls here so each one sits next to the thing it
  // changes. Keeps this component a layout — no setter drilling.
  outputControls?: ReactNode; // next to the heading
  line1Controls?: ReactNode;  // on the Line 1 row
  line2Controls?: ReactNode;  // on the Line 2 row
  iconControls?: ReactNode;   // on the Symbol row
  preview?: ReactNode;        // right of Line 1
}

export function LabelForm({
  onGenerate,
  onPreviewChange,
  outputControls,
  line1Controls,
  line2Controls,
  iconControls,
  preview,
}: LabelFormProps) {
  const [line1, setLine1] = useState("M3x10");
  const [line2, setLine2] = useState("Screw");
  const [line2Mode, setLine2Mode] = useState<"text" | "image" | "off">("text");
  const [selectedLine2Image, setSelectedLine2Image] = useState<string | null>(null);
  const [selectedClipart, setSelectedClipart] = useState<string | null>("torx");
  const [labelWidth, setLabelWidth] = useState<1 | 2 | 3>(1);
  // Which download is running, so only that button shows its spinner.
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  function buildLabel(): LabelInput {
    const clip = getIcon(selectedClipart ?? undefined);
    const iconSvg = clip?.svg ?? "";
    const iconViewBox = clip?.viewBox;
    // "off" emits an empty line 2, which every renderer reads as "single line"
    // and re-centres line 1 for (services/layout.ts).
    if (line2Mode === "off") {
      return { title: line1, line1, line2: "", iconSvg, iconViewBox, labelWidth };
    }
    if (line2Mode === "image" && selectedLine2Image) {
      const img = getIcon(selectedLine2Image);
      const title = [line1].filter(Boolean).join(" ");
      return { title, line1, line2: "", iconSvg, iconViewBox, line2Svg: img?.svg, line2ViewBox: img?.viewBox, labelWidth };
    }
    const title = [line1, line2].filter(Boolean).join(" ");
    return { title, line1, line2, iconSvg, iconViewBox, labelWidth };
  }

  // Emit preview on every change, and once on mount
  useEffect(() => {
    if (!onPreviewChange) return;
    onPreviewChange(buildLabel());
  }, [line1, line2, line2Mode, selectedLine2Image, selectedClipart, labelWidth, onPreviewChange]);

  const handleFocusEnter = (e: React.FocusEvent<HTMLFormElement>) => {
    if (onPreviewChange && !e.currentTarget.contains(e.relatedTarget as Node)) {
      onPreviewChange(buildLabel());
    }
  };

  const download = async (format: ExportFormat) => {
    setBusy(format);
    try {
      await onGenerate(buildLabel(), format);
    } finally {
      setBusy(null);
    }
  };

  // Line 1 is the one required field — no submit event to validate on now that
  // each format is its own button, so gate the buttons instead.
  const canDownload = busy === null && line1.trim() !== "";

  return (
    <form className="panel" onSubmit={(e) => e.preventDefault()} onFocus={handleFocusEnter}>
      <div className="panel-header">
        <h2>Design</h2>
        {outputControls}
      </div>
      <div className="line1-row">
        <div className="field">
          <div className="field-label-row">
            <span>Line 1</span>
            {line1Controls}
          </div>
          <input value={line1} onChange={(e) => setLine1(e.target.value)} />
        </div>
        {preview}
      </div>
      <div className="field">
        <div className="field-label-row">
          <span>Line 2</span>
          {line2Controls}
          <div className="mode-toggle">
            <button
              type="button"
              className={line2Mode === "text" ? "active" : ""}
              onClick={() => setLine2Mode("text")}
            >
              Text
            </button>
            <button
              type="button"
              className={line2Mode === "image" ? "active" : ""}
              onClick={() => setLine2Mode("image")}
            >
              Image
            </button>
            <button
              type="button"
              className={line2Mode === "off" ? "active" : ""}
              onClick={() => setLine2Mode("off")}
            >
              Off
            </button>
          </div>
        </div>
        {line2Mode === "off" ? null : line2Mode === "text" ? (
          <input value={line2} onChange={(e) => setLine2(e.target.value)} />
        ) : (
          <div className="symbol-picker">
            {LINE2_IMAGES.map((img) => (
              <button
                key={img.id}
                type="button"
                className={`symbol-item${selectedLine2Image === img.id ? " selected" : ""}`}
                onClick={() =>
                  setSelectedLine2Image((prev) => (prev === img.id ? null : img.id))
                }
                title={img.label}
              >
                <svg
                  viewBox={img.viewBox}
                  width="40"
                  height="40"
                  preserveAspectRatio="xMidYMid meet"
                  style={{ filter: "invert(1)" }}
                >
                  <image
                    href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(img.svg)}`}
                    x="0"
                    y="0"
                    width="793.70079"
                    height="1122.5197"
                  />
                </svg>
                <span>{img.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="field">
        <div className="field-label-row">
          <span>Symbol</span>
          {iconControls}
        </div>
        <div className="symbol-picker">
          {CLIPARTS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`symbol-item${selectedClipart === c.id ? " selected" : ""}`}
              onClick={() => setSelectedClipart((prev) => (prev === c.id ? null : c.id))}
              title={c.label}
            >
              <svg
                viewBox={c.viewBox}
                width="40"
                height="40"
                preserveAspectRatio="xMidYMid meet"
                style={{ filter: "invert(1)" }}
              >
                <image
                  href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.svg)}`}
                  x="0"
                  y="0"
                  width="793.70079"
                  height="1122.5197"
                />
              </svg>
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="width-selector">
        <span>Label Width</span>
        <div className="mode-toggle">
          {([1, 2, 3] as const).map((w) => (
            <button
              key={w}
              type="button"
              className={labelWidth === w ? "active" : ""}
              onClick={() => setLabelWidth(w)}
              title={`${w}×  (${(37.8 + (w - 1) * 42).toFixed(1)} mm)`}
            >
              {w}×
            </button>
          ))}
        </div>
      </div>
      <div className="download-row">
        <button type="button" disabled={!canDownload} onClick={() => download("3mf")}>
          {busy === "3mf" ? "Generating..." : "Download 3MF"}
        </button>
        <button type="button" disabled={!canDownload} onClick={() => download("png")}>
          {busy === "png" ? "Generating..." : "Download PNG"}
        </button>
      </div>
    </form>
  );
}
