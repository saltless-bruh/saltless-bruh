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
import { mascotCss, mascotDefs } from "./mascot.ts";
import { scanCss, scanDefs } from "./scan.ts";
import { rampCss } from "./ramp.ts";
import { renderReadme } from "./readme.ts";
import {
  playbackClass, playbackCss, playbackMarks, playbackSeconds,
  shimmerCss, spinnerCss, verbRuns, verbSchedule,
} from "./playback.ts";
import type { ThemeName } from "./tokens.ts";

const OUT_DIR = new URL("../assets/", import.meta.url);
const FONT_REGULAR = new URL("../vendor/JetBrainsMono-Regular.ttf", import.meta.url);
const FONT_BOLD = new URL("../vendor/JetBrainsMono-Bold.ttf", import.meta.url);

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
  /**
   * The Session as text, one line per row: every run but the `drawOnly` ones.
   *
   * **Nothing published reads this any more.** It was the README's `<details>` block, and that was
   * its only consumer anywhere in `src/`; the owner deleted the block on 2026-10-03 (ADR 0004,
   * third amendment). It is kept rather than dropped, and the reasons are stated here so the field
   * is not read as a leftover:
   *
   * - `rowsToText` is load-bearing regardless. `rowsToFullText`, which the ADR 0001 name gate
   *   reads, is built on it, so this is one call over rows the build already has in hand.
   * - It is the build's text output, and a caller is entitled to want it: the Landing Page, and a
   *   committed `TRANSCRIPT.md` if the owner ever asks for one, both start from exactly this.
   * - It is what `test/build.test.ts` reads to check that the owner's copy really reached the
   *   composed Session, and to find the column the spinner's drawn verbs are stacked at.
   *
   * What it must NOT be read as is a text alternative for the picture. There is no longer one in
   * the README; the accessible name is `content.readme.imageAlt` and it is the whole of it.
   */
  transcript: string;
  /** The README as written: the `<picture>` that swaps the variants, and nothing else. */
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
  const { rows, mascotRow, mascotCol, scanRow, verbRow } = session;

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

  // Returned, not published: the README's `<details>` block was its only consumer and it is gone.
  // `BuildResult.transcript` says why the field stays.
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
  const tiers = content.statusline.effortLabels;
  const toggleChars = [...content.statusline.toggle.word].length;
  const topTierChars = [...tiers[tiers.length - 1]].length;
  // Everything here is the same in both variants, so it is built once.
  const motion = [
    playbackCss(marks),
    spinnerCss(schedule),
    shimmerCss(toggleChars),
    mascotCss(),
    scanCss(),
  ].join("\n");

  const variants = {} as Record<ThemeName, string>;
  for (const theme of ["dark", "light"] as ThemeName[]) {
    // The two Statusline ramps are the one part of the stylesheet that is NOT shared: both are
    // computed from the variant's own `muted` and `accent`, so each file carries its own.
    const css = `${motion}\n${rampCss(theme, toggleChars, topTierChars)}`;
    // Two pieces of geometry, not three: the Banner was retired when the Header became a shell
    // prompt, and the Handle is now real text that `renderRows` draws like any other word.
    const defs = [
      mascotDefs(mascotCol, mascotRow, theme),
      scanDefs(activity, scanRow, theme),
    ].join("\n");
    const svg = await buildSvg({
      rows, theme, fontRegularB64, fontBoldB64, css, defs,
      rowClass: (row) => (scheduled.has(row) ? playbackClass(row) : undefined),
      // The picture's accessible name, for a client that reaches the SVG on its own rather than
      // through the README's `<img alt>`. It was the handle and the `role` field; `role` was deleted
      // for saying the same words as `/whoami`'s first line four rows above it, so this now reads
      // that line instead of a key kept alive only to feed an attribute. It is the same sentence
      // either way, and it comes from the one place the Session says it.
      title: `${content.handle}: ${content.whoami[0]}`,
    });
    variants[theme] = svg;
  }

  mkdirSync(outDir, { recursive: true });
  for (const theme of ["dark", "light"] as ThemeName[]) {
    writeFileSync(new URL(`session-${theme}.svg`, outDir), variants[theme]);
  }

  // The README is the one file a reader's screen reader and search engine actually read, so it
  // goes through the ADR 0001 gate on its own rather than being trusted because its parts were
  // checked: `imageAlt` cleared the gate as a content.json field, but a future addition here would
  // arrive inside neither that nor the rows. Checked before it is written, so a name never reaches
  // the disk in the first place. The transcript used to be the bulk of what this scanned; it is no
  // longer in the file, and it still clears the gate upstream as rows.
  const readme = renderReadme({ content });
  assertNoForbiddenNames(readme, "the generated README");
  writeFileSync(new URL("../README.md", outDir), readme);

  return {
    dark: variants.dark,
    light: variants.light,
    transcript,
    readme,
    staleNote: loaded.staleNote,
    // The Banner's stepped reveal used to run beside the playback and could outlast it, so this was
    // the later of the two. With the Banner retired the playback is the only thing a reader waits on.
    playbackSeconds: playbackSeconds(marks),
  };
}

if (import.meta.main) {
  const result = await build();
  console.log(`wrote assets/session-dark.svg, assets/session-light.svg and README.md; the playback lasts ${result.playbackSeconds.toFixed(2)}s`);
}
