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
// The freeze is applied to a COPY in a temp directory. The file named on the command line is never
// touched, so what is measured is the real artifact with one extra rule, not a different drawing.
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

let image = resolve(input);
if (freeze !== undefined) {
  const svg = readFileSync(image, "utf8");
  if (!svg.includes("</style>")) throw new Error(`${input} has no <style> to freeze; nothing in it is animated`);
  image = join(dir, "frozen.svg");
  writeFileSync(image, svg.replace(
    "</style>",
    `*{animation-delay:-${Number(freeze)}s!important;animation-play-state:paused!important}</style>`,
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
