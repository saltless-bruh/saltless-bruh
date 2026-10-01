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

test("canvas is 72 columns plus padding", () => {
  assert.equal(PAD, 16);
  assert.equal(COLS, 72);
  assert.equal(CANVAS_W, PAD + COLS * CELL_W + PAD);
});

test("column 0 starts at the left padding and columns advance by one cell", () => {
  assert.equal(colX(0), 16);
  assert.equal(colX(71), 16 + 71 * 12);
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
