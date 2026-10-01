import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { subsetToBase64 } from "../src/font.ts";
import { buildSvg } from "../src/svg.ts";
import { CANVAS_W, FONT_SIZE, canvasH } from "../src/grid.ts";
import { PALETTES } from "../src/tokens.ts";
import type { ThemeName } from "../src/tokens.ts";

const regular = readFileSync(new URL("../vendor/JetBrainsMono-Regular.ttf", import.meta.url));
const bold = readFileSync(new URL("../vendor/JetBrainsMono-Bold.ttf", import.meta.url));

const CHARS = "HELO WRDx";
const regularB64 = await subsetToBase64(regular, CHARS);
const boldB64 = await subsetToBase64(bold, CHARS);

type Opts = Parameters<typeof buildSvg>[0];
const mk = (rows: Opts["rows"], theme: ThemeName = "dark", extra: Partial<Opts> = {}) =>
  buildSvg({ rows, theme, title: "test", fontRegularB64: regularB64, fontBoldB64: boldB64, ...extra });

const attrsOf = (tag: string): Record<string, string> =>
  Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const rects = (svg: string) => [...svg.matchAll(/<rect\b[^>]*>/g)].map((m) => attrsOf(m[0]));

const oneRow = [{ runs: [{ col: 0, text: "x" }] }];

test("the document is well-formed, self-contained and themed", async () => {
  const svg = await mk([{ runs: [{ col: 0, text: "HELLO WORLD", style: "accent" }] }]);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /viewBox="0 0 896 /);
  assert.match(svg, /#272e33/);                       // dark bg token
  assert.ok(!svg.includes("<script"), "must contain no script");
  assert.ok(!svg.includes("<animate"), "must use CSS keyframes, never SMIL");
});

test("nothing script-like or SMIL is emitted, even with caller css and defs", async () => {
  const svg = await mk(oneRow, "dark", { css: ".a{animation:k 1s infinite}", defs: '<g id="d"/>' });
  assert.ok(!/<(script|animate|animateTransform|animateMotion|set)\b/.test(svg));
  assert.ok(!/\son[a-z]+=/i.test(svg), "no inline event handlers");
});

test("the canvas is 896 wide and as tall as its rows, in viewBox, width and height alike", async () => {
  for (const n of [1, 5]) {
    const rows = Array.from({ length: n }, () => ({ runs: [{ col: 0, text: "x" }] }));
    const root = attrsOf((await mk(rows)).match(/^<svg\b[^>]*>/)![0]);
    const h = 16 + n * 24 + 16;
    assert.equal(h, canvasH(n));
    assert.equal(root.viewBox, `0 0 ${CANVAS_W} ${h}`);
    assert.equal(root.width, "896");
    assert.equal(root.height, String(h));
  }
});

test("the tag structure is balanced and nothing hostile in the title or text survives", async () => {
  const hostile = `A & B <script>"x"</script>`;
  const svg = await mk([{ runs: [{ col: 0, text: hostile }] }], "dark", { title: hostile });
  assert.ok(!svg.includes("<script"));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;)/.test(svg), "every ampersand starts a known entity");

  const stack: string[] = [];
  let tags = 0;
  for (const [, closing, name, selfClosing] of svg.matchAll(/<(\/?)([A-Za-z][\w:-]*)\b[^>]*?(\/?)>/g)) {
    tags++;
    if (closing) assert.equal(stack.pop(), name, `unbalanced </${name}>`);
    else if (!selfClosing) stack.push(name);
  }
  assert.deepEqual(stack, [], "every opened tag is closed");
  assert.equal((svg.match(/</g) ?? []).length, tags, "every < opens a real tag");
  assert.ok(svg.endsWith("</svg>"));
});

test("the title is the accessible name, in aria-label and in <title>, escaped", async () => {
  const svg = await mk(oneRow, "dark", { title: `Tom & "Jerry" <1>` });
  const root = attrsOf(svg.match(/^<svg\b[^>]*>/)![0]);
  assert.equal(root.role, "img");
  assert.equal(root["aria-label"], "Tom &amp; &quot;Jerry&quot; &lt;1&gt;");
  assert.ok(svg.includes("<title>Tom &amp; &quot;Jerry&quot; &lt;1&gt;</title>"));
});

test("both weights are embedded, so bold is never synthesised", async () => {
  const svg = await mk([{ runs: [{ col: 0, text: "x", style: "bold" }] }]);
  assert.equal([...svg.matchAll(/@font-face/g)].length, 2);
  assert.match(svg, /font-weight:400;src:url\(data:font\/woff2;base64,/);
  assert.match(svg, /font-weight:700;src:url\(data:font\/woff2;base64,/);
  assert.ok(!/font-weight:\s*400 700/.test(svg), "a 400-700 range would fake the bold");
});

test("each weight carries its own font file, not one subset declared twice", async () => {
  assert.notEqual(regularB64, boldB64, "precondition: the two subsets really differ");
  assert.ok(regularB64.startsWith("d09GMg"), "the payload is a woff2 file, as the data URI claims");
  assert.ok(boldB64.startsWith("d09GMg"));

  const svg = await mk(oneRow);
  const face = (weight: number) =>
    new RegExp(`@font-face\\{[^}]*font-weight:${weight};src:url\\(data:font/woff2;base64,([A-Za-z0-9+/=]+)\\) format\\("woff2"\\)\\}`).exec(svg)?.[1];
  assert.equal(face(400), regularB64);
  assert.equal(face(700), boldB64);
});

test("the faces and the text rule agree on one family and the grid font size", async () => {
  const svg = await mk(oneRow);
  const families = [...svg.matchAll(/font-family:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(families.length, 3, "two faces and the text rule");
  assert.equal(new Set(families).size, 1, `family names disagree: ${families.join(", ")}`);
  const textRule = /(?:^|[\s}])text\s*\{([^}]*)\}/.exec(svg)?.[1] ?? "";
  assert.match(textRule, new RegExp(`font-size:\\s*${FONT_SIZE}px`));
  assert.match(textRule, /white-space:\s*pre\b/);
});

test("ligatures are switched off, so the characters drawn are the characters in the transcript", async () => {
  // JetBrains Mono ships calt ligatures: "->" would draw one arrow glyph while the transcript keeps two characters.
  const textRule = /(?:^|[\s}])text\s*\{([^}]*)\}/.exec(await mk(oneRow))?.[1] ?? "";
  assert.match(textRule, /font-variant-ligatures:\s*none\b/);
  assert.match(textRule, /font-feature-settings:\s*"liga" 0,\s*"calt" 0\s*[;}]/);
});

test("the root asks for crisp edges, which the block-art banner and mascot depend on", async () => {
  for (const theme of ["dark", "light"] as const) {
    const root = attrsOf((await mk(oneRow, theme)).match(/^<svg\b[^>]*>/)![0]);
    assert.equal(root["shape-rendering"], "crispEdges");
  }
});

test("every style paints with its palette token, in both themes, and bold is weight 700", async () => {
  for (const theme of ["dark", "light"] as const) {
    const svg = await mk(oneRow, theme);
    const p = PALETTES[theme];
    const fill = (style: string) => new RegExp(`\\.${style}\\s*\\{\\s*fill:\\s*(#[0-9a-f]{6})`).exec(svg)?.[1];
    assert.equal(fill("text"), p.text, `${theme} text`);
    assert.equal(fill("muted"), p.muted, `${theme} muted`);
    assert.equal(fill("accent"), p.accent, `${theme} accent`);
    assert.equal(fill("warning"), p.warning, `${theme} warning`);
    assert.equal(fill("error"), p.error, `${theme} error`);
    assert.equal(fill("bold"), p.text, `${theme} bold`);
    assert.match(svg, /\.bold\s*\{[^}]*font-weight:\s*700/);
  }
});

test("a theme uses all of its own colours and none of the other theme's", async () => {
  for (const [theme, other] of [["dark", "light"], ["light", "dark"]] as const) {
    const svg = await mk(oneRow, theme);
    for (const key of ["bg", "border", "text", "muted", "accent", "warning", "error"] as const) {
      assert.ok(svg.includes(PALETTES[theme][key]), `${theme} svg is missing its own ${key}`);
      assert.ok(!svg.includes(PALETTES[other][key]), `${theme} svg leaks ${other}.${key}`);
    }
  }
});

test("the window is a themed background plus a one pixel frame drawn inside the canvas", async () => {
  for (const theme of ["dark", "light"] as const) {
    const [bg, frame, ...rest] = rects(await mk(oneRow, theme));
    const p = PALETTES[theme];
    const h = canvasH(1);
    assert.equal(rest.length, 0, "no other rects");
    assert.deepEqual(bg, { width: String(CANVAS_W), height: String(h), fill: p.bg });
    assert.deepEqual(frame, {
      x: "0.5", y: "0.5", width: String(CANVAS_W - 1), height: String(h - 1),
      fill: "none", stroke: p.border, "stroke-width": "1",
    });
  }
});

test("caller geometry sits above the frame and below the text, and unset options leave no trace", async () => {
  const svg = await mk(oneRow, "dark", { defs: '<g id="mascot-marker"/>' });
  const at = (s: string) => svg.indexOf(s);
  assert.ok(at("mascot-marker") > at("stroke-width"), "defs come after the frame");
  assert.ok(at("mascot-marker") < at("<text"), "defs come before the text");
  assert.ok(!(await mk(oneRow)).includes("undefined"), "absent css and defs render as nothing");
});

test("caller css lands after the base styles so it can override them", async () => {
  const svg = await mk(oneRow, "dark", { css: ".caller-css-marker{opacity:0.5}" });
  assert.equal([...svg.matchAll(/caller-css-marker/g)].length, 1);
  assert.ok(svg.indexOf("caller-css-marker") > svg.indexOf(".accent"));
  assert.ok(svg.indexOf("caller-css-marker") < svg.indexOf("</style>"));
});

test("reduced motion disables every animation", async () => {
  const svg = await mk([{ runs: [{ col: 0, text: "x" }] }]);
  assert.match(svg, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*\s*\{\s*animation:\s*none\s*!important/);
});

test("the reduced-motion rule comes last, so no caller css can follow and beat it", async () => {
  const svg = await mk(oneRow, "dark", { css: ".caller-css-marker{animation:k 1s infinite}" });
  assert.equal([...svg.matchAll(/prefers-reduced-motion: reduce/g)].length, 1);
  assert.ok(svg.indexOf("prefers-reduced-motion") > svg.indexOf("caller-css-marker"));
  assert.ok(svg.indexOf("prefers-reduced-motion") < svg.indexOf("</style>"));
});

test("the frame separates the window from every canvas it can sit on", async () => {
  // The window body is only 1.08:1 from GitHub's dimmed canvas, so the frame does the work.
  const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16);
    return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255); };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  // Read the frame colour out of the rendered document, so this fails if buildSvg stops using the border token.
  const frameOf = async (theme: ThemeName) => rects(await mk(oneRow, theme))[1].stroke;
  const dark = await frameOf("dark");
  for (const canvas of ["#0d1117", "#212830", "#010409"]) {
    assert.ok(ratio(dark, canvas) >= 3, `dark frame vs ${canvas} is ${ratio(dark, canvas).toFixed(2)}`);
  }
  assert.ok(ratio(await frameOf("light"), "#ffffff") >= 3);
});
