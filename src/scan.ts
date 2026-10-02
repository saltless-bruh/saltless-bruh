import { CANVAS_W, CELL_H, CELL_W, PAD, colX } from "./grid.ts";
import { MASTER_SECONDS } from "./timeline.ts";
import { PALETTES } from "./tokens.ts";
import type { Palette, ThemeName } from "./tokens.ts";
// The band and the result line's hook belong to the module that reserves them. A second copy here
// could drift from that one with no test noticing, which is the BREATHS_PER_LOOP mistake exactly.
import { SCAN_ROWS, SCAN_RESULT_CLASS } from "./session.ts";
import type { Activity } from "./session.ts";

/**
 * The Scan Sweep: the contribution calendar drawn as a target network, with a scanner beam
 * crossing it once and busy days lighting up as hits.
 *
 * WHAT MAKES IT A SCAN RATHER THAN A HEATMAP. Before the beam arrives every cell looks identical:
 * present, unprobed, carrying no information. After it passes, each cell reports its own level.
 * That before/after difference is the whole effect. A heatmap with a line moving over it would
 * show every value from the first frame and the beam would be decoration.
 *
 * HOW IT IS BUILT. Not 371 rects and not 53 animated groups. The cells are compiled to one merged
 * path per level, and the reveal is a clip whose edge steps left to right across the band, so the
 * motion is four declarations rather than one per column. `clip-path: inset()` is a CSS function
 * and needs no id, which keeps the whole missing-reference failure class out of the document; a
 * referenced <clipPath> would also not be animatable. Both halves of that are verified by a real
 * headless render through an <img> tag, which is the restricted context GitHub serves this in.
 */

/** The calendar's shape. GitHub's own grid: a column per week, a row per weekday. */
export const WEEKS = 53;
export const DAYS = 7;

/**
 * One week is one grid column, so the sweep is 53 columns wide and fits inside the Session's 72.
 * Square cells, which is what GitHub's calendar uses, then set the row pitch from the column
 * pitch rather than from the text grid: 12 x 24 cells would read as a bar chart, not a grid.
 */
export const PITCH = CELL_W;
export const CELL = 10;
export const GAP = PITCH - CELL;
export const GRID_W = WEEKS * PITCH;
export const GRID_H = DAYS * PITCH;

/** Where the grid sits: under the result glyph, on the column the result text starts at. */
export const SCAN_COL = 5;

/** The beam, and how far it overhangs the grid at each end so it reads as passing over it. */
export const BEAM_W = 2;
export const BEAM_OVERHANG = 3;

/**
 * Fast enough not to gate the reader, slow enough to read as a scan rather than a wipe.
 * It fires once on load and then once per master loop: the widest moving element on the page
 * does not get to free-run on a short cycle.
 */
export const SWEEP_SECONDS = 2.5;

/**
 * The band reserves 4 rows (96 units) for 84 units of grid. The 12 units of slack are split
 * evenly, which is what keeps the beam's overhang inside the band instead of reaching into the
 * descenders of the /activity line above it.
 */
const SLACK = SCAN_ROWS * CELL_H - GRID_H;
if (SLACK < 2 * BEAM_OVERHANG) {
  throw new Error(`the sweep's ${SCAN_ROWS} rows leave ${SLACK} units around a ${GRID_H}-unit grid, too little for a beam overhanging ${BEAM_OVERHANG} at each end`);
}
const INSET_Y = SLACK / 2;

/** Left edge of the grid, in canvas units. */
export const scanX = (): number => colX(SCAN_COL);
/** Top edge of the grid, in canvas units, for a band starting at `row`. */
export const scanY = (row: number): number => PAD + row * CELL_H + INSET_Y;

if (scanX() + GRID_W > CANVAS_W - PAD) {
  throw new Error(`a ${GRID_W}-unit grid at column ${SCAN_COL} reaches ${scanX() + GRID_W}, past the window's inner edge at ${CANVAS_W - PAD}`);
}

// ---------------------------------------------------------------------------------------------
// The data
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayStart = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

/** One cell of the target network: a real day at its real position, with the level it reports. */
export type ScanCell = { week: number; day: number; level: number; count: number };

/** Levels a probed cell can report. 0 is present and silent; 1 to 4 are the lit ramp. */
export const MAX_LEVEL = 4;

/**
 * The counts that divide the lit days into four bands, by quartile of the days that have any
 * activity at all.
 *
 * Quartiles rather than a share of the maximum, because one exceptional day would otherwise push
 * every ordinary day into level 1 and the grid would report nothing but that one day. Zero days
 * are excluded from the quartiles for the same reason: a calendar is mostly zeros, so including
 * them would put three of the four thresholds at 0.
 */
export function levelThresholds(counts: number[]): number[] {
  const lit = counts.filter((c) => c > 0).sort((a, b) => a - b);
  if (lit.length === 0) return [];
  // Nearest-rank: the smallest value at or above the quantile's position in the sorted list.
  return [0.25, 0.5, 0.75].map((p) => lit[Math.min(lit.length - 1, Math.ceil(p * lit.length) - 1)]);
}

/** The level a count reports. A day with no contributions is level 0 whatever the thresholds say. */
export function levelOf(count: number, thresholds: number[]): number {
  if (count <= 0) return 0;
  return 1 + thresholds.filter((t) => count > t).length;
}

/**
 * The calendar as cells of the target network, each at the week and weekday its date really falls on.
 *
 * The window is 365 days laid into a 53 x 7 lattice, so 6 of the 371 positions carry no day: the
 * first and last weeks are partial, exactly as GitHub draws them. Those positions are left empty
 * rather than padded, because a cell with no day behind it would be a host that is not there.
 *
 * Nothing here invents a day. A calendar that is empty, out of order, has a gap, or reaches past
 * 53 weeks is a broken input and fails loudly, because the alternative is a grid of zeros and a
 * grid of zeros is a figure nobody measured.
 */
export function calendarCells(calendar: Activity["calendar"]): ScanCell[] {
  if (calendar.length === 0) {
    throw new Error("the calendar is empty, so there is nothing real to scan; a grid of zeros would be a figure nobody measured");
  }
  for (const d of calendar) {
    if (!ISO_DAY.test(d.date) || Number.isNaN(dayStart(d.date))) throw new Error(`the calendar has ${JSON.stringify(d.date)} where a YYYY-MM-DD date belongs`);
    if (!Number.isInteger(d.count) || d.count < 0) throw new Error(`the calendar day ${d.date} has a count of ${d.count}, which is not a whole number of contributions`);
  }
  for (let i = 1; i < calendar.length; i++) {
    const step = (dayStart(calendar[i].date) - dayStart(calendar[i - 1].date)) / DAY_MS;
    if (step !== 1) throw new Error(`the calendar jumps from ${calendar[i - 1].date} to ${calendar[i].date}; it must be consecutive days, oldest first`);
  }
  const thresholds = levelThresholds(calendar.map((d) => d.count));
  // The first column starts on the Sunday of the first day's week, which is where GitHub's does.
  const first = dayStart(calendar[0].date);
  const weekStart = first - new Date(first).getUTCDay() * DAY_MS;
  return calendar.map((d) => {
    const at = dayStart(d.date);
    const offset = (at - weekStart) / DAY_MS;
    const week = Math.floor(offset / DAYS);
    if (week >= WEEKS) throw new Error(`${d.date} falls in week ${week} of a ${WEEKS}-week grid; the calendar is longer than the window it is drawn in`);
    return { week, day: offset % DAYS, level: levelOf(d.count, thresholds), count: d.count };
  });
}

// ---------------------------------------------------------------------------------------------
// The paint
// ---------------------------------------------------------------------------------------------

/**
 * What each state paints with.
 *
 * The ramp is `0.35 + 0.65 * level/4`, measured perceptually even in docs/design-contract.md:
 * compositing the accent over the background and converting to CIE L* gives steps of 8.6, 8.1,
 * 8.2 in dark and 8.3, 8.7, 8.4 in light. Solving for perfectly even steps moves the alphas by at
 * most 0.03, which is invisible. The linear ramp stands; this is recorded so it is not retuned.
 *
 * The hit is the `text` token rather than the accent at full. The accent at full IS level 4, so a
 * hit painted in it would be a flare that does nothing on the busiest day in the grid, which is
 * the one day that most needs to flare. `text` is the only token brighter than the accent in both
 * variants, and it ties the flare to the beam, which is the light causing it.
 */
const UNPROBED = { token: "border" as keyof Palette, alpha: 0.3 };
const PROBED_SILENT = { token: "border" as keyof Palette, alpha: 0.45 };
const LIT_TOKEN: keyof Palette = "accent";
const BEAM = { token: "text" as keyof Palette, alpha: 0.95 };
const TRAIL = { token: LIT_TOKEN, alpha: 0.22 };
const HIT = { token: "text" as keyof Palette, alpha: 1 };

/** Levels bright enough to be worth calling a hit: the top two bands of the ramp. */
export const HIT_LEVELS = [3, 4];

/**
 * A hit fills its whole pitch, gap included, instead of sitting inside it like every other cell.
 *
 * Colour alone could not carry this. The accent at full IS level 4, and `text`, the only token
 * brighter than it in either variant, measures 1.25:1 against level 4 in dark and 1.13:1 in light:
 * a hue shift most viewers would never register, on the very days the band exists to announce.
 * The palette has nothing brighter left, so the lever is geometry.
 *
 * It is also the better lever. By the time the beam arrives the eye has learned the grid's rhythm,
 * 53 columns of evenly gapped squares, and a cell that momentarily closes its gaps breaks that
 * rhythm. A broken rhythm is far more visible than a 25% luminance change on a 10-unit square.
 * Consecutive busy days in one column merge into a short solid bar, which is wanted rather than
 * tolerated: a run of busy days reading as one strong response is what a scanner would show.
 *
 * It stays inside the grid at the edges: a hit in the last week reaches exactly the grid's right
 * edge, and one on the last day exactly its bottom, because the grid is a whole number of pitches.
 */
const HIT_SIZE = PITCH;

export const levelAlpha = (level: number): number => 0.35 + 0.65 * (level / MAX_LEVEL);

const paintOf = (level: number): { token: keyof Palette; alpha: number } =>
  level === 0 ? PROBED_SILENT : { token: LIT_TOKEN, alpha: levelAlpha(level) };

/** One square per cell, `size` units on a side. Cells never touch, so the saving is one path per layer. */
function cellsToPath(cells: ScanCell[], x0: number, y0: number, size: number): string {
  return cells.map((c) => `M${x0 + c.week * PITCH} ${y0 + c.day * PITCH}h${size}v${size}h-${size}z`).join("");
}

const rect = (cls: string, x: number, y: number, w: number, h: number, p: Palette, paint: { token: keyof Palette; alpha: number }): string =>
  `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" fill="${p[paint.token]}" fill-opacity="${paint.alpha}"/>`;

const path = (cls: string, d: string, p: Palette, paint: { token: keyof Palette; alpha: number }): string =>
  d === "" ? "" : `<path class="${cls}" d="${d}" fill="${p[paint.token]}" fill-opacity="${paint.alpha}"/>`;

/**
 * The sweep's geometry, as layers a travelling clip reveals.
 *
 * `.unprobed` retreats as `.probed` advances rather than being painted under it. Two translucent
 * layers stacked would composite to neither one's measured alpha, so level 1 would not be the
 * level 1 the ramp was measured at; the dim layer exists only ahead of the beam, which is also
 * what it means.
 */
export function scanDefs(a: Activity, row: number, theme: ThemeName): string {
  const p = PALETTES[theme];
  const cells = calendarCells(a.calendar);
  const x0 = scanX();
  const y0 = scanY(row);

  const unprobed = path("unprobed", cellsToPath(cells, x0, y0, CELL), p, UNPROBED);
  const levels = Array.from({ length: MAX_LEVEL + 1 }, (_, level) =>
    path(`lv${level}`, cellsToPath(cells.filter((c) => c.level === level), x0, y0, CELL), p, paintOf(level)),
  ).filter(Boolean).join("\n");
  const busy = path("busy", cellsToPath(cells.filter((c) => HIT_LEVELS.includes(c.level)), x0, y0, HIT_SIZE), p, HIT);

  // The trail is the cell body the beam has just entered; the beam is the bright leading edge at
  // that cell's far side, which lands in the 2-unit gutter between that cell and the next, so it
  // never covers a cell. Both sit inside the grid at every step, so neither hangs off the end.
  // A hit fills that gutter, and is painted over the head, so where a busy day is being crossed
  // the beam and the hit merge into one bright block. Both are `text` within 0.05 of each other,
  // so there is no seam, and the beam reading as absorbed into the hit is the effect wanted.
  const head = [
    rect("trail", x0, y0, CELL, GRID_H - GAP, p, TRAIL),
    rect("beam", x0 + CELL, y0 - BEAM_OVERHANG, BEAM_W, GRID_H - GAP + 2 * BEAM_OVERHANG, p, BEAM),
  ].join("\n");

  // The head is painted FIRST, under the cells. Drawn last, the trail lay over the column it was
  // crossing and tinted it: a hit, which is the brightest thing in the grid and the whole point of
  // the band, came out dulled by the glow that is supposed to be announcing it. Underneath, the
  // trail brightens the column it crosses and leaves the hit at full. The beam does not care
  // either way, because it sits in the gutter where no cell paints.
  return `<g class="sweep">
<g class="head">
${head}
</g>
${unprobed}
<g class="probed">
${levels}
</g>
<g class="hits">
${busy}
</g>
</g>`;
}

// ---------------------------------------------------------------------------------------------
// The motion
// ---------------------------------------------------------------------------------------------

/** Seconds to a percentage of the master loop, to the millisecond. */
const pct = (seconds: number): string => `${Number(((seconds / MASTER_SECONDS) * 100).toFixed(3))}%`;

/** The right edge of the reveal after `k + 1` whole columns, in canvas units. */
const boundary = (k: number): number => scanX() + (k + 1) * PITCH;

/**
 * The clip insets are measured from the SVG viewport, not from the clipped group's own bounding
 * box, which is what `view-box` asks for. The box a group would otherwise use is the box of what
 * it happens to contain, and `.hits` contains only the busy cells, so its box moves with the
 * owner's data. Against the viewport every stop below is an absolute canvas coordinate and the
 * reveal lands on the same column whatever the year looked like.
 */
const clip = (inset: string): string => `clip-path: inset(${inset}) view-box`;

const revealed = (k: number): string => clip(`0 ${CANVAS_W - boundary(k)}px 0 0`);
const ahead = (k: number): string => clip(`0 0 0 ${boundary(k)}px`);
const window1 = (k: number): string => clip(`0 ${CANVAS_W - boundary(k)}px 0 ${boundary(k) - PITCH}px`);
const travel = (k: number): string => `transform: translateX(${k * PITCH}px)`;

/** The finished still frame: every column probed, nothing dim left, no beam, no flare. */
const SETTLED = {
  unprobed: ahead(WEEKS - 1),
  probed: revealed(WEEKS - 1),
  hits: clip(`0 0 0 ${boundary(WEEKS - 1)}px`),
  head: "opacity: 0",
};

/**
 * One keyframe block, stepped column by column.
 *
 * The stops are written out rather than left to a `steps()` timing function, because each one is
 * then an exact canvas coordinate that a test can check against the geometry, and the last stop
 * is literally the base rule rather than one step past it.
 */
function keyframes(name: string, at: (k: number) => string, settled: string): string {
  const stop = (k: number): string => pct((k * SWEEP_SECONDS) / WEEKS);
  const steps = Array.from({ length: WEEKS }, (_, k) => `${stop(k)}{${at(k)}}`).join("");
  return `@keyframes ${name}{${steps}${stop(WEEKS)}{${settled}}}`;
}

/**
 * The motion layer.
 *
 * Base is the finished still frame and every animation drives away from it and returns, so the
 * one `animation: none` rule in src/svg.ts leaves a reduced-motion reader looking at the finished
 * grid with its result line, which is the content. Nothing here animates anything but `opacity`,
 * `transform` and the clip inset.
 */
export function scanCss(): string {
  const loop = `${MASTER_SECONDS}s step-end infinite`;
  const settle = pct(SWEEP_SECONDS);
  return `
.sweep .unprobed { ${SETTLED.unprobed}; animation: scan-ahead ${loop} }
.sweep .probed { ${SETTLED.probed}; animation: scan-reveal ${loop} }
.sweep .hits { ${SETTLED.hits}; animation: scan-hits ${loop} }
.sweep .head { ${SETTLED.head}; animation: scan-head ${loop} }
.${SCAN_RESULT_CLASS} { opacity: 1; animation: scan-result ${loop} }
${keyframes("scan-ahead", ahead, SETTLED.unprobed)}
${keyframes("scan-reveal", revealed, SETTLED.probed)}
${keyframes("scan-hits", window1, SETTLED.hits)}
${keyframes("scan-head", (k) => `${travel(k)};opacity:1`, SETTLED.head)}
@keyframes scan-result{0%{opacity:0}${settle}{opacity:1}}
`;
}
