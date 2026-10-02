import test from "node:test";
import assert from "node:assert/strict";
import { colX, rowBaselineY } from "../src/grid.ts";
import {
  rowWidth, assertFits, rowsToText, rowsToDrawnText, rowsToFullText, renderRows, charsUsed, esc,
} from "../src/rows.ts";
import type { Row, Run } from "../src/rows.ts";
import { assertNoForbiddenNames, assertRowsCarryNoForbiddenNames, FORBIDDEN_NAMES } from "../src/content.ts";

/** Built from the committed placeholder, so no name is written into this file (ADR 0001). */
const PLACEHOLDER = FORBIDDEN_NAMES[0];

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

test("a run laid part-way over another covers the cells it reaches, and nothing beyond them", () => {
  // Painting cell by cell is what makes a partial overlap read as the eye sees it. Appending
  // run text instead put the second run after the first, so "abcdef" plus "XY" at column 3
  // came out as "abcdefXY": a word the picture never shows, in the transcript the
  // forbidden-name scan reads.
  //
  // One index per cell is consistent with the rest of the row model because `cells` in
  // src/rows.ts counts code points too ([...s].length), which is what rowWidth and assertFits
  // measure with. This is a COLUMN model, not a display-width one, and must stay that way: in
  // the picture every cell is exactly CELL_W wide whatever glyph sits in it, so retrofitting
  // wcwidth here would move the text out of step with the art.
  assert.equal(rowsToText([{ runs: [{ col: 0, text: "abcdef" }, { col: 3, text: "XY" }] }]), "abcXYf");
  // the runs are sorted first, so the result does not depend on the order they were given in
  assert.equal(rowsToText([{ runs: [{ col: 3, text: "XY" }, { col: 0, text: "abcdef" }] }]), "abcXYf");
  // an overlap that reaches past the first run extends the row rather than being clipped
  assert.equal(rowsToText([{ runs: [{ col: 0, text: "abcdef" }, { col: 4, text: "XYZ" }] }]), "abcdXYZ");
  // one code point per cell: a character outside the BMP is one cell, overwritten whole
  assert.equal(rowWidth({ runs: [{ col: 0, text: `ab${CLEF}de` }] }), 5, "cells counts code points, not UTF-16 units");
  assert.equal(rowsToText([{ runs: [{ col: 0, text: `ab${CLEF}de` }, { col: 2, text: "X" }] }]), "abXde");
  assert.equal(rowsToText([{ runs: [{ col: 0, text: "abcde" }, { col: 2, text: CLEF }] }]), `ab${CLEF}de`);
});

// ---- text-only runs ----

test("a text-only run is read by the transcript and drawn by nothing", () => {
  const rows: Row[] = [{ runs: [{ col: 2, text: "ART", textOnly: true }, { col: 8, text: "ink" }] }];
  assert.equal(rowsToText(rows), "  ART   ink");
  const svg = renderRows(rows);
  assert.ok(svg.includes(">ink</tspan>"), "the drawn run is missing");
  assert.ok(!svg.includes("ART"), "the text-only run reached the picture");
  assert.equal([...svg.matchAll(/<tspan/g)].length, 1, "one tspan, for the drawn run only");
  assert.equal(charsUsed(rows), "ARTink", "the subset still covers words another layer may draw");
});

test("a row of nothing but text-only runs emits no element, unless it carries a row hook", () => {
  assert.equal(renderRows([{ runs: [{ col: 0, text: "ART", textOnly: true }] }]), "");
  assert.equal(
    renderRows([{ cls: "scan", runs: [{ col: 0, text: "ART", textOnly: true }] }]),
    `<text class="scan" y="${rowBaselineY(0)}" xml:space="preserve"></text>`,
    "a row the motion layer drives keeps its element even with nothing to draw",
  );
});

test("an empty row draws nothing, and the rows after it keep their own baselines", () => {
  assert.equal(renderRows([{ runs: [] }]), "");
  assert.equal(
    renderRows([{ runs: [] }, { runs: [{ col: 0, text: "a" }] }]),
    `<text y="${rowBaselineY(1)}" xml:space="preserve"><tspan x="${colX(0)}" class="text">a</tspan></text>`,
  );
});

test("a forbidden name carried by a text-only run is caught by the scan of the transcript", () => {
  // This is the point of the flag. Text the Session draws as art was invisible to rowsToText,
  // so the ADR 0001 gate could not see what the art spelled.
  const rows: Row[] = [{ runs: [{ col: 0, text: PLACEHOLDER, textOnly: true }] }];
  assert.equal(rowsToText(rows), PLACEHOLDER);
  assert.equal(renderRows(rows), "", "the name was drawn into the picture");
  assert.throws(() => assertNoForbiddenNames(rowsToText(rows), "the transcript"), /forbidden name/);
  const half = [...PLACEHOLDER].slice(0, 4).join("");
  assert.doesNotThrow(() => assertNoForbiddenNames(rowsToText([{ runs: [{ col: 0, text: half, textOnly: true }] }]), "the transcript"));
});

// ---- drawn-only runs ----

test("a drawn-only run is drawn, kept out of the transcript, and still occupies its columns", () => {
  const rows: Row[] = [{ runs: [{ col: 0, text: "ink" }, { col: 4, text: "POSE", drawOnly: true }] }];
  assert.equal(rowsToText(rows), "ink", "the transcript must not repeat a stacked variant");
  const svg = renderRows(rows);
  assert.ok(svg.includes(">POSE</tspan>"), "the drawn-only run was not drawn");
  assert.equal([...svg.matchAll(/<tspan/g)].length, 2);
  assert.equal(rowWidth(rows[0]), 8, "a drawn-only run still reaches its last column");
  assert.deepEqual([...charsUsed(rows)].sort(), [..."inkPOSE"].sort(), "its glyphs still need the subset");
});

test("the two faces of one row: the picture shows the variants, the transcript shows the word", () => {
  // What the motion layer will build on the spinner's row: one drawn verb per Mascot pose,
  // stacked at the same columns and revealed one at a time. Painting them all into one line of
  // text spells none of them, which is why the word the transcript says is carried separately.
  const rows: Row[] = [{ runs: [
    { col: 0, text: "✶", style: "accent" },
    { col: 2, text: "Loafing…", textOnly: true },
    { col: 2, text: "Loafing…", drawOnly: true, cls: "pose-sleep" },
    { col: 2, text: "Resettling…", drawOnly: true, cls: "pose-settle" },
  ] }];
  assert.equal(rowsToText(rows), "✶ Loafing…", "the transcript says one verb");
  assert.equal(rowsToDrawnText(rows), "✶ Resettling…", "painting the variants together spells only the last");
  const svg = renderRows(rows);
  assert.ok(svg.includes("pose-sleep") && svg.includes("pose-settle"), "both variants must be drawn");
  assert.equal([...svg.matchAll(/<tspan/g)].length, 3, "the text-only copy must not be drawn");

  // The same two faces where the runs do not overlap, so each projection is wrong on its own
  // terms if it keeps the other's runs rather than merely being hidden by an overlay.
  const split: Row[] = [{ runs: [{ col: 0, text: "ART", textOnly: true }, { col: 6, text: "ink", drawOnly: true }] }];
  assert.equal(rowsToText(split), "ART");
  assert.equal(rowsToDrawnText(split), "      ink");
});

// ---- the ADR 0001 gate reads the complete projection ----

test("the gate's projection takes every run, so neither flag can hide a name from it", () => {
  assert.ok(PLACEHOLDER && PLACEHOLDER.length > 2, "no committed placeholder to build the cases from");
  const cases: [string, Row[]][] = [
    ["a text-only run", [{ runs: [{ col: 0, text: PLACEHOLDER, textOnly: true }] }]],
    ["a drawn-only run", [{ runs: [{ col: 0, text: PLACEHOLDER, drawOnly: true }] }]],
    ["a run buried under a longer copy laid over it", [{ runs: [
      { col: 0, text: PLACEHOLDER },
      { col: 0, text: "x".repeat([...PLACEHOLDER].length + 4) },
    ] }]],
    ["a drawn-only run split into one per character, as the shimmer splits its word", [{
      runs: [...PLACEHOLDER].map((ch, i): Run => ({ col: i, text: ch, drawOnly: true })),
    }]],
  ];
  for (const [how, rows] of cases) {
    assert.throws(() => assertRowsCarryNoForbiddenNames(rows, "the Session"), /forbidden name/, how);
  }
  assert.doesNotThrow(
    () => assertRowsCarryNoForbiddenNames([{ runs: [{ col: 0, text: "nothing to see here" }] }], "the Session"),
    "clean rows must pass, or the gate is simply always throwing",
  );
});

test("the transcript alone cannot see a drawn-only run, which is the hole the projection closes", () => {
  const rows: Row[] = [{ runs: [{ col: 0, text: PLACEHOLDER, drawOnly: true }] }];
  assert.equal(rowsToText(rows), "", "the transcript would not show it");
  assert.doesNotThrow(() => assertNoForbiddenNames(rowsToText(rows), "the transcript"));
  assert.ok(rowsToFullText(rows).includes(PLACEHOLDER), "the complete projection must still carry it");
  assert.throws(() => assertNoForbiddenNames(rowsToFullText(rows), "the Session"), /forbidden name/);
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
