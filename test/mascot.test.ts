import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { subsetToBase64 } from "../src/font.ts";
import { buildSvg } from "../src/svg.ts";
import { CELL_H, CELL_W, PAD } from "../src/grid.ts";
import { PALETTES } from "../src/tokens.ts";
import type { ThemeName } from "../src/tokens.ts";
import { MASCOT_TIMELINE, MASTER_SECONDS } from "../src/timeline.ts";
import { MASCOT_COLS, MASCOT_ROWS, mascotCss, mascotDefs } from "../src/mascot.ts";

// ---------------------------------------------------------------------------------------------
// Helpers. Everything below reads the GENERATED output (the real svg, css and path data), never
// the module's source, so a wrong implementation cannot satisfy a test by looking right in code.
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

// ---- Geometry: a path is rectangles on the half-cell lattice -----------------------------------

const SUB_W = CELL_W / 2;   // one quadrant wide
const SUB_H = CELL_H / 2;   // one half-row tall

/** "x,y" keys of the lattice pixels (quadrant wide, half-row tall) a compiled path covers. */
function pixels(d: string): Set<string> {
  assert.match(d, /^(M[\d.]+ [\d.]+h[\d.]+v[\d.]+h-[\d.]+z)*$/, "path data is not compiler rectangles");
  const out = new Set<string>();
  for (const m of d.matchAll(/M([\d.]+) ([\d.]+)h([\d.]+)v([\d.]+)/g)) {
    const [x, y, w, h] = m.slice(1).map(Number);
    const [px, py, pw, ph] = [(x - PAD) / SUB_W, (y - PAD) / SUB_H, w / SUB_W, h / SUB_H];
    for (const v of [px, py, pw, ph]) assert.ok(Number.isInteger(v), `rect ${m[0]} is off the half-cell lattice`);
    for (let i = 0; i < pw; i++) for (let j = 0; j < ph; j++) out.add(`${px + i},${py + j}`);
  }
  return out;
}

const xy = (p: string): [number, number] => {
  const [x, y] = p.split(",").map(Number);
  return [x, y];
};

type Layer = { fill: string; d: string; px: Set<string> };

/**
 * Every path in the defs, keyed by what it is: `pose-NAME/body|ear|tail`, `rack`, `led-N`.
 * Duplicate keys are an error, so one layer cannot silently shadow another.
 */
function layersOf(defs: string): Record<string, Layer> {
  const layers: Record<string, Layer> = {};
  const add = (key: string, n: Node): void => {
    assert.equal(n.tag, "path", `${key} is not a path`);
    assert.ok(!(key in layers), `duplicate layer ${key}`);
    layers[key] = { fill: n.attrs.fill, d: n.attrs.d, px: pixels(n.attrs.d) };
  };
  for (const n of walk(parseXml(defs))) {
    const cls = classesOf(n);
    if (cls.includes("pose")) {
      const pose = cls.find((c) => c.startsWith("pose-"));
      assert.ok(pose, "a pose group without a pose-NAME class");
      for (const child of n.children) add(`${pose}/${child.attrs.class}`, child);
    } else if (cls.includes("rack")) {
      add("rack", n);
    } else if (cls.includes("led")) {
      const led = cls.find((c) => c.startsWith("led-"));
      assert.ok(led, "an led without an led-N class");
      add(led, n);
    }
  }
  return layers;
}

const states = (): string[] => [...new Set(MASCOT_TIMELINE.map((w) => w.state))];
const poseKeys = (layers: Record<string, Layer>, part: string): string[] =>
  Object.keys(layers).filter((k) => k.endsWith(`/${part}`));
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

// ---------------------------------------------------------------------------------------------
// The footprint
// ---------------------------------------------------------------------------------------------

test("the mascot fits the header budget, and the art really spans the box it claims", () => {
  assert.ok(MASCOT_COLS <= 28, "wider than 28 columns blurs on a phone");
  assert.ok(MASCOT_ROWS <= 12);
  const layers = layersOf(mascotDefs(0, 0, "dark"));
  // Breaks caught: art wider or taller than the constants Task 7 reserves room by, and constants
  // that no longer describe the art.
  for (const [key, layer] of Object.entries(layers)) {
    for (const p of layer.px) {
      const [x, y] = xy(p);
      assert.ok(x >= 0 && x < MASCOT_COLS * 2 && y >= 0 && y < MASCOT_ROWS * 2, `${key} has ink outside the box at ${p}`);
    }
  }
  const rack = [...layers.rack.px].map(xy);
  assert.equal(Math.min(...rack.map(([x]) => x)), 0, "rack starts at the left edge");
  assert.equal(Math.max(...rack.map(([x]) => x)) + 1, MASCOT_COLS * 2, "rack ends at the right edge");
  assert.equal(Math.max(...rack.map(([, y]) => y)) + 1, MASCOT_ROWS * 2, "rack ends at the bottom edge");
});

test("the sleeping pose leaves the upper right clear for the zZz and the nose bubble", () => {
  const sleep = layersOf(mascotDefs(0, 0, "dark"));
  for (const part of ["body", "ear", "tail"]) {
    for (const p of sleep[`pose-sleep/${part}`].px) {
      const [x, y] = xy(p);
      assert.ok(!(x >= MASCOT_COLS && y < 4), `sleep ${part} has ink in the reserved corner at ${p}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Poses and the timeline
// ---------------------------------------------------------------------------------------------

test("every pose the timeline names has art, and no art is a pose the timeline never shows", () => {
  const layers = layersOf(mascotDefs(0, 0, "dark"));
  const drawn = new Set(Object.keys(layers).filter((k) => k.startsWith("pose-")).map((k) => k.split("/")[0]));
  assert.deepEqual([...drawn].sort(), states().map((s) => `pose-${s}`).sort());
  for (const state of states()) {
    assert.ok(layers[`pose-${state}/body`].px.size > 0, `pose-${state} has an empty body: a gap in the loop`);
  }
});

test("no two poses share a silhouette, so none is a lazy copy of another", () => {
  const layers = layersOf(mascotDefs(0, 0, "dark"));
  const bodies = poseKeys(layers, "body").map((k) => layers[k].d);
  assert.equal(new Set(bodies).size, states().length);
});

test("every pose has an ear and a tail layer that actually draws something", () => {
  // An empty overlay would leave the ear/tail micro-layer animating nothing in that pose.
  const layers = layersOf(mascotDefs(0, 0, "dark"));
  for (const state of states()) {
    for (const part of ["ear", "tail"]) {
      assert.ok(layers[`pose-${state}/${part}`].px.size > 0, `pose-${state} has no ${part} ink`);
    }
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
    const visible = states().filter((s) => Number(baseValue(css, ["pose", `pose-${s}`], "opacity")) === 1);
    assert.deepEqual(visible, ["sleep"], `${theme}: only the sleeping pose may be visible`);
    for (const s of states()) {
      assert.ok(baseValue(css, ["pose", `pose-${s}`], "opacity") !== undefined, `${s} must declare its opacity`);
    }
    // The rest pose is where the loop begins and ends, so animation drives away from it and back.
    assert.equal(visible[0], MASCOT_TIMELINE[0].state);
    assert.equal(visible[0], MASCOT_TIMELINE[MASCOT_TIMELINE.length - 1].state);
  }
});

test("the base stylesheet leaves every layer untransformed and the LEDs lit", async () => {
  // Reduced motion must land on un-lifted, un-shifted art; a stray base transform would freeze
  // the cat mid-breath, and a stray base opacity would freeze an LED mid-flicker.
  const css = styleOf(await fullSvg("dark"));
  const rules = styleRules(css);
  assert.deepEqual(rules.filter((r) => "transform" in r.decls), []);
  for (const cls of ["breath", "ear", "tail", "led", "led-0", "led-1", "led-2", "rack"]) {
    const opacity = baseValue(css, [cls], "opacity");
    assert.ok(opacity === undefined || Number(opacity) === 1, `.${cls} base opacity ${opacity}`);
  }
});

// ---------------------------------------------------------------------------------------------
// The 60 second loop is derived from MASCOT_TIMELINE
// ---------------------------------------------------------------------------------------------

type Window = { state: string; from: number; to: number };

/** Opacity of a pose at time t, read from its keyframes with step-end semantics. */
function opacityAt(css: string, pose: string, t: number): number {
  const anim = animationsOf(css).find((a) => a.cls === `pose-${pose}`);
  assert.ok(anim, `no animation rule for pose-${pose}`);
  assert.equal(anim.timing, "step-end", "the sampler below assumes frames cut, not blend");
  assert.equal(anim.seconds, MASTER_SECONDS);
  const kf = keyframesOf(css).find((k) => k.name === anim.name);
  assert.ok(kf, `no @keyframes ${anim.name}`);
  const stops = kf.stops.map((s) => {
    const m = s.at.match(/^([\d.]+)%$/);
    assert.ok(m, `keyframe stop ${s.at}`);
    return { seconds: (Number(m[1]) / 100) * MASTER_SECONDS, opacity: Number(s.decls.opacity) };
  });
  let value: number | undefined;
  for (const stop of stops) if (stop.seconds <= t) value = stop.opacity;   // step-end: hold until the next stop
  assert.ok(value !== undefined, `${anim.name} has no stop at or before ${t}s`);
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
    const visible = poses.filter((p) => opacityAt(css, p, t) === 1);
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

test("the committed timeline is what the keyframes show, instant by instant", () => {
  assertLoopShowsTimeline(MASCOT_TIMELINE);
});

test("the keyframes follow the timeline when it changes, so they are derived and not a typed table", () => {
  const original = MASCOT_TIMELINE.map((w) => ({ ...w }));
  const moved: Window[] = [
    { state: "sleep", from: 0, to: 12 },
    { state: "yawn", from: 12, to: 20 },
    { state: "stretch", from: 20, to: 30 },
    { state: "settle", from: 30, to: 36 },
    { state: "sleep", from: 36, to: 50 },
    { state: "startle", from: 50, to: 52 },
    { state: "sleep", from: 52, to: MASTER_SECONDS },
  ];
  try {
    MASCOT_TIMELINE.splice(0, MASCOT_TIMELINE.length, ...moved);
    assertLoopShowsTimeline(moved);
    // Hand-derived: 20 s is 33.333% of 60 s, 50 s is 83.333%. Neither appears in the committed table.
    const css = mascotCss();
    assert.match(css, /33\.333%/);
    assert.match(css, /83\.333%/);
    assert.ok(!css.includes("30.667%"), "the committed 18.4 s hand-off must not survive");
  } finally {
    MASCOT_TIMELINE.splice(0, MASCOT_TIMELINE.length, ...original);
  }
  assert.deepEqual(MASCOT_TIMELINE, original, "the timeline was restored");
});

// ---------------------------------------------------------------------------------------------
// Every animation is real: it has keyframes, cuts frames, loops, and targets art that exists
// ---------------------------------------------------------------------------------------------

test("every animation rule has keyframes, cuts frames, loops forever and targets a real element", () => {
  const css = mascotCss();
  const anims = animationsOf(css);
  const kfNames = keyframesOf(css).map((k) => k.name);
  const classes = new Set(walk(parseXml(mascotDefs(0, 0, "dark"))).flatMap(classesOf));
  assert.ok(anims.length >= states().length + 6, "poses, breath, ear, tail and three LEDs");
  for (const a of anims) {
    assert.ok(kfNames.includes(a.name), `.${a.cls} runs @keyframes ${a.name}, which does not exist`);
    assert.equal(a.timing, "step-end", `.${a.cls} must cut between frames`);
    assert.equal(a.iterations, "infinite", `.${a.cls} must loop`);
    assert.ok(classes.has(a.cls), `.${a.cls} is animated but no element carries that class`);
  }
  // No keyframes nothing runs.
  for (const name of kfNames) assert.ok(anims.some((a) => a.name === name), `@keyframes ${name} is never used`);
});

test("every pose swaps on the 60 second master clock", () => {
  const poseAnims = animationsOf(mascotCss()).filter((a) => a.cls.startsWith("pose-"));
  assert.deepEqual(poseAnims.map((a) => a.cls).sort(), states().map((s) => `pose-${s}`).sort());
  for (const a of poseAnims) assert.equal(a.seconds, MASTER_SECONDS, a.cls);
});

test("the breath divides the loop exactly, lifts the cat in every pose, and never the rack", () => {
  const anim = animationsOf(mascotCss()).find((a) => a.name === "breathe");
  assert.ok(anim, "no breathe animation");
  const breaths = MASTER_SECONDS / anim.seconds;
  assert.ok(Number.isInteger(breaths), `${breaths} breaths per loop: the loop would not join on a breath`);
  assert.equal(anim.seconds, 3.75);

  const root = parseXml(mascotDefs(0, 0, "dark"));
  const breath = walk(root).find((n) => classesOf(n).includes(anim.cls));
  assert.ok(breath, "no element carries the breath class");
  const inside = walk(breath).flatMap(classesOf);
  for (const s of states()) assert.ok(inside.includes(`pose-${s}`), `pose-${s} does not breathe`);
  assert.ok(!inside.includes("rack"), "the rack must stay still");
  assert.ok(!inside.some((c) => c.startsWith("led")), "the LEDs must stay still");
});

test("no transform can open a gap wider than the art overlaps by", () => {
  // The cat's hidden row tucks one half-row under the rack plate, so any lift up to a half-row is
  // still backed. A bigger translation would show background between cat and rack.
  for (const kf of keyframesOf(mascotCss())) {
    for (const stop of kf.stops) {
      const t = stop.decls.transform;
      if (t === undefined) continue;
      for (const m of t.matchAll(/translate[XY]?\((-?[\d.]+)px\)/g)) {
        assert.ok(Math.abs(Number(m[1])) < SUB_H, `${kf.name} translates ${m[1]}px`);
      }
    }
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
    assert.equal(keyframes.length, states().length + 4, "pose swaps, breathe, ear, tail, led");
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

// ---------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------

test("each part is drawn in its own role colour for the theme it was asked for", () => {
  // Breaks caught: the dark palette used for both themes, roles swapped (cat in muted, rack in text),
  // the LEDs in anything but the accent, or a stray fourth colour.
  for (const theme of ["dark", "light"] as const) {
    const p = PALETTES[theme];
    const layers = layersOf(mascotDefs(0, 0, theme));
    for (const [key, layer] of Object.entries(layers)) {
      const expected = key === "rack" ? p.muted : key.startsWith("led-") ? p.accent : p.text;
      assert.equal(layer.fill, expected, `${theme} ${key}`);
    }
    assert.deepEqual(Object.keys(layers).filter((k) => k.startsWith("led-")).sort(), ["led-0", "led-1", "led-2"]);
  }
  assert.match(mascotDefs(0, 0, "dark"), /#83c092/);
  assert.match(mascotDefs(0, 0, "light"), /#3f7d4e/);
  assert.ok(!mascotDefs(0, 0, "light").includes(PALETTES.dark.accent), "dark accent leaked into light");
});

// ---------------------------------------------------------------------------------------------
// Seams: separate <path> elements can show a hairline where they merely touch
// ---------------------------------------------------------------------------------------------

/**
 * Pairs (p in a, q in b) that touch along an edge although neither shape has ink under the other's
 * pixel. Such a join is two edges that must line up exactly; at a fractional scale they do not,
 * and the page background shows through as a hairline. A join where one shape runs underneath
 * the other has backing, so no hairline can open.
 */
function bareJoins(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const p of a) {
    if (b.has(p)) continue;
    const [x, y] = xy(p);
    for (const q of [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`]) {
      if (b.has(q) && !a.has(q)) out.push(`${p} touches ${q}`);
    }
  }
  return out;
}

test("no two layers visible together meet on a bare edge", () => {
  // The ear and tail overlays are left out on purpose: each lies wholly on its own body (next test),
  // so a hairline at an overlay's edge would show body ink, never the page. The body stands for them.
  const layers = layersOf(mascotDefs(0, 0, "dark"));
  const fixed = ["rack", "led-0", "led-1", "led-2"];
  for (const state of states()) {
    const shown = [`pose-${state}/body`, ...fixed];
    for (let i = 0; i < shown.length; i++) {
      for (let j = i + 1; j < shown.length; j++) {
        assert.deepEqual(bareJoins(layers[shown[i]].px, layers[shown[j]].px), [], `${shown[i]} meets ${shown[j]} on a bare edge`);
      }
    }
  }
});

test("the cat stands on the rack: its last visible row has ink under it, hidden by the plate", () => {
  // Breaks caught: no hidden row (the breath lift would show a slit between cat and rack), and a
  // hidden row that pokes out into an open bay instead of staying behind the plate.
  const layers = layersOf(mascotDefs(0, 0, "dark"));
  const rackTop = Math.min(...[...layers.rack.px].map((p) => xy(p)[1]));
  for (const state of states()) {
    const body = layers[`pose-${state}/body`].px;
    const sitting = [...body].filter((p) => xy(p)[1] === rackTop - 1);
    assert.ok(sitting.length > 0, `pose-${state} does not reach the rack`);
    for (const p of sitting) {
      const [x, y] = xy(p);
      assert.ok(body.has(`${x},${y + 1}`), `pose-${state}: nothing under ${p}, so a lift would open a slit`);
    }
    for (const p of body) {
      if (xy(p)[1] >= rackTop) assert.ok(layers.rack.px.has(p), `pose-${state}: ${p} is cat ink showing inside the rack`);
    }
  }
});

test("the rack is painted after every cat layer, so its plate hides the row that runs under it", () => {
  // Pixel sets say nothing about paint order. If the cat were painted last, its hidden row would
  // sit on top of the plate as a visible stripe.
  const order = walk(parseXml(mascotDefs(0, 0, "dark")));
  const rack = order.findIndex((n) => classesOf(n).includes("rack"));
  const lastCat = order.map((n, i) => (["body", "ear", "tail"].some((c) => classesOf(n).includes(c)) ? i : -1)).reduce((a, b) => Math.max(a, b));
  assert.ok(rack > lastCat, "the rack must come after every body, ear and tail in document order");
});

test("the ear and tail overlays sit wholly on their own body, so moving them exposes nothing", () => {
  const layers = layersOf(mascotDefs(0, 0, "dark"));
  for (const state of states()) {
    for (const part of ["ear", "tail"]) {
      for (const p of layers[`pose-${state}/${part}`].px) {
        assert.ok(layers[`pose-${state}/body`].px.has(p), `pose-${state} ${part} ink ${p} is not on the body`);
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------------------------

test("the mascot is drawn at the column and row it is given", () => {
  const at = layersOf(mascotDefs(0, 0, "dark"));
  const moved = layersOf(mascotDefs(3, 2, "dark"));
  assert.deepEqual(Object.keys(moved).sort(), Object.keys(at).sort());
  for (const key of Object.keys(at)) {
    const shifted = new Set([...at[key].px].map((p) => {
      const [x, y] = xy(p);
      return `${x + 3 * 2},${y + 2 * 2}`;
    }));
    assert.deepEqual([...moved[key].px].sort(), [...shifted].sort(), key);
  }
});
