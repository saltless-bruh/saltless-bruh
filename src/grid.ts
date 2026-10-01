// JetBrains Mono v2.304 is exactly monospace: unitsPerEm 1000, advance 600 = 0.6em.
// font-size 20 therefore gives a cell exactly 12 units wide, with no rounding.
export const FONT_SIZE = 20;
export const CELL_W = 12;
export const CELL_H = 24;
export const COLS = 72;
export const PAD = 16;
// Centres the cap height (730/1000 em) in the 24-unit row. Task 3 verifies it against a real render.
export const BASELINE_IN_ROW = 17.5;
export const CANVAS_W = PAD + COLS * CELL_W + PAD;

export const colX = (col: number): number => PAD + col * CELL_W;
export const rowBaselineY = (row: number): number => PAD + row * CELL_H + BASELINE_IN_ROW;
export const canvasH = (rows: number): number => PAD + rows * CELL_H + PAD;
