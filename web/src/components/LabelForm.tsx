import { useEffect, useState } from "react";
import type { LabelInput } from "../types/label";
import { getIcon, iconsByKind } from "../assets/icons";

// Both pickers are derived from the icon manifest (web/src/assets/icons/).
// Adding an icon there makes it appear here automatically.
const CLIPARTS = iconsByKind("symbol");
const LINE2_IMAGES = iconsByKind("line2");

interface LabelFormProps {
  onGenerate: (input: LabelInput) => Promise<void>;
  onPreviewChange?: (label: LabelInput) => void;
  isActive?: boolean;
  onActivate?: () => void;
}

export function LabelForm({ onGenerate, onPreviewChange, isActive, onActivate }: LabelFormProps) {
  const [line1, setLine1] = useState("M3x10");
  const [line2, setLine2] = useState("Screw");
  const [line2Mode, setLine2Mode] = useState<"text" | "image">("text");
  const [selectedLine2Image, setSelectedLine2Image] = useState<string | null>(null);
  const [selectedClipart, setSelectedClipart] = useState<string | null>("torx");
  const [labelWidth, setLabelWidth] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);

  function buildLabel(): LabelInput {
    const clip = getIcon(selectedClipart ?? undefined);
    const iconSvg = clip?.svg ?? "";
    const iconViewBox = clip?.viewBox;
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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      await onGenerate(buildLabel());
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className={`panel${isActive ? " panel-active" : ""}`} onSubmit={handleSubmit} onFocus={handleFocusEnter} onPointerDown={() => onActivate?.()}>
      <h2>Create Your Own Label</h2>
      <label>
        Line 1
        <input value={line1} onChange={(e) => setLine1(e.target.value)} required />
      </label>
      <div className="line2-field">
        <div className="line2-label-row">
          <span>Line 2</span>
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
          </div>
        </div>
        {line2Mode === "text" ? (
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
      <div className="symbol-section">
        <span>Symbol</span>
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
      <button type="submit" disabled={loading}>
        {loading ? "Generating..." : "Download 3MF"}
      </button>
    </form>
  );
}
