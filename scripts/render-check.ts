// Usage: node scripts/render-check.ts <file.svg> <out.png> [--reduced] [--light] [--width=846]
// Renders the SVG through an <img> tag in headless Chrome, the way GitHub's README embeds it.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [, , input, out, ...flags] = process.argv;
if (!input || !out) {
  console.error("usage: node scripts/render-check.ts <file.svg> <out.png> [--reduced] [--light] [--width=846]");
  process.exit(2);
}
const width = Number(flags.find((f) => f.startsWith("--width="))?.slice(8) ?? 846);
const reduced = flags.includes("--reduced");
const canvas = flags.includes("--light") ? "#ffffff" : "#0d1117";

// The wrapper page must itself be a file: URL. A data: page has an opaque origin,
// and Chrome refuses to let it load a file: image, which yields a broken-image icon.
const dir = mkdtempSync(join(tmpdir(), "render-check-"));
const page = join(dir, "page.html");
writeFileSync(
  page,
  `<!doctype html><body style="margin:0;background:${canvas}">`
    + `<img src="${pathToFileURL(resolve(input)).href}" style="width:${width}px;display:block">`,
);

try {
  execFileSync("google-chrome-stable", [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    `--window-size=${width + 40},2400`, "--virtual-time-budget=6000",
    ...(reduced ? ["--force-prefers-reduced-motion"] : []),
    `--screenshot=${resolve(out)}`, pathToFileURL(page).href,
  ], { stdio: "inherit" });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`wrote ${out}`);
