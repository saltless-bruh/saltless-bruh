import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { inkLeft, inkRight, loadGlyphs, parseGrid, runsOf, runsToPath, sharedInkLeft, sharedInkWidth } from "../src/pixelart.ts";

const SLEEP = new URL("../art/sleep.grid.txt", import.meta.url);
const GLYPHS = loadGlyphs(new URL("../art/palette.json", import.meta.url));

/** Pixels a compiled path covers, as "x,y" keys, decoded without using the module under test. */
function decode(d: string, size: number, originX = 0, originY = 0): Set<string> {
  assert.match(d, /^(M-?[\d.]+ -?[\d.]+h[\d.]+v[\d.]+h-[\d.]+z)*$/, "path is not a list of rectangles");
  const out = new Set<string>();
  for (const m of d.matchAll(/M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v([\d.]+)/g)) {
    const [x, y, w, h] = m.slice(1).map(Number);
    assert.equal(h, size, "every rect is one pixel tall");
    for (const v of [(x - originX) / size, (y - originY) / size, w / size]) assert.ok(Number.isInteger(v), `${m[0]} is off the pixel lattice`);
    for (let i = 0; i < w / size; i++) out.add(`${(x - originX) / size + i},${(y - originY) / size}`);
  }
  return out;
}

/** Pixels of one character, read straight off the rows. */
function pixelsOf(rows: string[], ch: string): Set<string> {
  const out = new Set<string>();
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === ch) out.add(`${x},${y}`); }));
  return out;
}

// ---------------------------------------------------------------------------------------------
// parseGrid: the grid is the source of truth, so a malformed one must fail loudly and say where
// ---------------------------------------------------------------------------------------------

test("a well-formed grid parses to its rows and dimensions", () => {
  const g = parseGrid("12 \n 21\n3  ", { name: "t.grid.txt", glyphs: "123", width: 3, height: 3 });
  assert.deepEqual(g.rows, ["12 ", " 21", "3  "]);
  assert.equal(g.width, 3);
  assert.equal(g.height, 3);
});

test("an unknown character throws, naming the character, its coordinates and the file", () => {
  // Break caught: a typo in a pose file silently becoming a transparent or wrong-coloured pixel.
  assert.throws(
    () => parseGrid("111\n1x1\n111", { name: "yawn.grid.txt", glyphs: "1", width: 3, height: 3 }),
    (e: Error) => /"x"/.test(e.message) && /\bx1\b/.test(e.message) && /\brow 1\b/.test(e.message) && /yawn\.grid\.txt/.test(e.message),
  );
  // Same character, different place: the coordinates must follow it, not be a constant.
  assert.throws(
    () => parseGrid("1111\n1111\n111z", { name: "t", glyphs: "1", width: 4, height: 3 }),
    (e: Error) => /"z"/.test(e.message) && /\bx3\b/.test(e.message) && /\brow 2\b/.test(e.message),
  );
});

test("a character that is in some palette but not this one is unknown, and a space is always allowed", () => {
  assert.throws(() => parseGrid("17", { name: "t", glyphs: "1", width: 2, height: 1 }), /"7"/);
  assert.doesNotThrow(() => parseGrid("1 ", { name: "t", glyphs: "1", width: 2, height: 1 }));
});

test("a carriage return is rejected as an unknown character instead of shifting the grid", () => {
  // A CRLF file must not be read as a grid that is one column wider.
  assert.throws(() => parseGrid("11\r\n11\r", { name: "t", glyphs: "1" }), /"\\r".*\bx2\b.*\brow 0\b/);
  // With a stated width the same file is also refused, by its width.
  assert.throws(() => parseGrid("11\r\n11\r", { name: "t", glyphs: "1", width: 2, height: 2 }), /row 0/);
});

test("wrong dimensions throw: a short row names its row, a missing row is counted", () => {
  assert.throws(() => parseGrid("111\n11\n111", { name: "t", glyphs: "1", width: 3, height: 3 }), /row 1\b.*2.*3/);
  assert.throws(() => parseGrid("111\n111", { name: "t", glyphs: "1", width: 3, height: 3 }), /expected 3 rows.*found 2/);
  assert.throws(() => parseGrid("111\n111\n111\n111", { name: "t", glyphs: "1", width: 3, height: 3 }), /expected 3 rows.*found 4/);
});

test("a grid that is wrong throughout is still wrong: uniformly too narrow or too short against the stated size", () => {
  // Break caught: checking every row against the FIRST row instead of the stated width, which a whole-file error satisfies.
  assert.throws(() => parseGrid("11\n11\n11", { name: "t", glyphs: "1", width: 3, height: 3 }), /row 0.*2.*3/);
  assert.throws(() => parseGrid("111\n111", { name: "t", glyphs: "1", width: 3, height: 3 }), /expected 3 rows/);
});

test("a palette key longer than one character is refused, naming it", () => {
  const dir = mkdtempSync(join(tmpdir(), "palette-"));
  try {
    writeFileSync(join(dir, "palette.json"), JSON.stringify({ "1": "#000000", "12": "#ffffff" }));
    assert.throws(() => loadGlyphs(pathToFileURL(join(dir, "palette.json"))), /"12"/);
    writeFileSync(join(dir, "ok.json"), JSON.stringify({ a: "#000000", b: "#ffffff" }));
    assert.equal(loadGlyphs(pathToFileURL(join(dir, "ok.json"))), "ab");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one trailing newline is tolerated, two are an extra row", () => {
  const rows = ["11", "11"];
  assert.deepEqual(parseGrid("11\n11\n", { name: "t", glyphs: "1", width: 2, height: 2 }).rows, rows);
  assert.throws(() => parseGrid("11\n11\n\n", { name: "t", glyphs: "1", width: 2, height: 2 }), /expected 2 rows/);
});

test("without stated dimensions the grid must still be rectangular", () => {
  assert.doesNotThrow(() => parseGrid("11\n11", { name: "t", glyphs: "1" }));
  assert.throws(() => parseGrid("11\n1", { name: "t", glyphs: "1" }), /row 1\b/);
});

test("the palette file yields exactly its single-character keys", () => {
  assert.deepEqual([...GLYPHS].sort(), ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
});

// ---------------------------------------------------------------------------------------------
// runsOf and runsToPath: horizontal merging, and the path that carries it
// ---------------------------------------------------------------------------------------------

test("runs are the maximal horizontal stretches of one character, row by row", () => {
  const rows = ["11 11", " 111 ", "1 1  "];
  assert.deepEqual(runsOf(rows, "1"), [
    { x: 0, y: 0, w: 2 }, { x: 3, y: 0, w: 2 },
    { x: 1, y: 1, w: 3 },
    { x: 0, y: 2, w: 1 }, { x: 2, y: 2, w: 1 },
  ]);
});

test("only the named characters take part, and a shape of several characters merges across them", () => {
  assert.deepEqual(runsOf(["1122"], "1"), [{ x: 0, y: 0, w: 2 }]);
  assert.deepEqual(runsOf(["1122"], "2"), [{ x: 2, y: 0, w: 2 }]);
  // A body drawn under its speckles is one shape: 2s and 4s join into a single run.
  assert.deepEqual(runsOf(["22442 2"], "24"), [{ x: 0, y: 0, w: 5 }, { x: 6, y: 0, w: 1 }]);
  assert.deepEqual(runsOf(["112"], "9"), []);
});

test("a run is cut at the edge of the box it is asked about, and rows outside it are skipped", () => {
  const rows = ["1111111", "1111111", "1111111"];
  assert.deepEqual(runsOf(rows, "1", { x0: 2, x1: 5, y0: 1, y1: 2 }), [{ x: 2, y: 1, w: 3 }]);
});

test("a run that touches the right edge of the grid is not lost", () => {
  assert.deepEqual(runsOf(["  11"], "1"), [{ x: 2, y: 0, w: 2 }]);
});

test("a path is one rectangle per run, one pixel tall, placed from its origin", () => {
  // Hand-derived: x = 16 + 1*6 = 22, y = 40 + 2*6 = 52, w = 3*6 = 18, h = 6.
  assert.equal(runsToPath([{ x: 1, y: 2, w: 3 }], 16, 40, 6), "M22 52h18v6h-18z");
  assert.equal(
    runsToPath([{ x: 0, y: 0, w: 1 }, { x: 4, y: 1, w: 2 }], 0, 0, 6),
    "M0 0h6v6h-6zM24 6h12v6h-12z",
  );
  assert.equal(runsToPath([], 16, 40, 6), "");
});

// ---------------------------------------------------------------------------------------------
// The real artwork: merging is lossless and maximal, not just plausible
// ---------------------------------------------------------------------------------------------

const sleepRows = readFileSync(SLEEP, "utf8").split("\n");

test("the sleep artwork is 818 pixels and merges to 240 runs, as measured independently", () => {
  let pixels = 0;
  let runs = 0;
  for (const ch of GLYPHS) {
    pixels += pixelsOf(sleepRows, ch).size;
    runs += runsOf(sleepRows, ch).length;
  }
  assert.equal(pixels, 818);
  assert.equal(runs, 240);
});

test("round trip: parsing the artwork and emitting each colour reproduces exactly its pixels", () => {
  // Break caught: a merge that drops, duplicates or shifts a pixel, or bleeds one character into another.
  const grid = parseGrid(readFileSync(SLEEP, "utf8"), { name: "sleep.grid.txt", glyphs: GLYPHS, width: 64, height: 28 });
  const seen = new Set<string>();
  for (const ch of GLYPHS) {
    const back = decode(runsToPath(runsOf(grid.rows, ch), 16, 32, 6), 6, 16, 32);
    assert.deepEqual([...back].sort(), [...pixelsOf(sleepRows, ch)].sort(), `character ${ch}`);
    for (const p of back) {
      assert.ok(!seen.has(p), `pixel ${p} is emitted for two characters`);
      seen.add(p);
    }
  }
  assert.equal(seen.size, 818);
});

test("no two runs of one character on one row touch, so every merge is maximal", () => {
  for (const ch of GLYPHS) {
    const runs = runsOf(sleepRows, ch);
    for (let i = 1; i < runs.length; i++) {
      const [a, b] = [runs[i - 1], runs[i]];
      if (a.y === b.y) assert.ok(b.x > a.x + a.w, `${ch}: runs at x${a.x} and x${b.x} on row ${a.y} should have merged`);
    }
  }
});

// A small deterministic generator, so the property below is the same on every run.
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("merging is lossless and maximal over 300 random grids, not only the one artwork", () => {
  const rand = lcg(20261001);
  for (let n = 0; n < 300; n++) {
    const w = 1 + Math.floor(rand() * 14);
    const h = 1 + Math.floor(rand() * 8);
    const rows = Array.from({ length: h }, () => Array.from({ length: w }, () => " 1234"[Math.floor(rand() * 5)]).join(""));
    for (const ch of "1234") {
      const runs = runsOf(rows, ch);
      const back = decode(runsToPath(runs, 6, 12, 6), 6, 6, 12);   // size 6, origin (6, 12)
      assert.deepEqual([...back].sort(), [...pixelsOf(rows, ch)].sort(), `grid ${n} char ${ch}\n${rows.join("\n")}`);
      assert.equal(back.size, runs.reduce((sum, r) => sum + r.w, 0), "runs never overlap");
      for (let i = 1; i < runs.length; i++) {
        if (runs[i].y === runs[i - 1].y) assert.ok(runs[i].x > runs[i - 1].x + runs[i - 1].w, `grid ${n}: unmerged neighbours`);
      }
    }
  }
});

// ---- placing artwork by its ink rather than by its grid -----------------------------------------

test("inkLeft is the leftmost painted column, whatever margin the artwork carries", () => {
  // The margin is a property of the art, so the answer has to move with it rather than be a number.
  for (const margin of [0, 1, 5, 10, 31]) {
    const rows = ["1", "11", " 1"].map((r) => " ".repeat(margin) + r);
    assert.equal(inkLeft(rows), margin, `margin ${margin}`);
  }
});

test("inkLeft reads every row, not just the first, and ignores rows that paint nothing", () => {
  // The topmost row of a sprite is rarely its widest; a first-row-only reading would be wrong here.
  assert.equal(inkLeft(["     1", "  1  1", "      "]), 2, "the second row reaches furthest left");
  assert.equal(inkLeft(["", "   1", ""]), 3, "blank rows contribute no edge");
  assert.equal(inkLeft(["     ", "1    "]), 0, "ink in the last row still sets the edge");
});

test("inkLeft counts any non-space character as ink, because the palette decides the colour", () => {
  // A grid is characters, not booleans: the transparent one is the space, and nothing else.
  for (const ch of "123456789") assert.equal(inkLeft(["   " + ch]), 3, `character ${ch} is ink`);
});

test("artwork that paints nothing has no left edge, and says so instead of answering 0", () => {
  // Answering 0 would place an empty sprite flush and hide the fact that it is empty.
  assert.throws(() => inkLeft([]), /paint nothing|no left edge/);
  assert.throws(() => inkLeft(["   ", "  "]), /paint nothing|no left edge/);
});

test("sharedInkLeft returns the edge every frame agrees on", () => {
  const frame = (name: string, margin: number) => ({ name, rows: ["1", " 1", "11"].map((r) => " ".repeat(margin) + r) });
  for (const margin of [0, 4, 10]) {
    assert.equal(sharedInkLeft([frame("a", margin), frame("b", margin), frame("c", margin)]), margin);
  }
  assert.equal(sharedInkLeft([frame("only", 7)]), 7, "one frame still has an edge");
});

test("sharedInkLeft refuses frames that disagree, and names the frame that broke it", () => {
  // The failure this prevents is a scene that slides sideways whenever the frame changes, which no
  // unit test of a single frame would catch and which reads on screen as the picture twitching.
  const frame = (name: string, margin: number) => ({ name, rows: [" ".repeat(margin) + "1"] });
  assert.throws(() => sharedInkLeft([frame("rest", 3), frame("drifted", 4)]), /drifted.*4.*rest.*3/s);
  assert.throws(() => sharedInkLeft([frame("rest", 3), frame("ok", 3), frame("late", 1)]), /late/);
  assert.throws(() => sharedInkLeft([]), /no grids|no left edge/);
});

test("inkRight is the rightmost painted column, and it reads every row", () => {
  // The counterpart of inkLeft, and deliberately not a shared edge: a tail that reaches further in
  // one frame than another is the art working, not a fault, so clearance takes a maximum.
  assert.equal(inkRight(["1", "11", "1  "]), 1, "the second row reaches furthest right");
  assert.equal(inkRight(["    1", "1", "  1"]), 4, "a row of trailing ink sets the edge");
  assert.equal(inkRight(["  1   ", "      "]), 2, "trailing spaces are not ink");
  assert.equal(inkRight(["", "   9", ""]), 3, "blank rows contribute no edge");
  for (const ch of "123456789") assert.equal(inkRight([ch + "  "]), 0, `character ${ch} is ink`);
  assert.throws(() => inkRight([]), /paint nothing|no right edge/);
  assert.throws(() => inkRight(["   ", "  "]), /paint nothing|no right edge/);
});

// ---------------------------------------------------------------------------------------------
// sharedInkWidth: the clearance anything beside a multi-frame scene has to leave
//
// WHY THESE FRAMES ARE SYNTHETIC. The Mascot's own poses all end at the same pixel, because an
// invariant in src/mascot.ts forces the rack identical across them and the rack is the widest part
// of the scene. Measured against the committed artwork, therefore, a maximum over the frames, a
// minimum over them and a lookup of any single frame all return the same number, and no test built
// on that artwork can tell the three apart. Frames that actually differ are the only way to pin
// which one the derivation takes, so they are built here rather than by retouching a pose.
// ---------------------------------------------------------------------------------------------

/** Frames sharing a left edge at `margin`, each reaching `right` pixels further. */
const frames = (margin: number, rights: number[]): { name: string; rows: string[] }[] =>
  rights.map((right, i) => ({
    name: `f${i}`,
    rows: [" ".repeat(margin) + "1".repeat(right - margin + 1)],
  }));

test("sharedInkWidth spans the shared left edge to the WIDEST frame's right edge", () => {
  // A minimum, or the first frame's own edge, clears whichever frame happens to be narrowest and is
  // then overlapped by every other one. Each order below puts the widest frame somewhere different,
  // so taking the first, the last or the narrowest is wrong in at least one of them.
  for (const rights of [[5, 9, 7], [9, 5, 7], [5, 7, 9]]) {
    assert.equal(sharedInkWidth(frames(2, rights)), 8, `widest of ${rights.join(", ")} from edge 2`);
  }
  assert.equal(sharedInkWidth(frames(0, [3, 3, 3])), 4, "frames that agree are their own width");
  assert.equal(sharedInkWidth(frames(6, [6])), 1, "one frame of one pixel is one pixel across");
});

test("sharedInkWidth counts both edges, so a clearance is never a column short", () => {
  // inkLeft and inkRight are both pixel INDICES, so the span between them is inclusive of each.
  // Dropping the +1 is invisible on wide artwork and silently overlaps by one column.
  for (const [margin, right] of [[0, 0], [0, 1], [3, 9], [10, 31]] as [number, number][]) {
    assert.equal(sharedInkWidth(frames(margin, [right])), right - margin + 1, `${margin} to ${right}`);
  }
});

test("sharedInkWidth is measured from the shared edge, so a drifted frame is refused not averaged", () => {
  // The left edge is what the scene is PLACED by, so disagreement there is an error rather than a
  // number to pick: a frame starting elsewhere would slide the picture sideways when it came up.
  const drifted = [{ name: "rest", rows: ["  111"] }, { name: "drifted", rows: ["   1111"] }];
  assert.throws(() => sharedInkWidth(drifted), /drifted/);
  assert.throws(() => sharedInkWidth([]), /no grids|no left edge/);
});

test("the Mascot's own poses cannot tell a maximum from a minimum, which is why the above is synthetic", () => {
  // The premise of the synthetic frames, measured rather than asserted in prose: every committed
  // pose ends at the same pixel today. If that ever stops being true this test fails, and the
  // artwork itself starts covering what only the frames above cover now.
  const poses = ["sleep", "yawn", "stretch", "settle", "peek", "alert", "glare", "recover"]
    .map((name) => ({ name, rows: readFileSync(new URL(`../art/${name}.grid.txt`, import.meta.url), "utf8").replace(/\n$/, "").split("\n") }));
  const edges = new Set(poses.map((p) => inkRight(p.rows)));
  assert.equal(edges.size, 1, `the poses now end at ${[...edges].join(", ")}, so the artwork can see the maximum itself`);
  assert.equal(sharedInkWidth(poses), inkRight(poses[0].rows) - sharedInkLeft(poses) + 1);
});
