import { readFileSync } from "node:fs";

/** A character grid, one character per art pixel. A space is transparent. */
export type Grid = { name: string; width: number; height: number; rows: string[] };

/** A horizontal stretch of `w` pixels starting at (x, y). */
export type Run = { x: number; y: number; w: number };

/** Half-open pixel ranges: x0 <= x < x1, y0 <= y < y1. */
export type Box = { x0: number; x1: number; y0: number; y1: number };

/**
 * Parses a character grid. The grid is the source of truth for the artwork, so a malformed one
 * fails loudly and says where: a wrong shape names the row, an unknown character names itself and
 * its x and row. Without stated dimensions the grid must still be rectangular.
 */
export function parseGrid(text: string, o: { name: string; glyphs: string; width?: number; height?: number }): Grid {
  const rows = text.replace(/\n$/, "").split("\n");
  const height = o.height ?? rows.length;
  const width = o.width ?? rows[0].length;
  if (rows.length !== height) throw new Error(`${o.name}: expected ${height} rows, found ${rows.length}`);
  const known = new Set([" ", ...o.glyphs]);
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`${o.name}: row ${y} is ${row.length} characters wide, expected ${width}`);
    for (let x = 0; x < row.length; x++) {
      if (!known.has(row[x])) throw new Error(`${o.name}: unknown character ${JSON.stringify(row[x])} at x${x} row ${y}`);
    }
  });
  return { name: o.name, width, height, rows };
}

export function loadGrid(url: URL, o: { glyphs: string; width?: number; height?: number }): Grid {
  return parseGrid(readFileSync(url, "utf8"), { ...o, name: url.pathname.split("/").pop() ?? url.pathname });
}

/** The characters a palette file defines, one per key. */
export function loadGlyphs(url: URL): string {
  const keys = Object.keys(JSON.parse(readFileSync(url, "utf8")));
  for (const k of keys) if (k.length !== 1) throw new Error(`${url.pathname}: palette key ${JSON.stringify(k)} is not a single character`);
  return keys.join("");
}

/**
 * The maximal horizontal runs of pixels whose character is in `chars`, row by row. Several
 * characters in `chars` are one shape: a run does not stop where one gives way to another.
 * Merging is what keeps the path small, and it is lossless: nothing is added, dropped or moved.
 */
export function runsOf(rows: string[], chars: string, box?: Box): Run[] {
  const runs: Run[] = [];
  const y0 = box?.y0 ?? 0;
  const y1 = box?.y1 ?? rows.length;
  for (let y = y0; y < Math.min(y1, rows.length); y++) {
    const x0 = box?.x0 ?? 0;
    const x1 = Math.min(box?.x1 ?? rows[y].length, rows[y].length);
    let start = -1;
    for (let x = x0; x <= x1; x++) {
      const on = x < x1 && chars.includes(rows[y][x]);
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        runs.push({ x: start, y, w: x - start });
        start = -1;
      }
    }
  }
  return runs;
}

/** One rectangle per run, `size` units square per pixel, with pixel (0, 0) at (originX, originY). */
export function runsToPath(runs: Run[], originX: number, originY: number, size: number): string {
  return runs.map((r) => `M${originX + r.x * size} ${originY + r.y * size}h${r.w * size}v${size}h-${r.w * size}z`).join("");
}
