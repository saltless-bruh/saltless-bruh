// JetBrains Mono v2.304 is exactly monospace: unitsPerEm 1000, advance 600 = 0.6em.
// font-size 20 therefore gives a cell exactly 12 units wide, with no rounding.
export const FONT_SIZE = 20;
export const CELL_W = 12;
/**
 * THE ROW PITCH IS LOCKED TO TWICE THE COLUMN, AND THAT IS STRUCTURAL RATHER THAN A CHOICE.
 *
 * `src/mascot.ts` builds the sprite from art pixels of `PX = CELL_W / 2` and refuses to load unless
 * `PX === CELL_H / 4`, because an art pixel that is not square is not a pixel. Those two together
 * say `CELL_H = 2 * CELL_W` and nothing else. The consequence worth writing down, because it is the
 * thing somebody will try: the line-height ratio is therefore fixed at `CELL_H / FONT_SIZE = 1.2`,
 * at every font size and every column count, so **extra leading cannot be bought at any scale**.
 * Raising `CELL_H` alone breaks the sprite's squareness check; raising it together with `CELL_W`
 * holds the ratio at 1.2 and changes only the absolute size. Measured by breaking it.
 */
export const CELL_H = 2 * CELL_W;
/**
 * Columns the Session is drawn in.
 *
 * 84, and the number is a measurement rather than a preference. The README column is ~846px
 * (docs/spec.md 3.1), and a `viewBox` with no fixed width scales the whole canvas into it, so the
 * column count sets the rendered text size: 846px over a 72-column canvas renders the 20-unit font
 * at **18.9px**, where a terminal is 13 to 15px. That is why the Session read as huge and cramped
 * at 72. At 84 it renders at **16.3px**, and the existing line lengths still nearly fill the row.
 *
 * **96 was built and rendered beside 84 and rejected by the owner**, not on size, which it also
 * gets right, but because the copy was written for 72 and does not grow with the grid: at 96 the
 * rows end well short of the margin and the panel opens a visible dead strip on the right. 84 is
 * the widest setting the existing copy still fills.
 */
export const COLS = 84;
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
