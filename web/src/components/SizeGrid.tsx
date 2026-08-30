import { useState } from "react";
import type { ExportFormat, LabelInput } from "../types/label";

// Common metric fastener stock: 4–20 mm in 2 mm steps, then 25–50 in 5 mm steps.
const LENGTHS = [4, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45, 50];
const DIAMETERS = ["M2", "M2.5", "M3", "M4", "M5", "M6"];

// The key doubles as the label's line 1 — "M3x10".
const key = (d: string, l: number) => `${d}x${l}`;
const ALL_KEYS = DIAMETERS.flatMap((d) => LENGTHS.map((l) => key(d, l)));

interface SizeGridProps {
  /** Current design label: supplies icon, line 2, width — everything but line 1. */
  template: LabelInput | null;
  onGenerate: (labels: LabelInput[], format: ExportFormat) => Promise<void>;
}

export function SizeGrid({ template, onGenerate }: SizeGridProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Which download is running, so only that button shows its spinner.
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  // One toggle for cells, rows, columns and the corner: if every key in the
  // group is already on, clear it; otherwise fill it.
  const toggle = (keys: string[]) => {
    setSelected((cur) => {
      const next = new Set(cur);
      const allOn = keys.every((k) => cur.has(k));
      for (const k of keys) allOn ? next.delete(k) : next.add(k);
      return next;
    });
  };

  const download = async (format: ExportFormat) => {
    if (!template || selected.size === 0) return;
    setBusy(format);
    try {
      // Iterate ALL_KEYS, not the Set, so the zip is ordered by diameter then length.
      const labels = ALL_KEYS.filter((k) => selected.has(k)).map((k) => ({
        ...template,
        title: [k, template.line2].filter(Boolean).join(" "),
        line1: k,
      }));
      await onGenerate(labels, format);
    } finally {
      setBusy(null);
    }
  };

  const canDownload = busy === null && template !== null && selected.size > 0;
  const count = selected.size > 0 ? ` (${selected.size})` : "";

  return (
    <section className="panel">
      <h2>Fastener Sizes</h2>
      <p className="panel-subtitle">
        Exports one label per checked size, using the design above for the icon, line 2 and width.
        Click a row or column heading to toggle it.
      </p>
      <div className="size-grid-scroll">
        <table className="size-grid">
          <thead>
            <tr>
              <th>
                <button type="button" onClick={() => toggle(ALL_KEYS)}>All</button>
              </th>
              {LENGTHS.map((l) => (
                <th key={l}>
                  <button type="button" onClick={() => toggle(DIAMETERS.map((d) => key(d, l)))}>
                    {l}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DIAMETERS.map((d) => (
              <tr key={d}>
                <th>
                  <button type="button" onClick={() => toggle(LENGTHS.map((l) => key(d, l)))}>
                    {d}
                  </button>
                </th>
                {LENGTHS.map((l) => (
                  <td key={l}>
                    <input
                      type="checkbox"
                      aria-label={key(d, l)}
                      checked={selected.has(key(d, l))}
                      onChange={() => toggle([key(d, l)])}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="download-row">
        <button type="button" disabled={!canDownload} onClick={() => download("3mf")}>
          {busy === "3mf" ? "Generating..." : `Download 3MFs${count}`}
        </button>
        <button type="button" disabled={!canDownload} onClick={() => download("png")}>
          {busy === "png" ? "Generating..." : `Download PNGs${count}`}
        </button>
      </div>
    </section>
  );
}
