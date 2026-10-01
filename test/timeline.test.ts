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
    { state: "sleep", from: 0, to: 15 },
    { state: "yawn", from: 15, to: 18.4 },
    { state: "stretch", from: 18.4, to: 23.4 },
    { state: "settle", from: 23.4, to: 26.25 },
    { state: "sleep", from: 26.25, to: 48.75 },
    { state: "startle", from: 48.75, to: 49.55 },
    { state: "sleep", from: 49.55, to: 60 },
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
