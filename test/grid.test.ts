import test from "node:test";
import assert from "node:assert/strict";
import { CELL_W, CELL_H, COLS, CANVAS_W, FONT_SIZE, PAD, BASELINE_IN_ROW, colX, rowBaselineY, canvasH } from "../src/grid.ts";

test("cell width is the font advance exactly", () => {
  // JetBrains Mono v2.304: unitsPerEm 1000, advance 600 => 0.6em; 20 * 0.6 = 12
  assert.equal(FONT_SIZE, 20);
  assert.equal(CELL_W, FONT_SIZE * 0.6);
  assert.equal(CELL_W, 12);
  assert.equal(CELL_H, 24);
});

// THE ROW PITCH IS LOCKED TO TWICE THE COLUMN, structurally, and that is what fixes the line-height
// ratio at 1.2 at every scale. `src/mascot.ts` refuses to load unless an art pixel is square, which
// is `CELL_W / 2 === CELL_H / 4`; the two together leave CELL_H no freedom at all. Pinned here rather
// than left implicit, because the consequence somebody will reach for is extra leading, and there is
// none to buy: raising CELL_H alone breaks the sprite and raising both holds the ratio at 1.2.
test("the row pitch is twice the column, so the line-height ratio is fixed at 1.2", () => {
  assert.equal(CELL_H, 2 * CELL_W);
  assert.equal(CELL_H / FONT_SIZE, 1.2);
  assert.equal(CELL_W / 2, CELL_H / 4, "an art pixel must be square; src/mascot.ts throws otherwise");
});

test("canvas is 84 columns plus padding", () => {
  assert.equal(PAD, 16);
  // 84, measured: at 846px of README column a 72-column canvas renders the 20-unit font at 18.9px,
  // where a terminal is 13 to 15px, and 84 renders it at 16.3px. 96 was built, rendered beside 84 and
  // rejected by the owner, because the copy was written for 72 and does not grow with the grid.
  assert.equal(COLS, 84);
  assert.equal(CANVAS_W, PAD + COLS * CELL_W + PAD);
  assert.equal(CANVAS_W, 1040);
  // The rendered text size is the whole reason for the number, so it is checked rather than asserted
  // in a comment: the canvas scales into the README column, so one unit is COLUMN / CANVAS_W pixels.
  const px = (col: number, width = 846): number => (width / (PAD + col * CELL_W + PAD)) * FONT_SIZE;
  assert.ok(Math.abs(px(72) - 18.9) < 0.1, `72 columns renders the font at ${px(72).toFixed(1)}px`);
  assert.ok(Math.abs(px(COLS) - 16.3) < 0.1, `${COLS} columns renders the font at ${px(COLS).toFixed(1)}px`);
});

test("column 0 starts at the left padding and columns advance by one cell", () => {
  assert.equal(colX(0), 16);
  assert.equal(colX(COLS - 1), 16 + (COLS - 1) * 12);
});

test("rows advance by one cell height", () => {
  assert.equal(rowBaselineY(0), PAD + BASELINE_IN_ROW);
  assert.equal(rowBaselineY(0), 33.5);
  assert.equal(rowBaselineY(1) - rowBaselineY(0), CELL_H);
  assert.equal(rowBaselineY(1) - rowBaselineY(0), 24);
});

test("canvas height covers every row plus padding", () => {
  assert.equal(canvasH(10), 16 + 10 * 24 + 16);
});
