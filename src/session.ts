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
  /** Rows above the first rule: the prompt and the Mascot's band, with the blank rows between them. */
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
 * The contribution calendar is 53 week-columns by 7 day-rows, and the sweep's pitch is its own
 * rather than the text cell's (`src/scan.ts`): 14 units, which keeps the band the size it rendered
 * at before the Session went to 84 columns. Square cells, which is what GitHub's own calendar uses,
 * then want the same 14 units of height each, so 7 days is 98 units; at CELL_H = 24 that is just
 * over four rows. FIVE rows hold the sweep, with 22 units of slack split above and below it for the
 * beam's overhang. Cells of 14 x 24 would read as a bar chart instead of a grid, so the height
 * follows the width rather than the row pitch, and that squareness is what makes the fifth row
 * structural rather than padding: `src/scan.ts` refuses to load a band the grid does not fit in.
 *
 * The "N/365 days up" result line stays a text row of its own: a status colour is always paired
 * with a word, so the sweep needs its printed result.
 */
export const SCAN_ROWS = 5;

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
 * Where the shell prompt's command sits: after the sigil and the space following it. Derived, so a
 * different sigil carries the command with it instead of colliding with a written-down column.
 */
const OUTPUT_COL = [...PROMPT_SIGIL].length + 1;

/**
 * The column the Mascot's INK lands on, which is the Session's left margin.
 *
 * It was OUTPUT_COL, on the reasoning that a shell's output sits under the command that printed it.
 * The reasoning is sound and the result was wrong: the sprite and the startup block are the widest
 * thing on the page, so indenting them by four made the whole Header read as floating in from the
 * margin, while the `┌─`/`└─` prompt above it and every rule below it start at column 0. The
 * reference this grammar is borrowed from puts its startup banner flush against that margin.
 *
 * At 0 the Header shares one spine from its first row to its last. `mascotDefs` places the sprite by
 * its ink and not by its grid (it subtracts `MASCOT_INK_LEFT`), so this is the column the leftmost
 * painted pixel lands on rather than the column the art file's blank left edge starts at.
 */
const MASCOT_COL = 0;
/** Free columns between the Mascot's ink and the startup block printed beside it. */
const MASCOT_GAP = 2;
/** Columns where the body text starts, after the prompt glyph and a space. */
const BODY_COL = 2;
/** Where a language name or a tool label starts, under the result glyph. */
const LIST_COL = 5;
/**
 * Blank columns between the effort panel's columns: the gutter between the scale and the toggle pane,
 * which the pane divider is drawn inside.
 *
 * The owner's reference panel sets a 40px grid gap at a 12px font. A monospace cell at that size is
 * 12 x 0.6 = 7.2px wide, so 40px is 5.56 cells and six columns is that gap on this grid. It is the
 * gap and not a hand-picked indent, which is why the number is derived here rather than guessed.
 *
 * It is NOT the track's own indent any more; that is `TRACK_INDENT`, which is a different measurement
 * for a different relationship and used to borrow this one.
 */
const PANEL_GAP = 6;

/**
 * Columns the effort track is drawn in, whatever anything else on the panel says.
 *
 * THIS IS THE INVERSION THE OWNER CALLS E44, and the point of it is which way the dependency runs.
 * The track used to end at `toggleCol - PANEL_GAP`, and `toggleCol` was `COLS` less the toggle's own
 * width, so THE SCALE'S WIDTH WAS A FUNCTION OF THE TOGGLE'S WORDING: renaming `Ultrachill` to
 * anything longer silently shrank the scale, and the five levels lost a column each to a word that
 * has nothing to do with them. That is backwards. The scale is the panel's content and the toggle is
 * a secondary readout beside it, so the track declares its width here and the toggle pane takes
 * whatever is left of the row.
 *
 * 44, compared against 40 rendered at both widths and chosen by the owner. At 40 the five levels sit
 * on 8-column slots and `medium` and `xhigh`, which are six and five columns wide, leave one or two
 * blank columns between neighbours, so the scale reads as a list of words again, which is the exact
 * complaint the panel exists to answer. 44 gives 8.8-column slots and three to four blank columns
 * between levels, which is the reference's rhythm.
 *
 * Both guards below are errors rather than overflow, and both name their numbers: a track too narrow
 * for the levels, and a remaining pane too narrow for the toggle or its hint.
 */
const TRACK_COLS = 44;

/**
 * Blank columns between the heading word and the track block that follows it.
 *
 * The track is indented past `effortWord`, so a longer heading still pushes the scale along, and the
 * indent itself is two columns. It is NOT `PANEL_GAP`: that is the gutter BETWEEN the panel's columns,
 * and the heading sits on a row of its own above the scale rather than beside it, so the six-column
 * grid gap was never the right measure of the step from a heading to the block it heads. With the
 * track's width now fixed, six columns of indent also pushed the whole panel right for no reason.
 */
const TRACK_INDENT = 2;

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
 * THE STATUSLINE PANEL'S DIVIDER: the vertical between the effort scale and the toggle.
 *
 * It is the tree's own continuation mark, read off that constant rather than retyped, so the two
 * cannot drift apart. That is the whole argument for the glyph: the Session's structural alphabet is
 * already the Header prompt's `┌─`/`└─` and the /ops tree's `├─`/`└─`/`│`, so the plain light
 * vertical divides the two panes at the cost of no new vocabulary, where `┃`, `╎` or a box corner
 * would each be a mark a reader has to learn for a job this one already does.
 *
 * Without it the scale and the toggle share four rows with nothing but whitespace between them, and
 * the toggle reads as having drifted right rather than as occupying a pane of its own. That reading
 * got worse when the mode badge and the note were deleted: the panel is now the whole bottom of the
 * Session, so this is the only internal structure the last block on the page has.
 */
const PANE_DIVIDER = TREE_CONTINUE;
/**
 * Blank columns between the divider and the pane on either side of it.
 *
 * One, which is what `assertNoCollisions` already requires of any two runs that are not fragments of
 * one thing. It is named because the divider's column is DERIVED from it and from the toggle's own
 * column, so moving the toggle moves the divider instead of leaving it behind at a written-down 56.
 */
const PANE_CLEAR = 1;

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
  // THE TRACK'S WIDTH IS NOW FIXED (TRACK_COLS), so the levels are what has to fit it rather than
  // the other way round, and a scale that does not fit says so with its numbers. Checked before the
  // columns are computed, because the arithmetic below places a label that cannot fit just as
  // willingly as one that can, and `assertNoCollisions` would then report two overlapping words
  // without saying that the scale is the thing that is too wide.
  const needed = labels.reduce((w, label) => w + cells(label), 0) + (n - 1);
  if (needed > width) {
    throw new Error(`the ${n} effort levels ${JSON.stringify(labels.join(" "))} do not fit the track: they need ${needed} columns with one blank between each pair, and the track is ${width} (columns ${trackCol} to ${trackEnd})`);
  }
  const slot = width / n;
  const cols = labels.map((label, i) => Math.round(trackCol + slot * (i + 0.5) - cells(label) / 2));
  // And where they land, not only how wide they are. A long label on a narrow slot is placed past
  // its own slot's edges even when the total fits, so the ends of the track are checked too.
  const last = cols[n - 1] + cells(labels[n - 1]);
  if (cols[0] < trackCol || last > trackEnd) {
    throw new Error(`the effort levels run from column ${cols[0]} to ${last}, outside the ${width}-column track between ${trackCol} and ${trackEnd}`);
  }
  return cols;
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
 * figure, so the carry is the arithmetic's job rather than the glyph table's. The obvious
 * alternative, flooring to whole columns and rounding what is left over separately, hands the carry
 * to the table: 47% of 34 columns is 15.98, whose leftover rounds to an EIGHTH eighth, and at 41,
 * 44, 47, 91, 94 and 97 percent that arithmetic asks for a partial block the usual seven-glyph
 * table does not have. Measured, it reaches the same answer as this one only because the table here
 * happens to end in the full block, which is luck rather than a design, and `EIGHTHS` is a table of
 * eight for reasons that have nothing to do with rescuing it.
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

  // The Mascot, as the command's output, with its ink on the Session's left margin. `mascotDefs` is
  // told the same row and column, and places the sprite by that ink rather than by its grid.
  const mascotRow = rows.length;
  for (let r = 0; r < MASCOT_ROWS; r++) rows.push(blank());

  // THE STARTUP BLOCK, beside the Mascot, the way an agent CLI prints its own: sprite at the left
  // and three lines at its right. It is what fills the fifty columns the sprite leaves empty, and
  // since the role row was deleted it is the only thing in the Header that says anything in words.
  //
  // Its column is MEASURED, not chosen: the sprite's own column, plus its ink `MASCOT_INK_COLS`
  // wide, rounded up because half a column of overlap is overlap, plus the same two-column gap the
  // Session already uses beside the artwork. Retouching the art moves the text instead of quietly
  // colliding with it, and moving the sprite to the margin moved the block with it rather than
  // needing a constant edited to follow.
  const blockCol = MASCOT_COL + Math.ceil(MASCOT_INK_COLS) + MASCOT_GAP;
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
  // the two end on one floor and the blank row below closes both of them together.
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
  // The artwork fills its band to the last pixel: its ink reaches the bottom of the seventh row with
  // no margin of its own, so whatever is printed under it lands a couple of units away and the rack
  // reads as glued to it. One blank row is the margin the art does not carry, and it is KEPT now
  // that the rule rather than the role line is what follows: the clearance was never the role's.
  //
  // THE ROLE LINE IS GONE. It read "Offensive Security · Agentic AI Systems" and `/whoami`'s first
  // line reads "offensive security. agentic ai systems." four rows below it, so the Session said the
  // owner's discipline twice in two cases; a copy audit flagged the redundancy and it only became
  // more visible as the Header grew. The row also had nothing around it, sitting alone between the
  // startup block above and the rule below, which is what made it read as orphaned rather than as
  // the Header's closing statement. `/whoami` is where a session says who it belongs to.
  rows.push(blank());
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

  // ---- THE PANEL'S GEOMETRY, ALL OF IT, BEFORE A SINGLE ROW OF IT IS PUSHED ----
  //
  // The order is load-bearing rather than tidy. The toggle now sits on the TRACK's row and its hint
  // on the LEVELS row, so the runs that used to be built last, once every column they needed was
  // known, are needed by the first rows the panel pushes. Computing the columns here and pushing the
  // rows afterwards is the only arrangement in which nothing reads a value declared below it; two
  // attempts to lift the runs in place instead failed with "cannot access before initialization",
  // which is the shape of the problem rather than a typo.
  //
  // THE THREE COLUMNS. The reference builds them as `grid-template-columns: 1fr auto 1fr` with a
  // 40px gap: a heading column, the track block, and the toggle column. The reference's two outer
  // columns are `1fr` and therefore EQUAL, and that is the one thing not carried over: copied
  // literally it makes the heading column as wide as the toggle and leaves the five levels one blank
  // column between them in places, so the scale reads as a list of words rather than as a distributed
  // scale, which is the exact complaint this panel exists to answer. The reference's own panel is
  // about 136 character cells wide, so its proportions do not survive the trip to this grid; its
  // RHYTHM does, and three to four blank columns between levels is what it looks like.
  //
  // WHAT CHANGED IS WHICH WAY THE DEPENDENCY RUNS (TRACK_COLS, the owner's E44). The track declares
  // its own width and everything to its right follows from the track's end: the gap, then the
  // divider in it, then the toggle pane, which is simply whatever is left to the right edge. Before,
  // the track ended where the toggle's wording happened to leave it, so the scale shrank when the
  // joke got longer.
  const trackCol = cells(s.effortWord) + TRACK_INDENT;
  const trackEnd = trackCol + TRACK_COLS;
  const toggleCol = trackEnd + PANEL_GAP;
  // Immediately left of the toggle block, one clear column away from it, so the divider belongs to
  // the boundary rather than to either pane. Still derived, and still from the toggle's own column;
  // what the toggle's column is derived FROM is what changed, so the divider follows the track now.
  const dividerCol = toggleCol - (PANE_CLEAR + cells(PANE_DIVIDER));

  // THE TOGGLE PANE IS THE REMAINDER, and a remainder too small for what goes in it is an error with
  // its numbers named rather than a word drawn off the edge of the grid. Both lines of the pane are
  // checked, the toggle and the hint under it, because either can be the wider and `assertFits` would
  // only report the row it happened to overflow.
  const paneWidth = COLS - toggleCol;
  const toggleWidth = cells(s.toggle.word) + TOGGLE_GAP + cells(s.toggle.state);
  if (toggleWidth > paneWidth) {
    throw new Error(`the toggle ${JSON.stringify(`${s.toggle.word}  ${s.toggle.state}`)} needs ${toggleWidth} columns and the pane right of the ${TRACK_COLS}-column track has ${paneWidth} (columns ${toggleCol} to ${COLS})`);
  }
  if (cells(s.toggleHint) > paneWidth) {
    throw new Error(`the toggle's hint ${JSON.stringify(s.toggleHint)} needs ${cells(s.toggleHint)} columns and the pane right of the ${TRACK_COLS}-column track has ${paneWidth} (columns ${toggleCol} to ${COLS})`);
  }

  const tiers = s.effortLabels;
  const levelCols = effortLabelCols(tiers, trackCol, trackEnd);

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

  // THE TOGGLE, LIFTED TWO ROWS ONTO THE TRACK'S OWN ROW, with its hint on the levels row beneath it.
  //
  // It sat on the GLOSS row, the fourth of the pane's four, with the hint on a fifth row below the
  // panes entirely, and the owner's reading of that is exactly right: the right pane had sunk to the
  // bottom of a block whose own content started three rows higher, so `Ultrachill on` read as having
  // fallen off the scale rather than as sitting beside it. Level with the track it toggles, the two
  // panes start on the same floor and the eye pairs them.
  //
  // THIS IS A DELIBERATE DEPARTURE FROM THE REFERENCE, which puts its own toggle on the LABELS row,
  // one lower. The owner has looked at both rendered and prefers this one; it is recorded in
  // docs/spec.md so nobody corrects it back to the reference later.
  //
  // The word is drawn twice at one position. The base copy is split into one run per character, each
  // carrying its own point on a muted-to-accent ramp, so the word is A GRADIENT WITH NOTHING
  // RUNNING: that is the still frame, which is what a reduced-motion reader and most visitors ever
  // see. The second copy is the accent top of the same ramp at zero opacity, and the shimmer lifts
  // each character to it in turn, so the sheen now travels the ramp and dissolves into its bright
  // end instead of being the only thing that makes the word worth looking at.
  const { word, state } = s.toggle;
  const toggleRuns: Run[] = [];
  [...word].forEach((ch, i) => toggleRuns.push({
    col: toggleCol + i, text: ch, style: "accent-bold", cls: gradientClass(i), piece: PIECE_TOGGLE,
  }));
  [...word].forEach((ch, i) => toggleRuns.push({
    col: toggleCol + i, text: ch, style: "accent-bold", cls: shimmerClass(i),
  }));
  toggleRuns.push({ col: toggleCol + cells(word) + TOGGLE_GAP, text: state, style: "accent" });

  // ---- THE PANEL'S ROWS, now that every column in them is known ----
  //
  // THE SCALE'S OWN ROWS begin here. The divider spans exactly these, which is why the span is taken
  // from where they start and end rather than written down: the heading above them sits outside both
  // panes and the key hints below them run the full width under both.
  const paneFrom = rows.length;

  // The two ends of the axis, above the track: one flush with each end of it.
  rows.push({ runs: [
    { col: trackCol, text: s.effortEnds.start, style: "text" },
    { col: trackEnd - cells(s.effortEnds.end), text: s.effortEnds.end, style: "text" },
  ] });

  // The track, with the toggle beside it in the right pane.
  rows.push({ runs: [...track, ...toggleRuns] });

  // The levels, with the toggle's hint beside them. Both are affordances of a terminal the Session
  // DEPICTS rather than is: `❯ /whoami` is no more pressable than `Tab`, so printing them is part of
  // the fiction rather than a claim inside it.
  rows.push({ runs: [...levels, { col: toggleCol, text: s.toggleHint, style: "muted" }] });

  // ONE ROW OF AIR, INSIDE THE PANE, between the scale and the gloss. The owner's call, and the
  // reason is what the two things are: the two end labels, the track and the levels are ONE object,
  // a scale read top to bottom, and the gloss is a separate statement about a different control.
  // Butted together they read as a four-row block whose fourth row is an orphan; with a row between
  // them the scale is a unit and the gloss is its caption. The divider runs THROUGH this row, because
  // the row is inside the pane and a boundary that broke across a gap would read as two rules.
  rows.push(blank());

  // The owner's one-line gloss on the toggle, in the middle column. It is the only string in the
  // Session that describes what the viewer is literally watching, so it is the owner's and not the
  // generator's, and it is allowed to run past the track into the gap, which is why it is placed from
  // the track's left edge and only its collision with the divider is checked.
  rows.push({ runs: [{ col: trackCol, text: s.toggleNote, style: "muted" }] });

  // THE DIVIDER, down every row the two panes share and no others, placed last so the span is read
  // off the rows that were actually pushed rather than counted out in advance. That is what makes the
  // row of air above free: the gloss was the last pane row before and it still is, so the span grew
  // by itself when the blank went in.
  //
  // It carries the gloss row as well as the rows above it, which was decided by rendering both and
  // looking: the gloss is the longest line in the left pane and a divider that stopped at the levels
  // left it as the one row reaching across the boundary with nothing marking it, so the pane looked
  // as though it had sprung a leak at the bottom. Beside the full span the gloss reads as the left
  // pane's last line, and the divider closes the block it is in.
  //
  // `muted`, the same role the /ops tree's own verticals wear. `border` was the alternative and is
  // refused on a measurement rather than on taste: it is 2.79:1 on the dark window and 2.92:1 on the
  // light one, so a structural mark drawn in it would miss the 3:1 that WCAG 1.4.11 asks of exactly
  // this kind of element, and it is not a text role here at all (docs/spec.md 3.4 holds every text
  // role to 4.5:1, which `border` does not clear either). `muted` measures 5.65:1 and 4.77:1.
  for (let r = paneFrom; r < rows.length; r++) {
    rows[r].runs.push({ col: dividerCol, text: PANE_DIVIDER, style: "muted" });
  }

  rows.push(blank());
  // THE KEY HINTS CLOSE THE SESSION, and that is the whole Statusline now.
  //
  // There used to be one more row under this one, `▶▶ autopilot on` at the left margin and
  // `terminal-style design, not affiliated with Anthropic` flush right. Both are gone.
  //
  // The badge went because the reference does not show one here: running the effort command REPLACES
  // the statusline there, so the mode badge and the effort panel are never on screen at the same
  // instant. Drawing both put two unrelated readouts in the panel's last two rows, which is why the
  // bottom read as cramped and why the badge read as a row from somewhere else. The effort panel now
  // owns the bottom of the Session, which is what the reference actually looks like.
  //
  // The note went because of what it was measured to be: the ONLY occurrence of the word "Anthropic"
  // anywhere in the published profile. ADR 0002 forbids the marks and then mandated a line that spells
  // the name, so deleting it takes the profile from one mention to none and satisfies that ADR's own
  // rule more completely than keeping it did. ADR 0002 is amended with the owner's reasoning rather
  // than left contradicting this file; what still binds is unchanged and still holds here: no name, no
  // logo, no Claude orange, no copied verb list. What is borrowed is layout grammar.
  rows.push({ runs: [{ col: BODY_COL, text: s.help.join(` ${HELP_SEPARATOR} `), style: "muted" }] });

  // A Session that does not fit is not returned: the message names the row and its text.
  assertFits(rows);
  assertNoCollisions(rows);
  return { rows, headerRows, mascotRow, mascotCol: MASCOT_COL, scanRow, verbRow };
}
