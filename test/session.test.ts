import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadContent } from "../src/content.ts";
import type { Content } from "../src/content.ts";
import { assertNoCollisions, composeSession, languageShares, SCAN_ROWS, VERB_SUFFIX } from "../src/session.ts";
import type { Activity } from "../src/session.ts";
import { assertFits, rowsToText, renderRows, charsUsed } from "../src/rows.ts";
import type { Row, Run } from "../src/rows.ts";
import { BASELINE_IN_ROW, CELL_H, CELL_W, COLS, FONT_SIZE, PAD } from "../src/grid.ts";
import { MASCOT_COLS, MASCOT_ROWS } from "../src/mascot.ts";
import { MASCOT_TIMELINE as POSES_TIMELINE } from "../src/timeline.ts";
import { BANNER_ROWS, bannerWidthCols } from "../src/banner.ts";
import { assertCovered } from "../src/font.ts";
import { MASCOT_TIMELINE } from "../src/timeline.ts";
import { WINDOW_DAYS } from "../src/activity.ts";

const activity: Activity = {
  totalContributions: 950, activeDays: 99,
  calendar: [{ date: "2026-01-01", count: 3 }],
  languages: [{ name: "Alpha", bytes: 700 }, { name: "Beta", bytes: 300 }],
};

/** A year as a profile might really show it: six languages, one with a long name, big numbers. */
const busy: Activity = {
  totalContributions: 12345, activeDays: 365,
  calendar: [{ date: "2026-01-01", count: 40 }],
  languages: [
    { name: "TypeScript", bytes: 9_120_431 }, { name: "Python", bytes: 4_002_117 },
    { name: "Jupyter Notebook", bytes: 1_877_001 }, { name: "Go", bytes: 640_220 },
    { name: "Rust", bytes: 411_090 }, { name: "Shell", bytes: 90_113 },
  ],
};

/** Every field different from the owner's, so output that ignores the content is caught. */
function altered(): Content {
  const c = loadContent();
  c.handle = "ZED";
  c.role = "Reverse Engineering";
  c.cwd = "~/elsewhere";
  c.whoami = ["only one line here"];
  c.lanes = [
    { label: "alpha/", repos: [{ name: "r-one", blurb: "first blurb" }] },
    { label: "beta/", repos: [{ name: "r-two", blurb: "second blurb" }, { name: "r-three", blurb: "third blurb" }] },
  ];
  c.stackRows = [{ label: "tools", items: ["aa", "bb"] }, { label: "", items: ["cc"] }];
  c.activityLine = { label: "recon done,", daysUp: "live days", contributions: "commits" };
  c.statusline = {
    effortWord: "Budget", effortLabels: ["one", "two", "three"], effortSelected: "two",
    modeBadge: "manual", note: "a short note", toggle: { word: "Hypermellow", state: "idle" },
  };
  return c;
}

const CONTENTS: [string, () => Content][] = [["the owner's real content", loadContent], ["different content", altered]];

const PROMPT = "❯ ";
const COMMANDS = ["/whoami", "/ops", "/stack", "/activity"];
const SHIMMER_PREFIX = "shimmer-";
const isShimmer = (cls?: string): boolean => cls?.startsWith(SHIMMER_PREFIX) ?? false;

const linesOf = (rows: Row[]): string[] => rowsToText(rows).split("\n");

/** The lines under one command's prompt, up to the next prompt or the end. */
function sectionOf(lines: string[], command: string): string[] {
  const start = lines.indexOf(PROMPT + command);
  assert.ok(start >= 0, `no prompt line for ${command}`);
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((l) => l.startsWith(PROMPT));
  return next < 0 ? rest : rest.slice(0, next);
}

/** The /stack section's language rows: name, whole percent, and the column the percent starts at. */
function languageRows(lines: string[]): { name: string; pct: number; pctCol: number }[] {
  return sectionOf(lines, "/stack").flatMap((l) => {
    const m = /^ {5}(\S.*?) {2,}(\d+)%$/.exec(l);
    return m ? [{ name: m[1], pct: Number(m[2]), pctCol: l.length - (m[2].length + 1) }] : [];
  });
}

const total = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);

/**
 * `src` with its comments and quoted strings blanked out, leaving the executable text. Template
 * literals are deliberately kept, text and all: text inside a template is printed, which is
 * exactly where a retyped constant would do its damage.
 */
const executableSource = (src: string): string => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")      // block comments
  .replace(/(^|[^:])\/\/.*$/gm, "$1")      // line comments, leaving a "https://" alone
  .replace(/'(?:[^'\\]|\\.)*'/g, "''")     // single-quoted strings
  .replace(/"(?:[^"\\]|\\.)*"/g, '""');   // double-quoted strings

/** The /activity result line as the content's fragments and this activity's numbers spell it. */
function resultLine(c: Content, a: Activity): string {
  const { label, daysUp, contributions } = c.activityLine;
  return `${label} ${a.activeDays}/${WINDOW_DAYS} ${daysUp} · ${a.totalContributions} ${contributions}`;
}

// ---- the whole Session ----

test("the whole session fits in 72 columns, with the owner's real content", () => {
  const { rows } = composeSession(loadContent(), busy);
  assert.doesNotThrow(() => assertFits(rows));
  assert.ok(linesOf(rows).every((l) => [...l].length <= COLS), "a transcript line is wider than the Session");
});

test("the session fits with the little activity of a new account too", () => {
  assert.doesNotThrow(() => assertFits(composeSession(loadContent(), activity).rows));
});

test("the glyphs the session draws exist in both faces of the font", () => {
  const { rows } = composeSession(loadContent(), busy);
  const regular = readFileSync(new URL("../vendor/JetBrainsMono-Regular.ttf", import.meta.url));
  const bold = readFileSync(new URL("../vendor/JetBrainsMono-Bold.ttf", import.meta.url));
  assert.doesNotThrow(() => assertCovered(regular, charsUsed(rows)));
  const boldRows = rows.map((r) => ({ runs: r.runs.filter((run) => run.style === "bold") }));
  assert.doesNotThrow(() => assertCovered(bold, charsUsed(boldRows)));
});

test("in each face of the Session, no two runs overlap or touch, apart from a highlight copy", () => {
  // A run can only collide with what is shown beside it, so the picture (everything but the
  // text-only runs) and the transcript (everything but the drawn-only ones) are checked apart.
  const faces: [string, (run: Run) => boolean][] = [
    ["the picture", (run) => !run.textOnly],
    ["the transcript", (run) => !run.drawOnly],
  ];
  for (const [, make] of CONTENTS) {
    const { rows } = composeSession(make(), busy);
    for (const [face, shown] of faces) {
      rows.forEach((row, i) => {
        const runs = row.runs.filter((r) => shown(r) && !isShimmer(r.cls)).sort((a, b) => a.col - b.col);
        runs.slice(1).forEach((run, k) => {
          const prev = runs[k];
          assert.ok(
            prev.col + [...prev.text].length < run.col,
            `row ${i} in ${face}: ${JSON.stringify(prev.text)} runs into ${JSON.stringify(run.text)}`,
          );
        });
      });
    }
  }
});

test("the faces are checked apart, so a word drawn as art may share columns with the glyphs over it", () => {
  // What the motion layer will add to the spinner's row: the one verb the transcript says, and
  // a drawn variant at the same columns. Neither is ever shown where the other is.
  assert.doesNotThrow(() => assertNoCollisions([{ runs: [
    { col: 0, text: "✶", style: "accent" },
    { col: 2, text: `Loafing${VERB_SUFFIX}`, textOnly: true },
    { col: 2, text: `Loafing${VERB_SUFFIX}`, drawOnly: true, cls: "pose-sleep" },
  ] }]));
  // A collision inside one face is still a collision, and the message names which face.
  assert.throws(
    () => assertNoCollisions([{ runs: [{ col: 0, text: "ab" }, { col: 2, text: "cd", drawOnly: true }] }]),
    /row 0 in the picture: "ab" runs into "cd"/,
  );
  assert.throws(
    () => assertNoCollisions([{ runs: [{ col: 0, text: "ab" }, { col: 2, text: "cd", textOnly: true }] }]),
    /row 0 in the transcript: "ab" runs into "cd"/,
  );
});

test("alternatives share columns only with their own layer, and still collide with everything else", () => {
  // `layer` names the group, rather than the check reading a class-name prefix, so renaming a
  // motion class cannot quietly stop the row model protecting the row.
  const verb = (text: string, layer?: string): Run =>
    ({ col: 2, text, drawOnly: true, cls: "pose", ...(layer === undefined ? {} : { layer }) });

  // Positive: one verb per Mascot pose, all alternatives, plus the word the transcript says.
  assert.doesNotThrow(() => assertNoCollisions([{ runs: [
    { col: 0, text: "✶", style: "accent" },
    { col: 2, text: `Loafing${VERB_SUFFIX}`, textOnly: true },
    verb(`Loafing${VERB_SUFFIX}`, "verb"),
    verb(`Resettling${VERB_SUFFIX}`, "verb"),
    verb(`Startled${VERB_SUFFIX}`, "verb"),
  ] }]), "runs sharing a layer are alternatives and may share columns");

  // Negative: different layer names are not one group.
  assert.throws(
    () => assertNoCollisions([{ runs: [verb("Loafing", "verb"), verb("Resettling", "spinner")] }]),
    /row 0 in the picture: "Loafing" runs into "Resettling"/,
  );
  // Negative: either side carrying no layer at all.
  for (const runs of [
    [verb("Loafing", "verb"), verb("Resettling")],
    [verb("Loafing"), verb("Resettling", "verb")],
  ]) {
    assert.throws(() => assertNoCollisions([{ runs }]), /row 0 in the picture/);
  }
  // Negative: an empty name forms no group, so a layer that came out blank exempts nothing.
  assert.throws(
    () => assertNoCollisions([{ runs: [verb("Loafing", ""), verb("Resettling", "")] }]),
    /row 0 in the picture/,
  );
  // Negative: a layered run still collides with what sits outside its group. "✶✶" reaches
  // column 2, where the alternatives begin, so it touches them.
  assert.throws(() => assertNoCollisions([{ runs: [
    { col: 0, text: "✶✶", style: "accent" },
    verb(`Loafing${VERB_SUFFIX}`, "verb"),
  ] }]), /row 0 in the picture/);
  // Negative: the longest alternative is checked too. "Resettling…" reaches column 13 while
  // "Loafing…" stops at 10, so comparing only neighbours would miss the run at column 11.
  assert.throws(() => assertNoCollisions([{ runs: [
    verb(`Resettling${VERB_SUFFIX}`, "verb"),
    verb(`Loafing${VERB_SUFFIX}`, "verb"),
    { col: 11, text: "x" },
  ] }]), /row 0 in the picture: "Resettling…" runs into "x"/);

  // The composed Session uses no layers yet, so none of this exempts anything there today.
  for (const [, make] of CONTENTS) {
    const { rows } = composeSession(make(), busy);
    assert.ok(rows.every((row) => row.runs.every((run) => run.layer === undefined)));
  }
});

test("no run is empty, so no empty element is drawn", () => {
  for (const [, make] of CONTENTS) {
    for (const row of composeSession(make(), busy).rows) {
      for (const run of row.runs) assert.notEqual(run.text, "", "an empty run");
    }
  }
});

test("each part of the session wears its own style", () => {
  const c = loadContent();
  const { rows } = composeSession(c, busy);
  const runs = rows.flatMap((r) => r.runs);
  const stylesOf = (text: string): (string | undefined)[] => runs.filter((r) => r.text === text).map((r) => r.style);
  const repo = c.lanes[0].repos[0];
  const lane = c.lanes[0];
  const stack = c.stackRows.find((r) => r.label !== "")!;   // an empty label draws nothing to style

  assert.deepEqual(stylesOf("❯"), COMMANDS.map(() => "accent"), "one prompt glyph per command");
  assert.deepEqual(COMMANDS.map((cmd) => stylesOf(cmd)), COMMANDS.map(() => ["bold"]));
  assert.deepEqual(stylesOf("●"), c.whoami.map(() => "accent"));
  assert.deepEqual(stylesOf(c.whoami[0]), ["text"]);
  assert.deepEqual(stylesOf(lane.label), ["accent"]);
  assert.ok(stylesOf("╰").every((st) => st === "muted"), "the result glyphs");
  assert.deepEqual(stylesOf(repo.name), ["text"]);
  assert.deepEqual(stylesOf(repo.blurb), ["muted"]);
  assert.deepEqual(stylesOf("TypeScript"), ["text"]);
  assert.deepEqual(stylesOf("56%"), ["muted"]);
  assert.deepEqual(stylesOf(stack.label), ["muted"]);
  assert.deepEqual(stylesOf(stack.items.join("  ")), ["text"]);
  assert.deepEqual(stylesOf(resultLine(c, busy)), ["accent"]);
  assert.deepEqual(stylesOf("─".repeat(COLS)), ["muted", "muted"]);
  assert.deepEqual(stylesOf("✶"), ["accent"]);
  assert.deepEqual(stylesOf("Effort"), ["muted"]);
  assert.deepEqual(stylesOf(`▶▶ ${c.statusline.modeBadge}`), ["muted"]);
  assert.deepEqual(stylesOf(c.statusline.note), ["muted"]);
  assert.deepEqual(stylesOf(c.statusline.toggle.word), ["muted"], "the base copy of the toggle word");
  assert.deepEqual(stylesOf(c.statusline.toggle.state), ["muted"]);
});

// ---- the header ----

test("the header is the Mascot's rows plus a blank, a role row and a cwd row, derived from the Mascot", () => {
  const { rows, headerRows } = composeSession(loadContent(), activity);
  assert.equal(headerRows, MASCOT_ROWS + 3, "the Mascot's band, the blank row under it, the role and the cwd");
  const drawn = rows.slice(0, MASCOT_ROWS).map((r) => r.runs.filter((run) => !run.textOnly).length);
  assert.deepEqual(drawn, Array(MASCOT_ROWS).fill(0), "no glyph may be drawn over the Mascot or the Banner");
  assert.equal(rows[headerRows].runs.length, 1);
  assert.equal(rowsToText([rows[headerRows]]), "─".repeat(COLS), "a full-width rule closes the header");
});

for (const [label, make] of CONTENTS) {
  test(`the Banner spells the handle for the transcript and draws no glyph for it (${label})`, () => {
    const c = make();
    const { rows, bannerCol, bannerRow } = composeSession(c, activity);
    const band = rows.slice(bannerRow, bannerRow + BANNER_ROWS);
    const carrying = band.filter((r) => r.runs.some((run) => run.text === c.handle && run.textOnly === true));
    assert.equal(carrying.length, 1, "exactly one row of the Banner band carries the handle");
    assert.equal(carrying[0].runs.find((run) => run.text === c.handle)!.col, bannerCol, "the word sits where the art does");
    // The transcript is the no-image fallback, so it has to name the owner, once.
    const lines = linesOf(rows);
    assert.deepEqual(lines.filter((l) => l.includes(c.handle)), [" ".repeat(bannerCol) + c.handle]);
    // Nothing draws it: the letters are block art, so a glyph here would print over the art.
    assert.ok(!renderRows(rows).includes(c.handle), "the handle was drawn as text");
  });
}

for (const [label, make] of CONTENTS) {
  test(`the role and cwd each get their own full-width row under the Mascot (${label})`, () => {
    const c = make();
    const { rows } = composeSession(c, activity);
    assert.deepEqual(rows[MASCOT_ROWS].runs, [], "a blank row separates the artwork from the role line");
    assert.deepEqual(rows[MASCOT_ROWS + 1].runs, [{ col: 0, text: c.role, style: "bold" }]);
    assert.deepEqual(rows[MASCOT_ROWS + 2].runs, [{ col: 0, text: c.cwd, style: "muted" }]);
  });
}

test("a role the width of the whole Session fits and one column more is rejected", () => {
  const c = loadContent();
  c.role = "r".repeat(COLS);
  assert.doesNotThrow(() => composeSession(c, activity));
  c.role = "r".repeat(COLS + 1);
  assert.throws(() => composeSession(c, activity), /needs 73 columns/);
});

test("the banner sits two columns clear of the Mascot and is centred on it", () => {
  const { bannerCol, bannerRow } = composeSession(loadContent(), activity);
  assert.equal(bannerCol, MASCOT_COLS + 2);
  assert.ok(bannerRow >= 0 && bannerRow + BANNER_ROWS <= MASCOT_ROWS, "the banner must stay beside the Mascot");
  assert.equal(bannerRow, MASCOT_ROWS - (bannerRow + BANNER_ROWS), "as many free rows above the banner as below it");
});

test("a handle whose banner fills the space beside the Mascot fits and one column more does not", () => {
  const room = COLS - (MASCOT_COLS + 2);
  // N is a column wider than A, so swapping letters one at a time reaches every width.
  const handleOfWidth = (width: number): string | undefined => Array.from({ length: 20 }, (_, n) => n + 1)
    .flatMap((n) => Array.from({ length: n + 1 }, (_, k) => "N".repeat(k) + "A".repeat(n - k)))
    .find((h) => bannerWidthCols(h) === width);
  const exact = handleOfWidth(room);
  const over = handleOfWidth(room + 1);
  assert.ok(exact && over, "no handle of M and A has the width needed");
  const c = loadContent();
  c.handle = exact;
  assert.doesNotThrow(() => composeSession(c, activity));
  c.handle = over;
  assert.throws(() => composeSession(c, activity), /banner/);
});

test("a handle far too wide to draw is refused by name, with the width it would need", () => {
  const c = loadContent();
  c.handle = "MAXIMUMOVERDRIVE";
  const needed = MASCOT_COLS + 2 + bannerWidthCols(c.handle);
  assert.ok(needed > COLS, "the probe handle has to be one that cannot fit");
  assert.throws(
    () => composeSession(c, activity),
    (err) => err instanceof Error
      && err.message.includes("MAXIMUMOVERDRIVE")
      && err.message.includes(String(needed))
      && err.message.includes(String(COLS)),
    "the message must name the handle, the columns it needs and the columns there are",
  );
});

// ---- the commands ----

for (const [label, make] of CONTENTS) {
  test(`the commands appear once each, in the scripted order (${label})`, () => {
    const lines = linesOf(composeSession(make(), activity).rows);
    assert.deepEqual(lines.filter((l) => l.startsWith(PROMPT)).map((l) => l.slice(PROMPT.length)), COMMANDS);
  });

  test(`/whoami lists the content's lines as bullets and nothing else (${label})`, () => {
    const c = make();
    const section = sectionOf(linesOf(composeSession(c, activity).rows), "/whoami");
    assert.deepEqual(section, [...c.whoami.map((l) => `● ${l}`), ""]);
  });

  test(`/ops puts each repo's name on one row and its description indented on the next (${label})`, () => {
    const c = make();
    const section = sectionOf(linesOf(composeSession(c, activity).rows), "/ops");
    const expected = c.lanes.flatMap((lane) => [
      `  ╰  ${lane.label}`,
      ...lane.repos.flatMap((r) => [" ".repeat(7) + r.name, " ".repeat(9) + r.blurb]),
    ]);
    assert.deepEqual(section, [...expected, ""]);
  });

  test(`/stack prints each tool row with its items aligned after the longest label (${label})`, () => {
    const c = make();
    const section = sectionOf(linesOf(composeSession(c, activity).rows), "/stack");
    const longest = Math.max(...c.stackRows.map((r) => r.label.length));
    const toolRows = c.stackRows.map((r) => (" ".repeat(5) + r.label.padEnd(longest + 2) + r.items.join("  ")).trimEnd());
    assert.deepEqual(section.slice(section.length - 1 - toolRows.length), [...toolRows, ""]);
  });
}

test("a stack label longer than the old fixed column pushes its items along rather than running into them", () => {
  const c = loadContent();
  c.stackRows[0].label = "x".repeat(20);
  const section = sectionOf(linesOf(composeSession(c, activity).rows), "/stack");
  const row = section.find((l) => l.includes("metasploit"));
  assert.equal(row, " ".repeat(5) + "x".repeat(20) + "  " + c.stackRows[0].items.join("  "));
});

// ---- repo descriptions ----

test("a repo description gets its own row, so it has room to say something", () => {
  const c = loadContent();
  c.lanes[0].repos[0].blurb = "self hosted agent memory with a wiki and a vector store";  // 54 chars
  assert.doesNotThrow(() => assertFits(composeSession(c, activity).rows));
});

test("a description exactly as wide as its row allows fits and one character more is rejected", () => {
  const c = loadContent();
  const room = COLS - 9;
  c.lanes[0].repos[0].blurb = "d".repeat(room);
  assert.doesNotThrow(() => composeSession(c, activity));
  c.lanes[0].repos[0].blurb = "d".repeat(room + 1);
  assert.throws(() => composeSession(c, activity), /needs 73 columns/);
});

test("a blurb too long even for its own row is reported, not silently overflowed", () => {
  const c = loadContent();
  c.lanes[0].repos[0].blurb = "x".repeat(90);
  assert.throws(() => composeSession(c, activity), (e: Error) => {
    assert.match(e.message, /needs 99 columns/);
    assert.ok(e.message.includes("x".repeat(90)), "the message shows the offending text");
    return true;
  });
  assert.throws(() => assertFits(composeSession(c, activity).rows), /columns/);
});

test("a repo name has the same limit, measured from its own column", () => {
  const c = loadContent();
  c.lanes[0].repos[0].name = "n".repeat(COLS - 7);
  assert.doesNotThrow(() => composeSession(c, activity));
  c.lanes[0].repos[0].name = "n".repeat(COLS - 7 + 1);
  assert.throws(() => composeSession(c, activity), /needs 73 columns/);
});

// ---- languages ----

test("languageShares gives whole percentages that total exactly 100, by largest remainder", () => {
  const cases: [number[], number[]][] = [
    [[700, 300], [70, 30]],
    [[5000, 3000, 2000], [50, 30, 20]],
    [[1, 1, 1], [34, 33, 33]],                    // rounding each would total 99
    [[2, 1], [67, 33]],
    [[1, 1, 1, 1, 1, 1], [17, 17, 17, 17, 16, 16]], // rounding each would total 102
    [[2, 2, 2, 2, 2, 2, 2], [15, 15, 14, 14, 14, 14, 14]],
    [[999, 1], [100, 0]],
    [[42], [100]],
  ];
  for (const [bytes, want] of cases) {
    const got = languageShares(bytes.map((b, i) => ({ name: `L${i}`, bytes: b }))).map((s) => s.pct);
    assert.deepEqual(got, want, `shares of ${bytes}`);
  }
});

test("languageShares keeps the names, in the order given", () => {
  const shares = languageShares([{ name: "Zig", bytes: 1 }, { name: "Nim", bytes: 3 }]);
  assert.deepEqual(shares, [{ name: "Zig", pct: 25 }, { name: "Nim", pct: 75 }]);
});

test("for any byte counts the shares total 100, are within one point of exact and never invert the order", () => {
  let seed = 12345;
  const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648);
  for (let run = 0; run < 400; run++) {
    const bytes = Array.from({ length: 1 + (next() % 8) }, () => 1 + (next() % 1_000_000));
    const sum = total(bytes);
    const pcts = languageShares(bytes.map((b, i) => ({ name: `L${i}`, bytes: b }))).map((s) => s.pct);
    assert.equal(total(pcts), 100, `shares of ${bytes}`);
    pcts.forEach((p, i) => {
      assert.ok(Math.abs(p - (bytes[i] * 100) / sum) < 1, `${bytes[i]} of ${sum} became ${p}%`);
      bytes.forEach((b, j) => { if (b > bytes[i]) assert.ok(pcts[j] >= p, `${b} bytes shows less than ${bytes[i]}`); });
    });
  }
});

test("with no bytes at all a share is zero, never NaN, and an empty list is empty", () => {
  assert.deepEqual(languageShares([{ name: "A", bytes: 0 }, { name: "B", bytes: 0 }]).map((s) => s.pct), [0, 0]);
  assert.deepEqual(languageShares([]), []);
});

test("languages are shown as whole percentages that come from the bytes", () => {
  const text = rowsToText(composeSession(loadContent(), activity).rows);
  assert.match(text, /Alpha\s+70%/);
  assert.match(text, /Beta\s+30%/);
});

test("the percentages on screen come from the byte counts, whatever the languages are", () => {
  const fixtures: [Activity["languages"], [string, number][]][] = [
    [[{ name: "Zig", bytes: 1 }, { name: "Nim", bytes: 1 }, { name: "Odin", bytes: 1 }], [["Zig", 34], ["Nim", 33], ["Odin", 33]]],
    [[{ name: "Lua", bytes: 6 }, { name: "Elm", bytes: 4 }], [["Lua", 60], ["Elm", 40]]],
    [[{ name: "Crystal", bytes: 1000 }], [["Crystal", 100]]],
  ];
  for (const [languages, want] of fixtures) {
    const shown = languageRows(linesOf(composeSession(loadContent(), { ...activity, languages }).rows));
    assert.deepEqual(shown.map((r) => [r.name, r.pct]), want);
    assert.equal(total(shown.map((r) => r.pct)), 100);
  }
});

test("the real-looking activity shows six languages totalling 100, largest first", () => {
  const shown = languageRows(linesOf(composeSession(loadContent(), busy).rows));
  assert.deepEqual(shown.map((r) => r.name), ["TypeScript", "Python", "Jupyter Notebook", "Go", "Rust", "Shell"]);
  assert.equal(total(shown.map((r) => r.pct)), 100);
  // exact: 56.505 24.795 11.629 3.966 2.547 0.558. Floors total 96; the four largest remainders take one each.
  assert.deepEqual(shown.map((r) => r.pct), [56, 25, 12, 4, 2, 1]);
});

test("languages are listed by size even when the data arrives in another order", () => {
  const languages = [{ name: "Beta", bytes: 300 }, { name: "Alpha", bytes: 700 }, { name: "Gamma", bytes: 100 }];
  const shown = languageRows(linesOf(composeSession(loadContent(), { ...activity, languages }).rows));
  assert.deepEqual(shown.map((r) => r.name), ["Alpha", "Beta", "Gamma"]);
});

test("every percentage starts in the same column, clear of the longest language name", () => {
  const shown = languageRows(linesOf(composeSession(loadContent(), busy).rows));
  const longest = Math.max(...shown.map((r) => r.name.length));
  assert.equal(new Set(shown.map((r) => r.pctCol)).size, 1, "percentages are ragged");
  assert.ok(shown[0].pctCol >= 5 + longest + 2, "a percentage sits against the name before it");
});

test("with no languages to show, /stack holds only the tool rows", () => {
  const c = loadContent();
  const section = sectionOf(linesOf(composeSession(c, { ...activity, languages: [] }).rows), "/stack");
  assert.equal(section.length, c.stackRows.length + 1);
  assert.deepEqual(languageRows(linesOf(composeSession(c, { ...activity, languages: [] }).rows)), []);
});

// ---- the activity line and the reserved rows ----

test("real activity numbers are printed, never invented", () => {
  const text = rowsToText(composeSession(loadContent(), activity).rows);
  assert.match(text, /99\/365/);
  assert.match(text, /950/);
});

test("the result line carries this activity's own numbers", () => {
  for (const [label, make] of CONTENTS) {
    const c = make();
    for (const [days, contributions] of [[12, 345], [365, 12345], [0, 0]]) {
      const a = { ...activity, activeDays: days, totalContributions: contributions };
      const lines = linesOf(composeSession(c, a).rows);
      assert.ok(
        lines.includes(`  ╰  ${resultLine(c, a)}`),
        `${label}: no result line for ${days} days and ${contributions} contributions`,
      );
    }
  }
});

test("every word of the result line comes from content.json; the order and the dot do not", () => {
  const c = loadContent();
  c.activityLine = { label: "sweep finished,", daysUp: "busy days", contributions: "pushes" };
  const lines = linesOf(composeSession(c, activity).rows);
  assert.ok(lines.includes("  ╰  sweep finished, 99/365 busy days · 950 pushes"), lines.join("\n"));
  // and nothing of the shipped wording survives inside the generator
  const text = rowsToText(composeSession(c, activity).rows);
  for (const gone of ["scan complete", "days up", "contributions"]) {
    assert.ok(!text.includes(gone), `${JSON.stringify(gone)} is still written into the generator`);
  }
});

test("the window the result line counts against is the one the activity module defines", () => {
  assert.equal(WINDOW_DAYS, 365, "the shipped window");
  const c = loadContent();
  const printed = linesOf(composeSession(c, activity).rows).find((l) => l.includes(c.activityLine.label));
  assert.ok(printed?.includes(`${activity.activeDays}/${WINDOW_DAYS} `), `the result line reads ${printed}`);

  // Why this reads source at all. The value is imported rather than retyped so the printed
  // denominator cannot drift from the window the calendar is actually trimmed to. Two numbers
  // that happen to agree today are not the property being protected, and no behaviour can tell
  // them apart, so the check has to look where the difference lives: no second copy of the
  // window may exist in the generator. BREATHS_PER_LOOP is why this is worth a test. It was
  // right at a 60s loop and silently wrong at 36s, and nothing in the suite could see it until
  // the loop changed.
  //
  // Comments and quoted strings are blanked out first, so prose is free to say whatever is
  // clearest. A guard that makes an unrelated comment fail a test teaches the next person to
  // weaken the guard rather than to understand it.
  const executable = executableSource(readFileSync(new URL("../src/session.ts", import.meta.url), "utf8"));
  assert.match(executable, /import \{ WINDOW_DAYS \} from \s*""/, "the window must be imported, not retyped");
  assert.doesNotMatch(
    executable,
    new RegExp(`\\b${WINDOW_DAYS}\\b`),
    "the window is written into the executable source of the generator a second time",
  );
});

test("the window guard reads code, not prose, so a comment or a message may name the window", () => {
  // Pins the fix rather than the guard: the first version of the check above objected to the
  // SCAN_ROWS comment quoting the spec's own "N/365 days up", which is the kind of false
  // positive that gets a guard deleted instead of understood.
  const strip = executableSource;
  const window = new RegExp(`\\b${WINDOW_DAYS}\\b`);
  const prose = [
    `// the "N/${WINDOW_DAYS} days up" line\nconst a = 1;`,
    `/* ${WINDOW_DAYS} days, one column per week */\nconst a = 1;`,
    `const msg = "over ${WINDOW_DAYS} days";`,
    `const msg = 'over ${WINDOW_DAYS} days';`,
  ];
  for (const src of prose) assert.doesNotMatch(strip(src), window, `prose was read as code: ${src}`);
  const code = [
    `const WINDOW_DAYS = ${WINDOW_DAYS};`,
    `const line = \`${"${days}"}/${WINDOW_DAYS} up\`;`,
    `const n = ${WINDOW_DAYS} - 1;`,
  ];
  for (const src of code) assert.match(strip(src), window, `code was read as prose: ${src}`);
});

test("the Scan Sweep reserves the rows square cells on a 53 by 7 calendar actually need", () => {
  const WEEK_COLS = 53;   // a contribution year, one grid column per week
  const DAY_ROWS = 7;     // one grid row per weekday
  assert.ok(WEEK_COLS <= COLS, `${WEEK_COLS} week columns must fit the Session's ${COLS}`);
  // Square cells, which is what GitHub's own calendar uses: each is CELL_W wide and CELL_W
  // tall, so the grid is DAY_ROWS * CELL_W units of ink. Cells of CELL_W x CELL_H would read
  // as a bar chart rather than a contribution grid, so the height follows the width.
  const ink = DAY_ROWS * CELL_W;
  assert.equal(ink, 84);
  assert.equal(ink / CELL_H, 3.5, "7 square cells is three and a half text rows, not eight");
  assert.ok(SCAN_ROWS * CELL_H >= ink, "the reserved rows must hold the whole grid");
  assert.ok((SCAN_ROWS - 1) * CELL_H < ink, "a reserved row that the grid does not reach is waste");
  assert.equal(SCAN_ROWS, 4, "3.5 rows of ink, the remaining half row as breathing room");
});

test("the Session is exactly the rows its parts need", () => {
  const c = loadContent();
  const { rows } = composeSession(c, activity);
  const repos = c.lanes.flatMap((lane) => lane.repos).length;
  const expected =
      MASCOT_ROWS + 3                  // the Mascot's band, a blank, then the role and the cwd
    + 1                                // the rule closing the header
    + 1 + c.whoami.length + 1          // /whoami, its bullets, a blank
    + 1 + c.lanes.length + 2 * repos + 1   // /ops, a lane label and two rows per repo, a blank
    + 1 + activity.languages.length + c.stackRows.length + 1  // /stack, languages, tool rows, a blank
    + 1 + SCAN_ROWS + 1 + 1            // /activity, the sweep's rows, the result line, a blank
    + 1                                // the spinner
    + 1 + 2;                           // the closing rule, the effort row, the mode row
  assert.equal(rows.length, expected, "a row was added or lost somewhere in the composition");
  // Pinned absolutely as well, so every change to the budget is deliberate. The sweep reserving
  // 4 rows rather than the first draft's 8 took the Session from 57 to 53; the blank row the
  // artwork needs under it puts one back.
  assert.equal(rows.length, 54);
});

test("the Scan Sweep gets its own rows right under /activity, and the result line follows them", () => {
  const { rows, scanRow } = composeSession(loadContent(), activity);
  const lines = linesOf(rows);
  assert.equal(lines[scanRow - 1], PROMPT + "/activity");
  assert.deepEqual(rows.slice(scanRow, scanRow + SCAN_ROWS).map((r) => r.runs.length), Array(SCAN_ROWS).fill(0));
  assert.equal(lines[scanRow + SCAN_ROWS], `  ╰  ${resultLine(loadContent(), activity)}`);
});

// ---- the spinner ----

for (const [label, make] of CONTENTS) {
  test(`the spinner row holds the glyph and, as text only, the verb of the pose the loop rests on (${label})`, () => {
    const c = make();
    const { rows, verbRow, scanRow } = composeSession(c, activity);
    // MASCOT_TIMELINE is the single source of truth for the loop, so the verb the row names is
    // the one on screen at t = 0, which is also the still frame a reduced-motion reader sees.
    const resting = c.verbs[MASCOT_TIMELINE[0].state][0];
    assert.deepEqual(rows[verbRow].runs, [
      { col: 0, text: "✶", style: "accent", cls: "spinner-glyph" },
      { col: 2, text: `${resting}${VERB_SUFFIX}`, textOnly: true },
    ]);
    assert.equal(verbRow, scanRow + SCAN_ROWS + 2, "one blank row after the result line, then the spinner");
    assert.equal(rows[verbRow - 1].runs.length, 0);
    // The transcript says what the spinner is saying, so the row is not a lone glyph there.
    assert.equal(linesOf(rows)[verbRow], `✶ ${resting}${VERB_SUFFIX}`);
    // The motion layer owns every drawn verb, so this row draws none of them.
    assert.ok(!renderRows([rows[verbRow]]).includes(resting), "a verb was drawn as text");
    // and only the resting verb is named: no other pose's word is written into the rows
    const text = rowsToText(rows);
    for (const word of Object.values(c.verbs).flat().filter((w) => w !== resting)) {
      assert.ok(!text.includes(word), `${word} was written into the rows`);
    }
  });
}

test("a rule closes the spinner section and the statusline follows it", () => {
  const { rows, verbRow } = composeSession(loadContent(), activity);
  assert.equal(rowsToText([rows[verbRow + 1]]), "─".repeat(COLS));
  assert.equal(rows.length, verbRow + 4, "rule, effort row, mode row, and nothing after");
});

// ---- the statusline ----

for (const [label, make] of CONTENTS) {
  test(`the effort row is the content's word, three columns, then every level in order (${label})`, () => {
    const c = make();
    const lines = linesOf(composeSession(c, activity).rows);
    const effort = lines[lines.length - 2];
    const shown = c.statusline.effortLabels.map((l) => (l === c.statusline.effortSelected ? `[${l}]` : l));
    assert.ok(effort.startsWith(`${c.statusline.effortWord}   ${shown.join("  ")}`), effort);
  });

  test(`the mode row has the badge on the left and the note flush to the right edge (${label})`, () => {
    const c = make();
    const lines = linesOf(composeSession(c, activity).rows);
    const mode = lines[lines.length - 1];
    assert.ok(mode.startsWith(`▶▶ ${c.statusline.modeBadge}`), mode);
    assert.ok(mode.endsWith(c.statusline.note), mode);
    assert.equal([...mode].length, COLS, "the note ends on the last column");
  });
}

test("the statusline marks the selected effort and carries the note", () => {
  const c = loadContent();
  const text = rowsToText(composeSession(c, activity).rows);
  assert.match(text, new RegExp(`\\[${c.statusline.effortSelected}\\]`));
  assert.ok(text.includes(c.statusline.note));
});

test("whichever effort is selected is the only one marked, and the others stay plain", () => {
  const c = loadContent();
  for (const selected of c.statusline.effortLabels) {
    c.statusline.effortSelected = selected;
    const { rows } = composeSession(c, activity);
    const effort = rows[rows.length - 2];
    const text = rowsToText([effort]);
    for (const label of c.statusline.effortLabels) {
      assert.equal(text.includes(`[${label}]`), label === selected, `[${label}] with ${selected} selected`);
      assert.ok(text.includes(label), `${label} is missing`);
    }
    const run = (label: string) => effort.runs.find((r) => r.text === (label === selected ? `[${label}]` : label));
    for (const label of c.statusline.effortLabels) {
      assert.equal(run(label)?.style, label === selected ? "accent" : "muted", `style of ${label} with ${selected} selected`);
    }
  }
});

test("a longer effort word pushes the levels along rather than running into them", () => {
  const c = loadContent();
  const shown = c.statusline.effortLabels.map((l) => (l === c.statusline.effortSelected ? `[${l}]` : l));
  for (const word of ["E", "Effort", "Reasoning budget"]) {
    c.statusline.effortWord = word;
    const effort = linesOf(composeSession(c, activity).rows).at(-2)!;
    assert.ok(effort.startsWith(`${word}   ${shown.join("  ")}`), `${word}: ${effort}`);
  }
});

test("a note that would run into the badge, or touch it, is rejected rather than drawn over it", () => {
  const c = loadContent();
  const room = COLS - 3 - c.statusline.modeBadge.length;   // what is left after "▶▶ " and the badge
  c.statusline.note = "n".repeat(room - 1);                 // one blank column between them
  assert.doesNotThrow(() => composeSession(c, activity));
  c.statusline.note = "n".repeat(room);                     // touching: the two would read as one word
  assert.throws(() => composeSession(c, activity), /runs into/);
  c.statusline.note = "n".repeat(room + 1);                 // overlapping
  assert.throws(() => composeSession(c, activity), /runs into/);
});

test("effort labels that would run into the toggle, or touch it, are rejected", () => {
  const c = loadContent();
  const { effortLabels, effortSelected } = c.statusline;
  const start = c.statusline.effortWord.length + 3
    + effortLabels.reduce((s, l) => s + (l === effortSelected ? l.length + 2 : l.length) + 2, 0);
  const toggleCol = COLS - `${c.statusline.toggle.word} ${c.statusline.toggle.state}`.length;
  const withLast = (len: number): Content => {
    const copy = loadContent();
    copy.statusline.effortLabels = [...effortLabels, "x".repeat(len)];
    return copy;
  };
  assert.doesNotThrow(() => composeSession(withLast(toggleCol - 1 - start), activity), "one blank column before the toggle");
  assert.throws(() => composeSession(withLast(toggleCol - start), activity), /runs into/);
  assert.throws(() => composeSession(withLast(toggleCol - start + 5), activity), /runs into/);
});

test("a note wider than the whole Session is rejected, not drawn off the left edge", () => {
  const c = loadContent();
  c.statusline.note = "n".repeat(COLS + 10);
  assert.throws(() => composeSession(c, activity), /runs into/);
});

// ---- the shimmer word ----

function effortRow(c: Content): Row {
  const { rows } = composeSession(c, activity);
  return rows[rows.length - 2];
}

test("the toggle's word and its state are the owner's copy, read from content.json", () => {
  const shipped = JSON.parse(readFileSync(new URL("../content.json", import.meta.url), "utf8"));
  assert.deepEqual(loadContent().statusline.toggle, shipped.statusline.toggle);
  assert.deepEqual(shipped.statusline.toggle, { word: "Ultrachill", state: "on" }, "the owner's joke, in their file");
  assert.ok(!shipped.statusline.effortLabels.includes("Ultrachill"), "the toggle is not one of the effort labels");

  // The generator spells neither of them: change the file and the Statusline changes with it.
  const c = loadContent();
  c.statusline.toggle = { word: "Overcaffeinated", state: "warm" };
  const text = rowsToText([effortRow(c)]);
  assert.ok(text.endsWith("Overcaffeinated warm"), text);
  assert.ok(!text.includes("Ultrachill"), "the old word is still written into the generator");
  assert.ok(!/ on$/.test(text), "the old state is still written into the generator");
});

test("the shimmer is a per-character stagger over a base copy, for a word of any length", () => {
  for (const word of ["x", "Ultrachill", "Supercalifragilistic"]) {
    const c = loadContent();
    c.statusline.toggle = { word, state: "on" };
    const row = effortRow(c);
    const chars = [...word];
    const base = row.runs.filter((r) => r.text === word && r.cls === undefined);
    assert.equal(base.length, 1, `${word}: exactly one base copy`);
    assert.equal(base[0].style, "muted");
    const copy = row.runs.filter((r) => isShimmer(r.cls));
    assert.equal(copy.length, chars.length, `${word}: one highlight run per character`);
    copy.forEach((r, i) => {
      assert.equal(r.cls, `shimmer-${i}`, `${word}: character ${i}`);
      assert.equal(r.text, chars[i]);
      assert.equal(r.style, "accent");
      assert.equal(r.col, base[0].col + i, `${word}: character ${i} sits over its own letter of the base`);
    });
    const text = rowsToText([row]);
    assert.ok(text.endsWith(`${word} on`), text);
    assert.equal([...text].length, COLS, `${word}: the state ends on the last column`);
  }
});

for (const [label, make] of CONTENTS) {
  test(`the word is drawn twice at one position, a muted base and an accent copy split per character (${label})`, () => {
    const c = make();
    const word = c.statusline.toggle.word;
    const row = effortRow(c);
    const chars = [...word];
    const base = row.runs.filter((r) => r.text === word);
    assert.equal(base.length, 1, "exactly one base copy");
    assert.equal(base[0].style, "muted");
    assert.equal(base[0].cls, undefined);

    const copy = row.runs.filter((r) => isShimmer(r.cls));
    assert.equal(copy.length, chars.length, "one highlight run per character");
    copy.forEach((r, i) => {
      assert.equal(r.cls, `shimmer-${i}`);
      assert.equal(r.text, chars[i]);
      assert.equal(r.style, "accent");
      assert.equal(r.col, base[0].col + i, `character ${i} sits over its own letter of the base`);
    });
  });
}

for (const [label, make] of CONTENTS) {
  test(`the word reads once in the transcript, followed by its state, flush with the right edge (${label})`, () => {
    const c = make();
    const { word, state } = c.statusline.toggle;
    const lines = linesOf(composeSession(c, activity).rows);
    const text = lines.join("\n");
    assert.equal(text.split(word).length - 1, 1, "the word is written twice but must read once");
    const effort = lines[lines.length - 2];
    assert.ok(effort.endsWith(`${word} ${state}`), effort);
    assert.equal([...effort].length, COLS);
  });
}

test("the highlight copy lives in the same row as the word, in no other row", () => {
  const c = loadContent();
  const { rows } = composeSession(c, activity);
  const withShimmer = rows.filter((r) => r.runs.some((run) => isShimmer(run.cls)));
  assert.equal(withShimmer.length, 1);
  assert.ok(withShimmer[0].runs.some((run) => run.text === c.statusline.toggle.word));
});

// ---- the identity gate ----

test("a forbidden name spelled by the Banner is caught by the scan of the transcript", async () => {
  // The Banner is block art, so before the handle rode a text-only run nothing the art spelled
  // reached rowsToText, and the ADR 0001 gate, which scans that text, was blind to it. The
  // stand-in below is an invented word: the real name is never written down anywhere (ADR 0001).
  const key = "PROFILE_FORBIDDEN_NAMES";
  const saved = process.env[key];
  process.env[key] = "Noone";
  try {
    // A query on the specifier gets a fresh module, so it reads the variable set just above.
    const fresh: typeof import("../src/content.ts") = await import(`../src/content.ts?banner-gate=${key}`);
    assert.ok(fresh.FORBIDDEN_NAMES.includes("Noone"), "the stand-in did not reach the list");
    const c = loadContent();
    c.handle = "Noone";
    const text = rowsToText(composeSession(c, activity).rows);
    assert.ok(text.includes("Noone"), "the Banner's word never reached the transcript");
    assert.throws(() => fresh.assertNoForbiddenNames(text, "the transcript"), /forbidden name/);
    // and a clean Banner still passes, so the gate is not simply always throwing
    const ok = loadContent();
    assert.doesNotThrow(() => fresh.assertNoForbiddenNames(rowsToText(composeSession(ok, activity).rows), "the transcript"));
  } finally {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});

// ---- the inputs ----

test("composing the session leaves the content and the activity exactly as they were", () => {
  const c = loadContent();
  const a: Activity = { ...busy, languages: [...busy.languages].reverse() };
  const before = structuredClone({ c, a });
  composeSession(c, a);
  assert.deepEqual({ c, a }, before);
});

// ---- the transcript ----

test("the transcript has one line per row", () => {
  for (const [, make] of CONTENTS) {
    const { rows } = composeSession(make(), busy);
    assert.equal(linesOf(rows).length, rows.length);
  }
});

test("every run starts in the transcript at its own column, padding included", () => {
  for (const [, make] of CONTENTS) {
    const { rows } = composeSession(make(), busy);
    const lines = linesOf(rows);
    rows.forEach((row, i) => {
      for (const run of row.runs.filter((r) => !isShimmer(r.cls))) {
        const at = [...lines[i]].slice(run.col, run.col + [...run.text].length).join("");
        assert.equal(at.trimEnd(), run.text.trimEnd(), `row ${i}: ${JSON.stringify(run.text)} is not at column ${run.col}`);
      }
    });
  }
});

test("a description at column 9 starts at character 9 of its line, and a name at column 7 at 7", () => {
  const c = loadContent();
  const { name, blurb } = c.lanes[0].repos[0];
  const lines = linesOf(composeSession(c, activity).rows);
  const nameAt = lines.indexOf(" ".repeat(7) + name);
  assert.ok(nameAt >= 0, "the name row is missing");
  assert.equal(lines[nameAt].indexOf(name), 7);
  assert.equal(lines[nameAt + 1], " ".repeat(9) + blurb);
  assert.equal(lines[nameAt + 1].indexOf(blurb), 9);
});

test("the prompt starts the line and the command two columns in", () => {
  const lines = linesOf(composeSession(loadContent(), activity).rows);
  const whoami = lines.indexOf(PROMPT + "/whoami");
  assert.ok(whoami >= 0);
  assert.equal(lines[whoami].indexOf("/whoami"), 2);
});

// ---- the gap between the artwork and the role line ---------------------------------------------

/**
 * Cap height of JetBrains Mono v2.304 in units: 730/1000 em at the grid's font size, as
 * docs/spec.md section 3.2 measures it. Where a capital letter's ink actually starts.
 */
const CAP_HEIGHT = (730 / 1000) * FONT_SIZE;

/** The last row of the artwork that paints anything, read from the pose files. */
const artBottomRow = (): number => {
  const rows = [...new Set(POSES_TIMELINE.map((w) => w.state))].flatMap((state) =>
    readFileSync(new URL(`../art/${state}.grid.txt`, import.meta.url), "utf8").replace(/\n$/, "").split("\n")
      .map((row, y) => (row.trim() === "" ? -1 : y)));
  return Math.max(...rows);
};

test("the artwork has no bottom margin of its own, which is why the role line needs a blank row", () => {
  // The premise, measured from the files rather than assumed: the ink runs to the final row, so
  // the band's last pixel and the band's bottom edge are the same line and the art contributes
  // no breathing room at all. Were there a spare row inside the artwork this fix would be wrong.
  const grid = readFileSync(new URL("../art/sleep.grid.txt", import.meta.url), "utf8").replace(/\n$/, "").split("\n");
  assert.equal(artBottomRow(), grid.length - 1, "the artwork leaves a blank row at its foot, so it is not flush");
  assert.equal(grid.length, 28);
  // 28 art pixels at 6 units each is exactly the 7 rows the Mascot reserves: zero slack.
  assert.equal(grid.length * (CELL_W / 2), MASCOT_ROWS * CELL_H);
});

test("a blank row separates the artwork's last pixel from the role line's cap height", () => {
  const { rows } = composeSession(loadContent(), activity);
  const roleRow = rows.findIndex((r) => r.runs.some((run) => run.text === loadContent().role));
  assert.ok(roleRow > 0, "the role line is not in the Session");

  const inkBottom = PAD + MASCOT_ROWS * CELL_H;                        // the artwork runs to here
  const capTop = PAD + roleRow * CELL_H + BASELINE_IN_ROW - CAP_HEIGHT; // the role's ink starts here
  const gap = capTop - inkBottom;

  // One whole row of separation is the margin the artwork does not carry. Placing the role
  // immediately under the band leaves 2.9 units, which is what read as glued.
  assert.ok(gap >= CELL_H, `only ${gap} units between the rack and the role line, wanted at least one row (${CELL_H})`);
  assert.equal(roleRow, MASCOT_ROWS + 1, "the role line sits one blank row below the artwork");
  const glued = PAD + MASCOT_ROWS * CELL_H + BASELINE_IN_ROW - CAP_HEIGHT - inkBottom;
  assert.ok(glued < 3, `the fault being fixed should measure under 3 units, measured ${glued}`);
  assert.ok(gap > glued * 8, "the blank row must be a real separation, not a nudge");
});
