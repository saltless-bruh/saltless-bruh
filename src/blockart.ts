import { CELL_W, CELL_H, PAD } from "./grid.ts";

const halfH = CELL_H / 2;

/** Which quadrants a block glyph fills: [topLeft, topRight, bottomLeft, bottomRight]. */
export type Quad = [boolean, boolean, boolean, boolean];

const T = true, F = false;
const QUADS: Record<string, Quad> = {
  " ": [F, F, F, F], "█": [T, T, T, T],
  "▀": [T, T, F, F], "▄": [F, F, T, T], "▌": [T, F, T, F], "▐": [F, T, F, T],
  "▘": [T, F, F, F], "▝": [F, T, F, F], "▖": [F, F, T, F], "▗": [F, F, F, T],
  "▛": [T, T, T, F], "▜": [T, T, F, T], "▙": [T, F, T, T], "▟": [F, T, T, T],
  "▚": [T, F, F, T], "▞": [F, T, T, F],
};

export function blockToQuads(ch: string): Quad {
  // hasOwn, not a bare lookup: a plain object would answer "constructor" from its prototype.
  if (!Object.hasOwn(QUADS, ch)) throw new Error(`not a block character: ${JSON.stringify(ch)}`);
  return QUADS[ch];
}

/**
 * Compile rows of block art into one path, merging horizontally adjacent
 * sub-cells into single rectangles. Merging matters: separate rects show
 * hairline seams when the image is scaled to a fractional width.
 */
export function artToPath(art: string[], originCol: number, originRow: number): string {
  const parts: string[] = [];

  art.forEach((line, rowIdx) => {
    const cells = [...line];
    const subCols = cells.length * 2;   // two sub-columns per cell, so quadrants survive
    // Two sub-rows per text row: the top and bottom halves of the cell.
    for (const half of [0, 1]) {
      const subFilled = (s: number): boolean => {
        const q = blockToQuads(cells[s >> 1]);
        const left = (s & 1) === 0;
        return half === 0 ? (left ? q[0] : q[1]) : (left ? q[2] : q[3]);
      };
      let runStart = -1;
      for (let s = 0; s <= subCols; s++) {
        const on = s < subCols && subFilled(s);
        if (on && runStart < 0) runStart = s;
        if (!on && runStart >= 0) {
          const x = PAD + (originCol + runStart / 2) * CELL_W;
          const y = PAD + (originRow + rowIdx) * CELL_H + half * halfH;
          const w = ((s - runStart) / 2) * CELL_W;
          parts.push(`M${x} ${y}h${w}v${halfH}h-${w}z`);
          runStart = -1;
        }
      }
    }
  });

  return parts.join("");
}
