// Self-check for the line-1 centring math. No test framework: run it with
//   node src/services/layout.check.ts
// (Node >= 22.6 strips the types natively.)

import assert from "node:assert/strict";
import { centerBox, centerRect, hasLine2 } from "./layout.ts";

const LINE1 = { x1: 11, y1: 5.75, x2: 34.5, y2: 10 };   // Pred/Cullenect line1Box
const LINE2 = { x1: 11, y1: 0.5, x2: 34.5, y2: 4.75 };  // Pred/Cullenect line2Box
const FACE_H = 11.5;                                     // Pred face height (mm)

// Mirrors derivePreviewBox() in services/profiles.tsx: Y-up rect -> Y-down box.
const toBox = (r: typeof LINE1) => ({ x: r.x1, y: FACE_H - r.y2, w: r.x2 - r.x1, h: r.y2 - r.y1 });

// 1. A line 2 is anything renderable — text or image. Whitespace is not text.
assert.equal(hasLine2({ line2: "Screw" }), true);
assert.equal(hasLine2({ line2: "" }), false);
assert.equal(hasLine2({ line2: "   " }), false);
assert.equal(hasLine2({ line2: "", line2Svg: "<svg/>" }), true);

// 2. The box moves but never resizes — the fitted font size must not change.
const centred = centerRect(LINE1, LINE2);
assert.equal(centred.x1, LINE1.x1);
assert.equal(centred.x2, LINE1.x2);
assert.equal(centred.y2 - centred.y1, LINE1.y2 - LINE1.y1);

// 3. Its centre is the midpoint of the two boxes' centres, i.e. the middle of
//    the content area (5.25 mm here, not the raw 5.75 mm face middle — the
//    content band is inset from the face edges).
assert.equal((centred.y1 + centred.y2) / 2, 5.25);

// 4. The spaces agree: centring then projecting to preview space must equal
//    projecting then centring. This is what catches a sign flip between the
//    Y-up generator and the Y-down preview/PNG.
assert.deepEqual(centerBox(toBox(LINE1), toBox(LINE2)), toBox(centred));

// 5. Idempotent in the degenerate case: centring a box against itself is a no-op.
assert.deepEqual(centerRect(LINE1, LINE1), LINE1);

console.log("layout: ok");
