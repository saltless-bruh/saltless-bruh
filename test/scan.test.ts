import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarCells, levelOf, levelThresholds, levelAlpha, scanCss, scanDefs, scanX, scanY,
  BEAM_OVERHANG, BEAM_W, CELL, GAP, GRID_H, GRID_W, HIT_LEVELS, MAX_LEVEL, PITCH, SCAN_COL, SWEEP_SECONDS, WEEKS, DAYS,
} from "../src/scan.ts";
import type { ScanCell } from "../src/scan.ts";
import { SCAN_ROWS, SCAN_RESULT_CLASS, composeSession } from "../src/session.ts";
import type { Activity } from "../src/session.ts";
import { CANVAS_W, CELL_H, CELL_W, PAD } from "../src/grid.ts";
import { PALETTES } from "../src/tokens.ts";
import type { ThemeName } from "../src/tokens.ts";
import { MASTER_SECONDS } from "../src/timeline.ts";
import { loadContent } from "../src/content.ts";

// ---------------------------------------------------------------------------------------------
// Helpers. Everything reads the GENERATED svg and css, and recomputes what it expects from the
// grid constants and the calendar, never from the module's own tables.
// ---------------------------------------------------------------------------------------------

type Node = { tag: string; attrs: Record<string, string>; children: Node[] };

/** A small parser for the fragment scanDefs returns. Fails on unbalanced or multiply-rooted markup. */
function parseXml(src: string): Node {
  const stack: Node[] = [{ tag: "#root", attrs: {}, children: [] }];
  const tokens = src.matchAll(/<(\/?)([\w-]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g);
  for (const t of tokens) {
    const [, closing, tag, raw, selfClosing] = t;
    if (closing) {
      const open = stack.pop();
      assert.ok(open && open.tag === tag, `</${tag}> closes <${open?.tag}>`);
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of raw.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const node: Node = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  assert.equal(stack.length, 1, "unbalanced markup");
  assert.equal(stack[0].children.length, 1, "the fragment must have exactly one root element");
  return stack[0].children[0];
}

const walk = (n: Node): Node[] => [n, ...n.children.flatMap(walk)];
const classesOf = (n: Node): string[] => (n.attrs.class ?? "").split(/\s+/).filter(Boolean);
const find = (root: Node, cls: string): Node => {
  const hit = walk(root).find((n) => classesOf(n).includes(cls));
  assert.ok(hit, `no element has class ${cls}`);
  return hit;
};
const maybe = (root: Node, cls: string): Node | undefined => walk(root).find((n) => classesOf(n).includes(cls));

/** The squares a compiled path draws, as "x,y,w,h" in canvas units. */
function squares(d: string): { x: number; y: number; w: number; h: number }[] {
  assert.match(d, /^(M-?[\d.]+ -?[\d.]+h[\d.]+v[\d.]+h-[\d.]+z)*$/, "path data is not compiled rectangles");
  return [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v([\d.]+)h-([\d.]+)z/g)].map((m) => {
    const [x, y, w, h, back] = m.slice(1).map(Number);
    assert.equal(w, back, "a rectangle must close on the width it opened");
    return { x, y, w, h };
  });
}

/** The cell lattice position a square sits on, given the grid's origin. */
const atCell = (s: { x: number; y: number }, x0: number, y0: number): string => {
  const wk = (s.x - x0) / PITCH;
  const dy = (s.y - y0) / PITCH;
  assert.ok(Number.isInteger(wk) && Number.isInteger(dy), `square at ${s.x},${s.y} is off the cell lattice`);
  return `${wk},${dy}`;
};

// ---- the calendar, built here, never taken from the module --------------------------------------

const DAY_MS = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** A year of real consecutive days from `startIso`, with counts from `shape` repeated. */
function year(startIso: string, shape: number[], days = 365): Activity["calendar"] {
  const t0 = Date.parse(`${startIso}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => ({ date: iso(t0 + i * DAY_MS), count: shape[i % shape.length] }));
}

const SHAPE = [0, 0, 1, 3, 7, 0, 12, 2, 0, 24];
const calendar = year("2024-10-06", SHAPE);          // 2024-10-06 is a Sunday
const offSunday = year("2025-03-12", SHAPE);          // a Wednesday, so the first column is partial

const activityOf = (cal: Activity["calendar"]): Activity => ({
  totalContributions: cal.reduce((s, d) => s + d.count, 0),
  activeDays: cal.filter((d) => d.count > 0).length,
  calendar: cal,
  languages: [{ name: "TypeScript", bytes: 900 }, { name: "Rust", bytes: 100 }],
});

const activity = activityOf(calendar);
const THEMES: ThemeName[] = ["dark", "light"];
const ROW = 20;

const defs = (a: Activity = activity, theme: ThemeName = "dark", row = ROW): Node => parseXml(scanDefs(a, row, theme));

// ---------------------------------------------------------------------------------------------
// The geometry
// ---------------------------------------------------------------------------------------------

test("the grid is 53 week-columns by 7 day-rows on a 12-unit pitch, with square cells", () => {
  assert.equal(WEEKS, 53);
  assert.equal(DAYS, 7);
  assert.equal(PITCH, CELL_W, "one week is one grid column, so the pitch is the text cell's width");
  assert.equal(CELL, 10);
  assert.equal(GAP, 2);
  assert.equal(CELL + GAP, PITCH, "the cell and its gap must fill the pitch exactly");
  // Square is the point: the same pitch on both axes. A 12 x 24 cell would read as a bar chart.
  assert.equal(GRID_W, WEEKS * PITCH);
  assert.equal(GRID_H, DAYS * PITCH);
  assert.equal(GRID_W, 636);
  assert.equal(GRID_H, 84);
});

test("the grid fits the band it is given, with room for the beam's overhang at both ends", () => {
  const band = SCAN_ROWS * CELL_H;
  assert.equal(band, 96);
  assert.equal(GRID_H / CELL_H, 3.5, "three and a half rows of ink");
  const slack = band - GRID_H;
  assert.ok(slack >= 2 * BEAM_OVERHANG, `${slack} units of slack cannot hold a beam overhanging ${BEAM_OVERHANG} at each end`);
  // Split evenly, so the overhang does not reach into the row above or the result line below.
  assert.equal(scanY(ROW), PAD + ROW * CELL_H + slack / 2);
  const top = scanY(ROW) - BEAM_OVERHANG;
  const bottom = scanY(ROW) + GRID_H + BEAM_OVERHANG;
  assert.ok(top >= PAD + ROW * CELL_H, "the beam reaches above its own band");
  assert.ok(bottom <= PAD + (ROW + SCAN_ROWS) * CELL_H, "the beam reaches below its own band");
});

test("the grid starts on the column the result text starts on, and ends inside the window", () => {
  assert.equal(SCAN_COL, 5);
  assert.equal(scanX(), PAD + SCAN_COL * CELL_W);
  assert.equal(scanX(), 76);
  assert.ok(scanX() + GRID_W <= CANVAS_W - PAD, "the grid runs past the window's inner edge");
  assert.equal(scanX() + GRID_W, 712);
});

// ---------------------------------------------------------------------------------------------
// The data. Nothing here may be invented.
// ---------------------------------------------------------------------------------------------

test("every day of the calendar becomes one cell, at the week and weekday its date really falls on", () => {
  for (const cal of [calendar, offSunday]) {
    const cells = calendarCells(cal);
    assert.equal(cells.length, cal.length, "a day was dropped or a cell invented");
    // Recomputed from the dates themselves: day of week from the date, week from the distance to
    // the Sunday the first column starts on.
    const first = Date.parse(`${cal[0].date}T00:00:00Z`);
    const weekStart = first - new Date(first).getUTCDay() * DAY_MS;
    cal.forEach((d, i) => {
      const at = Date.parse(`${d.date}T00:00:00Z`);
      assert.equal(cells[i].day, new Date(at).getUTCDay(), `${d.date} is on the wrong day row`);
      assert.equal(cells[i].week, Math.floor((at - weekStart) / DAY_MS / DAYS), `${d.date} is in the wrong week column`);
      assert.equal(cells[i].count, d.count, "the cell lost its own count");
    });
    assert.ok(Math.max(...cells.map((c) => c.week)) < WEEKS, "the calendar needs more columns than the grid has");
  }
});

test("a 365-day window fills 53 columns whichever weekday it starts on, leaving the partial weeks empty", () => {
  // 371 lattice positions, 365 days: the first and last weeks are partial, exactly as GitHub draws
  // them. The empty positions are left empty rather than padded, because a cell with no day behind
  // it would be a host that is not there.
  for (let offset = 0; offset < 7; offset++) {
    const cal = year(iso(Date.parse("2025-01-05T00:00:00Z") + offset * DAY_MS), SHAPE);
    const cells = calendarCells(cal);
    const columns = new Set(cells.map((c) => c.week));
    assert.equal(columns.size, WEEKS, `starting on weekday ${offset} gave ${columns.size} columns`);
    assert.equal(cells.length, 365);
    assert.equal(WEEKS * DAYS - cells.length, 6, "371 positions less 365 days is 6 empty ones");
  }
});

test("a calendar that is empty, broken or longer than the grid fails loudly instead of drawing zeros", () => {
  // The spec's rule: a build with no real figures must fail, because a grid of zeros is a figure
  // nobody measured. Each of these is a different way the data could be wrong.
  assert.throws(() => calendarCells([]), /empty|nobody measured/i);
  assert.throws(() => calendarCells([{ date: "not-a-date", count: 1 }]), /YYYY-MM-DD/);
  assert.throws(() => calendarCells([{ date: "2025-13-45", count: 1 }]), /YYYY-MM-DD/);
  assert.throws(() => calendarCells([{ date: "2025-01-01", count: -1 }]), /whole number/);
  assert.throws(() => calendarCells([{ date: "2025-01-01", count: 1.5 }]), /whole number/);
  assert.throws(() => calendarCells([{ date: "2025-01-01", count: Number.NaN }]), /whole number/);
  // A gap would silently leave a hole in the network that looks like a quiet day.
  assert.throws(() => calendarCells([{ date: "2025-01-01", count: 1 }, { date: "2025-01-03", count: 1 }]), /consecutive/);
  // Newest first is the wrong order and would draw the year backwards.
  assert.throws(() => calendarCells([{ date: "2025-01-03", count: 1 }, { date: "2025-01-02", count: 1 }]), /consecutive/);
  // More than 53 weeks cannot be drawn in 53 columns.
  assert.throws(() => calendarCells(year("2024-01-07", SHAPE, 400)), /week 5[0-9]|longer than the window/);
});

test("levels come from the quartiles of the days that have any activity, not from the maximum", () => {
  // Recomputed here. A share-of-the-maximum rule would put every ordinary day in level 1 as soon
  // as one exceptional day appeared, and the grid would then report only that day.
  const counts = calendar.map((d) => d.count);
  const lit = counts.filter((c) => c > 0).sort((a, b) => a - b);
  const expected = [0.25, 0.5, 0.75].map((p) => lit[Math.min(lit.length - 1, Math.ceil(p * lit.length) - 1)]);
  assert.deepEqual(levelThresholds(counts), expected);

  // A count exactly on a quartile is the TOP of the band that quartile closes, because the
  // nearest-rank value is the last member of its quarter. Banding it upward instead would shift
  // a quarter of the lit days a level brighter than the data says.
  const t = levelThresholds(counts);
  assert.equal(t.length, 3);
  t.forEach((value, i) => {
    assert.equal(levelOf(value, t), i + 1, `a count of ${value} is exactly quartile ${i + 1} and belongs to its band`);
    assert.ok(levelOf(value + 1, t) > levelOf(value, t) || value + 1 > t[t.length - 1] && levelOf(value, t) === MAX_LEVEL,
      `one more than quartile ${i + 1} does not move up a band`);
  });

  const outlier = [...counts.slice(0, -1), 100_000];
  const before = levelOf(7, levelThresholds(counts));
  const after = levelOf(7, levelThresholds(outlier));
  assert.equal(before, after, "one huge day must not re-band every ordinary day");
});

test("level 0 is reserved for a day with no contributions, whatever the thresholds are", () => {
  for (const t of [[], [1, 2, 3], [0, 0, 0], [5, 50, 500]]) {
    assert.equal(levelOf(0, t), 0);
    assert.ok(levelOf(1, t) >= 1, "a day with a contribution is never silent");
  }
  assert.equal(levelOf(1, []), 1, "with no lit days to band, any activity is level 1");
});

test("levels stay inside the ramp the palette was measured for", () => {
  const thresholds = levelThresholds(calendar.map((d) => d.count));
  for (const c of calendarCells(calendar)) {
    assert.ok(Number.isInteger(c.level) && c.level >= 0 && c.level <= MAX_LEVEL, `level ${c.level} is outside 0..${MAX_LEVEL}`);
    assert.equal(c.level, levelOf(c.count, thresholds));
    assert.equal(c.level === 0, c.count === 0, "a silent cell and a day with no contributions must be the same thing");
  }
});

test("a busier day never reports a quieter level", () => {
  const thresholds = levelThresholds(calendar.map((d) => d.count));
  const sorted = [...new Set(calendar.map((d) => d.count))].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(levelOf(sorted[i], thresholds) >= levelOf(sorted[i - 1], thresholds), `${sorted[i]} reports less than ${sorted[i - 1]}`);
  }
});

// ---------------------------------------------------------------------------------------------
// The idea: before the beam every cell is identical, after it each reports its own level
// ---------------------------------------------------------------------------------------------

test("before the beam arrives every cell is identical: one paint, one alpha, no information", () => {
  // This is the whole effect. Without it the sweep is a heatmap with a line moving over it, and
  // the beam is decoration. A second paint in the unprobed layer would leak the answer early.
  for (const theme of THEMES) {
    const root = defs(activity, theme);
    const unprobed = find(root, "unprobed");
    assert.equal(unprobed.tag, "path", "the unprobed layer must be one merged path, not a rect per cell");
    const cells = calendarCells(calendar);
    const drawn = squares(unprobed.attrs.d);
    assert.equal(drawn.length, cells.length, "the unprobed layer must carry every cell and no others");
    for (const s of drawn) {
      assert.equal(s.w, CELL);
      assert.equal(s.h, CELL, "a cell ahead of the beam must be the same size as one behind it");
    }
    // One fill and one opacity for the whole layer: there is nothing to tell cells apart by.
    assert.equal(unprobed.attrs.fill, PALETTES[theme].border);
    assert.equal(unprobed.attrs["fill-opacity"], "0.3");
  }
});

test("the unprobed layer covers exactly the cells the probed layers do, so nothing appears or vanishes", () => {
  const root = defs();
  const x0 = scanX();
  const y0 = scanY(ROW);
  const before = new Set(squares(find(root, "unprobed").attrs.d).map((s) => atCell(s, x0, y0)));
  const after = new Set<string>();
  for (let level = 0; level <= MAX_LEVEL; level++) {
    const layer = maybe(find(root, "probed"), `lv${level}`);
    for (const s of layer ? squares(layer.attrs.d) : []) {
      const key = atCell(s, x0, y0);
      assert.ok(!after.has(key), `cell ${key} is painted at two levels at once`);
      after.add(key);
    }
  }
  assert.deepEqual([...before].sort(), [...after].sort(), "the grid changes shape when the beam passes");
  assert.equal(before.size, calendar.length);
});

test("after the beam each level is its own merged path, at the alpha the ramp gives it", () => {
  const cells = calendarCells(calendar);
  for (const theme of THEMES) {
    const probed = find(defs(activity, theme), "probed");
    for (let level = 0; level <= MAX_LEVEL; level++) {
      const want = cells.filter((c) => c.level === level);
      const layer = maybe(probed, `lv${level}`);
      if (want.length === 0) {
        assert.equal(layer, undefined, `lv${level} has no cells but is drawn anyway`);
        continue;
      }
      assert.ok(layer, `lv${level} has ${want.length} cells but is not drawn`);
      assert.equal(layer.tag, "path", `lv${level} must be one merged path`);
      assert.equal(squares(layer.attrs.d).length, want.length);
      // Level 0 is present but silent, in the same token as the unprobed state and a touch
      // stronger; the lit levels are the accent on the measured ramp.
      const p = PALETTES[theme];
      assert.equal(layer.attrs.fill, level === 0 ? p.border : p.accent);
      assert.equal(Number(layer.attrs["fill-opacity"]), level === 0 ? 0.45 : 0.35 + 0.65 * (level / 4));
    }
  }
});

test("the ramp rises with the level and spans the range the contract measured", () => {
  // Recomputed, not read from the module: a ramp that stopped rising would make two levels
  // indistinguishable and the grid would under-report a busy day.
  for (let level = 1; level <= MAX_LEVEL; level++) {
    assert.equal(levelAlpha(level), 0.35 + 0.65 * (level / 4));
    if (level > 1) assert.ok(levelAlpha(level) > levelAlpha(level - 1), `level ${level} is not brighter than ${level - 1}`);
  }
  assert.equal(levelAlpha(MAX_LEVEL), 1, "the top of the ramp is the accent at full");
  // Evenly spaced by construction, which is what makes it perceptually even over this palette.
  const steps = [2, 3, 4].map((l) => levelAlpha(l) - levelAlpha(l - 1));
  assert.ok(steps.every((s) => Math.abs(s - steps[0]) < 1e-9), "the ramp is not linear");
});

// ---------------------------------------------------------------------------------------------
// The beam, the trail and the hits
// ---------------------------------------------------------------------------------------------

test("the beam is a two-unit line that overhangs the grid at both ends, in the brightest token", () => {
  for (const theme of THEMES) {
    const beam = find(defs(activity, theme), "beam");
    assert.equal(beam.tag, "rect");
    assert.equal(Number(beam.attrs.width), BEAM_W);
    assert.equal(Number(beam.attrs.width), 2);
    assert.equal(BEAM_OVERHANG, 3);
    assert.ok(BEAM_OVERHANG > 0, "a beam flush with the grid does not read as passing over it");
    assert.equal(Number(beam.attrs.y), scanY(ROW) - BEAM_OVERHANG);
    assert.equal(Number(beam.attrs.height), GRID_H - GAP + 2 * BEAM_OVERHANG);
    // Measured against the cells rather than the constant: the line must stick out at both ends.
    const cellTop = scanY(ROW);
    const cellBottom = scanY(ROW) + GRID_H - GAP;
    assert.ok(Number(beam.attrs.y) < cellTop, "the beam does not overhang the top row");
    assert.ok(Number(beam.attrs.y) + Number(beam.attrs.height) > cellBottom, "the beam does not overhang the bottom row");
    assert.equal(beam.attrs.fill, PALETTES[theme].text);
    assert.equal(beam.attrs["fill-opacity"], "0.95");
  }
});

test("the beam sits in the gutter between two cells, so it never covers one", () => {
  // Which is why its stacking order does not matter, and why it reads as passing between hosts
  // rather than over them.
  const beam = find(defs(), "beam");
  const left = Number(beam.attrs.x) - scanX();
  assert.equal(left, CELL, "the beam must start where the cell ends");
  assert.equal(left + BEAM_W, PITCH, "the beam must end where the next cell begins");
});

test("the trail is one column wide, behind the beam, in the accent at its faintest", () => {
  for (const theme of THEMES) {
    const trail = find(defs(activity, theme), "trail");
    assert.equal(trail.tag, "rect");
    assert.equal(Number(trail.attrs.width), CELL, "the trail is the cell body the beam has just entered");
    assert.equal(Number(trail.attrs.x), scanX());
    assert.equal(trail.attrs.fill, PALETTES[theme].accent);
    assert.equal(trail.attrs["fill-opacity"], "0.22");
  }
});

test("the head is painted under the cells, so the trail brightens a hit instead of dulling it", () => {
  // Drawn last, the trail lay over the column it was crossing: a hit, the brightest thing in the
  // grid, came out tinted by the glow that is meant to announce it. A render caught this; the
  // order is pinned here so the obvious "beam on top" tidy-up fails loudly.
  const root = defs();
  const order = root.children.map((n) => classesOf(n)[0]);
  assert.deepEqual(order, ["head", "unprobed", "probed", "hits"]);
  assert.ok(order.indexOf("head") < order.indexOf("hits"), "the trail is painted over the hits");
});

test("the hits band carries the top two levels only, at full brightness", () => {
  const cells = calendarCells(calendar);
  const busiest = Math.max(...cells.map((c) => c.level));
  assert.equal(busiest, MAX_LEVEL, "this fixture has no level 4 day, so the test would prove nothing");
  for (const theme of THEMES) {
    const busy = find(defs(activity, theme), "busy");
    const want = cells.filter((c) => HIT_LEVELS.includes(c.level));
    assert.deepEqual(HIT_LEVELS, [3, 4]);
    assert.equal(squares(busy.attrs.d).length, want.length);
    assert.ok(want.length > 0 && want.length < cells.length, "a hit must be some days, not none and not all");
    assert.equal(busy.attrs["fill-opacity"], "1", "a hit is at full brightness or it is not a flare");
    // The accent at full IS level 4, so a hit painted in it would do nothing on the busiest day in
    // the grid. `text` is the only token brighter than the accent in either variant.
    assert.equal(busy.attrs.fill, PALETTES[theme].text);
    assert.notEqual(busy.attrs.fill, PALETTES[theme].accent);
  }
});

test("a hit is brighter than the settled level underneath it, in both variants", () => {
  // Measured here with WCAG relative luminance: if the flare were not brighter than the top of the
  // settled ramp it would be invisible on exactly the days it exists for.
  const lum = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const theme of THEMES) {
    const p = PALETTES[theme];
    const hit = lum(p.text);
    const settled = lum(p.accent);
    const bg = lum(p.bg);
    // Brighter in dark, darker in light: in both it is further from the window than the accent is.
    assert.ok(Math.abs(hit - bg) > Math.abs(settled - bg), `${theme}: a hit does not stand out past level ${MAX_LEVEL}`);
  }
});

// ---------------------------------------------------------------------------------------------
// The structure: geometry compiled to merged paths, and no references at all
// ---------------------------------------------------------------------------------------------

test("the sweep is merged paths, not 371 rectangles", () => {
  const root = defs();
  const rects = walk(root).filter((n) => n.tag === "rect");
  const paths = walk(root).filter((n) => n.tag === "path");
  assert.equal(rects.length, 2, "only the beam and its trail are rects; every cell layer is a path");
  assert.ok(paths.length <= MAX_LEVEL + 3, `${paths.length} paths; the cells must merge into one path per layer`);
  const drawn = paths.reduce((n, p) => n + squares(p.attrs.d).length, 0);
  assert.ok(drawn >= calendar.length, "fewer squares than days");
  assert.ok(walk(root).length < 20, `${walk(root).length} elements; the whole sweep should be about a dozen`);
});

test("the sweep defines no ids and references nothing, so no reference can fail to resolve", () => {
  // A url(#id) that resolves to nothing paints nothing and raises nothing, which is the failure
  // mode that renders as a blank space and passes every test of the path data. inset() is a CSS
  // function and needs no id, so the whole class stays out of the document.
  for (const theme of THEMES) {
    const out = scanDefs(activity, ROW, theme);
    assert.ok(!out.includes("url(#"), "the sweep references an id");
    assert.ok(!/\sid="/.test(out), "the sweep defines an id");
    assert.ok(!out.includes("<clipPath"), "the sweep uses a referenced clipPath instead of the inset function");
  }
  assert.ok(!scanCss().includes("url(#"), "the motion layer references an id");
});

test("the two themes differ, and each paints only with its own palette", () => {
  assert.notEqual(scanDefs(activity, ROW, "dark"), scanDefs(activity, ROW, "light"));
  for (const theme of THEMES) {
    const other = PALETTES[theme === "dark" ? "light" : "dark"];
    const fills = new Set(walk(defs(activity, theme)).flatMap((n) => (n.attrs.fill ? [n.attrs.fill] : [])));
    for (const fill of fills) {
      assert.ok(Object.values(PALETTES[theme]).includes(fill), `${theme} paints with ${fill}, which is not in its palette`);
      assert.ok(!Object.values(other).includes(fill) || Object.values(PALETTES[theme]).includes(fill), "cross-theme colour");
    }
  }
});

// ---------------------------------------------------------------------------------------------
// The motion
// ---------------------------------------------------------------------------------------------

const css = scanCss();

/** The stops of one @keyframes block, as [percentage, declarations]. */
function stopsOf(name: string): [number, string][] {
  const block = new RegExp(`@keyframes ${name}\\{(.*?)\\}\\n`, "s").exec(css + "\n")
    ?? new RegExp(`@keyframes ${name}\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`).exec(css);
  assert.ok(block, `no @keyframes ${name}`);
  return [...block[1].matchAll(/([\d.]+)%\{([^}]*)\}/g)].map((m) => [Number(m[1]), m[2]]);
}

const boundary = (k: number): number => scanX() + (k + 1) * PITCH;
const pct = (seconds: number): number => Number(((seconds / MASTER_SECONDS) * 100).toFixed(3));

test("the sweep crosses in 53 whole-column steps, once per master loop, never free-running", () => {
  // The widest moving element on the page does not get to loop on a short cycle: the spec budgets
  // perpetual motion, so this fires on load and then once per Mascot loop.
  for (const name of ["scan-ahead", "scan-reveal", "scan-hits", "scan-head"]) {
    const stops = stopsOf(name);
    assert.equal(stops.length, WEEKS + 1, `${name} has ${stops.length} stops; wanted one per column plus the settle`);
    stops.forEach(([at], k) => assert.equal(at, pct((k * SWEEP_SECONDS) / WEEKS), `${name} stop ${k} is at the wrong time`));
    assert.equal(stops[0][0], 0, `${name} does not start on load`);
    assert.equal(stops[WEEKS][0], pct(SWEEP_SECONDS), `${name} does not settle when the crossing ends`);
  }
  assert.equal(SWEEP_SECONDS, 2.5);
  assert.ok(SWEEP_SECONDS < MASTER_SECONDS / 10, "the crossing takes a large part of the loop, so it reads as free-running");
  for (const m of css.matchAll(/animation: ([\w-]+) ([\d.]+)s ([\w-]+) (\w+)/g)) {
    assert.equal(Number(m[2]), MASTER_SECONDS, `${m[1]} runs on its own clock instead of the master loop`);
    assert.equal(m[3], "step-end", `${m[1]} eases a stepped reveal, which fights crispEdges`);
    assert.equal(m[4], "infinite");
  }
});

test("every step clips to a whole column boundary, measured in canvas units from the viewport", () => {
  // The reveal advances exactly one column per step. Recomputed here from the grid's own origin.
  stopsOf("scan-reveal").slice(0, WEEKS).forEach(([, decl], k) => {
    assert.equal(decl.trim(), `clip-path: inset(0 ${CANVAS_W - boundary(k)}px 0 0) view-box`, `reveal step ${k}`);
  });
  stopsOf("scan-ahead").slice(0, WEEKS).forEach(([, decl], k) => {
    assert.equal(decl.trim(), `clip-path: inset(0 0 0 ${boundary(k)}px) view-box`, `dim step ${k}`);
  });
  // The first step reveals one column and the last reveals the lot.
  assert.equal(boundary(0) - scanX(), PITCH);
  assert.equal(boundary(WEEKS - 1) - scanX(), GRID_W);
});

test("the dim layer retreats exactly as the probed layer advances, so neither doubles the other", () => {
  // Two translucent layers stacked would composite to neither one's measured alpha: level 1 over
  // the unprobed dim is not the level 1 the ramp was measured at. They are complementary instead.
  const reveal = stopsOf("scan-reveal");
  const ahead = stopsOf("scan-ahead");
  for (let k = 0; k < WEEKS; k++) {
    const right = Number(/inset\(0 ([\d.]+)px 0 0\)/.exec(reveal[k][1])![1]);
    const left = Number(/inset\(0 0 0 ([\d.]+)px\)/.exec(ahead[k][1])![1]);
    assert.equal(left + right, CANVAS_W, `step ${k}: the two layers overlap or leave a gap`);
  }
});

test("the hits band is one column wide and travels with the beam", () => {
  stopsOf("scan-hits").slice(0, WEEKS).forEach(([, decl], k) => {
    const m = /inset\(0 ([\d.]+)px 0 ([\d.]+)px\)/.exec(decl);
    assert.ok(m, `hits step ${k} is not a two-sided inset`);
    const [right, left] = [Number(m[1]), Number(m[2])];
    assert.equal(CANVAS_W - right - left, PITCH, `hits step ${k} is not one column wide`);
    assert.equal(left, boundary(k) - PITCH, `hits step ${k} is not on the column the beam is crossing`);
  });
});

test("the beam steps a whole column at a time and is hidden at rest", () => {
  const stops = stopsOf("scan-head");
  stops.slice(0, WEEKS).forEach(([, decl], k) => {
    assert.match(decl, new RegExp(`transform: translateX\\(${k * PITCH}px\\)`), `head step ${k}`);
    assert.match(decl, /opacity:\s*1/, `head step ${k} is invisible`);
  });
  assert.match(stops[WEEKS][1], /opacity:\s*0/, "the beam is still on screen after the crossing");
  const last = Number(/translateX\((\d+)px\)/.exec(stops[WEEKS - 1][1])![1]);
  assert.equal(last, (WEEKS - 1) * PITCH, "the beam does not finish on the last column");
  assert.equal(last + CELL + BEAM_W, GRID_W, "the beam does not finish flush with the grid's right edge");
});

test("base css is the finished still frame, and every stop at the end of the crossing returns to it", () => {
  // Reduced motion collapses the whole motion layer with one rule, so whatever base says is what a
  // reduced-motion reader sees. It must therefore already be the finished picture.
  const baseOf = (sel: string): string => {
    const m = new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(m, `no base rule for ${sel}`);
    return m[1];
  };
  const settled = {
    ".sweep .unprobed": stopsOf("scan-ahead")[WEEKS][1],
    ".sweep .probed": stopsOf("scan-reveal")[WEEKS][1],
    ".sweep .hits": stopsOf("scan-hits")[WEEKS][1],
    ".sweep .head": stopsOf("scan-head")[WEEKS][1],
  };
  for (const [sel, end] of Object.entries(settled)) {
    const base = baseOf(sel).split(";").map((d) => d.trim()).filter((d) => d && !d.startsWith("animation"));
    assert.deepEqual(base, end.split(";").map((d) => d.trim()).filter(Boolean), `${sel}: base is not where the animation lands`);
  }
  // Which in words: fully probed, nothing dim left, no flare and no beam.
  assert.match(baseOf(".sweep .probed"), /inset\(0 184px 0 0\)/);
  assert.match(baseOf(".sweep .unprobed"), new RegExp(`inset\\(0 0 0 ${scanX() + GRID_W}px\\)`));
  assert.match(baseOf(".sweep .hits"), new RegExp(`inset\\(0 0 0 ${scanX() + GRID_W}px\\)`));
  assert.match(baseOf(".sweep .head"), /opacity:\s*0/);
});

test("the result line is present in base and arrives after the crossing, never before", () => {
  // tui-design's rule: a status colour is always paired with a word, so the grid is not finished
  // without its printed result. It animates away from a base where it is already there.
  const base = new RegExp(`\\.${SCAN_RESULT_CLASS}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(base, "the result line has no base rule");
  assert.match(base[1], /opacity:\s*1/, "the result line is not present in the still frame");
  const stops = stopsOf("scan-result");
  assert.deepEqual(stops.map(([at]) => at), [0, pct(SWEEP_SECONDS)]);
  assert.match(stops[0][1], /opacity:\s*0/, "the result line is readable before the scan that produced it");
  assert.match(stops[1][1], /opacity:\s*1/);
});

test("the result row the composition emits is the row the motion layer names", () => {
  // The hook has to be on the row, or the arrival animates nothing and the only sign is that the
  // line is simply always there.
  const c = loadContent();
  const s = composeSession(c, activity);
  const row = s.rows[s.scanRow + SCAN_ROWS];
  assert.equal(row.cls, SCAN_RESULT_CLASS, "the result line carries no hook for the sweep to drive");
  assert.ok(row.runs.some((r) => r.text.includes(c.activityLine.label)), "that row is not the result line");
  assert.ok(css.includes(`.${SCAN_RESULT_CLASS}`), "the motion layer does not name the row's hook");
});

test("only opacity, transform and the clip inset are animated", () => {
  // No layout properties, no filter, no mask: the spec bans all three outright.
  const declared = new Set<string>();
  for (const m of css.matchAll(/@keyframes [\w-]+\{(.*?)\}\s*(?=@keyframes|$)/gs)) {
    for (const d of m[1].matchAll(/([a-z-]+)\s*:/g)) declared.add(d[1]);
  }
  assert.deepEqual([...declared].sort(), ["clip-path", "opacity", "transform"]);
  for (const banned of ["filter", "mask", "width", "height", "left", "margin", "x:", "y:"]) {
    assert.ok(!css.includes(`${banned}:`), `the motion layer animates ${banned}`);
  }
});

test("the clip is measured against the viewport, not against whatever the layer happens to contain", () => {
  // A group's own box is the box of its contents, and the hits layer contains only the busy cells,
  // so its box moves with the owner's data. Against the viewport the reveal lands on the same
  // column whatever the year looked like.
  const insets = [...css.matchAll(/clip-path: inset\([^)]*\)(\s*view-box)?/g)];
  assert.ok(insets.length > 0);
  for (const m of insets) assert.ok(m[1], `an inset is measured against the wrong box: ${m[0]}`);
});

test("a quiet year and a busy year clip to the same columns, because the data cannot move the reveal", () => {
  // The regression this guards: insets computed from a layer's bounding box would shift when the
  // owner's calendar changed, and the beam would stop matching the reveal.
  const quiet = activityOf(year("2024-10-06", [0, 0, 0, 0, 0, 0, 0, 0, 0, 1]));
  const busy = activityOf(year("2024-10-06", [31, 2, 17, 44, 5, 60, 8, 23, 91, 4]));
  for (const a of [quiet, busy]) {
    assert.doesNotThrow(() => scanDefs(a, ROW, "dark"));
  }
  // scanCss takes no data at all, which is what makes that true by construction.
  assert.equal(scanCss(), css);
});

test("a year with no contributions at all still draws its days, all silent", () => {
  // Honest about an empty year: every real day is still a host on the network, it just reports
  // nothing. This is not the same as having no data, which fails the build instead.
  const empty = activityOf(year("2024-10-06", [0]));
  const root = defs(empty);
  assert.equal(squares(find(root, "unprobed").attrs.d).length, 365);
  assert.equal(squares(find(find(root, "probed"), "lv0").attrs.d).length, 365);
  for (let level = 1; level <= MAX_LEVEL; level++) {
    assert.equal(maybe(find(root, "probed"), `lv${level}`), undefined, `lv${level} is drawn for a year with no activity`);
  }
  assert.equal(maybe(root, "busy"), undefined, "an empty year has hits");
});

test("the sweep moves when the band moves, and only vertically", () => {
  const a = parseXml(scanDefs(activity, 10, "dark"));
  const b = parseXml(scanDefs(activity, 11, "dark"));
  const first = (n: Node): { x: number; y: number } => squares(find(n, "unprobed").attrs.d)[0];
  assert.equal(first(b).x, first(a).x, "a different band moved the grid sideways");
  assert.equal(first(b).y - first(a).y, CELL_H, "a different band did not move the grid down a row");
});
