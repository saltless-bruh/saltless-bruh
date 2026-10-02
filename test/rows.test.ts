import test from "node:test";
import assert from "node:assert/strict";
import { colX, rowBaselineY } from "../src/grid.ts";
import { rowWidth, assertFits, rowsToText, renderRows, charsUsed, esc } from "../src/rows.ts";
import type { Row, Run } from "../src/rows.ts";

// U+1D11E lies outside the BMP: one cell on the grid, two UTF-16 code units in a JS string.
const CLEF = "\u{1D11E}";
// U+1D11F shares CLEF's high surrogate, so splitting by UTF-16 unit would tear the pair apart.
const CLEF_F = "\u{1D11F}";

/** A row holding one run of `len` characters starting at `col`. */
const row = (col: number, len: number): Row => ({ runs: [{ col, text: "x".repeat(len) }] });

// ---- rowWidth ----

test("row width is the furthest column a run reaches", () => {
  assert.equal(rowWidth({ runs: [{ col: 0, text: "ab" }, { col: 10, text: "xyz" }] }), 13);
});

test("row width ignores run order and which run happens to be last", () => {
  assert.equal(rowWidth({ runs: [{ col: 10, text: "xyz" }, { col: 0, text: "ab" }] }), 13);
  // the early long run reaches further than the late short one
  assert.equal(rowWidth({ runs: [{ col: 0, text: "abcdefgh" }, { col: 3, text: "x" }] }), 8);
});

test("an empty row is zero columns wide", () => {
  assert.equal(rowWidth({ runs: [] }), 0);
});

test("a character outside the BMP occupies one column, not two", () => {
  assert.equal(rowWidth({ runs: [{ col: 2, text: `a${CLEF}b` }] }), 5);
});

// ---- assertFits ----

test("a row of exactly 72 columns is allowed and 73 is rejected", () => {
  assert.doesNotThrow(() => assertFits([row(0, 72)]));
  assert.throws(() => assertFits([row(0, 73)]), /73 columns/);
});

test("the limit applies to where a run ends, not to how long it is", () => {
  assert.doesNotThrow(() => assertFits([row(71, 1)]));
  assert.throws(() => assertFits([row(72, 1)]), /73 columns/);
  assert.throws(() => assertFits([row(60, 20)]), /row 0 .*80 columns/);
  // two short runs whose combined reach is exactly the limit
  assert.doesNotThrow(() => assertFits([{ runs: [{ col: 0, text: "ab" }, { col: 70, text: "cd" }] }]));
});

test("the error names the offending row and shows its text, not its neighbours", () => {
  const offender: Row = { runs: [{ col: 0, text: "x".repeat(70) }, { col: 70, text: "END" }] };
  const rows = [row(0, 10), row(0, 20), offender, row(0, 5)];
  assert.throws(() => assertFits(rows), (e: Error) => {
    assert.match(e.message, /row 2 needs 73 columns/);
    assert.doesNotMatch(e.message, /row [013]\b/);
    assert.match(e.message, /END/);
    return true;
  });
});

// ---- rowsToText ----

test("the transcript pads runs to their column so the text matches the picture", () => {
  const text = rowsToText([{ runs: [{ col: 2, text: "ab" }, { col: 6, text: "cd" }] }]);
  assert.equal(text, "  ab  cd");
  assert.equal(text.indexOf("cd"), 6, "a run at column 6 starts at character index 6");
});

test("the transcript places runs by column whatever order they were given in", () => {
  const runs: Run[] = [{ col: 6, text: "cd" }, { col: 2, text: "ab" }];
  assert.equal(rowsToText([{ runs }]), "  ab  cd");
  assert.deepEqual(runs.map((r) => r.col), [6, 2], "the caller's runs are not reordered");
});

test("the transcript has one line per row, keeps empty rows, trims trailing space only", () => {
  const text = rowsToText([
    { runs: [{ col: 0, text: "a" }] },
    { runs: [] },
    { runs: [{ col: 3, text: "b   " }] },
  ]);
  assert.equal(text, "a\n\n   b");
});

test("the transcript pads by columns, so a character outside the BMP counts once", () => {
  const text = rowsToText([{ runs: [{ col: 0, text: CLEF }, { col: 3, text: "x" }] }]);
  assert.equal([...text].indexOf("x"), 3);
  assert.equal([...text].length, 4);
});

test("runs that cover the same cells are written once, as when a copy is laid over a word", () => {
  // The Statusline draws a word twice at one position, a base copy and a highlight copy
  // split by character. The transcript must read the word once, not twice.
  const word = "shimmer";
  const runs: Run[] = [
    { col: 4, text: word, style: "muted" },
    ...[...word].map((ch, i): Run => ({ col: 4 + i, text: ch, style: "accent", cls: `shimmer-${i}` })),
    { col: 12, text: "on" },
  ];
  assert.equal(rowsToText([{ runs }]), "    shimmer on");
});

test("an overlapping run writes onto cells, so it is counted in columns and the rest of the row stays put", () => {
  const text = rowsToText([{ runs: [{ col: 1, text: `a${CLEF}b` }, { col: 2, text: CLEF }, { col: 5, text: "z" }] }]);
  assert.deepEqual([...text], [" ", "a", CLEF, "b", " ", "z"]);
});

// ---- esc and renderRows ----

test("esc replaces ampersand, less-than, greater-than and double quote, every occurrence", () => {
  assert.equal(esc(`a&b<c>"d"`), "a&amp;b&lt;c&gt;&quot;d&quot;");
  assert.equal(esc("&&<<>>\"\""), "&amp;&amp;&lt;&lt;&gt;&gt;&quot;&quot;");
  assert.equal(esc("&lt;"), "&amp;lt;", "an ampersand is escaped before the entities it introduces");
  assert.equal(esc("plain text 123"), "plain text 123");
});

test("markup special characters are escaped, not injected", () => {
  const svg = renderRows([{ runs: [{ col: 0, text: `a&b<c>"d"` }] }]);
  assert.equal(
    svg,
    `<text y="${rowBaselineY(0)}" xml:space="preserve">`
      + `<tspan x="${colX(0)}" class="text">a&amp;b&lt;c&gt;&quot;d&quot;</tspan></text>`,
  );
  assert.ok(!svg.includes("<c>"));
  const hostile = renderRows([{ runs: [{ col: 0, text: "<script>&</script>" }] }]);
  assert.ok(!hostile.includes("<script"));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;)/.test(hostile), "every ampersand starts a known entity");
});

test("each row sits on its own baseline and each run on its own column", () => {
  const out = renderRows([
    { runs: [{ col: 0, text: "a" }] },
    { runs: [{ col: 5, text: "b" }, { col: 71, text: "c" }] },
    { runs: [{ col: 40, text: "d" }] },
  ]);
  assert.equal(out, [
    `<text y="${rowBaselineY(0)}" xml:space="preserve"><tspan x="${colX(0)}" class="text">a</tspan></text>`,
    `<text y="${rowBaselineY(1)}" xml:space="preserve"><tspan x="${colX(5)}" class="text">b</tspan>`
      + `<tspan x="${colX(71)}" class="text">c</tspan></text>`,
    `<text y="${rowBaselineY(2)}" xml:space="preserve"><tspan x="${colX(40)}" class="text">d</tspan></text>`,
  ].join("\n"));
  assert.equal(renderRows([]), "");
});

test("a run's class is its style, then its hook, defaulting to text", () => {
  const cls = (run: Run) => /<tspan x="[\d.]+" class="([^"]*)"/.exec(renderRows([{ runs: [run] }]))?.[1];
  assert.equal(cls({ col: 0, text: "a" }), "text");
  assert.equal(cls({ col: 0, text: "a", cls: "spin" }), "text spin");
  assert.equal(cls({ col: 0, text: "a", style: "accent", cls: "spin" }), "accent spin");
  for (const style of ["text", "muted", "accent", "warning", "error", "bold"] as const) {
    assert.equal(cls({ col: 0, text: "a", style }), style);
  }
});

test("a row hook lands on the text element and only when one is given", () => {
  const tspan = `<tspan x="${colX(0)}" class="text">a</tspan>`;
  assert.equal(
    renderRows([{ cls: "scan", runs: [{ col: 0, text: "a" }] }]),
    `<text class="scan" y="${rowBaselineY(0)}" xml:space="preserve">${tspan}</text>`,
  );
  assert.ok(!/<text[^>]*class=/.test(renderRows([{ runs: [{ col: 0, text: "a" }] }])));
});

test("runs are emitted in column order and the caller's runs are left alone", () => {
  const runs: Run[] = [{ col: 9, text: "z" }, { col: 1, text: "a" }, { col: 4, text: "m" }];
  const xs = [...renderRows([{ runs }]).matchAll(/<tspan x="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(xs, [colX(1), colX(4), colX(9)]);
  assert.deepEqual(runs.map((r) => r.col), [9, 1, 4]);
});

// ---- charsUsed ----

test("charsUsed lists every distinct character across all runs and rows once", () => {
  const rows: Row[] = [
    { runs: [{ col: 0, text: "a b" }, { col: 9, text: "cb" }] },
    { runs: [{ col: 0, text: "dea" }] },
  ];
  const used = charsUsed(rows);
  assert.equal([...used].sort().join(""), " abcde");
  assert.equal([...used].length, 6, "no character appears twice");
});

test("charsUsed keeps characters outside the BMP whole and is empty for no rows", () => {
  const used = charsUsed([{ runs: [{ col: 0, text: `a${CLEF}${CLEF_F}${CLEF}` }] }]);
  assert.deepEqual([...used].sort(), ["a", CLEF, CLEF_F].sort());
  assert.equal(used.length, 1 + 2 + 2, "no lone surrogate was left behind");
  assert.equal(charsUsed([]), "");
});
