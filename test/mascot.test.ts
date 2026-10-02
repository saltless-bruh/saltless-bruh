import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { subsetToBase64 } from "../src/font.ts";
import { buildSvg } from "../src/svg.ts";
import { CELL_H, CELL_W, PAD } from "../src/grid.ts";
import { PALETTES } from "../src/tokens.ts";
import type { Palette, ThemeName } from "../src/tokens.ts";
import { MASCOT_TIMELINE, MASTER_SECONDS } from "../src/timeline.ts";
import type { PoseName } from "../src/timeline.ts";
import { MASCOT_COLS, MASCOT_ROWS, mascotCss, mascotDefs } from "../src/mascot.ts";

// ---------------------------------------------------------------------------------------------
// Helpers. Everything below reads the GENERATED output (the real svg, css and path data) and the
// grid files directly, never the module's own tables, so a wrong implementation cannot satisfy a
// test by agreeing with itself.
// ---------------------------------------------------------------------------------------------

const regularB64 = await subsetToBase64(readFileSync(new URL("../vendor/JetBrainsMono-Regular.ttf", import.meta.url)), "x");
const boldB64 = await subsetToBase64(readFileSync(new URL("../vendor/JetBrainsMono-Bold.ttf", import.meta.url)), "x");

/** The mascot inside the real document assembler, the way the build embeds it. */
const fullSvg = (theme: ThemeName): Promise<string> =>
  buildSvg({
    rows: Array.from({ length: MASCOT_ROWS }, () => ({ runs: [] })),
    theme, title: "mascot", fontRegularB64: regularB64, fontBoldB64: boldB64,
    defs: mascotDefs(0, 0, theme), css: mascotCss(),
  });

const styleOf = (svg: string): string => {
  const m = svg.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(m, "document has a <style> element");
  return m[1];
};

// ---- CSS -------------------------------------------------------------------------------------

type Block = { prelude: string; body: string };

/** Top-level `prelude { body }` blocks of a stylesheet, or of the inside of a block. */
function blocks(css: string): Block[] {
  const out: Block[] = [];
  let depth = 0;
  let start = 0;
  let bodyStart = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (css[i] === "}") {
      depth--;
      assert.ok(depth >= 0, "unbalanced braces in css");
      if (depth === 0) {
        out.push({ prelude: css.slice(start, bodyStart - 1).trim(), body: css.slice(bodyStart, i) });
        start = i + 1;
      }
    }
  }
  assert.equal(depth, 0, "unbalanced braces in css");
  return out;
}

function decls(body: string): Record<string, string> {
  return Object.fromEntries(
    body.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(":");
      return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
    }),
  );
}

type Rule = { selectors: string[]; decls: Record<string, string> };
const styleRules = (css: string): Rule[] =>
  blocks(css).filter((b) => !b.prelude.startsWith("@"))
    .map((b) => ({ selectors: b.prelude.split(",").map((s) => s.trim()), decls: decls(b.body) }));

type Stop = { seconds: number; opacity: number };
type Keyframes = { name: string; stops: { at: string; decls: Record<string, string> }[] };
const keyframesOf = (css: string): Keyframes[] =>
  blocks(css).filter((b) => b.prelude.startsWith("@keyframes")).map((b) => ({
    name: b.prelude.replace("@keyframes", "").trim(),
    stops: blocks(b.body).map((s) => ({ at: s.prelude, decls: decls(s.body) })),
  }));

type Anim = { cls: string; name: string; seconds: number; timing: string; iterations: string };
/** Every `.class { animation: name Ns timing iterations }` rule, split into its parts. */
function animationsOf(css: string): Anim[] {
  const out: Anim[] = [];
  for (const rule of styleRules(css)) {
    const value = rule.decls.animation;
    if (value === undefined) continue;
    const m = value.match(/^([\w-]+)\s+([\d.]+)s\s+(\S+)\s+(\S+)$/);
    assert.ok(m, `animation shorthand not understood: ${value}`);
    for (const sel of rule.selectors) {
      assert.match(sel, /^\.[\w-]+$/, `animation applied through a non-class selector: ${sel}`);
      out.push({ cls: sel.slice(1), name: m[1], seconds: Number(m[2]), timing: m[3], iterations: m[4] });
    }
  }
  return out;
}

/**
 * A layer's keyframe stops, timed in seconds into ITS OWN cycle and sorted. Everything that measures how long a gesture
 * lasts goes through here, so a gesture written as a share of a cycle shows up as the wrong number of milliseconds the
 * moment two cycles differ in length.
 */
function stopsOf(css: string, cls: string): { seconds: number; decls: Record<string, string> }[] {
  const anim = animationsOf(css).find((a) => a.cls === cls);
  assert.ok(anim, `no animation rule for .${cls}`);
  assert.equal(anim.timing, "step-end", "the samplers below assume frames cut, not blend");
  const kf = keyframesOf(css).find((k) => k.name === anim.name);
  assert.ok(kf, `no @keyframes ${anim.name}`);
  return kf.stops.map((s) => {
    const m = s.at.match(/^([\d.]+)%$/);
    assert.ok(m, `keyframe stop ${s.at}`);
    return { seconds: (Number(m[1]) / 100) * anim.seconds, decls: s.decls };
  }).sort((a, b) => a.seconds - b.seconds);
}

/** The cycle length of a layer's animation, in seconds. */
const cycleSeconds = (css: string, cls: string): number => {
  const anim = animationsOf(css).find((a) => a.cls === cls);
  assert.ok(anim, `no animation rule for .${cls}`);
  return anim.seconds;
};

/** Milliseconds per cycle that `test` holds true, with step-end: a stop's value lasts until the next one. */
function heldMs(css: string, cls: string, holds: (decls: Record<string, string>) => boolean): number {
  const stops = stopsOf(css, cls);
  const period = cycleSeconds(css, cls);
  let total = 0;
  stops.forEach((stop, i) => {
    if (holds(stop.decls)) total += (i + 1 < stops.length ? stops[i + 1].seconds : period) - stop.seconds;
  });
  return total * 1000;
}

/** Milliseconds a layer is fully opaque per cycle. */
const litMs = (css: string, cls: string): number => heldMs(css, cls, (d) => Number(d.opacity) === 1);
/** How far into its own cycle a layer first becomes fully opaque, in milliseconds. */
function firstLitMs(css: string, cls: string): number {
  const stop = stopsOf(css, cls).find((s) => Number(s.decls.opacity) === 1);
  assert.ok(stop, `.${cls} is never fully lit`);
  return stop.seconds * 1000;
}
/** Milliseconds a layer spends away from rest per cycle. */
const awayMs = (css: string, cls: string): number =>
  heldMs(css, cls, (d) => [...(d.transform ?? "").matchAll(/translate[XY]\((-?[\d.]+)(?:px)?\)/g)].some((m) => Number(m[1]) !== 0));

/** How far a layer translates along `axis`, in SVG units, at the furthest stop. */
function translateOf(css: string, cls: string, axis: "X" | "Y"): number {
  let furthest = 0;
  for (const stop of stopsOf(css, cls)) {
    for (const m of (stop.decls.transform ?? "").matchAll(new RegExp(`translate${axis}\\((-?[\\d.]+)(?:px)?\\)`, "g"))) {
      if (Math.abs(Number(m[1])) > Math.abs(furthest)) furthest = Number(m[1]);
    }
  }
  return furthest;
}

/** Computed value of `prop` for an element carrying these classes, from the NON-animation rules. */
function baseValue(css: string, classes: string[], prop: string): string | undefined {
  let value: string | undefined;
  for (const rule of styleRules(css)) {
    for (const sel of rule.selectors) {
      // Every selector in play is a lone class, so specificity ties and the later rule wins.
      if (/^\.[\w-]+$/.test(sel) && classes.includes(sel.slice(1)) && prop in rule.decls) value = rule.decls[prop];
    }
  }
  return value;
}

// ---- Markup ----------------------------------------------------------------------------------

type Node = { tag: string; attrs: Record<string, string>; children: Node[] };

/** A tiny parser for the fragment mascotDefs returns. Fails on unbalanced or multiply-rooted markup. */
function parseXml(src: string): Node {
  const root: Node = { tag: "#root", attrs: {}, children: [] };
  const stack: Node[] = [root];
  for (const m of src.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, closing, tag, rest, selfClosing] = m;
    if (closing) {
      assert.equal(stack.pop()?.tag, tag, `mismatched </${tag}>`);
      continue;
    }
    const attrs = Object.fromEntries([...rest.matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    const node: Node = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  assert.equal(stack.length, 1, "unclosed tag in mascot defs");
  assert.equal(root.children.length, 1, "mascot defs must have one root");
  return root.children[0];
}

const classesOf = (n: Node): string[] => (n.attrs.class ?? "").split(/\s+/).filter(Boolean);
const walk = (n: Node): Node[] => [n, ...n.children.flatMap(walk)];

// ---- Geometry: a path is rectangles on the art-pixel lattice -----------------------------------

const PX = CELL_W / 2;   // one art pixel, in units
const GRID_W = 64;
const GRID_H = 28;
const RACK_FROM = 11;
const ART = new URL("../art/", import.meta.url);

/** "x,y" keys of the art pixels a compiled path covers, with pixel (0, 0) at (PAD, PAD). */
function pixels(d: string): Set<string> {
  assert.match(d, /^(M[\d.]+ [\d.]+h[\d.]+v[\d.]+h-[\d.]+z)*$/, "path data is not compiler rectangles");
  const out = new Set<string>();
  for (const m of d.matchAll(/M([\d.]+) ([\d.]+)h([\d.]+)v([\d.]+)/g)) {
    const [x, y, w, h] = m.slice(1).map(Number);
    assert.equal(h, PX, `rect ${m[0]} is not one art pixel tall`);
    const [px, py, pw] = [(x - PAD) / PX, (y - PAD) / PX, w / PX];
    for (const v of [px, py, pw]) assert.ok(Number.isInteger(v), `rect ${m[0]} is off the pixel lattice`);
    for (let i = 0; i < pw; i++) out.add(`${px + i},${py}`);
  }
  return out;
}

const xy = (p: string): [number, number] => {
  const [x, y] = p.split(",").map(Number);
  return [x, y];
};

/**
 * The rectangles a compiled path draws, in SVG units rather than art pixels. The animated translates are a fraction of
 * an art pixel, so anything measuring what a move does has to work at this resolution.
 */
function rects(d: string): { x: number; y: number; w: number }[] {
  assert.match(d, /^(M[\d.]+ [\d.]+h[\d.]+v[\d.]+h-[\d.]+z)*$/, "path data is not compiler rectangles");
  return [...d.matchAll(/M([\d.]+) ([\d.]+)h([\d.]+)v([\d.]+)/g)].map((m) => {
    const [x, y, w, h] = m.slice(1).map(Number);
    assert.equal(h, PX, `rect ${m[0]} is not one art pixel tall`);
    return { x, y, w };
  });
}

type Span = [number, number];

/** Total length these intervals cover, overlaps counted once. */
function coveredLength(spans: Span[]): number {
  let total = 0;
  let end = -Infinity;
  for (const [from, to] of [...spans].sort((a, b) => a[0] - b[0])) {
    total += Math.max(0, to - Math.max(from, end));
    end = Math.max(end, to);
  }
  return total;
}

type Ink = Map<string, string>;   // pixel -> fill

const pathsUnder = (n: Node, skip: string[] = []): Node[] =>
  n.tag === "path" ? [n] : n.children.filter((c) => !skip.some((s) => classesOf(c).includes(s))).flatMap((c) => pathsUnder(c, skip));

/** Paints the paths under these nodes in document order, later paths over earlier ones. */
function inkOf(nodes: Node[], skip: string[] = []): Ink {
  const ink: Ink = new Map();
  for (const n of nodes) for (const path of pathsUnder(n, skip)) for (const p of pixels(path.attrs.d)) ink.set(p, path.attrs.fill);
  return ink;
}

const find = (root: Node, cls: string): Node => {
  const hit = walk(root).find((n) => classesOf(n).includes(cls));
  assert.ok(hit, `no element has class ${cls}`);
  return hit;
};

const states = (): string[] => [...new Set(MASCOT_TIMELINE.map((w) => w.state))];
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

// ---- The artwork, read independently of the module ----------------------------------------------

const readGrid = (name: string): string[] => readFileSync(new URL(`${name}.grid.txt`, ART), "utf8").replace(/\n$/, "").split("\n");
const OLD_COLOURS: string[] = Object.values(JSON.parse(readFileSync(new URL("palette.json", ART), "utf8")));

/** The recolour table, copied from the art direction, not from the module. */
const TOKEN: Record<string, keyof Palette> = {
  "1": "muted", "2": "text", "3": "bg", "4": "accent", "5": "surface", "6": "accent", "7": "muted", "8": "border", "9": "border",
};
/**
 * Amended after review. The art direction sends `3` to `bg`, which is right for the eyes (a hole in the cat) but
 * dissolved the rack: its panel is `surface`, which sits at 1.06:1 to 1.15:1 from the window, so nothing was left to draw
 * its outline. In the rack rows the `3` lines are the frame (the outer edge and the lines between units) and are drawn in `border`.
 */
const colourOf = (ch: string, p: Palette, y: number): string => (ch === " " ? p.bg : ch === "3" && y >= RACK_FROM ? p.border : p[TOKEN[ch]]);

// ---- Contrast (WCAG 2.x relative luminance), computed here, not by the module -------------------

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// ---------------------------------------------------------------------------------------------
// The footprint
// ---------------------------------------------------------------------------------------------

test("the scene is 32 columns by 7 rows, because one art pixel is exactly 6 units square", () => {
  assert.equal(PX, 6);
  assert.equal(CELL_H / 4, PX, "an art pixel is half a column wide and a quarter of a row tall, so it is square");
  assert.equal(MASCOT_COLS, 32);
  assert.equal(MASCOT_ROWS, 7);
  assert.equal(MASCOT_COLS * CELL_W, GRID_W * PX, "384 units across");
  assert.equal(MASCOT_ROWS * CELL_H, GRID_H * PX, "168 units down");
  // Every rectangle in the output is one art pixel tall and on the lattice (pixels() asserts both).
  for (const theme of ["dark", "light"] as const) {
    const root = parseXml(mascotDefs(0, 0, theme));
    for (const path of walk(root).filter((n) => n.tag === "path")) {
      for (const p of pixels(path.attrs.d)) {
        const [x, y] = xy(p);
        assert.ok(x >= 0 && x < GRID_W && y >= 0 && y < GRID_H, `${path.attrs.class} has ink outside the 64 x 28 scene at ${p}`);
      }
    }
  }
});

test("the plinth reaches the bottom of the scene, so the constants describe real art", () => {
  const rows = [...inkOf([find(parseXml(mascotDefs(0, 0, "dark")), "rack")]).keys()].map((p) => xy(p)[1]);
  assert.equal(Math.max(...rows) + 1, GRID_H);
  assert.equal(Math.min(...rows), RACK_FROM, "the rack's first painted row is its frame's top line");
});

// ---------------------------------------------------------------------------------------------
// Poses, and the recolour
// ---------------------------------------------------------------------------------------------

test("every pose the timeline names has a drawn group, and no group is a pose the timeline never shows", () => {
  const root = parseXml(mascotDefs(0, 0, "dark"));
  const drawn = walk(root).flatMap(classesOf).filter((c) => /^pose-/.test(c)).sort();
  assert.deepEqual(drawn, states().map((s) => `pose-${s}`).sort());
  for (const state of states()) assert.ok(inkOf([find(root, `pose-${state}`)]).size > 0, `pose-${state} draws nothing: a gap in the loop`);
});

test("each pose is its grid file recoloured by the art direction's table, pixel for pixel, in both themes", () => {
  // Break caught: a wrong token for a character, a pixel dropped or moved by merging, a character painted under
  // another colour, a pose drawn from the wrong file, or the rack missing. Every one of the 64 x 28 pixels is checked.
  for (const theme of ["dark", "light"] as const) {
    const p = PALETTES[theme];
    const root = parseXml(mascotDefs(0, 0, theme));
    for (const state of states()) {
      const rows = readGrid(state);
      const ink = inkOf([find(root, `pose-${state}`), find(root, "rack")]);   // document order: the rack is painted last
      for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
        assert.equal(ink.get(`${x},${y}`) ?? p.bg, colourOf(rows[y][x], p, y), `${theme} ${state} x${x} row ${y} (grid character ${JSON.stringify(rows[y][x])})`);
      }
    }
  }
});

test("no colour from the old phosphor palette survives, and every fill is a token of the theme asked for", () => {
  for (const theme of ["dark", "light"] as const) {
    const out = (mascotDefs(0, 0, theme) + mascotCss()).toLowerCase();
    for (const old of OLD_COLOURS) assert.ok(!out.includes(old.toLowerCase()), `${theme}: old colour ${old} is still in the output`);
    const fills = new Set(walk(parseXml(mascotDefs(0, 0, theme))).flatMap((n) => (n.attrs.fill ? [n.attrs.fill] : [])));
    for (const f of fills) assert.ok(Object.values(PALETTES[theme]).includes(f), `${theme}: fill ${f} is not a palette token`);
  }
  assert.notEqual(mascotDefs(0, 0, "dark"), mascotDefs(0, 0, "light"), "the two themes must differ");
});

test("the rack is emitted once and shared: no pose carries a rack row, and the rack carries no cat row", () => {
  for (const theme of ["dark", "light"] as const) {
    const root = parseXml(mascotDefs(0, 0, theme));
    assert.equal(walk(root).filter((n) => classesOf(n).includes("rack")).length, 1, "exactly one rack group");
    for (const state of states()) {
      for (const p of inkOf([find(root, `pose-${state}`)], ["foot"]).keys()) assert.ok(xy(p)[1] < RACK_FROM, `pose-${state} paints rack row ${xy(p)[1]}`);
    }
    for (const p of inkOf([find(root, "rack")]).keys()) assert.ok(xy(p)[1] >= RACK_FROM, `the rack paints cat row ${xy(p)[1]}`);
  }
});

test("poses are distinct drawings, so none is a copy of another", () => {
  const root = parseXml(mascotDefs(0, 0, "dark"));
  const drawings = states().map((s) => JSON.stringify([...inkOf([find(root, `pose-${s}`)])].sort()));
  assert.equal(new Set(drawings).size, states().length);
});

test("the cat reads against the rack: text on surface, measured from the generated drawing, in both themes", () => {
  // Measured on the pair that is actually drawn next to each other (the cat's body path and the rack's panel path), not on
  // the tokens in the abstract. The previous art failed this at 1.13:1 in light mode.
  for (const theme of ["dark", "light"] as const) {
    const root = parseXml(mascotDefs(0, 0, theme));
    const body = pathsUnder(find(root, "pose-sleep")).find((n) => n.attrs.class === "body");
    const panel = pathsUnder(find(root, "rack")).find((n) => n.attrs.class === "panel");
    assert.ok(body && panel, "the sleeping body and the rack panel are both drawn");
    const ratio = contrast(body.attrs.fill, panel.attrs.fill);
    assert.ok(ratio >= 4.5, `${theme}: cat on rack is only ${ratio.toFixed(2)}:1`);
    // And each is read against the window it sits on, not only against the other.
    assert.ok(contrast(body.attrs.fill, PALETTES[theme].bg) >= 4.5, `${theme}: cat on window`);
  }
});

test("the cat touches only the rack's frame line, never its panel, in every pose", () => {
  // The first thing under any part of the cat is the frame (border), or the cat floats clear above it.
  for (const theme of ["dark", "light"] as const) {
    const root = parseXml(mascotDefs(0, 0, theme));
    const rack = inkOf([find(root, "rack")]);
    const rackPixels = [...rack.keys()].map(xy);
    for (const state of states()) {
      for (const p of inkOf([find(root, `pose-${state}`)], ["foot"]).keys()) {
        const [x, y] = xy(p);
        const below = rackPixels.filter(([rx, ry]) => rx === x && ry > y).map(([, ry]) => ry);
        if (below.length === 0) continue;
        const first = `${x},${Math.min(...below)}`;
        assert.equal(rack.get(first), PALETTES[theme].border, `${theme} pose-${state}: under the cat at ${p} the rack starts with ${rack.get(first)}, not its frame`);
      }
    }
  }
});

test("the rack's outer edge is its border-coloured frame, so a panel close to the window still has a silhouette", () => {
  // Break caught: the frame dissolving back into holes, which left a panel 1.06:1 from the window and bars floating in space.
  for (const theme of ["dark", "light"] as const) {
    const p = PALETTES[theme];
    const rack = find(parseXml(mascotDefs(0, 0, theme)), "rack");
    const body = inkOf([rack], ["plinth"]);   // everything but the plinth, which is the base the rack stands on
    const edge = [...body.keys()].filter((k) => {
      const [x, y] = xy(k);
      return [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`].some((n) => !body.has(n));
    });
    assert.ok(edge.length > 100, `${theme}: only ${edge.length} edge pixels`);
    for (const k of edge) assert.equal(body.get(k), p.border, `${theme}: the rack's edge at ${k} is ${body.get(k)}, not the frame`);
    // The ring is closed: every pixel of the outline's bounding rectangle is frame.
    const all = [...body.keys()].map(xy);
    const [x0, x1] = [Math.min(...all.map(([x]) => x)), Math.max(...all.map(([x]) => x))];
    const [y0, y1] = [Math.min(...all.map(([, y]) => y)), Math.max(...all.map(([, y]) => y))];
    for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) assert.equal(body.get(`${x},${y}`), p.border, `${theme}: gap in the top or bottom edge at x${x} row ${y}`);
    for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) assert.equal(body.get(`${x},${y}`), p.border, `${theme}: gap in the side edge at x${x} row ${y}`);
  }
});

test("the same frame runs between the stacked units, on the lines the source grid already has", () => {
  const rows = readGrid("sleep");
  const dividers = rows.map((r, y) => y).filter((y) => y >= RACK_FROM && /^ *3+ *$/.test(rows[y]));
  assert.equal(dividers.length, 4, "a top line, two lines between three units, and a bottom line");
  for (const theme of ["dark", "light"] as const) {
    const ink = inkOf([find(parseXml(mascotDefs(0, 0, theme)), "rack")]);
    for (const y of dividers) {
      const xs = [...rows[y]].map((c, x) => (c === "3" ? x : -1)).filter((x) => x >= 0);
      for (const x of xs) assert.equal(ink.get(`${x},${y}`), PALETTES[theme].border, `${theme}: divider row ${y} is not frame at x${x}`);
    }
    // Between two dividers the unit is panel, so the lines really separate three units and are not the whole rack.
    for (let k = 0; k < dividers.length - 1; k++) {
      const y = dividers[k] + 1;
      const x = rows[y].indexOf("5");
      assert.ok(x >= 0, `unit ${k} has panel`);
      assert.equal(ink.get(`${x},${y}`), PALETTES[theme].surface, `${theme}: unit ${k} is not panel at x${x} row ${y}`);
    }
  }
});

test("the frame is clearly visible against the window and against the panel, measured from the drawing", () => {
  // The panel is 1.06:1 to 1.15:1 from the window, so it cannot carry its own edge; the frame must. Measured: against the
  // window 2.79:1 dark and 2.92:1 light, against the panel 2.44:1 and 2.75:1.
  for (const theme of ["dark", "light"] as const) {
    const rack = find(parseXml(mascotDefs(0, 0, theme)), "rack");
    const frame = pathsUnder(rack).find((n) => n.attrs.class === "frame");
    const panel = pathsUnder(rack).find((n) => n.attrs.class === "panel");
    assert.ok(frame && panel, "the rack has a frame and a panel");
    assert.ok(contrast(frame.attrs.fill, PALETTES[theme].bg) >= 2.5, `${theme}: frame on window ${contrast(frame.attrs.fill, PALETTES[theme].bg).toFixed(2)}:1`);
    assert.ok(contrast(frame.attrs.fill, panel.attrs.fill) >= 2.3, `${theme}: frame on panel ${contrast(frame.attrs.fill, panel.attrs.fill).toFixed(2)}:1`);
    assert.ok(contrast(panel.attrs.fill, PALETTES[theme].bg) < 1.2, "the premise: the panel alone is nearly the window's colour");
  }
});

test("the plinth keeps its own weight: one pixel row, exactly the grid's base line", () => {
  const rows = readGrid("sleep");
  const base = new Set<string>();
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === "9") base.add(`${x},${y}`); }));
  const root = parseXml(mascotDefs(0, 0, "dark"));
  const plinth = pathsUnder(find(root, "rack")).filter((n) => n.attrs.class === "plinth").flatMap((n) => [...pixels(n.attrs.d)]);
  assert.deepEqual(plinth.sort(), [...base].sort());
  assert.equal(new Set(plinth.map((q) => xy(q)[1])).size, 1, "a single row");
});

test("a cat resting on the frame has its feet continued under the frame line, so the breath cannot open a slit", () => {
  // Measured when the frame was added: with the cat touching it, holding the breath lifted left a one-pixel strip of
  // background under all 20 columns of its feet at 8 of 11 widths tried. The continuation is hidden under the frame at rest.
  for (const theme of ["dark", "light"] as const) {
    const root = parseXml(mascotDefs(0, 0, theme));
    const rack = inkOf([find(root, "rack")]);
    for (const state of states()) {
      const pose = find(root, `pose-${state}`);
      const cat = inkOf([pose], ["foot"]);
      const bottom = Math.max(...[...cat.keys()].map((k) => xy(k)[1]));
      const foot = walk(pose).filter((n) => classesOf(n).includes("foot"));
      if (bottom === RACK_FROM - 1) {
        assert.equal(foot.length, 1, `pose-${state} rests on the frame and needs its feet continued`);
        const expected = new Map([...cat].filter(([k]) => xy(k)[1] === bottom).map(([k, fill]) => [`${xy(k)[0]},${bottom + 1}`, fill]));
        assert.deepEqual([...inkOf(foot)].sort(), [...expected].sort(), `pose-${state}: the feet continue the cat's bottom row, in its colours`);
        for (const k of expected.keys()) assert.equal(rack.get(k), PALETTES[theme].border, `pose-${state}: ${k} would show, it is not under the frame line`);
      } else {
        assert.equal(foot.length, 0, `pose-${state} floats clear of the frame, so there is nothing to continue`);
      }
    }
  }
});

test("the rack is painted after the cat, so its frame line covers the continued feet", () => {
  const order = walk(parseXml(mascotDefs(0, 0, "dark")));
  const breath = order.findIndex((n) => classesOf(n).includes("breath"));
  const lastInBreath = breath + walk(order[breath]).length - 1;
  assert.ok(order.findIndex((n) => classesOf(n).includes("rack")) > lastInBreath, "the rack must come after everything that breathes");
});

/** The paths the pose paints itself, with the animated overlays and the hidden foot continuation left out. */
const staticInk = (pose: Node): Ink => inkOf([pose], ["ear", "tail", "foot"]);
/** One animated overlay group inside a pose. */
const overlayInk = (pose: Node, part: string): Ink => inkOf(walk(pose).filter((n) => classesOf(n).includes(part)));

test("the ear stretches: its overlay is a second copy of the slab, so the lift extends the tip and leaves the base on the head", () => {
  // The ear's double paint is correct and this test exists to keep it. The `.ear` group is the slab drawn again, and
  // the flick lifts that copy; unioned with the static one the ear stretches, welded to the head at its base. Cut the
  // slab out of the static pass (the tempting "do not paint it twice" cleanup) and the lift carries the whole ear away
  // instead, opening a strip of window under it. Both halves of that are asserted: the second copy exists, and it is
  // load-bearing because the head really does carry ink directly beneath the slab.
  for (const theme of ["dark", "light"] as const) {
    const root = parseXml(mascotDefs(0, 0, theme));
    for (const state of states()) {
      const pose = find(root, `pose-${state}`);
      const base = staticInk(pose);
      const ear = overlayInk(pose, "ear");
      assert.ok(ear.size > 0, `pose-${state} has no ear ink to move`);
      for (const [p, fill] of ear) {
        assert.equal(base.get(p), fill, `pose-${state}: the static pass does not paint ear pixel ${p}, so the flick would lift the ear off the head instead of stretching it`);
      }
    }
  }
  // Read from the grid files: which poses have painted ink immediately below the ear slab, where a lifted-away ear
  // would show window. '3' is a hole on purpose (the eye) and a space is the window, so neither counts as ink.
  const attached = states().filter((state) => {
    const rows = readGrid(state).slice(0, RACK_FROM);
    const tip = rows.findIndex((r) => /[24]/.test(r.slice(29, 31)));
    assert.ok(tip >= 0, `${state}: no ear in columns 29 and 30`);
    const below = rows[tip + 2];
    return below !== undefined && [29, 30].some((x) => "124".includes(below[x]));
  });
  assert.deepEqual(attached.sort(), ["settle", "sleep", "startle", "stretch"], "four poses need the static copy; only yawn breaks its own silhouette under the ear");
  // The lift is a whole art pixel now, so the slab needs a lattice row above it to extend into. A tip drawn on row 0
  // would be carried off the top of the scene and the stretch would lose its point.
  const css = mascotCss();
  const lift = -translateOf(css, "ear", "Y") / PX;
  assert.ok(Number.isInteger(lift) && lift > 0, `the ear lifts ${lift} art pixels, which is not a whole lattice step upward`);
  for (const state of states()) {
    const rows = readGrid(state).slice(0, RACK_FROM);
    const tip = rows.findIndex((r) => /[24]/.test(r.slice(29, 31)));
    assert.ok(tip >= lift, `pose-${state}: the ear tip is on row ${tip} and the flick lifts it ${lift}, so it would leave the scene`);
  }
});

test("the tail displaces: the static pass leaves its pixels to the .tail group alone, so the flick moves it and never thickens it", () => {
  // The defect this pins: the tail was painted twice, once statically and once in the `.tail` group, so its sideways
  // flick showed both positions at once and the tail read as swelling rather than moving. The group must hold the only
  // copy. Measured in units rather than art pixels, because the translate is a fraction of one.
  const css = mascotCss();
  const dx = translateOf(css, "tail", "X");
  assert.notEqual(dx, 0, "the tail must actually move");
  for (const theme of ["dark", "light"] as const) {
    const root = parseXml(mascotDefs(0, 0, theme));
    for (const state of states()) {
      const pose = find(root, `pose-${state}`);
      const base = staticInk(pose);
      const tail = overlayInk(pose, "tail");
      assert.ok(tail.size > 0, `pose-${state} has no tail ink to move`);
      for (const p of tail.keys()) {
        assert.ok(!base.has(p), `pose-${state}: ${p} is painted by the static pass as well as the .tail group, so a flick shows both positions at once`);
      }
      // Nothing was dropped by cutting the tail out: the two passes together are still the whole cat.
      const whole = inkOf([pose], ["foot"]);
      assert.deepEqual([...new Map([...base, ...tail])].sort(), [...whole].sort(), `pose-${state}: the static pass plus the tail is not the whole cat`);
      // The flick is a displacement: the cat covers exactly as much of every row at the flick as it does at rest.
      const bars = (shift: number): Map<number, number> => {
        const byRow = new Map<number, Span[]>();
        const add = (nodes: Node[], by: number): void => {
          for (const n of nodes) for (const r of rects(n.attrs.d)) byRow.set(r.y, [...(byRow.get(r.y) ?? []), [r.x + by, r.x + r.w + by]]);
        };
        add(pathsUnder(pose, ["tail", "foot"]), 0);
        add(walk(pose).filter((n) => classesOf(n).includes("tail")).flatMap((n) => pathsUnder(n)), shift);
        return new Map([...byRow].map(([y, spans]) => [y, coveredLength(spans)]));
      };
      assert.deepEqual([...bars(dx)].sort(), [...bars(0)].sort(), `pose-${state}: the tail flick changes how much ink a row carries, so it swells instead of moving`);
    }
  }
});

test("the tail is drawn detached from the body in every pose, at rest and a whole pixel along, so the slide cannot tear or collide", () => {
  // The `.tail` group is the only copy of its pixels and it slides a whole art pixel in X. That is safe only while no
  // other cat ink touches it, at EITHER end of the slide: something touching it at rest tears when it leaves, and
  // something touching the place it lands collides with it there. An art edit that joined the tail to the body would
  // break one or the other, so both are asserted from the artwork rather than left as a comment. The tail's own pixels
  // come from the real drawing and the ink oracle from the grid files; the foot continuation is excluded because the
  // frame line covers it. The slide distance is read off the real keyframes and converted to lattice steps.
  const css = mascotCss();
  const step = translateOf(css, "tail", "X") / PX;
  assert.ok(Number.isInteger(step) && step !== 0, `the tail slides ${step} art pixels, which is not a whole lattice step`);
  const root = parseXml(mascotDefs(0, 0, "dark"));
  for (const state of states()) {
    const rows = readGrid(state).slice(0, RACK_FROM);
    const resting = [...overlayInk(find(root, `pose-${state}`), "tail").keys()].map(xy);
    assert.ok(resting.length > 0, `pose-${state} has no tail`);
    // The body is every painted pixel that is not the tail: the pixels the tail rests on are its own, and it vacates
    // them when it slides, so counting them as body would report a tear against the tail's own starting position.
    const own = new Set(resting.map(([x, y]) => `${x},${y}`));
    const ink = (x: number, y: number): boolean =>
      y >= 0 && y < RACK_FROM && x >= 0 && x < GRID_W && "124".includes(rows[y][x]) && !own.has(`${x},${y}`);
    for (const [where, shift] of [["at rest", 0], ["a whole pixel along", step]] as [string, number][]) {
      const tail = new Set(resting.map(([x, y]) => `${x + shift},${y}`));
      for (const p of tail) {
        const [x, y] = xy(p);
        assert.ok(x >= 0 && x < GRID_W, `pose-${state}: the tail slides off the scene to ${p}`);
        // Ink the tail no longer covers at this position belongs to the body, and must not be touching it.
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1], [x, y]] as [number, number][]) {
          if (tail.has(`${nx},${ny}`)) continue;
          assert.ok(!ink(nx, ny), `pose-${state} ${where}: the tail at ${p} meets cat ink at ${nx},${ny}, so the slide ${nx === x && ny === y ? "lands on top of the body" : "tears the sprite there"}`);
        }
      }
    }
  }
});

test("a colour drawn over another sits on a shape that already covers it, so no two paths meet on a bare edge", () => {
  // Separate paths that merely touch can show a hairline at a fractional scale. Speckles are drawn over the whole body,
  // and vents and LEDs over the whole rack panel, so there is always something under them.
  const root = parseXml(mascotDefs(0, 0, "dark"));
  const cls = (n: Node, c: string): Node[] => pathsUnder(n).filter((q) => q.attrs.class === c);
  const covered = (over: Node[], under: Node[], what: string): void => {
    const base = new Set(under.flatMap((q) => [...pixels(q.attrs.d)]));
    for (const q of over) for (const p of pixels(q.attrs.d)) assert.ok(base.has(p), `${what}: ${p} has nothing under it`);
  };
  for (const state of states()) {
    const pose = find(root, `pose-${state}`);
    covered(cls(pose, "detail"), cls(pose, "body"), `pose-${state} speckles on body`);
  }
  const rack = find(root, "rack");
  const panel = cls(rack, "panel");
  assert.equal(panel.length, 1);
  covered([...cls(rack, "frame"), ...cls(rack, "vent"), ...cls(rack, "led-dim"), ...walk(rack).filter((n) => classesOf(n).includes("led"))], panel, "rack frame and details on panel");
});

test("the ear and tail are small, cat-coloured parts: neither carries the zZz or a catchlight", () => {
  for (const theme of ["dark", "light"] as const) {
    const p = PALETTES[theme];
    const root = parseXml(mascotDefs(0, 0, theme));
    for (const state of states()) {
      for (const part of ["ear", "tail"]) {
        const overlay = inkOf(walk(find(root, `pose-${state}`)).filter((n) => classesOf(n).includes(part)));
        assert.ok(overlay.size >= 1 && overlay.size <= 10, `pose-${state} ${part} has ${overlay.size} pixels`);
        for (const f of overlay.values()) assert.ok(f === p.text || f === p.accent, `pose-${state} ${part} carries a ${f} pixel`);
      }
    }
  }
});

test("the ear layer holds the right ear's tip, and the tail layer is exactly the ink at the far end of the body", () => {
  const root = parseXml(mascotDefs(0, 0, "dark"));
  for (const state of states()) {
    const rows = readGrid(state).slice(0, RACK_FROM);
    const pose = find(root, `pose-${state}`);
    const part = (cls: string): Ink => inkOf(walk(pose).filter((n) => classesOf(n).includes(cls)));
    const tipRow = rows.findIndex((r) => "24".includes(r[30]));
    assert.ok(tipRow >= 0, `${state}: no ear tip at x30`);
    assert.ok(part("ear").has(`30,${tipRow}`), `pose-${state}: the ear layer is missing the tip at x30 row ${tipRow}`);
    const farEnd = new Set<string>();
    rows.forEach((r, y) => [...r].forEach((c, x) => { if (x >= 45 && y >= 5 && "24".includes(c)) farEnd.add(`${x},${y}`); }));
    assert.ok(farEnd.size > 0);
    assert.deepEqual([...part("tail").keys()].sort(), [...farEnd].sort(), `pose-${state} tail layer`);
  }
});

test("each LED group is the lit pixels of one rack unit, and only those", () => {
  const rows = readGrid("sleep");
  const dividers = rows.map((r, y) => ({ r, y })).filter(({ r, y }) => y >= RACK_FROM && /3/.test(r) && /^ *3+ *$/.test(r)).map(({ y }) => y);
  assert.equal(dividers.length, 4, "four dark lines make three units");
  const root = parseXml(mascotDefs(0, 0, "dark"));
  const lit = new Set<string>();
  for (let k = 0; k < dividers.length - 1; k++) {
    const expected = new Set<string>();
    for (let y = dividers[k] + 1; y < dividers[k + 1]; y++) [...rows[y]].forEach((c, x) => { if (c === "6") expected.add(`${x},${y}`); });
    assert.ok(expected.size > 0, `unit ${k} has lit LEDs`);
    assert.deepEqual([...inkOf([find(root, `led-${k}`)]).keys()].sort(), [...expected].sort(), `led-${k}`);
    for (const p of expected) lit.add(p);
  }
  assert.equal(lit.size, rows.join("").split("6").length - 1, "every lit pixel belongs to one unit");
});

test("the mascot is drawn at the column and row it is given", () => {
  const at = parseXml(mascotDefs(0, 0, "dark"));
  const moved = parseXml(mascotDefs(3, 2, "dark"));
  const dx = (3 * CELL_W) / PX;
  const dy = (2 * CELL_H) / PX;
  for (const cls of ["rack", ...states().map((s) => `pose-${s}`), "bubble-0", "bubble-3", "burst"]) {
    const expected = new Map([...inkOf([find(at, cls)])].map(([p, f]) => [`${xy(p)[0] + dx},${xy(p)[1] + dy}`, f]));
    assert.deepEqual([...inkOf([find(moved, cls)])].sort(), [...expected].sort(), cls);
  }
});

// ---------------------------------------------------------------------------------------------
// Reduced motion: the base stylesheet is the still frame
// ---------------------------------------------------------------------------------------------

test("the base stylesheet shows the sleeping pose and hides every other, in the real document", async () => {
  // buildSvg's reduced-motion rule is `animation: none`, so what survives is exactly the
  // non-animation rules. Break caught: flipping any default, dropping the sleep rule, or putting
  // it ahead of the `.pose` reset (the cascade then hides the sleeper).
  for (const theme of ["dark", "light"] as const) {
    const css = styleOf(await fullSvg(theme));
    // The classes come from the generated elements themselves: a group that lost its `pose` class would escape the reset rule.
    const root = parseXml(mascotDefs(0, 0, theme));
    const classesFor = (s: string): string[] => classesOf(find(root, `pose-${s}`));
    const visible = states().filter((s) => Number(baseValue(css, classesFor(s), "opacity")) === 1);
    assert.deepEqual(visible, ["sleep"], `${theme}: only the sleeping pose may be visible`);
    for (const s of states()) {
      assert.ok(baseValue(css, classesFor(s), "opacity") !== undefined, `${s} must declare its opacity`);
    }
    // The rest pose is where the loop begins and ends, so animation drives away from it and back.
    assert.equal(visible[0], MASCOT_TIMELINE[0].state);
    assert.equal(visible[0], MASCOT_TIMELINE[MASCOT_TIMELINE.length - 1].state);
  }
});

test("the base stylesheet hides every bubble step and the burst, so the still frame is the plain sleeping pose", async () => {
  const defs = parseXml(mascotDefs(0, 0, "dark"));
  const css = styleOf(await fullSvg("dark"));
  const bubbles = walk(defs).filter((n) => classesOf(n).includes("bubble"));
  assert.equal(bubbles.length, 5, "four steps and the burst");
  for (const n of bubbles) assert.equal(Number(baseValue(css, classesOf(n), "opacity")), 0, `${classesOf(n).join(" ")} must be hidden in the base stylesheet`);
});

test("the base stylesheet leaves every layer untransformed and the LEDs lit", async () => {
  // Reduced motion must land on un-lifted, un-shifted art; a stray base transform would freeze
  // the cat mid-breath, and a stray base opacity would freeze an LED mid-flicker.
  const css = styleOf(await fullSvg("dark"));
  assert.deepEqual(styleRules(css).filter((r) => "transform" in r.decls), []);
  for (const cls of ["breath", "ear", "tail", "led", "led-0", "led-1", "led-2", "rack"]) {
    const opacity = baseValue(css, [cls], "opacity");
    assert.ok(opacity === undefined || Number(opacity) === 1, `.${cls} base opacity ${opacity}`);
  }
});

// ---------------------------------------------------------------------------------------------
// The master loop is derived from MASCOT_TIMELINE
// ---------------------------------------------------------------------------------------------

type Window = { state: PoseName; from: number; to: number };

/** Opacity of a master-clock layer (a pose, a bubble step, the burst) at time t, read from its keyframes with step-end semantics. */
function opacityAt(css: string, cls: string, t: number): number {
  assert.equal(cycleSeconds(css, cls), MASTER_SECONDS, `.${cls} must run on the master clock`);
  let value: number | undefined;
  for (const stop of stopsOf(css, cls)) if (stop.seconds <= t) value = Number(stop.decls.opacity);   // step-end: hold until the next stop
  assert.ok(value !== undefined, `.${cls} has no stop at or before ${t}s`);
  return value;
}

/** The pose the timeline says is on screen at t. */
const poseAt = (timeline: Window[], t: number): string => {
  const w = timeline.find((x) => t >= x.from && t < x.to);
  assert.ok(w, `timeline has no window at ${t}s`);
  return w.state;
};

/** Exactly the timeline's pose is visible at every sampled instant, and exactly one pose is. */
function assertLoopShowsTimeline(timeline: Window[]): void {
  const css = mascotCss();
  const poses = [...new Set(timeline.map((w) => w.state))];
  const check = (t: number): void => {
    const visible = poses.filter((p) => opacityAt(css, `pose-${p}`, t) === 1);
    assert.deepEqual(visible, [poseAt(timeline, t)], `at ${t}s`);
  };
  for (let k = 0; k < MASTER_SECONDS * 10; k++) check(k * 0.1 + 0.03);
  // A millisecond either side of every hand-off: the cut lands where the timeline says, and neither
  // blinks off (a gap) nor shows two poses (an overlap) while it happens.
  for (const w of timeline.slice(1)) {
    check(w.from - 0.001);
    check(w.from + 0.001);
  }
  check(MASTER_SECONDS - 0.001);
}

/** Runs fn with MASCOT_TIMELINE temporarily replaced, restoring it afterwards even if fn throws. */
function withTimeline(replacement: Window[], fn: () => void): void {
  const original = MASCOT_TIMELINE.map((w) => ({ ...w }));
  try {
    MASCOT_TIMELINE.splice(0, MASCOT_TIMELINE.length, ...replacement);
    fn();
  } finally {
    MASCOT_TIMELINE.splice(0, MASCOT_TIMELINE.length, ...original);
  }
  assert.deepEqual(MASCOT_TIMELINE, original, "the timeline was restored");
}

// Hand-derived alternative inside the same 36 s loop: 12 s is 33.333% of it and 32 s is 88.889%; neither is in the committed table.
const MOVED: Window[] = [
  { state: "sleep", from: 0, to: 9 },
  { state: "yawn", from: 9, to: 12 },
  { state: "stretch", from: 12, to: 18 },
  { state: "settle", from: 18, to: 21 },
  { state: "sleep", from: 21, to: 32 },
  { state: "startle", from: 32, to: 34 },
  { state: "sleep", from: 34, to: MASTER_SECONDS },
];

test("the committed timeline is what the keyframes show, instant by instant", () => {
  assertLoopShowsTimeline(MASCOT_TIMELINE);
});

test("the keyframes follow the timeline when it changes, so they are derived and not a typed table", () => {
  withTimeline(MOVED, () => {
    assertLoopShowsTimeline(MOVED);
    const css = mascotCss();
    assert.match(css, /33\.333%/);
    assert.match(css, /88\.889%/);
    assert.ok(!css.includes("30.278%"), "the committed 10.9 s hand-off must not survive");
    assert.ok(!css.includes("83.333%"), "the committed 30 s pop must not survive");
  });
});

// ---------------------------------------------------------------------------------------------
// The nose bubble
// ---------------------------------------------------------------------------------------------

const bubbleSteps = (root: Node): string[] => walk(root).flatMap(classesOf).filter((c) => /^bubble-\d+$/.test(c)).sort();

/**
 * How long the burst ring stays on screen, in milliseconds. Declared here rather than read from the module, so a burst
 * that goes back to being a share of the startle window, or is simply retimed, fails rather than agreeing with itself.
 */
const BURST_MS = 200;

/**
 * The bubble inflates in equal steps across the window before startle, bursts at the very instant
 * startle begins, and is gone for the rest of the loop. Everything is read from the real keyframes.
 */
function assertBubbleFollowsTimeline(timeline: Window[]): void {
  const css = mascotCss();
  const i = timeline.findIndex((w) => w.state === "startle");
  assert.ok(i > 0, "the timeline needs a window before startle to inflate in");
  const grow = timeline[i - 1];
  const pop = timeline[i];
  const steps = bubbleSteps(parseXml(mascotDefs(0, 0, "dark")));
  const all = [...steps, "burst"];
  const stepLength = (grow.to - grow.from) / steps.length;
  const visible = (t: number): string[] => all.filter((c) => opacityAt(css, c, t) === 1);

  assert.equal(grow.to, pop.from, "the long window must run right up to startle");
  assert.deepEqual(visible(grow.from - 0.001), [], "no bubble before the long window begins");
  steps.forEach((step, k) => {
    assert.deepEqual(visible(grow.from + k * stepLength + 0.001), [step], `${step} starts on its step`);
    assert.deepEqual(visible(grow.from + (k + 1) * stepLength - 0.001), [step], `${step} lasts its whole step`);
  });
  // The pop: the last step is on screen a millisecond before startle, and only the burst a millisecond after.
  assert.deepEqual(visible(pop.from - 0.001), [steps[steps.length - 1]]);
  assert.deepEqual(visible(pop.from + 0.001), ["burst"]);
  // The burst is an impact and owns its length: BURST_MS from the pop, whatever the startle window happens to last.
  // Written as a share of that window it was 400ms here and 1000ms under the alternative timeline below, so a burst
  // re-coupled to the window fails on one side or the other of these two instants.
  assert.deepEqual(visible(pop.from + BURST_MS / 2000), ["burst"], "the burst is up through its own first half");
  assert.deepEqual(visible(pop.from + BURST_MS / 1000 + 0.002), [], `the burst is gone ${BURST_MS}ms after the pop`);
  assert.ok(Math.abs(litMs(css, "burst") - BURST_MS) <= 1, `the burst is lit for ${litMs(css, "burst").toFixed(1)}ms, not ${BURST_MS}ms`);
  assert.deepEqual(visible(pop.to - 0.001), [], "a burst ring, then nothing");

  for (let k = 0; k < MASTER_SECONDS * 10; k++) {
    const t = k * 0.1 + 0.03;
    if (t >= grow.from && t < grow.to) {
      assert.deepEqual(visible(t), [steps[Math.floor((t - grow.from) / stepLength)]], `at ${t}s`);
    } else if (t >= pop.from && t < pop.to) {
      assert.ok(visible(t).every((c) => c === "burst"), `a bubble step survives the pop at ${t}s`);
    } else {
      assert.deepEqual(visible(t), [], `at ${t}s`);
    }
  }
}

test("the bubble inflates in four steps across the long sleep and pops exactly when startle begins", () => {
  assert.equal(bubbleSteps(parseXml(mascotDefs(0, 0, "dark"))).length, 4);
  assertBubbleFollowsTimeline(MASCOT_TIMELINE);
  // The instant itself, read straight off the committed timeline rather than through the sampler's own arithmetic.
  const startle = MASCOT_TIMELINE.find((w) => w.state === "startle");
  assert.ok(startle);
  assert.equal(startle.from, 30);
  const css = mascotCss();
  assert.equal(opacityAt(css, "bubble-3", startle.from - 0.001), 1);
  assert.equal(opacityAt(css, "bubble-3", startle.from + 0.001), 0);
  assert.equal(opacityAt(css, "burst", startle.from - 0.001), 0);
  assert.equal(opacityAt(css, "burst", startle.from + 0.001), 1);
});

test("the bubble's steps and pop follow the timeline when it changes", () => {
  withTimeline(MOVED, () => assertBubbleFollowsTimeline(MOVED));
});

test("the bubble starts as one pixel at x21 row 7, grows up and to the left to about 3 x 3, and keeps its corner", () => {
  const root = parseXml(mascotDefs(0, 0, "dark"));
  const steps = bubbleSteps(root).map((c) => {
    const px = [...inkOf([find(root, c)]).keys()].map(xy);
    const [x0, x1] = [Math.min(...px.map(([x]) => x)), Math.max(...px.map(([x]) => x))];
    const [y0, y1] = [Math.min(...px.map(([, y]) => y)), Math.max(...px.map(([, y]) => y))];
    return { c, ink: px.length, w: x1 - x0 + 1, h: y1 - y0 + 1, right: x1, bottom: y1, px };
  });
  assert.deepEqual(steps[0].px, [[21, 7]], "one pixel at x21 row 7");
  for (let i = 1; i < steps.length; i++) {
    assert.ok(steps[i].ink > steps[i - 1].ink, `${steps[i].c} has no more ink than ${steps[i - 1].c}`);
    assert.ok(steps[i].w * steps[i].h >= steps[i - 1].w * steps[i - 1].h, `${steps[i].c} is smaller than ${steps[i - 1].c}`);
    assert.equal(steps[i].right, 21, `${steps[i].c} moved off the corner`);
    assert.equal(steps[i].bottom, 7, `${steps[i].c} moved off the corner`);
  }
  assert.deepEqual([steps[3].w, steps[3].h], [3, 3], "about 3 x 3 by the last step");
});

test("the bubble sits in free space: no step overlaps the sleeping cat, and the burst clears the startled one", () => {
  // A step is on screen only with the sleeping pose and the burst only with the startled one, so those are the pairs that meet.
  const root = parseXml(mascotDefs(0, 0, "dark"));
  const sleeping = inkOf([find(root, "pose-sleep")]);
  const startled = inkOf([find(root, "pose-startle")]);
  const rack = inkOf([find(root, "rack")]);
  for (const c of bubbleSteps(root)) {
    for (const p of inkOf([find(root, c)]).keys()) assert.ok(!sleeping.has(p) && !rack.has(p), `${c} overlaps the sleeping cat or the rack at ${p}`);
  }
  for (const p of inkOf([find(root, "burst")]).keys()) assert.ok(!startled.has(p) && !rack.has(p), `the burst overlaps the startled cat or the rack at ${p}`);
});

test("the burst is a ring around where the bubble was", () => {
  const root = parseXml(mascotDefs(0, 0, "dark"));
  const burst = [...inkOf([find(root, "burst")]).keys()].map(xy);
  const last = [...inkOf([find(root, "bubble-3")]).keys()].map(xy);
  const mid = (a: [number, number][], i: 0 | 1): number => (Math.min(...a.map((q) => q[i])) + Math.max(...a.map((q) => q[i]))) / 2;
  assert.ok(Math.abs(mid(burst, 0) - mid(last, 0)) <= 2 && Math.abs(mid(burst, 1) - mid(last, 1)) <= 2, "centred near the last bubble");
  assert.ok(burst.length >= 6, "a ring of several sparks, not a dot");
  const wider = Math.max(...burst.map(([x]) => x)) - Math.min(...burst.map(([x]) => x));
  assert.ok(wider >= 4, "bigger than the bubble it replaces");
});

test("the bubble is drawn in the lightest tint's token, muted, in both themes", () => {
  for (const theme of ["dark", "light"] as const) {
    const root = parseXml(mascotDefs(0, 0, theme));
    for (const c of [...bubbleSteps(root), "burst"]) {
      for (const f of inkOf([find(root, c)]).values()) assert.equal(f, PALETTES[theme].muted, `${theme} ${c}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Every animation is real: it has keyframes, cuts frames, loops, and targets art that exists
// ---------------------------------------------------------------------------------------------

test("every animation rule has keyframes, cuts frames, loops forever and targets a real element", () => {
  const css = mascotCss();
  const anims = animationsOf(css);
  const kfNames = keyframesOf(css).map((k) => k.name);
  const classes = new Set(walk(parseXml(mascotDefs(0, 0, "dark"))).flatMap(classesOf));
  assert.ok(anims.length >= states().length + 10, "poses, four bubble steps, the burst, breath, ear, tail and three LEDs");
  for (const a of anims) {
    assert.ok(kfNames.includes(a.name), `.${a.cls} runs @keyframes ${a.name}, which does not exist`);
    assert.equal(a.timing, "step-end", `.${a.cls} must cut between frames`);
    assert.equal(a.iterations, "infinite", `.${a.cls} must loop`);
    assert.ok(classes.has(a.cls), `.${a.cls} is animated but no element carries that class`);
  }
  // No keyframes nothing runs.
  for (const name of kfNames) assert.ok(anims.some((a) => a.name === name), `@keyframes ${name} is never used`);
});

test("every pose, bubble step and the burst swap on the master clock", () => {
  const anims = animationsOf(mascotCss());
  const master = anims.filter((a) => a.seconds === MASTER_SECONDS).map((a) => a.cls).sort();
  const expected = [...states().map((s) => `pose-${s}`), ...bubbleSteps(parseXml(mascotDefs(0, 0, "dark"))), "burst"].sort();
  assert.deepEqual(master, expected);
});

test("the breath divides the loop exactly, lifts the cat and its bubble in every pose, and never the rack", () => {
  const anim = animationsOf(mascotCss()).find((a) => a.name === "breathe");
  assert.ok(anim, "no breathe animation");
  const breaths = MASTER_SECONDS / anim.seconds;
  assert.ok(Number.isInteger(breaths), `${breaths} breaths per loop: the loop would not join on a breath`);
  assert.equal(anim.seconds, 3, "20 breaths a minute");
  assert.equal(breaths, 12, "36 seconds is twelve breaths");

  const root = parseXml(mascotDefs(0, 0, "dark"));
  const inside = walk(find(root, anim.cls)).flatMap(classesOf);
  for (const s of states()) assert.ok(inside.includes(`pose-${s}`), `pose-${s} does not breathe`);
  assert.ok(inside.includes("burst") && bubbleSteps(root).every((c) => inside.includes(c)), "the bubble belongs to the cat, so it must rise and fall with it");
  assert.ok(!inside.includes("rack"), "the rack must stay still");
  assert.ok(!inside.some((c) => /^led/.test(c)), "the LEDs are on the rack and must stay still");
});

test("nothing that moves the cat downward can push it into the rack it rests on", () => {
  // The cat only ever rises. A downward translate longer than the gap under the cat (none, when it rests on the frame line)
  // would sink it into the rack.
  const css = mascotCss();
  const moves = animationsOf(css).filter((a) => ["breath", "ear", "tail"].includes(a.cls)).map((a) => a.name);
  assert.equal(moves.length, 3);
  let down = 0;
  for (const kf of keyframesOf(css).filter((k) => moves.includes(k.name))) {
    for (const stop of kf.stops) {
      for (const m of (stop.decls.transform ?? "").matchAll(/translateY\((-?[\d.]+)px\)/g)) down = Math.max(down, Number(m[1]));
    }
  }
  const root = parseXml(mascotDefs(0, 0, "dark"));
  const top = Math.min(...[...inkOf([find(root, "rack")]).keys()].map((p) => xy(p)[1]));
  for (const state of states()) {
    const bottom = Math.max(...[...inkOf([find(root, `pose-${state}`)], ["foot"]).keys()].map((p) => xy(p)[1]));
    assert.ok((top - bottom - 1) * PX >= down, `pose-${state}: a downward move of ${down}px sinks it into the rack`);
  }
});

test("every idle translation is exactly one art pixel, which is both the step the lattice has and the depth the feet cover", () => {
  // Two bounds, and they meet at the same number.
  //
  // The floor is the lattice. A sprite drawn on an art-pixel grid and rendered with shape-rendering="crispEdges" has no
  // position between pixels: a smaller move snaps to nothing or to one device pixel depending on the render width, so it
  // reads as an edge flickering rather than as the cat rising. Measured through scripts/render-check.ts, a one-unit
  // breath changed 178 device pixels at 846px wide and 9 at 308px, against 981 and 131 for a full art pixel.
  //
  // The ceiling is foot(). It continues the cat's bottom row exactly one art pixel behind the rack frame, which is what
  // hides the displacement at rest; a lift of PX + 1 would reach past that continuation and show a strip of window under
  // the feet at most widths. So the amplitude is pinned AT one art pixel, not merely under it, in both directions and on
  // both axes, at every stop.
  const css = mascotCss();
  for (const cls of ["breath", "ear", "tail"]) {
    const anim = animationsOf(css).find((a) => a.cls === cls);
    assert.ok(anim, `no animation for .${cls}`);
    const kf = keyframesOf(css).find((k) => k.name === anim.name);
    assert.ok(kf, `no keyframes for .${cls}`);
    let biggest = 0;
    let moves = 0;
    for (const stop of kf.stops) {
      const transform = stop.decls.transform;
      assert.ok(transform !== undefined, `${kf.name} at ${stop.at} sets no transform`);
      for (const m of transform.matchAll(/(\w+)\(([^)]*)\)/g)) {
        assert.ok(["translateX", "translateY"].includes(m[1]), `${kf.name}: ${m[1]} is not a plain translate`);
        const v = m[2].trim().match(/^(-?[\d.]+)(px)?$/);
        assert.ok(v, `${kf.name}: ${m[0]} is not a number of pixels`);
        const units = Math.abs(Number(v[1]));
        assert.ok(units <= PX, `${kf.name} ${m[0]} is more than one art pixel (${PX} units); foot() only continues the cat ${PX} units behind the frame, so this exposes window under the feet`);
        assert.ok(units === 0 || units === PX, `${kf.name} ${m[0]} is ${units} units, which is off the art-pixel lattice; crispEdges snaps it to nothing or to one device pixel depending on the render width`);
        biggest = Math.max(biggest, units);
        moves++;
      }
    }
    assert.equal(moves, 3, `${kf.name}: away, and back to rest`);
    assert.equal(biggest, PX, `${kf.name} must move a whole art pixel, not ${biggest} units`);
  }
});

test("the LEDs flicker between a dim level and fully lit, and never go dark", () => {
  const css = mascotCss();
  for (const cls of ["led-0", "led-1", "led-2"]) {
    const anim = animationsOf(css).find((a) => a.cls === cls);
    assert.ok(anim, `no animation for .${cls}`);
    const kf = keyframesOf(css).find((k) => k.name === anim.name);
    assert.ok(kf);
    const levels = [...new Set(kf.stops.map((s) => Number(s.decls.opacity)))].sort((a, b) => a - b);
    assert.deepEqual(levels, [0.25, 1], `${cls}: dim and lit, and nothing else`);
  }
});

/** Targets in milliseconds, declared here and not read from the module, for the three events of a fixed length. */
const LED_FLASH_MS = 200;
const EAR_FLICK_MS = 119;
const TAIL_FLICK_MS = 345;

test("the three LEDs flash for the same length of time, on their different clocks", () => {
  // The defect this pins: one shared `@keyframes led` with stops at 3% and 8%, run at 7s, 11s and 13s, made the same
  // status flash last 350ms, 550ms and 650ms. Three lights that should differ only in interval differed in behaviour,
  // the longest by 1.86x. Durations are measured in milliseconds off the real keyframes against a target declared
  // above, so expressing the flash as a share of a cycle fails as soon as two cycles differ in length.
  const css = mascotCss();
  const leds = animationsOf(css).filter((a) => /^led-\d+$/.test(a.cls));
  assert.ok(leds.length >= 3, `three rack units, each on its own clock, found ${leds.length}`);
  // Every LED the generated css carries is checked, whatever its period, so adding a fourth unit or retuning an
  // existing one is covered without editing this test.
  for (const a of leds) {
    const ms = litMs(css, a.cls);
    assert.ok(Math.abs(ms - LED_FLASH_MS) <= 1, `.${a.cls} on its ${a.seconds}s clock is lit for ${ms.toFixed(1)}ms, not ${LED_FLASH_MS}ms`);
  }
  assert.equal(new Set(leds.map((a) => a.seconds)).size, leds.length, "the interval is the only thing the LEDs may differ in, so no two share a clock");
  assert.equal(new Set(leds.map((a) => litMs(css, a.cls).toFixed(0))).size, 1, "every LED flashes for the same number of milliseconds");
});

test("the three LEDs never flash together, not once in the time their periods take to realign", () => {
  // Three units on co-prime clocks are there to say the machine's work is independent. If they all lit at the same
  // instant a viewer would read that as one synchronised part, so each is staggered a flash-length further into its own
  // cycle: unit k lights at (k + 1) x 200ms. The consequence is checked exhaustively rather than argued, by walking
  // every lit window of every LED across the full realignment period and looking for an overlap.
  const css = mascotCss();
  const leds = animationsOf(css).filter((a) => /^led-\d+$/.test(a.cls)).sort((a, b) => a.cls.localeCompare(b.cls));
  leds.forEach((a, k) => {
    const expected = (k + 1) * LED_FLASH_MS;
    assert.ok(Math.abs(firstLitMs(css, a.cls) - expected) <= 1, `.${a.cls} first lights ${firstLitMs(css, a.cls).toFixed(1)}ms into its cycle, not ${expected}ms: the stagger must step by one flash length per unit`);
  });
  // How long the real periods take to realign, computed from them rather than assumed: lcm(7, 11, 13) is 1001s.
  const togetherMs = leds.reduce((lcm, a) => (lcm * a.seconds) / gcd(lcm, a.seconds), 1) * 1000;
  assert.ok(togetherMs >= 60_000, `the periods realign every ${togetherMs / 1000}s, which is too soon to be worth staggering`);
  const windows = leds.map((a) => {
    const at = firstLitMs(css, a.cls);
    const period = a.seconds * 1000;
    return { cls: a.cls, period, flashes: Array.from({ length: Math.round(togetherMs / period) }, (_, n) => at + n * period) };
  });
  const lit = litMs(css, leds[0].cls);
  let compared = 0;
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      for (const a of windows[i].flashes) {
        for (const b of windows[j].flashes) {
          compared++;
          assert.ok(Math.abs(a - b) >= lit - 1, `${windows[i].cls} lights at ${a}ms and ${windows[j].cls} at ${b}ms, which overlap: the two would flash as one`);
        }
      }
    }
  }
  assert.ok(compared > 20_000, `only ${compared} pairs of flashes were compared across ${togetherMs / 1000}s, which is not the whole realignment period`);
});

test("the ear flick and the tail flick last their own milliseconds, not a share of the cycle carrying them", () => {
  // A flick is an event with a length; 17s and 23s are intervals. While the stops were percentages of those cycles, a
  // retuned cycle silently changed how fast the flick moved, which is the mistake BREATH_SECONDS already records.
  // Measured in milliseconds, so a percentage-based stop reads back wrong the moment a period is retuned.
  const css = mascotCss();
  for (const [cls, target] of [["ear", EAR_FLICK_MS], ["tail", TAIL_FLICK_MS]] as [string, number][]) {
    const ms = awayMs(css, cls);
    assert.ok(Math.abs(ms - target) <= 1, `the ${cls} is away from rest for ${ms.toFixed(1)}ms on its ${cycleSeconds(css, cls)}s cycle, not ${target}ms`);
    assert.ok(ms < cycleSeconds(css, cls) * 1000 / 10, `the ${cls} flick fills ${((ms / 10) / cycleSeconds(css, cls)).toFixed(1)}% of its cycle: an idle flick must be brief`);
  }
  // The breath is the one gesture that is genuinely a share of its cycle: it rises for the middle of a breath, whatever
  // a breath lasts. It is here so the distinction is pinned rather than assumed.
  const breath = awayMs(css, "breath") / (cycleSeconds(css, "breath") * 1000);
  assert.ok(breath > 0.3 && breath < 0.7, `the breath is lifted for ${(breath * 100).toFixed(1)}% of a breath, which is not the middle of one`);
});

test("the burst is the briefest thing on the storyline, because it is an impact", () => {
  // It must outlast nothing it lands inside, and no pose window may be shorter than it: a pop as long as the pose it
  // interrupts reads as a shape, not a hit.
  const css = mascotCss();
  const shortestWindow = Math.min(...MASCOT_TIMELINE.map((w) => (w.to - w.from) * 1000));
  const burst = litMs(css, "burst");
  assert.ok(burst < shortestWindow, `the burst lasts ${burst.toFixed(0)}ms and the shortest pose window ${shortestWindow.toFixed(0)}ms`);
  for (const c of bubbleSteps(parseXml(mascotDefs(0, 0, "dark")))) {
    assert.ok(burst < litMs(css, c), `the burst must be quicker than the inflation step ${c} it replaces`);
  }
});

test("micro-layer periods are co-prime with each other and with the master loop", () => {
  const css = mascotCss();
  const periodOf = (cls: string): number => {
    const a = animationsOf(css).find((x) => x.cls === cls);
    assert.ok(a, `no animation for .${cls}`);
    return a.seconds;
  };
  const periods = { ear: periodOf("ear"), tail: periodOf("tail"), "led-0": periodOf("led-0"), "led-1": periodOf("led-1"), "led-2": periodOf("led-2") };
  assert.deepEqual(periods, { ear: 17, tail: 23, "led-0": 7, "led-1": 11, "led-2": 13 });
  const entries = Object.entries(periods);
  for (const [name, p] of entries) assert.equal(gcd(p, MASTER_SECONDS), 1, `${name} shares a factor with the master loop`);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      assert.equal(gcd(entries[i][1], entries[j][1]), 1, `${entries[i][0]} and ${entries[j][0]} share a factor`);
    }
  }
});

test("it animates only opacity and transform, and never uses SMIL, in the real document", async () => {
  for (const theme of ["dark", "light"] as const) {
    const svg = await fullSvg(theme);
    const keyframes = keyframesOf(styleOf(svg));
    assert.ok(keyframes.length >= states().length + 4 + 5, "pose swaps, bubble steps, burst, breathe, ear, tail and led");
    for (const kf of keyframes) {
      for (const stop of kf.stops) {
        for (const prop of Object.keys(stop.decls)) {
          assert.ok(["opacity", "transform"].includes(prop), `${kf.name} animates ${prop}`);
        }
      }
    }
    // The base64 font payload is stripped first so a random run of letters inside it cannot match.
    const markup = svg.replace(/base64,[A-Za-z0-9+/=]+/g, "base64,");
    assert.ok(!/<(animate|animateTransform|animateMotion|set|mpath)\b/.test(markup), "SMIL keeps running under reduced motion");
    assert.ok(!/attributeName/.test(markup), "no animated geometry attributes");
    assert.ok(!/\b(filter|mask|backdrop-filter)\b|blur\(|feGaussianBlur/.test(markup), "no filter, mask or blur");
    assert.ok(!/\sstyle="/.test(markup), "no inline styles that could animate anything");
  }
});
