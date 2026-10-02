import { artToPath } from "./blockart.ts";

/**
 * Text rows the Banner occupies. Each row carries TWO pixel rows as half-blocks, so a glyph is
 * ten pixel rows tall: both set is a full block, top only an upper half, bottom only a lower half.
 */
export const BANNER_ROWS = 5;
/** Pixel rows in a glyph. Two per text row, which is what makes a half-block grid square. */
export const GLYPH_PIXEL_ROWS = BANNER_ROWS * 2;

const SET = "#";
const CLEAR = ".";

/**
 * The letterforms, as bitmaps rather than as block characters: `#` is a set pixel, `.` is clear.
 *
 * The bitmap is the source of truth because it is the thing a human can read and judge. A table of
 * half-blocks hides the top half of every pixel row inside a character, so a stem one pixel too
 * thin looks exactly like a correct one in the source and only shows up in a render.
 *
 * Four rules, and every glyph here follows them:
 *
 * 1. STEMS ARE TWO PIXELS WIDE. One-pixel strokes do not survive the phone render, which is the
 *    whole reason this alphabet replaced a three-row one.
 * 2. DIAGONALS CARRY THE SAME WEIGHT AS A STEM, which is not the same as the same width. A stroke
 *    `w` pixels wide horizontally that advances `dx` columns per `dy` rows is only
 *    `w * dy / hypot(dx, dy)` pixels thick measured across itself. At 45 degrees (Z, X, 2, 6, 7)
 *    that makes a three-pixel diagonal 3/sqrt(2) = 2.12 thick, which matches the two-pixel stem;
 *    drawn two wide it measures 1.41 and reads visibly lighter. The first draft's Z looked like a 7
 *    until this was fixed. Where a letter's diagonal must be steeper than 45 degrees because ten
 *    rows leave no room to travel (M, N, W, and the legs of K and R), one column per two rows at
 *    two pixels wide measures 2 * 2 / sqrt(5) = 1.79, which is the same weight again. Thinning a
 *    45-degree diagonal to two is the mistake; a steep diagonal at two is the same rule applied.
 * 3. TERMINALS ARE FLAT. The only serifs are the ones I and J need to be unambiguous.
 * 4. COUNTERS STAY OPEN. Enclosed counters are two pixels across at their narrowest. Open counters
 *    (M, N, W, K, V, X, Y) pinch to one pixel where strokes converge, which is where they must:
 *    the alternative is a vertex that never closes, and that reads as a fault rather than a letter.
 *
 * Round and square are what keep the look-alikes apart, so the three bowl treatments are a system:
 * O, 8, S and the round digits are bevelled on BOTH sides, D, B, P and R are flat on the left and
 * bevelled on the right, and 0 is square on all four corners. 5 keeps a square top bar where S
 * bevels, 6 and 9 trade a bowl for a 45-degree diagonal where G keeps a crossbar, and 1 grows a
 * flag where I and T carry a full-width bar.
 */
export const LETTER_PIXELS: Record<string, string[]> = {
  A: [
    "..##..",
    ".####.",
    "##..##",
    "##..##",
    "##..##",
    "######",
    "######",
    "##..##",
    "##..##",
    "##..##",
  ],
  B: [
    "#####.",
    "######",
    "##..##",
    "##..##",
    "######",
    "######",
    "##..##",
    "##..##",
    "######",
    "#####.",
  ],
  C: [
    "..####",
    ".#####",
    "##....",
    "##....",
    "##....",
    "##....",
    "##....",
    "##....",
    ".#####",
    "..####",
  ],
  D: [
    "####..",
    "#####.",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "#####.",
    "####..",
  ],
  E: [
    "######",
    "######",
    "##....",
    "##....",
    "#####.",
    "#####.",
    "##....",
    "##....",
    "######",
    "######",
  ],
  F: [
    "######",
    "######",
    "##....",
    "##....",
    "#####.",
    "#####.",
    "##....",
    "##....",
    "##....",
    "##....",
  ],
  G: [
    "..####",
    ".#####",
    "##....",
    "##....",
    "##.###",
    "##.###",
    "##..##",
    "##..##",
    ".#####",
    "..####",
  ],
  H: [
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "######",
    "######",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
  ],
  I: [
    "######",
    "######",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
    "######",
    "######",
  ],
  J: [
    "..####",
    "..####",
    "....##",
    "....##",
    "....##",
    "....##",
    "##..##",
    "##..##",
    "######",
    ".####.",
  ],
  K: [
    "##..##",
    "##..##",
    "##.##.",
    "##.##.",
    "####..",
    "####..",
    "##.##.",
    "##.##.",
    "##..##",
    "##..##",
  ],
  L: [
    "##....",
    "##....",
    "##....",
    "##....",
    "##....",
    "##....",
    "##....",
    "##....",
    "######",
    "######",
  ],
  M: [
    "###...###",
    "###...###",
    "####.####",
    "####.####",
    "##.###.##",
    "##.###.##",
    "##.....##",
    "##.....##",
    "##.....##",
    "##.....##",
  ],
  N: [
    "###..##",
    "###..##",
    "####.##",
    "####.##",
    "##.####",
    "##.####",
    "##..###",
    "##..###",
    "##...##",
    "##...##",
  ],
  O: [
    "..##..",
    ".####.",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    ".####.",
    "..##..",
  ],
  P: [
    "#####.",
    "######",
    "##..##",
    "##..##",
    "######",
    "#####.",
    "##....",
    "##....",
    "##....",
    "##....",
  ],
  Q: [
    "..##....",
    ".####...",
    "##..##..",
    "##..##..",
    "##..##..",
    "##..##..",
    "##..###.",
    "##..###.",
    ".####.##",
    "..##..##",
  ],
  R: [
    "#####.",
    "######",
    "##..##",
    "##..##",
    "######",
    "#####.",
    "##.##.",
    "##.##.",
    "##..##",
    "##..##",
  ],
  S: [
    ".####.",
    "######",
    "##....",
    "##....",
    ".####.",
    ".####.",
    "....##",
    "....##",
    "######",
    ".####.",
  ],
  T: [
    "######",
    "######",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
  ],
  U: [
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "######",
    ".####.",
  ],
  V: [
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    ".####.",
    ".####.",
    "..##..",
    "..##..",
  ],
  W: [
    "##.....##",
    "##.....##",
    "##.....##",
    "##.....##",
    "##.###.##",
    "##.###.##",
    "####.####",
    "####.####",
    ".##...##.",
    ".##...##.",
  ],
  X: [
    "##..##",
    "##..##",
    ".####.",
    ".####.",
    "..##..",
    "..##..",
    ".####.",
    ".####.",
    "##..##",
    "##..##",
  ],
  Y: [
    "##..##",
    "##..##",
    ".####.",
    ".####.",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
  ],
  Z: [
    "######",
    "######",
    "....##",
    "...###",
    "..###.",
    ".###..",
    "###...",
    "##....",
    "######",
    "######",
  ],
  "0": [
    "######",
    "######",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "######",
    "######",
  ],
  "1": [
    "..##..",
    ".###..",
    "####..",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
    "######",
    "######",
  ],
  "2": [
    ".####.",
    "######",
    "##..##",
    "##..##",
    "...###",
    "..###.",
    ".###..",
    "###...",
    "######",
    "######",
  ],
  "3": [
    "#####.",
    "######",
    "....##",
    "....##",
    ".#####",
    ".#####",
    "....##",
    "....##",
    "######",
    "#####.",
  ],
  "4": [
    "...####",
    "...####",
    "..##.##",
    "..##.##",
    ".##..##",
    ".##..##",
    "#######",
    "#######",
    ".....##",
    ".....##",
  ],
  "5": [
    "######",
    "######",
    "##....",
    "##....",
    "#####.",
    "######",
    "....##",
    "....##",
    "######",
    ".#####",
  ],
  "6": [
    "....##",
    "...###",
    "..###.",
    ".###..",
    "######",
    "######",
    "##..##",
    "##..##",
    "######",
    ".####.",
  ],
  "7": [
    "######",
    "######",
    "....##",
    "...###",
    "..###.",
    ".###..",
    "###...",
    "##....",
    "##....",
    "##....",
  ],
  "8": [
    ".####.",
    "######",
    "##..##",
    "##..##",
    ".####.",
    ".####.",
    "##..##",
    "##..##",
    "######",
    ".####.",
  ],
  "9": [
    ".####.",
    "######",
    "##..##",
    "##..##",
    "######",
    "######",
    "..###.",
    ".###..",
    "###...",
    "##....",
  ],
  "-": [
    "......",
    "......",
    "......",
    "......",
    ".####.",
    ".####.",
    "......",
    "......",
    "......",
    "......",
  ],
  " ": [
    "...",
    "...",
    "...",
    "...",
    "...",
    "...",
    "...",
    "...",
    "...",
    "...",
  ],
};

/** Blank columns between two glyphs. */
const GAP = 1;

/**
 * Compiles one glyph's bitmap into BANNER_ROWS rows of half-blocks, pairing pixel rows 2r and
 * 2r + 1 into text row r.
 *
 * It validates first and names what is wrong, because a bitmap is artwork: a row a column short, a
 * row too many, or a stray character is a retouch that went wrong, and the alternative to failing
 * here is a letter that is quietly a column narrower than its neighbours for the rest of the word.
 */
export function pixelsToRows(name: string, pixels: readonly string[]): string[] {
  if (pixels.length !== GLYPH_PIXEL_ROWS) {
    throw new Error(`banner glyph ${JSON.stringify(name)}: ${pixels.length} pixel rows, expected ${GLYPH_PIXEL_ROWS}`);
  }
  const width = pixels[0].length;
  if (width === 0) throw new Error(`banner glyph ${JSON.stringify(name)}: a glyph needs at least one column`);
  pixels.forEach((row, y) => {
    if (row.length !== width) {
      throw new Error(`banner glyph ${JSON.stringify(name)}: pixel row ${y} is ${row.length} wide, expected ${width}`);
    }
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== SET && row[x] !== CLEAR) {
        throw new Error(`banner glyph ${JSON.stringify(name)}: ${JSON.stringify(row[x])} at x${x} row ${y} is neither ${SET} nor ${CLEAR}`);
      }
    }
  });
  return Array.from({ length: BANNER_ROWS }, (_, r) => {
    const top = pixels[2 * r];
    const bottom = pixels[2 * r + 1];
    let line = "";
    for (let x = 0; x < width; x++) {
      const t = top[x] === SET;
      const b = bottom[x] === SET;
      line += t && b ? "█" : t ? "▀" : b ? "▄" : " ";
    }
    return line;
  });
}

/** The compiled letterforms. Built at load, so a malformed bitmap fails on import, not in a render. */
const LETTERS: Record<string, string[]> = Object.fromEntries(
  Object.entries(LETTER_PIXELS).map(([ch, pixels]) => [ch, pixelsToRows(ch, pixels)]),
);

/**
 * Rows are joined as they are, never padded to a common width: a glyph row that is a column short
 * must show up as ragged output, not be quietly absorbed.
 */
export function bannerArt(text: string): string[] {
  const glyphs = [...text.toUpperCase()].map((ch) => {
    // hasOwn, not a bare lookup: a plain object would answer "constructor" from its prototype.
    if (!Object.hasOwn(LETTERS, ch)) throw new Error(`banner cannot draw ${JSON.stringify(ch)}; add it to LETTER_PIXELS in src/banner.ts`);
    return LETTERS[ch];
  });
  return Array.from({ length: BANNER_ROWS }, (_, r) => glyphs.map((g) => g[r]).join(" ".repeat(GAP)));
}

export function bannerWidthCols(text: string): number {
  return [...bannerArt(text)[0]].length;
}

export function bannerPath(text: string, col: number, row: number): string {
  return artToPath(bannerArt(text), col, row);
}
