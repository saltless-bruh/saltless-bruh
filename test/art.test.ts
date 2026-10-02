import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { MASCOT_TIMELINE } from "../src/timeline.ts";

// These tests read the grid files directly, with their own code, so they judge the artwork and not
// the loader. The expectations are the art direction in art/ART-DIRECTION.md, coordinate by coordinate.

const ART = new URL("../art/", import.meta.url);
const NAP = ["sleep", "yawn", "stretch", "settle", "peek"];
const ALARM = ["alert", "swat-up", "swat-down", "glare", "butt-up", "butt-down", "recover"];
const POSES = [...NAP, ...ALARM];
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
/** Topmost and leftmost cat ink, ignoring the zZz and the impact sparks (character 1). */
const catInk = (pose: string): [number, number][] =>
  G[pose].slice(0, RACK_FROM).flatMap((row, y) => [...row].flatMap((c, x): [number, number][] => ("24".includes(c) ? [[x, y]] : [])));
/** Cat pixels (rows above the rack) that differ, not counting either pose's own zZz. */
const diff = (a: string, b: string): number =>
  G[a].slice(0, RACK_FROM).reduce((n, row, y) => n + [...row].filter((c, x) => c !== G[b][y][x] && G.sleep[y][x] !== "1" && G[b][y][x] !== "1").length, 0);
/** Exactly which pixels differ, as "x,y:from>to". */
const changes = (from: string, to: string): string[] =>
  G[from].slice(0, RACK_FROM).flatMap((row, y) => [...row].flatMap((c, x) => (c === G[to][y][x] ? [] : [`${x},${y}:${c}>${G[to][y][x]}`])));
/** The topmost row a pose paints cat ink in. */
const top = (pose: string): number => Math.min(...catInk(pose).map(([, y]) => y));
/** The topmost row of the skull, which is the head's own silhouette and not a raised paw. */
const headTop = (pose: string): number =>
  Math.min(...catInk(pose).filter(([x]) => x >= 23 && x <= 31).map(([, y]) => y));
/** Every row the pose shows a hole (character 3) in, with the columns, so eye shape can be compared. */
const holes = (pose: string): string[] =>
  G[pose].slice(0, RACK_FROM).flatMap((row, y) => [...row].flatMap((c, x) => (c === "3" ? [`${x},${y}`] : [])));

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

test("the rack rows are byte-identical in every pose, so the rack can be emitted once", () => {
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

test("the lightest tint is the zZz while she sleeps and an impact spark when she hits something, nowhere else", () => {
  // Character 1 has two jobs and they cannot be confused because they are in different places. The zZz
  // belongs to the poses she is (or is pretending to be) asleep in, and the sparks sit left of her body,
  // over the chassis the blow landed on.
  const ZZZ = JSON.stringify(find("sleep", "1"));
  assert.ok(find("sleep", "1").length > 0, "the sleeping pose keeps the artwork's zZz");
  assert.equal(JSON.stringify(find("peek", "1")), ZZZ, "the peek keeps the zZz: a bubble and a zZz are what make the open eye a joke");
  for (const pose of ["yawn", "stretch", "settle"]) assert.deepEqual(find(pose, "1"), [], `${pose} carries zZz`);
  for (const pose of ALARM) {
    const sparks = find(pose, "1");
    const expected = ["swat-down", "butt-down"].includes(pose);
    assert.equal(sparks.length > 0, expected, `${pose} ${expected ? "needs" : "must not have"} impact sparks`);
    for (const [x, y] of sparks) {
      assert.ok(x < 21 && y >= 8, `${pose}: a spark at x${x} row ${y} is not on the chassis beside her`);
      assert.ok(at(pose, x, y) === "1" && catInk(pose).every(([cx, cy]) => Math.abs(cx - x) + Math.abs(cy - y) > 1), `${pose}: the spark at x${x} row ${y} touches body ink, which would show a seam between two paths`);
    }
  }
  assert.equal(find("swat-down", "1").length, 2, "two sparks for the paw");
  assert.equal(find("butt-down", "1").length, 2, "two sparks for the headbutt");
});

test("she lies on top of the rack and the LEDs are on its front face, so she cannot reach them", () => {
  // The premise of the whole gag, measured from the artwork rather than asserted in prose: every lit LED is
  // inside a rack unit, below every pixel of every pose, and the only surface any pose touches is the rack's
  // top line. So a blow can only ever land on the chassis.
  const lit = find("sleep", "6");
  assert.ok(lit.length > 0, "the rack has lit LEDs");
  const lowestCat = Math.max(...POSES.flatMap((p) => catInk(p).map(([, y]) => y)));
  assert.equal(lowestCat, RACK_FROM - 1, "the cat rests on the rack's top line");
  for (const [x, y] of lit) {
    assert.ok(y > RACK_FROM, `a lit LED at row ${y} is on the rack's top line, not its front face`);
    assert.ok(y > lowestCat + 1, `a lit LED at row ${y} is level with the cat at row ${lowestCat}`);
  }
  // And the blows land directly above them, which is why hitting the chassis reads as going for the lights.
  const ledCols = [...new Set(lit.map(([x]) => x))];
  const strike = find("swat-down", "4").filter(([x, y]) => y === RACK_FROM - 1 && x < 21).map(([x]) => x);
  assert.ok(strike.length > 0, "the striking paw lands on the rack's top line");
  for (const x of strike) assert.ok(x >= Math.min(...ledCols) && x <= Math.max(...ledCols) + 1, `the paw lands at x${x}, nowhere near the LED columns ${Math.min(...ledCols)} to ${Math.max(...ledCols)}`);
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
  const rowTop = (pose: string, x: number): number => Math.min(...catInk(pose).filter(([cx]) => cx === x).map(([, y]) => y));
  for (const x of [36, 37, 38]) assert.equal(rowTop("stretch", x), rowTop("sleep", x) - 1, `back at x${x}`);
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
// Peek: two pixels, which is the whole joke
// ---------------------------------------------------------------------------------------------

test("peek: exactly two pixels of the sleeping pose change, and they are one eye opening", () => {
  // The brief's budget, held literally. Anything more and the cat has woken up, which is the opposite
  // of the gag: the zZz and the nose bubble must still say deep sleep.
  assert.deepEqual(changes("sleep", "peek"), ["29,6:2>3", "30,6:2>3"]);
});

test("peek: the open eye is a square hole and the other stays a one-row slit, so only one eye opened", () => {
  const eye = (pose: string, x0: number): string[] => [x0, x0 + 1].flatMap((x) => [5, 6, 7].flatMap((y) => (at(pose, x, y) === "3" ? [`${x},${y}`] : [])));
  assert.equal(eye("sleep", 25).length, 2, "sleep's left eye is a two-pixel slit");
  assert.equal(eye("sleep", 29).length, 2, "sleep's right eye is a two-pixel slit");
  assert.deepEqual(eye("peek", 25), eye("sleep", 25), "the left eye must not open as well");
  assert.deepEqual(eye("peek", 29), ["29,6", "29,7", "30,6", "30,7"], "the right eye is a 2 x 2 hole");
  // Symmetric about its own socket, so the pupil has no sideways bias: she is looking straight out.
  const xs = eye("peek", 29).map((p) => Number(p.split(",")[0]));
  const ys = eye("peek", 29).map((p) => Number(p.split(",")[1]));
  assert.equal(new Set(xs).size, 2);
  assert.equal(new Set(ys).size, 2);
});

test("peek: the ears, the nose and the zZz are untouched, so nothing else says she woke", () => {
  assert.deepEqual([at("peek", 24, 4), at("peek", 30, 4)], ["2", "2"], "ears still up");
  assert.equal(at("peek", 27, 8), "4", "nose unchanged");
  assert.equal(top("peek"), top("sleep"), "the silhouette does not move");
  assert.deepEqual(find("peek", "1"), find("sleep", "1"), "the zZz is unchanged");
});

// ---------------------------------------------------------------------------------------------
// The alarm: ears back and eyes open, then two blows with a paw, then a headbutt
// ---------------------------------------------------------------------------------------------

test("every waking pose drops the zZz and pins the ears back, so the two 1px tips leave the silhouette", () => {
  // Ears back is the one cue that survives at phone width, where an eye is two device pixels. It is drawn as
  // the two tips folding into a flat skull: the silhouette loses its points instead of growing new ink.
  for (const pose of ALARM) {
    const upright = ["recover"].includes(pose);
    const tips = [at(pose, 24, 4), at(pose, 30, 4)].filter((c) => c === "2").length;
    assert.equal(tips === 2, upright, `${pose} ${upright ? "needs its ears up again" : "must have its ears pinned"}`);
    assert.deepEqual(find(pose, "1").filter(([x]) => x >= 45), [], `${pose} still carries the zZz`);
  }
  // Pinned means flat, not missing: the skull's top row covers the same columns as the row under it,
  // holes included. The ears-up poses are the contrast, where the top row is only the two tips.
  const skull = (pose: string, y: number): number[] =>
    [...Array(11).keys()].map((i) => i + 22).filter((x) => at(pose, x, y) !== " ");
  for (const pose of ["alert", "swat-up", "swat-down", "glare"]) {
    const t = headTop(pose);
    assert.deepEqual(skull(pose, t), skull(pose, t + 1), `${pose}: the skull's top row is not flat`);
  }
  for (const pose of ["sleep", "peek", "recover"]) {
    const t = headTop(pose);
    assert.deepEqual(skull(pose, t), [24, 30], `${pose}: the ears should be two separate tips`);
    assert.ok(skull(pose, t + 1).length > 2, `${pose}: the row under the tips should be the whole skull`);
  }
});

test("alert: both eyes open into square holes and the body does not move, so the jolt is read on the face", () => {
  for (const x0 of [25, 29]) for (const y of [6, 7]) for (const x of [x0, x0 + 1]) {
    assert.equal(at("alert", x, y), "3", `alert eye pixel x${x} row ${y}`);
  }
  assert.equal(holes("alert").length, 8, "two 2 x 2 eyes and nothing else dark");
  // The body is planted: she is braced to hit something, not leaping. Rows 7 to 10 are sleep's, byte for byte.
  for (let y = 7; y < RACK_FROM; y++) assert.equal(G.alert[y], G.sleep[y], `alert row ${y} moved`);
});

test("swat-up: a paw is raised clear above the skull, on a forearm that reaches the body", () => {
  const paw = find("swat-up", "4").filter(([x, y]) => y <= 5 && x < 23);
  assert.ok(paw.length >= 2, "the raised paw is at least two pixels of accent, like the tucked paws it came from");
  const pawRow = Math.max(...paw.map(([, y]) => y));
  assert.ok(pawRow < headTop("swat-up"), `the paw is on row ${pawRow}, not above the skull at row ${headTop("swat-up")}`);
  // Connected all the way down: a floating paw is not a limb.
  const ink = new Set(catInk("swat-up").map(([x, y]) => `${x},${y}`));
  for (const [x, y] of paw) {
    let reached = false;
    const seen = new Set<string>();
    const walk = (p: string): void => {
      if (seen.has(p) || !ink.has(p)) return;
      seen.add(p);
      const [px, py] = p.split(",").map(Number);
      if (py >= 8) reached = true;
      for (const n of [`${px - 1},${py}`, `${px + 1},${py}`, `${px},${py - 1}`, `${px},${py + 1}`]) walk(n);
    };
    walk(`${x},${y}`);
    assert.ok(reached, `the raised paw at x${x} row ${y} is not joined to the body`);
  }
  assert.deepEqual([at("swat-up", 23, 10), at("swat-up", 24, 10)], ["2", "2"], "the tucked paw has left row 10");
  assert.deepEqual([at("swat-up", 27, 10), at("swat-up", 28, 10)], ["4", "4"], "the other front paw stays where it was");
});

test("swat-down: the same foreleg is flat on the chassis, further left than any reach in the nap", () => {
  const reach = (pose: string): number => Math.min(...catInk(pose).filter(([, y]) => y === RACK_FROM - 1).map(([x]) => x));
  assert.ok(reach("swat-down") < reach("stretch"), `the blow reaches x${reach("swat-down")}, no further than the stretch at x${reach("stretch")}`);
  assert.deepEqual([at("swat-down", 18, 10), at("swat-down", 19, 10)], ["4", "4"], "the paw itself is accent, as every paw in this artwork is");
  assert.deepEqual([at("swat-down", 23, 10), at("swat-down", 24, 10)], ["2", "2"], "the same paw is the one that left its tucked place");
  assert.deepEqual([at("swat-down", 27, 10), at("swat-down", 28, 10)], ["4", "4"], "the other front paw stays where it was");
});

test("the blow is one limb moving: only the foreleg and its sparks differ between the two halves", () => {
  // Isolating the moving part is what makes 400ms read as a deliberate whack rather than the whole cat
  // twitching. Everything above row 4 and right of x24 must be identical in the two halves.
  for (const c of changes("swat-up", "swat-down")) {
    const [x, y] = c.split(":")[0].split(",").map(Number);
    assert.ok(x <= 24, `the blow changes x${x} row ${y}, which is not the near foreleg`);
  }
  const travel = Math.max(...find("swat-down", "4").filter(([x]) => x < 23).map(([, y]) => y))
    - Math.min(...find("swat-up", "4").filter(([x]) => x < 23).map(([, y]) => y));
  assert.ok(travel >= 5, `the paw travels ${travel} art pixels, which is too small a swing to read`);
});

test("glare: the eyes narrow to a hard slit one row above the sleeping one, and the paw is back under her", () => {
  assert.deepEqual([25, 26, 29, 30].map((x) => at("glare", x, 6)), ["3", "3", "3", "3"], "slits on row 6");
  assert.deepEqual([25, 26, 29, 30].map((x) => at("glare", x, 7)), ["2", "2", "2", "2"], "nothing left on row 7");
  assert.equal(holes("glare").length, 4, "narrowed: half the dark pixels the alert has");
  assert.ok(holes("glare").length < holes("alert").length);
  assert.equal(G.glare[10], G.sleep[10], "the paw is tucked again, so the stillness is the beat");
  assert.deepEqual(find("glare", "1"), [], "nothing is being hit during the glare");
});

test("butt-up: the head rears higher than the cat ever reaches otherwise, on a neck that fills in behind it", () => {
  assert.equal(headTop("butt-up"), Math.min(...POSES.map(headTop)), "the reared head is the highest the skull gets");
  assert.ok(headTop("butt-up") <= headTop("alert") - 2, `the head rears from row ${headTop("alert")} to row ${headTop("butt-up")}, which is less than two pixels`);
  // The neck is solid behind it: a head that rears off a hole would tear away from the body.
  for (let y = headTop("butt-up"); y < RACK_FROM; y++) {
    assert.ok(catInk("butt-up").some(([x, cy]) => cy === y && x >= 23 && x <= 31), `butt-up row ${y} is empty under the reared head`);
  }
  assert.equal(holes("butt-up").length, 8, "the eyes stay wide while she aims");
});

test("butt-down: the head is driven three rows down from the rear, eyes screwed shut, sparks on the chassis", () => {
  assert.equal(headTop("butt-down") - headTop("butt-up"), 3, "the swing of the headbutt");
  assert.equal(headTop("butt-down"), Math.max(...POSES.map(headTop)), "the driven head is the lowest the skull gets");
  // Shut, not open: a cat squeezes its eyes closed on impact, and the slits read as effort.
  assert.deepEqual([25, 26, 29, 30].map((x) => at("butt-down", x, 7)), ["3", "3", "3", "3"]);
  assert.equal(holes("butt-down").length, 4);
  assert.deepEqual([at("butt-down", 24, 4), at("butt-down", 30, 4)], [" ", " "], "no ear tips: the ears are flat against the skull");
  assert.equal(find("butt-down", "1").length, 2, "the impact sparks");
});

test("recover: ears up, both eyes open, no zZz yet, and otherwise the sleeping cat", () => {
  // It is deliberately the in-between back to sleep: the only things that change at the cut are the eyes
  // closing and the zZz returning, so the loop joins without a jolt.
  assert.deepEqual([at("recover", 24, 4), at("recover", 30, 4)], ["2", "2"], "ears up again");
  assert.deepEqual(find("recover", "1"), [], "she is awake, so there is no zZz");
  for (const x0 of [25, 29]) for (const y of [6, 7]) for (const x of [x0, x0 + 1]) {
    assert.equal(at("recover", x, y), "3", `recover eye pixel x${x} row ${y}`);
  }
  assert.deepEqual(changes("recover", "sleep").map((c) => c.split(":")[0]).filter((p) => Number(p.split(",")[0]) < 45), ["25,6", "26,6", "29,6", "30,6"]);
});

test("the alarm reads as an arc: the skull rises, slams, and comes back level", () => {
  // The sequence a viewer actually sees, as rows, in timeline order. A pose drawn at the wrong height
  // would flatten the arc without failing any single-pose test.
  const order = ["alert", "swat-up", "swat-down", "glare", "butt-up", "butt-down", "recover"];
  const rows = order.map(headTop);
  assert.deepEqual(rows, [5, 5, 5, 5, 3, 6, 4]);
  assert.ok(rows[4] < rows[3], "the head must rear before it strikes");
  assert.ok(rows[5] > rows[4] + 2, "the strike must travel");
  assert.ok(rows[6] < rows[5], "and she must lift her head again afterwards");
});

test("a nap pose changes little; an alarm pose may change more, but never redraws the cat", () => {
  // Shipped idle animations move one or two pixels, so a nap pose that is obviously different in the grid
  // diff is too much. The alarm is a gesture rather than an idle, so its budget is larger on purpose, and
  // a floor is added: a blow that moved almost nothing would not read at all.
  const measured: Record<string, number> = {
    yawn: 20, settle: 14, stretch: 36, peek: 2,
    alert: 12, "swat-up": 20, "swat-down": 22, glare: 16, "butt-up": 32, "butt-down": 16, recover: 6,
  };
  assert.deepEqual(Object.keys(measured).sort(), POSES.filter((p) => p !== "sleep").sort());
  for (const [pose, limit] of Object.entries(measured)) {
    assert.ok(diff(pose, "sleep") <= limit, `${pose} differs in ${diff(pose, "sleep")} pixels, limit ${limit}`);
  }
  const ink = catInk("sleep").length;
  for (const pose of POSES) assert.ok(diff(pose, "sleep") < ink / 2, `${pose} redraws more than half the cat`);
  for (const pose of ["swat-up", "swat-down", "butt-up", "butt-down"]) {
    assert.ok(diff(pose, "sleep") >= 10, `${pose} differs in only ${diff(pose, "sleep")} pixels, which is below what reads as a blow`);
  }
});
