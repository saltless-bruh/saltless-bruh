import { COLS } from "./grid.ts";
import type { Content } from "./content.ts";
import { assertFits } from "./rows.ts";
import type { Row, Run } from "./rows.ts";
import { BANNER_ROWS, bannerWidthCols } from "./banner.ts";
import { MASCOT_COLS, MASCOT_ROWS } from "./mascot.ts";
import { MASCOT_TIMELINE } from "./timeline.ts";

export type Activity = {
  totalContributions: number;
  activeDays: number;
  calendar: { date: string; count: number }[];
  languages: { name: string; bytes: number }[];
};

export type Session = {
  rows: Row[];
  /** Rows above the first rule: the Mascot's rows, then the role and the cwd. */
  headerRows: number;
  /** Where the Banner geometry goes: beside the Mascot, centred on it. */
  bannerCol: number;
  bannerRow: number;
  /** First of the SCAN_ROWS rows held empty for the Scan Sweep geometry. */
  scanRow: number;
  /**
   * The spinner's row. It holds the glyph and, as text only, the verb of the pose the loop
   * rests on; every drawn verb is layered over it by the motion layer.
   */
  verbRow: number;
};

/**
 * Rows kept empty under /activity for the Scan Sweep.
 *
 * The contribution calendar is 53 week-columns by 7 day-rows. One week per grid column makes
 * it 53 columns wide, which fits inside the Session's 72. Square cells, which is what GitHub's
 * own calendar uses, then want CELL_W of height each, so 7 days is 7 x 12 = 84 units; at
 * CELL_H = 24 that is 3.5 rows. Four rows hold the sweep, with the spare half-row as breathing
 * room. Cells of 12 x 24 would read as a bar chart instead of a grid, so the height follows the
 * width rather than the row pitch. The "N/365 days up" result line stays a text row of its own:
 * a status colour is always paired with a word, so the sweep needs its printed result.
 */
export const SCAN_ROWS = 4;

/** Prefix of the per-character highlight hooks on the Statusline toggle: `shimmer-0`, `shimmer-1`, ... */
const SHIMMER_PREFIX = "shimmer-";
export const shimmerClass = (index: number): string => `${SHIMMER_PREFIX}${index}`;

/**
 * What a spinner verb ends with. Exported so the motion layer, which draws one verb per
 * Mascot pose, spells them the same way as the verb the transcript names.
 */
export const VERB_SUFFIX = "…";

/** Days in the window the activity line counts against. */
const WINDOW_DAYS = 365;
/** Free columns between the Mascot and the Banner. */
const MASCOT_GAP = 2;
/** Columns where the body text starts, after the prompt glyph and a space. */
const BODY_COL = 2;
/** Where a language name or a tool label starts, under the result glyph. */
const LIST_COL = 5;
/** Blank columns between the effort word and the first level, so a longer word pushes them along. */
const EFFORT_GAP = 3;
/** Columns between two things in a list that sit on the same row. */
const SPACING = 2;
const REPO_NAME_COL = 7;
const REPO_BLURB_COL = 9;

const cells = (s: string): number => [...s].length;
const blank = (): Row => ({ runs: [] });
const rule = (): Row => ({ runs: [{ col: 0, text: "─".repeat(COLS), style: "muted" }] });
const isHighlight = (r: Run): boolean => r.cls?.startsWith(SHIMMER_PREFIX) ?? false;

/**
 * Whole percentages that always total 100, by largest remainder: every language gets the
 * floor of its share, and the leftover points go to the largest fractions. Integer
 * arithmetic throughout, so a share that is exactly whole is never nudged by rounding noise.
 * With no bytes at all there is nothing to share, so every figure is 0.
 */
export function languageShares(langs: { name: string; bytes: number }[]): { name: string; pct: number }[] {
  const sum = langs.reduce((s, l) => s + l.bytes, 0);
  if (sum === 0) return langs.map((l) => ({ name: l.name, pct: 0 }));
  const parts = langs.map((l) => {
    const scaled = l.bytes * 100;
    const rest = scaled % sum;
    return { name: l.name, pct: (scaled - rest) / sum, rest };
  });
  const leftover = 100 - parts.reduce((s, p) => s + p.pct, 0);
  // The sort is stable, so equal fractions favour the language listed first.
  const byRest = parts.map((_, i) => i).sort((i, j) => parts[j].rest - parts[i].rest);
  for (const i of byRest.slice(0, leftover)) parts[i].pct++;
  return parts.map(({ name, pct }) => ({ name, pct }));
}

/**
 * `assertFits` measures only where a row ends, so two runs placed on top of one another, or
 * butted together so they read as one word, would pass it.
 *
 * Each of the Session's two faces is checked on its own, because a run can only collide with
 * what is shown beside it: the picture is every run but the `textOnly` ones, the transcript is
 * every run but the `drawOnly` ones. A word the Banner draws as art may therefore share columns
 * with the glyphs the motion layer stacks there, since the two are never on screen together.
 * A highlight copy is meant to lie over its word and is skipped in both faces; its word is
 * still checked. A set of drawn alternatives at one position, which only the motion layer's
 * clock keeps apart, must declare itself the same way: that is a fact about the clock and not
 * about the row, so this check cannot infer it.
 */
export function assertNoCollisions(rows: Row[]): void {
  const faces: [string, (run: Run) => boolean][] = [
    ["the picture", (run) => !run.textOnly],
    ["the transcript", (run) => !run.drawOnly],
  ];
  rows.forEach((row, i) => {
    for (const [face, shown] of faces) {
      const runs = row.runs.filter((r) => shown(r) && !isHighlight(r)).sort((a, b) => a.col - b.col);
      for (let k = 1; k < runs.length; k++) {
        const prev = runs[k - 1];
        if (prev.col + cells(prev.text) >= runs[k].col) {
          throw new Error(`row ${i} in ${face}: ${JSON.stringify(prev.text)} runs into ${JSON.stringify(runs[k].text)}; they need a blank column between them`);
        }
      }
    }
  });
}

export function composeSession(c: Content, a: Activity): Session {
  const bannerCol = MASCOT_COLS + MASCOT_GAP;
  const bannerEnd = bannerCol + bannerWidthCols(c.handle);
  if (bannerEnd > COLS) {
    throw new Error(`the banner for ${JSON.stringify(c.handle)} needs ${bannerEnd} columns, the Session is ${COLS}; use a shorter handle`);
  }
  const bannerRow = Math.floor((MASCOT_ROWS - BANNER_ROWS) / 2);

  // Header. The Mascot and the Banner are geometry, so nothing is drawn as glyphs over their
  // rows. The Banner's middle row still carries the handle as a text-only run, so the
  // transcript names the owner and the forbidden-name scan can read what the block art spells.
  // The role and the cwd get rows of their own under the Mascot, with the whole width to them.
  const rows: Row[] = Array.from({ length: MASCOT_ROWS }, blank);
  rows[bannerRow + Math.floor(BANNER_ROWS / 2)].runs.push({ col: bannerCol, text: c.handle, textOnly: true });
  rows.push({ runs: [{ col: 0, text: c.role, style: "bold" }] });
  rows.push({ runs: [{ col: 0, text: c.cwd, style: "muted" }] });
  const headerRows = rows.length;
  rows.push(rule());

  const command = (name: string): void => {
    rows.push({ runs: [{ col: 0, text: "❯", style: "accent" }, { col: BODY_COL, text: name, style: "bold" }] });
  };
  const bullet = (text: string): void => {
    rows.push({ runs: [{ col: 0, text: "●", style: "accent" }, { col: BODY_COL, text, style: "text" }] });
  };
  const result = (text: string, style: Run["style"] = "text"): void => {
    rows.push({ runs: [{ col: BODY_COL, text: "╰", style: "muted" }, { col: LIST_COL, text, style }] });
  };

  command("/whoami");
  for (const line of c.whoami) bullet(line);
  rows.push(blank());

  command("/ops");
  for (const lane of c.lanes) {
    result(lane.label, "accent");
    for (const repo of lane.repos) {
      // A name and its description share a row only if the description fits in what the
      // name leaves, which no useful sentence does. Two rows also read like real command output.
      rows.push({ runs: [{ col: REPO_NAME_COL, text: repo.name, style: "text" }] });
      rows.push({ runs: [{ col: REPO_BLURB_COL, text: repo.blurb, style: "muted" }] });
    }
  }
  rows.push(blank());

  command("/stack");
  // Largest first, on a copy: the caller's activity is not reordered.
  const shares = languageShares([...a.languages].sort((x, y) => y.bytes - x.bytes));
  const pctCol = LIST_COL + Math.max(0, ...shares.map((s) => cells(s.name))) + SPACING;
  for (const s of shares) {
    rows.push({ runs: [
      { col: LIST_COL, text: s.name, style: "text" },
      { col: pctCol, text: `${s.pct}%`, style: "muted" },
    ] });
  }
  const itemsCol = LIST_COL + Math.max(0, ...c.stackRows.map((r) => cells(r.label))) + SPACING;
  for (const row of c.stackRows) {
    const runs: Run[] = [];
    if (row.label !== "") runs.push({ col: LIST_COL, text: row.label, style: "muted" });
    runs.push({ col: itemsCol, text: row.items.join(" ".repeat(SPACING)), style: "text" });
    rows.push({ runs });
  }
  rows.push(blank());

  command("/activity");
  const scanRow = rows.length;
  for (let r = 0; r < SCAN_ROWS; r++) rows.push(blank());
  // Labelled fragments, not a template: each one is validated on its own like every other
  // visible string, and the order of the sentence stays here, where the layout can rely on it.
  // The middle dot is a mark rather than a word, so it belongs to the generator.
  const line = c.activityLine;
  result(
    `${line.label} ${a.activeDays}/${WINDOW_DAYS} ${line.daysUp} · ${a.totalContributions} ${line.contributions}`,
    "accent",
  );
  rows.push(blank());

  // The drawn words depend on which pose is on screen, so every one of them is layered over
  // this row by the motion layer. The row itself keeps the glyph, which spins whatever the
  // word, and the verb of the pose the loop starts and rests on, as text only: the transcript
  // then gets a spinner that says something instead of a lone glyph.
  const verbRow = rows.length;
  rows.push({ runs: [
    { col: 0, text: "✶", style: "accent", cls: "spinner-glyph" },
    { col: BODY_COL, text: `${c.verbs[MASCOT_TIMELINE[0].state][0]}${VERB_SUFFIX}`, textOnly: true },
  ] });
  rows.push(rule());

  // Statusline: the effort picker on the left, the shimmering toggle on the right.
  const effort: Run[] = [{ col: 0, text: c.statusline.effortWord, style: "muted" }];
  let col = cells(c.statusline.effortWord) + EFFORT_GAP;
  for (const label of c.statusline.effortLabels) {
    const selected = label === c.statusline.effortSelected;
    const shown = selected ? `[${label}]` : label;
    effort.push({ col, text: shown, style: selected ? "accent" : "muted" });
    col += cells(shown) + SPACING;
  }
  // The toggle's word and its state are the owner's copy, so both come from content.json.
  // The word is drawn twice at one position: a muted base copy, and an accent copy split into
  // one run per character. Staggering the copy's opacity character by character is what sweeps
  // a bright band across the letters, for a word of any length. Nothing is animated here.
  const { word, state } = c.statusline.toggle;
  const toggleCol = COLS - cells(`${word} ${state}`);
  effort.push({ col: toggleCol, text: word, style: "muted" });
  [...word].forEach((ch, i) => {
    effort.push({ col: toggleCol + i, text: ch, style: "accent", cls: shimmerClass(i) });
  });
  effort.push({ col: toggleCol + cells(word) + 1, text: state, style: "muted" });
  rows.push({ runs: effort });

  rows.push({ runs: [
    { col: 0, text: `▶▶ ${c.statusline.modeBadge}`, style: "muted" },
    { col: COLS - cells(c.statusline.note), text: c.statusline.note, style: "muted" },
  ] });

  // A Session that does not fit is not returned: the message names the row and its text.
  assertFits(rows);
  assertNoCollisions(rows);
  return { rows, headerRows, bannerCol, bannerRow, scanRow, verbRow };
}
