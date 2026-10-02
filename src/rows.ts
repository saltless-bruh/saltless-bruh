import { COLS, colX, rowBaselineY } from "./grid.ts";

export type Style = "text" | "muted" | "accent" | "warning" | "error" | "bold";
/**
 * `cls` attaches an animation hook to a single run, e.g. the spinner glyph.
 *
 * `textOnly` and `drawOnly` are the two halves of one idea: a row may hold runs that only one
 * of the Session's two faces, the picture and the text, is meant to show.
 *
 * - `textOnly` is a word the picture draws some other way. The Banner's letters are geometry,
 *   so the row carries the handle for the transcript and `renderRows` draws nothing for it.
 * - `drawOnly` is a glyph the transcript must not repeat. The motion layer stacks one verb per
 *   Mascot pose at the same columns and reveals one at a time; painting all of them into one
 *   line of text would spell none of them.
 *
 * Neither flag hides anything from the ADR 0001 gate: that reads `rowsToFullText`, which takes
 * every run. Both flags are visible to `rowWidth`, `assertFits` and `charsUsed`, because a run
 * still occupies its columns and a glyph some layer draws still needs the font subset.
 */
export type Run = {
  col: number; text: string; style?: Style; cls?: string; textOnly?: true; drawOnly?: true;
};
export type Row = { runs: Run[]; cls?: string };

/** Escapes text for use as XML element content or as a double-quoted attribute value. */
export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Grid cells a string occupies: one per code point, so a character outside the BMP is one cell. */
const cells = (s: string): number => [...s].length;

const byColumn = (a: Run, b: Run): number => a.col - b.col;

/** Number of columns the row occupies, measured to the end of its furthest run. */
export function rowWidth(row: Row): number {
  return row.runs.reduce((w, r) => Math.max(w, r.col + cells(r.text)), 0);
}

export function assertFits(rows: Row[]): void {
  rows.forEach((row, i) => {
    const w = rowWidth(row);
    if (w > COLS) {
      throw new Error(`row ${i} needs ${w} columns, the Session is ${COLS}: ${JSON.stringify(rowsToText([row]))}`);
    }
  });
}

/**
 * One line per row, each kept run writing onto the grid cells it covers, so runs laid over one
 * another (a highlight copy over its word) read once, as the eye sees them.
 */
function paint(rows: Row[], keep: (run: Run) => boolean): string {
  return rows.map((row) => {
    const line: string[] = [];
    for (const run of [...row.runs].filter(keep).sort(byColumn)) {
      [...run.text].forEach((ch, i) => { line[run.col + i] = ch; });
    }
    return Array.from(line, (ch) => ch ?? " ").join("").trimEnd();
  }).join("\n");
}

/** The Session as a reader reads it: the transcript block. `drawOnly` runs are the picture's. */
export const rowsToText = (rows: Row[]): string => paint(rows, (run) => !run.drawOnly);

/** The Session as the picture shows it, for checking that the two faces agree. */
export const rowsToDrawnText = (rows: Row[]): string => paint(rows, (run) => !run.textOnly);

/**
 * Every string the rows carry, in every projection one could appear in. This is what the ADR
 * 0001 gate reads, never `rowsToText`: neither flag may hide a name from the check.
 *
 * Three projections, because each closes a different way a name could slip past:
 * painting reassembles a word that is split into one run per character, as the Statusline's
 * shimmer splits it, and the two painted faces catch a split on either side of the flags;
 * painting also buries a run under a longer one laid over it, which the Statusline does on
 * purpose, so every run's own text follows on a line of its own, where no overlap reaches it.
 */
export function rowsToFullText(rows: Row[]): string {
  return [
    rowsToText(rows),
    rowsToDrawnText(rows),
    ...rows.flatMap((row) => row.runs.map((run) => run.text)),
  ].join("\n");
}

/**
 * The rows as `<text>` elements: every run except the `textOnly` ones, whose words the picture
 * draws another way. A row left with nothing to draw emits no element, unless it carries a row
 * hook of its own to keep.
 */
export function renderRows(rows: Row[]): string {
  return rows.map((row, i) => {
    const drawn = row.runs.filter((r) => !r.textOnly);
    if (drawn.length === 0 && !row.cls) return "";
    const spans = [...drawn]
      .sort(byColumn)
      .map((r) => `<tspan x="${colX(r.col)}" class="${[r.style ?? "text", r.cls].filter(Boolean).join(" ")}">${esc(r.text)}</tspan>`)
      .join("");
    const cls = row.cls ? ` class="${row.cls}"` : "";
    return `<text${cls} y="${rowBaselineY(i)}" xml:space="preserve">${spans}</text>`;
  }).filter((el) => el !== "").join("\n");
}

/**
 * Every character the rows carry, for subsetting and coverage checks. Both flags count: a
 * `drawOnly` run is drawn, and a `textOnly` run's words may be drawn by another layer (the
 * motion layer's spinner verbs), so the subset must cover them whichever layer shows them.
 */
export function charsUsed(rows: Row[]): string {
  return [...new Set(rows.flatMap((r) => r.runs.flatMap((run) => [...run.text])))].join("");
}
