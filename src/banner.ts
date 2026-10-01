import { artToPath } from "./blockart.ts";

export const BANNER_ROWS = 3;

/**
 * Half-block letterforms, 3 rows tall. Each glyph is 4 columns wide plus a
 * 1-column gap, so it shares the Mascot's visual vocabulary rather than
 * looking like a figlet font.
 */
const LETTERS: Record<string, string[]> = {
  A: ["▄▀▀▄", "█▀▀█", "▀  ▀"],
  B: ["█▀▀▄", "█▀▀▄", "▀▀▀ "],
  C: ["▄▀▀▀", "█   ", "▀▀▀▀"],
  D: ["█▀▀▄", "█  █", "▀▀▀ "],
  E: ["█▀▀▀", "█▀▀ ", "▀▀▀▀"],
  F: ["█▀▀▀", "█▀▀ ", "▀   "],
  G: ["▄▀▀▀", "█ ▀█", "▀▀▀▀"],
  H: ["█  █", "█▀▀█", "▀  ▀"],
  I: ["▀█▀ ", " █  ", "▀▀▀ "],
  J: ["  ▀█", "   █", "▀▀▀ "],
  K: ["█  █", "█▀▄ ", "▀  ▀"],
  L: ["█   ", "█   ", "▀▀▀▀"],
  M: ["█▄ ▄█", "█ ▀ █", "▀   ▀"],
  N: ["█▄ █", "█ ▀█", "▀  ▀"],
  O: ["▄▀▀▄", "█  █", "▀▀▀▀"],
  P: ["█▀▀▄", "█▀▀ ", "▀   "],
  Q: ["▄▀▀▄", "█  █", "▀▀▀▄"],
  R: ["█▀▀▄", "█▀▀▄", "▀  ▀"],
  S: ["▄▀▀▀", " ▀▀▄", "▀▀▀ "],
  T: ["▀█▀▀", " █  ", " ▀  "],
  U: ["█  █", "█  █", "▀▀▀▀"],
  V: ["█  █", "█  █", " ▀▀ "],
  W: ["█   █", "█ ▄ █", "▀▀ ▀▀"],
  X: ["▀▄▄▀", " ▄▄ ", "▀  ▀"],
  Y: ["█  █", " ▀▀█", "▀▀▀ "],
  Z: ["▀▀▀█", " ▄▀ ", "▀▀▀▀"],
  "-": ["    ", "▄▄▄▄", "    "],
  " ": ["  ", "  ", "  "],
};

const GAP = 1;

/**
 * Rows are joined as they are, never padded to a common width: a glyph row that
 * is a column short must show up as ragged output, not be quietly absorbed.
 */
export function bannerArt(text: string): string[] {
  const glyphs = [...text.toUpperCase()].map((ch) => {
    const g = LETTERS[ch];
    if (!g) throw new Error(`banner cannot draw ${JSON.stringify(ch)}; add it to LETTERS in src/banner.ts`);
    return g;
  });
  return Array.from({ length: BANNER_ROWS }, (_, r) => glyphs.map((g) => g[r]).join(" ".repeat(GAP)));
}

export function bannerWidthCols(text: string): number {
  return [...bannerArt(text)[0]].length;
}

export function bannerPath(text: string, col: number, row: number): string {
  return artToPath(bannerArt(text), col, row);
}
