// JetBrains Mono v2.304 is exactly monospace: unitsPerEm 1000, advance 600 = 0.6em.
// font-size 20 therefore gives a cell exactly 12 units wide, with no rounding.
export const FONT_SIZE = 20;
export const CELL_W = 12;
export const CELL_H = 24;
export const COLS = 72;
export const PAD = 16;
// Centres the x-height (550/1000 em = 11 units) in the 24-unit row, and stays 17.5 after the
// Task 3 render check. Centring the cap height (730/1000 em = 14.6 units) would need 19.3 and
// leave a descender (3.6 units) only 1.1 units clear of the row's bottom edge instead of 2.9.
// The gap from a descender to the next row's tallest printable ink ('$', 17.4 units) is 3.0
// units at any baseline, because it depends only on the 24-unit row pitch.
export const BASELINE_IN_ROW = 17.5;
export const CANVAS_W = PAD + COLS * CELL_W + PAD;

export const colX = (col: number): number => PAD + col * CELL_W;
export const rowBaselineY = (row: number): number => PAD + row * CELL_H + BASELINE_IN_ROW;
export const canvasH = (rows: number): number => PAD + rows * CELL_H + PAD;
