import test from "node:test";
import assert from "node:assert/strict";
import { bannerArt, bannerPath, bannerWidthCols, BANNER_ROWS } from "../src/banner.ts";
import { artToPath, blockToQuads } from "../src/blockart.ts";

// Everything the banner can draw. Walking all of it, not just LAZIE, means a typo in the
// letterform of Q fails here instead of the day someone's handle contains a Q.
const SUPPORTED = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ- "];
const width = (s: string): number => [...s].length;
const widths = (rows: string[]): Set<number> => new Set(rows.map(width));

test("the banner is three rows tall, for every supported character and for a word", () => {
  assert.equal(BANNER_ROWS, 3);
  assert.equal(bannerArt("LAZIE").length, BANNER_ROWS);
  for (const ch of SUPPORTED) {
    assert.equal(bannerArt(ch).length, BANNER_ROWS, JSON.stringify(ch));
  }
});

test("every row of every glyph is the same width, so columns line up", () => {
  // Rows are not padded after the fact, so a glyph row that is a column short or long shows up
  // here instead of quietly shifting the letters that follow it.
  for (const ch of SUPPORTED) {
    assert.equal(widths(bannerArt(ch)).size, 1, `${JSON.stringify(ch)} has rows of different widths`);
  }
  const rows = bannerArt("LAZIE");
  assert.equal(widths(rows).size, 1);
  assert.equal(width(rows[0]), bannerWidthCols("LAZIE"));
});

test("the banner uses only characters the block compiler knows", () => {
  for (const ch of SUPPORTED) {
    for (const row of bannerArt(ch)) {
      for (const glyph of row) {
        assert.doesNotThrow(() => blockToQuads(glyph), `${JSON.stringify(ch)} uses ${JSON.stringify(glyph)}`);
      }
    }
  }
});

test("every letter has ink, and no two supported characters share a shape", () => {
  for (const ch of SUPPORTED.filter((c) => c !== " ")) {
    assert.ok(bannerArt(ch).join("").trim().length > 0, `${ch} is blank`);
  }
  const shapes = new Set(SUPPORTED.map((ch) => bannerArt(ch).join("\n")));
  assert.equal(shapes.size, SUPPORTED.length);
});

test("a word is its letters in order, one blank column apart", () => {
  for (const word of ["LAZIE", "ZIZ"]) {
    const letters = [...word].map((ch) => bannerArt(ch));
    const expected = Array.from({ length: BANNER_ROWS }, (_, r) => letters.map((l) => l[r]).join(" "));
    assert.deepEqual(bannerArt(word), expected, word);
    const lettersWidth = letters.reduce((sum, l) => sum + width(l[0]), 0);
    assert.equal(bannerWidthCols(word), lettersWidth + (word.length - 1), word);
  }
});

test("lowercase text draws the same letters", () => {
  assert.deepEqual(bannerArt("lazie"), bannerArt("LAZIE"));
});

test("an unsupported character is reported by name, not drawn as a gap", () => {
  for (const bad of ["#", "2", "?", "_"]) {
    assert.throws(
      () => bannerArt(`LA${bad}IE`),
      (err) => err instanceof Error && err.message.includes(bad),
      bad,
    );
  }
  assert.throws(() => bannerArt("LA#IE"), /#/);
});

test("bannerPath compiles the banner art placed at the requested cell", () => {
  const cases: [string, number, number][] = [["LAZIE", 0, 0], ["LAZIE", 3, 2], ["ZA", 7, 1]];
  for (const [text, col, row] of cases) {
    assert.equal(bannerPath(text, col, row), artToPath(bannerArt(text), col, row), `${text} at ${col},${row}`);
  }
  assert.notEqual(bannerPath("LAZIE", 0, 0), bannerPath("ZA", 0, 0));
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
