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
 *
 * TWO WEAK PAIRS, KNOWINGLY SHIPPED. Both were read in a real 308px render and both are real;
 * neither letter appears in the handle this project draws, so no asset it ships contains one.
 * They are recorded here with their remedies so that fixing them is a short job rather than a
 * rediscovery, and so that nobody "improves" the alphabet by reaching for an option already ruled
 * out below.
 *
 * - 0 AGAINST O is the weakest pair. The corner treatment separates them at 846px and at 308px,
 *   but it is the only signal doing it. The fix is to widen the LETTER O to seven columns: width
 *   varies here already, for exactly this kind of reason (M and W at 9, Q at 8, N and 4 at 7),
 *   and only the digits need to align with each other, so widening O costs nothing and gives the
 *   pair two signals instead of one. Widening the DIGIT instead is the move to avoid, because
 *   that is the one that breaks digit alignment.
 *   Already ruled out, and not worth re-deriving: a slashed zero, because a two-pixel counter has
 *   no room for a slash at stem weight; and a dotted zero, because a dot inside a two-pixel
 *   counter touches both stems and turns the zero into a theta.
 * - U AGAINST V. V's taper begins late, so at 308px it reads nearer to U than it should. The fix
 *   is a deeper taper, and there is room for one precisely because V has no counter to pinch:
 *   start the arms moving inward higher up the glyph rather than in the last four pixel rows.
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

/**
 * The same drawing, split one path per letter, so the Banner's reveal can resolve the name letter
 * by letter. The union of these paths is `bannerPath`'s, subpath for subpath: a letter is never
 * horizontally adjacent to its neighbour, because GAP keeps a blank column between them, so no run
 * `artToPath` merges ever spans two letters and splitting the word cannot change what is drawn.
 *
 * GAP is MEASURED here rather than read, so that the letter columns stay in step with
 * `bannerWidthCols` by construction: the gap is whatever is left of the word's width once the
 * letters have taken theirs. Writing the spacing down a second time is the drift this avoids.
 */
export function bannerLetters(text: string, col: number, row: number): { ch: string; col: number; d: string }[] {
  const letters = [...text];
  if (letters.length === 0) throw new Error("the banner has no letters to draw");
  const widths = letters.map((ch) => bannerWidthCols(ch));
  const ink = widths.reduce((a, b) => a + b, 0);
  const gaps = letters.length - 1;
  const spare = bannerWidthCols(text) - ink;
  const gap = gaps === 0 ? 0 : spare / gaps;
  if (!Number.isInteger(gap) || gap < 0) {
    throw new Error(`the banner for ${JSON.stringify(text)} leaves ${spare} columns over ${gaps} gaps, which is not a whole gap per letter`);
  }
  let at = col;
  return letters.map((ch, i) => {
    const d = bannerPath(ch, at, row);
    at += widths[i] + gap;
    return { ch, col: at - widths[i] - gap, d };
  });
}
