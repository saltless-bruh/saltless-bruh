import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContent, assertNoForbiddenNames } from "../src/content.ts";
import type { Content } from "../src/content.ts";
import { FORBIDDEN_GLYPHS, fontCoverage } from "../src/font.ts";
import { MASCOT_TIMELINE } from "../src/timeline.ts";

// Every rejection test starts from this known-good document and changes exactly one
// thing, so a rejection can only come from that change. It is deliberately independent
// of the owner's content.json, which the owner is free to edit.
const VALID: Content = {
  handle: "TESTER",
  // Deliberately unlike the handle: the two are different values and the fixture must not
  // let a generator confuse them.
  login: "tester-account",
  prompt: { host: "testhost", command: "testing &" },
  role: "Fixture role · with a middle dot",
  whoami: ["line one", "line two", "line three"],
  lanes: [
    { label: "alpha/", repos: [{ name: "repo-a1", blurb: "does a thing" }, { name: "repo-a2", blurb: "does another" }] },
    { label: "beta/", repos: [{ name: "repo-b1", blurb: "does b" }] },
  ],
  stackRows: [
    { label: "first", items: ["one", "two"] },
    { label: "", items: ["three"] },
  ],
  verbs: {
    sleep: ["Loafing", "Dozing"],
    yawn: ["Yawning"],
    stretch: ["Stretching"],
    settle: ["Resettling"],
    peek: ["Peeking"],
    alert: ["Waking"],
    "swat-up": ["Swatting"],
    "swat-down": ["Swatting"],
    glare: ["Glaring"],
    "butt-up": ["Butting"],
    "butt-down": ["Butting"],
    recover: ["Recovering"],
  },
  activityLine: { label: "fixture done:", daysUp: "days seen", contributions: "pushes" },
  statusline: {
    effortWord: "Fixtureffort", effortEnds: { start: "Fixturestart", end: "Fixtureend" },
    effortLabels: ["low", "mid", "lazy", "max"], effortSelected: "lazy", modeBadge: "autopilot on",
    note: "fixture note", toggle: { word: "Fixtureword", state: "off" },
    toggleNote: "fixture gloss", toggleHint: "fixture hint", help: ["fixture key", "fixture other key"],
  },
  readme: { imageAlt: "a fixture picture of a fixture session", transcriptSummary: "Fixture transcript" },
};

const STATES = [...new Set(MASCOT_TIMELINE.map((w) => w.state))];
const SHIPPED = new URL("../content.json", import.meta.url);

const dir = mkdtempSync(join(tmpdir(), "content-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

let written = 0;
const write = (body: string): string => {
  const p = join(dir, `fixture-${written++}.json`);
  writeFileSync(p, body);
  return p;
};
const load = (doc: unknown): Content => loadContent(write(JSON.stringify(doc)));

/** The message loadContent rejects a file body with; fails the test if it accepts the file instead. */
function fileRejection(body: string, why: string, loader: typeof loadContent = loadContent): string {
  try {
    loader(write(body));
  } catch (e) {
    assert.ok(e instanceof Error, `${why}: threw a non-Error`);
    return e.message;
  }
  return assert.fail(`${why}: the document loaded without error`);
}
const rejection = (doc: unknown, why: string, loader: typeof loadContent = loadContent): string =>
  fileRejection(JSON.stringify(doc), why, loader);

// Paths are written the way the loader reports them: `lanes[0].repos[1].blurb`.
const parse = (path: string): (string | number)[] =>
  path.match(/[^.[\]]+/g)!.map((s) => (/^\d+$/.test(s) ? Number(s) : s));

/** A copy of VALID with one value replaced, or removed when `value` is undefined. */
function edited(path: string, value: unknown): Record<string, any> {
  const doc: Record<string, any> = structuredClone(VALID);
  const segs = parse(path);
  const last = segs.pop()!;
  let node: any = doc;
  for (const s of segs) node = node[s];
  if (value === undefined) delete node[last];
  else node[last] = value;
  return doc;
}

/** Every string value in a document, as a path. */
function leaves(v: unknown, path = ""): string[] {
  if (typeof v === "string") return [path];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, `${path}[${i}]`));
  if (v && typeof v === "object") {
    return Object.entries(v).flatMap(([k, x]) => leaves(x, path ? `${path}.${k}` : k));
  }
  return [];
}

/** VALID with `text` at one leaf. The selected effort label is a duplicate of a label, so they move together. */
function withText(path: string, text: string): Record<string, any> {
  const doc = edited(path, text);
  if (path === `statusline.effortLabels[${VALID.statusline.effortLabels.indexOf(VALID.statusline.effortSelected)}]`) {
    doc.statusline.effortSelected = text;
  }
  return doc;
}

// ---- the shipped file ----------------------------------------------------------------

test("the shipped content file validates unchanged and is returned exactly as written", () => {
  const c = loadContent();
  assert.deepEqual(c, JSON.parse(readFileSync(SHIPPED, "utf8")));
  assert.ok(c.lanes.length > 0);
  assert.ok(c.stackRows.length > 0);
  assert.ok(c.whoami.length > 0 && c.whoami.length <= 3);
  for (const lane of c.lanes) for (const r of lane.repos) assert.ok(r.blurb.trim().length > 0, `${r.name} has no blurb`);
});

test("every mascot state has at least one spinner word in the shipped file", () => {
  const c = loadContent();
  assert.deepEqual([...STATES].sort(), [
    "alert", "butt-down", "butt-up", "glare", "peek", "recover",
    "settle", "sleep", "stretch", "swat-down", "swat-up", "yawn",
  ]);
  for (const state of STATES) assert.ok(c.verbs[state].length > 0, `verbs.${state} is empty`);
});

test("Regular and Bold cover the same codepoints, so checking Regular also covers Bold text", () => {
  const regular = fontCoverage(readFileSync(new URL("../vendor/JetBrainsMono-Regular.ttf", import.meta.url)));
  const bold = fontCoverage(readFileSync(new URL("../vendor/JetBrainsMono-Bold.ttf", import.meta.url)));
  assert.ok(regular.size > 1000);
  assert.deepEqual([...bold].sort((a, b) => a - b), [...regular].sort((a, b) => a - b));
});

test("the default path is the repo-root content.json whatever the working directory", () => {
  const here = process.cwd();
  process.chdir(dir);
  try {
    assert.deepEqual(loadContent(), JSON.parse(readFileSync(SHIPPED, "utf8")));
  } finally {
    process.chdir(here);
  }
});

// ---- what is accepted ----------------------------------------------------------------

test("a well-formed document loads and comes back unchanged", () => {
  assert.deepEqual(load(VALID), VALID);
});

test("a stack row may have an empty label, because a row can continue the one above", () => {
  assert.equal(load(VALID).stackRows[1].label, "");
});

test("Vietnamese and the middle dot are drawable, so content may use them", () => {
  const c = load(edited("role", "kỹ sư bảo mật · ăâđêôơư ạắằẵặ"));
  assert.equal(c.role, "kỹ sư bảo mật · ăâđêôơư ạắằẵặ");
});

test("the smallest valid document loads: one of everything", () => {
  const smallest: Content = {
    handle: "H", login: "l", prompt: { host: "h", command: "c" }, role: "r", whoami: ["w"],
    lanes: [{ label: "l/", repos: [{ name: "n", blurb: "b" }] }],
    stackRows: [{ label: "", items: ["i"] }],
    verbs: {
      sleep: ["a"], yawn: ["b"], stretch: ["c"], settle: ["d"], peek: ["e"], alert: ["f"],
      "swat-up": ["g"], "swat-down": ["h"], glare: ["i"], "butt-up": ["j"], "butt-down": ["k"], recover: ["l"],
    },
    activityLine: { label: "a", daysUp: "d", contributions: "c" },
    statusline: {
      effortWord: "e", effortEnds: { start: "f", end: "s" },
      effortLabels: ["only"], effortSelected: "only",
      modeBadge: "m", note: "n", toggle: { word: "t", state: "s" },
      toggleNote: "g", toggleHint: "h", help: ["k"],
    },
    readme: { imageAlt: "a", transcriptSummary: "t" },
  };
  assert.deepEqual(load(smallest), smallest);
});

test("whoami accepts exactly one and exactly three lines", () => {
  assert.equal(load(edited("whoami", ["only"])).whoami.length, 1);
  assert.equal(load(edited("whoami", ["a", "b", "c"])).whoami.length, 3);
});

// ---- structure: each rule rejects, and names what is wrong --------------------------

const STRUCTURE: [string, unknown, RegExp][] = [
  // verbs: every state the mascot can reach, one at a time
  ...STATES.flatMap((s): [string, unknown, RegExp][] => [
    [`verbs.${s}`, undefined, new RegExp(`verbs\\.${s} must list at least one word`)],
    [`verbs.${s}`, [], new RegExp(`verbs\\.${s} must list at least one word`)],
    [`verbs.${s}`, "Yawning", new RegExp(`verbs\\.${s} must list at least one word`)],
    [`verbs.${s}[0]`, "   ", new RegExp(`verbs\\.${s}\\[0\\] must not be blank`)],
    [`verbs.${s}[0]`, 7, new RegExp(`verbs\\.${s}\\[0\\] must be a string`)],
  ]),
  ["verbs", ["Loafing", "Dozing"], /verbs must be an object keyed by mascot state/],
  ["verbs", undefined, /verbs must be an object keyed by mascot state/],

  // whoami
  ["whoami", ["a", "b", "c", "d"], /whoami must have 1 to 3 lines/],
  ["whoami", [], /whoami must have 1 to 3 lines/],
  ["whoami", "hi", /whoami must have 1 to 3 lines/],
  ["whoami", undefined, /whoami must have 1 to 3 lines/],
  ["whoami[1]", "  ", /whoami\[1\] must not be blank/],
  ["whoami[2]", 3, /whoami\[2\] must be a string/],

  // lanes and repos
  ["lanes", [], /lanes must be a non-empty list/],
  ["lanes", undefined, /lanes must be a non-empty list/],
  ["lanes", "alpha/", /lanes must be a non-empty list/],
  ["lanes[1]", "beta/", /lanes\[1\] must be an object/],
  ["lanes[1].label", "  ", /lanes\[1\]\.label must not be blank/],
  ["lanes[1].repos", [], /lane beta\/ has no repos/],
  ["lanes[1].repos", undefined, /lane beta\/ has no repos/],
  ["lanes[0].repos[1]", "repo-a2", /lanes\[0\]\.repos\[1\] must be an object/],
  ["lanes[0].repos[1].name", "", /lanes\[0\]\.repos\[1\]\.name must not be blank/],
  ["lanes[0].repos[1].name", undefined, /lanes\[0\]\.repos\[1\]\.name must be a string/],
  ["lanes[1].repos[0].blurb", "   ", /repo repo-b1 needs a non-blank blurb/],
  ["lanes[1].repos[0].blurb", "", /repo repo-b1 needs a non-blank blurb/],
  ["lanes[1].repos[0].blurb", undefined, /repo repo-b1 needs a non-blank blurb/],
  ["lanes[1].repos[0].blurb", 12, /repo repo-b1 needs a non-blank blurb/],

  // stack rows
  ["stackRows", [], /stackRows must be a non-empty list/],
  ["stackRows", undefined, /stackRows must be a non-empty list/],
  ["stackRows[1]", "three", /stackRows\[1\] must be an object/],
  ["stackRows[1].label", undefined, /stackRows\[1\]\.label must be a string/],
  ["stackRows[1].label", 4, /stackRows\[1\]\.label must be a string/],
  ["stackRows[1].items", [], /stackRows\[1\]\.items must be a non-empty list/],
  ["stackRows[1].items", undefined, /stackRows\[1\]\.items must be a non-empty list/],
  ["stackRows[0].items[1]", "  ", /stackRows\[0\]\.items\[1\] must not be blank/],
  ["stackRows[0].items[1]", 5, /stackRows\[0\]\.items\[1\] must be a string/],

  // identity lines
  ...["handle", "login", "role", "prompt.host", "prompt.command"].flatMap((f): [string, unknown, RegExp][] => [
    [f, undefined, new RegExp(`${f} must be a string`)],
    [f, "   ", new RegExp(`${f} must not be blank`)],
    [f, 9, new RegExp(`${f} must be a string`)],
  ]),

  // the /activity result line, as labelled fragments
  ["activityLine", undefined, /activityLine must be an object/],
  ["activityLine", "scan complete:", /activityLine must be an object/],
  ["activityLine.label", undefined, /activityLine\.label must be a string/],
  ["activityLine.label", "  ", /activityLine\.label must not be blank/],
  ["activityLine.daysUp", undefined, /activityLine\.daysUp must be a string/],
  ["activityLine.daysUp", "", /activityLine\.daysUp must not be blank/],
  ["activityLine.contributions", undefined, /activityLine\.contributions must be a string/],
  ["activityLine.contributions", 4, /activityLine\.contributions must be a string/],

  // statusline
  ["statusline", undefined, /statusline must be an object/],
  ["statusline.effortWord", undefined, /statusline\.effortWord must be a string/],
  ["statusline.effortWord", " ", /statusline\.effortWord must not be blank/],
  ["statusline.effortWord", 6, /statusline\.effortWord must be a string/],
  ["statusline.effortLabels", [], /statusline\.effortLabels must not be empty/],
  ["statusline.effortLabels", undefined, /statusline\.effortLabels must not be empty/],
  ["statusline.effortLabels[0]", " ", /statusline\.effortLabels\[0\] must not be blank/],
  ["statusline.effortSelected", "turbo", /statusline\.effortSelected must be one of effortLabels/],
  ["statusline.effortSelected", undefined, /statusline\.effortSelected must be one of effortLabels/],
  // membership, not substring: a part of a label, or a label plus more, is not a label
  ["statusline.effortSelected", "laz", /statusline\.effortSelected must be one of effortLabels/],
  ["statusline.effortSelected", "lazy extra", /statusline\.effortSelected must be one of effortLabels/],
  ["statusline.effortSelected", "", /statusline\.effortSelected must be one of effortLabels/],
  ["statusline.effortSelected", "LAZY", /statusline\.effortSelected must be one of effortLabels/],
  ["statusline.modeBadge", " ", /statusline\.modeBadge must not be blank/],
  ["statusline.modeBadge", undefined, /statusline\.modeBadge must be a string/],
  ["statusline.note", "", /statusline\.note must not be blank/],
  ["statusline.note", undefined, /statusline\.note must be a string/],
  // the toggle: its own copy, so it is validated like any other visible string
  ["statusline.toggle", undefined, /statusline\.toggle must be an object/],
  ["statusline.toggle", "Ultrachill on", /statusline\.toggle must be an object/],
  ["statusline.toggle", [], /statusline\.toggle must be an object/],
  ["statusline.toggle.word", undefined, /statusline\.toggle\.word must be a string/],
  ["statusline.toggle.word", "   ", /statusline\.toggle\.word must not be blank/],
  ["statusline.toggle.word", "", /statusline\.toggle\.word must not be blank/],
  ["statusline.toggle.word", 3, /statusline\.toggle\.word must be a string/],
  ["statusline.toggle.state", undefined, /statusline\.toggle\.state must be a string/],
  ["statusline.toggle.state", " ", /statusline\.toggle\.state must not be blank/],
  ["statusline.toggle.state", true, /statusline\.toggle\.state must be a string/],
  // the README's own two visible strings: the picture's accessible name and the transcript's
  // label. A blank alt is the one that matters most, because it is not a missing word, it is a
  // picture a screen reader announces as nothing at all.
  ["readme", undefined, /readme must be an object/],
  ["readme", "a terminal session", /readme must be an object/],
  ["readme", [], /readme must be an object/],
  ["readme.imageAlt", undefined, /readme\.imageAlt must be a string/],
  ["readme.imageAlt", "", /readme\.imageAlt must not be blank/],
  ["readme.imageAlt", "   ", /readme\.imageAlt must not be blank/],
  ["readme.imageAlt", 7, /readme\.imageAlt must be a string/],
  ["readme.transcriptSummary", undefined, /readme\.transcriptSummary must be a string/],
  ["readme.transcriptSummary", " ", /readme\.transcriptSummary must not be blank/],
  ["readme.transcriptSummary", false, /readme\.transcriptSummary must be a string/],
];

test("the structure table covers every mascot state, and the baseline it edits loads", () => {
  for (const s of STATES) assert.ok(STRUCTURE.some(([path]) => path === `verbs.${s}`), `no row for verbs.${s}`);
  assert.ok(STRUCTURE.length > 60);
  assert.doesNotThrow(() => load(VALID));
});

for (const [path, value, expected] of STRUCTURE) {
  const shown = value === undefined ? "removed" : JSON.stringify(value);
  test(`rejects ${path} = ${shown}`, () => {
    assert.match(rejection(edited(path, value), `${path} = ${shown}`), expected);
  });
}

test("a blank blurb names the repo that has it, not a sibling", () => {
  const msg = rejection(edited("lanes[1].repos[0].blurb", "   "), "blank blurb");
  assert.match(msg, /repo-b1/);
  assert.doesNotMatch(msg, /repo-a1|repo-a2/);
});

test("a lane without repos names that lane, not another", () => {
  const msg = rejection(edited("lanes[1].repos", []), "empty lane");
  assert.match(msg, /beta\//);
  assert.doesNotMatch(msg, /alpha\//);
});

test("a top level that is not an object is rejected", () => {
  for (const top of [[], null, "text", 7]) {
    assert.match(rejection(top, `top level ${JSON.stringify(top)}`), /the top level must be an object/);
  }
});

test("a file that is not JSON is rejected, and the message says so", () => {
  for (const body of ["{ not json", "", '{"handle": "x",}']) {
    assert.throws(() => loadContent(write(body)), /content\.json: not valid JSON/);
  }
});

// ---- content: every string must be drawable and must carry no forbidden name --------

// effortSelected must match a label and login must be an account name, so neither can hold the
// arbitrary text these sweeps push through every other field. Both keep their own tests below.
const EDITABLE = leaves(VALID).filter((p) => p !== "statusline.effortSelected" && p !== "login");

test("the sweep covers every string in the document, so it cannot pass vacuously", () => {
  assert.equal(leaves(VALID).length, 55);
  for (const expected of [
    "handle", "prompt.host", "prompt.command", "whoami[2]", "lanes[1].repos[0].blurb", "stackRows[1].items[0]", "verbs.sleep[1]",
    "verbs.swat-down[0]", "verbs.recover[0]",
    "statusline.note", "statusline.toggle.word", "statusline.toggle.state", "statusline.effortWord",
    "statusline.effortEnds.start", "statusline.effortEnds.end",
    "statusline.toggleNote", "statusline.toggleHint", "statusline.help[1]",
    "activityLine.label", "activityLine.daysUp", "activityLine.contributions",
    "readme.imageAlt", "readme.transcriptSummary",
  ]) {
    assert.ok(EDITABLE.includes(expected), `${expected} is not swept`);
  }
});

test("a character outside the font is rejected wherever it appears, naming the field and the codepoint", () => {
  for (const path of EDITABLE) {
    const msg = rejection(withText(path, "ok 🙂 ok"), `emoji in ${path}`);
    assert.ok(msg.includes(path), `message does not name ${path}: ${msg}`);
    assert.match(msg, /U\+1F642/, `message does not name the codepoint for ${path}`);
  }
});

test("a character outside the font is found at the start and the end of a string too", () => {
  for (const text of ["🙂 start", "end 🙂"]) {
    assert.match(rejection(edited("role", text), text), /role.*U\+1F642/);
  }
});

test("a forbidden glyph is rejected wherever it appears, naming the field", () => {
  for (const path of EDITABLE) {
    const msg = rejection(withText(path, "ok ⎿ ok"), `glyph in ${path}`);
    assert.ok(msg.includes(path), `message does not name ${path}: ${msg}`);
    assert.match(msg, /⎿ \(U\+23BF\), which the font cannot draw/, `wrong message for ${path}: ${msg}`);
  }
});

test("each forbidden glyph is rejected on its own", () => {
  assert.equal([...FORBIDDEN_GLYPHS].length, 10);
  for (const ch of FORBIDDEN_GLYPHS) {
    const msg = rejection(edited("role", `a${ch}b`), `glyph ${ch}`);
    assert.ok(msg.includes(ch), `message does not show ${ch}: ${msg}`);
    assert.match(msg, /which the font cannot draw/);
  }
});

test("a forbidden name is rejected wherever it appears, in any case, without echoing it", () => {
  for (const path of EDITABLE) {
    const msg = rejection(withText(path, "see fIrStNaMe LaStNaMe now"), `name in ${path}`);
    assert.ok(msg.includes(path), `message does not name ${path}: ${msg}`);
    assert.match(msg, /forbidden name appears/);
    assert.ok(!/firstname|lastname/i.test(msg), `message echoes the name for ${path}: ${msg}`);
  }
});

test("strings outside the known fields are checked too", () => {
  assert.match(rejection({ ...VALID, aside: "🙂" }, "emoji in an unknown field"), /aside.*U\+1F642/);
  assert.match(rejection({ ...VALID, aside: ["Firstname Lastname"] }, "name in an unknown field"), /aside\[0\]/);
});

test("a name written as a JSON escape is caught after parsing", () => {
  const raw = JSON.stringify(VALID).replace("TESTER", "Firstname\\u0020Lastname");
  assert.ok(raw.includes("\\u0020"));
  assert.throws(() => loadContent(write(raw)), /forbidden name appears in content\.json field handle/);
});

test("a name used as an object key is caught, though no string value carries it", () => {
  const msg = rejection({ ...VALID, "Firstname Lastname": 1 }, "name as a key");
  assert.match(msg, /forbidden name appears in content\.json, in a key under the top level/);
  assert.ok(!/firstname/i.test(msg), `message echoes the name: ${msg}`);
});

test("a forbidden name is caught wherever it appears", () => {
  assert.throws(() => assertNoForbiddenNames("contact Firstname Lastname", "test input"), /test input/);
});

test("assertNoForbiddenNames is case-insensitive, matches the whole name only, and passes clean text", () => {
  assert.throws(() => assertNoForbiddenNames("FIRSTNAME LASTNAME", "x"), /forbidden name/);
  assert.throws(() => assertNoForbiddenNames("a firstname lastname b", "x"), /forbidden name/);
  assert.doesNotThrow(() => assertNoForbiddenNames("Firstname", "x"));
  assert.doesNotThrow(() => assertNoForbiddenNames("Lastname Firstname", "x"));
  assert.doesNotThrow(() => assertNoForbiddenNames("", "x"));
  assert.doesNotThrow(() => assertNoForbiddenNames("nothing to see here", "x"));
});

// ---- a message must never quote a name -----------------------------------------------
// Build logs can be public. Any error that quotes a value from the file (a repo name, a lane
// label, the source near a syntax error, a key in a path) must run only after the name scan,
// or the guard prints exactly what it protects. These pin the order, not just the outcome.

const NAME_ERROR = /forbidden name appears in /;
const quotesNoName = (msg: string, ...names: string[]): void => {
  for (const name of names) assert.ok(!msg.toLowerCase().includes(name.toLowerCase()), `message quotes "${name}": ${msg}`);
};

test("a forbidden repo name with a blank blurb reports the name error, not the blurb error that would quote it", async () => {
  const mod = await contentWith("Jane Placeholder");
  const doc = edited("lanes[1].repos[0].name", "Jane Placeholder");
  doc.lanes[1].repos[0].blurb = "   ";
  const msg = rejection(doc, "name plus blank blurb", mod.loadContent);
  assert.match(msg, /forbidden name appears in content\.json field lanes\[1\]\.repos\[0\]\.name/);
  quotesNoName(msg, "Jane Placeholder");
  // the same document without the name is rejected for the blurb, so the ordering is what hid it
  doc.lanes[1].repos[0].name = "repo-b1";
  assert.match(rejection(doc, "blank blurb alone", mod.loadContent), /repo repo-b1 needs a non-blank blurb/);
});

test("a forbidden lane label with no repos reports the name error, not the lane error that would quote it", async () => {
  const mod = await contentWith("Jane Placeholder");
  const doc = edited("lanes[1].label", "Jane Placeholder");
  doc.lanes[1].repos = [];
  const msg = rejection(doc, "name plus empty lane", mod.loadContent);
  assert.match(msg, /forbidden name appears in content\.json field lanes\[1\]\.label/);
  quotesNoName(msg, "Jane Placeholder");
});

test("the committed name is held to the same order", () => {
  const doc = edited("lanes[1].repos[0].name", "Firstname Lastname");
  doc.lanes[1].repos[0].blurb = "";
  const msg = rejection(doc, "committed name plus blank blurb");
  assert.match(msg, NAME_ERROR);
  quotesNoName(msg, "Firstname Lastname");
});

test("a name inside a syntax error's quoted source is not repeated", async () => {
  const mod = await contentWith("Jane Placeholder");
  // V8 quotes the text around an unexpected token, so these would otherwise echo the name.
  assert.match(JSON.stringify(readSyntaxError('{"role": Firstname Lastname}')), /Firstname/, "premise: V8 quotes the source");
  for (const body of ["Firstname Lastname", '{"role": Firstname Lastname}']) {
    const msg = fileRejection(body, body);
    assert.match(msg, NAME_ERROR);
    quotesNoName(msg, "Firstname Lastname");
  }
  const viaEnv = fileRejection('{"role": Jane Placeholder}', "name from the variable", mod.loadContent);
  assert.match(viaEnv, NAME_ERROR);
  quotesNoName(viaEnv, "Jane Placeholder");
});

test("a name used as a key never reaches a path in a later message", () => {
  // The key is spelled with a JSON escape, so the raw text holds no literal name and only the
  // parsed key carries it. The value would otherwise fail the font check and quote the path.
  const raw = JSON.stringify({ ...VALID, aside: { "@@KEY@@": "🙂" } }).replace("@@KEY@@", "Firstname\\u0020Lastname");
  assert.ok(!raw.includes("Firstname Lastname"), "premise: the raw text has no literal name");
  const msg = fileRejection(raw, "escaped name as a key");
  assert.match(msg, /forbidden name appears in content\.json, in a key under aside/);
  quotesNoName(msg, "Firstname Lastname");
});

test("a name used as a literal key is not quoted by a later message either", () => {
  const msg = rejection({ ...VALID, aside: { "Firstname Lastname": "🙂" } }, "literal name as a key");
  assert.match(msg, NAME_ERROR);
  quotesNoName(msg, "Firstname Lastname");
});

test("a key and its value that are both names do not make the key appear in the message", () => {
  const msg = rejection({ ...VALID, aside: { "Firstname Lastname": "Firstname Lastname" } }, "name as key and value");
  assert.match(msg, NAME_ERROR);
  quotesNoName(msg, "Firstname Lastname");
});

test("a name in an earlier duplicate key is caught, though JSON.parse keeps only the last", () => {
  const raw = JSON.stringify(VALID).replace("{", '{"handle":"Firstname Lastname",');
  assert.equal(JSON.parse(raw).handle, "TESTER", "premise: the parsed document no longer holds the name");
  const msg = fileRejection(raw, "duplicate key");
  assert.match(msg, /forbidden name appears in content\.json \(/);
  quotesNoName(msg, "Firstname Lastname");
  // with a shape error as well, the name still wins: every name scan precedes the shape check
  const alsoBroken = JSON.stringify({ ...VALID, role: "  " }).replace("{", '{"handle":"Firstname Lastname",');
  assert.match(fileRejection(alsoBroken, "duplicate key plus blank role"), /forbidden name appears in content\.json \(/);
});

function readSyntaxError(body: string): string {
  try {
    JSON.parse(body);
  } catch (e) {
    return (e as Error).message;
  }
  return assert.fail("expected a syntax error");
}

// ---- PROFILE_FORBIDDEN_NAMES ---------------------------------------------------------
// The module reads the variable once, at import. Each case imports a fresh instance of it
// under a distinct URL so the variable can be set per case; the real code is what runs.

type ContentModule = typeof import("../src/content.ts");
let instances = 0;
async function contentWith(value: string | undefined): Promise<ContentModule> {
  const key = "PROFILE_FORBIDDEN_NAMES";
  const saved = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return await import(`../src/content.ts?env-case=${instances++}`);
  } finally {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
}

const COMMITTED = ["Firstname Lastname"];

test("with the variable unset, the list is exactly the committed one", async () => {
  assert.deepEqual((await contentWith(undefined)).FORBIDDEN_NAMES, COMMITTED);
});

test("with the variable empty, blank or only separators, the list is exactly the committed one", async () => {
  for (const value of ["", "   ", ",", " , ,, "]) {
    assert.deepEqual((await contentWith(value)).FORBIDDEN_NAMES, COMMITTED, JSON.stringify(value));
  }
});

test("a two-name comma list is merged after the committed list and trimmed", async () => {
  const mod = await contentWith("Jane Placeholder, Alex Example");
  assert.deepEqual(mod.FORBIDDEN_NAMES, [...COMMITTED, "Jane Placeholder", "Alex Example"]);
});

test("a name from the variable is rejected by the loader, in any case, without being echoed", async () => {
  const mod = await contentWith("Jane Placeholder, Alex Example");
  for (const name of ["Jane Placeholder", "ALEX EXAMPLE"]) {
    const msg = rejection(edited("lanes[1].repos[0].blurb", `by ${name} today`), name, mod.loadContent);
    assert.match(msg, /forbidden name appears in content\.json field lanes\[1\]\.repos\[0\]\.blurb/);
    assert.ok(!/jane|placeholder|alex|example/i.test(msg), `message echoes a name: ${msg}`);
  }
});

test("the variable adds to the committed list rather than replacing it", async () => {
  const mod = await contentWith("Jane Placeholder");
  assert.match(rejection(edited("role", "Firstname Lastname"), "committed name"), /forbidden name/);
  assert.match(rejection(edited("role", "Firstname Lastname"), "committed name", mod.loadContent), /forbidden name/);
  assert.throws(() => mod.assertNoForbiddenNames("Firstname Lastname", "x"), /forbidden name/);
  assert.throws(() => mod.assertNoForbiddenNames("Jane Placeholder", "x"), /forbidden name/);
});

test("a clean document still loads when the variable is set", async () => {
  const mod = await contentWith("Jane Placeholder, Alex Example");
  assert.deepEqual(mod.loadContent(write(JSON.stringify(VALID))), VALID);
});

test("with the variable unset, the same names are not special", async () => {
  const mod = await contentWith(undefined);
  const doc = edited("role", "Jane Placeholder and Alex Example");
  assert.equal(mod.loadContent(write(JSON.stringify(doc))).role, "Jane Placeholder and Alex Example");
});

test("an empty entry in the list is ignored, not treated as matching everything", async () => {
  const mod = await contentWith(undefined);
  mod.FORBIDDEN_NAMES.push("");
  assert.deepEqual(mod.loadContent(write(JSON.stringify(VALID))), VALID);
  assert.throws(() => mod.assertNoForbiddenNames("Firstname Lastname", "x"), /forbidden name/);
});

// ---- login: the account the API is queried by, which is not the drawn handle ---------

test("the login and the drawn handle are separate fields, so neither stands in for the other", () => {
  const c = load(VALID);
  assert.equal(c.login, "tester-account");
  assert.equal(c.handle, "TESTER");
  assert.notEqual(c.login, c.handle);
});

test("a login shaped like something a person pastes by mistake is refused", () => {
  // "@name" is how prose writes it and "owner/repo" is how a URL does. Either one returns no
  // user from the API, which is a confusing way to learn about a typo in content.json.
  for (const bad of ["@tester-account", "tester/account", "tester account", " tester", "tester "]) {
    assert.match(
      rejection(edited("login", bad), `login = ${JSON.stringify(bad)}`),
      /login must be a GitHub account name/,
      `accepted ${JSON.stringify(bad)}`,
    );
  }
});

test("an ordinary login is accepted, hyphens and digits included", () => {
  for (const good of ["saltless-bruh", "a", "User123", "a-b-c-9"]) {
    assert.doesNotThrow(() => load({ ...VALID, login: good }), `rejected ${good}`);
  }
});

test("a name in the login is reported as a name, not as a badly shaped account", () => {
  // The value breaks the account-name rule as well, so this pins the order: names are ruled out
  // before any message that could quote the field is allowed to be built.
  const msg = rejection(edited("login", "x fIrStNaMe LaStNaMe x"), "name in login");
  assert.match(msg, /forbidden name appears/);
  assert.ok(!/firstname|lastname/i.test(msg), `message echoes the name: ${msg}`);
});

test("the shipped content.json carries a login the API could be queried by", () => {
  const shipped = JSON.parse(readFileSync(SHIPPED, "utf8"));
  assert.equal(typeof shipped.login, "string");
  assert.match(shipped.login, /^[^\s@/]+$/);
});
