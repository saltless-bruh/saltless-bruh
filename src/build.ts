// src/build.ts
//
// The build entrypoint: content and activity in, `assets/session-dark.svg`,
// `assets/session-light.svg` and `README.md` out. `npm run build` runs this file.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { assertNoForbiddenNames, assertRowsCarryNoForbiddenNames, loadContent } from "./content.ts";
import { loadActivity } from "./activity.ts";
import type { Transport } from "./activity.ts";
import { assertNoCollisions, composeSession } from "./session.ts";
import type { Activity } from "./session.ts";
import { assertFits, charsUsed, rowsToText } from "./rows.ts";
import { assertCovered, subsetToBase64 } from "./font.ts";
import { buildSvg } from "./svg.ts";
import { bannerLetters } from "./banner.ts";
import { mascotCss, mascotDefs } from "./mascot.ts";
import { scanCss, scanDefs } from "./scan.ts";
import { renderReadme } from "./readme.ts";
import {
  bannerLetterClass, bannerRevealCss, bannerRevealSeconds,
  playbackClass, playbackCss, playbackMarks, playbackSeconds,
  shimmerCss, spinnerCss, verbRuns, verbSchedule,
} from "./playback.ts";
import { PALETTES } from "./tokens.ts";
import type { ThemeName } from "./tokens.ts";

const OUT_DIR = new URL("../assets/", import.meta.url);
const FONT_REGULAR = new URL("../vendor/JetBrainsMono-Regular.ttf", import.meta.url);
const FONT_BOLD = new URL("../vendor/JetBrainsMono-Bold.ttf", import.meta.url);

/** Where the Mascot's scene sits: hard against the left edge of the Session's first row. */
const MASCOT_COL = 0;
const MASCOT_ROW = 0;

export type BuildOptions = {
  /**
   * Where the two SVGs go. The README is written one directory ABOVE this one and is deliberately
   * not separately settable, because its image paths are `assets/...` relative to itself: the two
   * only mean anything as a pair. A caller that could redirect the images and not the README would
   * write a README whose paths resolve to nothing, and the first version of this option did
   * exactly that, quietly writing the repository's own README.md during the test suite.
   */
  outDir?: URL;
  /**
   * The two seams the tests drive the real pipeline through, both of them the ones
   * `loadActivity` already owns. There is deliberately NO way to hand `build` an `Activity`:
   * a fixture would then have a path through production that skips the fetch, the parser and
   * the cache, and the build would be able to draw figures nobody measured.
   */
  cachePath?: URL;
  transport?: Transport;
  /** Where the build's own warnings go. Defaults to stderr. */
  log?: (message: string) => void;
};

export type BuildResult = {
  dark: string;
  light: string;
  transcript: string;
  /** The README as written: the `<picture>` that swaps the variants, and the transcript under it. */
  readme: string;
  /** Null when the figures came off the network. Otherwise their age and why they are not fresh. */
  staleNote: string | null;
  /** How long the playback lasts, in seconds, measured from the schedule that was emitted. */
  playbackSeconds: number;
};

export async function build(opts?: BuildOptions): Promise<BuildResult> {
  const outDir = opts?.outDir ?? OUT_DIR;
  const log = opts?.log ?? ((m: string) => console.warn(m));

  const content = loadContent();
  const repoNames = content.lanes.flatMap((l) => l.repos.map((r) => r.name));

  // `login` is the account the API is queried by; `handle` is the nickname the Banner draws and
  // would return no user. No token crosses this boundary: `loadActivity` reads PROFILE_GH_TOKEN
  // itself, and scrubs it out of anything it hands back.
  const loaded = await loadActivity({
    login: content.login,
    repoNames,
    cachePath: opts?.cachePath,
    transport: opts?.transport,
  });
  // Stale figures are used, because the alternative is a calendar of zeros, but they are never
  // passed off as fresh. The note goes on the build's own output and nowhere near the SVG: a
  // profile quietly ageing in place is exactly what this line exists to make visible.
  if (loaded.staleNote !== null) log(`warning: ${loaded.staleNote}`);
  const activity: Activity = loaded.activity;

  const session = composeSession(content, activity);
  const { rows, bannerCol, bannerRow, scanRow, verbRow } = session;

  // The spinner's drawn words. The column is read off the verb composeSession already placed on
  // that row rather than written down here, so the drawn verbs land exactly where the one the
  // transcript names does, and they follow it if it ever moves.
  const resting = rows[verbRow].runs.find((r) => r.textOnly);
  if (resting === undefined) throw new Error(`row ${verbRow} carries no transcript verb for the drawn ones to line up with`);
  const schedule = verbSchedule(content.verbs);
  rows[verbRow].runs.push(...verbRuns(schedule, resting.col));

  // Re-checked after the verbs were added, not assumed: a verb too long for the row, or one that
  // runs into the spinner glyph, fails the build here rather than overflowing the Session.
  assertFits(rows);
  assertNoCollisions(rows);
  // The ADR 0001 gate, over the complete projection of the rows. Never the transcript: a run the
  // picture draws but the transcript omits must not be able to hide a name from it.
  assertRowsCarryNoForbiddenNames(rows, "the composed Session");

  const transcript = rowsToText(rows);

  const regular = readFileSync(FONT_REGULAR);
  const bold = readFileSync(FONT_BOLD);
  const chars = charsUsed(rows);
  // Both faces, because either one can be asked to draw any of these characters and a face that
  // cannot would silently fall back to whatever the reader's browser has.
  assertCovered(regular, chars);
  assertCovered(bold, chars);
  const fontRegularB64 = await subsetToBase64(regular, chars);
  const fontBoldB64 = await subsetToBase64(bold, chars);

  const marks = playbackMarks(rows);
  // Only the rows the playback owns get its hook. A row left out of the schedule must not carry a
  // class with no rule behind it, and more to the point must not look as though it were scheduled.
  const scheduled = new Set(marks.map((m) => m.row));
  const letters = bannerLetters(content.handle, bannerCol, bannerRow);
  const css = [
    playbackCss(marks),
    bannerRevealCss(letters.length),
    spinnerCss(schedule),
    shimmerCss([...content.statusline.toggle.word].length),
    mascotCss(),
    scanCss(),
  ].join("\n");

  const variants = {} as Record<ThemeName, string>;
  for (const theme of ["dark", "light"] as ThemeName[]) {
    const banner = letters
      .map((l, i) => `<path class="${bannerLetterClass(i)}" d="${l.d}" fill="${PALETTES[theme].accent}"/>`)
      .join("\n");
    const defs = [
      mascotDefs(MASCOT_COL, MASCOT_ROW, theme),
      banner,
      scanDefs(activity, scanRow, theme),
    ].join("\n");
    const svg = await buildSvg({
      rows, theme, fontRegularB64, fontBoldB64, css, defs,
      rowClass: (row) => (scheduled.has(row) ? playbackClass(row) : undefined),
      title: `${content.handle}: ${content.role}`,
    });
    variants[theme] = svg;
  }

  mkdirSync(outDir, { recursive: true });
  for (const theme of ["dark", "light"] as ThemeName[]) {
    writeFileSync(new URL(`session-${theme}.svg`, outDir), variants[theme]);
  }

  // The README is the one file a reader's screen reader and search engine actually read, so it
  // goes through the ADR 0001 gate on its own rather than being trusted because its parts were
  // checked: the transcript cleared the gate as rows, and the two README strings cleared it as
  // content.json fields, but a future addition here would arrive inside neither. Checked before
  // it is written, so a name never reaches the disk in the first place.
  const readme = renderReadme({ content, transcript });
  assertNoForbiddenNames(readme, "the generated README");
  writeFileSync(new URL("../README.md", outDir), readme);

  return {
    dark: variants.dark,
    light: variants.light,
    transcript,
    readme,
    staleNote: loaded.staleNote,
    playbackSeconds: Math.max(playbackSeconds(marks), bannerRevealSeconds(letters.length)),
  };
}

if (import.meta.main) {
  const result = await build();
  console.log(`wrote assets/session-dark.svg, assets/session-light.svg and README.md; the playback lasts ${result.playbackSeconds.toFixed(2)}s`);
}
