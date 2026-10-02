// Usage: node scripts/render-check.ts <file.svg> <out.png> [--reduced] [--light] [--width=846] [--freeze=1.2]
// Renders the SVG through an <img> tag in headless Chrome, the way GitHub's README embeds it.
//
// --freeze=<seconds> holds every animation at one instant of its own timeline, so a frame in the
// middle of a sweep can be looked at. It is the only reliable way to pick a frame here:
// --virtual-time-budget drives the wrapper page's clock, but an SVG inside <img> is a separate
// document whose animations do not follow it, and measured against a stepped reveal it selected
// frames non-monotonically and never reached the end state at all. A negative animation-delay with
// animation-play-state: paused is exact, because it is the animation's own clock being set.
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
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [, , input, out, ...flags] = process.argv;
if (!input || !out) {
  console.error("usage: node scripts/render-check.ts <file.svg> <out.png> [--reduced] [--light] [--width=846] [--freeze=1.2]");
  process.exit(2);
}
const width = Number(flags.find((f) => f.startsWith("--width="))?.slice(8) ?? 846);
const reduced = flags.includes("--reduced");
const canvas = flags.includes("--light") ? "#ffffff" : "#0d1117";
const freeze = flags.find((f) => f.startsWith("--freeze="))?.slice(9);

// The wrapper page must itself be a file: URL. A data: page has an opaque origin,
// and Chrome refuses to let it load a file: image, which yields a broken-image icon.
const dir = mkdtempSync(join(tmpdir(), "render-check-"));
const page = join(dir, "page.html");

/**
 * Every rule that sets an explicit delay, re-stated with that delay shifted back by `at`.
 *
 * The delay in the `animation` shorthand is its SECOND <time>; the first is the duration. The
 * nested blocks inside `@keyframes` are skipped by construction, because a rule body here may not
 * contain a brace, and a keyframe's own `0% { ... }` carries no `animation:` of its own.
 *
 * These come after the blanket rule and are `!important` too, so the later declaration wins.
 */
function shiftDelays(css: string, at: number): string {
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

let image = resolve(input);
if (freeze !== undefined) {
  const svg = readFileSync(image, "utf8");
  if (!svg.includes("</style>")) throw new Error(`${input} has no <style> to freeze; nothing in it is animated`);
  const at = Number(freeze);
  const style = /<style>([\s\S]*?)<\/style>/.exec(svg);
  if (style === null) throw new Error(`${input} has no <style> element to read the stagger out of`);
  image = join(dir, "frozen.svg");
  writeFileSync(image, svg.replace(
    "</style>",
    `*{animation-delay:-${at}s!important;animation-play-state:paused!important}${shiftDelays(style[1], at)}</style>`,
  ));
}

writeFileSync(
  page,
  `<!doctype html><body style="margin:0;background:${canvas}">`
    + `<img src="${pathToFileURL(image).href}" style="width:${width}px;display:block">`,
);

try {
  execFileSync("google-chrome-stable", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    `--window-size=${width + 40},2400`,
    // Lets the page settle (fonts, first paint). It does NOT select an animation frame: see the
    // note at the top of this file, and use --freeze for that.
    "--virtual-time-budget=6000",
    ...(reduced ? ["--force-prefers-reduced-motion"] : []),
    `--screenshot=${resolve(out)}`, pathToFileURL(page).href,
  ], { stdio: "inherit" });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`wrote ${out}`);
