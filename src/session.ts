import { COLS } from "./grid.ts";
import type { Content } from "./content.ts";
import { assertFits } from "./rows.ts";
import type { Row, Run } from "./rows.ts";
import { BANNER_ROWS, bannerWidthCols } from "./banner.ts";
import { MASCOT_COLS, MASCOT_ROWS } from "./mascot.ts";

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
  /** The spinner's row. Only the glyph is here; the words are layered over it later. */
  verbRow: number;
};

/** Rows kept empty under /activity for the Scan Sweep. */
export const SCAN_ROWS = 8;

/** The Statusline toggle that carries a shimmer. Its highlight runs are `shimmer-0`, `shimmer-1`, and so on. */
export const SHIMMER_WORD = "Ultrachill";
const SHIMMER_PREFIX = "shimmer-";
export const shimmerClass = (index: number): string => `${SHIMMER_PREFIX}${index}`;

/** Days in the window the activity line counts against. */
const WINDOW_DAYS = 365;
/** Free columns between the Mascot and the Banner. */
const MASCOT_GAP = 2;
/** Columns where the body text starts, after the prompt glyph and a space. */
const BODY_COL = 2;
/** Where a language name or a tool label starts, under the result glyph. */
const LIST_COL = 5;
/** Where the effort labels start, after the word Effort and a gap. */
const EFFORT_COL = 9;
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
 * butted together so they read as one word, would pass it. A highlight copy is meant to lie
 * over its word and is skipped; its word is still checked.
 */
function assertNoCollisions(rows: Row[]): void {
  rows.forEach((row, i) => {
    const runs = row.runs.filter((r) => !isHighlight(r)).sort((a, b) => a.col - b.col);
    for (let k = 1; k < runs.length; k++) {
      const prev = runs[k - 1];
      if (prev.col + cells(prev.text) >= runs[k].col) {
        throw new Error(`row ${i}: ${JSON.stringify(prev.text)} runs into ${JSON.stringify(runs[k].text)}; they need a blank column between them`);
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

  // Header. The Mascot and the Banner are geometry, so their rows hold no text. The role and
  // the cwd get rows of their own under the Mascot, with the whole width to themselves.
  const rows: Row[] = Array.from({ length: MASCOT_ROWS }, blank);
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
  result(`scan complete: ${a.activeDays}/${WINDOW_DAYS} days up · ${a.totalContributions} contributions`, "accent");
  rows.push(blank());

  // The spinner's words depend on which pose is on screen, so they are layered over this
  // row later. Only the glyph, which spins whatever the word, belongs to the row itself.
  const verbRow = rows.length;
  rows.push({ runs: [{ col: 0, text: "✶", style: "accent", cls: "spinner-glyph" }] });
  rows.push(rule());

  // Statusline: the effort picker on the left, the shimmering toggle on the right.
  const effort: Run[] = [{ col: 0, text: "Effort", style: "muted" }];
  let col = EFFORT_COL;
  for (const label of c.statusline.effortLabels) {
    const selected = label === c.statusline.effortSelected;
    const shown = selected ? `[${label}]` : label;
    effort.push({ col, text: shown, style: selected ? "accent" : "muted" });
    col += cells(shown) + SPACING;
  }
  // The word is drawn twice at one position: a muted base copy, and an accent copy split into
  // one run per character. Staggering the copy's opacity character by character is what sweeps
  // a bright band across the letters. Nothing is animated here.
  const toggleCol = COLS - cells(`${SHIMMER_WORD} on`);
  effort.push({ col: toggleCol, text: SHIMMER_WORD, style: "muted" });
  [...SHIMMER_WORD].forEach((ch, i) => {
    effort.push({ col: toggleCol + i, text: ch, style: "accent", cls: shimmerClass(i) });
  });
  effort.push({ col: toggleCol + cells(SHIMMER_WORD) + 1, text: "on", style: "muted" });
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
