import test from "node:test";
import assert from "node:assert/strict";
import { COLS } from "../src/grid.ts";
import {
  BANNER_FLICKER_OPACITY, BANNER_FRAME, MAX_SLICE_SECONDS, ROW_REVEAL, ROW_RISE, ROW_STEP,
  SHIMMER_SECONDS, SHIMMER_SWEEP, SPINNER_SECONDS,
  bannerLetterClass, bannerRevealCss, bannerRevealSeconds,
  playbackClass, playbackCss, playbackMarks, playbackSeconds,
  shimmerCss, shimmerLead, shimmerStarts, spinnerCss, verbClass, verbRuns, verbSchedule,
} from "../src/playback.ts";
import { MASCOT_TIMELINE, MASTER_SECONDS } from "../src/timeline.ts";
import type { PoseName } from "../src/timeline.ts";
import { VERB_SUFFIX, composeSession, assertNoCollisions, shimmerClass } from "../src/session.ts";
import { assertFits, rowsToText, rowsToFullText } from "../src/rows.ts";
import { bannerLetters, bannerPath, bannerWidthCols } from "../src/banner.ts";
import { loadContent } from "../src/content.ts";

// ---------------------------------------------------------------------------------------------
// CSS readers. The tests below ask questions of the stylesheet, so they need to take it apart
// properly: a regex that stops at the first `}` mis-reads a nested block, which is every
// `@keyframes` there is.
// ---------------------------------------------------------------------------------------------

/** The text inside the braces that follow `at`, with nesting respected. */
function blockAt(css: string, at: number): string {
  const open = css.indexOf("{", at);
  assert.notEqual(open, -1, "no block follows");
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("unbalanced braces in the stylesheet");
}

/** Every `@keyframes` block, by name. */
function keyframes(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)/g)) out.set(m[1], blockAt(css, m.index));
  return out;
}

/** Every rule outside an at-block, as [selector, body]. */
function rules(css: string): [string, string][] {
  const out: [string, string][] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    const selector = css.slice(i, open).trim();
    const body = blockAt(css, i);
    const end = open + body.length + 2;
    if (!selector.startsWith("@")) out.push([selector, body]);
    i = end;
  }
  return out;
}

/** Every rule body whose selector is exactly `.cls`, in source order. */
const bodiesFor = (css: string, cls: string): string[] =>
  rules(css).filter(([sel]) => sel === `.${cls}`).map(([, body]) => body);

/** The body of the one rule for `.cls` that declares an animation. */
function ruleFor(css: string, cls: string): string {
  const found = bodiesFor(css, cls).filter((body) => /animation/.test(body));
  assert.equal(found.length, 1, `expected exactly one animated rule for .${cls}, found ${found.length}`);
  return found[0];
}

/** Every property name that appears inside any `@keyframes` block. */
function animatedProperties(css: string): Set<string> {
  const props = new Set<string>();
  for (const body of keyframes(css).values()) {
    for (const m of body.matchAll(/([a-z-]+)\s*:/g)) props.add(m[1]);
  }
  return props;
}

/** The opacity stops of a keyframe block, in source order, as [percentage, opacity]. */
function opacityStops(block: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of block.matchAll(/([\d.]+)%\s*\{([^}]*)\}/g)) {
    const o = /opacity:\s*([\d.]+)/.exec(m[2]);
    if (o) out.push([Number(m[1]), Number(o[1])]);
  }
  return out;
}

const VERBS = loadContent().verbs;

/** `n` rows that nothing else has claimed a reveal for. */
const plainRows = (n: number): { cls?: string }[] => Array.from({ length: n }, () => ({}));

/** A fixture Activity with enough shape for composeSession. No figures are claimed about anyone. */
function fixtureActivity(): Parameters<typeof composeSession>[1] {
  const calendar = Array.from({ length: 365 }, (_, i) => ({
    date: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    count: i % 5,
  }));
  return {
    totalContributions: calendar.reduce((s, d) => s + d.count, 0),
    activeDays: calendar.filter((d) => d.count > 0).length,
    calendar,
    languages: [{ name: "Python", bytes: 900 }, { name: "Rust", bytes: 300 }],
  };
}

// ---------------------------------------------------------------------------------------------
// The playback
// ---------------------------------------------------------------------------------------------

test("the base stylesheet stays the finished Session: nothing here hides a row at rest", () => {
  const css = playbackCss(playbackMarks(plainRows(8)));
  for (const [selector, body] of rules(css)) {
    assert.ok(!/opacity/.test(body), `${selector} sets opacity outside a keyframe block: ${body.trim()}`);
  }
});

test("a row is held at its first frame during its delay, so the reveal is the fill mode's work", () => {
  const css = playbackCss(playbackMarks(plainRows(4)));
  for (let row = 0; row < 4; row++) {
    const body = ruleFor(css, playbackClass(row));
    assert.match(body, /\bbackwards\b/, `row ${row} does not fill backwards, so it is visible before its turn`);
  }
});

test("the end of the reveal is the base rule, so reduced motion and the finished playback agree", () => {
  const frames = keyframes(playbackCss(playbackMarks(plainRows(2)))).get("row-arrive");
  assert.ok(frames, "the playback has no row-arrive keyframes");
  const to = /\bto\s*\{([^}]*)\}/.exec(frames!);
  assert.ok(to, "row-arrive never reaches a `to` state");
  assert.match(to![1], /opacity:\s*1\b/);
  assert.match(to![1], /transform:\s*translateY\(0\)/);
  // `forwards` would pin the row to the keyframe instead of letting the stylesheet take it back,
  // which is how the animated and the reduced-motion renders would come to disagree.
  assert.ok(!/\bforwards\b/.test(playbackCss(playbackMarks(plainRows(2)))), "the playback pins its own end state");
});

test("the playback runs once; nothing about it loops", () => {
  const css = playbackCss(playbackMarks(plainRows(6)));
  assert.ok(!/\binfinite\b/.test(css), "the playback loops");
  for (const [selector, body] of rules(css)) {
    assert.ok(!/animation-iteration-count/.test(body), `${selector} sets an iteration count`);
  }
});

test("rows arrive one after another, in the order they are read", () => {
  const marks = playbackMarks(plainRows(56));
  assert.equal(marks.length, 56);
  assert.equal(marks[0].at, 0);
  for (let i = 1; i < marks.length; i++) {
    assert.equal(marks[i].row, i);
    assert.ok(marks[i].at > marks[i - 1].at, `row ${i} does not arrive after row ${i - 1}`);
  }
});

test("a row whose reveal another layer owns is left to that layer", () => {
  const rows = [{}, { cls: "scan-result" }, {}, { cls: "whatever" }, {}];
  const marks = playbackMarks(rows);
  assert.deepEqual(marks.map((m) => m.row), [0, 2, 4], "the playback claimed a row that is already spoken for");
  // Two `animation` shorthands on one element do not compose; the loser is decided by the order
  // the stylesheets were concatenated in, which is nobody's decision.
  const css = playbackCss(marks);
  assert.ok(!css.includes(`.${playbackClass(1)} `), "a claimed row still got a playback rule");
  // The rows it does keep still arrive at the rhythm of their own place, not of their position
  // in the filtered list, so skipping one leaves a gap in time rather than closing it up.
  assert.deepEqual(marks.map((m) => m.at), [0, 2 * ROW_STEP, 4 * ROW_STEP]);
});

test("the gap between two rows is the 25 to 30ms the design contract asks for", () => {
  const marks = playbackMarks(plainRows(10));
  for (let i = 1; i < marks.length; i++) {
    const gap = marks[i].at - marks[i - 1].at;
    assert.ok(gap >= 0.025 && gap <= 0.030, `rows arrive ${(gap * 1000).toFixed(0)}ms apart`);
  }
});

test("a 56 row Session is fully printed well under two seconds", () => {
  // The hard constraint on the project's highest-frequency animation: it fires on every page load
  // and it stands between the reader and the content.
  const seconds = playbackSeconds(playbackMarks(plainRows(56)));
  assert.ok(seconds < 1.8, `the playback takes ${seconds.toFixed(2)}s`);
  assert.ok(seconds > 1.0, `the playback takes ${seconds.toFixed(2)}s, which is too fast to read as printing`);
});

test("the delays in the stylesheet are the marks, in row order", () => {
  const marks = playbackMarks(plainRows(30));
  const css = playbackCss(marks);
  const delays = marks.map(({ row }) => {
    const d = /\s([\d.]+)s\s+backwards/.exec(ruleFor(css, playbackClass(row)));
    assert.ok(d, `row ${row} has no delay`);
    return Number(d![1]);
  });
  assert.deepEqual(delays, marks.map((m) => Number(m.at.toFixed(4))));
});

test("the row reveal eases out, and nothing anywhere eases in", () => {
  const css = playbackCss(playbackMarks(plainRows(3))) + bannerRevealCss(3) + spinnerCss(verbSchedule(VERBS)) + shimmerCss(5);
  assert.match(ruleFor(playbackCss(playbackMarks(plainRows(1))), playbackClass(0)), /\bease-out\b/);
  assert.ok(!/\bease-in\b/.test(css), "something eases in");
});

test("the row rises into place by a fraction of a row, never by a whole one", () => {
  assert.ok(ROW_RISE > 0 && ROW_RISE <= 6, `a row starts ${ROW_RISE} units out of a 24 unit row`);
  assert.match(keyframes(playbackCss(playbackMarks(plainRows(1)))).get("row-arrive")!, new RegExp(`translateY\\(${ROW_RISE}px\\)`));
});

test("the playback animates opacity and transform, and nothing else", () => {
  const props = animatedProperties(playbackCss(playbackMarks(plainRows(4))));
  assert.deepEqual([...props].sort(), ["opacity", "transform"]);
});

test("ROW_REVEAL is a reveal rather than a frame, and shorter than the gap it would otherwise swallow", () => {
  assert.ok(ROW_REVEAL >= 0.1 && ROW_REVEAL <= 0.3, `a row takes ${ROW_REVEAL}s to arrive`);
  assert.ok(ROW_STEP < ROW_REVEAL, "rows arrive slower than they reveal, so nothing overlaps and the cascade is lost");
});

// ---------------------------------------------------------------------------------------------
// The Banner's reveal
// ---------------------------------------------------------------------------------------------

test("the Banner resolves letter by letter, left to right", () => {
  const css = bannerRevealCss(5);
  const delays = Array.from({ length: 5 }, (_, i) => {
    const d = /\s([\d.]+)s\s+backwards/.exec(ruleFor(css, bannerLetterClass(i)));
    assert.ok(d, `letter ${i} has no delay`);
    return Number(d![1]);
  });
  assert.equal(delays[0], 0);
  for (let i = 1; i < delays.length; i++) {
    assert.ok(delays[i] > delays[i - 1], `letter ${i} does not resolve after letter ${i - 1}`);
  }
});

test("each letter flickers once before it settles: three levels, in order", () => {
  const stops = opacityStops(keyframes(bannerRevealCss(2)).get("banner-letter")!);
  assert.deepEqual(stops, [[0, 0], [50, BANNER_FLICKER_OPACITY], [100, 1]]);
  // A flicker that is already solid is a fade-in, which is the thing the contract correction
  // replaced, and a flicker at zero is just a longer wait.
  assert.ok(BANNER_FLICKER_OPACITY > 0 && BANNER_FLICKER_OPACITY < 1, "the flicker frame is not a flicker");
});

test("the letters cut between frames rather than fading", () => {
  assert.match(ruleFor(bannerRevealCss(1), bannerLetterClass(0)), /\bstep-end\b/);
});

test("the Banner resolves inside the playback it opens, and is not over in one frame", () => {
  const banner = bannerRevealSeconds(5);
  assert.ok(banner > 2 * BANNER_FRAME, `five letters resolve in ${banner}s, which is one letter's worth`);
  assert.ok(banner < playbackSeconds(playbackMarks(plainRows(56))), "the Banner outlasts the Session it heads");
  assert.ok(banner < 1, `the name takes ${banner}s to come up`);
  // An absolute floor as well as a relative one: a bound written in terms of BANNER_FRAME alone
  // moves when BANNER_FRAME does, so it would hold just as well for a name that resolved in 10ms,
  // which nobody would see resolve at all.
  assert.ok(banner > 0.2, `the whole name resolves in ${banner}s, which is a cut and not a reveal`);
  assert.ok(BANNER_FRAME >= 1 / 30 && BANNER_FRAME <= 1 / 10, `a ${(BANNER_FRAME * 1000).toFixed(0)}ms frame is not a frame a viewer registers`);
});

test("the Banner's reveal animates opacity only: the geometry never moves", () => {
  assert.deepEqual([...animatedProperties(bannerRevealCss(4))], ["opacity"]);
});

test("one letter path per letter, and together they draw exactly what the whole word draws", () => {
  const letters = bannerLetters("LAZIE", 34, 1);
  assert.deepEqual(letters.map((l) => l.ch), ["L", "A", "Z", "I", "E"]);
  const split = letters.flatMap((l) => l.d.split("M").filter(Boolean)).sort();
  const whole = bannerPath("LAZIE", 34, 1).split("M").filter(Boolean).sort();
  assert.deepEqual(split, whole, "the per-letter paths are not the word's own geometry");
});

test("the letters land on the columns bannerWidthCols accounts for", () => {
  const letters = bannerLetters("LAZIE", 34, 1);
  assert.equal(letters[0].col, 34, "the first letter is not where the Banner starts");
  for (let i = 1; i < letters.length; i++) {
    const expected = letters[i - 1].col + bannerWidthCols(letters[i - 1].ch) + 1;
    assert.equal(letters[i].col, expected, `letter ${i} is off its column`);
  }
  const last = letters[letters.length - 1];
  assert.equal(last.col + bannerWidthCols(last.ch), 34 + bannerWidthCols("LAZIE"), "the word ends somewhere else");
});

test("a Banner with nothing in it is refused rather than drawn empty", () => {
  assert.throws(() => bannerLetters("", 0, 0), /no letters/);
});

// ---------------------------------------------------------------------------------------------
// The spinner's verb schedule
// ---------------------------------------------------------------------------------------------

test("the schedule covers the master loop end to end, with no gap and no overlap", () => {
  const schedule = verbSchedule(VERBS);
  assert.equal(schedule[0].from, 0);
  assert.equal(schedule[schedule.length - 1].to, MASTER_SECONDS);
  for (let i = 1; i < schedule.length; i++) {
    assert.ok(Math.abs(schedule[i].from - schedule[i - 1].to) < 1e-9,
      `a ${schedule[i - 1].to}s to ${schedule[i].from}s hole between ${schedule[i - 1].text} and ${schedule[i].text}`);
  }
});

test("at every instant of the loop the word names the pose that is actually on screen", () => {
  const schedule = verbSchedule(VERBS);
  const poseAt = (t: number): PoseName => {
    const w = MASCOT_TIMELINE.find((x) => t >= x.from && t < x.to);
    assert.ok(w, `the timeline does not cover ${t}s`);
    return w!.state;
  };
  for (let t = 0; t < MASTER_SECONDS; t += 0.05) {
    const slice = schedule.find((s) => t >= s.from && t < s.to);
    assert.ok(slice, `nothing is said at ${t.toFixed(2)}s`);
    const pose = poseAt(t);
    assert.ok(VERBS[pose].includes(slice!.text),
      `at ${t.toFixed(2)}s the Mascot is ${pose} and the spinner says ${slice!.text}`);
  }
});

test("every boundary in the schedule is a boundary the timeline put there", () => {
  const edges = new Set(MASCOT_TIMELINE.flatMap((w) => [w.from, w.to]));
  for (const slice of verbSchedule(VERBS, MASTER_SECONDS)) {
    // With no splitting asked for, a slice may only begin and end where a window does.
    assert.ok([...edges].some((e) => Math.abs(e - slice.from) < 1e-9), `${slice.from}s is not a window edge`);
    assert.ok([...edges].some((e) => Math.abs(e - slice.to) < 1e-9), `${slice.to}s is not a window edge`);
  }
});

test("a window longer than MAX_SLICE_SECONDS is split instead of holding one word", () => {
  const schedule = verbSchedule(VERBS);
  for (const slice of schedule) {
    const words = MASCOT_TIMELINE.filter((w) => slice.from >= w.from && slice.to <= w.to + 1e-9).map((w) => VERBS[w.state]);
    // Only a state with a single word may hold the screen for longer than the slice ceiling.
    if (slice.to - slice.from > MAX_SLICE_SECONDS + 1e-9 && words.length > 0) {
      assert.equal(words[0].length, 1, `${slice.text} holds for ${(slice.to - slice.from).toFixed(2)}s with ${words[0].length} words available`);
    }
  }
  const longest = MASCOT_TIMELINE.reduce((m, w) => Math.max(m, w.to - w.from), 0);
  assert.ok(longest > MAX_SLICE_SECONDS, "precondition: some window is long enough to need splitting");
});

test("every word a state offers is used, so the list is a rotation and not a first entry", () => {
  const said = new Set(verbSchedule(VERBS).map((s) => s.text));
  for (const word of VERBS.sleep) {
    assert.ok(said.has(word), `the spinner never says ${word}, so verbs.sleep is decoration`);
  }
  assert.ok(VERBS.sleep.length > 1, "precondition: sleep offers more than one word");
});

test("the four naps do not all open on the same word", () => {
  const naps = MASCOT_TIMELINE.filter((w) => w.state === "sleep");
  const opening = naps.map((w) => verbSchedule(VERBS).find((s) => Math.abs(s.from - w.from) < 1e-9)?.text);
  assert.ok(new Set(opening).size > 1, `every nap opens on ${opening[0]}, so the cursor resets per window`);
});

test("the two halves of a blow are one slice, so the phrase holds across the gesture", () => {
  const schedule = verbSchedule(VERBS);
  const swatUp = MASCOT_TIMELINE.find((w) => w.state === "swat-up")!;
  const swatRun = schedule.find((s) => Math.abs(s.from - swatUp.from) < 1e-9);
  assert.ok(swatRun, "nothing begins where the first swat does");
  assert.ok(swatRun!.to > swatUp.to + 1e-9,
    `the swat phrase ends at ${swatRun!.to}s, the same instant the paw goes up, so it is re-emitted per half`);
  // Two windows carrying the same word must never produce two slices.
  for (let i = 1; i < schedule.length; i++) {
    assert.notEqual(schedule[i].text, schedule[i - 1].text, `${schedule[i].text} runs twice in a row unmerged`);
  }
});

test("a state with no word is reported by name, not silently skipped", () => {
  assert.throws(() => verbSchedule({ ...VERBS, yawn: [] }), /verbs\.yawn/);
  assert.throws(() => verbSchedule({ ...VERBS, peek: [] }), /verbs\.peek/);
});

test("the still frame shows exactly one verb, and it is the one the transcript names", () => {
  const css = spinnerCss(verbSchedule(VERBS));
  assert.deepEqual(bodiesFor(css, "verb").map((b) => /opacity:\s*0\b/.test(b)), [true],
    "the alternatives are not hidden at rest, so the row spells every verb at once");
  assert.ok(bodiesFor(css, verbClass(0)).some((b) => /opacity:\s*1\b/.test(b)),
    "no verb is shown at rest, so the reduced-motion spinner says nothing");
  for (let i = 1; i < verbSchedule(VERBS).length; i++) {
    assert.ok(!bodiesFor(css, verbClass(i)).some((b) => /opacity:\s*1\b/.test(b)),
      `verb ${i} is also shown at rest, so the still frame stacks two words`);
  }
  const content = loadContent();
  const { rows, verbRow } = composeSession(content, fixtureActivity());
  const spoken = rows[verbRow].runs.find((r) => r.textOnly)!.text;
  assert.equal(`${verbSchedule(content.verbs)[0].text}${VERB_SUFFIX}`, spoken,
    "the word drawn at rest is not the word the transcript reads");
});

test("the verbs run on the Mascot's own clock, with no offset to slide them off the picture", () => {
  const schedule = verbSchedule(VERBS);
  const css = spinnerCss(schedule);
  schedule.forEach((_, i) => {
    const body = ruleFor(css, verbClass(i));
    assert.match(body, new RegExp(`animation:\\s*${verbClass(i)}\\s+${MASTER_SECONDS}s\\s+step-end\\s+infinite\\s*$`),
      `verb ${i} is not on the undelayed master clock: ${body.trim()}`);
  });
});

test("each verb is shown for exactly its own slice of the loop", () => {
  const schedule = verbSchedule(VERBS);
  const frames = keyframes(spinnerCss(schedule));
  schedule.forEach((slice, i) => {
    const stops = opacityStops(frames.get(verbClass(i))!);
    const on = stops.filter(([, o]) => o === 1);
    assert.equal(on.length, 1, `verb ${i} is shown ${on.length} times in one loop`);
    assert.ok(Math.abs(on[0][0] - (slice.from / MASTER_SECONDS) * 100) < 0.01,
      `verb ${i} appears at ${on[0][0]}% rather than ${((slice.from / MASTER_SECONDS) * 100).toFixed(3)}%`);
    const off = stops.find(([at]) => at > on[0][0]);
    assert.ok(off, `verb ${i} is never hidden again`);
    assert.ok(Math.abs(off![0] - (slice.to / MASTER_SECONDS) * 100) < 0.01,
      `verb ${i} is hidden at ${off![0]}% rather than ${((slice.to / MASTER_SECONDS) * 100).toFixed(3)}%`);
  });
});

test("the spinner keeps turning after the playback is over", () => {
  const css = spinnerCss(verbSchedule(VERBS));
  assert.match(css, /\binfinite\b/);
  assert.match(ruleFor(css, "spinner-glyph"), new RegExp(`${SPINNER_SECONDS}s\\s+step-end\\s+infinite`));
});

test("the spinner glyph breathes low, because the word is the readout and the glyph is not", () => {
  const stops = opacityStops(keyframes(spinnerCss(verbSchedule(VERBS))).get("spinner-breath")!);
  assert.ok(stops.length >= 3, "the glyph does not breathe");
  const low = Math.min(...stops.map(([, o]) => o));
  assert.ok(low >= 0.5, `the glyph dims to ${low}, which is dimmer than a readout should go`);
  assert.ok(low < 1, "the glyph does not move at all");
  assert.equal(Math.max(...stops.map(([, o]) => o)), 1, "the glyph never returns to full, so the base frame is not the rest state");
});

test("the spinner animates opacity only", () => {
  assert.deepEqual([...animatedProperties(spinnerCss(verbSchedule(VERBS)))], ["opacity"]);
});

test("a schedule that does not reach the start of the loop is refused", () => {
  assert.throws(() => spinnerCss([{ text: "x", from: 2, to: 4 }]), /rests on/);
  assert.throws(() => spinnerCss([]), /no verb schedule/);
});

// ---------------------------------------------------------------------------------------------
// The drawn verb runs
// ---------------------------------------------------------------------------------------------

test("the drawn verbs are alternatives at one column, spelled like the transcript's verb", () => {
  const schedule = verbSchedule(VERBS);
  const runs = verbRuns(schedule, 2);
  assert.equal(runs.length, schedule.length);
  assert.equal(new Set(runs.map((r) => r.col)).size, 1, "the verbs are not stacked at one column");
  assert.equal(new Set(runs.map((r) => r.layer)).size, 1, "the verbs are not one group of alternatives");
  runs.forEach((run, i) => {
    assert.equal(run.col, 2);
    assert.equal(run.drawOnly, true, `verb ${i} would be painted into the transcript as well`);
    assert.ok(run.layer, `verb ${i} claims no layer, so it collides with its own alternatives`);
    assert.equal(run.text, `${schedule[i].text}${VERB_SUFFIX}`);
    assert.match(run.cls ?? "", new RegExp(`(^|\\s)verb(\\s|$)`), `verb ${i} is missing the group hook`);
    assert.match(run.cls ?? "", new RegExp(`(^|\\s)${verbClass(i)}(\\s|$)`), `verb ${i} is missing its own hook`);
  });
});

test("adding them to a real Session keeps the row legal and keeps the transcript to one verb", () => {
  const content = loadContent();
  const { rows, verbRow } = composeSession(content, fixtureActivity());
  const schedule = verbSchedule(content.verbs);
  const spoken = rows[verbRow].runs.find((r) => r.textOnly)!.text;
  rows[verbRow].runs.push(...verbRuns(schedule, rows[verbRow].runs.find((r) => r.textOnly)!.col));

  assertFits(rows);
  assertNoCollisions(rows);
  const line = rowsToText(rows).split("\n")[verbRow];
  assert.ok(line.includes(spoken), "the transcript lost its verb");
  for (const slice of schedule) {
    if (`${slice.text}${VERB_SUFFIX}` === spoken) continue;
    assert.ok(!line.includes(slice.text), `the transcript also carries ${slice.text}, so the line spells nothing`);
  }
  // Hidden from the transcript is not hidden from the ADR 0001 gate.
  const full = rowsToFullText(rows);
  for (const slice of schedule) assert.ok(full.includes(slice.text), `${slice.text} is invisible to the name gate`);
});

test("a verb too long for the row fails the build rather than overflowing the Session", () => {
  const content = loadContent();
  const { rows, verbRow } = composeSession(content, fixtureActivity());
  // Measured from the grid rather than written down, so it stays a verb that cannot fit whatever
  // the Session is wide: one character past the columns the spinner's own indent leaves.
  rows[verbRow].runs.push(...verbRuns([{ text: "x".repeat(COLS - 1), from: 0, to: 36 }], 2));
  assert.throws(() => assertFits(rows), /columns/);
});

// ---------------------------------------------------------------------------------------------
// The Ultrachill shimmer
// ---------------------------------------------------------------------------------------------

test("the word reads muted at rest, so the still frame is the Statusline and not a lit word", () => {
  const css = shimmerCss(4);
  const base = rules(css).find(([sel]) => sel.split(",").every((s) => s.trim().startsWith(".shimmer-")) && /opacity/.test(blockAt(css, css.indexOf(sel))));
  assert.ok(base, "no rule hides the highlight copy at rest");
  for (let i = 0; i < 4; i++) {
    assert.ok(base![0].includes(`.${shimmerClass(i)}`), `the highlight copy of character ${i} is lit at rest`);
  }
  assert.match(base![1], /opacity:\s*0\b/);
});

test("the sheen fires once per quarter of the master loop, derived from it", () => {
  assert.equal(SHIMMER_SECONDS * 4, MASTER_SECONDS);
  const css = shimmerCss(3);
  for (let i = 0; i < 3; i++) {
    assert.match(ruleFor(css, shimmerClass(i)), new RegExp(`\\b${SHIMMER_SECONDS}s\\b`));
    assert.match(ruleFor(css, shimmerClass(i)), /\binfinite\b/);
  }
  assert.equal(shimmerStarts().length, 4, "the sheen does not fire four times in a master loop");
});

test("it travels: each character peaks after the one before it", () => {
  const frames = keyframes(shimmerCss(10));
  const peaks = Array.from({ length: 10 }, (_, i) => {
    const lit = opacityStops(frames.get(shimmerClass(i))!).find(([, o]) => o === 1);
    assert.ok(lit, `character ${i} never lights`);
    return lit![0];
  });
  for (let i = 1; i < peaks.length; i++) {
    assert.ok(peaks[i] > peaks[i - 1], `character ${i} peaks at ${peaks[i]}%, not after ${peaks[i - 1]}%`);
  }
});

test("it is a band and not a marching dot: a character is lit while its neighbour is", () => {
  const frames = keyframes(shimmerCss(10));
  const span = (i: number): [number, number] => {
    const stops = opacityStops(frames.get(shimmerClass(i))!);
    const lit = stops.findIndex(([, o]) => o === 1);
    return [stops[lit - 1][0], stops[lit + 1][0]];
  };
  for (let i = 1; i < 10; i++) {
    const [aFrom, aTo] = span(i - 1);
    const [bFrom] = span(i);
    assert.ok(bFrom < aTo && bFrom > aFrom, `character ${i} starts at ${bFrom}%, outside ${aFrom}% to ${aTo}%`);
  }
});

test("the sheen crosses quickly and then the word is left alone", () => {
  const frames = keyframes(shimmerCss(10));
  const all = Array.from({ length: 10 }, (_, i) => opacityStops(frames.get(shimmerClass(i))!).filter(([, o]) => o > 0).map(([at]) => at)).flat();
  const span = ((Math.max(...all) - Math.min(...all)) / 100) * SHIMMER_SECONDS;
  assert.ok(span <= SHIMMER_SWEEP + 1e-6, `the sheen is lit across ${span.toFixed(2)}s of its cycle`);
  assert.ok(SHIMMER_SWEEP / SHIMMER_SECONDS < 0.15, "the sheen occupies so much of the cycle that it reads as a pulse");
});

test("no sweep lands on the alarm, which is the loop's one moment of urgency", () => {
  const alarm = MASCOT_TIMELINE.filter((w) => w.state !== "sleep" && w.from >= 26);
  const from = Math.min(...alarm.map((w) => w.from));
  const to = Math.max(...alarm.map((w) => w.to));
  for (const start of shimmerStarts()) {
    const end = start + SHIMMER_SWEEP;
    assert.ok(end <= from || start >= to, `a sweep runs ${start}s to ${end.toFixed(2)}s, inside the alarm at ${from}s to ${to}s`);
  }
  assert.ok(shimmerLead() > 0, "the sweep opens its quarter, which puts one of them in the alarm");
});

test("the sheen glides, because nothing about it is a frame swap", () => {
  const css = shimmerCss(6);
  assert.match(ruleFor(css, shimmerClass(0)), /\blinear\b/);
  assert.ok(!/step-end/.test(css), "the sheen steps, which turns a glide into flashes");
  assert.deepEqual([...animatedProperties(css)], ["opacity"]);
});

test("a word the shimmer cannot cross is refused rather than drawn still", () => {
  assert.throws(() => shimmerCss(0), /needs a word/);
  assert.throws(() => shimmerCss(2.5), /needs a word/);
});
