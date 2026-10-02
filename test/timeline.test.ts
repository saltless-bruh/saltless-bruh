import test from "node:test";
import assert from "node:assert/strict";
import { MASTER_SECONDS, MASCOT_TIMELINE } from "../src/timeline.ts";

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

test("timeline has exactly seven windows with correct states and boundaries", () => {
  assert.equal(MASCOT_TIMELINE.length, 7, "exactly 7 windows");

  const expected = [
    { state: "sleep", from: 0, to: 7.5 },
    { state: "yawn", from: 7.5, to: 10.9 },
    { state: "stretch", from: 10.9, to: 15.9 },
    { state: "settle", from: 15.9, to: 18.75 },
    { state: "sleep", from: 18.75, to: 30 },
    { state: "startle", from: 30, to: 30.8 },
    { state: "sleep", from: 30.8, to: 36 },
  ];

  for (let i = 0; i < MASCOT_TIMELINE.length; i++) {
    assert.equal(MASCOT_TIMELINE[i].state, expected[i].state, `window ${i} state`);
    assert.equal(MASCOT_TIMELINE[i].from, expected[i].from, `window ${i} from`);
    assert.equal(MASCOT_TIMELINE[i].to, expected[i].to, `window ${i} to`);
  }
});

test("loop starts and ends on sleep", () => {
  assert.equal(MASCOT_TIMELINE[0].state, "sleep", "first state is sleep");
  assert.equal(MASCOT_TIMELINE[MASCOT_TIMELINE.length - 1].state, "sleep", "last state is sleep");
});

test("the loop is 36 seconds and the first event comes 7.5 seconds in, not 15", () => {
  // Owner-approved retiming: the waiting was the problem, so the gaps shrank and the gestures did not.
  assert.equal(MASTER_SECONDS, 36);
  const first = MASCOT_TIMELINE.find((w) => w.state !== "sleep");
  assert.ok(first);
  assert.equal(first.from, 7.5);
});

test("every event keeps the duration it had, so only the waiting got shorter", () => {
  const seconds = (state: string): number => {
    const w = MASCOT_TIMELINE.find((x) => x.state === state);
    assert.ok(w, state);
    return Math.round((w.to - w.from) * 100) / 100;
  };
  assert.deepEqual([seconds("yawn"), seconds("stretch"), seconds("settle"), seconds("startle")], [3.4, 5, 2.85, 0.8]);
});
