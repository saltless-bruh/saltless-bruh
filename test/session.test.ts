import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadContent } from "../src/content.ts";
import type { Content } from "../src/content.ts";
import { assertNoCollisions, BAR_COLS, centreCol, composeSession, languageBar, languageShares, pctLabel, SCAN_ROWS, VERB_SUFFIX } from "../src/session.ts";
import type { Activity } from "../src/session.ts";
import { assertFits, rowsToText, renderRows, charsUsed } from "../src/rows.ts";
import type { Row, Run } from "../src/rows.ts";
import { BASELINE_IN_ROW, CELL_H, CELL_W, COLS, FONT_SIZE, PAD } from "../src/grid.ts";
import { MASCOT_COLS, MASCOT_INK_COLS, MASCOT_ROWS, mascotDefs } from "../src/mascot.ts";
import { MASCOT_TIMELINE as POSES_TIMELINE } from "../src/timeline.ts";
import { BANNER_ROWS, bannerLetters, bannerWidthCols } from "../src/banner.ts";
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
  c.login = "elsewhere";
  c.prompt = { host: "box", command: "idling &" };
  c.role = "Reverse Engineering";
  c.whoami = ["only one line here"];
  c.lanes = [
    { label: "alpha/", repos: [{ name: "r-one", blurb: "first blurb" }] },
    { label: "beta/", repos: [{ name: "r-two", blurb: "second blurb" }, { name: "r-three", blurb: "third blurb" }] },
  ];
  c.stackRows = [{ label: "tools", items: ["aa", "bb"] }, { label: "", items: ["cc"] }];
  c.activityLine = { label: "recon done,", daysUp: "live days", contributions: "commits" };
  c.statusline = {
    effortWord: "Budget", effortEnds: { start: "Cheaper", end: "Better" },
    effortLabels: ["one", "two", "three"], effortSelected: "two",
    modeBadge: "manual", note: "a short note", toggle: { word: "Hypermellow", state: "idle" },
    toggleNote: "Hypermellow: a different gloss", toggleHint: "Space to flip",
    help: ["j/k to move", "q to quit"],
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

/** The eighth-block glyphs a bar is drawn from, one eighth through to eight. */
const EIGHTHS = "▏▎▍▌▋▊▉█";

/**
 * The /stack section's language rows, read back off the printed line: the name, the bar's own
 * glyphs, the figure as printed, and the column the figure ends in.
 *
 * `pct` is the figure as a number and is NaN for `<1%`, which is not one; `label` is what the row
 * actually says. A row that rounds away draws no bar at all, so the bar group is allowed to be
 * empty rather than being optional, which keeps the group indices the same for every row.
 */
function languageRows(lines: string[]): { name: string; bar: string; pct: number; label: string; pctEnd: number }[] {
  return sectionOf(lines, "/stack").flatMap((l) => {
    const m = new RegExp(`^ {5}(\\S.*?) {2,}([${EIGHTHS}]*) *((?:<1|\\d+)%)$`).exec(l);
    return m ? [{ name: m[1], bar: m[2], pct: Number(m[3].replace("%", "")), label: m[3], pctEnd: [...l].length }] : [];
  });
}

/** One lane's rows as /ops draws them: the label, then a connector row and a blurb row per repo. */
function laneLines(lane: Content["lanes"][number]): string[] {
  return [
    `  ╰  ${lane.label}`,
    ...lane.repos.flatMap((r, i) => {
      const last = i === lane.repos.length - 1;
      return [
        `    ${last ? "└─" : "├─"} ${r.name}`,
        (last ? " ".repeat(9) : `    │    `) + r.blurb,
      ];
    }),
  ];
}

/** One tool row as /stack draws it: the label padded to its column, then the bracketed items. */
const toolLine = (label: string, items: string[], gutter: number): string =>
  (" ".repeat(5) + label.padEnd(gutter) + items.map((i) => `[${i}]`).join(" ")).trimEnd();

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
  // Fragments of one drawn thing, a track broken by its marker or a word split so each character
  // can carry its own colour, may TOUCH each other and nothing else; they still may not overlap.
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
          const gap = prev.piece !== undefined && prev.piece === run.piece ? 0 : 1;
          assert.ok(
            prev.col + [...prev.text].length + gap <= run.col,
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

test("fragments of one drawn thing may touch, and still may not overlap", () => {
  // `piece` names the group, like `layer` does, so renaming a class cannot quietly stop the row
  // model protecting the row. Fragments are a track broken by its marker, and a word split so each
  // character can carry its own colour.
  const frag = (col: number, text: string, piece?: string): Run =>
    ({ col, text, ...(piece === undefined ? {} : { piece }) });

  // Positive: the track, its marker and the rest of the track, shoulder to shoulder.
  assert.doesNotThrow(() => assertNoCollisions([{ runs: [
    frag(0, "───", "track"), frag(3, "▲", "track"), frag(4, "──", "track"),
  ] }]), "fragments of one piece may touch");
  // Positive: a word split into one run per character.
  assert.doesNotThrow(() => assertNoCollisions([{ runs: [
    frag(0, "l", "word"), frag(1, "a", "word"), frag(2, "z", "word"), frag(3, "y", "word"),
  ] }]));

  // Negative: touching is as far as it goes. Overlapping fragments could spell something other
  // than what the transcript reads, which is the whole reason the exemption is not simply "skip".
  assert.throws(() => assertNoCollisions([{ runs: [
    frag(0, "───", "track"), frag(2, "▲", "track"),
  ] }]), /row 0 in the picture: "───" runs into "▲"; they overlap/);
  // Negative: two different pieces are not one group, so they still need a blank column.
  assert.throws(() => assertNoCollisions([{ runs: [frag(0, "──", "track"), frag(2, "x", "word")] }]), /runs into/);
  // Negative: either side carrying no piece at all.
  for (const runs of [[frag(0, "──", "track"), frag(2, "x")], [frag(0, "──"), frag(2, "x", "track")]]) {
    assert.throws(() => assertNoCollisions([{ runs }]), /runs into/);
  }
  // Negative: an empty name forms no group, so a piece that came out blank exempts nothing.
  assert.throws(() => assertNoCollisions([{ runs: [frag(0, "──", ""), frag(2, "x", "")] }]), /runs into/);
  // Negative: a fragment still needs a blank column before whatever sits outside its group.
  assert.throws(() => assertNoCollisions([{ runs: [
    frag(0, "───", "track"), frag(3, "▲", "track"), frag(4, "x"),
  ] }]), /row 0 in the picture: "▲" runs into "x"/);

  // And the composed Session's own pieces are exactly the three the panel builds.
  const names = new Set(composeSession(loadContent(), busy).rows.flatMap((r) => r.runs.map((run) => run.piece)));
  names.delete(undefined);
  assert.deepEqual([...names].sort(), ["effort-top-tier", "effort-track", "shell-prompt", "statusline-toggle"]);
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
  assert.deepEqual(stylesOf(stack.items.map((i) => `[${i}]`).join(" ")), ["text"]);
  // The tree's connectors are chrome and wear the muted token; the bars are a measured figure and
  // wear the Accent, which is the colour every other fetched figure in the Session is drawn in.
  for (const connector of ["├─", "└─", "│"]) {
    assert.ok(stylesOf(connector).length > 0, `${connector} is not drawn anywhere`);
    assert.ok(stylesOf(connector).every((st) => st === "muted"), `${connector} is not muted`);
  }
  const bars = runs.filter((r) => [...r.text].every((ch) => EIGHTHS.includes(ch)) && r.text !== "");
  assert.ok(bars.length > 0, "no language bar is drawn");
  assert.ok(bars.every((r) => r.style === "accent"), "a language bar is not drawn in the Accent");
  assert.deepEqual(stylesOf(resultLine(c, busy)), ["accent"]);
  // Two full-width rules: the one closing the header, and the Statusline panel's accent top border.
  assert.deepEqual(stylesOf("─".repeat(COLS)), ["muted", "accent"]);
  assert.deepEqual(stylesOf("✶"), ["accent"]);
  assert.deepEqual(stylesOf("Effort"), ["accent"]);
  assert.deepEqual(stylesOf(c.statusline.effortEnds.start), ["text"]);
  assert.deepEqual(stylesOf(c.statusline.effortEnds.end), ["text"]);
  assert.deepEqual(stylesOf("▲"), ["accent"]);
  assert.deepEqual(stylesOf(`▶▶ ${c.statusline.modeBadge}`), ["muted"]);
  assert.deepEqual(stylesOf(c.statusline.note), ["muted"]);
  assert.deepEqual(stylesOf(c.statusline.toggleNote), ["muted"]);
  assert.deepEqual(stylesOf(c.statusline.toggleHint), ["muted"]);
  assert.deepEqual(stylesOf(c.statusline.toggle.state), ["accent"]);
});

// ---- the header ----

/** The two prompt rows, then a blank, the Mascot's band, a blank and the role line. */
const HEADER_ROWS = 2 + 1 + MASCOT_ROWS + 1 + 1;

test("the header is the shell prompt, a blank, the Mascot's band, a blank and the role line", () => {
  const { rows, headerRows, mascotRow } = composeSession(loadContent(), activity);
  assert.equal(headerRows, HEADER_ROWS);
  assert.equal(mascotRow, 3, "the Mascot's band starts under the prompt and the blank row after it");
  assert.deepEqual(rows[2].runs, [], "a blank row between the command and what it printed");
  // The Mascot's band carries the startup block beside the sprite, and nothing over the sprite.
  const band = rows.slice(mascotRow, mascotRow + MASCOT_ROWS);
  const clear = Math.ceil(MASCOT_INK_COLS) + 4;
  for (const [i, row] of band.entries()) {
    for (const run of row.runs) assert.ok(run.col >= clear, `band row ${i}: ${JSON.stringify(run.text)} is drawn over the sprite`);
  }
  assert.equal(band.filter((r) => r.runs.length > 0).length, 3, "the startup block is three rows");
  assert.deepEqual(rows[mascotRow + MASCOT_ROWS].runs, [], "a blank row separates the artwork from the role line");
  assert.equal(rows[headerRows].runs.length, 1);
  assert.equal(rowsToText([rows[headerRows]]), "─".repeat(COLS), "a full-width rule closes the header");
});

for (const [label, make] of CONTENTS) {
  test(`the header's first row is the shell prompt, spelled from the owner's own fields (${label})`, () => {
    const c = make();
    const { rows } = composeSession(c, activity);
    // The whole point of the prompt is that the Handle is REAL TEXT in it. It used to reach the
    // transcript through a text-only run shimmed onto the Banner's row, because the Banner was art
    // with no text in it; one run now does both jobs and that special case is gone.
    assert.equal(rowsToText([rows[0]]), `┌─(${c.handle}@${c.prompt.host})-[~/${c.login}]`);
    assert.equal(rowsToText([rows[1]]), `└─$ ${c.prompt.command}`);
    assert.ok(rows[0].runs.every((r) => r.textOnly === undefined), "the prompt carries a run the picture does not draw");
    assert.ok(renderRows([rows[0]]).includes(c.handle), "the handle is not drawn as text");
    // The path is the login with a mark in front of it, so it is never a second field to keep in
    // step with the first, and it is NOT the handle, which is a different value (CONTEXT.md).
    assert.ok(!rows[0].runs.some((r) => r.text === c.handle && r.style !== "accent"));
    const styles = new Map(rows[0].runs.map((r) => [r.text, r.style]));
    assert.equal(styles.get(c.handle), "accent", "the Handle wears the Accent");
    assert.equal(styles.get(c.prompt.host), "text");
    assert.equal(styles.get(`~/${c.login}`), "text");
    for (const chrome of ["┌─(", "@", ")-[", "]"]) assert.equal(styles.get(chrome), "muted", chrome);
    const second = new Map(rows[1].runs.map((r) => [r.text, r.style]));
    assert.equal(second.get("└─$"), "muted", "the sigil is chrome");
    assert.equal(second.get(c.prompt.command), "text", "the command is the owner's word");
    // One piece, so the fragments may touch; nothing else on either row may.
    assert.ok([...rows[0].runs, ...rows[1].runs].every((r) => r.piece === "shell-prompt"));
  });

  test(`the handle reads in the prompt and in the startup block, and nowhere else (${label})`, () => {
    const c = make();
    const { rows, mascotRow } = composeSession(c, activity);
    const lines = linesOf(rows);
    const carrying = lines.map((l, i) => [i, l] as const).filter(([, l]) => l.includes(c.handle));
    // Twice, and both are the owner's: the shell prompt names who is logged in, and the startup
    // block names what is starting up. It is the one word this Session repeats on purpose.
    //
    // The block's row is its FIRST line, and the block is grounded on the band, so that is three
    // rows up from the band's last. Written that way rather than as a number, because the number
    // changes if the block ever gains a line and the relationship does not.
    assert.deepEqual(carrying.map(([i]) => i), [0, mascotRow + MASCOT_ROWS - 3], `the handle appears on lines ${carrying.map(([i]) => i)}`);
  });
}

for (const [label, make] of CONTENTS) {
  test(`the Mascot and the role line sit under the command, not under the prompt (${label})`, () => {
    const c = make();
    const { rows, headerRows, mascotCol } = composeSession(c, activity);
    // Four columns: the sigil's three plus the space after it, which is where a shell's output
    // lines up with what produced it. Read off the command's own column rather than written down.
    assert.equal(mascotCol, linesOf(rows)[1].indexOf(c.prompt.command));
    assert.deepEqual(rows[headerRows - 1].runs, [{ col: mascotCol, text: c.role, style: "bold" }]);
  });
}

test("a role as wide as the Session's remaining columns fits and one more is rejected", () => {
  const c = loadContent();
  const { mascotCol } = composeSession(c, activity);
  c.role = "r".repeat(COLS - mascotCol);
  assert.doesNotThrow(() => composeSession(c, activity));
  c.role = "r".repeat(COLS - mascotCol + 1);
  assert.throws(() => composeSession(c, activity), new RegExp(`needs ${COLS + 1} columns`));
});

test("a prompt too wide for the Session is rejected rather than drawn off the edge", () => {
  const c = loadContent();
  c.prompt = { host: "h".repeat(COLS), command: "x" };
  assert.throws(() => composeSession(c, activity), /needs \d+ columns/);
  const d = loadContent();
  d.prompt = { host: "root", command: "c".repeat(COLS) };
  assert.throws(() => composeSession(d, activity), /needs \d+ columns/);
});

for (const [label, make] of CONTENTS) {
  test(`the startup block prints three lines beside the Mascot, clear of its ink (${label})`, () => {
    const c = make();
    const { rows, mascotRow, mascotCol } = composeSession(c, activity);
    const s = c.startup;
    // The column is MEASURED from the art, not chosen: the ink rounded up, plus the gap. Half a
    // column of overlap is overlap, which is why this rounds up rather than to nearest.
    const blockCol = mascotCol + Math.ceil(MASCOT_INK_COLS) + 2;
    const band = rows.slice(mascotRow, mascotRow + MASCOT_ROWS);
    const printed = band.map((r, i) => [i, rowsToText([r])] as const).filter(([, line]) => line.trim() !== "");
    assert.equal(printed.length, 3, "the block is three lines");
    // GROUNDED on the band: the block's last line is level with the sprite's last row, so the two
    // end on one floor. Expressed from the band's foot rather than as three row numbers, because
    // that is the rule; the numbers are only what it comes to for a three-line block in seven rows.
    assert.deepEqual(printed.map(([i]) => i), [MASCOT_ROWS - 3, MASCOT_ROWS - 2, MASCOT_ROWS - 1]);
    assert.equal(printed[printed.length - 1][0], MASCOT_ROWS - 1, "the block's last line is not level with the sprite's last row");
    assert.deepEqual(band.slice(0, MASCOT_ROWS - 3).flatMap((r) => r.runs), [], "the band's top rows are the sprite's alone");
    assert.deepEqual(printed.map(([, line]) => line), [
      " ".repeat(blockCol) + `${c.handle}  ${s.version}`,
      " ".repeat(blockCol) + `${s.colourWord} ${s.model}`,
      " ".repeat(blockCol) + s.status,
    ]);
    // Nothing of it reaches past the Session's own width, with the sprite's clearance taken first.
    for (const [, line] of printed) assert.ok([...line].length <= COLS, line);
  });

  test(`the startup block's words are the owner's, and only the colour word is the colour (${label})`, () => {
    const c = make();
    const { rows, mascotRow } = composeSession(c, activity);
    const s = c.startup;
    const runs = rows.slice(mascotRow, mascotRow + MASCOT_ROWS).flatMap((r) => r.runs);
    const styleOf = (text: string): string | undefined => runs.find((r) => r.text === text)?.style;
    assert.equal(styleOf(c.handle), "accent", "the Handle wears the Accent");
    assert.equal(styleOf(s.version), "muted");
    assert.equal(styleOf(s.model), "muted");
    assert.equal(styleOf(s.status), "muted");
    // THE ONE PLACE A STATUS TOKEN IS SPENT ON A JOKE. The word IS the colour it is drawn in, so a
    // reader parses it as a colour being named rather than as a fault; `red cat` puns on `red hat`
    // puns on `red team`. Nothing ELSE in the block may wear it, which is what this pins.
    assert.equal(styleOf(s.colourWord), "error", "the colour word is not drawn in the colour it names");
    assert.equal(runs.filter((r) => r.style === "error").length, 1, "a second word wears the status token");
  });
}

test("the startup block's version is the owner's joke and not a version string to tidy", () => {
  const shipped = JSON.parse(readFileSync(new URL("../content.json", import.meta.url), "utf8"));
  // 0x7A69 is 31337. Pinned with the arithmetic in the test rather than as a literal, so that
  // "fixing" it to v1.0.0 fails with the reason on screen.
  const hex = /^v0x([0-9A-Fa-f]+)$/.exec(shipped.startup.version);
  assert.ok(hex, `the version is ${JSON.stringify(shipped.startup.version)}, which spells no number`);
  assert.equal(parseInt(hex[1], 16), 31337, "the version must spell 31337, which is the whole joke");
});

test("the Session draws no block-art wordmark any more, and the alphabet is still sound", () => {
  // The Banner was retired from the Header: it and the pixel cat were the same visual language, so
  // they competed. `src/banner.ts` is kept for the Landing Page, which is why this checks that it
  // still works rather than that it is gone, and checks that nothing in the Session calls it.
  assert.ok(bannerWidthCols("LAZIE") > 0 && BANNER_ROWS > 0, "the alphabet stopped working while unused");
  const build = readFileSync(new URL("../src/build.ts", import.meta.url), "utf8");
  assert.ok(!build.includes("bannerLetters("), "the build still draws the Banner");
  const session = readFileSync(new URL("../src/session.ts", import.meta.url), "utf8");
  assert.ok(!session.includes("banner.ts"), "the Session still imports the Banner");
  const banner = readFileSync(new URL("../src/banner.ts", import.meta.url), "utf8");
  assert.match(banner, /UNUSED BY THE SESSION/, "an unused module with no note is deleted by the next person");
  assert.match(banner, /Landing Page/, "the note must name who the module is being kept for");
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
    assert.deepEqual(section, [...c.lanes.flatMap(laneLines), ""]);
  });

  test(`/stack prints each tool row with its items aligned after the longest label (${label})`, () => {
    const c = make();
    const section = sectionOf(linesOf(composeSession(c, activity).rows), "/stack");
    const gutter = Math.max(...c.stackRows.map((r) => r.label.length)) + 2;
    const toolRows = c.stackRows.map((r) => toolLine(r.label, r.items, gutter));
    assert.deepEqual(section.slice(section.length - 1 - toolRows.length), [...toolRows, ""]);
  });
}

test("a stack label longer than the old fixed column pushes its items along rather than running into them", () => {
  const c = loadContent();
  c.stackRows[0].label = "x".repeat(12);
  const section = sectionOf(linesOf(composeSession(c, activity).rows), "/stack");
  const row = section.find((l) => l.includes("metasploit"));
  assert.equal(row, toolLine("x".repeat(12), c.stackRows[0].items, 14));
});

test("every tool is bracketed, separated by one column, and a continuation row keeps its blank label", () => {
  for (const [label, make] of CONTENTS) {
    const c = make();
    const section = sectionOf(linesOf(composeSession(c, activity).rows), "/stack");
    const tools = section.slice(section.length - 1 - c.stackRows.length, section.length - 1);
    const gutter = Math.max(...c.stackRows.map((r) => [...r.label].length)) + 2;
    c.stackRows.forEach((row, i) => {
      assert.equal(tools[i], toolLine(row.label, row.items, gutter), label);
      for (const item of row.items) assert.ok(tools[i].includes(`[${item}]`), `${label}: ${item} is not bracketed`);
      // One column between two tags. The brackets already separate them, so the list spacing on top
      // of them would space them twice and cost two columns a row for nothing.
      assert.ok(!tools[i].includes("]  ["), `${label}: two tags are separated twice over`);
    });
    const blank = c.stackRows.findIndex((r) => r.label === "");
    assert.ok(blank > 0, `${label}: the content has no continuation row to check`);
    assert.equal(tools[blank].indexOf("["), tools[blank - 1].indexOf("["), `${label}: the continuation does not align under the row above`);
    assert.equal(tools[blank].slice(0, 5 + gutter).trim(), "", `${label}: the continuation printed a label`);
  }
});

test("the shipped tool rows each land on ONE row with the brackets, measured against the real gutter", () => {
  // The brief measured this at a 9-column gutter; the gutter the generator actually derives is
  // wider, so it is re-measured here rather than taken on trust. The headroom is recorded so the
  // next tool added to a row is weighed against a number instead of against an impression.
  const c = loadContent();
  const section = sectionOf(linesOf(composeSession(c, activity).rows), "/stack");
  const tools = section.slice(section.length - 1 - c.stackRows.length, section.length - 1);
  assert.equal(tools.length, c.stackRows.length, "a tool row wrapped onto a second row");
  const widths = tools.map((l) => [...l].length);
  assert.equal(Math.max(...widths), 64, "the widest shipped tool row, bracketed");
  assert.ok(Math.max(...widths) <= COLS, `the widest tool row is ${Math.max(...widths)} of ${COLS} columns`);
});

test("the brackets cost two columns a tool, and a row that no longer fits is reported", () => {
  // Stated rather than discovered. The widest shipped row is five tools, and bracketing them spends
  // ten of the columns the label gutter was free to grow into. A row that overruns names itself.
  const c = loadContent();
  const widest = c.stackRows[0].items;
  const bare = widest.join(" ".repeat(2)).length;
  const tagged = widest.map((i) => `[${i}]`).join(" ").length;
  assert.equal(tagged - bare, 2 * widest.length - (widest.length - 1), "two columns a tool, less the separator that shrank");
  const room = COLS - 5 - 2 - tagged;
  c.stackRows[0].label = "x".repeat(room);
  assert.doesNotThrow(() => composeSession(c, activity));
  c.stackRows[0].label = "x".repeat(room + 1);
  assert.throws(() => composeSession(c, activity), /needs 73 columns/);
});

// ---- the /ops tree ----

test("the connector comes from the repo's position: the last closes its lane, the rest carry it on", () => {
  // Every lane size that can change the answer, including the lane of ONE, whose only repo is also
  // its last. That is where a connector chosen from the front, or a flag written beside the repo,
  // gives the wrong glyph and the other shapes do not notice.
  for (const sizes of [[1], [2], [3], [1, 1], [4, 1, 2]]) {
    const c = loadContent();
    c.lanes = sizes.map((n, l) => ({
      label: `lane-${l}/`,
      repos: Array.from({ length: n }, (_, r) => ({ name: `repo-${l}-${r}`, blurb: `blurb ${l} ${r}` })),
    }));
    const section = sectionOf(linesOf(composeSession(c, activity).rows), "/ops");
    assert.deepEqual(section, [...c.lanes.flatMap(laneLines), ""], `lanes of ${sizes.join(", ")}`);
    // Counted as well as spelled, so a connector that happens to be right in one lane is not taken
    // as evidence about the rest: exactly one closer per lane, wherever that lane happens to end.
    assert.equal(section.filter((l) => l.includes("└─")).length, sizes.length, `lanes of ${sizes.join(", ")}: closers`);
    assert.equal(
      section.filter((l) => l.includes("├─")).length,
      sizes.reduce((s, n) => s + n, 0) - sizes.length,
      `lanes of ${sizes.join(", ")}: branches`,
    );
  }
});

test("the spine runs unbroken down a lane and stops under its last repo", () => {
  // THE WHOLE POINT OF THE CONTINUATION, read as one column rather than as a set of rows: the lane
  // is drawn as a line that ends, and what ends it is the one blank cell under the last name. A
  // continuation dropped altogether leaves gaps in that column; one drawn under the last repo too
  // leaves a line running into the next lane, which says the lane did not end.
  const c = loadContent();
  c.lanes = [{ label: "one/", repos: Array.from({ length: 4 }, (_, i) => ({ name: `r${i}`, blurb: `b${i}` })) }];
  const section = sectionOf(linesOf(composeSession(c, activity).rows), "/ops");
  const column = section.map((l) => [...l][4] ?? " ");
  assert.deepEqual(column, [" ", "├", "│", "├", "│", "├", "│", "└", " ", " "]);
});

test("the tree is drawn into columns the indent was already spending on nothing", () => {
  // The claim that this change costs no rows AND no columns. The names and the descriptions sit
  // exactly where they sat before the connectors arrived, so nothing had to be re-measured.
  const c = loadContent();
  for (const lane of c.lanes) {
    for (const repo of lane.repos) {
      const lines = linesOf(composeSession(c, activity).rows);
      const at = lines.findIndex((l) => l.endsWith(` ${repo.name}`) && l.trimStart().startsWith("├─") || l.endsWith(` ${repo.name}`) && l.trimStart().startsWith("└─"));
      assert.ok(at >= 0, `${repo.name} has no connector row`);
      assert.equal(lines[at].indexOf(repo.name), 7, `${repo.name} moved off column 7`);
      assert.equal(lines[at + 1].indexOf(repo.blurb), 9, `${repo.name}'s description moved off column 9`);
    }
  }
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
  assert.match(text, /Alpha\s+█+[▏▎▍▌▋▊▉]?\s+70%/);
  assert.match(text, /Beta\s+█+[▏▎▍▌▋▊▉]?\s+30%/);
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

test("every percentage ENDS in the same column, so the figures line up on the digit that matters", () => {
  // Right-aligned, not left: these are numbers of different widths, and `<1%` is not even a number,
  // so the only column they can all share is the one the `%` lands in. Left-aligning them puts
  // `6%` and `90%` flush at the start and ragged at the end, which is what reads as unaligned.
  for (const a of [busy, activity, { ...busy, languages: [{ name: "Solo", bytes: 10 }] }]) {
    const shown = languageRows(linesOf(composeSession(loadContent(), a).rows));
    assert.ok(shown.length > 0);
    assert.equal(new Set(shown.map((r) => r.pctEnd)).size, 1, "the figures are ragged on the right");
  }
  // And the whole block clears the longest name with the bar's own field between the two.
  const shown = languageRows(linesOf(composeSession(loadContent(), busy).rows));
  const longest = Math.max(...shown.map((r) => [...r.name].length));
  assert.equal(shown[0].pctEnd, 5 + longest + 2 + BAR_COLS + 2 + 4, "the figure's field is the bar's width plus its own");
});

test("the bar's left edge is one column for every language, so the lengths are comparable", () => {
  // The whole point of a bar is that two of them can be compared by eye, which requires one origin.
  // Starting each bar after its own name would make the longest-named language look the smallest.
  for (const a of [busy, activity]) {
    const lines = linesOf(composeSession(loadContent(), a).rows);
    const starts = new Set(languageRows(lines).map((r) => {
      const line = lines.find((l) => l.includes(r.name) && l.endsWith(r.label))!;
      return r.bar === "" ? null : [...line].indexOf([...r.bar][0]);
    }).filter((x) => x !== null));
    assert.equal(starts.size, 1, "the bars do not share an origin");
  }
});

// ---- the language bars ----

test("the bar is drawn to the nearest eighth of a column, and the rounding CARRIES", () => {
  // The three cases the brief asked for, at the shipped width, chosen because they straddle a whole
  // block by less than half a point each and are therefore invisible by eye:
  //
  //   50% is 17.00 columns, exactly on a block;
  //   47% is 15.98, JUST UNDER one, and rounds up to a whole block with no eighth after it;
  //   48% is 16.32, just over, and keeps three eighths.
  //
  // 47% is the one that kills the obvious implementation. Flooring to whole columns and rounding
  // what is left over separately gives 15 blocks and a remainder of 0.98, which rounds to an eighth
  // eighth: a ninth sub-cell, or a glyph one past the end of the table.
  assert.equal(languageBar(50), "█".repeat(17));
  assert.equal(languageBar(47), "█".repeat(16));
  assert.equal(languageBar(48), "█".repeat(16) + "▍");
  assert.equal(languageBar(0), "", "nothing to draw draws nothing, not one empty cell");
  assert.equal(languageBar(100), "█".repeat(BAR_COLS));
});

test("the owner's own figures draw the bars the design asked for", () => {
  assert.equal(languageBar(90), "█".repeat(30) + "▋");
  assert.equal(languageBar(6), "██");
  assert.equal(languageBar(3), "█");
  assert.equal(languageBar(1), "▍", "one percent is a third of a column, and it is drawn");
});

test("every whole percentage draws the length it names, to within the half eighth rounding costs", () => {
  // The property, over all 101 of them, rather than the six the content happens to use. Both the
  // carry and a floor-where-a-round-belongs show up here as a whole eighth of error.
  for (let pct = 0; pct <= 100; pct++) {
    const bar = [...languageBar(pct)];
    assert.ok(bar.length <= BAR_COLS, `${pct}% is ${bar.length} columns, over ${BAR_COLS}`);
    assert.match(languageBar(pct), /^█*[▏▎▍▌▋▊▉]?$/, `${pct}% is not whole blocks and at most one eighth: ${languageBar(pct)}`);
    const eighths = bar.reduce((s, ch) => s + EIGHTHS.indexOf(ch) + 1, 0);
    assert.ok(
      Math.abs(eighths - (pct / 100) * BAR_COLS * 8) <= 0.5,
      `${pct}% draws ${eighths} eighths, wanted ${(pct / 100) * BAR_COLS * 8}`,
    );
  }
  const lengths = Array.from({ length: 101 }, (_, pct) => [...languageBar(pct)].length);
  for (let pct = 1; pct <= 100; pct++) assert.ok(lengths[pct] >= lengths[pct - 1], `${pct}% is shorter than ${pct - 1}%`);
});

test("the bar scales with the width it is given, so the constant is the only thing to change", () => {
  assert.equal(languageBar(100, 8), "█".repeat(8));
  assert.equal(languageBar(50, 8), "█".repeat(4));
  assert.equal(languageBar(1, 8), "▏", "0.64 of an eighth still rounds to a visible one");
  assert.equal(languageBar(100, 1), "█");
});

test("the bar is drawn from the figure that is printed, never from the bytes behind it", () => {
  // Two byte splits that round to the same whole percentages must draw the same bars. A bar taken
  // from the raw share would differ between these by a fifth of a point, which is a figure nobody
  // computed wearing the shape of a measurement (docs/spec.md 3.6).
  const bars = (languages: Activity["languages"]): [string, string][] =>
    languageRows(linesOf(composeSession(loadContent(), { ...activity, languages }).rows)).map((r) => [r.label, r.bar]);
  const near = bars([{ name: "A", bytes: 6_990 }, { name: "B", bytes: 3_010 }]);   // 69.90 / 30.10
  const over = bars([{ name: "A", bytes: 7_010 }, { name: "B", bytes: 2_990 }]);   // 70.10 / 29.90
  assert.deepEqual(near, [["70%", languageBar(70)], ["30%", languageBar(30)]]);
  assert.deepEqual(near, over, "the bars follow the bytes rather than the printed figure");
});

// ---- the languages that round away ----

test("a share that rounds away prints <1%, and only when there is something there", () => {
  assert.equal(pctLabel(0, 1), "<1%", "a language with bytes behind it is present and tiny");
  assert.equal(pctLabel(0, 0), "0%", "nothing at all is not <1%, which claims something is there");
  assert.equal(pctLabel(1, 100), "1%");
  assert.equal(pctLabel(100, 9), "100%");
});

test("a sub-one-percent language keeps its row, with an empty bar beside <1%", () => {
  // The owner's decision, pinned: these rows stay, and the pair of an empty bar and `<1%` is what
  // says what is true of them. `0%` beside the same blank reads as a language that failed to
  // measure, which is the one reading that is false.
  const languages = [{ name: "Big", bytes: 999_000 }, { name: "Tiny", bytes: 500 }, { name: "Smaller", bytes: 1 }];
  const shown = languageRows(linesOf(composeSession(loadContent(), { ...activity, languages }).rows));
  assert.deepEqual(shown.map((r) => r.name), ["Big", "Tiny", "Smaller"], "a small language was dropped");
  assert.deepEqual(shown.map((r) => r.label), ["100%", "<1%", "<1%"]);
  assert.deepEqual(shown.map((r) => r.bar), [languageBar(100), "", ""], "a share that rounds away drew a bar");
});

test("with no bytes at all every language reads 0%, because nothing is there to be tiny", () => {
  const languages = [{ name: "A", bytes: 0 }, { name: "B", bytes: 0 }];
  const shown = languageRows(linesOf(composeSession(loadContent(), { ...activity, languages }).rows));
  assert.deepEqual(shown.map((r) => r.label), ["0%", "0%"]);
  assert.deepEqual(shown.map((r) => r.bar), ["", ""]);
});

test("the owner's real languages read as the design drew them, bars and figures together", () => {
  const real = {
    ...activity,
    languages: [
      { name: "Python", bytes: 3_585_978 }, { name: "Rust", bytes: 220_619 },
      { name: "Go", bytes: 98_377 }, { name: "Shell", bytes: 50_835 },
      { name: "HTML", bytes: 10_880 }, { name: "TypeScript", bytes: 6_989 },
    ],
  };
  const shown = languageRows(linesOf(composeSession(loadContent(), real).rows));
  assert.deepEqual(shown.map((r) => [r.name, r.bar, r.label]), [
    ["Python", "█".repeat(30) + "▋", "90%"],
    ["Rust", "██", "6%"],
    ["Go", "█", "3%"],
    ["Shell", "▍", "1%"],
    ["HTML", "", "<1%"],
    ["TypeScript", "", "<1%"],
  ]);
});

test("a language name too long for its name, bar and figure is refused, not drawn off the edge", () => {
  // The bar's width is a constant, so it costs the name field some of what it had. This states the
  // limit that buys rather than leaving it to be found by a build failing on somebody's Perl.
  const room = COLS - 5 - 2 - BAR_COLS - 2 - 4;
  assert.equal(room, 25, "the longest language name /stack can print beside a bar");
  const fits = { ...activity, languages: [{ name: "L".repeat(room), bytes: 10 }] };
  assert.doesNotThrow(() => composeSession(loadContent(), fits));
  const over = { ...activity, languages: [{ name: "L".repeat(room + 1), bytes: 10 }] };
  assert.throws(() => composeSession(loadContent(), over), /needs 73 columns/);
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
      HEADER_ROWS                      // the shell prompt, a blank, the Mascot's band, a blank, the role
    + 1                                // the rule closing the header
    + 1 + c.whoami.length + 1          // /whoami, its bullets, a blank
    + 1 + c.lanes.length + 2 * repos + 1   // /ops, a lane label and two rows per repo, a blank
    + 1 + activity.languages.length + c.stackRows.length + 1  // /stack, languages, tool rows, a blank
    + 1 + SCAN_ROWS + 1 + 1            // /activity, the sweep's rows, the result line, a blank
    + 1                                // the spinner
    + PANEL_ROWS;                      // the Statusline, which is a panel and not a line
  assert.equal(rows.length, expected, "a row was added or lost somewhere in the composition");
  // Pinned absolutely as well, so every change to the budget is deliberate. The sweep reserving
  // 4 rows rather than the first draft's 8 took the Session from 57 to 53; the blank row the
  // artwork needs under it puts one back; the Statusline becoming a panel adds eight more; the
  // Header becoming a shell prompt adds two, two prompt rows and a blank for one cwd row.
  assert.equal(rows.length, 64);
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

test("a rule closes the spinner section and the statusline panel follows it", () => {
  const { rows, verbRow } = composeSession(loadContent(), activity);
  assert.equal(rowsToText([rows[verbRow + 1]]), "─".repeat(COLS));
  assert.equal(rows.length, verbRow + 1 + PANEL_ROWS, "the panel, and nothing after it");
  assert.equal(verbRow + 1, rows.length + PANEL.border, "the rule that closes the spinner IS the panel's top border");
});

// ---- the statusline panel ----
//
// The Statusline is a PANEL, not a line: an accent top border, its padding, a heading, the axis's
// two ends, a track carrying a marker, the five levels, the toggle with its gloss and hint, and the
// key hints under all of it. The rows are addressed from the END of the Session, because everything
// above them can grow and the panel is always the last thing printed.

/** Where each of the panel's rows sits, counted back from the last row of the Session. */
const PANEL = {
  border: -11, padding: -10, heading: -9, ends: -8, track: -7,
  levels: -6, toggle: -5, hint: -4, gap: -3, help: -2, mode: -1,
} as const;
/** How many rows the panel occupies, derived from the row furthest back. */
const PANEL_ROWS = -Math.min(...Object.values(PANEL));

const rowAt = (rows: Row[], at: number): Row => rows[rows.length + at];
const lineAt = (rows: Row[], at: number): string => rowsToText([rowAt(rows, at)]);
const panelOf = (c: Content): Row[] => composeSession(c, activity).rows;

/**
 * Every run of non-blank characters in a line, with the column it starts at.
 *
 * Read off the painted transcript rather than out of the runs on purpose: the top tier is drawn as
 * one run per character so that each can carry its own hue, so there is no single run to ask, and a
 * test that asked the runs would be checking the generator against itself.
 */
function tokensOf(line: string): { text: string; col: number }[] {
  return [...line.matchAll(/\S+/g)].map((m) => ({ text: m[0], col: [...line.slice(0, m.index)].length }));
}

/** The span of columns the track covers, and where its marker sits. */
function trackOf(rows: Row[]): { from: number; to: number; marker: number } {
  const line = [...lineAt(rows, PANEL.track)];
  const marker = line.indexOf("▲");
  const from = line.findIndex((ch) => ch !== " ");
  return { from, to: line.length, marker };
}

for (const [label, make] of CONTENTS) {
  test(`the panel is a border, a heading, the axis, the track, the levels and the toggle (${label})`, () => {
    const c = make();
    const rows = panelOf(c);
    const s = c.statusline;
    assert.equal(lineAt(rows, PANEL.border), "─".repeat(COLS), "the panel's top border is a full-width rule");
    assert.equal(rowAt(rows, PANEL.border).runs[0].style, "accent", "and it is the Accent, which is what makes it a panel edge");
    assert.deepEqual(rowAt(rows, PANEL.padding).runs, [], "a blank row of padding under the border");
    assert.deepEqual(rowAt(rows, PANEL.heading).runs, [{ col: 0, text: s.effortWord, style: "accent" }]);
    assert.deepEqual(rowAt(rows, PANEL.gap).runs, [], "a blank row before the key hints");

    const ends = tokensOf(lineAt(rows, PANEL.ends));
    assert.deepEqual(ends.map((t) => t.text), [s.effortEnds.start, s.effortEnds.end], "the axis is labelled at both ends");
    const { from, to, marker } = trackOf(rows);
    assert.equal(ends[0].col, from, "the first end sits at the track's left end");
    assert.equal(ends[1].col + [...s.effortEnds.end].length, to, "the second ends with the track");
    assert.ok(marker >= from && marker < to, "the marker is on the track");
    assert.equal(lineAt(rows, PANEL.track).replace(/[─▲]/g, "").trim(), "", "the track is the rule and its marker, nothing else");

    assert.deepEqual(tokensOf(lineAt(rows, PANEL.levels)).map((t) => t.text), s.effortLabels, "every level in order");
    assert.ok(lineAt(rows, PANEL.toggle).startsWith(" ".repeat(from) + s.toggleNote), "the gloss starts where the track does");
    assert.ok(lineAt(rows, PANEL.toggle).endsWith(`${s.toggle.word}  ${s.toggle.state}`), "the toggle closes the row");
    assert.equal(lineAt(rows, PANEL.hint).trim(), s.toggleHint);
    assert.equal(lineAt(rows, PANEL.help), `  ${s.help.join(" · ")}`, "the hints, joined by the generator's own mark");
  });
}

test("the marker is placed from the selected level's own column, wherever on the scale it sits", () => {
  const c = loadContent();
  const labels = [...c.statusline.effortLabels];
  // EVERY selection, first and last included. The owner's scale selects its LAST level and an
  // earlier one selected the middle of five, so a marker fixed at the track's midpoint would have
  // looked right for one of them and been silently wrong for the other. Only a selection that is
  // not the middle can tell the two apart, which is why this loops rather than checking one.
  for (const selected of labels) {
    c.statusline.effortSelected = selected;
    const rows = panelOf(c);
    const level = tokensOf(lineAt(rows, PANEL.levels)).find((t) => t.text === selected)!;
    const { from, to, marker } = trackOf(rows);
    const last = level.col + [...selected].length - 1;
    assert.ok(marker >= level.col && marker <= last, `${selected}: the marker is at ${marker}, outside ${level.col}..${last}`);
    assert.ok(Math.abs((marker - level.col) - (last - marker)) <= 1, `${selected}: the marker is not centred on its level`);
    assert.equal([...lineAt(rows, PANEL.track)].filter((ch) => ch === "▲").length, 1, "exactly one marker");
    // and the midpoint of the track is not where it is, for the levels that are not in the middle
    if (selected !== labels[(labels.length - 1) / 2]) {
      assert.notEqual(marker, Math.round((from + to - 1) / 2), `${selected}: the marker sits at the track's midpoint`);
    }
  }
});

test("the marker's column is its level's centre, and an even-width level breaks the tie one way", () => {
  assert.equal(centreCol(10, "a"), 10);
  assert.equal(centreCol(10, "abc"), 11, "an odd-width word has an exact centre column");
  assert.equal(centreCol(10, "abcd"), 12, "an even-width word takes the right of its two middle columns");
  assert.equal(centreCol(10, "abcdef"), 13);
  // The tie is broken the same way at every width, so adding a character to a level moves the
  // marker by a predictable half step instead of making it appear to jump back across the word.
  for (let n = 2; n <= 9; n++) {
    const text = "x".repeat(n);
    assert.equal(centreCol(0, text) - centreCol(0, text.slice(0, -1)), n % 2 === 0 ? 1 : 0, `${n} characters`);
  }
});

test("the levels are evenly distributed across the track, and the track spans them", () => {
  for (const [, make] of CONTENTS) {
    const c = make();
    const rows = panelOf(c);
    const { from, to } = trackOf(rows);
    const levels = tokensOf(lineAt(rows, PANEL.levels));
    assert.ok(levels[0].col >= from, "a level starts before the track does");
    assert.ok(levels.at(-1)!.col + [...levels.at(-1)!.text].length <= to, "a level runs past the end of the track");
    // Each level is centred on its own slot, so the centres step by the slot width. Integer columns
    // cannot land on a fractional width exactly, so neighbouring steps may differ by one and no more.
    // Each level sits on its own slot, measured against the FRACTIONAL slot the track implies. A
    // whole column cannot land on a fractional centre, so half a column is the whole tolerance;
    // anything looser lets the rounding error accumulate along the row unnoticed, which is exactly
    // what rounding each slot edge before placing the label does.
    const slot = (to - from) / levels.length;
    levels.forEach((t, i) => {
      const centre = t.col + [...t.text].length / 2;
      const want = from + slot * (i + 0.5);
      assert.ok(Math.abs(centre - want) <= 0.5, `level ${i} centres on ${centre} where its slot centres on ${want}`);
    });
  }
  // A scale long enough for a rounded slot width to drift visibly, which five levels on a track
  // that happens to divide by five cannot show.
  const many = loadContent();
  many.statusline.effortLabels = ["a", "bb", "c", "dd", "e", "ff", "g"];
  many.statusline.effortSelected = "a";
  many.statusline.toggleNote = "short";
  const rows = panelOf(many);
  const { from, to } = trackOf(rows);
  const slot = (to - from) / many.statusline.effortLabels.length;
  tokensOf(lineAt(rows, PANEL.levels)).forEach((t, i) => {
    const centre = t.col + [...t.text].length / 2;
    assert.ok(Math.abs(centre - (from + slot * (i + 0.5))) <= 0.5, `level ${i} of seven drifted to ${centre}`);
  });
});

test("the selected level is bold and the Accent, the rest are muted, and no level is bracketed", () => {
  const c = loadContent();
  for (const selected of c.statusline.effortLabels) {
    c.statusline.effortSelected = selected;
    const rows = panelOf(c);
    const line = lineAt(rows, PANEL.levels);
    assert.ok(!line.includes("[") && !line.includes("]"), `brackets survive with ${selected} selected: ${line}`);
    const runs = rowAt(rows, PANEL.levels).runs;
    for (const label of c.statusline.effortLabels) {
      const mine = runs.filter((r) => label.includes(r.text) && label.indexOf(r.text) >= 0 && r.text !== "");
      assert.ok(mine.length > 0, `${label} draws nothing`);
    }
    // The run that draws a level: one run for an ordinary level, one per character for the top tier.
    const styleOf = (label: string): string[] => {
      const col = tokensOf(line).find((t) => t.text === label)!.col;
      const width = [...label].length;
      return runs.filter((r) => r.col >= col && r.col < col + width).map((r) => r.style!);
    };
    for (const label of c.statusline.effortLabels) {
      const want = label === selected ? "accent-bold" : label === c.statusline.effortLabels.at(-1) ? "accent" : "muted";
      assert.deepEqual([...new Set(styleOf(label))], [want], `${label} with ${selected} selected`);
    }
  }
});

test("the top tier is drawn as a rainbow, one run per character, whichever level is selected", () => {
  const c = loadContent();
  const top = c.statusline.effortLabels.at(-1)!;
  for (const selected of c.statusline.effortLabels) {
    c.statusline.effortSelected = selected;
    const rows = panelOf(c);
    const line = lineAt(rows, PANEL.levels);
    const col = tokensOf(line).find((t) => t.text === top)!.col;
    const chars = [...top];
    const painted = rowAt(rows, PANEL.levels).runs.filter((r) => r.cls?.startsWith("rainbow-"));
    assert.equal(painted.length, chars.length, `${selected}: one run per character of the top tier`);
    painted.forEach((r, i) => {
      assert.equal(r.cls, `rainbow-${i}`);
      assert.equal(r.text, chars[i]);
      assert.equal(r.col, col + i, `character ${i} sits on its own column`);
    });
    // It is the TOP of the scale that earns the rainbow, not the selection, so no other level has it.
    assert.equal(line.replace(top, "").includes("rainbow"), false);
  }
  // and the transcript still reads the word once, as one word
  assert.ok(lineAt(panelOf(loadContent()), PANEL.levels).includes(top));
});

for (const [label, make] of CONTENTS) {
  test(`the mode row has the badge on the left and the note flush to the right edge (${label})`, () => {
    const c = make();
    const mode = lineAt(composeSession(c, activity).rows, PANEL.mode);
    assert.ok(mode.startsWith(`▶▶ ${c.statusline.modeBadge}`), mode);
    assert.ok(mode.endsWith(c.statusline.note), mode);
    assert.equal([...mode].length, COLS, "the note ends on the last column");
  });
}

test("every word of the panel comes from content.json, and none of them from the generator", () => {
  const c = loadContent();
  const s = c.statusline;
  const before = rowsToText(composeSession(c, activity).rows);
  for (const word of [s.effortEnds.start, s.effortEnds.end, s.toggleNote, s.toggleHint, ...s.help]) {
    assert.ok(before.includes(word), `${word} is not drawn`);
  }
  const changed = loadContent();
  changed.statusline.effortEnds = { start: "Quicker", end: "Wiser" };
  changed.statusline.toggleNote = "a different gloss entirely";
  changed.statusline.toggleHint = "Space to flip";
  changed.statusline.help = ["one hint", "another hint"];
  const after = rowsToText(composeSession(changed, activity).rows);
  for (const word of ["Quicker", "Wiser", "a different gloss entirely", "Space to flip", "one hint · another hint"]) {
    assert.ok(after.includes(word), `${word} did not reach the Session`);
  }
  for (const word of [s.effortEnds.start, s.effortEnds.end, s.toggleNote, s.toggleHint, ...s.help]) {
    assert.ok(!after.includes(word), `${word} is still written into the generator`);
  }
});

test("a longer effort word pushes the track along rather than leaving it where it was", () => {
  const c = loadContent();
  c.statusline.toggleNote = "a short gloss";   // the gloss shares the toggle's row, not the track's
  const widths = ["E", "Effort", "Reasoning budget"].map((word) => {
    c.statusline.effortWord = word;
    return { word, from: trackOf(panelOf(c)).from };
  });
  for (let i = 1; i < widths.length; i++) {
    const grew = [...widths[i].word].length - [...widths[i - 1].word].length;
    assert.equal(widths[i].from - widths[i - 1].from, grew, `${widths[i].word} did not push the track by its own length`);
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

test("a gloss that would run into the toggle, or touch it, is rejected", () => {
  const c = loadContent();
  const room = COLS - `${c.statusline.toggle.word}  ${c.statusline.toggle.state}`.length - trackOf(panelOf(c)).from;
  c.statusline.toggleNote = "g".repeat(room - 1);
  assert.doesNotThrow(() => composeSession(c, activity), "one blank column before the toggle");
  c.statusline.toggleNote = "g".repeat(room);
  assert.throws(() => composeSession(c, activity), /runs into/);
  c.statusline.toggleNote = "g".repeat(room + 5);
  assert.throws(() => composeSession(c, activity), /runs into/);
});

test("levels too wide for the track are rejected rather than drawn over one another", () => {
  const c = loadContent();
  c.statusline.effortLabels = c.statusline.effortLabels.map((l) => l + "x".repeat(10));
  c.statusline.effortSelected = c.statusline.effortLabels[0];
  assert.throws(() => composeSession(c, activity), /runs into|do not fit/);
});

test("a note wider than the whole Session is rejected, not drawn off the left edge", () => {
  const c = loadContent();
  c.statusline.note = "n".repeat(COLS + 10);
  assert.throws(() => composeSession(c, activity), /runs into/);
});

// ---- the toggle: a gradient standing still, and a sheen that travels it ----

test("the toggle's word and its state are the owner's copy, read from content.json", () => {
  const shipped = JSON.parse(readFileSync(new URL("../content.json", import.meta.url), "utf8"));
  assert.deepEqual(loadContent().statusline.toggle, shipped.statusline.toggle);
  assert.deepEqual(shipped.statusline.toggle, { word: "Ultrachill", state: "on" }, "the owner's joke, in their file");
  assert.ok(!shipped.statusline.effortLabels.includes("Ultrachill"), "the toggle is not one of the effort labels");

  // The generator spells neither of them: change the file and the Statusline changes with it.
  const c = loadContent();
  c.statusline.toggle = { word: "Overcaffeinated", state: "warm" };
  c.statusline.toggleNote = "a gloss with no old word in it";
  const text = lineAt(composeSession(c, activity).rows, PANEL.toggle);
  assert.ok(text.endsWith("Overcaffeinated  warm"), text);
  assert.ok(!text.includes("Ultrachill"), "the old word is still written into the generator");
});

test("the resting word is a gradient: one run per character, each with its own ramp colour", () => {
  for (const word of ["x", "Ultrachill", "Supercalifragilistic"]) {
    const c = loadContent();
    c.statusline.toggle = { word, state: "on" };
    c.statusline.toggleNote = "g";   // a long toggle leaves the gloss little room, and it shares its row
    const row = rowAt(composeSession(c, activity).rows, PANEL.toggle);
    const chars = [...word];
    const base = row.runs.filter((r) => r.cls?.startsWith("gradient-"));
    assert.equal(base.length, chars.length, `${word}: one gradient run per character`);
    base.forEach((r, i) => {
      assert.equal(r.cls, `gradient-${i}`, `${word}: character ${i}`);
      assert.equal(r.text, chars[i]);
      assert.equal(r.style, "accent-bold", "the toggle is bold, and its ramp paints over the role's fill");
      assert.equal(r.col, base[0].col + i, `${word}: character ${i} sits on its own column`);
    });
    // Nothing hides it: the gradient is the STILL FRAME, so it carries no animation hook at all.
    assert.ok(base.every((r) => !isShimmer(r.cls)), "the gradient copy is animated");
    const text = rowsToText([row]);
    // The right column is flush with the Session's right edge, so the wider of the toggle and the
    // hint beneath it ends on the last column. For a word shorter than its own hint that is the
    // hint, which is why this measures the block rather than assuming it is the toggle.
    assert.ok(text.endsWith(`${word}  on`), text);
    const hint = lineAt(composeSession(c, activity).rows, PANEL.hint);
    assert.equal(Math.max([...text].length, [...hint].length), COLS, `${word}: the right column is not flush right`);
    assert.equal([...text].length - [...`${word}  on`].length, [...hint].length - [...c.statusline.toggleHint].length,
      `${word}: the toggle and its hint do not start in the same column`);
  }
});

for (const [label, make] of CONTENTS) {
  test(`the sheen is a second copy over the gradient, one run per character (${label})`, () => {
    const c = make();
    const word = c.statusline.toggle.word;
    const row = rowAt(composeSession(c, activity).rows, PANEL.toggle);
    const chars = [...word];
    const base = row.runs.filter((r) => r.cls?.startsWith("gradient-"));
    const copy = row.runs.filter((r) => isShimmer(r.cls));
    assert.equal(copy.length, chars.length, "one highlight run per character");
    copy.forEach((r, i) => {
      assert.equal(r.cls, `shimmer-${i}`);
      assert.equal(r.text, chars[i]);
      assert.equal(r.style, "accent-bold", "the sheen is the top of the ramp, at the word's own weight");
      assert.equal(r.col, base[i].col, `character ${i} sits over its own letter of the gradient`);
    });
  });
}

for (const [label, make] of CONTENTS) {
  test(`the word reads once in the transcript, followed by its state, flush with the right edge (${label})`, () => {
    const c = make();
    const { word, state } = c.statusline.toggle;
    const line = lineAt(composeSession(c, activity).rows, PANEL.toggle);
    // Drawn twice over, once as the gradient and once as the sheen, and it must read once. The
    // gloss beside it is the owner's own copy and names the toggle on purpose, so the count is
    // taken on the toggle's own columns rather than over the whole row.
    const toggled = line.slice(COLS - [...`${word}  ${c.statusline.toggle.state}`].length);
    assert.equal(toggled.split(word).length - 1, 1, "the word is drawn many times but must read once");
    assert.ok(line.endsWith(`${word}  ${state}`), line);
    assert.equal([...line].length, COLS);
  });
}

test("the highlight copy lives in the same row as the word, in no other row", () => {
  const c = loadContent();
  const { rows } = composeSession(c, activity);
  const withShimmer = rows.filter((r) => r.runs.some((run) => isShimmer(run.cls)));
  assert.equal(withShimmer.length, 1);
  assert.ok(withShimmer[0].runs.some((run) => run.cls?.startsWith("gradient-")));
});

test("the toggle is off the scale's own row, which is what sharing one made cramped", () => {
  const c = loadContent();
  const rows = panelOf(c);
  assert.ok(!lineAt(rows, PANEL.levels).includes(c.statusline.toggle.word), "the toggle is back on the scale's row");
  assert.ok(lineAt(rows, PANEL.toggle).includes(c.statusline.toggle.word));
  assert.ok(lineAt(rows, PANEL.hint).includes(c.statusline.toggleHint));
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
  // The connector is at column 4 and the name still at 7: the tree is drawn into columns the
  // indent was already spending on nothing, so neither the name nor the blurb moved.
  const nameAt = lines.indexOf(`    ├─ ${name}`);
  assert.ok(nameAt >= 0, "the name row is missing");
  assert.equal(lines[nameAt].indexOf(name), 7);
  assert.equal(lines[nameAt + 1], `    │    ${blurb}`);
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
  const { rows, mascotRow } = composeSession(loadContent(), activity);
  const roleRow = rows.findIndex((r) => r.runs.some((run) => run.text === loadContent().role));
  assert.ok(roleRow > 0, "the role line is not in the Session");

  const inkBottom = PAD + (mascotRow + MASCOT_ROWS) * CELL_H;          // the artwork runs to here
  const capTop = PAD + roleRow * CELL_H + BASELINE_IN_ROW - CAP_HEIGHT; // the role's ink starts here
  const gap = capTop - inkBottom;

  // One whole row of separation is the margin the artwork does not carry. Placing the role
  // immediately under the band leaves 2.9 units, which is what read as glued.
  assert.ok(gap >= CELL_H, `only ${gap} units between the rack and the role line, wanted at least one row (${CELL_H})`);
  assert.equal(roleRow, mascotRow + MASCOT_ROWS + 1, "the role line sits one blank row below the artwork");
  const glued = PAD + (mascotRow + MASCOT_ROWS) * CELL_H + BASELINE_IN_ROW - CAP_HEIGHT - inkBottom;
  assert.ok(glued < 3, `the fault being fixed should measure under 3 units, measured ${glued}`);
  assert.ok(gap > glued * 8, "the blank row must be a real separation, not a nudge");
});
