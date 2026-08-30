// Single source of truth for every clipart symbol and screw-profile (line-2)
// image. To add an icon: drop its SVG into this folder and add one row to DEFS
// below — no import statements, no other files to touch. The raw SVG markup is
// auto-loaded from this directory at build time via import.meta.glob.

type IconKind = "symbol" | "line2";

interface IconDef {
  /** Stable id, unique across all kinds. Referenced by the UI pickers and by PredefinedLabel.icon. */
  id: string;
  /** Label shown under the picker thumbnail. */
  label: string;
  /** SVG file name within this folder. */
  file: string;
  /**
   * viewBox crop applied to the (usually A4-canvas, 793.7×1122.5) source SVG so
   * thumbnails and the 2D preview show only the drawing region. The 3D extruder
   * ignores this and measures the parsed paths directly.
   */
  viewBox: string;
  /** "symbol" → left-side clipart picker; "line2" → bottom screw-profile picker. */
  kind: IconKind;
}

/** A resolved icon: its definition plus the raw SVG markup. */
export interface Icon extends IconDef {
  svg: string;
}

// Auto-load every SVG in this folder as a raw string, keyed by "./name.svg".
const RAW = import.meta.glob("./*.svg", {
  query: "?raw",
  eager: true,
  import: "default",
}) as Record<string, string>;

function rawFor(file: string): string {
  const svg = RAW[`./${file}`];
  if (svg === undefined) {
    throw new Error(`icons/index.ts: no SVG named "${file}" in web/src/assets/icons/`);
  }
  return svg;
}

// ── The registry. One row per icon; this array is the only thing to edit. ──
const DEFS: IconDef[] = [
  // Clipart symbols (left side of the label)
  { id: "hex",          label: "Hex",          file: "hex.svg",          viewBox: "299 276 111 111", kind: "symbol" },
  { id: "torx",         label: "Torx",         file: "torx.svg",         viewBox: "541 127 112 112", kind: "symbol" },
  { id: "phillips",     label: "Phillips",     file: "phillips.svg",     viewBox: "81 51 112 112",   kind: "symbol" },
  { id: "slot",         label: "Slot",         file: "slot.svg",         viewBox: "35 125 125 113",  kind: "symbol" },
  { id: "robertson",    label: "Robertson",    file: "robertson.svg",    viewBox: "341 505 112 112", kind: "symbol" },
  { id: "washer",       label: "Washer",       file: "washer.svg",       viewBox: "38 280 112 112",  kind: "symbol" },
  { id: "washer_large", label: "Washer L",     file: "washer_large.svg", viewBox: "48 421 112 112",  kind: "symbol" },
  { id: "lockwasher",   label: "Lock Washer",  file: "lockwasher.svg",   viewBox: "38 564 111 111",  kind: "symbol" },
  { id: "insert",       label: "Insert",       file: "insert.svg",       viewBox: "537 346 75 98",   kind: "symbol" },
  { id: "nut",          label: "Nut",          file: "nut.svg",          viewBox: "307 549 137 120", kind: "symbol" },
  { id: "nylock",       label: "Nylock",       file: "nylock.svg",       viewBox: "477 549 137 120", kind: "symbol" },
  // Contributed by PixelVengeur — CNCKitchen/gridfinityLabelGenerator#6
  { id: "square_nut",    label: "Square nut",  file: "square_nut.svg",   viewBox: "-11 -11 130 130", kind: "symbol" },
  { id: "t_nut",         label: "T-Nut",       file: "tnut.svg",         viewBox: "15 -35 80 120",   kind: "symbol" },
  { id: "roll-in_t_nut", label: "Roll Nut",    file: "roll-in-tnut.svg", viewBox: "-10 -10 100 170", kind: "symbol" },

  // Screw-profile images (line 2). viewBox crops each A4 canvas to the drawing.
  { id: "shcs",     label: "Socket Head",    file: "TRP_cylinderHeadScrew.svg",       viewBox: "19 1080 96 31",  kind: "line2" },
  { id: "bhcs",     label: "Button Head",    file: "TRP_buttonHead.svg",              viewBox: "25 1070 93 29",  kind: "line2" },
  { id: "fhcs",     label: "Flat Head",      file: "TRP_flatHead.svg",                viewBox: "82 924 91 37",   kind: "line2" },
  { id: "hex-head", label: "Hex Head",       file: "TRP_hexagonHead.svg",             viewBox: "12 1000 93 33",  kind: "line2" },
  { id: "sh-st",    label: "SH Self-Tap",    file: "TRP_socketHead_selfTapping.svg",  viewBox: "133 400 103 35", kind: "line2" },
  { id: "bh-st",    label: "BH Self-Tap",    file: "TRP_buttonHead_selfTapping.svg",  viewBox: "134 329 97 33",  kind: "line2" },
  { id: "fh-st",    label: "FH Self-Tap",    file: "TRP_flatHead_selfTapping.svg",    viewBox: "136 255 98 38",  kind: "line2" },
  { id: "pin-grub", label: "Pin/Grub Screw", file: "TRP_grubscrew.svg",               viewBox: "84 265 44 22",   kind: "line2" },
];

/** Every icon, resolved with its raw SVG markup. */
const ICONS: Icon[] = DEFS.map((d) => ({ ...d, svg: rawFor(d.file) }));

const BY_ID = new Map<string, Icon>(ICONS.map((i) => [i.id, i]));

/** Look up a single icon by id. */
export function getIcon(id: string | undefined): Icon | undefined {
  return id === undefined ? undefined : BY_ID.get(id);
}

/** All icons of a given kind, in registry order — used to build the UI pickers. */
export function iconsByKind(kind: IconKind): Icon[] {
  return ICONS.filter((i) => i.kind === kind);
}
