import { COLS, colX, rowBaselineY } from "./grid.ts";

export type Style = "text" | "muted" | "accent" | "warning" | "error" | "bold";
/** `cls` attaches an animation hook to a single run, e.g. the spinner glyph. */
export type Run = { col: number; text: string; style?: Style; cls?: string };
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

/** The Session as plain text, for the transcript block and the forbidden-name scan. */
export function rowsToText(rows: Row[]): string {
  return rows.map((row) => {
    let line = "";
    let at = 0;
    for (const run of [...row.runs].sort(byColumn)) {
      if (at < run.col) {
        line += " ".repeat(run.col - at);
        at = run.col;
      }
      line += run.text;
      at += cells(run.text);
    }
    return line.trimEnd();
  }).join("\n");
}

export function renderRows(rows: Row[]): string {
  return rows.map((row, i) => {
    const spans = [...row.runs]
      .sort(byColumn)
      .map((r) => `<tspan x="${colX(r.col)}" class="${[r.style ?? "text", r.cls].filter(Boolean).join(" ")}">${esc(r.text)}</tspan>`)
      .join("");
    const cls = row.cls ? ` class="${row.cls}"` : "";
    return `<text${cls} y="${rowBaselineY(i)}" xml:space="preserve">${spans}</text>`;
  }).join("\n");
}

/** Every character the rows will draw, for subsetting and coverage checks. */
export function charsUsed(rows: Row[]): string {
  return [...new Set(rows.flatMap((r) => r.runs.flatMap((run) => [...run.text])))].join("");
}
