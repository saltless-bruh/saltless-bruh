// Render the whole Session for looking at, before any real figures exist.
//
//   node scripts/preview-session.ts [outDir]          # defaults to preview/
//   node scripts/render-check.ts preview/session-dark.svg /tmp/f.png --freeze=0.4
//
// WHY THIS EXISTS, AND WHAT IT IS NOT.
//
// The real build (`npm run build`, src/build.ts) needs real activity: an authenticated fetch, or
// the committed cache a fetch has written. Until one has run it fails loudly, which is the
// behaviour docs/spec.md 5.3 requires and not a gap. That leaves the Session unlookable-at, and the
// playback, the Banner's reveal and the shimmer are all things that can only be judged by eye.
//
// So this script drives the REAL pipeline, `build()` itself, over a fixture GraphQL response. The
// figures it invents are invented, and that is exactly why it writes to preview/ (gitignored) and
// never to assets/, prints the fact on every run, and has no path into src/. Nothing in the
// generator knows it is here.
import { mkdtempSync } from "node:fs";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../src/build.ts";
import type { Transport } from "../src/activity.ts";
import { loadContent } from "../src/content.ts";

const DAY_MS = 86_400_000;
const today = new Date().toISOString().slice(0, 10);

/** 53 whole weeks ending today, with a plausible spread so the Scan Sweep has every level in it. */
function days(): { date: string; contributionCount: number }[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: 371 }, (_, i) => {
    const date = new Date(end - (370 - i) * DAY_MS);
    const weekday = date.getUTCDay();
    // Quiet weekends, a slow ramp over the year, and the odd burst.
    const base = weekday === 0 || weekday === 6 ? 0 : Math.floor(i / 60);
    return { date: date.toISOString().slice(0, 10), contributionCount: i % 23 === 0 ? base + 9 : base };
  });
}

const fixture: Transport = async (request) => {
  const content = loadContent();
  const user: Record<string, unknown> = {
    repositories: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: content.lanes.flatMap((l) => l.repos.map((r, i) => ({
        name: r.name,
        languages: { edges: [
          { size: 90_000 - i * 9_000, node: { name: "Python" } },
          { size: 40_000 + i * 3_000, node: { name: "Rust" } },
          { size: 21_000, node: { name: "TypeScript" } },
          { size: 12_000, node: { name: "Go" } },
          { size: 4_000, node: { name: "Shell" } },
        ] },
      }))),
    },
  };
  if (request.variables.withCalendar === true) {
    const d = days();
    user.contributionsCollection = {
      contributionCalendar: {
        totalContributions: d.reduce((s, x) => s + x.contributionCount, 0),
        weeks: Array.from({ length: Math.ceil(d.length / 7) }, (_, w) => ({ contributionDays: d.slice(w * 7, w * 7 + 7) })),
      },
    };
  }
  return JSON.stringify({ data: { user } });
};

const outDir = process.argv[2] === undefined
  ? new URL("../preview/", import.meta.url)
  : pathToFileURL(`${process.argv[2].replace(/\/?$/, "/")}`);

const result = await build({
  outDir,
  // A scratch cache, so a preview can never overwrite the committed figures.
  cachePath: pathToFileURL(join(mkdtempSync(join(tmpdir(), "preview-session-")), "activity.json")),
  transport: fixture,
  log: (m) => console.warn(m),
});

const dir = fileURLToPath(outDir);
for (const theme of ["dark", "light"]) {
  const path = join(dir, `session-${theme}.svg`);
  console.log(`${path}  ${(statSync(path).size / 1024).toFixed(1)} KB`);
}
console.log(`playback: ${result.playbackSeconds.toFixed(3)}s`);
console.log("the figures in these two files are FABRICATED, for looking at only. assets/ is written by npm run build.");
