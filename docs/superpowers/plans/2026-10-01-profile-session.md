# Profile Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the `saltless-bruh/saltless-bruh` Profile README as two animated SVGs (dark and light) that render a 72-column terminal Session, refreshed daily from real GitHub data.

**Architecture:** A TypeScript generator run directly by Node 26 (no build step) reads design tokens, a user-owned `content.json` and cached GitHub data, then emits `assets/session-{dark,light}.svg` and `README.md`. Session text is `<text>` using an embedded JetBrains Mono subset; the Banner, Mascot and Scan Sweep are block art compiled to merged paths. All motion is CSS `@keyframes` layered on top of a base stylesheet that is already the correct still frame, so one reduced-motion rule disables everything safely.

**Tech Stack:** TypeScript 7 types stripped by Node 26, `node --test`, `subset-font` (HarfBuzz wasm) for the font subset, headless Chrome and Firefox for render checks, GitHub Actions for the daily refresh.

**Spec:** [`docs/spec.md`](../../spec.md). Terms: [`CONTEXT.md`](../../../CONTEXT.md). Decisions: [`docs/adr/`](../../adr/).

## Global Constraints

- **Node 26 strips types, it does not compile them.** No `enum`, no `namespace`, no parameter properties, no decorators. Type-only imports must use `import type`.
- **Grid is exact:** font-size `20`, cell `12 x 24` units, `72` columns, padding `16`, canvas width `896`. Advance is exactly `0.6em`, verified against JetBrains Mono v2.304.
- **Font is JetBrains Mono v2.304**, OFL-1.1, vendored into the repo. The licence file ships beside it.
- **Forbidden glyphs** (absent from the font, must never be emitted): `⎿ ✻ ✢ ✽ ✔ ✘ ◼ ◻ ⏵ ⏸`.
- **Animation may only touch `opacity` and `transform`.** No SMIL, no `filter`, no `mask`, no `blur`.
- **Base CSS must be the final still frame.** Every animation drives away from it and returns.
- **Palette, dark:** bg `#272e33`, surface `#2e383c`, border `#677279`, text `#d3c6aa`, muted `#9da9a0`, accent `#83c092`, warning `#dbbc7f`, error `#e78183`.
- **Palette, light:** bg `#fffbef`, surface `#f8f5e4`, border `#8d9978`, text `#5c6a72`, muted `#667466`, accent `#3f7d4e`, warning `#926900`, error `#cd3a37`.
- **Both font weights are embedded** as separate `@font-face` rules. Never one face with `font-weight: 400 700`, which makes the browser fake the bold and smear the grid.
- **No dead code.** Every symbol a module defines is used. No `void x` statements to silence unused values.
- **All visible wording comes from `content.json`.** No copy is hardcoded in `src/`.
- **Each SVG <= 250 KB.** No em-dashes or emoji in visible copy. No Anthropic marks, name, brand colour or verb list.

## Review Focus

1. **Content containing a codepoint the font lacks** (emoji, CJK, a forbidden glyph) must fail the build with a message naming the character, never render blank boxes. Test in Task 3.
2. **A row wider than 72 columns** must fail the build naming the row, never overflow the viewBox. Test in Task 3.
3. **No token, no network, no cache** must fail loudly; no token but a valid cache must succeed from cache. Neither may emit `NaN` or zeros. Test in Task 8.
4. **An all-zero or empty contribution calendar** must not divide by zero when scaling Scan Sweep intensity; it must render an empty grid. Test in Task 8.
5. **A forbidden name arriving through fetched API data** (a repo description, say) must be caught before any asset is written, not only in hand-written content. Test in Task 11.

---

### Task 1: Repository skeleton, tokens and grid maths

**Files:**
- Create: `package.json`, `.gitignore`, `src/tokens.ts`, `src/grid.ts`
- Test: `test/grid.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ThemeName = "dark" | "light"`; `type Palette = { bg, surface, border, text, muted, accent, warning, error: string }`; `PALETTES: Record<ThemeName, Palette>`; `CELL_W`, `CELL_H`, `COLS`, `PAD`, `FONT_SIZE`, `BASELINE_IN_ROW`, `CANVAS_W` as numbers; `colX(col: number): number`; `rowBaselineY(row: number): number`; `canvasH(rows: number): number`.

- [ ] **Step 1: Initialise the repo and ignore files that must never be published**

ADR 0001 forbids publishing the real name. The example HTML and the research screenshots contain it, so they stay local.

```bash
cd /home/ple/Documents/personal_Project/custom_GH_Profile
git init -b main
npm init -y
npm pkg set type=module
npm pkg set scripts.build="node src/build.ts"
npm pkg set scripts.test="node --test"
```

Write `.gitignore`:

```gitignore
node_modules/

# Never publish: contains the real name (ADR 0001)
saltless-bruh-profile-3a.html

# Local research notes: third-party content, screenshots with the real name
docs/research/
```

- [ ] **Step 2: Write the failing test for the grid**

```ts
// test/grid.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { CELL_W, CELL_H, COLS, CANVAS_W, colX, rowBaselineY, canvasH } from "../src/grid.ts";

test("cell width is the font advance exactly", () => {
  // JetBrains Mono v2.304: unitsPerEm 1000, advance 600 => 0.6em; 20 * 0.6 = 12
  assert.equal(CELL_W, 12);
  assert.equal(CELL_H, 24);
});

test("canvas is 72 columns plus padding", () => {
  assert.equal(COLS, 72);
  assert.equal(CANVAS_W, 16 + 72 * 12 + 16);
});

test("column 0 starts at the left padding and columns advance by one cell", () => {
  assert.equal(colX(0), 16);
  assert.equal(colX(71), 16 + 71 * 12);
});

test("rows advance by one cell height", () => {
  assert.equal(rowBaselineY(1) - rowBaselineY(0), 24);
});

test("canvas height covers every row plus padding", () => {
  assert.equal(canvasH(10), 16 + 10 * 24 + 16);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test test/grid.test.ts`
Expected: FAIL, cannot find module `../src/grid.ts`.

- [ ] **Step 4: Write the grid and the tokens**

```ts
// src/grid.ts
// JetBrains Mono v2.304 is exactly monospace: unitsPerEm 1000, advance 600 = 0.6em.
// font-size 20 therefore gives a cell exactly 12 units wide, with no rounding.
export const FONT_SIZE = 20;
export const CELL_W = 12;
export const CELL_H = 24;
export const COLS = 72;
export const PAD = 16;
// Centres the cap height (730/1000 em) in the 24-unit row. Task 3 verifies it against a real render.
export const BASELINE_IN_ROW = 17.5;
export const CANVAS_W = PAD + COLS * CELL_W + PAD;

export const colX = (col: number): number => PAD + col * CELL_W;
export const rowBaselineY = (row: number): number => PAD + row * CELL_H + BASELINE_IN_ROW;
export const canvasH = (rows: number): number => PAD + rows * CELL_H + PAD;
```

```ts
// src/tokens.ts
export type ThemeName = "dark" | "light";

export type Palette = {
  bg: string; surface: string; border: string; text: string;
  muted: string; accent: string; warning: string; error: string;
};

// Everforest Hard, aqua-green accent. Every text role >= 4.5:1 on both bg and surface.
// Verified in docs/research/theme-research.md; accent doubles as success.
// Borders are hue-preserving lightenings of the Everforest borders: the window body is
// only 1.08:1 from GitHub's dimmed canvas and 1.03:1 from white, so the frame is the
// only thing separating the window from the page. Both clear 3:1 on their worst canvas.
export const PALETTES: Record<ThemeName, Palette> = {
  dark: {
    bg: "#272e33", surface: "#2e383c", border: "#677279", text: "#d3c6aa",
    muted: "#9da9a0", accent: "#83c092", warning: "#dbbc7f", error: "#e78183",
  },
  light: {
    bg: "#fffbef", surface: "#f8f5e4", border: "#8d9978", text: "#5c6a72",
    muted: "#667466", accent: "#3f7d4e", warning: "#926900", error: "#cd3a37",
  },
};
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `node --test test/grid.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore src/grid.ts src/tokens.ts test/grid.test.ts
git commit -m "feat: grid maths and design tokens"
```

---

### Task 2: Font subset and codepoint coverage

**Files:**
- Create: `src/font.ts`, `vendor/JetBrainsMono-Regular.ttf`, `vendor/JetBrainsMono-Bold.ttf`, `vendor/OFL.txt`
- Test: `test/font.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `fontCoverage(ttf: Buffer): Set<number>`; `assertCovered(ttf: Buffer, text: string): void` (throws naming the first uncovered character); `subsetToBase64(ttf: Buffer, chars: string): Promise<string>`; `FORBIDDEN_GLYPHS: string`.

- [ ] **Step 1: Vendor the font and install the subsetter**

The font must be in the repo: an SVG embedded via `<img>` cannot fetch anything external.

```bash
mkdir -p vendor
curl -fsSL -o vendor/JetBrainsMono-Regular.ttf https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@v2.304/fonts/ttf/JetBrainsMono-Regular.ttf
curl -fsSL -o vendor/JetBrainsMono-Bold.ttf    https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@v2.304/fonts/ttf/JetBrainsMono-Bold.ttf
curl -fsSL -o vendor/OFL.txt                   https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@v2.304/OFL.txt
npm install subset-font
```

- [ ] **Step 2: Write the failing test**

```ts
// test/font.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fontCoverage, assertCovered, subsetToBase64, FORBIDDEN_GLYPHS } from "../src/font.ts";

const ttf = readFileSync(new URL("../vendor/JetBrainsMono-Regular.ttf", import.meta.url));

test("the glyphs the Session uses are all present", () => {
  const used = "❯●╰─│✓✗⚠▲▶■□·∙•✶*○◌◉… abcXYZ0129/~[]{}()";
  assert.doesNotThrow(() => assertCovered(ttf, used));
});

test("Vietnamese is covered, so content may use it", () => {
  assert.doesNotThrow(() => assertCovered(ttf, "ăâđêôơư ạắằẵặ ếệ ỗộ ờợ ửữự"));
});

test("every forbidden glyph really is absent, which is why substitutes exist", () => {
  const cov = fontCoverage(ttf);
  for (const ch of FORBIDDEN_GLYPHS) {
    assert.equal(cov.has(ch.codePointAt(0)!), false, `${ch} unexpectedly present`);
  }
});

test("an uncovered character is reported by name, not silently dropped", () => {
  assert.throws(() => assertCovered(ttf, "hello 🙂"), /U\+1F642/);
});

test("the subset is valid woff2 and far smaller than the full font", async () => {
  const b64 = await subsetToBase64(ttf, "abcdefghijklmnopqrstuvwxyz0123456789❯●╰");
  const bytes = Buffer.from(b64, "base64");
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "wOF2");
  assert.ok(bytes.length < 20_000, `subset was ${bytes.length} bytes`);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test test/font.test.ts`
Expected: FAIL, cannot find module `../src/font.ts`.

- [ ] **Step 4: Implement the font helpers**

```ts
// src/font.ts
import subsetFont from "subset-font";

// Verified absent from JetBrains Mono v2.304. Emitting any of these renders a blank box.
export const FORBIDDEN_GLYPHS = "⎿✻✢✽✔✘◼◻⏵⏸";

/** Every codepoint the font can draw, read from its cmap (formats 4 and 12). */
export function fontCoverage(ttf: Buffer): Set<number> {
  const u16 = (o: number) => ttf.readUInt16BE(o);
  const u32 = (o: number) => ttf.readUInt32BE(o);
  let cmap = 0;
  for (let t = 0, n = u16(4); t < n; t++) {
    const rec = 12 + t * 16;
    if (ttf.toString("ascii", rec, rec + 4) === "cmap") cmap = u32(rec + 8);
  }
  if (!cmap) throw new Error("font has no cmap table");

  const out = new Set<number>();
  for (let s = 0, ns = u16(cmap + 2); s < ns; s++) {
    const off = cmap + u32(cmap + 4 + s * 8 + 4);
    const fmt = u16(off);
    if (fmt === 4) {
      const segX2 = u16(off + 6);
      const ends = off + 14;
      const starts = ends + segX2 + 2;
      for (let k = 0; k < segX2 / 2; k++) {
        const end = u16(ends + k * 2);
        const start = u16(starts + k * 2);
        if (start === 0xffff) continue;
        for (let c = start; c <= end; c++) out.add(c);
      }
    } else if (fmt === 12) {
      const groups = u32(off + 12);
      for (let k = 0; k < groups; k++) {
        const g = off + 16 + k * 12;
        for (let c = u32(g); c <= u32(g + 4); c++) out.add(c);
      }
    }
  }
  return out;
}

/** Throws naming the first character the font cannot draw. */
export function assertCovered(ttf: Buffer, text: string): void {
  const cov = fontCoverage(ttf);
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x0a || cp === 0x09) continue;
    if (!cov.has(cp)) {
      const hex = cp.toString(16).toUpperCase().padStart(4, "0");
      throw new Error(`character ${JSON.stringify(ch)} (U+${hex}) is not in the font`);
    }
  }
}

export async function subsetToBase64(ttf: Buffer, chars: string): Promise<string> {
  const out = await subsetFont(ttf, chars, { targetFormat: "woff2" });
  return out.toString("base64");
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node --test test/font.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add vendor src/font.ts test/font.test.ts package.json package-lock.json
git commit -m "feat: vendor JetBrains Mono and add subsetting with coverage checks"
```

---

### Task 3: Row model, validation and the walking skeleton

This task proves the riskiest assumption in the whole design: that an embedded base64 font inside an `<img>`-rendered SVG lands exactly on the 12-unit grid. Everything else depends on it.

**Files:**
- Create: `src/rows.ts`, `src/svg.ts`, `scripts/render-check.ts`
- Test: `test/rows.test.ts`, `test/skeleton.test.ts`

**Interfaces:**
- Consumes: `src/grid.ts`, `src/tokens.ts`, `src/font.ts`.
- Produces: `type Style = "text" | "muted" | "accent" | "warning" | "error" | "bold"`; `type Run = { col: number; text: string; style?: Style }`; `type Row = { runs: Run[] }`; `rowWidth(row: Row): number`; `assertFits(rows: Row[]): void`; `rowsToText(rows: Row[]): string`; `renderRows(rows: Row[]): string`; `buildSvg(opts: { rows: Row[]; theme: ThemeName; fontB64: string; css?: string; defs?: string; title: string }): Promise<string>`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/rows.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { rowWidth, assertFits, rowsToText, renderRows } from "../src/rows.ts";

test("row width is the furthest column a run reaches", () => {
  assert.equal(rowWidth({ runs: [{ col: 0, text: "ab" }, { col: 10, text: "xyz" }] }), 13);
});

test("a row wider than 72 columns is rejected and names itself", () => {
  const rows = [{ runs: [{ col: 60, text: "x".repeat(20) }] }];
  assert.throws(() => assertFits(rows), /row 0 .*80 columns/);
});

test("a row of exactly 72 columns is allowed", () => {
  assert.doesNotThrow(() => assertFits([{ runs: [{ col: 0, text: "x".repeat(72) }] }]));
});

test("the transcript pads runs to their column so the text matches the picture", () => {
  const rows = [{ runs: [{ col: 2, text: "ab" }, { col: 6, text: "cd" }] }];
  assert.equal(rowsToText(rows), "  ab  cd");
});

test("markup special characters are escaped, not injected", () => {
  const svg = renderRows([{ runs: [{ col: 0, text: `a&b<c>"d"` }] }]);
  assert.match(svg, /a&amp;b&lt;c&gt;/);
  assert.ok(!svg.includes("<c>"));
});
```

```ts
// test/skeleton.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { subsetToBase64 } from "../src/font.ts";
import { buildSvg } from "../src/svg.ts";

const ttf = readFileSync(new URL("../vendor/JetBrainsMono-Regular.ttf", import.meta.url));

const bold = readFileSync(new URL("../vendor/JetBrainsMono-Bold.ttf", import.meta.url));
const mk = async (rows: Parameters<typeof buildSvg>[0]["rows"], theme: "dark" | "light" = "dark") =>
  buildSvg({
    rows, theme, title: "test",
    fontRegularB64: await subsetToBase64(ttf, "HELO WRDx"),
    fontBoldB64: await subsetToBase64(bold, "HELO WRDx"),
  });

test("the document is well-formed, self-contained and themed", async () => {
  const svg = await mk([{ runs: [{ col: 0, text: "HELLO WORLD", style: "accent" }] }]);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /viewBox="0 0 896 /);
  assert.match(svg, /#272e33/);                       // dark bg token
  assert.ok(!svg.includes("<script"), "must contain no script");
  assert.ok(!svg.includes("<animate"), "must use CSS keyframes, never SMIL");
});

test("both weights are embedded, so bold is never synthesised", async () => {
  const svg = await mk([{ runs: [{ col: 0, text: "x", style: "bold" }] }]);
  assert.equal([...svg.matchAll(/@font-face/g)].length, 2);
  assert.match(svg, /font-weight:400;src:url\(data:font\/woff2;base64,/);
  assert.match(svg, /font-weight:700;src:url\(data:font\/woff2;base64,/);
  assert.ok(!/font-weight:\s*400 700/.test(svg), "a 400-700 range would fake the bold");
});

test("reduced motion disables every animation", async () => {
  const svg = await mk([{ runs: [{ col: 0, text: "x" }] }]);
  assert.match(svg, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*\s*\{\s*animation:\s*none\s*!important/);
});

test("the frame separates the window from every canvas it can sit on", async () => {
  // The window body is only 1.08:1 from GitHub's dimmed canvas, so the frame does the work.
  const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16);
    return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255); };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  const { PALETTES } = await import("../src/tokens.ts");
  for (const canvas of ["#0d1117", "#212830", "#010409"]) {
    assert.ok(ratio(PALETTES.dark.border, canvas) >= 3, `dark frame vs ${canvas} is ${ratio(PALETTES.dark.border, canvas).toFixed(2)}`);
  }
  assert.ok(ratio(PALETTES.light.border, "#ffffff") >= 3);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/rows.test.ts test/skeleton.test.ts`
Expected: FAIL, cannot find modules `../src/rows.ts` and `../src/svg.ts`.

- [ ] **Step 3: Implement the row model**

```ts
// src/rows.ts
import { COLS, colX, rowBaselineY } from "./grid.ts";

export type Style = "text" | "muted" | "accent" | "warning" | "error" | "bold";
/** `cls` attaches an animation hook to a single run, e.g. the spinner glyph. */
export type Run = { col: number; text: string; style?: Style; cls?: string };
export type Row = { runs: Run[]; cls?: string };

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Number of columns the row occupies, measured to the end of its furthest run. */
export function rowWidth(row: Row): number {
  return row.runs.reduce((w, r) => Math.max(w, r.col + [...r.text].length), 0);
}

export function assertFits(rows: Row[]): void {
  rows.forEach((row, i) => {
    const w = rowWidth(row);
    if (w > COLS) {
      throw new Error(`row ${i} needs ${w} columns, the Session is ${COLS}: ${JSON.stringify(rowsToText([row]))}`);
    }
  });
}

/** The Session as plain text, for the transcript block and the forbidden-name scan. */
export function rowsToText(rows: Row[]): string {
  return rows.map((row) => {
    let line = "";
    for (const run of [...row.runs].sort((a, b) => a.col - b.col)) {
      if (line.length < run.col) line += " ".repeat(run.col - line.length);
      line += run.text;
    }
    return line.trimEnd();
  }).join("\n");
}

export function renderRows(rows: Row[]): string {
  return rows.map((row, i) => {
    const spans = [...row.runs]
      .sort((a, b) => a.col - b.col)
      .map((r) => `<tspan x="${colX(r.col)}" class="${[r.style ?? "text", r.cls].filter(Boolean).join(" ")}">${esc(r.text)}</tspan>`)
      .join("");
    const cls = row.cls ? ` class="${row.cls}"` : "";
    return `<text${cls} y="${rowBaselineY(i)}" xml:space="preserve">${spans}</text>`;
  }).join("\n");
}

/** Every character the rows will draw, for subsetting and coverage checks. */
export function charsUsed(rows: Row[]): string {
  return [...new Set(rows.flatMap((r) => r.runs.flatMap((run) => [...run.text])))].join("");
}
```

- [ ] **Step 4: Implement the SVG assembler**

```ts
// src/svg.ts
import { CANVAS_W, FONT_SIZE, canvasH } from "./grid.ts";
import { PALETTES, type ThemeName } from "./tokens.ts";
import { renderRows, type Row } from "./rows.ts";

export type BuildSvgOptions = {
  rows: Row[];
  theme: ThemeName;
  fontRegularB64: string;
  fontBoldB64: string;
  css?: string;    // animation layer, appended after the base stylesheet
  defs?: string;   // geometry: Banner, Mascot, Scan Sweep
  title: string;   // accessible name
};

export async function buildSvg(o: BuildSvgOptions): Promise<string> {
  const p = PALETTES[o.theme];
  const h = canvasH(o.rows.length);
  // Base styles are the FINAL STILL FRAME. Animations in o.css drive away from this,
  // so `animation: none` under reduced motion lands exactly here.
  const base = `
    text { font-family: "JBMono"; font-size: ${FONT_SIZE}px; white-space: pre; }
    .text { fill: ${p.text} } .muted { fill: ${p.muted} } .accent { fill: ${p.accent} }
    .warning { fill: ${p.warning} } .error { fill: ${p.error} }
    .bold { fill: ${p.text}; font-weight: 700 }
  `;
  // Two faces, not one with a 400-700 range: a single face makes the browser
  // synthesise the bold, which smears a monospace grid.
  const faces = `
@font-face{font-family:"JBMono";font-style:normal;font-weight:400;src:url(data:font/woff2;base64,${o.fontRegularB64}) format("woff2")}
@font-face{font-family:"JBMono";font-style:normal;font-weight:700;src:url(data:font/woff2;base64,${o.fontBoldB64}) format("woff2")}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_W} ${h}" width="${CANVAS_W}" height="${h}" role="img" aria-label="${o.title}" shape-rendering="crispEdges">
<title>${o.title}</title>
<style>${faces}
${base}${o.css ?? ""}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
</style>
<rect width="${CANVAS_W}" height="${h}" fill="${p.bg}"/>
<rect x="0.5" y="0.5" width="${CANVAS_W - 1}" height="${h - 1}" fill="none" stroke="${p.border}" stroke-width="1"/>
${o.defs ?? ""}
${renderRows(o.rows)}
</svg>`;
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node --test test/rows.test.ts test/skeleton.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Write the render-check harness and verify the grid in a real browser**

This is the de-risking step: it proves the embedded font lands on the grid.

```ts
// scripts/render-check.ts
// Usage: node scripts/render-check.ts <file.svg> <out.png> [--reduced] [--width=846]
import { execFileSync } from "node:child_process";

const [, , input, out, ...flags] = process.argv;
const width = Number(flags.find((f) => f.startsWith("--width="))?.slice(8) ?? 846);
const reduced = flags.includes("--reduced");
const html = `data:text/html,<body style="margin:0;background:%23${flags.includes("--light") ? "ffffff" : "0d1117"}">`
  + `<img src="file://${input}" style="width:${width}px;display:block">`;

execFileSync("google-chrome-stable", [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--window-size=${width + 40},2400`, "--virtual-time-budget=6000",
  ...(reduced ? ["--force-prefers-reduced-motion"] : []),
  `--screenshot=${out}`, html,
], { stdio: "inherit" });
console.log(`wrote ${out}`);
```

Build a probe SVG whose top row is exactly 72 `#` characters, render it, and confirm the glyph run spans the full column width with no overflow and no clipping:

```bash
node --input-type=module-typescript -e '
import { readFileSync, writeFileSync } from "node:fs";
import { subsetToBase64 } from "./src/font.ts";
import { buildSvg } from "./src/svg.ts";
const ttf = readFileSync("vendor/JetBrainsMono-Regular.ttf");
const rows = [
  { runs: [{ col: 0, text: "#".repeat(72), style: "accent" }] },
  { runs: [{ col: 0, text: "0123456789".repeat(7) + "01" }] },
  { runs: [{ col: 0, text: "left" }, { col: 68, text: "RGHT", style: "muted" }] },
];
const chars = "#0123456789leftRGHT";
writeFileSync("/tmp/probe.svg", await buildSvg({ rows, theme: "dark", fontB64: await subsetToBase64(ttf, chars), title: "probe" }));
'
node scripts/render-check.ts /tmp/probe.svg /tmp/probe.png
```

Open `/tmp/probe.png`. Expected: the `#` row fills the full width between the 16-unit margins; the digit row lines up with it column for column; `RGHT` ends flush at the right margin. If the baseline looks high or low in the row, adjust `BASELINE_IN_ROW` in `src/grid.ts` and re-render until the text sits visually centred.

- [ ] **Step 7: Commit**

```bash
git add src/rows.ts src/svg.ts scripts/render-check.ts test/rows.test.ts test/skeleton.test.ts
git commit -m "feat: row model, SVG assembler and render-check harness"
```

---

### Task 4: The content file and its validation

**Files:**
- Create: `src/content.ts`, `docs/EDITING.md`
- Already present, do not overwrite: `content.json`
- Test: `test/content.test.ts`

**Interfaces:**
- Consumes: `src/font.ts`.
- Produces: `type Repo = { name: string; blurb: string }`; `type Lane = { label: string; repos: Repo[] }`; `type StackRow = { label: string; items: string[] }`; `type Verbs = Record<PoseName, string[]>`; `type Content = { handle, cwd, role, whoami: string[], lanes: Lane[], stackRows: StackRow[], verbs: Verbs, statusline: { effortLabels: string[]; effortSelected: string; modeBadge: string; note: string } }`; `loadContent(path?: string): Content`; `FORBIDDEN_NAMES: string[]`; `assertNoForbiddenNames(text: string, where: string): void`.

- [ ] **Step 1: Write the failing test**

```ts
// test/content.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { loadContent, assertNoForbiddenNames } from "../src/content.ts";

test("the shipped content file is valid", () => {
  const c = loadContent();
  assert.ok(c.lanes.length > 0);
  assert.ok(c.stackRows.length > 0);
  assert.ok(c.whoami.length > 0 && c.whoami.length <= 3);
  for (const lane of c.lanes) for (const r of lane.repos) assert.ok(r.blurb.trim().length > 0, `${r.name} has no blurb`);
});

test("every mascot state has at least one spinner word", () => {
  const c = loadContent();
  for (const state of ["sleep", "yawn", "stretch", "settle", "startle"] as const) {
    assert.ok(c.verbs[state]?.length > 0, `verbs.${state} is empty`);
  }
});

test("a mascot state left without words is rejected by name", () => {
  const p = "/tmp/content-noverb.json";
  const c = loadContent();
  writeFileSync(p, JSON.stringify({ ...c, verbs: { ...c.verbs, stretch: [] } }));
  assert.throws(() => loadContent(p), /verbs\.stretch/);
});

test("an empty lane list is rejected", () => {
  const p = "/tmp/content-empty.json";
  writeFileSync(p, JSON.stringify({ ...loadContent(), lanes: [] }));
  assert.throws(() => loadContent(p), /lanes/);
});

test("a repo with a blank blurb is rejected by name", () => {
  const p = "/tmp/content-blank.json";
  const c = loadContent();
  c.lanes[0].repos[0].blurb = "   ";
  writeFileSync(p, JSON.stringify(c));
  assert.throws(() => loadContent(p), new RegExp(c.lanes[0].repos[0].name));
});

test("a character the font cannot draw is rejected before rendering", () => {
  const p = "/tmp/content-emoji.json";
  const c = loadContent();
  c.role = "engineer 🙂";
  writeFileSync(p, JSON.stringify(c));
  assert.throws(() => loadContent(p), /U\+1F642/);
});

test("more than three whoami lines is rejected", () => {
  const p = "/tmp/content-long.json";
  writeFileSync(p, JSON.stringify({ ...loadContent(), whoami: ["a", "b", "c", "d"] }));
  assert.throws(() => loadContent(p), /whoami/);
});

test("a forbidden name is caught wherever it appears", () => {
  assert.throws(() => assertNoForbiddenNames("contact Firstname Lastname", "test input"), /test input/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/content.test.ts`
Expected: FAIL, cannot find module `../src/content.ts`.

- [ ] **Step 3: Check the content file**

`content.json` already exists at the repo root, filled in by the owner. Do **not** overwrite it. Read it and confirm it has the shape below, which is what the loader validates against. The structure is what matters; the strings are the owner's.

```json
{
  "handle": "LAZIE",
  "cwd": "~/saltless-bruh",
  "role": "REPLACE ME: your one-line role",
  "whoami": [
    "REPLACE ME: line one of who you are and what you build.",
    "REPLACE ME: line two, the constraint or principle you work under.",
    "REPLACE ME: line three, the punchline."
  ],
  "lanes": [
    { "label": "lane-one/", "repos": [
      { "name": "repo-name-1", "blurb": "REPLACE ME: what it does, one line" },
      { "name": "repo-name-2", "blurb": "REPLACE ME: what it does, one line" }
    ]},
    { "label": "lane-two/", "repos": [
      { "name": "repo-name-3", "blurb": "REPLACE ME: what it does, one line" },
      { "name": "repo-name-4", "blurb": "REPLACE ME: what it does, one line" }
    ]},
    { "label": "lane-three/", "repos": [
      { "name": "repo-name-5", "blurb": "REPLACE ME: what it does, one line" },
      { "name": "repo-name-6", "blurb": "REPLACE ME: what it does, one line" }
    ]}
  ],
  "stackRows": [
    { "label": "row-one", "items": ["item", "item", "item"] },
    { "label": "row-two", "items": ["item", "item"] }
  ],
  "verbs": {
    "sleep": ["Loafing", "Dozing", "Purring", "Kneading"],
    "yawn": ["Yawning"],
    "stretch": ["Stretching"],
    "settle": ["Resettling"],
    "startle": ["Startled"]
  },
  "statusline": {
    "effortLabels": ["low", "medium", "lazy", "xhigh", "max"],
    "effortSelected": "lazy",
    "modeBadge": "autopilot on",
    "note": "terminal-style design, not affiliated with Anthropic"
  }
}
```

- [ ] **Step 4: Implement the loader and its validation**

```ts
// src/content.ts
import { readFileSync } from "node:fs";
import { assertCovered, FORBIDDEN_GLYPHS } from "./font.ts";
import { MASCOT_TIMELINE, type PoseName } from "./mascot.ts";

export type Repo = { name: string; blurb: string };
export type Lane = { label: string; repos: Repo[] };
export type StackRow = { label: string; items: string[] };
export type Statusline = { effortLabels: string[]; effortSelected: string; modeBadge: string; note: string };
/** Spinner words grouped by Mascot state, so the label names the pose on screen. */
export type Verbs = Record<PoseName, string[]>;
export type Content = {
  handle: string; cwd: string; role: string; whoami: string[];
  lanes: Lane[]; stackRows: StackRow[]; verbs: Verbs; statusline: Statusline;
};

/**
 * Strings that must never reach a committed file (ADR 0001).
 * Each entry is matched case-insensitively against all content and all fetched data.
 * The owner adds their own real-name spellings here; it stays local only if listed in .gitignore.
 */
export const FORBIDDEN_NAMES: string[] = ["Firstname Lastname"];

export function assertNoForbiddenNames(text: string, where: string): void {
  const hay = text.toLowerCase();
  for (const name of FORBIDDEN_NAMES) {
    if (name && hay.includes(name.toLowerCase())) {
      throw new Error(`forbidden name appears in ${where} (ADR 0001 forbids publishing it)`);
    }
  }
}

const DEFAULT_PATH = new URL("../content.json", import.meta.url);

export function loadContent(path?: string): Content {
  const raw = readFileSync(path ?? DEFAULT_PATH, "utf8");
  const c = JSON.parse(raw) as Content;

  const need = (ok: boolean, msg: string) => { if (!ok) throw new Error(`content.json: ${msg}`); };
  need(typeof c.handle === "string" && c.handle.length > 0, "handle is required");
  need(typeof c.role === "string" && c.role.length > 0, "role is required");
  need(Array.isArray(c.whoami) && c.whoami.length > 0 && c.whoami.length <= 3, "whoami must have 1 to 3 lines");
  need(Array.isArray(c.lanes) && c.lanes.length > 0, "lanes must not be empty");
  need(Array.isArray(c.stackRows) && c.stackRows.length > 0, "stackRows must not be empty");
  // Every state the Mascot can reach needs at least one word, or the spinner would
  // go blank exactly when the cat does something worth naming.
  for (const state of new Set(MASCOT_TIMELINE.map((w) => w.state)) as Set<PoseName>) {
    need(Array.isArray(c.verbs?.[state]) && c.verbs[state].length > 0, `verbs.${state} must list at least one word`);
  }
  need(!!c.statusline?.effortLabels?.length, "statusline.effortLabels must not be empty");
  need(c.statusline.effortLabels.includes(c.statusline.effortSelected),
       "statusline.effortSelected must be one of effortLabels");

  for (const lane of c.lanes) {
    need(lane.repos?.length > 0, `lane ${lane.label} has no repos`);
    for (const r of lane.repos) need(r.blurb?.trim().length > 0, `repo ${r.name} has a blank blurb`);
  }

  // Everything visible must be drawable and must carry no forbidden name.
  const all = JSON.stringify(c);
  assertNoForbiddenNames(all, "content.json");
  const ttf = readFileSync(new URL("../vendor/JetBrainsMono-Regular.ttf", import.meta.url));
  assertCovered(ttf, all);
  for (const ch of FORBIDDEN_GLYPHS) {
    if (all.includes(ch)) throw new Error(`content.json uses ${ch}, which the font cannot draw`);
  }
  return c;
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node --test test/content.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Write the owner's editing guide**

```markdown
<!-- docs/EDITING.md -->
# Editing your profile

Everything you see on the profile comes from `content.json`. You never need to touch `src/`.

## Change the words

Open `content.json` and replace every value that starts with `REPLACE ME`. Then run:

    npm run build

The build fails with a clear message if something will not render, so a mistake can never ship silently.

| Key | What it is |
|---|---|
| `handle` | The big lettering at the top. Short works best; it is drawn at about 5 columns per letter. |
| `cwd` | The path under the role line. |
| `role` | One line under the lettering. |
| `whoami` | One to three lines of prose for `/whoami`. |
| `lanes` | The groups under `/ops`. Each has a `label` and a list of repos with a one-line `blurb`. |
| `stackRows` | The rows under `/stack`. Each has a `label` and a list of `items`, printed as plain text. |
| `verbs` | The spinner's words, grouped by what the cat is doing: `sleep`, `yawn`, `stretch`, `settle`, `startle`. The spinner always names the pose on screen, so give `yawn` a yawning word. Give `sleep` several and it rotates through them during the long naps. Every group needs at least one word. |
| `statusline` | The effort labels, which one is highlighted, the mode badge and the footer note. |

## Rules the build enforces

1. **72 columns.** Nothing may be wider. Long blurbs are the usual cause; the error names the row.
2. **Drawable characters only.** Plain text and Vietnamese are fine. Emoji are not, and the error names the character.
3. **No forbidden names.** Add every spelling of any name you want kept private to `FORBIDDEN_NAMES` in `src/content.ts`. The build refuses to write anything containing them.

## Keeping a name private

`FORBIDDEN_NAMES` in `src/content.ts` is itself committed, so do not put a private string there if the repo is public. Instead set it from an environment variable locally, or keep the list to patterns you are happy to publish. The check still runs over everything fetched from the API.
```

- [ ] **Step 7: Commit**

```bash
git add content.json src/content.ts docs/EDITING.md test/content.test.ts
git commit -m "feat: user-owned content file with build-time validation"
```

---

### Task 5: Block art compiler and the Banner

**Files:**
- Create: `src/blockart.ts`, `src/banner.ts`
- Test: `test/blockart.test.ts`, `test/banner.test.ts`

**Interfaces:**
- Consumes: `src/grid.ts`.
- Produces: `type Quad = [boolean, boolean, boolean, boolean]`; `blockToQuads(ch: string): Quad`; `artToPath(art: string[], originCol: number, originRow: number): string`; `bannerArt(text: string): string[]`; `bannerPath(text: string, col: number, row: number): string`; `BANNER_ROWS: number`; `bannerWidthCols(text: string): number`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/blockart.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { blockToQuads, artToPath } from "../src/blockart.ts";

test("a full block fills all four quadrants, a space fills none", () => {
  assert.deepEqual(blockToQuads("█"), [true, true, true, true]);
  assert.deepEqual(blockToQuads(" "), [false, false, false, false]);
});

test("half and quadrant blocks map to the right corners", () => {
  assert.deepEqual(blockToQuads("▀"), [true, true, false, false]);   // upper half
  assert.deepEqual(blockToQuads("▄"), [false, false, true, true]);   // lower half
  assert.deepEqual(blockToQuads("▌"), [true, false, true, false]);   // left half
  assert.deepEqual(blockToQuads("▐"), [false, true, false, true]);   // right half
  assert.deepEqual(blockToQuads("▘"), [true, false, false, false]);  // upper left
  assert.deepEqual(blockToQuads("▗"), [false, false, false, true]);  // lower right
});

test("a single full block becomes one 12x24 rectangle at its cell", () => {
  // cell (0,0) with grid padding 16 => x 16, y 16, w 12, h 24
  assert.equal(artToPath(["█"], 0, 0), "M16 16h12v24h-12z");
});

test("adjacent blocks merge horizontally into one run, avoiding seams", () => {
  const d = artToPath(["██"], 0, 0);
  assert.equal(d, "M16 16h24v24h-24z");
});

test("an unknown character is refused rather than silently skipped", () => {
  assert.throws(() => artToPath(["?"], 0, 0), /\?/);
});
```

```ts
// test/banner.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { bannerArt, bannerWidthCols, BANNER_ROWS } from "../src/banner.ts";

test("the banner is three rows tall", () => {
  assert.equal(bannerArt("LAZIE").length, BANNER_ROWS);
  assert.equal(BANNER_ROWS, 3);
});

test("every banner row is the same width, so columns line up", () => {
  const rows = bannerArt("LAZIE");
  assert.equal(new Set(rows.map((r) => [...r].length)).size, 1);
  assert.equal([...rows[0]].length, bannerWidthCols("LAZIE"));
});

test("the banner uses only characters the block compiler knows", () => {
  const known = new Set([..."█▀▄▌▐▖▗▘▝▙▛▜▟ "]);
  for (const row of bannerArt("LAZIE")) for (const ch of row) assert.ok(known.has(ch), `unknown ${ch}`);
});

test("an unsupported letter is reported, not drawn as a gap", () => {
  assert.throws(() => bannerArt("LA#IE"), /#/);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/blockart.test.ts test/banner.test.ts`
Expected: FAIL, cannot find modules.

- [ ] **Step 3: Implement the block-art compiler**

```ts
// src/blockart.ts
import { CELL_W, CELL_H, PAD } from "./grid.ts";

const halfH = CELL_H / 2;

/** Which quadrants a block glyph fills: [topLeft, topRight, bottomLeft, bottomRight]. */
export type Quad = [boolean, boolean, boolean, boolean];

const T = true, F = false;
const QUADS: Record<string, Quad> = {
  " ": [F, F, F, F], "█": [T, T, T, T],
  "▀": [T, T, F, F], "▄": [F, F, T, T], "▌": [T, F, T, F], "▐": [F, T, F, T],
  "▘": [T, F, F, F], "▝": [F, T, F, F], "▖": [F, F, T, F], "▗": [F, F, F, T],
  "▛": [T, T, T, F], "▜": [T, T, F, T], "▙": [T, F, T, T], "▟": [F, T, T, T],
  "▚": [T, F, F, T], "▞": [F, T, T, F],
};

export function blockToQuads(ch: string): Quad {
  const q = QUADS[ch];
  if (!q) throw new Error(`not a block character: ${JSON.stringify(ch)}`);
  return q;
}

/**
 * Compile rows of block art into one path, merging horizontally adjacent
 * sub-cells into single rectangles. Merging matters: separate rects show
 * hairline seams when the image is scaled to a fractional width.
 */
export function artToPath(art: string[], originCol: number, originRow: number): string {
  const parts: string[] = [];

  art.forEach((line, rowIdx) => {
    const cells = [...line];
    const subCols = cells.length * 2;   // two sub-columns per cell, so quadrants survive
    // Two sub-rows per text row: the top and bottom halves of the cell.
    for (const half of [0, 1]) {
      const subFilled = (s: number): boolean => {
        const q = blockToQuads(cells[s >> 1]);
        const left = (s & 1) === 0;
        return half === 0 ? (left ? q[0] : q[1]) : (left ? q[2] : q[3]);
      };
      let runStart = -1;
      for (let s = 0; s <= subCols; s++) {
        const on = s < subCols && subFilled(s);
        if (on && runStart < 0) runStart = s;
        if (!on && runStart >= 0) {
          const x = PAD + (originCol + runStart / 2) * CELL_W;
          const y = PAD + (originRow + rowIdx) * CELL_H + half * halfH;
          const w = ((s - runStart) / 2) * CELL_W;
          parts.push(`M${x} ${y}h${w}v${halfH}h-${w}z`);
          runStart = -1;
        }
      }
    }
  });

  return parts.join("");
}
```

- [ ] **Step 4: Implement the Banner**

```ts
// src/banner.ts
import { artToPath } from "./blockart.ts";

export const BANNER_ROWS = 3;

/**
 * Half-block letterforms, 3 rows tall. Each glyph is 4 columns wide plus a
 * 1-column gap, so it shares the Mascot's visual vocabulary rather than
 * looking like a figlet font.
 */
const LETTERS: Record<string, string[]> = {
  A: ["▄▀▀▄", "█▀▀█", "▀  ▀"],
  B: ["█▀▀▄", "█▀▀▄", "▀▀▀ "],
  C: ["▄▀▀▀", "█   ", "▀▀▀▀"],
  D: ["█▀▀▄", "█  █", "▀▀▀ "],
  E: ["█▀▀▀", "█▀▀ ", "▀▀▀▀"],
  F: ["█▀▀▀", "█▀▀ ", "▀   "],
  G: ["▄▀▀▀", "█ ▀█", "▀▀▀▀"],
  H: ["█  █", "█▀▀█", "▀  ▀"],
  I: ["▀█▀ ", " █  ", "▀▀▀ "],
  J: ["  ▀█", "   █", "▀▀▀ "],
  K: ["█  █", "█▀▄ ", "▀  ▀"],
  L: ["█   ", "█   ", "▀▀▀▀"],
  M: ["█▄ ▄█", "█ ▀ █", "▀   ▀"],
  N: ["█▄ █", "█ ▀█", "▀  ▀"],
  O: ["▄▀▀▄", "█  █", "▀▀▀▀"],
  P: ["█▀▀▄", "█▀▀ ", "▀   "],
  Q: ["▄▀▀▄", "█  █", "▀▀▀▄"],
  R: ["█▀▀▄", "█▀▀▄", "▀  ▀"],
  S: ["▄▀▀▀", " ▀▀▄", "▀▀▀ "],
  T: ["▀█▀▀", " █  ", " ▀  "],
  U: ["█  █", "█  █", "▀▀▀▀"],
  V: ["█  █", "█  █", " ▀▀ "],
  W: ["█   █", "█ ▄ █", "▀▀ ▀▀"],
  X: ["▀▄▄▀", " ▄▄ ", "▀  ▀"],
  Y: ["█  █", " ▀▀█", "▀▀▀ "],
  Z: ["▀▀▀█", " ▄▀ ", "▀▀▀▀"],
  "-": ["    ", "▄▄▄▄", "    "],
  " ": ["  ", "  ", "  "],
};

const GAP = 1;

export function bannerArt(text: string): string[] {
  const glyphs = [...text.toUpperCase()].map((ch) => {
    const g = LETTERS[ch];
    if (!g) throw new Error(`banner cannot draw ${JSON.stringify(ch)}; add it to LETTERS in src/banner.ts`);
    return g;
  });
  const rows: string[] = [];
  for (let r = 0; r < BANNER_ROWS; r++) {
    rows.push(glyphs.map((g) => g[r]).join(" ".repeat(GAP)));
  }
  // Pad every row to the same width so column arithmetic is simple.
  const w = Math.max(...rows.map((r) => [...r].length));
  return rows.map((r) => r + " ".repeat(w - [...r].length));
}

export function bannerWidthCols(text: string): number {
  return [...bannerArt(text)[0]].length;
}

export function bannerPath(text: string, col: number, row: number): string {
  return artToPath(bannerArt(text), col, row);
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node --test test/blockart.test.ts test/banner.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Eyeball the Banner**

```bash
node --input-type=module-typescript -e '
import { readFileSync, writeFileSync } from "node:fs";
import { subsetToBase64 } from "./src/font.ts";
import { buildSvg } from "./src/svg.ts";
import { bannerPath, BANNER_ROWS } from "./src/banner.ts";
import { PALETTES } from "./src/tokens.ts";
const ttf = readFileSync("vendor/JetBrainsMono-Regular.ttf");
const defs = `<path d="${bannerPath("LAZIE", 0, 0)}" fill="${PALETTES.dark.accent}"/>`;
const rows = Array.from({length: BANNER_ROWS}, () => ({ runs: [] }));
writeFileSync("/tmp/banner.svg", await buildSvg({ rows, theme: "dark", fontB64: await subsetToBase64(ttf, "x"), defs, title: "banner" }));
'
node scripts/render-check.ts /tmp/banner.svg /tmp/banner.png
```

Open `/tmp/banner.png`. Expected: `LAZIE` reads clearly as block lettering with even letter spacing and no hairline gaps between adjacent blocks. Adjust the glyphs in `LETTERS` if a letter reads poorly.

- [ ] **Step 7: Commit**

```bash
git add src/blockart.ts src/banner.ts test/blockart.test.ts test/banner.test.ts
git commit -m "feat: block-art compiler and half-block banner"
```

---

### Task 6: The Mascot and its 60-second timeline

**Files:**
- Create: `src/mascot.ts`
- Test: `test/mascot.test.ts`

**Interfaces:**
- Consumes: `src/blockart.ts`, `src/grid.ts`, `src/tokens.ts`.
- Produces: `MASCOT_COLS: number`; `MASCOT_ROWS: number`; `MASTER_SECONDS: number`; `type PoseName = "sleep" | "yawn" | "stretch" | "settle" | "startle"`; `MASCOT_TIMELINE: { state: PoseName; from: number; to: number }[]`; `mascotDefs(col: number, row: number, theme: ThemeName): string`; `mascotCss(): string`.

- [ ] **Step 1: Write the failing test**

```ts
// test/mascot.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mascotDefs, mascotCss, MASCOT_COLS, MASCOT_ROWS, MASCOT_TIMELINE, MASTER_SECONDS } from "../src/mascot.ts";

test("the mascot fits the header budget", () => {
  assert.ok(MASCOT_COLS <= 28, "wider than 28 columns blurs on a phone");
  assert.ok(MASCOT_ROWS <= 12);
});

test("the sleeping pose is the default, so reduced motion shows a sleeping cat", () => {
  const css = mascotCss();
  assert.match(css, /\.pose\s*\{[^}]*opacity:\s*0/);
  assert.match(css, /\.pose-sleep\s*\{[^}]*opacity:\s*1/);
});

test("the master loop is 60s and the breath divides into it exactly", () => {
  const css = mascotCss();
  assert.match(css, /animation:\s*m-[a-z]+\s+60s/);
  assert.match(css, /animation:\s*breathe\s+3\.75s/);   // 3.75 x 16 = 60
});

test("micro-layers use co-prime periods so they rarely coincide", () => {
  const css = mascotCss();
  assert.match(css, /animation:\s*ear\s+17s/);
  assert.match(css, /animation:\s*tail\s+23s/);
});

test("it animates only opacity and transform, and never uses SMIL", () => {
  const css = mascotCss();
  const animated = [...css.matchAll(/@keyframes[^{]+\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("");
  const props = [...animated.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
  for (const p of props) assert.ok(["opacity", "transform"].includes(p), `animates ${p}`);
  assert.ok(!mascotDefs(0, 0, "dark").includes("<animate"), "must not use SMIL");
});

test("the rack LEDs are drawn in the accent colour of the right theme", () => {
  assert.match(mascotDefs(0, 0, "dark"), /#83c092/);
  assert.match(mascotDefs(0, 0, "light"), /#3f7d4e/);
});

test("the timeline covers the whole loop with no gap and no overlap", () => {
  assert.equal(MASCOT_TIMELINE[0].from, 0);
  assert.equal(MASCOT_TIMELINE.at(-1)!.to, MASTER_SECONDS);
  for (let i = 1; i < MASCOT_TIMELINE.length; i++) {
    assert.equal(MASCOT_TIMELINE[i].from, MASCOT_TIMELINE[i - 1].to, `gap before window ${i}`);
  }
});

test("the loop starts and ends asleep, so it joins cleanly on repeat", () => {
  assert.equal(MASCOT_TIMELINE[0].state, "sleep");
  assert.equal(MASCOT_TIMELINE.at(-1)!.state, "sleep");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/mascot.test.ts`
Expected: FAIL, cannot find module `../src/mascot.ts`.

- [ ] **Step 3: Implement the Mascot**

Art is authored as block-art strings on a 24x10 grid: the rack occupies the lower rows, the cat loafs on top, and the upper right is left clear for the zZz and the nose bubble. Each pose is a `<g class="pose pose-NAME">`; only `pose-sleep` is visible by default.

```ts
// src/mascot.ts
import { artToPath } from "./blockart.ts";
import { PALETTES, type ThemeName } from "./tokens.ts";

export const MASCOT_COLS = 24;
export const MASCOT_ROWS = 10;
export const MASTER_SECONDS = 60;

export type PoseName = "sleep" | "yawn" | "stretch" | "settle" | "startle";

/**
 * The single source of truth for the Mascot's 60s loop. The spinner derives its
 * verb schedule from this, so the label always names the pose on screen.
 * Hand-offs land on breath boundaries (multiples of 3.75s) wherever possible.
 */
export const MASCOT_TIMELINE: { state: PoseName; from: number; to: number }[] = [
  { state: "sleep",   from: 0,     to: 15 },
  { state: "yawn",    from: 15,    to: 18.4 },
  { state: "stretch", from: 18.4,  to: 23.4 },
  { state: "settle",  from: 23.4,  to: 26.25 },
  { state: "sleep",   from: 26.25, to: 48.75 },
  { state: "startle", from: 48.75, to: 49.55 },
  { state: "sleep",   from: 49.55, to: 60 },
];

// Row 0-5 cat, row 6-9 rack. Replace these with hand-tuned art; the shapes below
// are the starting silhouette: a loaf with two ear notches above a four-slot rack.
const RACK: string[] = [
  "▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄",
  "█▌                    ▐█",
  "█▌                    ▐█",
  "▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
];

const POSES: Record<PoseName, string[]> = {
  sleep: [
    "                        ",
    "                        ",
    "     ▄▀▀▄        ▄▀▀▄   ",
    "   ▄▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▄  ",
    "  █                   █ ",
    "  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ",
  ],
  yawn: [
    "                        ",
    "                        ",
    "     ▄▀▀▄        ▄▀▀▄   ",
    "   ▄▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▄  ",
    "  █     ▄▄            █ ",
    "  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ",
  ],
  stretch: [
    "                        ",
    "     ▄▀▀▄        ▄▀▀▄   ",
    "   ▄▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▄  ",
    "  █                   █ ",
    "  █                   █ ",
    "  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ",
  ],
  settle: [
    "                        ",
    "                        ",
    "     ▄▀▀▄        ▄▀▀▄   ",
    "   ▄▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▄  ",
    "  █                   █ ",
    "  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ",
  ],
  startle: [
    "                        ",
    "    ▄▀▀▄          ▄▀▀▄  ",
    "   ▄▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▄  ",
    "  █                   █ ",
    "  █                   █ ",
    "  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ",
  ],
};

// Seconds -> percentage of the 60s master loop. Keeps the timeline readable.
const pct = (s: number): string => `${((s / 60) * 100).toFixed(3)}%`;

export function mascotDefs(col: number, row: number, theme: ThemeName): string {
  const p = PALETTES[theme];
  const rackPath = artToPath(RACK, col, row + 6);
  const leds = [0, 1, 2].map((i) =>
    `<rect class="led led-${i}" x="${0}" y="${0}" width="0" height="0" fill="${p.accent}"/>`,
  ).join("");

  const poses = (Object.keys(POSES) as PoseName[]).map((name) =>
    `<path class="pose pose-${name}" d="${artToPath(POSES[name], col, row)}" fill="${p.text}"/>`,
  ).join("\n");

  return `<g class="mascot">
<path d="${rackPath}" fill="${p.muted}"/>
${leds}
${poses}
</g>`;
}

export function mascotCss(): string {
  return `
.pose { opacity: 0 }
.pose-sleep { opacity: 1 }
.pose-sleep { animation: m-sleep 60s step-end infinite }
.pose-yawn { animation: m-yawn 60s step-end infinite }
.pose-stretch { animation: m-stretch 60s step-end infinite }
.pose-settle { animation: m-settle 60s step-end infinite }
.pose-startle { animation: m-startle 60s step-end infinite }
.breath { animation: breathe 3.75s step-end infinite }
.ear { animation: ear 17s step-end infinite }
.tail { animation: tail 23s step-end infinite }
.led-0 { animation: led 7s step-end infinite }
.led-1 { animation: led 11s step-end infinite }
.led-2 { animation: led 13s step-end infinite }
@keyframes m-sleep {
  0% { opacity: 1 } ${pct(15)} { opacity: 0 } ${pct(26.25)} { opacity: 1 }
  ${pct(48.75)} { opacity: 0 } ${pct(49.55)} { opacity: 1 } 100% { opacity: 1 }
}
@keyframes m-yawn { 0% { opacity: 0 } ${pct(15)} { opacity: 1 } ${pct(18.4)} { opacity: 0 } 100% { opacity: 0 } }
@keyframes m-stretch { 0% { opacity: 0 } ${pct(18.4)} { opacity: 1 } ${pct(23.4)} { opacity: 0 } 100% { opacity: 0 } }
@keyframes m-settle { 0% { opacity: 0 } ${pct(23.4)} { opacity: 1 } ${pct(26.25)} { opacity: 0 } 100% { opacity: 0 } }
@keyframes m-startle { 0% { opacity: 0 } ${pct(48.75)} { opacity: 1 } ${pct(49.55)} { opacity: 0 } 100% { opacity: 0 } }
@keyframes breathe { 0% { transform: translateY(0) } 46.7% { transform: translateY(-1px) } 93.3% { transform: translateY(0) } }
@keyframes ear { 0% { transform: translateY(0) } 0.5% { transform: translateY(-1px) } 1.2% { transform: translateY(0) } }
@keyframes tail { 0% { transform: translateX(0) } 1% { transform: translateX(1px) } 2.5% { transform: translateX(0) } }
@keyframes led { 0% { opacity: 0.25 } 3% { opacity: 1 } 8% { opacity: 0.25 } }
`;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node --test test/mascot.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Eyeball the Mascot at both sizes and with reduced motion**

```bash
node --input-type=module-typescript -e '
import { readFileSync, writeFileSync } from "node:fs";
import { subsetToBase64 } from "./src/font.ts";
import { buildSvg } from "./src/svg.ts";
import { mascotDefs, mascotCss, MASCOT_ROWS } from "./src/mascot.ts";
const ttf = readFileSync("vendor/JetBrainsMono-Regular.ttf");
const rows = Array.from({length: MASCOT_ROWS}, () => ({ runs: [] }));
writeFileSync("/tmp/mascot.svg", await buildSvg({
  rows, theme: "dark", fontB64: await subsetToBase64(ttf, "x"),
  defs: mascotDefs(0, 0, "dark"), css: mascotCss(), title: "mascot" }));
'
node scripts/render-check.ts /tmp/mascot.svg /tmp/mascot-desktop.png
node scripts/render-check.ts /tmp/mascot.svg /tmp/mascot-phone.png --width=308
node scripts/render-check.ts /tmp/mascot.svg /tmp/mascot-reduced.png --reduced
```

Expected: the cat reads as a loaf with two ear notches sitting on a four-slot rack, at both widths. The reduced-motion render shows the sleeping pose with nothing mid-transition. Refine the art strings until the silhouette reads at 308px.

- [ ] **Step 6: Commit**

```bash
git add src/mascot.ts test/mascot.test.ts
git commit -m "feat: mascot art and 60s css timeline"
```

---

### Task 7: Session composition and the transcript

**Files:**
- Create: `src/session.ts`
- Test: `test/session.test.ts`

**Interfaces:**
- Consumes: `src/content.ts`, `src/rows.ts`, `src/banner.ts`, `src/mascot.ts`, `src/grid.ts`.
- Produces: `type Activity = { totalContributions: number; activeDays: number; calendar: { date: string; count: number }[]; languages: { name: string; bytes: number }[] }`; `composeSession(content: Content, activity: Activity): { rows: Row[]; headerRows: number; scanRow: number; verbRow: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// test/session.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { loadContent } from "../src/content.ts";
import { composeSession } from "../src/session.ts";
import { assertFits, rowsToText } from "../src/rows.ts";
import type { Activity } from "../src/session.ts";

const activity: Activity = {
  totalContributions: 950, activeDays: 99,
  calendar: [{ date: "2026-01-01", count: 3 }],
  languages: [{ name: "Alpha", bytes: 700 }, { name: "Beta", bytes: 300 }],
};

test("the whole session fits in 72 columns", () => {
  const { rows } = composeSession(loadContent(), activity);
  assert.doesNotThrow(() => assertFits(rows));
});

test("every command from the script appears in order", () => {
  const text = rowsToText(composeSession(loadContent(), activity).rows);
  const order = ["/whoami", "/ops", "/stack", "/activity"].map((c) => text.indexOf(c));
  assert.ok(order.every((i) => i >= 0), "a command is missing");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "commands are out of order");
});

test("real activity numbers are printed, never invented", () => {
  const text = rowsToText(composeSession(loadContent(), activity).rows);
  assert.match(text, /99\/365/);
  assert.match(text, /950/);
});

test("languages are shown as whole percentages that come from the bytes", () => {
  const text = rowsToText(composeSession(loadContent(), activity).rows);
  assert.match(text, /Alpha\s+70%/);
  assert.match(text, /Beta\s+30%/);
});

test("the statusline marks the selected effort and carries the note", () => {
  const c = loadContent();
  const text = rowsToText(composeSession(c, activity).rows);
  assert.match(text, new RegExp(`\\[${c.statusline.effortSelected}\\]`));
  assert.ok(text.includes(c.statusline.note));
});

test("a repo description gets its own row, so it has room to say something", () => {
  const c = loadContent();
  c.lanes[0].repos[0].blurb = "self hosted agent memory with a wiki and a vector store";  // 54 chars
  assert.doesNotThrow(() => assertFits(composeSession(c, activity).rows));
});

test("a blurb too long even for its own row is reported, not silently overflowed", () => {
  const c = loadContent();
  c.lanes[0].repos[0].blurb = "x".repeat(90);
  assert.throws(() => assertFits(composeSession(c, activity).rows), /columns/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/session.test.ts`
Expected: FAIL, cannot find module `../src/session.ts`.

- [ ] **Step 3: Implement the composer**

```ts
// src/session.ts
import { COLS } from "./grid.ts";
import type { Content } from "./content.ts";
import type { Row, Run } from "./rows.ts";
import { BANNER_ROWS, bannerWidthCols } from "./banner.ts";
import { MASCOT_COLS, MASCOT_ROWS } from "./mascot.ts";

export type Activity = {
  totalContributions: number;
  activeDays: number;
  calendar: { date: string; count: number }[];
  languages: { name: string; bytes: number }[];
};

const RULE = "─".repeat(COLS);
const blank = (): Row => ({ runs: [] });
const rule = (): Row => ({ runs: [{ col: 0, text: RULE, style: "muted" }] });

/** Percentages that always total 100, so the figures shown are honest. */
export function languageShares(langs: { name: string; bytes: number }[]): { name: string; pct: number }[] {
  const total = langs.reduce((s, l) => s + l.bytes, 0);
  if (total === 0) return langs.map((l) => ({ name: l.name, pct: 0 }));
  const raw = langs.map((l) => ({ name: l.name, exact: (l.bytes / total) * 100 }));
  const out = raw.map((r) => ({ name: r.name, pct: Math.floor(r.exact) }));
  let remainder = 100 - out.reduce((s, r) => s + r.pct, 0);
  const order = raw.map((r, i) => ({ i, frac: r.exact - Math.floor(r.exact) }))
                   .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) { if (remainder <= 0) break; out[i].pct++; remainder--; }
  return out;
}

export function composeSession(c: Content, a: Activity): { rows: Row[]; headerRows: number; scanRow: number; verbRow: number } {
  const rows: Row[] = [];
  const textCol = MASCOT_COLS + 2;

  // Header: the Mascot and Banner are geometry; these rows reserve their space
  // and carry the role line and cwd beside them.
  for (let r = 0; r < MASCOT_ROWS; r++) {
    const runs: Run[] = [];
    if (r === BANNER_ROWS) runs.push({ col: textCol, text: c.role, style: "bold" });
    if (r === BANNER_ROWS + 1) runs.push({ col: textCol, text: c.cwd, style: "muted" });
    rows.push({ runs });
  }
  const headerRows = rows.length;
  rows.push(rule());

  const command = (name: string): void => {
    rows.push({ runs: [{ col: 0, text: "❯", style: "accent" }, { col: 2, text: name, style: "bold" }] });
  };
  const bullet = (text: string): void => {
    rows.push({ runs: [{ col: 0, text: "●", style: "accent" }, { col: 2, text, style: "text" }] });
  };
  const result = (text: string, style: Run["style"] = "text"): void => {
    rows.push({ runs: [{ col: 2, text: "╰", style: "muted" }, { col: 5, text, style }] });
  };
  command("/whoami");
  for (const line of c.whoami) bullet(line);
  rows.push(blank());

  command("/ops");
  for (const lane of c.lanes) {
    result(lane.label, "accent");
    for (const repo of lane.repos) {
      // Name and description get their own rows. Sharing one row leaves 37 columns
      // for the description, which no useful sentence fits; this also reads more
      // like real command output.
      rows.push({ runs: [{ col: 7, text: repo.name, style: "text" }] });
      rows.push({ runs: [{ col: 9, text: repo.blurb, style: "muted" }] });
    }
  }
  rows.push(blank());

  command("/stack");
  const shares = languageShares(a.languages);
  for (const s of shares) {
    rows.push({ runs: [
      { col: 5, text: s.name, style: "text" },
      { col: 22, text: `${s.pct}%`, style: "muted" },
    ]});
  }
  for (const row of c.stackRows) {
    rows.push({ runs: [
      { col: 5, text: row.label, style: "muted" },
      { col: 14, text: row.items.join("  "), style: "text" },
    ]});
  }
  rows.push(blank());

  command("/activity");
  const scanRow = rows.length;
  for (let r = 0; r < 8; r++) rows.push(blank());   // space for the Scan Sweep geometry
  result(`scan complete: ${a.activeDays}/365 days up · ${a.totalContributions} contributions`, "accent");
  rows.push(blank());

  // Every verb slice is rendered stacked at the same spot; the spinner CSS reveals
  // one at a time, in step with the Mascot. The transcript takes the first word only.
  const verbRow = rows.length;
  rows.push({ runs: [{ col: 0, text: "✶", style: "accent", cls: "spinner-glyph" }] });
  rows.push(rule());

  // Statusline
  const effort: Run[] = [{ col: 0, text: "Effort", style: "muted" }];
  let col = 9;
  for (const label of c.statusline.effortLabels) {
    const selected = label === c.statusline.effortSelected;
    const shown = selected ? `[${label}]` : label;
    effort.push({ col, text: shown, style: selected ? "accent" : "muted" });
    col += [...shown].length + 2;
  }
  rows.push({ runs: effort });
  rows.push({ runs: [
    { col: 0, text: `▶▶ ${c.statusline.modeBadge}`, style: "muted" },
    { col: COLS - [...c.statusline.note].length, text: c.statusline.note, style: "muted" },
  ]});

  return { rows, headerRows, scanRow, verbRow };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node --test test/session.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/session.ts test/session.test.ts
git commit -m "feat: compose the session rows from content and activity"
```

---

### Task 8: Activity data, cache and the Scan Sweep

**Files:**
- Create: `src/activity.ts` (done), `src/scan.ts`
- Test: `test/activity.test.ts` (done), `test/scan.test.ts`

**Interfaces:**
- Consumes: `src/session.ts` (`Activity`), `src/grid.ts`, `src/tokens.ts`.
- Produces, data half, as built in `src/activity.ts`:
  `fetchActivity(o: { login: string; repoNames?: string[]; transport: Transport }): Promise<Activity>`;
  `loadActivity(o: { login: string; repoNames?: string[]; cachePath?: URL; transport?: Transport }): Promise<LoadedActivity>`,
  where `LoadedActivity = { activity: Activity; source: "network" | "cache"; ageSeconds: number | null; staleNote: string | null }`;
  `trimToWindow(days, endIso): Day[]`; `githubTransport: Transport`; `ForbiddenNameError`;
  `TOKEN_ENV`, `API_URL`, `ACTIVITY_QUERY`, `CACHE_PATH`, `WINDOW_DAYS`, `MAX_LANGUAGES`.
- **The token is never a parameter.** It is read from `PROFILE_GH_TOKEN` inside `githubTransport`
  and nowhere else, so no caller can hold one (see `.env.example`, and Task 11's secret gate).
  `Transport` is the seam the tests drive instead, which is why no test needs a network or a
  credential. The scope must be `read:user`; the workflow's built-in `GITHUB_TOKEN` will not do.
- **`login` is `content.json`'s `login`, not its `handle`.** The handle is the drawn nickname
  (`LAZIE`); the login is the account the API is queried by (`saltless-bruh`). Passing the handle
  returns no user. `content.json` carries both keys and validates both.
- The cache is `cache/activity.json`, committed, parsed figures only, never a raw response and
  never a credential. It is created by the first authenticated refresh; until then a build fails
  loudly, which is the specified behaviour rather than a gap.
- Produces, Scan Sweep half, still to build: `scanDefs(a: Activity, col: number, row: number, theme: ThemeName): string`; `sweepDistance(a: Activity): number`; `scanCss(distance: number): string`; `PLAYBACK_SWEEP_START: number`.

- [ ] **Step 1: Write the failing tests**

As built in `test/activity.test.ts`, 37 tests. The sample that stood here handed the token in as an
argument, which the rules below forbid, so it was removed rather than left to be copied.

```ts
// test/scan.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { scanDefs, scanCss } from "../src/scan.ts";
import type { Activity } from "../src/session.ts";

const base: Activity = { totalContributions: 0, activeDays: 0, calendar: [], languages: [] };

test("an empty calendar renders an empty grid instead of crashing", () => {
  assert.doesNotThrow(() => scanDefs(base, 0, 0, "dark"));
});

test("an all-zero calendar does not divide by zero", () => {
  const a = { ...base, calendar: Array.from({ length: 30 }, (_, i) => ({ date: `d${i}`, count: 0 })) };
  const svg = scanDefs(a, 0, 0, "dark");
  assert.ok(!svg.includes("NaN"), "produced NaN");
  assert.ok(!svg.includes("Infinity"));
});

test("busier days are more opaque than quiet ones", () => {
  const a = { ...base, calendar: [{ date: "a", count: 1 }, { date: "b", count: 10 }] };
  const ops = [...scanDefs(a, 0, 0, "dark").matchAll(/opacity="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(ops[1] > ops[0], "intensity does not scale with count");
});

test("the beam animates only transform and never uses SMIL", () => {
  const css = scanCss(640);
  const inside = [...css.matchAll(/@keyframes[^{]+\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("");
  for (const p of [...inside.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])) {
    assert.ok(["opacity", "transform"].includes(p), `animates ${p}`);
  }
  assert.ok(!scanDefs(base, 0, 0, "dark").includes("<animate"));
});

test("the beam travels exactly the width of the calendar it is given", () => {
  const a = { ...base, calendar: Array.from({ length: 70 }, (_, i) => ({ date: `d${i}`, count: i % 4 })) };
  const d = sweepDistance(a);          // 70 days / 7 rows = 10 weeks
  assert.equal(d, 10 * 12);
  assert.ok(scanCss(d).includes(`translateX(${d}px)`));
});

test("the beam rests between passes instead of free-running", () => {
  // One pass inside a 60s loop, aligned with the mascot, not a short repeating cycle.
  assert.match(scanCss(640), /animation:\s*sweep\s+60s/);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/activity.test.ts test/scan.test.ts`
Expected: FAIL, cannot find modules.

- [ ] **Step 3: Implement the data layer**

As built in `src/activity.ts`. The sample that stood here read the token from `GITHUB_TOKEN`, took
it as a function argument and cached to `assets/activity.json`, all three of which are wrong, so it
was removed rather than left to be copied. Read the file, not a sketch of it. The decisions it
settles are recorded in `docs/spec.md` 5.1 to 5.4: the window and the calendar total, the gate over
the whole response body, pagination to the end, and where the credential is read from.

- [ ] **Step 4: Implement the Scan Sweep**

```ts
// src/scan.ts
import { CELL_W, CELL_H, PAD } from "./grid.ts";
import { PALETTES, type ThemeName } from "./tokens.ts";
import type { Activity } from "./session.ts";

const GRID_ROWS = 7;          // one row per weekday
const DOT = 10;               // dot size in units
const STEP_X = CELL_W;
const STEP_Y = CELL_H / 2;    // two weekday rows per text row, so 7 days fit 3.5 rows

/** How far the beam must travel to cross the whole calendar. */
export function sweepDistance(a: Activity): number {
  return Math.max(Math.ceil(a.calendar.length / GRID_ROWS), 1) * STEP_X;
}

/** The calendar as a grid of dots, with a beam that sweeps across it. */
export function scanDefs(a: Activity, col: number, row: number, theme: ThemeName): string {
  const p = PALETTES[theme];
  const x0 = PAD + col * CELL_W;
  const y0 = PAD + row * CELL_H;
  const max = a.calendar.reduce((m, d) => Math.max(m, d.count), 0);

  const dots = a.calendar.map((d, i) => {
    const cx = Math.floor(i / GRID_ROWS);
    const cy = i % GRID_ROWS;
    // max === 0 would divide by zero on a brand-new or empty calendar.
    const intensity = max === 0 ? 0 : d.count / max;
    const opacity = d.count === 0 ? "0.12" : (0.35 + 0.65 * intensity).toFixed(2);
    return `<rect x="${x0 + cx * STEP_X}" y="${y0 + cy * STEP_Y}" width="${DOT}" height="${DOT}" fill="${p.accent}" opacity="${opacity}"/>`;
  }).join("");

  const beam = `<rect class="beam" x="${x0}" y="${y0}" width="${STEP_X}" height="${GRID_ROWS * STEP_Y}" fill="${p.accent}" opacity="0"/>`;
  return `<g class="scan">${dots}${beam}</g>`;
}

/**
 * The beam is the widest moving thing on the page, so it does not free-run on a short
 * cycle. It crosses once during playback and then rests until the 60s Mascot boundary.
 */
export function scanCss(distance: number): string {
  return `
.beam { opacity: 0 }
.beam { animation: sweep 60s linear ${PLAYBACK_SWEEP_START}s infinite }
@keyframes sweep {
  0% { opacity: 0; transform: translateX(0) }
  1% { opacity: 0.35 }
  3.5% { opacity: 0.35; transform: translateX(${distance}px) }
  4.5% { opacity: 0; transform: translateX(${distance}px) }
  100% { opacity: 0; transform: translateX(${distance}px) }
}
`;
}

/** The sweep starts as the /activity output lands. */
export const PLAYBACK_SWEEP_START = 3.2;
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node --test test/activity.test.ts test/scan.test.ts`
Expected: PASS. The data half is 37 tests and already green, so add the scan tests alongside them.
Also run `npm run typecheck`, which is the project's strict check and part of Task 11's gate.

- [ ] **Step 6: Commit**

```bash
git add src/scan.ts test/scan.test.ts
git commit -m "feat: draw the contribution calendar as a swept scan"
```

---

### Task 9: Playback timeline and the build entrypoint

**Files:**
- Create: `src/playback.ts`, `src/build.ts`
- Modify: `src/svg.ts` (accept row classes for playback)
- Test: `test/playback.test.ts`, `test/build.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `playbackCss(marks: { row: number; at: number }[]): string`; `verbSchedule(verbs: Record<PoseName, string[]>, maxSlice?: number): { text: string; from: number; to: number }[]`; `spinnerCss(schedule): string`; `build(opts?: { outDir?: URL }): Promise<{ dark: string; light: string; transcript: string }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/playback.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { playbackCss, spinnerCss, verbSchedule } from "../src/playback.ts";
import { MASCOT_TIMELINE } from "../src/mascot.ts";

test("rows are visible by default so reduced motion shows the finished session", () => {
  const css = playbackCss([{ row: 0, at: 0.5 }]);
  assert.match(css, /text\s*\{[^}]*opacity:\s*1/);
});

test("playback runs once and holds its end state", () => {
  const css = playbackCss([{ row: 0, at: 0.5 }]);
  assert.match(css, /animation:[^;]*forwards/);
  assert.ok(!/infinite/.test(css.split("@keyframes")[0]), "playback must not loop");
});

const VERBS = {
  sleep: ["Loafing", "Dozing"], yawn: ["Yawning"], stretch: ["Stretching"],
  settle: ["Resettling"], startle: ["Startled"],
};

test("the spinner keeps running after playback", () => {
  assert.match(spinnerCss(verbSchedule(VERBS)), /infinite/);
});

test("every verb slice lies inside the mascot window it names", () => {
  const byState = new Map(MASCOT_TIMELINE.map((w, i) => [i, w]));
  for (const slice of verbSchedule(VERBS)) {
    const win = [...byState.values()].find((w) => slice.from >= w.from && slice.to <= w.to + 1e-9);
    assert.ok(win, `slice ${slice.text} ${slice.from}-${slice.to} straddles a window`);
    assert.ok(VERBS[win!.state].includes(slice.text), `${slice.text} is not a ${win!.state} word`);
  }
});

test("the yawn window is labelled Yawning, so the words match the picture", () => {
  const atYawn = verbSchedule(VERBS).find((s) => s.from >= 15 && s.to <= 18.4);
  assert.equal(atYawn?.text, "Yawning");
});

test("the long sleep window rotates rather than holding one word for 22s", () => {
  const sleepSlices = verbSchedule(VERBS).filter((s) => s.from >= 26.25 && s.to <= 48.75);
  assert.ok(sleepSlices.length > 1, "the long sleep window was not split");
  assert.ok(new Set(sleepSlices.map((s) => s.text)).size > 1, "it held a single word");
});

test("an empty verb list for a state is reported, not silently skipped", () => {
  assert.throws(() => verbSchedule({ ...VERBS, yawn: [] }), /verbs\.yawn/);
});

test("playback and spinner animate only opacity and transform", () => {
  const css = playbackCss([{ row: 1, at: 1 }]) + spinnerCss(verbSchedule(VERBS));
  const inside = [...css.matchAll(/@keyframes[^{]+\{([\s\S]*?)\n?\}/g)].map((m) => m[1]).join("");
  for (const p of [...inside.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])) {
    assert.ok(["opacity", "transform"].includes(p), `animates ${p}`);
  }
});
```

```ts
// test/build.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "../src/build.ts";

test("both variants build, are well formed and stay under the size limit", async () => {
  const { dark, light } = await build({ outDir: new URL("file:///tmp/build-test/") });
  for (const [name, svg] of [["dark", dark], ["light", light]] as const) {
    assert.match(svg, /^<svg /, `${name} is not an svg`);
    assert.match(svg, /<\/svg>$/, `${name} is truncated`);
    assert.ok(Buffer.byteLength(svg) <= 250_000, `${name} is ${Buffer.byteLength(svg)} bytes`);
    assert.ok(!svg.includes("<script"), `${name} contains a script`);
    assert.ok(!svg.includes("<animate"), `${name} uses SMIL`);
  }
});

test("the two variants differ only in their palette, never in their text", async () => {
  const { dark, light } = await build({ outDir: new URL("file:///tmp/build-test/") });
  const strip = (s: string) => s.replace(/#[0-9a-f]{6}/g, "#000000");
  assert.equal(strip(dark), strip(light));
});

test("the transcript reproduces the session as text", async () => {
  const { transcript } = await build({ outDir: new URL("file:///tmp/build-test/") });
  for (const cmd of ["/whoami", "/ops", "/stack", "/activity"]) assert.ok(transcript.includes(cmd));
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/playback.test.ts test/build.test.ts`
Expected: FAIL, cannot find modules.

- [ ] **Step 3: Implement playback**

```ts
// src/playback.ts
import { MASCOT_TIMELINE, MASTER_SECONDS, type PoseName } from "./mascot.ts";

export const PLAYBACK_END = 4.3;   // seconds; ambient motion starts after this

/** Rows fade in on a schedule. Base opacity is 1, so reduced motion shows the finished Session. */
export function playbackCss(marks: { row: number; at: number }[]): string {
  const rules = marks.map(({ row, at }) =>
    `text:nth-of-type(${row + 1}) { animation: appear 0.28s ${at.toFixed(2)}s backwards }`,
  ).join("\n");
  return `
text { opacity: 1 }
${rules}
@keyframes appear {
  0% { opacity: 0; transform: translateY(2px) }
  100% { opacity: 1; transform: translateY(0) }
}
`;
}

/**
 * Split the Mascot's timeline into verb slices. Each window shows that state's
 * words; a long window rotates through them so the sleep stretch does not sit on
 * one word for 22 seconds. The label therefore always names the pose on screen.
 */
export function verbSchedule(
  verbs: Record<PoseName, string[]>,
  maxSlice = 6,
): { text: string; from: number; to: number }[] {
  const out: { text: string; from: number; to: number }[] = [];
  const cursor: Record<string, number> = {};
  for (const win of MASCOT_TIMELINE) {
    const words = verbs[win.state];
    if (!words?.length) throw new Error(`content.json: verbs.${win.state} is empty`);
    const span = win.to - win.from;
    const slices = Math.max(1, Math.min(words.length, Math.round(span / maxSlice)));
    const each = span / slices;
    for (let i = 0; i < slices; i++) {
      const n = cursor[win.state] ?? 0;
      cursor[win.state] = n + 1;
      out.push({ text: words[n % words.length], from: win.from + i * each, to: win.from + (i + 1) * each });
    }
  }
  return out;
}

/** One text element per slice, revealed in its own window of the 60s master loop. */
export function spinnerCss(schedule: { text: string; from: number; to: number }[]): string {
  const pct = (s: number) => ((s / MASTER_SECONDS) * 100).toFixed(3);
  const rules = schedule.map((s, i) => {
    const on = `${pct(s.from)}% { opacity: 1 } ${pct(s.to)}% { opacity: 0 }`;
    const lead = s.from > 0 ? "0% { opacity: 0 } " : "";
    return `.verb-${i} { animation: verb-${i} ${MASTER_SECONDS}s step-end ${PLAYBACK_END}s infinite }
@keyframes verb-${i} { ${lead}${on} }`;
  }).join("\n");
  return `
.verb { opacity: 0 }
.verb-0 { opacity: 1 }
.spinner-glyph { animation: spin-glyph 1s steps(6) ${PLAYBACK_END}s infinite }
@keyframes spin-glyph { 0% { opacity: 1 } 50% { opacity: 0.45 } 100% { opacity: 1 } }
${rules}
`;
}
```

- [ ] **Step 4: Implement the build entrypoint**

```ts
// src/build.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadContent, assertNoForbiddenNames } from "./content.ts";
import { loadActivity } from "./github.ts";
import { composeSession } from "./session.ts";
import { assertFits, charsUsed, rowsToText } from "./rows.ts";
import { subsetToBase64, assertCovered } from "./font.ts";
import { buildSvg } from "./svg.ts";
import { bannerPath } from "./banner.ts";
import { mascotDefs, mascotCss, MASCOT_COLS } from "./mascot.ts";
import { scanDefs, scanCss, sweepDistance } from "./scan.ts";
import { playbackCss, spinnerCss, verbSchedule } from "./playback.ts";
import { colX, rowBaselineY } from "./grid.ts";
import { PALETTES, type ThemeName } from "./tokens.ts";


export async function build(opts?: { outDir?: URL }): Promise<{ dark: string; light: string; transcript: string }> {
  const outDir = opts?.outDir ?? new URL("../assets/", import.meta.url);
  mkdirSync(outDir, { recursive: true });

  const content = loadContent();
  const repoNames = content.lanes.flatMap((l) => l.repos.map((r) => r.name));
  // content.login is the account the API is queried by. content.handle is the drawn nickname and
  // would return no user. No token is passed: loadActivity reads PROFILE_GH_TOKEN itself, and the
  // cache defaults to cache/activity.json.
  const loaded = await loadActivity({ login: content.login, repoNames });
  // Stale figures are used but never passed off as fresh.
  if (loaded.staleNote !== null) console.warn(`warning: ${loaded.staleNote}`);
  const activity = loaded.activity;

  const { rows, scanRow, verbRow } = composeSession(content, activity);
  assertFits(rows);
  const schedule = verbSchedule(content.verbs);
  // The verb slices stack at one spot and are revealed one at a time by the spinner
  // CSS, so they are measured for width but never widen the Session.
  assertFits(schedule.map((s) => ({ runs: [{ col: 2, text: `${s.text}…` }] })));

  const transcript = rowsToText(rows);
  assertNoForbiddenNames(transcript, "the rendered session");

  const regular = readFileSync(new URL("../vendor/JetBrainsMono-Regular.ttf", import.meta.url));
  const boldTtf = readFileSync(new URL("../vendor/JetBrainsMono-Bold.ttf", import.meta.url));
  const chars = charsUsed(rows);
  assertCovered(regular, chars);
  const fontRegularB64 = await subsetToBase64(regular, chars);
  const fontBoldB64 = await subsetToBase64(boldTtf, chars);

  const marks = rows.map((_, i) => ({ row: i, at: Math.min(i * 0.05, 4.0) }));
  const css = [
    playbackCss(marks),
    spinnerCss(schedule),
    mascotCss(),
    scanCss(sweepDistance(activity)),
  ].join("\n");

  // One text element per verb slice, all at the spinner row, stacked.
  const verbDefs = schedule.map((s, i) =>
    `<text class="verb verb-${i} accent" x="${colX(2)}" y="${rowBaselineY(verbRow)}" xml:space="preserve">${s.text}…</text>`,
  ).join("\n");

  const variants = {} as Record<ThemeName, string>;
  for (const theme of ["dark", "light"] as ThemeName[]) {
    const defs = [
      mascotDefs(0, 0, theme),
      `<path d="${bannerPath(content.handle, MASCOT_COLS + 2, 0)}" fill="${PALETTES[theme].accent}"/>`,
      scanDefs(activity, 4, scanRow, theme),
      verbDefs,
    ].join("\n");
    const svg = await buildSvg({
      rows, theme, fontRegularB64, fontBoldB64, css, defs,
      title: `${content.handle}: ${content.role}`,
    });
    writeFileSync(new URL(`session-${theme}.svg`, outDir), svg);
    variants[theme] = svg;
  }

  return { dark: variants.dark, light: variants.light, transcript };
}

if (import.meta.main) {
  await build();
  console.log("wrote assets/session-dark.svg and assets/session-light.svg");
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node --test test/playback.test.ts test/build.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Build for real and look at it**

```bash
npm run build
node scripts/render-check.ts assets/session-dark.svg /tmp/session-dark.png
node scripts/render-check.ts assets/session-light.svg /tmp/session-light.png --light
node scripts/render-check.ts assets/session-dark.svg /tmp/session-phone.png --width=308
node scripts/render-check.ts assets/session-dark.svg /tmp/session-reduced.png --reduced
```

Expected: the Session reads as one terminal window; nothing overflows; the phone render is legible; the reduced-motion render is the finished Session with the Mascot asleep.

- [ ] **Step 7: Commit**

```bash
git add src/playback.ts src/build.ts src/svg.ts assets test/playback.test.ts test/build.test.ts
git commit -m "feat: playback timeline and build entrypoint"
```

---

### Task 10: README generation

**Files:**
- Create: `src/readme.ts`
- Modify: `src/build.ts` (call it at the end of `build`)
- Test: `test/readme.test.ts`

**Interfaces:**
- Consumes: `src/content.ts`, the transcript from `src/build.ts`.
- Produces: `renderReadme(o: { content: Content; transcript: string; altText: string }): string`.

- [ ] **Step 1: Write the failing test**

```ts
// test/readme.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { loadContent } from "../src/content.ts";
import { renderReadme } from "../src/readme.ts";

const md = () => renderReadme({ content: loadContent(), transcript: "❯ /whoami\n● hello", altText: "alt here" });

test("the picture swaps on theme and falls back to the dark variant", () => {
  const out = md();
  assert.match(out, /<source media="\(prefers-color-scheme: dark\)" srcset="assets\/session-dark\.svg">/);
  assert.match(out, /<source media="\(prefers-color-scheme: light\)" srcset="assets\/session-light\.svg">/);
  assert.match(out, /<img[^>]+src="assets\/session-dark\.svg"/);
});

test("the image carries alt text", () => {
  assert.match(md(), /alt="alt here"/);
});

test("the transcript ships as real selectable text", () => {
  const out = md();
  assert.match(out, /<details>/);
  assert.ok(out.includes("❯ /whoami"));
});

test("it uses no markup GitHub strips", () => {
  const out = md();
  for (const bad of ["<style", "<script", "<iframe", 'class="', "style=\""]) {
    assert.ok(!out.includes(bad), `uses ${bad}, which GitHub strips`);
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/readme.test.ts`
Expected: FAIL, cannot find module `../src/readme.ts`.

- [ ] **Step 3: Implement the README generator**

```ts
// src/readme.ts
import type { Content } from "./content.ts";

export function renderReadme(o: { content: Content; transcript: string; altText: string }): string {
  return `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/session-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/session-light.svg">
  <img src="assets/session-dark.svg" alt="${o.altText}" width="100%">
</picture>

<details>
<summary>Session transcript</summary>

\`\`\`
${o.transcript}
\`\`\`

</details>
`;
}
```

- [ ] **Step 4: Wire it into the build**

In `src/build.ts`, add the import and write the file before returning:

```ts
import { renderReadme } from "./readme.ts";
```

```ts
  const altText = `${content.handle}: ${content.role}. Terminal session listing projects and activity.`;
  writeFileSync(new URL("../README.md", import.meta.url),
    renderReadme({ content, transcript, altText }));
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node --test`
Expected: PASS, the whole suite.

- [ ] **Step 6: Commit**

```bash
git add src/readme.ts src/build.ts README.md test/readme.test.ts
git commit -m "feat: generate README with picture block and transcript"
```

---

### Task 11: Acceptance gates and the refresh workflow

**Files:**
- Create: `scripts/gates.ts`, `.github/workflows/refresh.yml`
- Test: `test/gates.test.ts`

**Interfaces:**
- Consumes: everything.
- Produces: `scanTreeForForbiddenNames(root: URL): string[]` (returns offending paths); `npm run gates`.
- Produces also: `scanTreeForSecrets(root: URL): string[]`, rejecting any token-shaped string in the
  tree. Added 2026-10-02, after a live token was pasted into a session: the gate exists so a credential
  cannot be committed even once. The same discipline as the forbidden-name gate, for the same reason.
- The token must never reach an error message, the Activity cache, or any generated asset. Auth is read
  from `PROFILE_GH_TOKEN` in the environment (see `.env.example`), never from an argument, a flag, or a
  committed file. The refresh workflow reads it from a repo secret of the same name.
- Produces also: an SVG structural check over every generated asset, via
  `~/.claude/skills/svg-foundry/scripts/check_svg.py`. It catches the failures that render as nothing
  rather than as an error: a `url(#id)` whose target is missing, two elements sharing an `id`, a
  malformed document, a missing `viewBox`. Today the generator emits **0 ids and 0 internal refs**, so
  nothing can break this way; the Scan Sweep is the first thing that could introduce one, which is why
  the gate goes in now rather than after the first silent blank. Run it on both Theme Variants.

- [ ] **Step 1: Write the failing test**

```ts
// test/gates.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { scanTreeForForbiddenNames } from "../scripts/gates.ts";
import { FORBIDDEN_NAMES } from "../src/content.ts";

test("a forbidden name anywhere in the tree is found and its file named", () => {
  const dir = new URL("file:///tmp/gate-scan/");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL("clean.md", dir), "nothing to see");
  writeFileSync(new URL("dirty.md", dir), `hello ${FORBIDDEN_NAMES[0]} goodbye`);
  const hits = scanTreeForForbiddenNames(dir);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /dirty\.md/);
});

test("the committed tree is clean", () => {
  assert.deepEqual(scanTreeForForbiddenNames(new URL("../", import.meta.url)), []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/gates.test.ts`
Expected: FAIL, cannot find module `../scripts/gates.ts`.

- [ ] **Step 3: Implement the gates**

```ts
// scripts/gates.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FORBIDDEN_NAMES } from "../src/content.ts";

const SKIP = new Set(["node_modules", ".git", "vendor", "docs"]);
const TEXT = /\.(md|json|ts|js|svg|yml|yaml|txt|html)$/i;

/** Paths of committed text files containing a forbidden name (ADR 0001). */
export function scanTreeForForbiddenNames(root: URL): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!TEXT.test(entry)) continue;
      const body = readFileSync(full, "utf8").toLowerCase();
      if (FORBIDDEN_NAMES.some((n) => n && body.includes(n.toLowerCase()))) hits.push(full);
    }
  };
  walk(fileURLToPath(root).replace(/\/$/, ""));
  return hits;
}

if (import.meta.main) {
  const root = new URL("../", import.meta.url);
  const failures: string[] = [];

  const hits = scanTreeForForbiddenNames(root);
  if (hits.length) failures.push(`forbidden name in: ${hits.join(", ")}`);

  for (const theme of ["dark", "light"]) {
    const path = new URL(`assets/session-${theme}.svg`, root);
    const svg = readFileSync(path, "utf8");
    const bytes = Buffer.byteLength(svg);
    if (bytes > 250_000) failures.push(`session-${theme}.svg is ${bytes} bytes, over the 250 KB limit`);
    if (svg.includes("<animate")) failures.push(`session-${theme}.svg uses SMIL, which ignores reduced motion`);
    if (svg.includes("<script")) failures.push(`session-${theme}.svg contains a script`);
    if (!/@media \(prefers-reduced-motion: reduce\)/.test(svg)) failures.push(`session-${theme}.svg has no reduced-motion rule`);
    for (const ch of "⎿✻✢✽✔✘◼◻⏵⏸") {
      if (svg.includes(ch)) failures.push(`session-${theme}.svg uses ${ch}, which the font cannot draw`);
    }
  }

  const readme = readFileSync(new URL("README.md", root), "utf8");
  for (const needle of ["session-dark.svg", "session-light.svg", "Session transcript"]) {
    if (!readme.includes(needle)) failures.push(`README.md is missing ${needle}`);
  }

  if (failures.length) {
    console.error("GATES FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("all gates passed");
}
```

Add the script:

```bash
npm pkg set scripts.gates="node scripts/gates.ts"
```

- [ ] **Step 4: Run the tests and the gates**

Run: `node --test test/gates.test.ts && npm run build && npm run gates`
Expected: tests PASS; gates print `all gates passed`.

- [ ] **Step 5: Write the refresh workflow**

```yaml
# .github/workflows/refresh.yml
name: Refresh profile

on:
  schedule:
    - cron: "17 4 * * *"      # daily, off the hour: scheduled runs are delayed at :00
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: refresh
  cancel-in-progress: true

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "26"

      - run: npm ci

      - run: npm test

      - name: Build the session
        env:
          PROFILE_GH_TOKEN: ${{ secrets.PROFILE_GH_TOKEN }}
        run: npm run build

      - run: npm run gates

      - name: Commit if anything changed
        run: |
          if [ -n "$(git status --porcelain assets cache README.md)" ]; then
            git config user.name "saltless-bruh"
            git config user.email "${{ github.actor_id }}+${{ github.actor }}@users.noreply.github.com"
            git add assets cache README.md
            git commit -m "chore: refresh profile session"
            git push
          else
            echo "nothing changed"
          fi
```

- [ ] **Step 6: Commit**

```bash
git add scripts/gates.ts .github/workflows/refresh.yml package.json test/gates.test.ts
git commit -m "feat: acceptance gates and daily refresh workflow"
```

---

### Task 12: Cross-browser verification and publishing

**Files:**
- Create: `scripts/verify-render.sh`
- Modify: `docs/adr/0004-one-session-image.md` (record the transcript block)

**Interfaces:**
- Consumes: the built assets.
- Produces: a set of screenshots covering every canvas and both engines.

- [ ] **Step 1: Write the verification script**

```bash
#!/usr/bin/env bash
# scripts/verify-render.sh - render every acceptance combination for eyeballing
set -euo pipefail
out=${1:-/tmp/verify}
mkdir -p "$out"

canvas_dark="0d1117"; canvas_dimmed="212830"; canvas_hc="010409"; canvas_light="ffffff"

shot() { # name svg canvas width extra...
  local name=$1 svg=$2 bg=$3 width=$4; shift 4
  google-chrome-stable --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --window-size=$((width + 40)),2400 --virtual-time-budget=6000 "$@" \
    --screenshot="$out/$name.png" \
    "data:text/html,<body style=\"margin:0;background:%23$bg\"><img src=\"file://$PWD/$svg\" style=\"width:${width}px;display:block\">"
}

shot chrome-dark-default assets/session-dark.svg  "$canvas_dark"   846
shot chrome-dark-dimmed  assets/session-dark.svg  "$canvas_dimmed" 846
shot chrome-dark-hc      assets/session-dark.svg  "$canvas_hc"     846
shot chrome-light        assets/session-light.svg "$canvas_light"  846
shot chrome-phone        assets/session-dark.svg  "$canvas_dark"   308
shot chrome-reduced      assets/session-dark.svg  "$canvas_dark"   846 --force-prefers-reduced-motion

firefox --headless --screenshot "$out/firefox-dark.png" --window-size=886,2400 \
  "data:text/html,<body style='margin:0;background:%23$canvas_dark'><img src='file://$PWD/assets/session-dark.svg' style='width:846px;display:block'>"

echo "screenshots in $out"
ls -la "$out"
```

```bash
chmod +x scripts/verify-render.sh
```

- [ ] **Step 2: Run it and inspect every output**

Run: `npm run build && ./scripts/verify-render.sh`

Check each screenshot against the spec's acceptance gates:
1. The window frame is visible against all four canvases.
2. The light variant does not disappear into white.
3. The phone render is legible.
4. The reduced-motion render equals the finished Session with the Mascot asleep.
5. Firefox matches Chrome.

Fix any failure in the owning module and rebuild before continuing.

- [ ] **Step 3: Record the transcript decision in ADR 0004**

Append to `docs/adr/0004-one-session-image.md`:

```markdown
## Amendment: the transcript block

The generator also emits the Session as plain text inside a `<details>` block under the image, so screen readers, search and copy-paste get real text and `alt` can stay a short description. This removes the accessibility cost listed above; the image remains the only visual.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-render.sh docs/adr/0004-one-session-image.md
git commit -m "feat: cross-browser verification script; record transcript amendment"
```

- [ ] **Step 5: Hand the publishing steps to the owner**

These need a browser and the owner's account, so they are not automated:

1. Fill in `content.json` (see `docs/EDITING.md`) and add private name spellings to `FORBIDDEN_NAMES` in `src/content.ts`.
2. Create the public repo `saltless-bruh/saltless-bruh` on github.com and push `main`.
3. Confirm the Session renders on the profile, in both themes.
4. On the profile page use "Customize your pins" to pin the six featured repos and unpin the retired one.
5. Check the profile on a phone, in Safari or iOS, and in the GitHub mobile app. Those three are untested here.

---

## Self-review

**Spec coverage.** Every section maps to a task: §2 pipeline → Tasks 9 and 11; §3.1 platform → Tasks 3 and 11; §3.2 grid → Task 1; §3.3 glyphs → Tasks 2 and 5; §3.4 palette → Task 1; §3.5 motion → Tasks 6, 8 and 9; §3.6 identity → Tasks 4 and 11; §4 content → Task 4; §5 data → Task 8; §6 gates → Tasks 11 and 12.

**Review Focus coverage.** (1) uncovered codepoint → `test/font.test.ts` and `test/content.test.ts`; (2) over-wide row → `test/rows.test.ts` and `test/session.test.ts`; (3) no token or cache → `test/activity.test.ts`; (4) empty or all-zero calendar → `test/scan.test.ts`; (5) forbidden name in fetched data → `loadActivity` plus `test/gates.test.ts`.

**Known rough edges for the implementer.** The Mascot art in Task 6 and the letterforms in Task 5 are starting silhouettes, not finished drawings; both tasks end with an eyeball step precisely because they need tuning against a real render. `BASELINE_IN_ROW` is a measured estimate to be confirmed in Task 3 Step 6. The Scan Sweep beam translation distance is hardcoded at 640px and should be derived from the calendar width once the real data lands.
