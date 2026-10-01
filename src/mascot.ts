import { artToPath } from "./blockart.ts";
import { MASCOT_TIMELINE, MASTER_SECONDS } from "./timeline.ts";
import type { PoseName } from "./timeline.ts";
import { PALETTES } from "./tokens.ts";
import type { ThemeName } from "./tokens.ts";

export const MASCOT_COLS = 24;
export const MASCOT_ROWS = 10;

/**
 * Layout, top to bottom: rows 0-5 are the cat, rows 6-9 are the rack. The top two rows stay
 * clear in the sleeping pose so the zZz and the nose bubble have somewhere to go.
 *
 * Seams. Every layer is its own <path>, and two paths that merely touch can show a hairline
 * between them once the image is scaled to a fractional width. So nothing here relies on two
 * layers meeting edge to edge:
 *   - Each pose carries one extra row (row 6, which is also the rack's plate row). It repeats the
 *     cat's lowest ink and is drawn BEHIND the rack, so the cat runs underneath the plate instead
 *     of stopping at it. That also lets the breath lift the cat without opening a slit.
 *   - The ear and tail layers are copies of a region of their own pose's body, drawn on top of it.
 *     Moving a copy can only reveal body ink that is already there.
 *   - The LEDs sit in clear air, a full cell or more from any other ink.
 */
const RACK: string[] = [
  "████████████████████████",
  "█ ▄▄▄▄▄▄▄▄▄▄▄▄▄▄       █",
  "█ ▄▄▄▄▄▄▄▄▄▄▄▄▄▄       █",
  "█ ▄▄▄▄▄▄▄▄▄▄▄▄▄▄       █",
];
const RACK_ROW = MASCOT_ROWS - RACK.length;

/** One status LED per unit, at the right end of its bar. A bar's period is its LED's period. */
const LED_ART = ["▄▄"];
const LED_COL = 19;
const LED_PERIODS = [7, 11, 13];

/** Cells, half-open: the right-hand ear, and the tail at the right edge. */
type Region = { cols: [number, number]; rows: [number, number] };
const EAR: Region = { cols: [17, 21], rows: [0, 4] };
const TAIL: Region = { cols: [22, 24], rows: [0, 6] };

// Seven rows each: rows 0-5 are visible, row 6 is the part that runs under the rack plate.
const POSES: Record<PoseName, string[]> = {
  sleep: [
    "                        ",
    "                        ",
    "   ▄██▄          ▄██▄   ",
    "  ████████████████████ ▄",
    "  ████▄▄▄██▀▀██▄▄▄████▄█",
    "  ████████▄██▄██████████",
    "  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
  ],
  yawn: [
    "                        ",
    "                        ",
    "   ▄██▄          ▄██▄   ",
    "  ████▀▀▀██████▀▀▀████ ▄",
    "  ████████▀  ▀████████▄█",
    "  ████████▄▄▄▄██████████",
    "  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
  ],
  stretch: [
    "                        ",
    "    ▄▄            ▄▄   ▄",
    "  ▄████▄▄▄▄▄▄▄▄▄▄████▄ █",
    "  ████▀▀▀██████▀▀▀████ █",
    "  ████████▀▄▄▀████████▄█",
    "████████████████████████",
    "▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
  ],
  settle: [
    "                        ",
    "                        ",
    "   ▄▄▄▄          ▄▄▄▄   ",
    "  ████████████████████  ",
    "  ████▄▄▄██▀▀██▄▄▄████▄▄",
    "  ████████▄██▄██████████",
    "  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
  ],
  startle: [
    "                        ",
    "    ██            ██   ▄",
    "  ▄████▄▄▄▄▄▄▄▄▄▄████▄ █",
    "  ████▀▀▀██████▀▀▀██████",
    "  ████▄█▄██▀▀██▄█▄██████",
    "  ████████▄██▄██████████",
    "  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
  ],
};

/** The art with every cell outside the region blanked, so the copy lines up with its source. */
function crop(art: string[], region: Region): string[] {
  const [c0, c1] = region.cols;
  const [r0, r1] = region.rows;
  return art.map((line, r) =>
    [...line].map((ch, c) => (r >= r0 && r < r1 && c >= c0 && c < c1 ? ch : " ")).join(""));
}

export function mascotDefs(col: number, row: number, theme: ThemeName): string {
  const p = PALETTES[theme];
  const layer = (cls: string, art: string[], fill: string): string =>
    `<path class="${cls}" d="${artToPath(art, col, row)}" fill="${fill}"/>`;

  const poses = (Object.keys(POSES) as PoseName[]).map((name) =>
    `<g class="pose pose-${name}">`
    + layer("body", POSES[name], p.text)
    + layer("ear", crop(POSES[name], EAR), p.text)
    + layer("tail", crop(POSES[name], TAIL), p.text)
    + "</g>",
  ).join("\n");

  const leds = LED_PERIODS.map((_, i) =>
    `<path class="led led-${i}" d="${artToPath(LED_ART, col + LED_COL, row + RACK_ROW + 1 + i)}" fill="${p.accent}"/>`,
  ).join("\n");

  // The rack is drawn after the poses, so its plate covers the part of the cat that runs under it.
  return `<g class="mascot">
<g class="breath">
${poses}
</g>
<path class="rack" d="${artToPath(RACK, col, row + RACK_ROW)}" fill="${p.muted}"/>
${leds}
</g>`;
}

/** Seconds to a percentage of the master loop, to the millisecond. */
const pct = (seconds: number): string => `${Number(((seconds / MASTER_SECONDS) * 100).toFixed(3))}%`;

const BREATHS_PER_LOOP = 16;
const BREATH_SECONDS = MASTER_SECONDS / BREATHS_PER_LOOP;
const EAR_SECONDS = 17;
const TAIL_SECONDS = 23;

/** One stop per hand-off in the timeline, so a pose's keyframes cannot drift from it. */
function poseKeyframes(pose: PoseName): string {
  const shown = (state: PoseName): number => (state === pose ? 1 : 0);
  const stops = MASCOT_TIMELINE.map((w) => `${pct(w.from)} { opacity: ${shown(w.state)} }`);
  stops.push(`100% { opacity: ${shown(MASCOT_TIMELINE[MASCOT_TIMELINE.length - 1].state)} }`);
  return `@keyframes m-${pose} { ${stops.join(" ")} }`;
}

/**
 * The base rules are the still frame: the pose the loop starts and ends on is visible and every
 * other is hidden. The animations drive away from that frame and back, so a viewer who has asked
 * for reduced motion (`animation: none`) is left on it.
 */
export function mascotCss(): string {
  const poses = [...new Set(MASCOT_TIMELINE.map((w) => w.state))];
  return `
.pose { opacity: 0 }
.pose-${MASCOT_TIMELINE[0].state} { opacity: 1 }
${poses.map((s) => `.pose-${s} { animation: m-${s} ${MASTER_SECONDS}s step-end infinite }`).join("\n")}
.breath { animation: breathe ${BREATH_SECONDS}s step-end infinite }
.ear { animation: ear ${EAR_SECONDS}s step-end infinite }
.tail { animation: tail ${TAIL_SECONDS}s step-end infinite }
${LED_PERIODS.map((s, i) => `.led-${i} { animation: led ${s}s step-end infinite }`).join("\n")}
${poses.map(poseKeyframes).join("\n")}
@keyframes breathe { 0% { transform: translateY(0) } 46.7% { transform: translateY(-1px) } 93.3% { transform: translateY(0) } }
@keyframes ear { 0% { transform: translateY(0) } 0.5% { transform: translateY(-1px) } 1.2% { transform: translateY(0) } }
@keyframes tail { 0% { transform: translateX(0) } 1% { transform: translateX(1px) } 2.5% { transform: translateX(0) } }
@keyframes led { 0% { opacity: 0.25 } 3% { opacity: 1 } 8% { opacity: 0.25 } }
`;
}
