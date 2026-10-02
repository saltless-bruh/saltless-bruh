// src/playback.ts
//
// The motion that belongs to the Session itself rather than to one of its drawings: the playback
// that prints it on load, the Banner's per-letter reveal, the spinner's verb schedule, and the
// Statusline toggle's shimmer.
//
// Everything here obeys the same two rules the rest of the motion layer does. The base stylesheet
// in src/svg.ts is the FINISHED STILL FRAME, so every animation drives away from that frame and
// returns to it, which is what makes the one `animation: none` rule under
// `prefers-reduced-motion` leave a reader looking at the complete profile. And nothing is animated
// but `opacity` and `transform`.
import { MASCOT_TIMELINE, MASTER_SECONDS } from "./timeline.ts";
import type { PoseName } from "./timeline.ts";
import { VERB_SUFFIX, shimmerClass } from "./session.ts";
import type { Run } from "./rows.ts";

/** A number as CSS, without a trailing `.0` and without exponent notation. */
const num = (n: number): string => String(Number(n.toFixed(4)));

/** A stop in the master loop, as a percentage. Four places is under a millisecond at 36s. */
const masterPct = (seconds: number): string => `${num((seconds / MASTER_SECONDS) * 100)}%`;

/**
 * Keyframes that show a layer during one span of a cycle and hide it the rest of the time, one
 * stop per change. Written the same way as the Mascot's own pose swaps, because it is the same
 * mechanism: a stack of alternatives on one clock, exactly one of them on screen.
 */
function showDuring(name: string, from: number, to: number, pct: (s: number) => string): string {
  const stops = new Map<string, number>([["0%", 0]]);
  stops.set(pct(from), 1);
  stops.set(pct(to), 0);
  const body = [...stops].map(([at, shown]) => `${at} { opacity: ${shown} }`).join(" ");
  return `@keyframes ${name} { ${body} }`;
}

// ---------------------------------------------------------------------------------------------
// The playback
// ---------------------------------------------------------------------------------------------

/**
 * Seconds between one row's arrival and the next.
 *
 * This is the highest-frequency animation in the project: it fires on every page load and it
 * stands between the reader and the content, so the whole of it has to be over before anyone
 * notices they are waiting. A per-character typewriter across the Session was the obvious reading
 * of "typewriter" and it is ruled out by arithmetic: the Session carries about 2,600 characters,
 * and at any rate a human reads as typing that is tens of seconds of a reader looking at a page
 * that is not there yet. Rows are the unit that keeps the gesture and loses the wait, which is
 * what docs/design-contract.md sanctions ("characters or rows arrive in sequence").
 */
export const ROW_STEP = 0.026;

/** How long one row takes to arrive once its turn comes. */
export const ROW_REVEAL = 0.18;

/**
 * How far below its resting place a row starts, in canvas units. A row is 24 units tall, so this
 * is a sixth of a row: the line settles upward into place the way a terminal scrolls, and the
 * displacement is small enough that no row is ever legible in the wrong place.
 */
export const ROW_RISE = 4;

export type Mark = { row: number; at: number };

/** The per-row hook the playback animates. `renderRows` never emits it; src/svg.ts attaches it. */
export const playbackClass = (row: number): string => `pr-${row}`;

/**
 * When each row arrives: its index times ROW_STEP, so the reveal travels down the Session at an
 * even rate whatever the Session happens to contain.
 *
 * A mark is emitted for every row the playback owns, the ones that draw nothing included. Working
 * out which rows `renderRows` gives an element to would be a second copy of that rule, free to
 * drift from the first with no test noticing, and the cost of not keeping one is a few hundred
 * bytes of rules nothing matches.
 *
 * A ROW THAT ALREADY CARRIES A HOOK IS LEFT ALONE, and that is not a tidiness rule. Two
 * `animation` shorthands reaching one element from two rules do not compose: the later rule
 * replaces the earlier outright, so which of the two reveals actually ran would be decided by the
 * order the stylesheets happen to be concatenated in. The one row this applies to is the
 * /activity result line, whose arrival belongs to the Scan Sweep: it is printed when the beam has
 * finished crossing, which is later than the playback and is the whole point of it. Letting the
 * playback take that row would be claiming a reveal another layer already owns.
 */
export const playbackMarks = (rows: { cls?: string }[]): Mark[] =>
  rows.flatMap((row, i) => (row.cls === undefined ? [{ row: i, at: i * ROW_STEP }] : []));

/** How long the playback lasts: the last row's turn plus the time it takes to arrive. */
export const playbackSeconds = (marks: Mark[]): number =>
  marks.reduce((end, m) => Math.max(end, m.at), 0) + ROW_REVEAL;

/**
 * The playback.
 *
 * `backwards` is the whole trick. The base stylesheet already draws every row at full opacity, so
 * the fill mode is what holds a row at the animation's first frame during its delay; once the
 * animation has run the row falls back to the base rule, which is the finished Session. Nothing
 * here says `forwards`, and that is deliberate: `forwards` would pin the row to the last keyframe
 * instead, which would make the keyframe rather than the stylesheet the final state, and the day
 * the two disagreed the reduced-motion render would be the one that was wrong.
 *
 * `ease-out` rather than `step-end`, because this is a reveal and not a pixel-art frame swap: the
 * row slides into place, and the pose swaps elsewhere cut. Nothing eases in anywhere.
 */
export function playbackCss(marks: Mark[]): string {
  const rules = marks
    .map(({ row, at }) => `.${playbackClass(row)} { animation: row-arrive ${num(ROW_REVEAL)}s ease-out ${num(at)}s backwards }`)
    .join("\n");
  return `
${rules}
@keyframes row-arrive {
  from { opacity: 0; transform: translateY(${num(ROW_RISE)}px) }
  to { opacity: 1; transform: translateY(0) }
}
`;
}

// ---------------------------------------------------------------------------------------------
// The Banner's reveal
// ---------------------------------------------------------------------------------------------

/**
 * One stepped frame of the Banner's reveal, in seconds. Two of them make one letter: a frame dim,
 * then settled.
 *
 * docs/design-contract.md used to ask for a TEXT SCRAMBLE here, and that was written when the
 * Banner was assumed to be text. It is not: it is geometry, block art compiled to merged paths,
 * so there are no glyphs to scramble through, and a real scramble would mean compiling and
 * shipping a drawn path for every letter in every noise frame. The per-letter stepped reveal below
 * is the same intent (the name resolves rather than fading in) on the mechanism the architecture
 * actually has. The contract has been corrected to say so.
 */
export const BANNER_FRAME = 0.045;

/** Opacity of a letter's one flicker frame, before it settles. */
export const BANNER_FLICKER_OPACITY = 0.45;

/** The per-letter hook on the Banner's geometry. */
export const bannerLetterClass = (index: number): string => `bl-${index}`;

/** How long the whole name takes to resolve: two frames per letter, back to back. */
export const bannerRevealSeconds = (letters: number): number => letters * 2 * BANNER_FRAME;

/**
 * Letters resolve in sequence, left to right, each with a single frame of flicker before it
 * settles. One `@keyframes` for all of them, because they differ only in when their turn comes.
 *
 * `step-end` here and not `ease-out`: this one IS a frame swap, the same convention the Mascot's
 * poses follow. Base opacity is 1, so a settled letter is simply the base rule again.
 */
export function bannerRevealCss(letters: number): string {
  const cycle = 2 * BANNER_FRAME;
  const rules = Array.from({ length: letters }, (_, i) =>
    `.${bannerLetterClass(i)} { animation: banner-letter ${num(cycle)}s step-end ${num(i * cycle)}s backwards }`,
  ).join("\n");
  return `
${rules}
@keyframes banner-letter {
  0% { opacity: 0 }
  50% { opacity: ${num(BANNER_FLICKER_OPACITY)} }
  100% { opacity: 1 }
}
`;
}

// ---------------------------------------------------------------------------------------------
// The spinner
// ---------------------------------------------------------------------------------------------

/**
 * The longest a single word may hold the spinner before the next one of its state's words takes
 * over. A state with one word is unaffected; the sleep stretches are what this splits, so the
 * spinner reads as a readout rather than as a label that got stuck.
 */
export const MAX_SLICE_SECONDS = 4;

/** Seconds of slack when comparing two derived boundaries for equality. */
const EPS = 1e-9;

export type VerbSlice = { text: string; from: number; to: number };

/** The per-slice hook on a drawn verb. */
export const verbClass = (index: number): string => `verb-${index}`;

/**
 * The spinner's schedule, derived from the Mascot's timeline so the word always names the pose on
 * screen. Nothing here is hand-typed from the timeline; it is read out of it.
 *
 * Two things happen beyond splitting the loop into windows:
 *
 * A window longer than MAX_SLICE_SECONDS is divided, and the state's words rotate through those
 * divisions, so an eleven-second nap is not eleven seconds of one word. A state's cursor carries
 * ACROSS its windows as well as within them, so the four sleep words are spread over the loop's
 * four naps rather than every nap opening on the same one.
 *
 * Adjacent slices that say the same thing are then MERGED into one. The two halves of a blow are
 * given the same word on purpose (docs/spec.md 4.2), and emitting one run per window would hand
 * the same phrase to two elements that swap at the boundary: nothing visible, two runs of markup
 * and two keyframe blocks for one phrase. Merged, the spinner holds one phrase across the whole
 * gesture, which is what the deliberate repetition was asking for.
 */
export function verbSchedule(verbs: Record<PoseName, string[]>, maxSlice = MAX_SLICE_SECONDS): VerbSlice[] {
  if (!(maxSlice > 0)) throw new Error(`a verb slice must be able to last longer than ${maxSlice}s`);
  const sliced: VerbSlice[] = [];
  const cursor = new Map<PoseName, number>();
  for (const win of MASCOT_TIMELINE) {
    const words = verbs[win.state];
    if (!words || words.length === 0) {
      throw new Error(`content.json: verbs.${win.state} is empty, so the spinner has nothing to say while the Mascot is ${win.state}`);
    }
    const span = win.to - win.from;
    const parts = Math.max(1, Math.min(words.length, Math.round(span / maxSlice)));
    for (let i = 0; i < parts; i++) {
      const n = cursor.get(win.state) ?? 0;
      cursor.set(win.state, n + 1);
      sliced.push({
        text: words[n % words.length],
        from: win.from + (span * i) / parts,
        to: win.from + (span * (i + 1)) / parts,
      });
    }
  }

  const merged: VerbSlice[] = [];
  for (const slice of sliced) {
    const last = merged[merged.length - 1];
    if (last && last.text === slice.text && Math.abs(last.to - slice.from) < EPS) last.to = slice.to;
    else merged.push({ ...slice });
  }
  return merged;
}

/**
 * The runs the picture draws for the schedule: one per slice, all stacked at `col` on the spinner
 * row, and all in one `layer`, which is the row model's word for a set of alternatives. Exactly
 * one is ever on screen, so they may share columns with each other while still colliding with
 * anything outside the group, and `assertNoCollisions` keeps checking the row rather than being
 * told to look away.
 *
 * `drawOnly`, because the transcript already carries one verb of its own: a line of text with
 * sixteen phrases painted over each other at column two spells none of them. The suffix comes
 * from the Session, so a drawn verb is spelled exactly like the one the transcript names.
 */
export const verbRuns = (schedule: VerbSlice[], col: number): Run[] =>
  schedule.map((slice, i) => ({
    col,
    text: `${slice.text}${VERB_SUFFIX}`,
    drawOnly: true,
    layer: "verb",
    cls: `verb ${verbClass(i)}`,
  }));

/** The spinner glyph's own cycle. 1s divides the master loop, so it never drifts against it. */
export const SPINNER_SECONDS = 1;

/** The glyph's breath, stepped like every other frame swap. Low amplitude: it is not the readout. */
const SPINNER_BREATH = [1, 0.8, 0.6, 0.8];

/**
 * The spinner.
 *
 * The verbs run on the master clock with NO delay, which is the one thing about this that is not
 * negotiable. The Mascot's poses are on that same clock, also undelayed (src/mascot.ts), so any
 * offset here would slide the words off the picture by exactly that offset and the spinner would
 * announce a pose that had already finished. The spinner does not need a delay to wait for the
 * playback either: its row is revealed by the playback like every other row, and an invisible row
 * cannot show a word.
 */
export function spinnerCss(schedule: VerbSlice[]): string {
  if (schedule.length === 0) throw new Error("the spinner has no verb schedule to run");
  const first = schedule[0];
  if (Math.abs(first.from) > EPS) throw new Error(`the verb schedule starts at ${first.from}s, so nothing names the pose the Session rests on`);
  const breath = SPINNER_BREATH
    .map((o, i) => `${num((i / SPINNER_BREATH.length) * 100)}% { opacity: ${num(o)} }`)
    .join(" ");
  return `
.verb { opacity: 0 }
.${verbClass(0)} { opacity: 1 }
${schedule.map((_, i) => `.${verbClass(i)} { animation: ${verbClass(i)} ${num(MASTER_SECONDS)}s step-end infinite }`).join("\n")}
.spinner-glyph { animation: spinner-breath ${num(SPINNER_SECONDS)}s step-end infinite }
${schedule.map((s, i) => showDuring(verbClass(i), s.from, s.to, masterPct)).join("\n")}
@keyframes spinner-breath { ${breath} }
`;
}

// ---------------------------------------------------------------------------------------------
// The Ultrachill shimmer
// ---------------------------------------------------------------------------------------------

/**
 * How often the sheen crosses the word: once per quarter of the master loop.
 *
 * Derived, not written down. docs/spec.md budgets perpetual motion deliberately, because several
 * loops running at once reads as a screensaver; the Scan Sweep rests between master loops for the
 * same reason. A word that shimmered continuously beside a spinner that cycles continuously would
 * spend that budget on the smallest joke in the Session.
 */
export const SHIMMER_SECONDS = MASTER_SECONDS / 4;

/** How long the sheen takes to cross the whole word. */
export const SHIMMER_SWEEP = 0.8;

/**
 * Where in its quarter the sweep sits: at the end of it, so the four sweeps of a master loop
 * close their quarters rather than opening them.
 *
 * This is a placement with a reason, and a test pins the reason rather than the number. Opening
 * the quarter instead would put a sweep at 27s, and the fourth would then land at 27s + 9s inside
 * the alarm (28s to 32.4s): a decorative sheen drifting across the Statusline while the rack is
 * faulting and the spinner is naming it. The loop's one moment of urgency gets the screen to
 * itself.
 */
export const shimmerLead = (): number => SHIMMER_SECONDS - SHIMMER_SWEEP;

/** Every instant in the master loop at which a sweep begins. */
export const shimmerStarts = (): number[] =>
  Array.from({ length: MASTER_SECONDS / SHIMMER_SECONDS }, (_, k) => shimmerLead() + k * SHIMMER_SECONDS);

/**
 * The shimmer.
 *
 * The Statusline draws the toggle word twice: a muted base copy, and an accent copy split into one
 * run per character (src/session.ts). Those per-character runs are hidden at rest, which is what
 * makes the base stylesheet the still frame: the word reads muted, like the rest of the
 * Statusline, and a reduced-motion reader sees exactly that.
 *
 * A sheen is then a band of opacity travelling along the accent copy: character `i` peaks one step
 * after character `i - 1`, and each one ramps up over the step before its peak and down over the
 * step after, so two neighbours are always part-lit around the bright one. That is what makes it a
 * sheen rather than a row of characters blinking in turn.
 *
 * `linear`, not `step-end`. The frame-cut convention belongs to the pixel art, where an eased
 * 1px translate would land on subpixel positions that `crispEdges` snaps into a stutter. Nothing
 * moves here: this is a ramp of opacity over a glyph, and interpolating it is what a travelling
 * sheen is. Stepping it would turn the one thing in the Session that is supposed to glide into
 * four discrete flashes per character.
 */
export function shimmerCss(length: number): string {
  if (!Number.isInteger(length) || length < 1) throw new Error(`the shimmer needs a word to cross, not ${length} characters`);
  // The band enters one step before the first character peaks and leaves one step after the last,
  // so the whole crossing, ramps included, is SHIMMER_SWEEP long whatever the word's length.
  const step = SHIMMER_SWEEP / (length + 1);
  const lead = shimmerLead();
  const pct = (seconds: number): string => `${num((seconds / SHIMMER_SECONDS) * 100)}%`;
  const every = Array.from({ length }, (_, i) => `.${shimmerClass(i)}`).join(", ");
  const rules = Array.from({ length }, (_, i) =>
    `.${shimmerClass(i)} { animation: ${shimmerClass(i)} ${num(SHIMMER_SECONDS)}s linear infinite }`,
  ).join("\n");
  const frames = Array.from({ length }, (_, i) => {
    const stops = new Map<string, number>([["0%", 0]]);
    stops.set(pct(lead + i * step), 0);
    stops.set(pct(lead + (i + 1) * step), 1);
    stops.set(pct(lead + (i + 2) * step), 0);
    stops.set("100%", 0);
    const body = [...stops].map(([at, o]) => `${at} { opacity: ${o} }`).join(" ");
    return `@keyframes ${shimmerClass(i)} { ${body} }`;
  }).join("\n");
  return `
${every} { opacity: 0 }
${rules}
${frames}
`;
}
