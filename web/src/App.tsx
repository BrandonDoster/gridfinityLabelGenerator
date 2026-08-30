import { useCallback, useState } from "react";
import { LabelForm } from "./components/LabelForm";
import { LabelPreview } from "./components/LabelPreview";
import { SizeBatch } from "./components/SizeBatch";
import { downloadBatch, downloadBatchPng, downloadSingle, downloadSinglePng } from "./services/api";
import { saveBlob } from "./services/download";
import { DEFAULT_PROFILE_ID, getProfile, listProfiles } from "./services/profiles";
import {
  DEFAULT_PLACEMENT,
  DEFAULT_PLACEMENTS,
  isDefault,
  type Placement,
  type Placements,
} from "./services/placement";
import type { BaseStlProfileId, EmbossMode, ExportFormat, LabelInput } from "./types/label";

function slugifyTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "label";
}

function buildBatchZipFileName(typeToken: string, date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}-${hours}${minutes}${seconds}_${typeToken}_batchExport.zip`;
}

export function App() {
  const [error, setError] = useState("");
  const [previewLabel, setPreviewLabel] = useState<LabelInput | null>(null);
  const [baseProfileId, setBaseProfileId] = useState<BaseStlProfileId>(DEFAULT_PROFILE_ID);
  const [embossMode, setEmbossMode] = useState<EmbossMode>("raised");
  const [placement, setPlacement] = useState<Placements>(DEFAULT_PLACEMENTS);
  const profiles = listProfiles();
  const activeProfile = getProfile(baseProfileId);

  // Output type for filenames: "pred" / "cullenect" for 3MF, "png" for images —
  // so exporting the same label as different types doesn't collide on download.
  // Doubles as the file extension for PNG.
  const tokenFor = (format: ExportFormat) => (format === "png" ? "png" : baseProfileId);

  // A failed export is otherwise silent — the child only resets its spinner.
  const reportErrors = async (run: () => Promise<void>) => {
    setError("");
    try {
      await run();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  };

  const handleCustom = (input: LabelInput, format: ExportFormat) =>
    reportErrors(async () => {
      const tagged = { ...input, baseProfileId, embossMode, placement };
      const blob = format === "png" ? await downloadSinglePng(tagged) : await downloadSingle(tagged);
      saveBlob(blob, `${slugifyTitle(input.title)}-${tokenFor(format)}.${format}`);
    });

  const handleBatch = (selected: LabelInput[], format: ExportFormat) =>
    reportErrors(async () => {
      const tagged = selected.map((l) => ({ ...l, baseProfileId, embossMode, placement }));
      const result = format === "png" ? await downloadBatchPng(tagged) : await downloadBatch(tagged);
      if (result.isZip) {
        saveBlob(result.blob, buildBatchZipFileName(tokenFor(format)));
        return;
      }

      saveBlob(result.blob, `${slugifyTitle(selected[0].title)}-${tokenFor(format)}.${format}`);
    });

  // When the base STL changes, re-emit the current preview label so the
  // <LabelPreview> re-renders against the new profile layout. Also auto-reset
  // emboss mode to raised if the new profile doesn't support flush.
  const handleBaseChange = (id: BaseStlProfileId) => {
    setBaseProfileId(id);
    const newProfile = getProfile(id);
    const nextMode: EmbossMode =
      embossMode === "flush" && !newProfile.supportsFlush ? "raised" : embossMode;
    if (nextMode !== embossMode) setEmbossMode(nextMode);
    if (previewLabel) {
      setPreviewLabel({ ...previewLabel, baseProfileId: id, embossMode: nextMode });
    }
  };

  const handleEmbossModeChange = (mode: EmbossMode) => {
    setEmbossMode(mode);
    if (previewLabel) setPreviewLabel({ ...previewLabel, embossMode: mode });
  };

  // Same pattern as emboss mode: update the setting and patch the live preview
  // so the element moves as you type, without waiting for a child re-emit.
  const applyPlacement = (next: Placements) => {
    setPlacement(next);
    if (previewLabel) setPreviewLabel({ ...previewLabel, placement: next });
  };

  const handlePlacementChange = (part: keyof Placements, key: keyof Placement, raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    applyPlacement({ ...placement, [part]: { ...placement[part], [key]: value } });
  };

  // Wrap setPreviewLabel so child-emitted previews always carry the active
  // base profile id + emboss mode, even though the children don't know about them.
  // Memoized so its identity is stable across re-renders: the child preview
  // effects list onPreviewChange as a dependency, so an unstable identity would
  // make every emitted preview re-trigger the effect → infinite update loop.
  const handlePreviewChange = useCallback(
    (label: LabelInput) => {
      setPreviewLabel({ ...label, baseProfileId, embossMode, placement });
    },
    [baseProfileId, embossMode, placement],
  );

  // Base-STL choice, plus emboss mode where the profile offers it. PNG is not
  // here: it's a download button, since it's an output of the same design.
  // Rendered here (App owns the state) but placed by <LabelForm>.
  const outputControls = (
    <div className="header-controls">
      <div className="mode-toggle">
        {profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            className={baseProfileId === p.id ? "active" : ""}
            onClick={() => handleBaseChange(p.id)}
          >
            {p.displayName}
          </button>
        ))}
      </div>

      {activeProfile.supportsFlush && (
        <div className="mode-toggle">
          <button
            type="button"
            className={embossMode === "raised" ? "active" : ""}
            onClick={() => handleEmbossModeChange("raised")}
          >
            Raised
          </button>
          <button
            type="button"
            className={embossMode === "flush" ? "active" : ""}
            onClick={() => handleEmbossModeChange("flush")}
          >
            Flush
          </button>
        </div>
      )}
    </div>
  );

  // Nudge/scale for one element, rendered on that element's own row so it's
  // obvious what it moves. Same control for the icon and both text lines.
  const placementControls = (part: keyof Placements) => {
    const p = placement[part];
    return (
      <div className="placement">
        <span className="placement-label">mm</span>
        <label>
          X
          <input
            type="number"
            step={0.25}
            value={p.dx}
            onChange={(e) => handlePlacementChange(part, "dx", e.target.value)}
          />
        </label>
        <label>
          Y
          <input
            type="number"
            step={0.25}
            value={p.dy}
            onChange={(e) => handlePlacementChange(part, "dy", e.target.value)}
          />
        </label>
        <label>
          Size
          <input
            type="number"
            step={0.05}
            min={0.1}
            value={p.scale}
            onChange={(e) => handlePlacementChange(part, "scale", e.target.value)}
          />
        </label>
        <button
          type="button"
          title="Reset to the profile default"
          onClick={() => applyPlacement({ ...placement, [part]: DEFAULT_PLACEMENT })}
          disabled={isDefault(p)}
        >
          Reset
        </button>
      </div>
    );
  };

  return (
    <main className="app">
      <header>
        <h1>Gridfinity Label Generator</h1>
        <p className="tagline">
          Generate custom <strong>3MF</strong> and <strong>PNG</strong> labels for the{" "}
          <a href="https://www.printables.com/model/592545-gridfinity-bin-with-printable-label-by-pred-parame" target="_blank" rel="noopener noreferrer">
            Pred
          </a>{" "}
          and{" "}
          <a href="https://github.com/CullenJWebb/Cullenect-Labels" target="_blank" rel="noopener noreferrer">
            Cullenect
          </a>{" "}
          Gridfinity bins.
        </p>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <div className="layout">
        <LabelForm
          onGenerate={handleCustom}
          onPreviewChange={handlePreviewChange}
          outputControls={outputControls}
          line1Controls={placementControls("line1")}
          line2Controls={placementControls("line2")}
          iconControls={placementControls("icon")}
          preview={<LabelPreview label={previewLabel} />}
        />
        <SizeBatch template={previewLabel} onGenerate={handleBatch} />
      </div>

      <footer className="site-footer">
        <p>
          Print settings, base designs, and tips are in the{" "}
          <a href="https://github.com/BrandonDoster/gridfinityLabelGenerator#readme" target="_blank" rel="noopener noreferrer">README</a>
          . Found a bug or want a feature?{" "}
          <a href="https://github.com/BrandonDoster/gridfinityLabelGenerator/issues" target="_blank" rel="noopener noreferrer">Open an issue</a>.
        </p>
      </footer>
    </main>
  );
}
