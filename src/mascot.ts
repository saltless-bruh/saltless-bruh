import { CELL_H, CELL_W, PAD, colX } from "./grid.ts";
import { inkLeft, loadGlyphs, loadGrid, parseGrid, runsOf, runsToPath, sharedInkLeft } from "./pixelart.ts";
import type { Box, Grid, Run } from "./pixelart.ts";
import { MASCOT_TIMELINE, MASTER_SECONDS } from "./timeline.ts";
import type { PoseName } from "./timeline.ts";
import { PALETTES } from "./tokens.ts";
import type { Palette, ThemeName } from "./tokens.ts";

/**
 * The Mascot is pixel art kept as character grids in art/: one 64 x 28 file per pose, one character
 * per art pixel. One art pixel is half a column wide and a quarter of a row tall, which is square, so
 * the scene is exactly 32 columns by 7 rows with every pixel on the text grid and nothing resampled.
 *
 * Rows 0 to 10 are the cat and rows 11 to 27 are the rack. The rack is identical in every pose, so
 * it is drawn once and shared; each pose draws only the cat.
 *
 * Seams. Every colour is its own <path>, and two paths that merely touch can show a hairline between
 * them once the image is scaled to a fractional width. So a colour that sits on another is drawn over
 * a shape that already covers it: the speckles over the whole body, the frame, vents and LEDs over the
 * whole rack panel.
 *
 * Character 3 means two things. In the cat it is an eye, drawn as a hole in the body (the window
 * showing through). In the rack rows it is the frame: the outer edge and the lines between the three
 * units. The rack panel is `surface`, which sits within 1.06:1 to 1.15:1 of the window, so a panel
 * alone has no silhouette; the one-pixel `border` frame carries it, the same device the Session window uses.
 */
const ART = new URL("../art/", import.meta.url);
const GRID_W = 64;
const GRID_H = 28;
const RACK_FROM = 11;

const PX = CELL_W / 2;
if (PX !== CELL_H / 4) throw new Error(`an art pixel must be square: ${CELL_W} / 2 is not ${CELL_H} / 4`);

function cells(pixels: number, cell: number, what: string): number {
  const n = (pixels * PX) / cell;
  if (!Number.isInteger(n)) throw new Error(`${pixels} art pixels do not fill a whole number of ${what}`);
  return n;
}
export const MASCOT_COLS = cells(GRID_W, CELL_W, "columns");
export const MASCOT_ROWS = cells(GRID_H, CELL_H, "rows");

/**
 * Which token each grid character is painted with. `bg` is the window itself, so it is left
 * unpainted: eyes and the rack's dark lines are holes.
 */
const RECOLOUR: Record<string, keyof Palette> = {
  "1": "muted", "2": "text", "3": "bg", "4": "accent", "5": "surface", "6": "accent", "7": "muted", "8": "border", "9": "border",
};
const GLYPHS = loadGlyphs(new URL("palette.json", ART));
if ([...GLYPHS].sort().join("") !== Object.keys(RECOLOUR).sort().join("")) {
  throw new Error(`art/palette.json defines ${GLYPHS} but the recolour table covers ${Object.keys(RECOLOUR).join("")}`);
}

/**
 * One path per painted character, in the token the recolour table gives it unless `token` says
 * otherwise. `under` lists further characters the path also covers, so a colour drawn over it has it underneath.
 */
type Ink = { char: string; cls: string; under?: string; token?: keyof Palette };
const tokenOf = (i: Ink): keyof Palette => i.token ?? RECOLOUR[i.char];

const CAT: Ink[] = [
  { char: "2", cls: "body", under: "4" },
  { char: "4", cls: "detail" },
  { char: "1", cls: "faint" },
];
/** In the rack rows, the dark lines are the frame, drawn in this token rather than left as holes. */
const FRAME_TOKEN: keyof Palette = "border";
const RACK: Ink[] = [
  { char: "5", cls: "panel", under: "3678" },
  { char: "3", cls: "frame", token: FRAME_TOKEN },
  { char: "8", cls: "vent" },
  { char: "7", cls: "led-dim" },
  { char: "9", cls: "plinth" },
];
/** The lit LEDs, drawn per rack unit so each can flicker on its own clock. */
const LIT = "6";
const RACK_ONLY = "56789";



const REST: PoseName = MASCOT_TIMELINE[0].state;
const POSES = Object.fromEntries(
  [...new Set(MASCOT_TIMELINE.map((w) => w.state))].map((name) => [name, loadGrid(new URL(`${name}.grid.txt`, ART), { glyphs: GLYPHS, width: GRID_W, height: GRID_H })]),
) as Record<PoseName, Grid>;

// The rack is emitted once, from the rest pose, so every pose must agree with it. Checked here, not assumed.
for (const [name, grid] of Object.entries(POSES)) {
  grid.rows.forEach((row, y) => {
    if (y < RACK_FROM && [...row].some((c) => RACK_ONLY.includes(c))) throw new Error(`${grid.name}: rack character in the cat rows at row ${y}`);
    if (y >= RACK_FROM && row !== POSES[REST].rows[y]) throw new Error(`${grid.name}: rack row ${y} differs from ${POSES[REST].name}, but the rack is drawn once (${name})`);
  });
}

/**
 * The leftmost art pixel the scene actually paints, measured from the artwork instead of written
 * down here. The source grids carry empty columns on their left, so a scene placed by its grid sets
 * its visible edge that far right of the text underneath it, which reads as a misalignment because
 * it is one. `mascotDefs` subtracts this, so the column it is handed is the column the ink lands on.
 * Deriving it is the point: retouching the art moves the offset with it instead of silently
 * breaking the alignment against a hand-typed number. Every pose must agree on that edge, which is
 * what `sharedInkLeft` holds, so a retouched pose fails the build rather than the eye.
 */
export const MASCOT_INK_LEFT = sharedInkLeft(Object.values(POSES));

// In each region a character is either painted or deliberately the window (`bg`); a table entry nothing uses is a mistake.
const charsIn = (rows: string[]): Set<string> => new Set([...rows.join("")].filter((c) => c !== " "));
for (const [region, inks, chars] of [
  ["cat", CAT, charsIn(Object.values(POSES).flatMap((g) => g.rows.slice(0, RACK_FROM)))],
  ["rack", [...RACK, { char: LIT, cls: "led" }], charsIn(POSES[REST].rows.slice(RACK_FROM))],
] as [string, Ink[], Set<string>][]) {
  for (const ch of chars) {
    const ink = inks.find((i) => i.char === ch);
    if (!ink && RECOLOUR[ch] !== "bg") throw new Error(`${region}: character ${ch} is recoloured to ${RECOLOUR[ch]} but nothing paints it`);
    if (ink && tokenOf(ink) === "bg") throw new Error(`${region}: character ${ch} is painted in bg, which is the window`);
  }
}

const CAT_ROWS: Box = { x0: 0, x1: GRID_W, y0: 0, y1: RACK_FROM };
const RACK_ROWS: Box = { x0: 0, x1: GRID_W, y0: RACK_FROM, y1: GRID_H };

/**
 * The right ear: the topmost ink in these columns, plus the head-top pixel under it.
 *
 * This slab is painted twice on purpose. The static pass keeps it and the `.ear` group draws it again, so what the
 * flick shows is the union of a slab at rest and the same slab a unit higher: the ear **stretches**, its tip
 * extending and straightening while its base stays welded to the head. It is not a displacement, and the second
 * copy is load-bearing, not waste. Four of the five poses carry head ink directly under the slab (`sleep`,
 * `stretch` and `settle` at both columns, `startle` at column 29 beside the open eye), so cutting the slab from
 * the static pass would lift the whole thing and open a strip of window the height of the lift underneath it.
 * Only `yawn` has a silhouette break of its own there. A test pins both halves of this, so the tempting
 * "do not paint it twice" cleanup fails loudly rather than quietly unsticking the ear.
 */
const EAR_X: [number, number] = [29, 31];
const EAR_DEPTH = 2;
/**
 * The tail is the stray ink at the far end of the body, below the zZz, drawn detached from it.
 *
 * Unlike the ear, this box is cut out of the static pass, so the `.tail` group holds the **only** copy of those
 * pixels and its flick displaces them. Painted twice, a sideways flick would show both positions at once and the
 * tail would read as swelling rather than moving. The displacement is safe only because the tail touches no other
 * cat ink: a test holds that invariant for every pose, since joining the tail to the body would make the same
 * flick tear a seam open mid-sprite.
 */
const TAIL: Box = { x0: 45, x1: 48, y0: 5, y1: RACK_FROM };

/** The same rows with a box blanked out, so a pass over them leaves those pixels to whoever else draws them. */
const cutOut = (rows: string[], box: Box): string[] =>
  rows.map((row, y) => (y >= box.y0 && y < box.y1 ? row.slice(0, box.x0) + " ".repeat(box.x1 - box.x0) + row.slice(box.x1) : row));

function earBox(grid: Grid): Box {
  const tip = grid.rows.slice(0, RACK_FROM).findIndex((row) => /[24]/.test(row.slice(EAR_X[0], EAR_X[1])));
  if (tip < 0) throw new Error(`${grid.name}: no ear in columns ${EAR_X[0]} to ${EAR_X[1] - 1}`);
  return { x0: EAR_X[0], x1: EAR_X[1], y0: tip, y1: tip + EAR_DEPTH };
}

/** One lit-LED group per rack unit; a unit lies between two of the rack's dark dividing lines. */
const LED_PERIODS = [7, 11, 13];
const DIVIDERS = POSES[REST].rows.map((_, y) => y).filter((y) => y >= RACK_FROM && /^ *3+ *$/.test(POSES[REST].rows[y]));
const UNITS: Box[] = DIVIDERS.slice(1).map((y, k) => ({ x0: 0, x1: GRID_W, y0: DIVIDERS[k] + 1, y1: y }));
if (UNITS.length !== LED_PERIODS.length) throw new Error(`the rack has ${UNITS.length} units but ${LED_PERIODS.length} LED periods`);

/** A small grid placed at (x, y) in the scene. */
type Stamp = { x: number; y: number; grid: Grid };
const stamp = (name: string, x: number, y: number, rows: string[]): Stamp => ({ x, y, grid: parseGrid(rows.join("\n"), { name, glyphs: GLYPHS }) });

/**
 * The nose bubble in four steps, growing up and to the left from one pixel at x21 row 7 into the free
 * space beside the head, then the burst ring it pops into. The lightest tint, so it reads as translucent.
 */
const BUBBLE: Stamp[] = [
  stamp("bubble step 0", 21, 7, ["1"]),
  stamp("bubble step 1", 20, 6, ["11", "11"]),
  stamp("bubble step 2", 19, 5, [" 1 ", "1 1", " 11"]),
  stamp("bubble step 3", 19, 5, ["111", "1 1", "111"]),
];
const BURST: Stamp = stamp("bubble burst", 17, 4, ["  1  ", " 1 1 ", "1   1", " 1 1 ", "  1  "]);

// The bubble is stamped at its own coordinates rather than taken from a pose grid, so it is the one
// thing that could reach left of the edge the scene is placed by and quietly become the leftmost ink.
for (const s of [...BUBBLE, BURST]) {
  const x = s.x + inkLeft(s.grid.rows);
  if (x < MASCOT_INK_LEFT) throw new Error(`${s.grid.name}: starts at art pixel ${x}, left of the scene's ink edge at ${MASCOT_INK_LEFT}`);
}

export function mascotDefs(col: number, row: number, theme: ThemeName): string {
  const p = PALETTES[theme];
  // Placed by its ink, not by its grid: `col` is the column the leftmost painted pixel lands on.
  const x0 = colX(col) - MASCOT_INK_LEFT * PX;
  const y0 = PAD + row * CELL_H;
  const path = (cls: string, runs: Run[], token: keyof Palette): string =>
    runs.length === 0 ? "" : `<path class="${cls}" d="${runsToPath(runs, x0, y0, PX)}" fill="${p[token]}"/>`;
  /** One path per ink; one that has no pixels in the box is left out. */
  const paints = (rows: string[], list: Ink[], box: Box): string =>
    list.map((i) => path(i.cls, runsOf(rows, i.char + (i.under ?? ""), box), tokenOf(i))).filter(Boolean).join("\n");
  const stampRuns = (s: Stamp): Run[] => runsOf(s.grid.rows, "1").map((r) => ({ ...r, x: r.x + s.x, y: r.y + s.y }));

  /**
   * A cat that rests on the frame line has its bottom row continued one row lower, behind the frame, which paints over it.
   * Without it the breath's one-unit lift leaves a hairline of window between the feet and the line at most widths.
   */
  const foot = (rows: string[]): string => {
    const bottom = rows.slice(0, RACK_FROM).findLastIndex((row) => /[24]/.test(row));
    if (bottom !== RACK_FROM - 1) return "";
    const under = rows.map((_, y) => (y === RACK_FROM ? rows[bottom] : " ".repeat(GRID_W)));
    return `<g class="foot">${paints(under, CAT, { x0: 0, x1: GRID_W, y0: RACK_FROM, y1: RACK_FROM + 1 })}</g>\n`;
  };

  /**
   * A part an animation displaces must be drawn once, or the animation shows both positions at once. So the tail is
   * cut out of the static pass and the `.tail` group carries it alone. The ear is deliberately left in: see EAR_X.
   * The feet are continued from the untouched grid, because the tail occupies part of the bottom cat row.
   */
  const pose = (name: PoseName): string => {
    const { rows } = POSES[name];
    return `<g class="pose pose-${name}">
${foot(rows)}${paints(cutOut(rows, TAIL), CAT, CAT_ROWS)}
<g class="ear">${paints(rows, CAT, earBox(POSES[name]))}</g>
<g class="tail">${paints(rows, CAT, TAIL)}</g>
</g>`;
  };

  const rackRows = POSES[REST].rows;
  const leds = UNITS.map((u, k) => path(`led led-${k}`, runsOf(rackRows, LIT, u), RECOLOUR[LIT])).join("\n");
  const bubbles = [...BUBBLE.map((s, k) => path(`bubble bubble-${k}`, stampRuns(s), RECOLOUR["1"])), path("bubble burst", stampRuns(BURST), RECOLOUR["1"])].join("\n");

  // The cat and its bubble breathe together; the rack is still and is painted last, over the continued feet.
  return `<g class="mascot">
<g class="breath">
${(Object.keys(POSES) as PoseName[]).map(pose).join("\n")}
${bubbles}
</g>
<g class="rack">
${paints(rackRows, RACK, RACK_ROWS)}
${leds}
</g>
</g>`;
}

/** Seconds to a percentage of the master loop, to the millisecond. */
const pct = (seconds: number): string => `${Number(((seconds / MASTER_SECONDS) * 100).toFixed(3))}%`;

/** 20 breaths a minute, inside a sleeping cat's range. The master loop must be a whole number of them so it joins on a breath. */
const BREATH_SECONDS = 3;
if (MASTER_SECONDS % BREATH_SECONDS !== 0) throw new Error(`the ${MASTER_SECONDS}s loop is not a whole number of ${BREATH_SECONDS}s breaths`);
const EAR_SECONDS = 17;
const TAIL_SECONDS = 23;

/**
 * The shape of one gesture inside its own cycle. These describe a gesture, not a moment in the story, so they have no
 * counterpart in MASCOT_TIMELINE and stay literal.
 *
 * Amplitude is exactly one art pixel, which is PX units and not 1. A sprite drawn on a pixel lattice moves in lattice
 * steps: `shape-rendering="crispEdges"` snaps anything smaller to nothing or to a device pixel depending on the render
 * width, so a sub-pixel idle move reads as edge jitter rather than motion. Measured on the real render, a one-unit
 * breath changed 178 device pixels at the 846px width and 9 at 308px, against 981 and 131 for one art pixel: at phone
 * width the small version was close to invisible. One art pixel is also the ceiling, and that ceiling is `foot()`:
 * the cat's bottom row is continued exactly one art pixel behind the rack frame, so a lift of PX is covered and a lift
 * of PX + 1 would expose a strip of window under the feet. A test holds the amplitude at exactly that.
 *
 * Two kinds, written in two units on purpose. A **breath** is genuinely a fraction of a breath: it rises for the middle
 * of its cycle whatever that cycle lasts, so percentages are the honest unit. A **flick** is an event with a length of
 * its own, and a percentage of a 17s or 23s cycle is not: retune the cycle and the flick silently changes speed. So a
 * flick states its milliseconds and they are converted against whatever cycle carries it. This is the lesson
 * BREATH_SECONDS already carries at the top of this block, applied to the gestures that sit under it.
 */
const BREATH_MOVE = { awayAt: 46.7, backAt: 93.3, by: -PX };    // rises for the middle of the breath, then steps back down
const EAR_MOVE = { afterMs: 85, forMs: 119, by: -PX };          // a quick flick near the start of its cycle: the tip lifts
const TAIL_MOVE = { afterMs: 230, forMs: 345, by: PX };         // a quick flick near the start of its cycle: the tip slides
/**
 * The LEDs are a status flash: `forMs` is how long one stays lit, wall-clock, so the three differ only in how often they
 * flash and never in how long. Written as a share of the cycle instead, one shared keyframe made the same flash 350ms,
 * 550ms and 650ms on the 7s, 11s and 13s units. `dim` is the level between flashes: low, but never dark, because the
 * machine is never off.
 *
 * `staggerMs` is what keeps them independent. Unit k lights (k + 1) staggers into its own cycle, so on load they fire in
 * sequence rather than together: three units that happen to agree read as one synchronised part, which argues against
 * the thing the co-prime periods exist to express. The spacing is deliberately the flash's own length, which has a
 * stronger consequence than spreading the first pass. A flash is [s, s + 200) with s = 200(k + 1) + period x 1000 x n,
 * so every lit window begins and ends on a 200ms boundary and two windows could only overlap by coinciding exactly;
 * that needs 7000a - 11000b = 200, or 35a - 55b = 1, whose left side is a multiple of 5. No two of these three LEDs are
 * ever lit at the same instant, not once in the 1001s it takes their periods to realign. A test checks that exhaustively.
 */
const LED_FLASH = { staggerMs: 200, forMs: 200, dim: 0.25 };

/** A stop in a cycle, as a percentage to four places, which is under a millisecond for every cycle here. */
const ofCycle = (fraction: number): string => `${Number((fraction * 100).toFixed(4))}%`;

/** A gesture's two stops, already percentages of the cycle it runs on. */
type Stops = { awayAt: string; backAt: string; by: number };

/** A gesture that is a fraction of its cycle, which is what a breath is. */
const shape = (g: { awayAt: number; backAt: number; by: number }): Stops =>
  ({ awayAt: `${g.awayAt}%`, backAt: `${g.backAt}%`, by: g.by });

/** A gesture of a fixed length, placed in a cycle of `seconds`. A cycle too short to hold it is a mistake, not a clamp. */
function flick(g: { afterMs: number; forMs: number; by: number }, seconds: number): Stops {
  const ms = seconds * 1000;
  if (g.afterMs + g.forMs >= ms) throw new Error(`a ${seconds}s cycle cannot hold a ${g.forMs}ms flick starting at ${g.afterMs}ms`);
  return { awayAt: ofCycle(g.afterMs / ms), backAt: ofCycle((g.afterMs + g.forMs) / ms), by: g.by };
}

/** One gesture: rest, away by `by` units along an axis, and back to rest. */
const move = (name: string, axis: "X" | "Y", g: Stops): string =>
  `@keyframes ${name} { 0% { transform: translate${axis}(0) } ${g.awayAt} { transform: translate${axis}(${g.by}px) } ${g.backAt} { transform: translate${axis}(0) } }`;

/** `@keyframes` name for one rack unit's flash. Each unit has its own offset, so each has its own keyframes. */
const ledName = (unit: number): string => `led-flash-${unit}`;

/** How far into its own cycle unit `k` lights, in milliseconds. */
const ledAtMs = (unit: number): number => (unit + 1) * LED_FLASH.staggerMs;

/** The flash as a share of one cycle of `seconds`, so every LED is lit for LED_FLASH.forMs however often it fires. */
function ledFlash(unit: number, seconds: number): string {
  const ms = seconds * 1000;
  const at = ledAtMs(unit);
  if (at + LED_FLASH.forMs >= ms) throw new Error(`a ${seconds}s LED cycle cannot hold a ${LED_FLASH.forMs}ms flash at ${at}ms`);
  return `@keyframes ${ledName(unit)} { 0% { opacity: ${LED_FLASH.dim} } ${ofCycle(at / ms)} { opacity: 1 } ${ofCycle((at + LED_FLASH.forMs) / ms)} { opacity: ${LED_FLASH.dim} } }`;
}

type Span = [number, number];

/** Keyframes that show a layer during the spans and hide it for the rest of the loop. One stop per change. */
function showDuring(name: string, spans: Span[]): string {
  const stops = new Map<number, number>([[0, 0]]);
  for (const [from, to] of spans) {
    stops.set(from, 1);
    stops.set(to, 0);
  }
  const body = [...stops].sort((a, b) => a[0] - b[0]).map(([t, shown]) => `${pct(t)} { opacity: ${shown} }`).join(" ");
  return `@keyframes ${name} { ${body} }`;
}

/** The windows a state occupies, so a layer's keyframes cannot drift from the timeline. */
const spansOf = (state: PoseName): Span[] =>
  MASCOT_TIMELINE.filter((w) => w.state === state).map((w): Span => [w.from, w.to]);

/**
 * The burst is an impact, so it is the fastest thing in the loop and owns its length outright. A share of the startle
 * window would make the pop as slow as whatever that window happens to be: at 800ms it was a 400ms flash, twice the
 * length of the hit it depicts, and retiming the window would have changed it again.
 */
const BURST_MS = 200;

/**
 * The bubble inflates in equal steps across the window before startle and bursts at the very
 * instant startle begins. That instant is the point of the gesture; the burst's own length is BURST_MS.
 */
function bubbleSpans(): { steps: Span[]; burst: Span } {
  const i = MASCOT_TIMELINE.findIndex((w) => w.state === "startle");
  if (i < 1) throw new Error("the nose bubble needs a window before the startle window to inflate in");
  const grow = MASCOT_TIMELINE[i - 1];
  const pop = MASCOT_TIMELINE[i];
  const edges = BUBBLE.map((_, k) => grow.from + ((grow.to - grow.from) * k) / BUBBLE.length);
  edges.push(pop.from);   // the last step ends exactly where startle begins, not where float sums land
  const burstFor = BURST_MS / 1000;
  if (burstFor >= pop.to - pop.from) throw new Error(`a ${BURST_MS}ms burst outlasts the ${((pop.to - pop.from) * 1000).toFixed(0)}ms startle window it pops in`);
  return {
    steps: BUBBLE.map((_, k): Span => [edges[k], edges[k + 1]]),
    burst: [pop.from, pop.from + burstFor],
  };
}

/**
 * The base rules are the still frame: the pose the loop starts and ends on is visible and
 * everything else, including the bubble, is hidden. The animations drive away from that frame and
 * back, so a viewer who has asked for reduced motion (`animation: none`) is left on it.
 */
export function mascotCss(): string {
  const poses = [...new Set(MASCOT_TIMELINE.map((w) => w.state))];
  const { steps, burst } = bubbleSpans();
  const onClock = (cls: string, name: string): string => `.${cls} { animation: ${name} ${MASTER_SECONDS}s step-end infinite }`;
  return `
.pose { opacity: 0 }
.pose-${MASCOT_TIMELINE[0].state} { opacity: 1 }
.bubble { opacity: 0 }
${poses.map((s) => onClock(`pose-${s}`, `m-${s}`)).join("\n")}
${steps.map((_, k) => onClock(`bubble-${k}`, `bubble-${k}`)).join("\n")}
${onClock("burst", "burst")}
.breath { animation: breathe ${BREATH_SECONDS}s step-end infinite }
.ear { animation: ear ${EAR_SECONDS}s step-end infinite }
.tail { animation: tail ${TAIL_SECONDS}s step-end infinite }
${LED_PERIODS.map((s, i) => `.led-${i} { animation: ${ledName(i)} ${s}s step-end infinite }`).join("\n")}
${poses.map((s) => showDuring(`m-${s}`, spansOf(s))).join("\n")}
${steps.map((span, k) => showDuring(`bubble-${k}`, [span])).join("\n")}
${showDuring("burst", [burst])}
${move("breathe", "Y", shape(BREATH_MOVE))}
${move("ear", "Y", flick(EAR_MOVE, EAR_SECONDS))}
${move("tail", "X", flick(TAIL_MOVE, TAIL_SECONDS))}
${LED_PERIODS.map((s, i) => ledFlash(i, s)).join("\n")}
`;
}
