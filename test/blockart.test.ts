import test from "node:test";
import assert from "node:assert/strict";
import { blockToQuads, artToPath } from "../src/blockart.ts";
import type { Quad } from "../src/blockart.ts";

// Every expected value is derived by hand from the grid, never computed by the code under test.
// Cell (0,0) starts at x 16, y 16 (the 16 unit padding). A cell is 12 wide and 24 tall, so one
// quadrant is 6 wide and 12 tall. The compiler paints one rectangle per half-row, because a half
// block such as the upper half fills only part of its cell's height.

const T = true, F = false;

// [description, glyph, [top-left, top-right, bottom-left, bottom-right], path of that glyph alone at cell (0,0)]
const GLYPHS: [string, string, Quad, string][] = [
  ["space", " ", [F, F, F, F], ""],
  ["full block", "█", [T, T, T, T], "M16 16h12v12h-12zM16 28h12v12h-12z"],
  ["upper half", "▀", [T, T, F, F], "M16 16h12v12h-12z"],
  ["lower half", "▄", [F, F, T, T], "M16 28h12v12h-12z"],
  ["left half", "▌", [T, F, T, F], "M16 16h6v12h-6zM16 28h6v12h-6z"],
  ["right half", "▐", [F, T, F, T], "M22 16h6v12h-6zM22 28h6v12h-6z"],
  ["upper left", "▘", [T, F, F, F], "M16 16h6v12h-6z"],
  ["upper right", "▝", [F, T, F, F], "M22 16h6v12h-6z"],
  ["lower left", "▖", [F, F, T, F], "M16 28h6v12h-6z"],
  ["lower right", "▗", [F, F, F, T], "M22 28h6v12h-6z"],
  ["all but lower right", "▛", [T, T, T, F], "M16 16h12v12h-12zM16 28h6v12h-6z"],
  ["all but lower left", "▜", [T, T, F, T], "M16 16h12v12h-12zM22 28h6v12h-6z"],
  ["all but upper right", "▙", [T, F, T, T], "M16 16h6v12h-6zM16 28h12v12h-12z"],
  ["all but upper left", "▟", [F, T, T, T], "M22 16h6v12h-6zM16 28h12v12h-12z"],
  ["upper left and lower right", "▚", [T, F, F, T], "M16 16h6v12h-6zM22 28h6v12h-6z"],
  ["upper right and lower left", "▞", [F, T, T, F], "M22 16h6v12h-6zM16 28h6v12h-6z"],
];

const named = (err: unknown, text: string): boolean => err instanceof Error && err.message.includes(text);

test("every block glyph maps to exactly the quadrants it fills", () => {
  for (const [name, ch, quad] of GLYPHS) {
    assert.deepEqual(blockToQuads(ch), quad, name);
  }
});

test("blockToQuads refuses anything that is not exactly one known block glyph", () => {
  // "constructor" guards against a plain-object lookup answering from the prototype chain;
  // the light shade is a real block-element character that the compiler does not support.
  for (const bad of ["?", "░", "", "██", "constructor", " "]) {
    assert.throws(() => blockToQuads(bad), (err) => named(err, bad), JSON.stringify(bad));
  }
});

test("a single glyph compiles to one rectangle per filled half-row, at its own corners", () => {
  for (const [name, ch, , path] of GLYPHS) {
    assert.equal(artToPath([ch], 0, 0), path, name);
  }
});

test("a full block is two stacked 12 by 12 rectangles, not one 12 by 24", () => {
  assert.equal(artToPath(["█"], 0, 0), "M16 16h12v12h-12zM16 28h12v12h-12z");
});

test("adjacent blocks merge into one wide rectangle per half-row, avoiding seams", () => {
  assert.equal(artToPath(["██"], 0, 0), "M16 16h24v12h-24zM16 28h24v12h-24z");
  assert.equal(artToPath(["████"], 0, 0), "M16 16h48v12h-48zM16 28h48v12h-48z");
});

test("a run merges across a cell boundary at quadrant resolution", () => {
  // The right half of one cell touches the left half of the next: one 12 wide rectangle
  // starting mid-cell, not two 6 wide ones.
  assert.equal(artToPath(["▐▌"], 0, 0), "M22 16h12v12h-12zM22 28h12v12h-12z");
});

test("each half-row merges on its own, so the runs of the two halves can differ", () => {
  // Top halves of both cells are filled edge to edge; bottom halves have a hole between.
  assert.equal(artToPath(["▛▜"], 0, 0), "M16 16h24v12h-24zM16 28h6v12h-6zM34 28h6v12h-6z");
});

test("a blank cell ends a run, and runs are emitted top half-row first, left to right", () => {
  assert.equal(
    artToPath(["█ █"], 0, 0),
    "M16 16h12v12h-12zM40 16h12v12h-12zM16 28h12v12h-12zM40 28h12v12h-12z",
  );
});

test("rows advance by one cell height and are not merged vertically", () => {
  assert.equal(
    artToPath(["█", "█"], 0, 0),
    "M16 16h12v12h-12zM16 28h12v12h-12zM16 40h12v12h-12zM16 52h12v12h-12z",
  );
});

test("the origin is a cell offset: columns move x, rows move y", () => {
  // col 2 => x 16 + 2 * 12 = 40, row 3 => y 16 + 3 * 24 = 88
  assert.equal(artToPath(["█"], 2, 3), "M40 88h12v12h-12zM40 100h12v12h-12z");
  // The right half of cell (1,1): x 16 + 12 + 6 = 34, y 16 + 24 = 40
  assert.equal(artToPath(["▐"], 1, 1), "M34 40h6v12h-6zM34 52h6v12h-6z");
});

test("blank art compiles to an empty path", () => {
  assert.equal(artToPath([], 0, 0), "");
  assert.equal(artToPath(["   ", " "], 0, 0), "");
});

test("an unknown character is refused and named, wherever it appears", () => {
  const cases: [string[], string][] = [
    [["?"], "?"],
    [["██?"], "?"],
    [["█", "█░"], "░"],
    [["  "], " "],
  ];
  for (const [art, bad] of cases) {
    assert.throws(() => artToPath(art, 0, 0), (err) => named(err, bad), JSON.stringify(art));
  }
});

// Round trip: parse the path back into a bitmap of quadrant-sized cells and compare it with the
// bitmap the glyph table describes. This holds for any art, so it catches a wrong corner, a
// dropped or doubled rectangle, and an offset that drifts, without depending on a literal path.

type Rect = { x: number; y: number; w: number; h: number };

function parseRects(d: string): Rect[] {
  const found = [...d.matchAll(/M([\d.]+) ([\d.]+)h([\d.]+)v([\d.]+)h-([\d.]+)z/g)];
  assert.equal(found.map((m) => m[0]).join(""), d, "the path holds nothing but closed rectangles");
  return found.map((m) => {
    assert.equal(m[3], m[5], "a rectangle returns by the width it advanced");
    return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
  });
}

const ART = [
  "█▀▄▌▐ ▘▝",
  "▖▗▛▜▙▟▚▞",
  "▞▚▟▙▜▛▗▖",
  " █ ▐▌▄▀█",
];
const ORIGIN_COL = 3, ORIGIN_ROW = 2;
// x 16 + 3 * 12 = 52 and y 16 + 2 * 24 = 64
const X0 = 52, Y0 = 64;

test("the path paints exactly the quadrants the art describes, each once", () => {
  const quadOf = (ch: string): Quad => {
    const row = GLYPHS.find((g) => g[1] === ch);
    assert.ok(row, `test table lacks ${ch}`);
    return row[2];
  };
  const expected = ART.flatMap((line) =>
    [0, 1].map((half) => [...line].flatMap((ch) => {
      const q = quadOf(ch);
      return half === 0 ? [q[0], q[1]] : [q[2], q[3]];
    })),
  );

  const painted: boolean[][] = expected.map((r) => r.map(() => false));
  for (const r of parseRects(artToPath(ART, ORIGIN_COL, ORIGIN_ROW))) {
    const subRow = (r.y - Y0) / 12, subCol = (r.x - X0) / 6, span = r.w / 6;
    assert.equal(r.h, 12, "a rectangle is one half-row tall");
    assert.ok(Number.isInteger(subRow) && Number.isInteger(subCol) && Number.isInteger(span), "on the quadrant grid");
    for (let i = 0; i < span; i++) {
      assert.equal(painted[subRow]?.[subCol + i], false, `quadrant (${subRow},${subCol + i}) is off the art or painted twice`);
      painted[subRow][subCol + i] = true;
    }
  }
  assert.deepEqual(painted, expected);
});

test("no two rectangles on one half-row touch, so every run is as wide as it can be", () => {
  const byRow = new Map<number, Rect[]>();
  for (const r of parseRects(artToPath(ART, ORIGIN_COL, ORIGIN_ROW))) {
    byRow.set(r.y, [...(byRow.get(r.y) ?? []), r]);
  }
  assert.equal(byRow.size, ART.length * 2, "every half-row of this art has ink");
  for (const [y, rects] of byRow) {
    rects.sort((a, b) => a.x - b.x);
    rects.slice(1).forEach((r, i) => {
      assert.ok(r.x > rects[i].x + rects[i].w, `half-row at y ${y} has touching rectangles at x ${r.x}`);
    });
  }
});
