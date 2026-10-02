import test from "node:test";
import assert from "node:assert/strict";
import {
  bannerArt, bannerPath, bannerWidthCols, pixelsToRows,
  BANNER_ROWS, GLYPH_PIXEL_ROWS, LETTER_PIXELS,
} from "../src/banner.ts";
import { artToPath, blockToQuads } from "../src/blockart.ts";
import { CELL_H, CELL_W, COLS, PAD } from "../src/grid.ts";
import { MASCOT_COLS } from "../src/mascot.ts";

// Everything the banner can draw. Walking all of it, not just LAZIE, means a typo in the
// letterform of Q fails here instead of the day someone's handle contains a Q.
const SUPPORTED = Object.keys(LETTER_PIXELS);
const DRAWN = SUPPORTED.filter((ch) => ch !== " ");
const width = (s: string): number => [...s].length;
const widths = (rows: string[]): Set<number> => new Set(rows.map(width));
const px = (ch: string): string[] => LETTER_PIXELS[ch];
const glyphW = (ch: string): number => px(ch)[0].length;

/** Set pixels as "x,y" keys, which is what every geometric check below works from. */
const inkOf = (rows: string[]): Set<string> => {
  const ink = new Set<string>();
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === "#") ink.add(`${x},${y}`); }));
  return ink;
};

/** Four-connected components of the cells in `cells`. Diagonal touching is not connection. */
function components(cells: Set<string>): Set<string>[] {
  const seen = new Set<string>();
  const out: Set<string>[] = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    const group = new Set<string>();
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const key = queue.pop()!;
      group.add(key);
      const [x, y] = key.split(",").map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = `${x + dx},${y + dy}`;
        if (cells.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    out.push(group);
  }
  return out;
}

/** Maximal horizontal runs of `ch` in a row, as lengths. */
const runs = (row: string, ch: string): number[] =>
  row.split(ch === "#" ? "." : "#").filter((r) => r.length > 0).map((r) => r.length);

// ---- the approved design ----

test("the Banner is five text rows of ten pixel rows, for every glyph and for a word", () => {
  assert.equal(BANNER_ROWS, 5);
  assert.equal(GLYPH_PIXEL_ROWS, 10);
  assert.equal(GLYPH_PIXEL_ROWS, BANNER_ROWS * 2, "a text row carries exactly two pixel rows");
  assert.equal(bannerArt("LAZIE").length, BANNER_ROWS);
  for (const ch of SUPPORTED) {
    assert.equal(px(ch).length, GLYPH_PIXEL_ROWS, `${JSON.stringify(ch)} pixel rows`);
    assert.equal(bannerArt(ch).length, BANNER_ROWS, JSON.stringify(ch));
  }
});

test("the five approved letterforms are drawn exactly as the owner approved them", () => {
  // Pinned pixel for pixel. These five settled the design; a later retouch that "improves" one
  // of them is a change to an approved decision and has to fail here first.
  const APPROVED: Record<string, string> = {
    L: "##.... ##.... ##.... ##.... ##.... ##.... ##.... ##.... ###### ######",
    A: "..##.. .####. ##..## ##..## ##..## ###### ###### ##..## ##..## ##..##",
    Z: "###### ###### ....## ...### ..###. .###.. ###... ##.... ###### ######",
    I: "###### ###### ..##.. ..##.. ..##.. ..##.. ..##.. ..##.. ###### ######",
    E: "###### ###### ##.... ##.... #####. #####. ##.... ##.... ###### ######",
  };
  for (const [ch, spec] of Object.entries(APPROVED)) {
    assert.deepEqual(px(ch), spec.split(" "), ch);
  }
});

test("bannerWidthCols(\"LAZIE\") is 34, inside the columns the Mascot leaves", () => {
  assert.equal(bannerWidthCols("LAZIE"), 34);
  // Derived from the Mascot rather than written down, so widening the Mascot fails here. The budget
  // grew with the Session's own width; what the test is for is that 34 still fits inside it.
  const budget = COLS - (MASCOT_COLS + 2);
  assert.equal(budget, 50);
  assert.ok(bannerWidthCols("LAZIE") <= budget, `34 must fit in ${budget}`);
});

// ---- the rules every glyph follows ----

test("every stroke is at least two pixels wide, so nothing thins to a hairline", () => {
  // The whole reason for the redraw: a one-pixel stem does not survive the 308px render. A run
  // of exactly one set pixel anywhere in the table is that hairline, whatever letter it is in.
  for (const ch of DRAWN) {
    px(ch).forEach((row, y) => {
      for (const n of runs(row, "#")) {
        assert.ok(n >= 2, `${JSON.stringify(ch)} pixel row ${y} has a ${n}-pixel run: ${row}`);
      }
    });
  }
});

test("every glyph is one connected shape, so nothing floats off as an orphan cluster", () => {
  for (const ch of DRAWN) {
    const parts = components(inkOf(px(ch)));
    assert.equal(parts.length, 1, `${JSON.stringify(ch)} is drawn as ${parts.length} separate pieces`);
  }
  assert.equal(inkOf(px(" ")).size, 0, "the space glyph draws nothing");
});

test("every enclosed counter is at least two pixels across, and exactly these glyphs have one", () => {
  // A counter that closes up when rendered has failed. Open counters (M, N, W, K, V, X, Y) pinch
  // to one pixel where strokes converge, which is the letter rather than a fault, so only
  // ENCLOSED counters are measured: clear cells that cannot reach the outside of the glyph.
  const withCounters: string[] = [];
  for (const ch of SUPPORTED) {
    const rows = px(ch);
    const w = rows[0].length;
    const clear = new Set<string>();
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === ".") clear.add(`${x},${y}`); }));
    const holes = components(clear).filter((group) =>
      ![...group].some((k) => {
        const [x, y] = k.split(",").map(Number);
        return x === 0 || y === 0 || x === w - 1 || y === GLYPH_PIXEL_ROWS - 1;
      }));
    if (holes.length > 0) withCounters.push(ch);
    for (const hole of holes) {
      const xs = [...hole].map((k) => Number(k.split(",")[0]));
      const ys = [...hole].map((k) => Number(k.split(",")[1]));
      const cols = Math.max(...xs) - Math.min(...xs) + 1;
      const tall = Math.max(...ys) - Math.min(...ys) + 1;
      assert.ok(cols >= 2 && tall >= 2, `${JSON.stringify(ch)} has a ${cols}x${tall} counter, which closes up at 1x`);
    }
  }
  // Object.keys puts the digit keys first, so both sides are sorted rather than written in
  // whatever order the table happens to enumerate in.
  assert.deepEqual(withCounters.sort(), ["A", "B", "D", "O", "P", "Q", "R", "0", "4", "6", "8", "9"].sort());
});

test("the look-alikes are told apart by their corners, not by luck", () => {
  // O/0/D and S/5 and B/8 are the pairs that collide at 308px, and what separates them is a
  // deliberate system: round bevels, a flat left side, or square corners. Reading the corners
  // off the bitmaps states that system where a reviewer can see it, and breaks if one is lost.
  const corners = (ch: string): string => {
    const rows = px(ch);
    const w = rows[0].length;
    return [[0, 0], [w - 1, 0], [0, GLYPH_PIXEL_ROWS - 1], [w - 1, GLYPH_PIXEL_ROWS - 1]]
      .map(([x, y]) => (rows[y][x] === "#" ? "#" : "."))
      .join("");
  };
  assert.equal(corners("0"), "####", "the digit zero is square on all four corners");
  assert.equal(corners("O"), "....", "the letter O is bevelled on all four corners");
  assert.equal(corners("D"), "#.#.", "D is flat on the left and bevelled on the right");
  assert.equal(corners("C"), ".#.#", "C is bevelled on its round left side and flat where it opens");
  assert.equal(corners("5"), "##.#", "5 keeps a square top bar where S bevels");
  assert.equal(corners("S"), "....");
  assert.equal(corners("B"), "#.#.", "B is flat on the left where 8 is bevelled");
  assert.equal(corners("8"), "....");
  // The waist is the other half of B against 8: B's runs the full width, 8's is pinched in.
  assert.equal(px("B")[4], "######");
  assert.equal(px("8")[4], ".####.");
});

test("no two glyphs share a shape, and every drawn glyph has ink", () => {
  for (const ch of DRAWN) assert.ok(inkOf(px(ch)).size > 0, `${ch} is blank`);
  const shapes = new Set(SUPPORTED.map((ch) => px(ch).join("\n")));
  assert.equal(shapes.size, SUPPORTED.length, "two characters are drawn identically");
  const art = new Set(SUPPORTED.map((ch) => bannerArt(ch).join("\n")));
  assert.equal(art.size, SUPPORTED.length, "two characters compile to the same block art");
});

test("the alphabet covers A to Z, 0 to 9, the hyphen and the space, and nothing else", () => {
  assert.deepEqual([...SUPPORTED].sort(), [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", ..."0123456789", "-", " "].sort());
});

test("only M, W, Q, N, 4 and the space differ from the six-column box", () => {
  // Width is a design decision, not a slip: a letter is widened only where its diagonals cannot
  // carry stem weight inside six columns. Listing them keeps that decision visible.
  const odd = Object.fromEntries(SUPPORTED.filter((ch) => glyphW(ch) !== 6).map((ch) => [ch, glyphW(ch)]));
  assert.deepEqual(odd, { M: 9, W: 9, Q: 8, N: 7, "4": 7, " ": 3 });
});

// ---- compiling a bitmap into half-blocks ----

test("a pair of pixel rows becomes one text row: both, top, bottom, neither", () => {
  // Exhaustive over the four states a cell can be in, so swapping the upper and lower half
  // blocks, or dropping one of them, cannot pass.
  const rows = pixelsToRows("probe", ["##..", "#.#.", ...Array.from({ length: 8 }, () => "....")]);
  assert.equal(rows[0], "█▀▄ ");
  assert.deepEqual(rows.slice(1), ["    ", "    ", "    ", "    "]);
});

test("a malformed bitmap is refused and says what is wrong and where", () => {
  const ok = Array.from({ length: 10 }, () => "##..");
  assert.throws(() => pixelsToRows("short", ok.slice(0, 9)), /"short".*9 pixel rows, expected 10/);
  assert.throws(() => pixelsToRows("long", [...ok, "##.."]), /"long".*11 pixel rows, expected 10/);
  assert.throws(() => pixelsToRows("ragged", ok.map((r, i) => (i === 7 ? "##." : r))), /"ragged".*row 7 is 3 wide, expected 4/);
  assert.throws(() => pixelsToRows("stray", ok.map((r, i) => (i === 3 ? "#x.." : r))), /"stray".*"x" at x1 row 3/);
  assert.throws(() => pixelsToRows("empty", Array.from({ length: 10 }, () => "")), /"empty".*at least one column/);
  assert.doesNotThrow(() => pixelsToRows("fine", ok));
});

test("every glyph in the table compiles to characters the block compiler knows", () => {
  for (const ch of SUPPORTED) {
    for (const row of bannerArt(ch)) {
      for (const glyph of row) {
        assert.doesNotThrow(() => blockToQuads(glyph), `${JSON.stringify(ch)} uses ${JSON.stringify(glyph)}`);
      }
    }
    assert.equal(widths(bannerArt(ch)).size, 1, `${JSON.stringify(ch)} has rows of different widths`);
    assert.equal(width(bannerArt(ch)[0]), glyphW(ch), `${JSON.stringify(ch)} is not its bitmap's width`);
  }
});

// ---- words ----

test("a word is its glyphs in order, one blank column apart, with nothing padded", () => {
  for (const word of ["LAZIE", "ZIZ", "MW-04", "I M"]) {
    const letters = [...word].map((ch) => bannerArt(ch));
    const expected = Array.from({ length: BANNER_ROWS }, (_, r) => letters.map((l) => l[r]).join(" "));
    assert.deepEqual(bannerArt(word), expected, word);
    // Exactly the glyph widths plus one column each gap: no glyph was stretched to match another.
    const lettersWidth = [...word].reduce((sum, ch) => sum + glyphW(ch), 0);
    assert.equal(bannerWidthCols(word), lettersWidth + (word.length - 1), word);
    assert.equal(widths(bannerArt(word)).size, 1, word);
  }
  // Glyphs of three different widths in one word still line up row for row.
  assert.equal(bannerWidthCols("MQI"), 9 + 1 + 8 + 1 + 6);
});

test("lowercase text draws the same letters", () => {
  assert.deepEqual(bannerArt("lazie"), bannerArt("LAZIE"));
  assert.deepEqual(bannerArt("m-4w"), bannerArt("M-4W"));
});

test("an unsupported character is reported by name, not drawn as a gap", () => {
  for (const bad of ["#", "?", "_", "/", "+"]) {
    assert.throws(
      () => bannerArt(`LA${bad}IE`),
      (err) => err instanceof Error && err.message.includes(bad),
      bad,
    );
  }
  // Digits are part of the alphabet now, so they must NOT throw.
  for (const digit of [..."0123456789"]) assert.doesNotThrow(() => bannerArt(`LA${digit}IE`), digit);
});

// ---- geometry ----

test("bannerPath compiles the banner art placed at the requested cell", () => {
  const cases: [string, number, number][] = [["LAZIE", 0, 0], ["LAZIE", 3, 2], ["ZA", 7, 1], ["MW4", 2, 0]];
  for (const [text, col, row] of cases) {
    assert.equal(bannerPath(text, col, row), artToPath(bannerArt(text), col, row), `${text} at ${col},${row}`);
  }
  assert.notEqual(bannerPath("LAZIE", 0, 0), bannerPath("ZA", 0, 0));
});

test("the drawn rectangles are exactly the set pixels of the bitmap, square and in place", () => {
  // The end of the chain, read back: every rectangle the path emits is turned into the art
  // pixels it covers and compared with the table. A bitmap row paired with the wrong half, a
  // glyph drawn a column out, or a pixel that is 12 x 24 instead of square all fail here.
  const half = CELL_H / 2;
  assert.equal(half, CELL_W, "an art pixel is only square if half a row is one column");
  for (const ch of DRAWN) {
    const [col, row] = [2, 1];
    const covered = new Set<string>();
    for (const [, x, y, w, h] of bannerPath(ch, col, row).matchAll(/M([\d.]+) ([\d.]+)h([\d.]+)v([\d.]+)h-[\d.]+z/g)) {
      const px0: number = (Number(x) - PAD) / CELL_W - col;
      const py0: number = (Number(y) - PAD - row * CELL_H) / half;
      const pw: number = Number(w) / CELL_W;
      const ph: number = Number(h) / half;
      assert.ok(Number.isInteger(px0) && Number.isInteger(py0), `${ch}: rectangle off the pixel grid at ${x},${y}`);
      assert.equal(ph, 1, `${ch}: a rectangle is ${ph} pixel rows tall; each half-row is drawn on its own`);
      for (let i = 0; i < pw; i++) covered.add(`${px0 + i},${py0}`);
    }
    assert.deepEqual([...covered].sort(), [...inkOf(px(ch))].sort(), `${ch} draws different pixels than its bitmap`);
  }
});

test("moving the banner by whole cells translates every rectangle by 12 per column and 24 per row", () => {
  const shift = (d: string, dx: number, dy: number): string =>
    d.replace(/M([\d.]+) ([\d.]+)/g, (_, x, y) => `M${Number(x) + dx} ${Number(y) + dy}`);
  const origin = bannerPath("LAZIE", 0, 0);
  assert.ok(origin.length > 0);
  // 3 columns * 12 = 36, 2 rows * 24 = 48
  assert.equal(bannerPath("LAZIE", 3, 2), shift(origin, 36, 48));
});

test("bannerPath refuses an unsupported character instead of leaving a hole", () => {
  assert.throws(() => bannerPath("LA#IE", 0, 0), /#/);
});
