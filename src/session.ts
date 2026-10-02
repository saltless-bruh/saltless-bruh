import { COLS } from "./grid.ts";
import type { Content } from "./content.ts";
import { assertFits } from "./rows.ts";
import type { Row, Run } from "./rows.ts";
import { MASCOT_INK_COLS, MASCOT_ROWS } from "./mascot.ts";
import { MASCOT_TIMELINE } from "./timeline.ts";
// The window belongs to the module that trims the calendar to it. A second copy of it here
// could drift from that one with no test noticing, which is the BREATHS_PER_LOOP mistake exactly.
import { WINDOW_DAYS } from "./activity.ts";

export type Activity = {
  totalContributions: number;
  activeDays: number;
  calendar: { date: string; count: number }[];
  languages: { name: string; bytes: number }[];
};

export type Session = {
  rows: Row[];
  /** Rows above the first rule: the prompt, the Mascot's band and the role line. */
  headerRows: number;
  /** First of the MASCOT_ROWS rows held empty for the Mascot, and the column it is drawn at. */
  mascotRow: number;
  mascotCol: number;
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

/**
 * Row hook on the /activity result line. The Scan Sweep's result arrives after the beam has
 * crossed, so the motion layer needs to name that row; the row itself is drawn, present and
 * final without it, which is what a reduced-motion reader sees.
 */
export const SCAN_RESULT_CLASS = "scan-result";

/** Prefix of the per-character highlight hooks on the Statusline toggle: `shimmer-0`, `shimmer-1`, ... */
const SHIMMER_PREFIX = "shimmer-";
export const shimmerClass = (index: number): string => `${SHIMMER_PREFIX}${index}`;

/**
 * Per-character colour hooks for the two polychrome words in the Statusline. The colours themselves
 * are computed from the palette in `src/ramp.ts`; these are only the names the two sides agree on.
 *
 * `gradient-N` paints the toggle word's resting gradient, which is the STILL FRAME: a reduced-motion
 * reader sees the whole ramp and nothing else. `rainbow-N` paints the effort scale's top tier.
 */
export const gradientClass = (index: number): string => `gradient-${index}`;
export const rainbowClass = (index: number): string => `rainbow-${index}`;

/**
 * The shell prompt's own marks. Structural glyphs carrying no lexical content, so they are Session
 * Grammar and live here, by the same test that keeps the Handle, the host and the command in
 * `content.json` (docs/spec.md 4.1). `㉿`, the circled KA in Kali's own prompt, is absent from
 * JetBrains Mono (3.3), so `@` is the only spelling available and not a softened one.
 */
const PROMPT_OPEN = "┌─(";
const PROMPT_AT = "@";
const PROMPT_PATH_OPEN = ")-[";
const PROMPT_PATH_CLOSE = "]";
const PROMPT_SIGIL = "└─$";

/** The track's fragments, the prompt, and the two split words, each named so the check tells them apart. */
const PIECE_PROMPT = "shell-prompt";
const PIECE_TRACK = "effort-track";
const PIECE_TOP_TIER = "effort-top-tier";
const PIECE_TOGGLE = "statusline-toggle";

/**
 * What a spinner verb ends with. Exported so the motion layer, which draws one verb per
 * Mascot pose, spells them the same way as the verb the transcript names.
 */
export const VERB_SUFFIX = "…";

/**
 * Where the shell prompt's output lines up: under the COMMAND, not under the prompt's own sigil.
 *
 * Derived from the sigil plus the space after it, so a different sigil carries the Mascot and the
 * role line with it. That is where a shell's output sits relative to what produced it, and it is
 * what makes the Mascot read as something the command printed rather than as a picture placed there.
 */
const OUTPUT_COL = [...PROMPT_SIGIL].length + 1;
/** Free columns between the Mascot's ink and the startup block printed beside it. */
const MASCOT_GAP = 2;
/** Columns where the body text starts, after the prompt glyph and a space. */
const BODY_COL = 2;
/** Where a language name or a tool label starts, under the result glyph. */
const LIST_COL = 5;
/**
 * Blank columns between the effort panel's columns, and so the indent its track block sits at.
 *
 * The owner's reference panel sets a 40px grid gap at a 12px font. A monospace cell at that size is
 * 12 x 0.6 = 7.2px wide, so 40px is 5.56 cells and six columns is that gap on this grid. It is the
 * gap and not a hand-picked indent, which is why the number is derived here rather than guessed.
 */
const PANEL_GAP = 6;

/**
 * Blank columns between the toggle's word and the state it reads. The reference writes two
 * non-breaking spaces there, so the state reads as a value beside the word rather than as part of it.
 */
const TOGGLE_GAP = 2;

/**
 * What goes between two fragments of the panel's key-hint line. A mark rather than a word, so it is
 * Session Grammar and belongs here, exactly as the `·` on the /activity result line does
 * (docs/spec.md 4.1).
 */
const HELP_SEPARATOR = "·";
/** Columns between two things in a list that sit on the same row. */
const SPACING = 2;
const REPO_NAME_COL = 7;
const REPO_BLURB_COL = 9;

const cells = (s: string): number => [...s].length;
const blank = (): Row => ({ runs: [] });
const rule = (style: Run["style"] = "muted"): Row => ({ runs: [{ col: 0, text: "─".repeat(COLS), style }] });
const isHighlight = (r: Run): boolean => r.cls?.startsWith(SHIMMER_PREFIX) ?? false;

/**
 * THE /ops TREE. What `tree(1)` prints, so the hierarchy is drawn rather than left to be inferred
 * from an indent: `├─` for every repo but the last in its lane, `└─` for the last, and `│` carried
 * down the blurb row beneath a non-last repo. On the LAST repo that column is blank, and that
 * absence is what closes the branch.
 *
 * Every one of them comes from the repo's POSITION in its lane and from nothing else, so a lane
 * holding one repo gets `└─` for exactly the reason the last of seven does, and no field in
 * `content.json` can disagree with what is drawn.
 *
 * These are structural marks carrying no lexical content, so they are Session Grammar and live
 * here (docs/spec.md 4.1), and they are the alphabet the Header's own `┌─`/`└─` prompt already
 * spells: the Session gains no new vocabulary, which is what makes this terminal-native rather
 * than a decoration drawn to look like one.
 */
const TREE_BRANCH = "├─";
const TREE_LAST = "└─";
const TREE_CONTINUE = "│";
if (cells(TREE_BRANCH) !== cells(TREE_LAST)) {
  throw new Error(`the two /ops connectors must be the same width or the names under them do not line up: ${TREE_BRANCH} is ${cells(TREE_BRANCH)} and ${TREE_LAST} is ${cells(TREE_LAST)}`);
}
/**
 * Where a repo's connector is drawn: its name's column, back by the connector and the space after
 * it. Derived, so a wider connector moves itself left instead of running into the name.
 */
const REPO_TREE_COL = REPO_NAME_COL - (cells(TREE_BRANCH) + 1);

/**
 * Columns the language bar is drawn in at a full 100%, and the field the percentage beside it is
 * right-aligned in. `100%` is the widest figure that field can ever hold, and right-aligning is
 * what puts every `%` in one column while `<1%` still ends where `90%` does.
 *
 * The bar's width is a constant rather than whatever is left over between the longest language
 * name and the right margin: a figure whose drawn length changed with the longest name in the data
 * would mean 90% was a different length in two builds of the same profile.
 */
export const BAR_COLS = 34;
const PCT_COLS = 4;

/**
 * The eighth-block glyphs, one eighth through to eight eighths, all verified present in both faces
 * of JetBrains Mono (docs/spec.md 3.3). The full block is read off the end of this table rather
 * than written a second time, so the table is the single place the ramp is spelled.
 */
const EIGHTHS = "▏▎▍▌▋▊▉█";

/** What wraps one tool, so a row reads as a set of discrete things rather than as a list of words. */
const TAG_OPEN = "[";
const TAG_CLOSE = "]";
/** One column between two tags. The brackets already separate them, so SPACING would space them twice. */
const TAG_GAP = " ";

/**
 * The column a drawn word's own glyphs centre on.
 *
 * This is what the effort marker is placed from. An even-length word has no exact centre column, so
 * it takes the left of the two middle ones; what matters is that the number comes from the word's
 * own position and width and from nothing else.
 */
export const centreCol = (col: number, text: string): number => col + Math.round((cells(text) - 1) / 2);

/**
 * Where the effort scale's levels are drawn: the track is divided into `labels.length` slots of
 * equal width and each label is centred on its own slot, which is the five-column label grid of the
 * owner's reference and is what makes the track span the levels rather than merely sit near them.
 *
 * The slot width is kept FRACTIONAL and only the final column is rounded. Rounding each slot edge
 * first and centring inside the integer slot is the obvious alternative and it drifts: the rounding
 * error accumulates along the row and the last few labels sit visibly off their own slots.
 */
export function effortLabelCols(labels: string[], trackCol: number, trackEnd: number): number[] {
  const n = labels.length;
  const width = trackEnd - trackCol;
  if (n === 0) throw new Error("the effort scale has no levels to place");
  if (width < n) throw new Error(`${n} effort levels do not fit in the ${width} columns between ${trackCol} and ${trackEnd}`);
  const slot = width / n;
  return labels.map((label, i) => Math.round(trackCol + slot * (i + 0.5) - cells(label) / 2));
}

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
 * One language's bar: `width` columns at a full 100%, drawn to the nearest EIGHTH of a column.
 *
 * The eighth blocks are what make the drawing worth having. A bar rounded to whole columns can only
 * say 34 things, so at this width 3% and 5% are the same picture; an eighth is 0.37 of a point here,
 * so the length a reader sees IS the figure printed beside it.
 *
 * And it is taken from that printed WHOLE PERCENTAGE rather than from the raw byte share, so the
 * two can never disagree. A bar drawn from the bytes beside a number rounded from them would differ
 * by up to half a point, which is a figure nobody computed wearing the shape of a measurement
 * (docs/spec.md 3.6).
 *
 * THE ROUNDING HAPPENS ONCE, IN EIGHTHS, and the whole blocks are the whole part of that one
 * figure. The obvious alternative, flooring to whole columns and rounding what is left over
 * separately, is wrong exactly where no eye can check it: 47% of 34 columns is 15.98, whose
 * leftover rounds to a ninth eighth, so that arithmetic emits either a 35th cell or a glyph one
 * past the end of the table. Carrying is not a special case here; it is what `/ 8` already does.
 */
export function languageBar(pct: number, width: number = BAR_COLS): string {
  const eighths = Math.round((pct / 100) * width * 8);
  const full = Math.floor(eighths / 8);
  const part = eighths % 8;
  return EIGHTHS[EIGHTHS.length - 1].repeat(full) + (part === 0 ? "" : EIGHTHS[part - 1]);
}

/**
 * How a share is printed. A language whose share rounds away is `<1%`, never `0%`.
 *
 * The owner keeps these rows rather than cutting them, and the pair of an empty bar and `<1%` says
 * what is true of them: present, and too small to draw. `0%` beside the same empty bar reads as a
 * language that failed to measure, which an earlier copy audit flagged, and it is also the one
 * reading that is false.
 *
 * With no bytes at all there is nothing present to be tiny, so that stays `0%`: `<1%` is a claim
 * about something being there.
 */
export const pctLabel = (pct: number, bytes: number): string => (pct === 0 && bytes > 0 ? "<1%" : `${pct}%`);

/**
 * `assertFits` measures only where a row ends, so two runs placed on top of one another, or
 * butted together so they read as one word, would pass it.
 *
 * Each of the Session's two faces is checked on its own, because a run can only collide with
 * what is shown beside it: the picture is every run but the `textOnly` ones, the transcript is
 * every run but the `drawOnly` ones. A word the Banner draws as art may therefore share columns
 * with the glyphs the motion layer stacks there, since the two are never on screen together.
 * A highlight copy is meant to lie over its word and is skipped in both faces; its word is
 * still checked.
 *
 * A set of alternatives at one position, which only the motion layer's clock keeps apart, says
 * so by sharing a `layer` name, and then collides with everything except its own group. Every
 * pair is compared rather than only neighbours, because skipping a pair inside a layer could
 * otherwise hide the collision between its longest member and the run after it.
 *
 * Fragments of one drawn thing say so by sharing a `piece` name, and are then allowed to touch,
 * because a track broken by its marker and a word split so each character can carry its own colour
 * are both one thing wearing several runs. They are still refused if they OVERLAP, which is the
 * part that keeps the exemption from being a hole: a split word whose runs were free to sit on top
 * of one another could spell something other than what the transcript reads.
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
        for (let j = 0; j < k; j++) {
          const prev = runs[j];
          const next = runs[k];
          // Two alternatives are never shown together. An empty name forms no group, so a layer
          // that came out blank exempts nothing instead of quietly exempting everything.
          if (prev.layer && prev.layer === next.layer) continue;
          // Fragments of one thing may touch; a blank column is required of everything else.
          const gap = prev.piece && prev.piece === next.piece ? 0 : 1;
          if (prev.col + cells(prev.text) + gap > next.col) {
            const why = gap === 0 ? "they overlap" : "they need a blank column between them";
            throw new Error(`row ${i} in ${face}: ${JSON.stringify(prev.text)} runs into ${JSON.stringify(next.text)}; ${why}`);
          }
        }
      }
    }
  });
}

export function composeSession(c: Content, a: Activity): Session {
  // THE HEADER IS A SHELL PROMPT, and the Mascot is what that prompt's command printed.
  //
  // It used to be a block-art wordmark beside the Mascot. Looked at live, the two competed: same
  // blocks, same Accent, same weight, so they read as two drawings rather than as one picture, and
  // the wordmark floated at a column that was not a margin while every rule below ran to the grid's
  // edge. Repositioning it did not help, because where it sat was not the problem.
  //
  // This is the Kali Linux prompt, which anyone in offensive security recognises on sight, so the
  // Header says what the owner does without a word about it. It also fixes what the wordmark could
  // not: a wordmark is decoration dressed as a terminal, while a prompt IS a terminal, so the name
  // stops being an object that has to justify itself and becomes the one place a name structurally
  // belongs in a shell. The cat then reads as what the command printed, which is the first thing in
  // this design to explain why there is a cat at all, and `❯ /whoami` below reads as an agent CLI
  // running inside that shell, which is literally what the picture shows.
  //
  // `㉿`, the circled KA in Kali's own prompt, is ABSENT from JetBrains Mono, so `@` is the only
  // option rather than a compromise. Every glyph here was checked against the real font.
  //
  // The path is the login with a `~/` in front of it, and there is no separate working-directory
  // row any more: a path printed in the prompt and again on its own line is the same fact twice.
  const head: Run[] = [];
  let at = 0;
  const part = (text: string, style: Run["style"]): void => {
    head.push({ col: at, text, style, piece: PIECE_PROMPT });
    at += cells(text);
  };
  // Chrome in `muted`, the Handle in the Accent, the host and the path in `text`. NOT `error` or
  // `warning` on the host, however authentic a red root prompt is: both tokens already carry a
  // meaning here and one colour means one thing (`tui-design`). The fragments share a piece, so
  // they may sit shoulder to shoulder while the row still collides normally with anything else.
  part(PROMPT_OPEN, "muted");
  part(c.handle, "accent");
  part(PROMPT_AT, "muted");
  part(c.prompt.host, "text");
  part(PROMPT_PATH_OPEN, "muted");
  part(`~/${c.login}`, "text");
  part(PROMPT_PATH_CLOSE, "muted");
  const rows: Row[] = [{ runs: head }];
  rows.push({ runs: [
    { col: 0, text: PROMPT_SIGIL, style: "muted", piece: PIECE_PROMPT },
    { col: OUTPUT_COL, text: c.prompt.command, style: "text", piece: PIECE_PROMPT },
  ] });
  rows.push(blank());

  // The Mascot, as the command's output. It lines up with the COMMAND and not with the prompt's own
  // column, because that is where a shell's output lines up with what produced it. `mascotDefs` is
  // told the same row and column.
  const mascotRow = rows.length;
  for (let r = 0; r < MASCOT_ROWS; r++) rows.push(blank());

  // THE STARTUP BLOCK, beside the Mascot, the way an agent CLI prints its own: sprite at the left
  // and three lines at its right. It is what fills the fifty columns the sprite leaves empty, and it
  // is voice rather than fact, which is why the role row below it stays.
  //
  // Its column is MEASURED, not chosen: the sprite's ink is `MASCOT_INK_COLS` wide, rounded up
  // because half a column of overlap is overlap, plus the same two-column gap the Session already
  // uses beside the artwork. Retouching the art moves the text instead of quietly colliding with it.
  const blockCol = OUTPUT_COL + Math.ceil(MASCOT_INK_COLS) + MASCOT_GAP;
  const block: Run[][] = [
    [
      { col: blockCol, text: c.handle, style: "accent" },
      // v0x7A69 is 31337 in decimal. It is that number for that reason and not a round one, so it
      // is not a version string to tidy into v1.0.0.
      { col: blockCol + cells(c.handle) + SPACING, text: c.startup.version, style: "muted" },
    ],
    [
      // `red` IS THE ONE PLACE A STATUS TOKEN IS SPENT ON A JOKE, and it is deliberate. `red cat`
      // puns on `red hat`, which puns on `red team`, which is what the owner does, so drawing the
      // word in the actual red makes the pun visual as well as verbal. The usual objection, that
      // `error` means a fault everywhere else here, does not bite: the word IS "red", so a reader
      // parses it as the colour being named and not as a state. Measured against both windows, it
      // clears the same 4.5:1 every other text role does. Do not "correct" this to `muted`.
      { col: blockCol, text: c.startup.colourWord, style: "error" },
      { col: blockCol + cells(c.startup.colourWord) + 1, text: c.startup.model, style: "muted" },
    ],
    [{ col: blockCol, text: c.startup.status, style: "muted" }],
  ];
  // GROUNDED on the Mascot's band: the block's last line sits level with the sprite's last row, so
  // the two end on one floor and the blank row and the role line below close both of them together.
  //
  // It was centred on the band until it was rendered both ways and looked at, which is what the
  // brief asked for and had not been done. Centred reads high, and the artwork says why: the band's
  // top two rows carry 47 of the sprite's 818 ink pixels, because up there the scene is a narrow cat
  // and two wisps of a dream bubble, while the rack below is a full-width slab. The ink's own
  // centroid is 4.35 rows down a 7-row band, so a block centred on the BAND sits a row and a third
  // above the centre of the thing it is beside, and the whole lower right of the sprite is left
  // empty. Grounded, the three lines land one per rack unit, the air that is left goes to the top
  // right where the dream bubble already floats, and the block gains a rule a reader can see
  // instead of a midpoint only the arithmetic knows about.
  const blockRow = mascotRow + MASCOT_ROWS - block.length;
  block.forEach((runs, i) => rows[blockRow + i].runs.push(...runs));
  // The artwork fills its band to the last pixel: its ink reaches the bottom of the seventh row
  // with no margin of its own, and the role line's cap height starts a couple of units under that,
  // so the rack reads as glued to the text. One blank row is the margin the art does not carry.
  rows.push(blank());
  rows.push({ runs: [{ col: OUTPUT_COL, text: c.role, style: "bold" }] });
  const headerRows = rows.length;
  rows.push(rule());

  const command = (name: string): void => {
    rows.push({ runs: [{ col: 0, text: "❯", style: "accent" }, { col: BODY_COL, text: name, style: "bold" }] });
  };
  const bullet = (text: string): void => {
    rows.push({ runs: [{ col: 0, text: "●", style: "accent" }, { col: BODY_COL, text, style: "text" }] });
  };
  const result = (text: string, style: Run["style"] = "text", cls?: string): void => {
    rows.push({ runs: [{ col: BODY_COL, text: "╰", style: "muted" }, { col: LIST_COL, text, style }], cls });
  };

  command("/whoami");
  for (const line of c.whoami) bullet(line);
  rows.push(blank());

  command("/ops");
  for (const lane of c.lanes) {
    result(lane.label, "accent");
    lane.repos.forEach((repo, i) => {
      // DERIVED FROM THE POSITION, never written down beside the repo: the last one in the lane
      // closes the branch and every other one carries it on, which is true of a lane of one as
      // much as of a lane of seven.
      const last = i === lane.repos.length - 1;
      rows.push({ runs: [
        { col: REPO_TREE_COL, text: last ? TREE_LAST : TREE_BRANCH, style: "muted" },
        { col: REPO_NAME_COL, text: repo.name, style: "text" },
      ] });
      // A name and its description share a row only if the description fits in what the
      // name leaves, which no useful sentence does. Two rows also read like real command output.
      //
      // The lane's own line continues down past the description, because the branch is not over
      // until the next name; under the LAST repo there is nothing left to continue to, and that
      // blank column is what the eye reads as the end of the lane.
      const blurb: Run[] = last ? [] : [{ col: REPO_TREE_COL, text: TREE_CONTINUE, style: "muted" }];
      blurb.push({ col: REPO_BLURB_COL, text: repo.blurb, style: "muted" });
      rows.push({ runs: blurb });
    });
  }
  rows.push(blank());

  command("/stack");
  // Largest first, on a copy: the caller's activity is not reordered. The sorted list is kept
  // beside the shares, because the `<1%` rule needs to know whether a share that rounded away had
  // any bytes behind it at all.
  const sorted = [...a.languages].sort((x, y) => y.bytes - x.bytes);
  const shares = languageShares(sorted);
  const barCol = LIST_COL + Math.max(0, ...shares.map((s) => cells(s.name))) + SPACING;
  // The figure is right-aligned at the far end of the bar's own field, so every `%` lands in one
  // column whatever the digits before it, and `<1%` ends where `90%` does instead of starting there.
  const pctEnd = barCol + BAR_COLS + SPACING + PCT_COLS;
  shares.forEach((s, i) => {
    const bar = languageBar(s.pct);
    const pct = pctLabel(s.pct, sorted[i].bytes);
    const runs: Run[] = [{ col: LIST_COL, text: s.name, style: "text" }];
    // A share that rounds away draws no bar rather than an empty run: an element with nothing in
    // it is still an element, and the blank beside `<1%` is the whole point of keeping the row.
    if (bar !== "") runs.push({ col: barCol, text: bar, style: "accent" });
    runs.push({ col: pctEnd - cells(pct), text: pct, style: "muted" });
    rows.push({ runs });
  });
  const itemsCol = LIST_COL + Math.max(0, ...c.stackRows.map((r) => cells(r.label))) + SPACING;
  for (const row of c.stackRows) {
    const runs: Run[] = [];
    // A continuation row keeps its blank label and its items stay in the one column, so a row that
    // ran on reads as the row above it carrying on rather than as a row of its own.
    if (row.label !== "") runs.push({ col: LIST_COL, text: row.label, style: "muted" });
    // Bracketed, so a row of tools reads as a set of discrete things. Two words separated by spaces
    // read as prose, and `peass-ng pspy` is then one tool or two depending on the reader.
    runs.push({ col: itemsCol, text: row.items.map((i) => `${TAG_OPEN}${i}${TAG_CLOSE}`).join(TAG_GAP), style: "text" });
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
    SCAN_RESULT_CLASS,
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
  // ---- the Statusline, built as a PANEL rather than as a line ----
  //
  // The accent rule is the panel's top border and the blank row under it is its padding: the
  // reference builds the same shape from a 2px accent border, 14px of padding and a three-column
  // grid with 40px gaps. One cramped row with the scale at one margin and the toggle at the other is
  // what this replaces, and the five extra rows are the cost of it not reading as cramped.
  const s = c.statusline;
  rows.push(rule("accent"));
  rows.push(blank());

  // The heading, far left and on a row of its own.
  rows.push({ runs: [{ col: 0, text: s.effortWord, style: "accent" }] });

  // THE THREE COLUMNS. The reference builds them as `grid-template-columns: 1fr auto 1fr` with a
  // 40px gap: a heading column, the track block, and the toggle column. Each outer column here is
  // its own content's width and the track is everything between them less one gap at each side, so
  // nothing below is a chosen column number. Change the toggle's wording, the heading or the gap
  // and the whole panel re-lays itself.
  //
  // The reference's two outer columns are `1fr` and therefore EQUAL, and that is the one thing not
  // carried over. Copied literally it makes the heading column as wide as the toggle, which on 72
  // columns leaves the track 32 and the five levels one blank column between them in places: the
  // scale then reads as a list of words rather than as a distributed scale, which is the exact
  // complaint this panel exists to answer. The reference's own panel is about 136 character cells
  // wide, so its proportions do not survive the trip to 72; its RHYTHM does, and three to four
  // blank columns between levels is what it looks like. Rendered at 846px and 308px both ways.
  // The right column holds two lines, the toggle and the hint under it, left-aligned with each
  // other and the block flush with the Session's right edge. Its width is therefore the wider of
  // the two and not the toggle's alone: a hint longer than the toggle would otherwise be placed
  // from the toggle's column and run off the grid.
  const toggleWidth = cells(s.toggle.word) + TOGGLE_GAP + cells(s.toggle.state);
  const toggleCol = COLS - Math.max(toggleWidth, cells(s.toggleHint));
  const trackCol = cells(s.effortWord) + PANEL_GAP;
  const trackEnd = toggleCol - PANEL_GAP;
  const tiers = s.effortLabels;
  const levelCols = effortLabelCols(tiers, trackCol, trackEnd);

  // The two ends of the axis, above the track: one flush with each end of it.
  rows.push({ runs: [
    { col: trackCol, text: s.effortEnds.start, style: "text" },
    { col: trackEnd - cells(s.effortEnds.end), text: s.effortEnds.end, style: "text" },
  ] });

  // THE MARKER IS PLACED FROM THE SELECTED LEVEL'S OWN COLUMN, never from the track's midpoint.
  // The shipped scale selects its LAST level and an earlier one selected the middle of five, so a
  // midpoint or a written-down column would have looked correct for one of those and been silently
  // wrong for the other. `effortSelected` is validated to be one of the labels, so the index is real.
  const chosen = tiers.indexOf(s.effortSelected);
  const markerCol = centreCol(levelCols[chosen], tiers[chosen]);
  const track: Run[] = [{ col: markerCol, text: "▲", style: "accent", piece: PIECE_TRACK }];
  if (markerCol > trackCol) {
    track.unshift({ col: trackCol, text: "─".repeat(markerCol - trackCol), style: "muted", piece: PIECE_TRACK });
  }
  if (trackEnd > markerCol + 1) {
    track.push({ col: markerCol + 1, text: "─".repeat(trackEnd - markerCol - 1), style: "muted", piece: PIECE_TRACK });
  }
  rows.push({ runs: track });

  // The levels. The selected one is accent and bold, the rest muted. The brackets are gone: the
  // marker above is a SHAPE carrying the selection, so colour is not doing it alone, and a bracketed
  // label would also make the scale's own spacing depend on which level happened to be picked.
  //
  // The TOP TIER is drawn as a rainbow, one run per character so each can carry its own hue. It is
  // the top of the scale that earns that, not the selection, so it keeps the rainbow when something
  // else is picked and the selection stays carried by the bold weight and the marker.
  const levels: Run[] = [];
  tiers.forEach((label, i) => {
    const picked = i === chosen;
    if (i === tiers.length - 1) {
      [...label].forEach((ch, k) => levels.push({
        col: levelCols[i] + k, text: ch,
        style: picked ? "accent-bold" : "accent", cls: rainbowClass(k), piece: PIECE_TOP_TIER,
      }));
    } else {
      levels.push({ col: levelCols[i], text: label, style: picked ? "accent-bold" : "muted" });
    }
  });
  rows.push({ runs: levels });

  // The toggle, in the right column where the reference puts it, with the owner's one-line gloss on
  // it in the middle column beside it. OFF the scale's row deliberately: sharing one row is what
  // made the scale and the toggle both read as cramped. The gloss is the only string in the Session
  // that describes what the viewer is literally watching, so it is the owner's and not the
  // generator's, and it is allowed to run past the track into the gap, which is why it is placed
  // from the track's left edge and only its collision with the toggle is checked.
  //
  // The word is drawn twice at one position. The base copy is split into one run per character, each
  // carrying its own point on a muted-to-accent ramp, so the word is A GRADIENT WITH NOTHING
  // RUNNING: that is the still frame, which is what a reduced-motion reader and most visitors ever
  // see. The second copy is the accent top of the same ramp at zero opacity, and the shimmer lifts
  // each character to it in turn, so the sheen now travels the ramp and dissolves into its bright
  // end instead of being the only thing that makes the word worth looking at.
  const { word, state } = s.toggle;
  const closing: Run[] = [{ col: trackCol, text: s.toggleNote, style: "muted" }];
  [...word].forEach((ch, i) => closing.push({
    col: toggleCol + i, text: ch, style: "accent-bold", cls: gradientClass(i), piece: PIECE_TOGGLE,
  }));
  [...word].forEach((ch, i) => closing.push({
    col: toggleCol + i, text: ch, style: "accent-bold", cls: shimmerClass(i),
  }));
  closing.push({ col: toggleCol + cells(word) + TOGGLE_GAP, text: state, style: "accent" });
  rows.push({ runs: closing });

  // The toggle's hint, directly beneath it in the same column, and then the key hints for the panel
  // as a whole. Both are affordances of a terminal the Session DEPICTS rather than is: `❯ /whoami`
  // is no more pressable than `Tab`, so printing them is part of the fiction rather than a claim
  // inside it. Assembled from labelled fragments with the generator supplying the separator, which
  // is the rule docs/spec.md 4.1 sets for a sentence made of several pieces of copy.
  rows.push({ runs: [{ col: toggleCol, text: s.toggleHint, style: "muted" }] });
  rows.push(blank());
  rows.push({ runs: [{ col: BODY_COL, text: s.help.join(` ${HELP_SEPARATOR} `), style: "muted" }] });

  rows.push({ runs: [
    { col: 0, text: `▶▶ ${s.modeBadge}`, style: "muted" },
    { col: COLS - cells(s.note), text: s.note, style: "muted" },
  ] });

  // A Session that does not fit is not returned: the message names the row and its text.
  assertFits(rows);
  assertNoCollisions(rows);
  return { rows, headerRows, mascotRow, mascotCol: OUTPUT_COL, scanRow, verbRow };
}
