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
});

test("loop starts and ends on sleep", () => {
  assert.equal(MASCOT_TIMELINE[0].state, "sleep", "first state is sleep");
  assert.equal(MASCOT_TIMELINE[MASCOT_TIMELINE.length - 1].state, "sleep", "last state is sleep");
});
