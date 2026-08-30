import { useState } from "react";
import type { ExportFormat, LabelInput } from "../types/label";

// Common metric fastener stock: 4–20 mm in 2 mm steps, then 25–50 in 5 mm steps.
const LENGTHS = [4, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45, 50];
const DIAMETERS = ["M2", "M2.5", "M3", "M4", "M5", "M6"];

interface SizeBatchProps {
  /** Current design label: supplies icon, line 2, width — everything but line 1. */
  template: LabelInput | null;
  onGenerate: (labels: LabelInput[], format: ExportFormat) => Promise<void>;
}

export function SizeBatch({ template, onGenerate }: SizeBatchProps) {
  // Which button is running, keyed "<format>:<diameter>", so only it shows a spinner.
  const [busy, setBusy] = useState<string | null>(null);

  const download = async (diameter: string, format: ExportFormat) => {
    if (!template) return;
    setBusy(`${format}:${diameter}`);
    try {
      const labels = LENGTHS.map((length) => {
        const line1 = `${diameter}x${length}`;
        return { ...template, title: [line1, template.line2].filter(Boolean).join(" "), line1 };
      });
      await onGenerate(labels, format);
    } finally {
      setBusy(null);
    }
  };

  const row = (format: ExportFormat, label: string) => (
    <div className="batch-row">
      <span className="batch-label">{label}</span>
      {DIAMETERS.map((d) => (
        <button
          key={d}
          type="button"
          disabled={!template || busy !== null}
          onClick={() => download(d, format)}
        >
          {busy === `${format}:${d}` ? `${d}…` : d}
        </button>
      ))}
    </div>
  );

  return (
    <section className="panel">
      <h2>Fastener Sizes</h2>
      <p className="panel-subtitle">
        One click per diameter: exports all {LENGTHS.length} lengths ({LENGTHS[0]}–
        {LENGTHS[LENGTHS.length - 1]} mm) as a single zip, using the design above.
      </p>
      {row("3mf", "Download 3MFs")}
      {row("png", "Download PNGs")}
    </section>
  );
}
