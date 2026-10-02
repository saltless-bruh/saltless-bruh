import test from "node:test";
import assert from "node:assert/strict";
import { DREAMING, MASTER_SECONDS, MASCOT_TIMELINE } from "../src/timeline.ts";

test("windows cover 0 to MASTER_SECONDS with no gap and no overlap", () => {
  assert.equal(MASCOT_TIMELINE[0].from, 0, "first window starts at 0");
  assert.equal(MASCOT_TIMELINE[MASCOT_TIMELINE.length - 1].to, MASTER_SECONDS, "last window ends at MASTER_SECONDS");

  for (let i = 0; i < MASCOT_TIMELINE.length - 1; i++) {
    assert.equal(
      MASCOT_TIMELINE[i].to,
      MASCOT_TIMELINE[i + 1].from,
      `window ${i} end equals window ${i + 1} start`
    );
  }

  for (let i = 0; i < MASCOT_TIMELINE.length; i++) {
    assert(
      MASCOT_TIMELINE[i].from < MASCOT_TIMELINE[i].to,
      `window ${i} has from < to`
    );
  }
});

test("the committed timeline is the nap and then the alarm, window by window", () => {
  // The whole table, so any retime has to be a deliberate edit here as well as there.
  const expected = [
    { state: "sleep", from: 0, to: 7.5 },
    { state: "yawn", from: 7.5, to: 10.9 },
    { state: "stretch", from: 10.9, to: 15.9 },
    { state: "settle", from: 15.9, to: 18.75 },
    { state: "sleep", from: 18.75, to: 25 },
    { state: "peek", from: 25, to: 26 },
    { state: "sleep", from: 26, to: 28 },
    { state: "alert", from: 28, to: 28.6 },
    { state: "swat-up", from: 28.6, to: 29 },
    { state: "swat-down", from: 29, to: 29.4 },
    { state: "swat-up", from: 29.4, to: 29.8 },
    { state: "swat-down", from: 29.8, to: 30.2 },
    { state: "glare", from: 30.2, to: 30.8 },
    { state: "butt-up", from: 30.8, to: 31.2 },
    { state: "butt-down", from: 31.2, to: 31.6 },
    { state: "recover", from: 31.6, to: 32.4 },
    { state: "sleep", from: 32.4, to: 36 },
  ];
  assert.equal(MASCOT_TIMELINE.length, expected.length, "window count");
  assert.deepEqual(MASCOT_TIMELINE.map((w) => ({ ...w })), expected);
});

test("loop starts and ends on sleep", () => {
  assert.equal(MASCOT_TIMELINE[0].state, "sleep", "first state is sleep");
  assert.equal(MASCOT_TIMELINE[MASCOT_TIMELINE.length - 1].state, "sleep", "last state is sleep");
});

test("the loop is 36 seconds and the first event comes 7.5 seconds in, not 15", () => {
  // Owner-approved retiming: the waiting was the problem, so the gaps shrank and the gestures did not.
  // Adding the alarm did not undo it: MASTER_SECONDS is still 36.
  assert.equal(MASTER_SECONDS, 36);
  const first = MASCOT_TIMELINE.find((w) => w.state !== "sleep");
  assert.ok(first);
  assert.equal(first.from, 7.5);
});

/** Total seconds a state is on screen, across every window it occupies. */
const seconds = (state: string): number => {
  const windows = MASCOT_TIMELINE.filter((x) => x.state === state);
  assert.ok(windows.length > 0, state);
  return Math.round(windows.reduce((n, w) => n + (w.to - w.from), 0) * 100) / 100;
};

test("every nap gesture keeps the duration it had, so only the waiting got shorter", () => {
  assert.deepEqual([seconds("yawn"), seconds("stretch"), seconds("settle")], [3.4, 5, 2.85]);
});

test("the peek is one second long and lands late, inside the nap the bubble inflates in", () => {
  // Late on purpose: it catches a viewer who has been reading, not one who has just arrived. And it is
  // a dreaming state, so the nose bubble does not blink out while it is on screen.
  const peek = MASCOT_TIMELINE.filter((w) => w.state === "peek");
  assert.equal(peek.length, 1, "the eye opens once per loop");
  assert.equal(peek[0].to - peek[0].from, 1);
  assert.ok(peek[0].from >= MASTER_SECONDS * 0.6, `the peek lands ${peek[0].from}s in, which is not late in a ${MASTER_SECONDS}s loop`);
  assert.ok(DREAMING.includes("peek"), "the peek must count as sleeping or the bubble would pop early");
  const i = MASCOT_TIMELINE.indexOf(peek[0]);
  for (const n of [i - 1, i + 1]) assert.equal(MASCOT_TIMELINE[n].state, "sleep", "the peek interrupts a nap and returns to it");
});

test("the alarm is one unbroken run of waking windows, in the order the story needs", () => {
  // Read as a sequence rather than as a list of durations: the point is that the paw strikes twice before
  // the headbutt, and that nothing sleeps in between.
  const first = MASCOT_TIMELINE.findIndex((w) => w.state === "alert");
  assert.ok(first > 0, "the alarm cannot be the first thing in the loop");
  const run = MASCOT_TIMELINE.slice(first).filter((w) => !DREAMING.includes(w.state));
  assert.deepEqual(
    run.map((w) => w.state),
    ["alert", "swat-up", "swat-down", "swat-up", "swat-down", "glare", "butt-up", "butt-down", "recover"],
  );
  // Contiguous: the slice from the alert to the end of recover contains nothing else.
  assert.deepEqual(MASCOT_TIMELINE.slice(first, first + run.length), run);
  // Two strikes, not one and not a flurry.
  assert.equal(run.filter((w) => w.state === "swat-down").length, 2, "strike one and strike two");
});

test("each blow is 400ms up and 400ms down, which is deliberate rather than a twitch", () => {
  // 0.4s per half is 1.25 complete blows a second. Shorter and the paw reads as a vibration; the
  // owner asked for a few distinct whacks.
  for (const state of ["swat-up", "swat-down", "butt-up", "butt-down"]) {
    for (const w of MASCOT_TIMELINE.filter((x) => x.state === state)) {
      assert.equal(Math.round((w.to - w.from) * 1000), 400, `${state} at ${w.from}s`);
    }
  }
  assert.deepEqual([seconds("alert"), seconds("glare"), seconds("recover")], [0.6, 0.6, 0.8]);
  // The glare is the comic beat: it must last at least as long as one blow, or the pause does not register.
  assert.ok(seconds("glare") >= 0.4);
});

test("the loop joins on a breath, and every alarm boundary lands on the grid the LEDs flash on", () => {
  // The breath is 3s (src/mascot.ts), so the loop must be a whole number of breaths or the join jumps
  // mid-inhale. Individual pose cuts need not be: the breath lifts the group that holds every pose, so a
  // swap part-way through a lift changes the drawing without moving it. The pop at 28s is one of those,
  // and it is deliberate rather than an oversight.
  assert.equal(MASTER_SECONDS % 3, 0);
  // The fault flashes on a 200ms cadence from the alert to the recover, so both ends must be whole
  // multiples of 200ms or the last flash is clipped to an odd length.
  const ms = (seconds: number): number => Math.round(seconds * 1000);
  const alert = MASCOT_TIMELINE.find((w) => w.state === "alert");
  const recover = MASCOT_TIMELINE.find((w) => w.state === "recover");
  assert.ok(alert && recover);
  for (const w of MASCOT_TIMELINE.filter((x) => x.from >= alert.from && x.to <= recover.to)) {
    assert.equal(ms(w.from) % 200, 0, `the alarm window ${w.state} begins at ${w.from}s, off the 200ms grid`);
    assert.equal(ms(w.to) % 200, 0, `the alarm window ${w.state} ends at ${w.to}s, off the 200ms grid`);
  }
  assert.equal(ms(recover.from - alert.from) % 200, 0, "the fault window is not a whole number of flashes");
  assert.ok(ms(recover.from - alert.from) >= 400, "the fault must hold at least two flashes");
});
