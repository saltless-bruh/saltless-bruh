import { COLS, colX, rowBaselineY } from "./grid.ts";

export type Style = "text" | "muted" | "accent" | "warning" | "error" | "bold";
/**
 * `cls` attaches an animation hook to a single run, e.g. the spinner glyph.
 *
 * `textOnly` marks words the Session shows some other way than as glyphs on this row: the
 * Banner's letters are geometry, and the spinner's verbs are drawn by the motion layer. The
 * run is read by `rowsToText`, so the transcript and the forbidden-name scan see the words,
 * and it is skipped by `renderRows`, so nothing is drawn on top of the art.
 */
export type Run = { col: number; text: string; style?: Style; cls?: string; textOnly?: true };
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
 * The Session as plain text, for the transcript block and the forbidden-name scan.
 * Each run writes onto the grid cells it covers, so runs drawn over one another (a highlight
 * copy laid over a word) read once, as the eye sees them, rather than being concatenated.
 */
export function rowsToText(rows: Row[]): string {
  return rows.map((row) => {
    const line: string[] = [];
    for (const run of [...row.runs].sort(byColumn)) {
      [...run.text].forEach((ch, i) => { line[run.col + i] = ch; });
    }
    return Array.from(line, (ch) => ch ?? " ").join("").trimEnd();
  }).join("\n");
}

/**
 * The rows as `<text>` elements. A `textOnly` run draws nothing, so a row that holds only
 * those, or no runs at all, emits no element unless it carries a row hook of its own to keep.
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
 * Every character the rows carry, for subsetting and coverage checks. A `textOnly` run counts
 * too: this row does not draw its words, but the Session may draw them elsewhere (the motion
 * layer's spinner verbs), so the subset has to cover them whichever layer puts them on screen.
 */
export function charsUsed(rows: Row[]): string {
  return [...new Set(rows.flatMap((r) => r.runs.flatMap((run) => [...run.text])))].join("");
}
