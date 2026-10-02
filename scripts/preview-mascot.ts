// Build a standalone page that plays the Mascot live, in both Theme Variants,
// on the real master timeline. Open the output in a browser to watch it.
//
//   node scripts/preview-mascot.ts && xdg-open preview/mascot.html
//
// This is a developer preview, not a shipped asset. The published SVGs are
// written to assets/ by the build.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mascotDefs, mascotCss, MASCOT_COLS, MASCOT_ROWS } from "../src/mascot.ts";
import { buildSvg } from "../src/svg.ts";
import { subsetToBase64 } from "../src/font.ts";
import { MASCOT_TIMELINE, MASTER_SECONDS } from "../src/timeline.ts";
import { PALETTES, type ThemeName } from "../src/tokens.ts";

const regular = readFileSync(new URL("../vendor/JetBrainsMono-Regular.ttf", import.meta.url));
const bold = readFileSync(new URL("../vendor/JetBrainsMono-Bold.ttf", import.meta.url));

/** The Mascot alone, with enough rows to hold it and nothing else. */
async function mascotOnly(theme: ThemeName): Promise<string> {
  const chars = "x";
  return buildSvg({
    rows: Array.from({ length: MASCOT_ROWS }, () => ({ runs: [] })),
    theme,
    fontRegularB64: await subsetToBase64(regular, chars),
    fontBoldB64: await subsetToBase64(bold, chars),
    defs: mascotDefs(0, 0, theme),
    css: mascotCss(),
    title: "Lazie, a cat asleep on a server rack",
  });
}

const dark = await mascotOnly("dark");
const light = await mascotOnly("light");

const legend = MASCOT_TIMELINE
  .map((w) => `<tr><td>${w.state}</td><td>${w.from}s</td><td>${w.to}s</td><td>${(w.to - w.from).toFixed(2)}s</td></tr>`)
  .join("");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lazie Preview</title>
<style>
  :root { color-scheme: dark; --page: #0d1117; --ink: #e6edf3; --dim: #8b949e; --line: #30363d; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px 64px; background: var(--page); color: var(--ink);
         font: 14px/1.6 ui-sans-serif, system-ui, sans-serif; }
  .wrap { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.lede { margin: 0 0 28px; color: var(--dim); max-width: 70ch; }
  h2 { font-size: 14px; text-transform: none; margin: 32px 0 10px; color: var(--dim); font-weight: 600; }
  .canvas { padding: 20px; border: 1px solid var(--line); border-radius: 6px; }
  .on-dark { background: #0d1117; } .on-dimmed { background: #212830; } .on-white { background: #ffffff; }
  .canvas img { display: block; width: 100%; max-width: 846px; }
  .row { display: grid; gap: 14px; grid-template-columns: 1fr; }
  @media (min-width: 900px) { .row.two { grid-template-columns: 1fr 1fr; } }
  .narrow img { max-width: 308px; }
  table { border-collapse: collapse; font: 12px/1.5 ui-monospace, monospace; margin-top: 8px; }
  td, th { border: 1px solid var(--line); padding: 4px 10px; text-align: left; }
  th { color: var(--dim); font-weight: 500; }
  .note { color: var(--dim); font-size: 13px; margin: 6px 0 0; }
  kbd { font: 11px ui-monospace, monospace; border: 1px solid var(--line); border-radius: 3px; padding: 1px 5px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Lazie</h1>
  <p class="lede">The mascot playing live on its real ${MASTER_SECONDS}-second loop. She breathes throughout; the
  rare events are listed below. Reload the page to restart the loop from zero. If your system is set to reduce motion,
  she will hold the sleeping frame instead, which is the intended fallback.</p>

  <h2>Dark variant, on GitHub's dark canvas</h2>
  <div class="canvas on-dark"><img src="mascot-dark.svg" alt="Lazie, dark variant"></div>

  <h2>Dark variant, on GitHub's dimmed canvas</h2>
  <div class="canvas on-dimmed"><img src="mascot-dark.svg" alt="Lazie on the dimmed canvas"></div>

  <h2>Light variant, on GitHub's white canvas</h2>
  <div class="canvas on-white"><img src="mascot-light.svg" alt="Lazie, light variant"></div>

  <h2>At phone width (308px)</h2>
  <div class="row two">
    <div class="canvas on-dark narrow"><img src="mascot-dark.svg" alt="Lazie at phone width, dark"></div>
    <div class="canvas on-white narrow"><img src="mascot-light.svg" alt="Lazie at phone width, light"></div>
  </div>

  <h2>What happens when</h2>
  <table>
    <tr><th>pose</th><th>from</th><th>to</th><th>lasts</th></tr>
    ${legend}
  </table>
  <p class="note">The nose bubble inflates across the whole nap, the peek included, and pops exactly as
  <code>alert</code> begins. From <code>alert</code> to <code>recover</code> the three rack LEDs go
  <code>error</code> and flash in unison at 2.5Hz; after the headbutt they hold steady green for the
  <code>recover</code> beat and then go back to their own 7s, 11s and 13s clocks. The spinner in the finished
  profile names whichever pose is on screen.</p>
  <p class="note">To check the reduced-motion fallback, set your OS to reduce motion and reload, or run
  <kbd>node scripts/render-check.ts preview/mascot-dark.svg out.png --reduced</kbd>.</p>
</div>
</body>
</html>
`;

const outDir = new URL("../preview/", import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL("mascot-dark.svg", outDir), dark);
writeFileSync(new URL("mascot-light.svg", outDir), light);
writeFileSync(new URL("mascot.html", outDir), page);
console.log("wrote preview/mascot.html, preview/mascot-dark.svg, preview/mascot-light.svg");
console.log(`mascot is ${MASCOT_COLS} columns x ${MASCOT_ROWS} rows; dark svg ${(dark.length / 1024).toFixed(1)} KB, light ${(light.length / 1024).toFixed(1)} KB`);
console.log(`palette check: dark accent ${PALETTES.dark.accent}, light accent ${PALETTES.light.accent}`);
