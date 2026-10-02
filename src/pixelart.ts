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

/**
 * The leftmost column these rows paint anything in.
 *
 * Artwork carries whatever margin the artist left on its left edge, so the grid's column 0 is not
 * the picture's left edge. A caller that places a grid by its ink rather than by its grid asks here
 * instead of writing the margin down, because a number written down survives a retouch that moves
 * the ink and the alignment then fails silently.
 */
export function inkLeft(rows: string[]): number {
  const xs = rows.map((row) => row.search(/[^ ]/)).filter((x) => x >= 0);
  if (xs.length === 0) throw new Error("these rows paint nothing, so they have no left edge to place them by");
  return Math.min(...xs);
}

/**
 * The rightmost pixel these rows paint.
 *
 * The counterpart of `inkLeft`, and deliberately NOT a shared edge: anything placed beside the
 * scene has to clear its WIDEST frame, so the caller takes a maximum across the poses rather than
 * demanding they agree. The left edge must agree because the scene is placed by it and would slide
 * sideways otherwise; the right edge is only ever a clearance, and a tail that reaches further in
 * one pose than another is the art working as intended.
 */
export function inkRight(rows: string[]): number {
  const xs = rows.map((row) => row.replace(/ +$/, "").length - 1).filter((x) => x >= 0);
  if (xs.length === 0) throw new Error("these rows paint nothing, so they have no right edge to measure");
  return Math.max(...xs);
}

/**
 * The one left edge a set of grids share, for artwork drawn as several frames of the same scene.
 *
 * A caller that places a scene by its ink needs a single edge for the whole set: placing it by one
 * frame's ink while another frame starts further in would slide the picture sideways every time the
 * frame changed, which is worse than the margin being removed. So disagreement is an error, not a
 * minimum to take, and it is reported with the frame that broke it.
 */
export function sharedInkLeft(grids: { name: string; rows: string[] }[]): number {
  if (grids.length === 0) throw new Error("no grids, so there is no left edge to share");
  const edges = grids.map((g) => ({ name: g.name, left: inkLeft(g.rows) }));
  const [first, ...rest] = edges;
  for (const other of rest) {
    if (other.left !== first.left) {
      throw new Error(`${other.name}: its leftmost ink is pixel ${other.left}, but ${first.name} starts at ${first.left}; frames placed by their ink must share one edge or the scene shifts sideways between them`);
    }
  }
  return first.left;
}

/**
 * How many PIXELS ACROSS a set of frames of one scene occupies: from the edge they share to the
 * rightmost ink any one of them reaches, inclusive of both.
 *
 * The two edges are taken differently on purpose, and that asymmetry is the whole content of this
 * function. The left is `sharedInkLeft`, which REFUSES frames that disagree, because the scene is
 * placed by that edge and would slide sideways between frames otherwise. The right is a MAXIMUM,
 * because anything placed beside the scene has to clear its widest frame: a minimum, or the rest
 * frame's own right edge, clears whichever frame happens to be narrowest and is then overlapped by
 * every other one, which is a fault nobody sees until the art is retouched.
 *
 * It lives here, as a function over grids handed to it, so that the maximum can be exercised by a
 * set of frames that actually differ. The Mascot's own poses all end at the same pixel, because an
 * invariant forces the rack identical across them, so measured against the committed artwork alone
 * a maximum, a minimum and a first-frame lookup all return the same number and no test can tell
 * them apart.
 */
export function sharedInkWidth(grids: { name: string; rows: string[] }[]): number {
  return Math.max(...grids.map((g) => inkRight(g.rows))) - sharedInkLeft(grids) + 1;
}

/** One rectangle per run, `size` units square per pixel, with pixel (0, 0) at (originX, originY). */
export function runsToPath(runs: Run[], originX: number, originY: number, size: number): string {
  return runs.map((r) => `M${originX + r.x * size} ${originY + r.y * size}h${r.w * size}v${size}h-${r.w * size}z`).join("");
}
