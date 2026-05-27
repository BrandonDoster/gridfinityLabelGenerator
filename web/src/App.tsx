import { useCallback, useEffect, useState } from "react";
import { LabelForm } from "./components/LabelForm";
import { LabelPreview } from "./components/LabelPreview";
import { PredefinedSelector } from "./components/PredefinedSelector";
import { downloadBatch, downloadBatchPng, downloadSingle, downloadSinglePng, fetchPredefined } from "./services/api";
import { saveBlob } from "./services/download";
import { getProfile, listProfiles } from "./services/profiles";
import type { BaseStlProfileId, EmbossMode, LabelInput, PredefinedLabel } from "./types/label";

function slugifyTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "label";
}

function buildBatchZipFileName(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}-${hours}${minutes}${seconds}_batchExport.zip`;
}

export function App() {
  const [labels, setLabels] = useState<PredefinedLabel[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [previewLabel, setPreviewLabel] = useState<LabelInput | null>(null);
  const [activePanel, setActivePanel] = useState<"custom" | "predefined">("custom");
  const [baseProfileId, setBaseProfileId] = useState<BaseStlProfileId>("pred");
  const [embossMode, setEmbossMode] = useState<EmbossMode>("raised");
  const [exportFormat, setExportFormat] = useState<"3mf" | "png">("3mf");
  const profiles = listProfiles();
  const activeProfile = getProfile(baseProfileId);

  useEffect(() => {
    const run = async () => {
      try {
        setLabels(await fetchPredefined());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load predefined labels");
      } finally {
        setLoading(false);
      }
    };

    run();
  }, []);

  const handleCustom = async (input: LabelInput) => {
    setError("");
    const tagged = { ...input, baseProfileId, embossMode };
    if (exportFormat === "png") {
      saveBlob(await downloadSinglePng(tagged), `${slugifyTitle(input.title)}.png`);
    } else {
      saveBlob(await downloadSingle(tagged), `${slugifyTitle(input.title)}.3mf`);
    }
  };

  const handleBatch = async (selected: PredefinedLabel[]) => {
    setError("");
    const tagged = selected.map((l) => ({ ...l, baseProfileId, embossMode }));
    const result = exportFormat === "png" ? await downloadBatchPng(tagged) : await downloadBatch(tagged);
    if (result.isZip) {
      saveBlob(result.blob, buildBatchZipFileName());
      return;
    }

    const single = selected[0];
    saveBlob(result.blob, `${slugifyTitle(single.title)}.${exportFormat === "png" ? "png" : "3mf"}`);
  };

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

  // Wrap setPreviewLabel so child-emitted previews always carry the active
  // base profile id + emboss mode, even though the children don't know about them.
  // Memoized so its identity is stable across re-renders: the child preview
  // effects list onPreviewChange as a dependency, so an unstable identity would
  // make every emitted preview re-trigger the effect → infinite update loop.
  const handlePreviewChange = useCallback(
    (label: LabelInput) => {
      setPreviewLabel({ ...label, baseProfileId, embossMode });
    },
    [baseProfileId, embossMode],
  );

  return (
    <main className="app">
      <header>
        <h1>Gridfinity Label Generator</h1>
      </header>

      <div className="info-box">
        <p>
          Labels are designed for{" "}
          <a href="https://www.printables.com/model/592545-gridfinity-bin-with-printable-label-by-pred-parame" target="_blank" rel="noopener noreferrer">
            the Gridfinity Bin with Printable Label by Pred
          </a>
          . Print at <strong>0.2 mm layer height</strong> with a{" "}
          <strong>color change in layer 3</strong> for best contrast.{" "}
          The <strong>Arachne wall generator</strong> is recommended for sharper detail.
        </p>
        <p>
          Includes pre-defined labels for all <strong>CNC Kitchen fasteners &amp; inserts</strong>.
        </p>
        <p className="info-beta">
          ⚠️ This is a <strong>beta</strong> — found a bug or want a new feature?{" "}
          Open an issue on{" "}
          <a href="https://github.com/BrandonDoster/gridfinityLabelGenerator/issues" target="_blank" rel="noopener noreferrer">GitHub</a>{" "}.
        </p>
      </div>

      {loading ? <p>Loading predefined labels...</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <section className="panel preview-panel">
        <LabelPreview label={previewLabel} />
      </section>

      <div className="settings-bar">
        <div className="settings-group">
          <span className="settings-label">Base STL</span>
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
        </div>

        <div className="settings-group">
          <span className="settings-label">Export</span>
          <div className="mode-toggle">
            <button
              type="button"
              className={exportFormat === "3mf" ? "active" : ""}
              onClick={() => setExportFormat("3mf")}
            >
              3MF
            </button>
            <button
              type="button"
              className={exportFormat === "png" ? "active" : ""}
              onClick={() => setExportFormat("png")}
            >
              PNG
            </button>
          </div>
        </div>

        {activeProfile.supportsFlush && (
          <div className="settings-group">
            <span className="settings-label">Emboss Mode</span>
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
          </div>
        )}
      </div>

      <div className="layout">
        <LabelForm onGenerate={handleCustom} onPreviewChange={handlePreviewChange} isActive={activePanel === "custom"} onActivate={() => setActivePanel("custom")} exportFormat={exportFormat} />
        <PredefinedSelector labels={labels} onGenerate={handleBatch} onPreviewChange={handlePreviewChange} isActive={activePanel === "predefined"} onActivate={() => setActivePanel("predefined")} exportFormat={exportFormat} />
      </div>
    </main>
  );
}
