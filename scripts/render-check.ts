// Usage: node scripts/render-check.ts <file.svg> <out.png> [--reduced] [--light] [--width=846] [--freeze=1.2] [--engine=chrome|firefox]
// Renders the SVG through an <img> tag in a headless browser, the way GitHub's README embeds it.
//
// BOTH ENGINES, BECAUSE THE WHOLE PROFILE RESTS ON ONE CSP. An <img>-embedded SVG is a separate
// document with scripts disabled, and its own <style> block runs only because the raw asset
// response carries `style-src 'unsafe-inline'` (docs/spec.md 1.1). Whether a given engine honours
// that the same way is not something a spec sheet settles, so `--engine` renders the identical
// frame through Chrome and through Firefox and the two PNGs are compared. What that comparison
// found is recorded in docs/spec.md 1.2.
//
// --freeze=<seconds> holds every animation at one instant of its own timeline, so a frame in the
// middle of a sweep can be looked at. It is the only reliable way to pick a frame here:
// --virtual-time-budget drives the wrapper page's clock, but an SVG inside <img> is a separate
// document whose animations do not follow it, and measured against a stepped reveal it selected
// frames non-monotonically and never reached the end state at all. A negative animation-delay with
// animation-play-state: paused is exact, because it is the animation's own clock being set.
//
// It is also what makes the two engines comparable at all, for a second reason: Chrome screenshots
// after --virtual-time-budget and Firefox screenshots on load, so an unfrozen pair compares two
// different instants and the diff is meaningless.
//
// A STAGGER NEEDS MORE THAN THE ONE RULE. An animation whose phase comes from its own
// `animation-delay` (the playback's row arrival, the Banner's per-letter reveal) is not frozen by a
// blanket `animation-delay:-Xs`: that rule REPLACES the stagger, so every row lands on the same
// instant and the cascade vanishes. Freezing at X means shifting every clock back by X, so each
// explicit delay D is rewritten to D - X as well. Without this the playback renders as fully
// arrived at any freeze past its reveal duration, which looks like a working frame and is not one.
//
// The freeze is applied to a COPY in a temp directory. The file named on the command line is never
// touched, so what is measured is the real artifact with a few extra rules, not a different drawing.
//
// Everything below the imports is a pure function plus one that writes a profile, and the CLI at the
// bottom is the only caller. That split is not tidiness: an engine flag that silently fell back to
// Chrome would make a cross-browser run compare Chrome against Chrome and report that the two agree,
// which is the shape of failure this whole script exists to catch. It is testable because it has to
// be. Tests in test/render-check.test.ts.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const USAGE = "usage: node scripts/render-check.ts <file.svg> <out.png> [--reduced] [--light] [--width=846] [--freeze=1.2] [--engine=chrome|firefox]";

/** The engines this can drive. Each is asked for reduced motion in its own way; see below. */
export const ENGINES = ["chrome", "firefox"] as const;
export type Engine = (typeof ENGINES)[number];

/** What one render needs to know, once the flags have been read. */
export type Shot = { engine: Engine; width: number; reduced: boolean; out: string; page: string };

/**
 * The engine named on the command line, or Chrome.
 *
 * An unrecognised name THROWS rather than falling back. A typo quietly resolving to the default
 * would run the whole cross-browser comparison on one engine and report agreement, which is worse
 * than no comparison at all because it looks like evidence.
 */
export function parseEngine(flags: string[]): Engine {
  const named = flags.find((f) => f.startsWith("--engine="))?.slice(9);
  if (named === undefined) return "chrome";
  if (!(ENGINES as readonly string[]).includes(named)) {
    throw new Error(`unknown engine ${JSON.stringify(named)}; expected one of ${ENGINES.join(", ")}`);
  }
  return named as Engine;
}

/**
 * Every rule that sets an explicit delay, re-stated with that delay shifted back by `at`.
 *
 * The delay in the `animation` shorthand is its SECOND <time>; the first is the duration. The
 * nested blocks inside `@keyframes` are skipped by construction, because a rule body here may not
 * contain a brace, and a keyframe's own `0% { ... }` carries no `animation:` of its own.
 *
 * These come after the blanket rule and are `!important` too, so the later declaration wins.
 */
export function shiftDelays(css: string, at: number): string {
  const out: string[] = [];
  for (const rule of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const [, selector, body] = rule;
    const shorthand = /animation:\s*([^;}]*)/.exec(body);
    const explicit = /animation-delay:\s*(-?[\d.]+)s/.exec(body);
    const times = shorthand === null ? [] : [...shorthand[1].matchAll(/(-?[\d.]+)s\b/g)].map((m) => Number(m[1]));
    const delay = explicit !== null ? Number(explicit[1]) : times.length >= 2 ? times[1] : null;
    if (delay === null) continue;
    out.push(`${selector.trim()}{animation-delay:${delay - at}s!important}`);
  }
  return out.join("");
}

/** The whole document with every clock wound back to `at` and paused there. */
export function freeze(svg: string, at: number, label: string): string {
  if (!svg.includes("</style>")) throw new Error(`${label} has no <style> to freeze; nothing in it is animated`);
  const style = /<style>([\s\S]*?)<\/style>/.exec(svg);
  if (style === null) throw new Error(`${label} has no <style> element to read the stagger out of`);
  return svg.replace(
    "</style>",
    `*{animation-delay:-${at}s!important;animation-play-state:paused!important}${shiftDelays(style[1], at)}</style>`,
  );
}

/**
 * The wrapper page: the asset inside an `<img>`, which is the context GitHub serves it in and the
 * one that makes the CSP in docs/spec.md 1.1 load-bearing.
 *
 * It must itself be a file: URL. A data: page has an opaque origin, and Chrome refuses to let it
 * load a file: image, which yields a broken-image icon rather than an error.
 */
export const wrapperPage = (image: string, width: number, canvas: string): string =>
  `<!doctype html><body style="margin:0;background:${canvas}">`
  + `<img src="${pathToFileURL(image).href}" style="width:${width}px;display:block">`;

/**
 * What Firefox's throwaway profile sets.
 *
 * Firefox has no reduced-motion command-line flag, so the request goes through
 * `ui.prefersReducedMotion`, the integer LookAndFeel pref behind the media feature. MDN documents
 * only the OS-level toggles and never names this pref, so it was confirmed against the actual
 * binary rather than taken from a doc page: a probe whose rule fires only under `reduce` rendered
 * green at 0 and red at 1 (Firefox 157.0, 2026-10-02).
 *
 * It is written unconditionally, 0 as well as 1. Writing it only for --reduced would leave the
 * other run on whatever the host's own setting happens to be, so a machine with reduced motion
 * enabled would render every frame reduced and the comparison would silently measure nothing.
 */
export const firefoxPrefs = (reduced: boolean): string =>
  `user_pref("ui.prefersReducedMotion", ${reduced ? 1 : 0});\n`;

/** Creates the throwaway profile and returns its path. A fresh one keeps the owner's own out of it. */
export function firefoxProfile(dir: string, reduced: boolean): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "user.js"), firefoxPrefs(reduced));
  return dir;
}

export const firefoxArgs = (s: Shot, profile: string): string[] => [
  "--headless", "--profile", profile,
  `--window-size=${s.width + 40},2400`,
  "--screenshot", resolve(s.out), pathToFileURL(s.page).href,
];

export const chromeArgs = (s: Shot): string[] => [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--window-size=${s.width + 40},2400`,
  // Lets the page settle (fonts, first paint). It does NOT select an animation frame: see the
  // note at the top of this file, and use --freeze for that.
  "--virtual-time-budget=6000",
  ...(s.reduced ? ["--force-prefers-reduced-motion"] : []),
  `--screenshot=${resolve(s.out)}`, pathToFileURL(s.page).href,
];

/** The binary and its arguments for one shot. `profileDir` is only read on the Firefox branch. */
export function command(s: Shot, profileDir: string): { bin: string; args: string[] } {
  return s.engine === "firefox"
    ? { bin: "firefox", args: firefoxArgs(s, firefoxProfile(profileDir, s.reduced)) }
    : { bin: "google-chrome-stable", args: chromeArgs(s) };
}

if (import.meta.main) {
  const [, , input, out, ...flags] = process.argv;
  if (!input || !out) {
    console.error(USAGE);
    process.exit(2);
  }
  let engine: Engine;
  try {
    engine = parseEngine(flags);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  const width = Number(flags.find((f) => f.startsWith("--width="))?.slice(8) ?? 846);
  const reduced = flags.includes("--reduced");
  const canvas = flags.includes("--light") ? "#ffffff" : "#0d1117";
  const at = flags.find((f) => f.startsWith("--freeze="))?.slice(9);

  const dir = mkdtempSync(join(tmpdir(), "render-check-"));
  const page = join(dir, "page.html");

  let image = resolve(input);
  if (at !== undefined) {
    image = join(dir, "frozen.svg");
    writeFileSync(image, freeze(readFileSync(resolve(input), "utf8"), Number(at), input));
  }
  writeFileSync(page, wrapperPage(image, width, canvas));

  try {
    const { bin, args } = command({ engine, width, reduced, out, page }, join(dir, "profile"));
    execFileSync(bin, args, { stdio: "inherit" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`wrote ${out} (${engine})`);
}
