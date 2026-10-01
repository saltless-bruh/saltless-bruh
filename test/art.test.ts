import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { MASCOT_TIMELINE } from "../src/timeline.ts";

// These tests read the grid files directly, with their own code, so they judge the artwork and not
// the loader. The expectations are the art direction in art/ART-DIRECTION.md, coordinate by coordinate.

const ART = new URL("../art/", import.meta.url);
const POSES = ["sleep", "yawn", "stretch", "settle", "startle"];
const WIDTH = 64;
const HEIGHT = 28;
const RACK_FROM = 11;          // rows 11 to 27 are the rack
const CAT_ONLY = "124";        // characters that only the cat uses
const RACK_ONLY = "56789";     // characters that only the rack uses

const palette = Object.keys(JSON.parse(readFileSync(new URL("palette.json", ART), "utf8")));
const grid = (pose: string): string[] => readFileSync(new URL(`${pose}.grid.txt`, ART), "utf8").replace(/\n$/, "").split("\n");
const G = Object.fromEntries(POSES.map((p) => [p, grid(p)])) as Record<string, string[]>;
const at = (pose: string, x: number, y: number): string => G[pose][y]?.[x] ?? " ";
const find = (pose: string, ch: string): [number, number][] =>
  G[pose].flatMap((row, y) => [...row].flatMap((c, x): [number, number][] => (c === ch ? [[x, y]] : [])));
/** Topmost and leftmost cat ink, ignoring the zZz (character 1). */
const catInk = (pose: string): [number, number][] =>
  G[pose].slice(0, RACK_FROM).flatMap((row, y) => [...row].flatMap((c, x): [number, number][] => ("24".includes(c) ? [[x, y]] : [])));
/** Cat pixels (rows above the rack) that differ, not counting the sleeping pose's own zZz. */
const diff = (a: string, b: string): number =>
  G[a].slice(0, RACK_FROM).reduce((n, row, y) => n + [...row].filter((c, x) => c !== G[b][y][x] && G.sleep[y][x] !== "1" && G[b][y][x] !== "1").length, 0);

test("the poses on disk are exactly the poses the timeline names", () => {
  const states = [...new Set(MASCOT_TIMELINE.map((w) => w.state))].sort();
  assert.deepEqual(states, [...POSES].sort());
  const files = readdirSync(ART).filter((f) => f.endsWith(".grid.txt")).map((f) => f.replace(".grid.txt", "")).sort();
  assert.deepEqual(files, [...POSES].sort(), "a pose file without a pose, or a pose without a file");
});

test("every pose file is exactly 64 x 28 and uses only characters in the palette", () => {
  for (const pose of POSES) {
    const rows = G[pose];
    assert.equal(rows.length, HEIGHT, `${pose}: ${rows.length} rows`);
    rows.forEach((row, y) => {
      assert.equal(row.length, WIDTH, `${pose}: row ${y} is ${row.length} wide`);
      [...row].forEach((c, x) => assert.ok(c === " " || palette.includes(c), `${pose}: unknown character ${JSON.stringify(c)} at x${x} row ${y}`));
    });
  }
});

test("the rack rows are byte-identical in all five poses, so the rack can be emitted once", () => {
  // Asserted, not assumed: one rack is drawn for every pose, so a difference here would be silently lost.
  const reference = G.sleep.slice(RACK_FROM);
  assert.equal(reference.length, HEIGHT - RACK_FROM);
  for (const pose of POSES) assert.deepEqual(G[pose].slice(RACK_FROM), reference, `${pose} differs from sleep in the rack rows`);
});

test("the cat rows hold only cat characters and eyes, the rack rows only rack characters and its dark lines", () => {
  for (const pose of POSES) {
    G[pose].forEach((row, y) => [...row].forEach((c, x) => {
      if (y < RACK_FROM) assert.ok(!RACK_ONLY.includes(c), `${pose}: rack character ${c} in the cat rows at x${x} row ${y}`);
      else assert.ok(!CAT_ONLY.includes(c), `${pose}: cat character ${c} in the rack rows at x${x} row ${y}`);
    }));
  }
});

test("no two poses are the same picture", () => {
  for (let i = 0; i < POSES.length; i++) for (let j = i + 1; j < POSES.length; j++) {
    assert.ok(diff(POSES[i], POSES[j]) > 0, `${POSES[i]} and ${POSES[j]} are identical`);
  }
});

test("the zZz belongs to the sleeping pose only: no other pose shows a sleeping cue", () => {
  // Poses are swapped by opacity, so a zZz that is only in the sleeping grid is on screen exactly during the sleep windows.
  assert.ok(find("sleep", "1").length > 0, "the sleeping pose keeps the artwork's zZz");
  for (const pose of ["yawn", "stretch", "settle"]) assert.deepEqual(find(pose, "1"), [], `${pose} carries zZz`);
  // Startle uses the same lightest tint for its two catchlights, in the face and nowhere else.
  for (const [x, y] of find("startle", "1")) assert.ok(x >= 24 && x <= 31 && y >= 4 && y <= 7, `startle has a stray light pixel at x${x} row ${y}`);
});

// ---------------------------------------------------------------------------------------------
// The artwork the others are drawn from
// ---------------------------------------------------------------------------------------------

test("the sleeping pose has the anatomy the art direction measured", () => {
  assert.deepEqual([at("sleep", 24, 4), at("sleep", 30, 4)], ["2", "2"], "ear tips on row 4");
  assert.deepEqual([25, 26, 29, 30].map((x) => at("sleep", x, 7)), ["3", "3", "3", "3"], "closed eyes on row 7");
  assert.equal(at("sleep", 27, 8), "4", "nose");
  assert.deepEqual([23, 24, 27, 28].map((x) => at("sleep", x, 10)), ["4", "4", "4", "4"], "front paws on row 10");
  assert.equal(Math.max(...find("sleep", "2").map(([x]) => x)), 42, "the body mass reaches x42, with speckles to x44");
});

// ---------------------------------------------------------------------------------------------
// Yawn: the head tips back and the mouth opens, the one moment the silhouette breaks
// ---------------------------------------------------------------------------------------------

test("yawn: a dark mouth about 3 wide and 2 tall below the nose, centred near x27 on rows 9 and 10", () => {
  for (const y of [9, 10]) for (const x of [26, 27, 28]) assert.equal(at("yawn", x, y), "3", `mouth pixel x${x} row ${y}`);
  assert.equal(at("yawn", 27, 8), "4", "the nose stays above the mouth");
  assert.equal(at("yawn", 25, 9), "2", "the mouth is no wider than 3");
  assert.equal(at("yawn", 29, 9), "2", "the mouth is no wider than 3");
});

test("yawn: the eyes stay closed but squeeze up one row, and the ears do not move", () => {
  assert.deepEqual([25, 26, 29, 30].map((x) => at("yawn", x, 6)), ["3", "3", "3", "3"], "eyes on row 6");
  assert.deepEqual([25, 26, 29, 30].map((x) => at("yawn", x, 7)), ["2", "2", "2", "2"], "nothing left on row 7");
  assert.deepEqual([at("yawn", 24, 4), at("yawn", 30, 4)], ["2", "2"]);
});

test("yawn: the paws are kept, not swallowed by the mouth", () => {
  assert.equal(find("yawn", "4").filter(([x, y]) => y === 10 && x < 40).length, 4, "four paw pixels on row 10, as in sleep");
});

// ---------------------------------------------------------------------------------------------
// Stretch: paws forward, head down a row, back up a row, the body visibly longer
// ---------------------------------------------------------------------------------------------

test("stretch: the front paws push left to about x19 and the body lengthens", () => {
  const leftmost = (pose: string): number => Math.min(...catInk(pose).filter(([, y]) => y === 10).map(([x]) => x));
  assert.equal(at("stretch", 19, 10), "4", "a paw at x19");
  assert.equal(leftmost("sleep"), 22);
  assert.equal(leftmost("stretch"), 19);
  assert.equal(find("stretch", "4").filter(([x, y]) => y === 10 && x < 40).length, 4, "both paws are kept");
});

test("stretch: the head is lowered one row", () => {
  assert.deepEqual([25, 26, 29, 30].map((x) => at("stretch", x, 8)), ["3", "3", "3", "3"], "eyes one row lower");
  assert.equal(at("stretch", 27, 9), "4", "nose one row lower");
  assert.deepEqual([at("stretch", 24, 5), at("stretch", 30, 5)], ["2", "2"], "ear tips one row lower");
  assert.equal(at("stretch", 24, 4), " ", "nothing is left on the old ear row");
});

test("stretch: the mid-back is raised one row", () => {
  const top = (pose: string, x: number): number => Math.min(...catInk(pose).filter(([cx]) => cx === x).map(([, y]) => y));
  for (const x of [36, 37, 38]) assert.equal(top("stretch", x) , top("sleep", x) - 1, `back at x${x}`);
});

// ---------------------------------------------------------------------------------------------
// Settle: an in-between, not a pose in its own right
// ---------------------------------------------------------------------------------------------

test("settle: the paws are partly drawn back, strictly between stretch and sleep", () => {
  const paw = (pose: string): number => Math.min(...find(pose, "4").filter(([x, y]) => y === 10 && x < 40).map(([x]) => x));
  assert.ok(paw("stretch") < paw("settle") && paw("settle") < paw("sleep"), `${paw("stretch")} < ${paw("settle")} < ${paw("sleep")}`);
});

test("settle: the arch is half way too, higher than sleep's flat back and lower than stretch's", () => {
  const raised = (pose: string): number => catInk(pose).filter(([x, y]) => x >= 34 && y === 6).length;
  assert.equal(raised("sleep"), 0);
  assert.ok(raised("settle") > raised("sleep") && raised("settle") < raised("stretch"), `${raised("sleep")} < ${raised("settle")} < ${raised("stretch")}`);
});

test("settle: it is a different picture from both neighbours, and a small change from sleep", () => {
  assert.ok(diff("settle", "sleep") > 0 && diff("settle", "stretch") > 0);
  assert.ok(diff("settle", "sleep") < diff("stretch", "sleep"), "settle is nearer sleep than stretch is");
});

// ---------------------------------------------------------------------------------------------
// Startle: ears up a row, eyes open, the body a pixel higher, the only waking pose
// ---------------------------------------------------------------------------------------------

test("startle: the ears snap up one row, to row 3", () => {
  assert.deepEqual([at("startle", 24, 3), at("startle", 30, 3)], ["2", "2"]);
  assert.equal(Math.min(...catInk("startle").map(([, y]) => y)), 3);
  assert.equal(Math.min(...catInk("sleep").map(([, y]) => y)), 4);
});

test("startle: each closed slit becomes an open eye, a dark pixel with a lighter pixel beside or above it", () => {
  const lighter = find("startle", "1");
  assert.equal(lighter.length, 2, "one catchlight per eye");
  for (const [x, y] of lighter) {
    const touchesDark = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].some(([nx, ny]) => at("startle", nx, ny) === "3");
    assert.ok(touchesDark, `the light pixel at x${x} row ${y} is not next to a dark one`);
  }
  // The open eye is taller than the closed slit it replaces, so the change is unmistakable.
  const eye = (x0: number): number => [x0, x0 + 1].flatMap((x) => [3, 4, 5, 6, 7].map((y) => at("startle", x, y))).filter((c) => c === "3").length;
  assert.ok(eye(25) >= 3 && eye(29) >= 3, "each eye has at least three dark pixels");
  assert.equal(find("startle", "3").filter(([, y]) => y < RACK_FROM).length, 6, "six dark eye pixels, no stray ones");
});

test("startle: the whole body is one pixel higher, so it clears the ground", () => {
  const bottom = (pose: string): number => Math.max(...catInk(pose).map(([, y]) => y));
  assert.equal(bottom("sleep"), 10);
  assert.equal(bottom("startle"), 9);
  assert.equal(at("startle", 23, 9), "4", "the paws came up with it");
});

test("startle is the sleeping cat one row higher, with only the eyes redrawn", () => {
  // Everything but the eyes moved up exactly one row: no other pixel of the cat was touched.
  for (let y = 4; y <= 10; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (G.sleep[y][x] === "1") continue;                                   // the zZz is gone
      const insideEyes = x >= 25 && x <= 30 && (y - 1 === 5 || y - 1 === 6);  // the face pixels that were redrawn
      if (insideEyes) continue;
      assert.equal(at("startle", x, y - 1), G.sleep[y][x], `x${x}: sleep row ${y} should be startle row ${y - 1}`);
    }
  }
});

test("a pose changes little: yawn, settle and stretch move a handful of cat pixels, not the picture", () => {
  // Shipped idle animations move one or two pixels; a pose that is obviously different in the grid diff is too much.
  // The yawn is the one moment the silhouette may break. Measured: yawn 16, settle 11, stretch 32 of the cat's 103 ink pixels.
  const limits: Record<string, number> = { yawn: 20, settle: 14, stretch: 36 };
  for (const [pose, limit] of Object.entries(limits)) assert.ok(diff(pose, "sleep") <= limit, `${pose} differs in ${diff(pose, "sleep")} pixels, limit ${limit}`);
});
