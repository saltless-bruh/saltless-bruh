import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "../src/build.ts";
import type { Transport } from "../src/activity.ts";
import { TOKEN_ENV } from "../src/activity.ts";
import { COMMITTED_FORBIDDEN_NAMES, FORBIDDEN_NAMES, FORBIDDEN_NAMES_ENV, loadContent } from "../src/content.ts";
import { FORBIDDEN_GLYPHS } from "../src/font.ts";
import {
  GENERATED, MIN_TRANSCRIPT_ROWS, SIZE_BUDGET_BYTES, SVG_CHECK_SCRIPT,
  checkSvgStructure, countNamesIn, exitCodeFor, externalSvgCheck, findAbsentGlyphs,
  findControlCharacters, findDashes, findReadmeFaults, findReducedMotionFaults,
  envFileVerdict, findSecretShapes, findSizeFaults, forbiddenNeedles, listFiles, report, runGates,
  runTypecheck, scanTreeForForbiddenNames, scanTreeForSecrets, svgReferenceCounts,
} from "../scripts/gates.ts";
import type { GateResult, GateStatus } from "../scripts/gates.ts";

// ---------------------------------------------------------------------------------------------
// WHY SO MANY STRINGS IN HERE ARE BUILT RATHER THAN WRITTEN OUT
//
// This file tests gates that scan the tree, and this file is in the tree. Any credential-shaped
// literal written out here would be found by the very gate it is testing, so every sample below
// is ASSEMBLED from pieces that are individually harmless: `"ghp_" + "a1B2".repeat(9)` carries no
// token-shaped run of characters on disk and is one at runtime. The dashes are written as `\u2014`
// and `\u2013` for the same reason, and the glyphs the font cannot draw are taken from the
// imported list rather than retyped. A test that had to be excused from its own gate would not be
// testing that gate.
//
// `test/activity.test.ts` solved the same problem a different way, by shaping its stand-in so the
// gate cannot match it. Both are the same discipline: the tree stays clean, measurably.
// ---------------------------------------------------------------------------------------------

const ROOT = new URL("../", import.meta.url);
const url = (dir: string): URL => pathToFileURL(`${dir}/`);
const scratch = (): string => mkdtempSync(join(tmpdir(), "gates-test-"));

const gateNamed = (results: GateResult[], gate: string): GateResult => {
  const found = results.find((r) => r.gate === gate);
  assert.ok(found !== undefined, `there is no gate called ${JSON.stringify(gate)}; there are ${results.map((r) => r.gate).join(", ")}`);
  return found;
};

const result = (gate: string, status: GateStatus): GateResult => ({ gate, status, detail: "", problems: status === "fail" ? ["x"] : [] });

// ---------------------------------------------------------------------------------------------
// A tree with every generated file in it, built through the real pipeline over a fixture
// response. There is deliberately no seam that hands `build` a ready-made Activity, so the only
// honest way to get a built tree is to drive the fetch.
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

const fixture: Transport = async (request) => {
  const content = loadContent();
  const end = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const days = Array.from({ length: 371 }, (_, i) => ({
    date: new Date(end - (370 - i) * DAY_MS).toISOString().slice(0, 10),
    contributionCount: i % 7,
  }));
  const user: Record<string, unknown> = {
    repositories: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: content.lanes.flatMap((l) => l.repos.map((r, i) => ({
        name: r.name,
        languages: { edges: [
          { size: 90_000 - i * 1_000, node: { name: "Python" } },
          { size: 40_000, node: { name: "Rust" } },
          { size: 21_000, node: { name: "TypeScript" } },
        ] },
      }))),
    },
  };
  if (request.variables.withCalendar === true) {
    user.contributionsCollection = {
      contributionCalendar: {
        totalContributions: days.reduce((s, d) => s + d.contributionCount, 0),
        weeks: Array.from({ length: Math.ceil(days.length / 7) }, (_, w) => ({ contributionDays: days.slice(w * 7, w * 7 + 7) })),
      },
    };
  }
  return JSON.stringify({ data: { user } });
};

let built: string | null = null;

/** A repository-shaped temp tree holding assets/, README.md, cache/ and content.json. */
async function builtTree(): Promise<string> {
  if (built !== null) return built;
  const dir = scratch();
  writeFileSync(join(dir, "content.json"), readFileSync(new URL("content.json", ROOT), "utf8"));
  await build({
    outDir: url(join(dir, "assets")),
    cachePath: pathToFileURL(join(dir, "cache", "activity.json")),
    transport: fixture,
    log: () => {},
  });
  built = dir;
  return dir;
}

// ---------------------------------------------------------------------------------------------
// The file list every scanning gate rests on
// ---------------------------------------------------------------------------------------------

test("the file list is what a commit could carry: git's ignore rules, and no binaries", () => {
  const files = listFiles(ROOT);
  assert.ok(files.includes("src/content.ts"), "a tracked source file is missing from the list");
  assert.ok(files.includes("content.json"), "the owner's copy is missing from the list");
  assert.ok(files.includes("scripts/gates.ts"), "the gates do not scan themselves");
  // Gitignored, and present on this machine: the drafts and research notes that carry the real
  // name, and the local credential file. Reading any of them would make the gate fail on the one
  // place the project deliberately keeps those things (docs/spec.md 5.2, .gitignore).
  for (const ignored of ["docs/research/", "preview/", ".superpowers/"]) {
    assert.ok(!files.some((f) => f === ignored || f.startsWith(ignored)), `${ignored} is being scanned, and git ignores it`);
  }
  assert.ok(!files.includes("saltless-bruh-profile-3a.html"), "the gitignored draft is being scanned");
  assert.ok(!files.some((f) => f.endsWith(".ttf")), "a font binary is being read as text");
  assert.ok(!files.some((f) => f.startsWith("node_modules/")), "node_modules is being scanned");
});

test("git's ignore rules decide what is scanned, so a token in its one sanctioned home is not a finding", () => {
  // This is the property the whole file list rests on, and it needs a real repository to exist at
  // all. The credential belongs in a gitignored `.env` (docs/spec.md 5.2); the same string in a
  // file a commit would carry is a breach. A hand-written skip list here instead of git's own
  // rules could only ever drift from `.gitignore`, and the dangerous direction of that drift is
  // a skip this file has that `.gitignore` does not: a hole the gate cannot see.
  const dir = scratch();
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(join(dir, ".gitignore"), ".env\n");
  writeFileSync(join(dir, ".env"), `${TOKEN_ENV}=${"a1B2".repeat(9)}\n`);
  writeFileSync(join(dir, "leaked.ts"), `const t = "ghp_${"a1B2".repeat(9)}";\n`);
  assert.ok(!listFiles(url(dir)).includes(".env"), "the gitignored credential file is being scanned");
  assert.deepEqual(scanTreeForSecrets(url(dir)).map((h) => h.split(":")[0]), ["leaked.ts"]);
});

test("outside a git work tree the list falls back to walking, subdirectories included", () => {
  const dir = scratch();
  mkdirSync(join(dir, "deep", "deeper"), { recursive: true });
  writeFileSync(join(dir, "deep", "deeper", "a.md"), "x");
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "node_modules", "b.md"), "y");
  assert.deepEqual(listFiles(url(dir)), ["deep/deeper/a.md"]);
});

// ---------------------------------------------------------------------------------------------
// Gate: forbidden names (ADR 0001)
// ---------------------------------------------------------------------------------------------

test("a forbidden name anywhere in the tree is found and its file named", () => {
  const dir = scratch();
  writeFileSync(join(dir, "clean.md"), "nothing to see");
  writeFileSync(join(dir, "dirty.md"), `hello ${FORBIDDEN_NAMES[0]} goodbye`);
  assert.deepEqual(scanTreeForForbiddenNames(url(dir)), ["dirty.md"]);
});

test("the scan reaches fetched data, not only hand-written content", () => {
  // The cache is fetched figures, written by the build and committed, and it is a subdirectory
  // deep: a scan that stopped at the top level or skipped cache/ would walk straight past it.
  const dir = scratch();
  mkdirSync(join(dir, "cache"), { recursive: true });
  writeFileSync(join(dir, "cache", "activity.json"), JSON.stringify({
    fetchedAt: new Date().toISOString(),
    activity: { languages: [{ name: FORBIDDEN_NAMES[0], bytes: 1 }] },
  }));
  assert.deepEqual(scanTreeForForbiddenNames(url(dir)), ["cache/activity.json"]);
});

test("the name match is case-insensitive, because a lowercase spelling is the same disclosure", () => {
  const dir = scratch();
  writeFileSync(join(dir, "shouty.md"), FORBIDDEN_NAMES[0].toUpperCase());
  writeFileSync(join(dir, "quiet.md"), FORBIDDEN_NAMES[0].toLowerCase());
  assert.deepEqual(scanTreeForForbiddenNames(url(dir)), ["quiet.md", "shouty.md"]);
});

test("the paths a hit reports do not repeat the name they found", () => {
  const dir = scratch();
  writeFileSync(join(dir, "dirty.md"), FORBIDDEN_NAMES[0]);
  for (const hit of scanTreeForForbiddenNames(url(dir))) {
    assert.ok(!hit.toLowerCase().includes(FORBIDDEN_NAMES[0].toLowerCase()), "the scan echoed the name it is protecting");
  }
});

test("an empty needle list is refused rather than passing for every tree there is", () => {
  assert.throws(() => forbiddenNeedles([]), /every tree/);
  assert.throws(() => forbiddenNeedles(["", "  "]), /every tree/);
  assert.deepEqual(forbiddenNeedles([" Some Name ", "Other"]), ["some name", "other"]);
});

test("with no private names configured the tree scan reports unchecked, not clean", () => {
  // ABSENT and not PASS. The committed half of the list is a public demonstration value, so
  // scanning the tree for it would report this gate's own source and the files that test it.
  // "Nothing was checked" must not read as "the tree is clean" (ADR 0001).
  const dir = scratch();
  const gate = gateNamed(runGates(url(dir), { typecheck: false }), "forbidden names");
  if (process.env.PROFILE_FORBIDDEN_NAMES) {
    assert.equal(gate.status, "pass", "with names configured the scan should actually run");
    return;
  }
  assert.equal(gate.status, "absent");
  assert.match(gate.detail, /PROFILE_FORBIDDEN_NAMES/);
  assert.notEqual(gate.status, "pass");
});

test("the committed placeholder reaching a published surface is caught, where a tree scan cannot", () => {
  const dir = scratch();
  writeFileSync(join(dir, "content.json"), JSON.stringify({ role: COMMITTED_FORBIDDEN_NAMES[0] }));
  const results = runGates(url(dir), { typecheck: false });
  assert.equal(gateNamed(results, "placeholder names").status, "fail");
  assert.equal(exitCodeFor(results), 1);
  assert.equal(countNamesIn("nothing here", COMMITTED_FORBIDDEN_NAMES), 0);
  assert.equal(countNamesIn(COMMITTED_FORBIDDEN_NAMES[0], COMMITTED_FORBIDDEN_NAMES), 1);
});

// ---------------------------------------------------------------------------------------------
// Gate: secrets
// ---------------------------------------------------------------------------------------------

/** Every shape the gate claims to know, assembled rather than written out. */
const SHAPED: [string, string][] = [
  ["a GitHub classic token", `ghp_${"a1B2".repeat(9)}`],
  ["a GitHub OAuth token", `gho_${"a1B2".repeat(9)}`],
  ["a GitHub fine-grained token", `github_pat_${"A1b".repeat(10)}`],
  ["an Anthropic key", `sk-ant-api03-${"A1b".repeat(10)}`],
  ["an OpenAI key", `sk-${"A1b".repeat(12)}`],
  ["an AWS access key id", `AKIA${"ABCDEFGH".repeat(2)}`],
  ["a Slack token", `xoxb-${"1a2B".repeat(4)}`],
  ["a Google API key", `AIza${"a1B2".repeat(8)}abc`],
  ["a PEM private key", `-----BEGIN RSA PRIVATE${" KEY-----"}\nbody\n`],
  ["a JWT", `eyJ${"a1B".repeat(5)}.${"c2D".repeat(5)}.${"e3F".repeat(5)}`],
  ["the project's own variable with a value", `${TOKEN_ENV}=${"a1B2".repeat(6)}`],
  ["a credential assigned to a key named for one", `my_token: ${"a1B2".repeat(6)}`],
  ["a legacy lowercase-hex token assigned to one", `password = ${"0123456789abcdef".repeat(3)}`],
];

test("every token shape the gate claims to know is caught", () => {
  for (const [what, sample] of SHAPED) {
    assert.ok(findSecretShapes(sample).length > 0, `${what} is not caught`);
  }
});

test("a secret anywhere in the tree is found, with the file and the shape but never the value", () => {
  const dir = scratch();
  const secret = `ghp_${"a1B2".repeat(9)}`;
  writeFileSync(join(dir, "clean.ts"), "export const x = 1;\n");
  writeFileSync(join(dir, "leaked.ts"), `const t = "${secret}";\n`);
  const hits = scanTreeForSecrets(url(dir));
  assert.equal(hits.length, 1, `expected one hit, got ${hits.join(" | ")}`);
  assert.match(hits[0], /^leaked\.ts: /);
  assert.ok(!hits.join("").includes(secret), "the gate printed the credential it caught");
});

test("the workflow's own secrets reference is not read as the secret itself", () => {
  // The one legitimate spelling of the variable next to a value. If this matched, the gate would
  // fail on the workflow that exists to keep the token out of the tree.
  assert.deepEqual(findSecretShapes(`          ${TOKEN_ENV}: \${{ secrets.${TOKEN_ENV} }}\n`), []);
  assert.deepEqual(findSecretShapes(`${TOKEN_ENV}=\n`), [], "an empty value in .env.example is not a secret");
  // The blank value must not reach past the end of its line for a character to match, which is
  // why the whitespace around the `=` is horizontal only. `\s*` would read the next setting's
  // name as this variable's value, and `.env.example` has a blank value by design.
  assert.deepEqual(findSecretShapes(`${TOKEN_ENV}=\nOTHER_SETTING=value\n`), [], "a blank value reached forward into the next line");
  assert.deepEqual(findSecretShapes(`if [ -z "\${${TOKEN_ENV}}" ]; then\n`), []);
});

test("the stand-in in test/activity.test.ts does not trip the gate it exists to defend", () => {
  const activityTest = readFileSync(new URL("test/activity.test.ts", ROOT), "utf8");
  assert.match(activityTest, /TOKEN-VALUE-THAT-MUST-NEVER-APPEAR/, "premise: the stand-in is still there");
  assert.deepEqual(findSecretShapes(activityTest), []);
});

test("a documentation placeholder is not a credential, and a real value in the same file still is", () => {
  // The gate fired on docs/EDITING.md, which exists to explain what to write, and took the whole
  // run down with it. The fix is on the VALUE and never on the path: see the next test.
  for (const placeholder of ["your-token", "REPLACE_ME", "not-a-real-token", "paste.it.here", "a1"]) {
    assert.deepEqual(findSecretShapes(`${TOKEN_ENV}=${placeholder}`), [], `${placeholder} reads as a credential`);
  }
  // And the loosening has NOT become "a document is never scanned", which is the mutation that
  // would make this gate quietly useless.
  const realistic = `${TOKEN_ENV}=${"a1B2".repeat(9)}`;
  assert.ok(findSecretShapes(realistic).length > 0, "a realistic generated value no longer fires");
  const doc = `Copy .env.example to .env and fill it in:\n\n    ${TOKEN_ENV}=your-token\n`;
  assert.deepEqual(findSecretShapes(doc), [], "the documented example fires");
  assert.ok(findSecretShapes(`${doc}\n    ${realistic}\n`).length > 0, "a real token pasted into the same document does not fire");
});

test("the placeholder exemption is on the value, never on the path", () => {
  // Exempting docs/ would have been the easy move and it removes the case most worth catching: a
  // document is exactly where somebody pastes a real token while writing an example.
  const dir = scratch();
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "HOWTO.md"), `${TOKEN_ENV}=${"a1B2".repeat(9)}\n`);
  writeFileSync(join(dir, "docs", "FINE.md"), `${TOKEN_ENV}=your-token\n`);
  // One entry per file and SHAPE, so the realistic value is reported under both labels it fits.
  // What matters here is which files are named at all.
  assert.deepEqual([...new Set(scanTreeForSecrets(url(dir)).map((h) => h.split(":")[0]))], ["docs/HOWTO.md"]);
});

test("the page that documents the setting is not blocked by the gate that protects it", () => {
  // A live fixture: the real file, in the real tree, as the gate reads it.
  const editing = readFileSync(new URL("docs/EDITING.md", ROOT), "utf8");
  assert.match(editing, new RegExp(`${TOKEN_ENV}=your-token`), "premise: the page still shows a placeholder value");
  assert.deepEqual(findSecretShapes(editing), []);
});

test("ordinary content is not read as a credential", () => {
  // The two shapes that would make an entropy rule unusable here, measured rather than assumed.
  assert.deepEqual(findSecretShapes('"integrity": "sha512-' + "a1B2".repeat(22) + '=="'), []);
  assert.deepEqual(findSecretShapes("src:url(data:font/woff2;base64," + "a1B2".repeat(500) + ')'), []);
  assert.deepEqual(findSecretShapes("@keyframes row-arrive { 0% { opacity: 0 } }"), []);
  assert.deepEqual(findSecretShapes("password: hunter2"), []);
});

// ---------------------------------------------------------------------------------------------
// Gate: dashes, in visible copy only
// ---------------------------------------------------------------------------------------------

test("an em-dash and an en-dash are both found, and the line is named", () => {
  assert.deepEqual(findDashes(`clean\nbefore \u2014 after\nalso \u2013 here`), [
    "line 2 carries an em-dash",
    "line 3 carries an en-dash",
  ]);
});

test("a hyphen, a minus and a middle dot are not dashes", () => {
  assert.deepEqual(findDashes("a-b · c − d"), []);
});

test("an em-dash in the owner's copy fails the gate, because content.json is read aloud", () => {
  const dir = scratch();
  const clean = readFileSync(new URL("content.json", ROOT), "utf8");
  assert.deepEqual(findDashes(clean), [], "premise: the committed copy has no dashes");
  writeFileSync(join(dir, "content.json"), clean.replace("offensive security", "offensive \u2014 security"));
  const results = runGates(url(dir), { typecheck: false });
  const gate = gateNamed(results, "dashes in content.json");
  assert.equal(gate.status, "fail");
  assert.match(gate.problems.join("\n"), /em-dash/);
  assert.equal(exitCodeFor(results), 1);
});

test("the dash gate reads the generated output and the owner's copy, and nothing else", () => {
  // RULED SCOPE, not an oversight. The ban is a copy rule: an em-dash is an AI-writing tell in
  // prose a stranger reads. A comment in a build script is not that, and `scripts/mutation-check.ts`
  // carries one today and is correct there. A guard people have to fight is a guard people switch
  // off, which is why the WINDOW_DAYS guard was narrowed the same way.
  const harness = readFileSync(new URL("scripts/mutation-check.ts", ROOT), "utf8");
  assert.match(harness, /\u2014/, "premise: the harness carries an em-dash in a comment");
  const dashGates = runGates(ROOT, { typecheck: false }).filter((r) => r.gate.startsWith("dashes"));
  assert.deepEqual(dashGates.map((r) => r.gate), [
    "dashes in content.json",
    "dashes in the assets",
    "dashes in the readme",
  ]);
  assert.deepEqual(dashGates.filter((r) => r.status === "fail"), [], "the dash gate reached source it was not meant to");
});

// ---------------------------------------------------------------------------------------------
// Gate: control characters in generated output
// ---------------------------------------------------------------------------------------------

test("every control character in generated output is caught, and the newline is not one", () => {
  assert.deepEqual(findControlCharacters("a\nb\nc\n"), [], "the newline is the one control character a transcript is made of");
  for (const [ch, name] of [["\t", "0009"], ["\r", "000D"], ["\u0000", "0000"], ["\u001b", "001B"], ["\u007f", "007F"], ["\u009f", "009F"], ["\ufeff", "FEFF"]] as [string, string][]) {
    assert.match(findControlCharacters(`ok${ch}ok`).join(), new RegExp(`U\\+${name}`), `U+${name} is not caught`);
  }
});

test("the control-character finding names the line and the codepoint, not the text around it", () => {
  assert.deepEqual(findControlCharacters("fine\nbroken\tthing"), ["line 2 carries a control character, U+0009"]);
});

// ---------------------------------------------------------------------------------------------
// Gate: glyphs the font cannot draw
// ---------------------------------------------------------------------------------------------

test("every glyph JetBrains Mono cannot draw is caught in a generated asset", () => {
  assert.equal([...FORBIDDEN_GLYPHS].length, 10, "the absent-glyph list has changed size");
  for (const ch of FORBIDDEN_GLYPHS) {
    const found = findAbsentGlyphs(`<svg><text>result ${ch} here</text></svg>`);
    assert.equal(found.length, 1, `${JSON.stringify(ch)} renders as a blank box and the gate did not notice`);
    assert.ok(!found[0].includes(ch), "the finding should name the codepoint, which survives a terminal that cannot draw it");
  }
});

test("the glyphs the Session actually uses are not flagged", () => {
  assert.deepEqual(findAbsentGlyphs("<svg><text>❯ ● ╰ ─ │ ✓ ✗ ⚠ ▲ ▶ ■ □ · ∙ • ✶ ○ ◌ ◉</text></svg>"), []);
});

// ---------------------------------------------------------------------------------------------
// Gate: reduced motion
// ---------------------------------------------------------------------------------------------

const MOTION_RULE = "@media (prefers-reduced-motion: reduce){*{animation:none!important}}";

test("the rule as the generator writes it passes, and its absence is caught", () => {
  assert.deepEqual(findReducedMotionFaults(`<svg><style>${MOTION_RULE}</style></svg>`), []);
  assert.match(findReducedMotionFaults("<svg><style>.row{animation:a 1s}</style></svg>").join(), /prefers-reduced-motion/);
});

test("a reduced-motion rule that does not zero the animation is caught", () => {
  // The invisible failure: the media query is there, so a reviewer scanning for it sees it, and
  // the motion still runs for the reader who asked for none.
  for (const gutted of [
    "@media (prefers-reduced-motion: reduce){*{transition:none!important}}",
    "@media (prefers-reduced-motion: reduce){.row{animation:none!important}}",
    "@media (prefers-reduced-motion: reduce){*{animation:none}}",
  ]) {
    assert.match(findReducedMotionFaults(`<svg><style>${gutted}</style></svg>`).join(), /prefers-reduced-motion/, `${gutted} passed`);
  }
});

test("SMIL is caught even with the rule in place, because SMIL ignores it", () => {
  for (const el of ["animate", "animateTransform", "animateMotion", "set"]) {
    const found = findReducedMotionFaults(`<svg><style>${MOTION_RULE}</style><${el} attributeName="x"/></svg>`);
    assert.equal(found.length, 1, `<${el}> was not noticed`);
    assert.match(found[0], /SMIL/);
  }
});

// ---------------------------------------------------------------------------------------------
// Gate: SVG structure
// ---------------------------------------------------------------------------------------------

const OK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 896 100" width="896" height="100" role="img" aria-label="x" shape-rendering="crispEdges">'
  + "<title>a session</title><rect width=\"896\" height=\"100\" fill=\"#272e33\"/></svg>";

test("a sound document passes the structural check", () => {
  assert.deepEqual(checkSvgStructure(OK_SVG), []);
});

test("every structural fault that paints nothing and raises nothing is caught", () => {
  const faults: [string, string, RegExp][] = [
    ["a reference with no target", OK_SVG.replace('fill="#272e33"', 'fill="url(#sweep)"'), /undefined id/],
    ["a duplicate id", OK_SVG.replace("<title>", '<g id="a"/><g id="a"/><title>'), /duplicate id/],
    ["no viewBox", OK_SVG.replace(' viewBox="0 0 896 100"', ""), /no viewBox/],
    ["a viewBox of three numbers", OK_SVG.replace('viewBox="0 0 896 100"', 'viewBox="0 0 896"'), /four numbers/],
    ["a box the art is letterboxed in", OK_SVG.replace('height="100" role', 'height="400" role'), /letterboxed/],
    ["no accessible name", OK_SVG.replace("<title>a session</title>", ""), /no <title>/],
    ["a title nothing announces", OK_SVG.replace(' role="img"', ""), /role="img"/],
    ["a script", OK_SVG.replace("<title>", "<script>alert(1)</script><title>"), /script/],
    ["an inline event handler", OK_SVG.replace("<rect ", '<rect onload="x()" '), /event handler/],
    ["not an svg at all", "<html><body>no</body></html>", /not an SVG/],
  ];
  for (const [what, broken, expected] of faults) {
    const found = checkSvgStructure(broken);
    assert.ok(found.length > 0, `${what} was not caught`);
    assert.match(found.join("\n"), expected, `${what} was caught, but not described`);
  }
});

test("the reference counts are reported, so today's zero and zero stopping being true is visible", () => {
  assert.deepEqual(svgReferenceCounts(OK_SVG), { ids: 0, refs: 0 });
  assert.deepEqual(
    svgReferenceCounts('<svg><linearGradient id="g"/><rect fill="url(#g)"/><use href="#g"/></svg>'),
    { ids: 1, refs: 1 },
  );
});

test("svg-foundry's own checker is a cross-check, and its absence is not a silent pass", (t) => {
  assert.deepEqual(externalSvgCheck(["whatever.svg"], "/nonexistent/check_svg.py"), { ran: false, problems: [] });
  if (!existsSync(SVG_CHECK_SCRIPT)) {
    t.skip(`${SVG_CHECK_SCRIPT} is not installed here; the native checks above cover the same faults`);
    return;
  }
  const dir = scratch();
  const good = join(dir, "good.svg");
  const bad = join(dir, "bad.svg");
  writeFileSync(good, OK_SVG);
  writeFileSync(bad, OK_SVG.replace('fill="#272e33"', 'fill="url(#sweep)"'));
  assert.deepEqual(externalSvgCheck([good]), { ran: true, problems: [] });
  const broken = externalSvgCheck([bad]);
  assert.equal(broken.ran, true);
  assert.match(broken.problems.join("\n"), /sweep/);
});

// ---------------------------------------------------------------------------------------------
// Gate: size budget
// ---------------------------------------------------------------------------------------------

test("an asset over the budget is caught, and the budget is bytes rather than characters", () => {
  assert.equal(SIZE_BUDGET_BYTES, 250_000);
  assert.deepEqual(findSizeFaults("a".repeat(SIZE_BUDGET_BYTES)), []);
  assert.match(findSizeFaults("a".repeat(SIZE_BUDGET_BYTES + 1)).join(), /over the/);
  // The Session is drawn with box-drawing characters, every one of them three bytes of UTF-8, so
  // a length counted in characters understates the file that actually ships by a factor of three.
  const multibyte = "─".repeat(Math.ceil(SIZE_BUDGET_BYTES / 3));
  assert.ok(multibyte.length < SIZE_BUDGET_BYTES, "premise: counted in characters this is inside the budget");
  assert.match(findSizeFaults(multibyte).join(), /over the/, "the budget is being counted in characters");
});

// ---------------------------------------------------------------------------------------------
// Gate: the README
// ---------------------------------------------------------------------------------------------

const TRANSCRIPT = Array.from({ length: MIN_TRANSCRIPT_ROWS + 4 }, (_, i) => `row ${i}`).join("\n");
const OK_README = [
  "<picture>",
  '  <source media="(prefers-color-scheme: dark)" srcset="assets/session-dark.svg">',
  '  <source media="(prefers-color-scheme: light)" srcset="assets/session-light.svg">',
  '  <img src="assets/session-dark.svg" alt="a terminal session" width="100%">',
  "</picture>",
  "",
  "<details>",
  "<summary>Session transcript</summary>",
  "",
  "```",
  TRANSCRIPT,
  "```",
  "",
  "</details>",
  "",
].join("\n");

const bothThere = (src: string): boolean => src === "assets/session-dark.svg" || src === "assets/session-light.svg";

test("a sound README passes", () => {
  assert.deepEqual(findReadmeFaults(OK_README, bothThere), []);
});

test("the markup GitHub strips silently is caught, every kind of it", () => {
  for (const [markup, expected] of [
    ["<script>x()</script>", /<script>/],
    ["<style>.a{}</style>", /<style>/],
    ['<p style="color:red">x</p>', /inline style/],
    ['<iframe src="x"></iframe>', /<iframe>/],
    ["<svg><rect/></svg>", /inline <svg>/],
  ] as [string, RegExp][]) {
    const found = findReadmeFaults(`${OK_README}\n${markup}\n`, bothThere);
    assert.ok(found.length > 0, `${markup} was not caught`);
    assert.match(found.join("\n"), expected);
  }
});

test("a README that does not really reference both assets is caught", () => {
  const faults: [string, string, RegExp][] = [
    ["no dark source", OK_README.replace(/.*prefers-color-scheme: dark.*\n/, ""), /dark Theme Variant/],
    ["no light source", OK_README.replace(/.*prefers-color-scheme: light.*\n/, ""), /light Theme Variant/],
    ["one file for both themes", OK_README.replace("session-light.svg\">", "session-dark.svg\">"), /same file/],
    ["no img fallback", OK_README.replace(/.*<img .*\n/, ""), /no <img> fallback/],
    ["the light variant as the fallback", OK_README.replace('<img src="assets/session-dark.svg"', '<img src="assets/session-light.svg"'), /not the dark variant/],
    ["no accessible name", OK_README.replace('alt="a terminal session"', 'alt=""'), /no alt text/],
    ["a width in pixels", OK_README.replace('width="100%"', 'width="846"'), /pinned to 846/],
  ];
  for (const [what, broken, expected] of faults) {
    const found = findReadmeFaults(broken, bothThere);
    assert.ok(found.length > 0, `${what} was not caught`);
    assert.match(found.join("\n"), expected, `${what}: ${found.join("; ")}`);
  }
});

test("an asset the README names and nothing writes is caught from the filesystem, not from a constant", () => {
  // A path compared against the generator's own constant moves with a rename and notices nothing.
  const found = findReadmeFaults(OK_README, (src) => src !== "assets/session-light.svg");
  assert.equal(found.length, 1);
  assert.match(found[0], /session-light\.svg, which is not there/);
});

test("a missing or collapsed transcript block is caught", () => {
  const faults: [string, string, RegExp][] = [
    ["no details block", OK_README.replace(/<details>[\s\S]*<\/details>/, ""), /no <details> transcript block/],
    ["no summary", OK_README.replace("<summary>Session transcript</summary>", ""), /no <summary> label/],
    ["a blank summary", OK_README.replace(">Session transcript<", "> <"), /no <summary> label/],
    ["no fence", OK_README.replace(/```\n/g, ""), /not inside a fenced code block/],
    ["a stub instead of the Session", OK_README.replace(TRANSCRIPT, "row 0\nrow 1"), /too few to be the Session/],
  ];
  for (const [what, broken, expected] of faults) {
    const found = findReadmeFaults(broken, bothThere);
    assert.ok(found.length > 0, `${what} was not caught`);
    assert.match(found.join("\n"), expected, `${what}: ${found.join("; ")}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Gate: the type check
// ---------------------------------------------------------------------------------------------

test("the typecheck gate reports the script's exit status, and a red check fails the run", () => {
  const dir = scratch();
  const withScript = (cmd: string): void =>
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "scratch", scripts: { typecheck: cmd } }));
  withScript('node -e "process.exit(0)"');
  assert.equal(runTypecheck(url(dir)).ok, true);
  withScript('node -e "console.log(\'src/x.ts(1,1): error TS2322\'); process.exit(1)"');
  const red = runTypecheck(url(dir));
  assert.equal(red.ok, false);
  assert.match(red.output, /TS2322/, "the gate swallowed what the type check said");
  const results = runGates(url(dir));
  assert.equal(gateNamed(results, "typecheck").status, "fail");
  assert.equal(exitCodeFor(results), 1);
});

test("this project's own type check is one of the gates, and it passes", () => {
  assert.equal(gateNamed(runGates(ROOT), "typecheck").status, "pass");
});

// ---------------------------------------------------------------------------------------------
// Gate: the activity cache
// ---------------------------------------------------------------------------------------------

test("a cache with no timestamp or no calendar is caught, because both would print a lie", () => {
  const dir = scratch();
  mkdirSync(join(dir, "cache"), { recursive: true });
  const write = (body: unknown): void => writeFileSync(join(dir, "cache", "activity.json"), typeof body === "string" ? body : JSON.stringify(body));
  const gate = (): GateResult => gateNamed(runGates(url(dir), { typecheck: false }), "activity cache");

  write({ fetchedAt: new Date().toISOString(), activity: { calendar: [{ date: "2026-10-01", count: 1 }] } });
  assert.equal(gate().status, "pass");
  write({ activity: { calendar: [{ date: "2026-10-01", count: 1 }] } });
  assert.match(gate().problems.join(), /fetchedAt/);
  write({ fetchedAt: new Date().toISOString(), activity: { calendar: [] } });
  assert.match(gate().problems.join(), /contribution calendar/);
  write("{not json");
  assert.match(gate().problems.join(), /not valid JSON/);
});

// ---------------------------------------------------------------------------------------------
// The run: three states, and the one that is neither pass nor fail
// ---------------------------------------------------------------------------------------------

test("absent is neither pass nor fail, and it has its own exit code", () => {
  assert.equal(exitCodeFor([result("a", "pass")]), 0);
  assert.equal(exitCodeFor([result("a", "pass"), result("b", "absent")]), 3);
  assert.equal(exitCodeFor([result("a", "pass"), result("b", "fail")]), 1);
  // A failure outranks an absence: something being wrong is the more urgent of the two.
  assert.equal(exitCodeFor([result("a", "absent"), result("b", "fail")]), 1);
});

/**
 * The remedy block a path or a gate name is listed under, by that block's heading.
 *
 * The headings are what a reader acts on, so the tests below assert WHICH block a thing lands in
 * rather than only that the report mentions it somewhere.
 */
const HEADED = /^ {2}[A-Z][A-Z ]*:/;

const remedyBlocks = (printed: string): string[] =>
  printed.split("\n\n").filter((b) => HEADED.test(b));

function blockFor(printed: string, needle: string): string | null {
  const found = remedyBlocks(printed).find((b) => b.split("\n")[0].includes(needle));
  return found === undefined ? null : found.slice(0, found.indexOf(":")).trim();
}

const blockHeadings = (printed: string): string[] =>
  remedyBlocks(printed).map((b) => b.slice(0, b.indexOf(":")).trim());

test("a built tree with no name list configured is never told to run a build", async () => {
  // The exact failure this reason exists for. Every generated file is there, thirteen gates pass,
  // one is absent because an environment variable is unset, and the old summary said
  // "NOT BUILT YET. Run `npm run build`". That is the one command that cannot help: somebody
  // following it runs a build, sees nothing change, and goes looking for a bug in the build.
  const dir = await builtTree();
  const results = runGates(url(dir), { typecheck: false, names: [] });
  assert.deepEqual(results.filter((r) => r.status === "fail"), []);
  assert.deepEqual(results.filter((r) => r.status === "absent").map((r) => r.gate), ["forbidden names"]);
  const printed = report(results);
  assert.deepEqual(blockHeadings(printed), ["NOT CONFIGURED"]);
  // The REMEDY sentence, not any mention of the command: the unconfigured block legitimately names
  // `npm run build` when it says which scripts read `.env`. What must not appear is the
  // instruction to run it, which is the advice that cannot help here.
  assert.ok(!printed.includes("Run `npm run build`"), "the summary tells a reader to run a build that cannot help");
  assert.ok(!printed.includes("NOT BUILT"), "the summary claims output is missing when all of it is there");
  assert.match(printed, /BUILDING AGAIN WILL NOT CHANGE THIS/, "the summary does not rule out the wrong remedy");
  assert.match(printed, new RegExp(FORBIDDEN_NAMES_ENV), "the summary does not name the variable to set");
  assert.equal(exitCodeFor(results), 3);
});

test("a mixed run reports every cause, not whichever it looked at first", () => {
  // Nothing built, nothing configured, and content.json and package.json absent as well: three
  // causes with three different remedies. A summary that named one of them would be wrong about
  // the other two, and a reader cannot tell a wrong remedy from a broken build.
  const dir = scratch();
  const results = runGates(url(dir), { names: [] });
  const printed = report(results);
  assert.deepEqual(blockHeadings(printed).sort(), ["MISSING FROM THE CHECKOUT", "NOT BUILT", "NOT CONFIGURED"]);
  assert.equal(blockFor(printed, GENERATED.dark), "NOT BUILT");
  assert.equal(blockFor(printed, GENERATED.cache), "NOT BUILT");
  assert.equal(blockFor(printed, "forbidden names"), "NOT CONFIGURED");
  assert.equal(exitCodeFor(results), 3);
});

test("a file that ships with the repository is never reported as something a build would write", () => {
  // The same mistake one level down, and it was in here: content.json is the owner's copy and
  // package.json is the package. A build writes neither, so "run the build" is the wrong remedy
  // for both, and git is the right one.
  const dir = scratch();
  const printed = report(runGates(url(dir), { names: [] }));
  for (const shipped of ["content.json", "package.json"]) {
    assert.equal(blockFor(printed, shipped), "MISSING FROM THE CHECKOUT", `${shipped} is in the wrong block`);
  }
  for (const generated of [GENERATED.dark, GENERATED.light, GENERATED.readme, GENERATED.cache]) {
    assert.equal(blockFor(printed, generated), "NOT BUILT", `${generated} is in the wrong block`);
  }
});

test("every absence carries a reason, and every reason present gets its own block", () => {
  // A reason added without a block would be an absence the summary silently drops.
  const dir = scratch();
  const results = runGates(url(dir), { names: [] });
  const absences = results.filter((r) => r.status === "absent");
  assert.ok(absences.length > 0, "premise: an empty tree has absences");
  for (const r of absences) {
    assert.ok(r.reason !== undefined, `${r.gate} is absent and does not say why`);
  }
  assert.equal(blockHeadings(report(results)).length, new Set(absences.map((r) => r.reason)).size);
  // And a pass or a fail never claims a reason, which would read as an absence in a summary.
  for (const r of results.filter((x) => x.status !== "absent")) {
    assert.equal(r.reason, undefined, `${r.gate} is ${r.status} and carries an absence reason`);
  }
});

test("the variable the summary names is the variable the generator reads", () => {
  assert.equal(FORBIDDEN_NAMES_ENV, "PROFILE_FORBIDDEN_NAMES");
});

test("a .env that does not set the name list says so, distinctly from there being no .env", () => {
  // The silent failure this closes: the owner wrote their real name as a KEY rather than as a
  // value, so the variable was never set, the gate said "no private names configured", and that
  // reads identically to "not set up yet". The only way anybody found out was by looking inside
  // the file, which is the one thing nobody should have to do to that file.
  const withEnv = (body: string | null): string => {
    const dir = scratch();
    if (body !== null) writeFileSync(join(dir, ".env"), body);
    return dir;
  };
  const adviceIn = (dir: string): string =>
    gateNamed(runGates(url(dir), { typecheck: false, names: [] }), "forbidden names").detail;

  const none = withEnv(null);
  assert.equal(envFileVerdict(url(none), FORBIDDEN_NAMES_ENV), "no-file");
  assert.match(adviceIn(none), /no .env here/);

  // A name written as a key, which is the mistake that was actually made.
  const asKey = withEnv("Some Name=\nOTHER_SETTING=x\n");
  assert.equal(envFileVerdict(url(asKey), FORBIDDEN_NAMES_ENV), "absent");
  assert.match(adviceIn(asKey), /does not set/);
  assert.match(adviceIn(asKey), /LEFT of the =/, "the advice does not say what the mistake looks like");

  const empty = withEnv(`${FORBIDDEN_NAMES_ENV}=\n`);
  assert.equal(envFileVerdict(url(empty), FORBIDDEN_NAMES_ENV), "blank");
  assert.match(adviceIn(empty), /empty value/);
  assert.equal(envFileVerdict(url(withEnv(`${FORBIDDEN_NAMES_ENV}=""\n`)), FORBIDDEN_NAMES_ENV), "blank");

  // Set in the file, absent from the process: the file was never loaded, and no amount of
  // re-editing it will help. This is the one a reader cannot possibly guess.
  const unloaded = withEnv(`export ${FORBIDDEN_NAMES_ENV}=Ada Lovelace\n`);
  assert.equal(envFileVerdict(url(unloaded), FORBIDDEN_NAMES_ENV), "set");
  assert.match(adviceIn(unloaded), /did not load it/);
  assert.match(adviceIn(unloaded), /--env-file-if-exists/);

  // A commented-out line sets nothing.
  assert.equal(envFileVerdict(url(withEnv(`#${FORBIDDEN_NAMES_ENV}=Ada\n`)), FORBIDDEN_NAMES_ENV), "absent");
});

test("diagnosing .env never repeats anything out of it", () => {
  // Non-negotiable: that file holds a credential, and the diagnosis exists because someone had to
  // read it to find a problem. A future change that returned "the keys it did find", to be
  // helpful, would recreate the exact disclosure this was written after.
  const canary = "CANARY-STRING-FROM-INSIDE-THE-ENV-FILE";
  const dir = scratch();
  writeFileSync(join(dir, ".env"), `${canary}=value-${canary}\nSOMETHING_ELSE=${canary}\n`);
  const results = runGates(url(dir), { typecheck: false, names: [] });
  const printed = report(results);
  assert.ok(!printed.includes(canary), "the gate read the credential file out loud");
  for (const r of results) {
    assert.ok(!r.detail.includes(canary) && !r.problems.join("").includes(canary), `${r.gate} quoted the file`);
  }
  // And it still diagnosed the real state rather than going quiet to stay safe.
  assert.match(gateNamed(results, "forbidden names").detail, /does not set/);
  assert.ok(["no-file", "absent", "blank", "set"].includes(envFileVerdict(url(dir), FORBIDDEN_NAMES_ENV)));
});

test("an unbuilt tree says what has not been built yet, not that something is wrong", () => {
  // This is the state the repository is in until the first authenticated refresh, and it is the
  // one moment somebody needs the two apart: a gate that failed identically for both would be
  // useless exactly when it is first read.
  const dir = scratch();
  const results = runGates(url(dir), { typecheck: false });
  assert.equal(exitCodeFor(results), 3);
  assert.deepEqual(results.filter((r) => r.status === "fail"), [], "nothing is wrong with a tree that has not been built");
  const printed = report(results);
  assert.match(printed, /NOT EVERYTHING WAS CHECKED/);
  assert.match(printed, /NOT BUILT:/);
  for (const path of [GENERATED.dark, GENERATED.light, GENERATED.readme, GENERATED.cache]) {
    assert.ok(printed.includes(path), `${path} is not named as one of the things not built yet`);
  }
  assert.match(printed, new RegExp(TOKEN_ENV), "the report does not say what makes the build possible");
  for (const gate of ["glyphs", "reduced motion", "svg structure", "size budget", "readme", "activity cache"]) {
    assert.equal(gateNamed(results, gate).status, "absent", `${gate} should have nothing to read`);
  }
});

test("a built tree runs every gate there is, by name", async () => {
  // The set, pinned on a BUILT tree, and this is the only place it can be pinned. On an unbuilt
  // tree the absent branch supplies the same gate names, so a gate deleted from the branch that
  // actually reads the files is invisible there: a mutant that dropped the assets from the dash
  // gate survived a whole mutation run for exactly that reason before this test existed.
  const dir = url(await builtTree());
  assert.deepEqual(runGates(dir, { typecheck: false }).map((r) => r.gate), [
    "forbidden names",
    "secrets",
    "placeholder names",
    "dashes in content.json",
    "dashes in the assets",
    "control characters",
    "glyphs",
    "reduced motion",
    "svg structure",
    "size budget",
    "readme",
    "dashes in the readme",
    "activity cache",
  ]);
});

test("a glyph the font cannot draw is caught in the README as well as in the assets", async () => {
  // The transcript is drawn from the same rows as the picture, so the same blank box lands in both.
  const dir = await builtTree();
  const clean = readFileSync(join(dir, GENERATED.readme), "utf8");
  try {
    writeFileSync(join(dir, GENERATED.readme), clean.replace("<details>", `<details>${FORBIDDEN_GLYPHS[0]}`));
    const gate = gateNamed(runGates(url(dir), { typecheck: false }), "glyphs");
    assert.equal(gate.status, "fail");
    assert.match(gate.problems.join("\n"), new RegExp(GENERATED.readme));
  } finally {
    writeFileSync(join(dir, GENERATED.readme), clean);
  }
});

test("a built tree passes every gate that has something to read", async () => {
  const dir = await builtTree();
  const results = runGates(url(dir), { typecheck: false });
  assert.deepEqual(
    results.filter((r) => r.status === "fail").map((r) => `${r.gate}: ${r.problems.join("; ")}`),
    [],
  );
  // The only gate allowed to have nothing to read here is the one whose input is an environment
  // variable rather than a file.
  assert.deepEqual(results.filter((r) => r.status === "absent").map((r) => r.gate).filter((g) => g !== "forbidden names"), []);
  assert.ok(exitCodeFor(results) !== 1, report(results));
});

test("the real assets this build writes clear the reduced-motion, glyph, structure and size gates", async () => {
  const dir = await builtTree();
  for (const rel of [GENERATED.dark, GENERATED.light]) {
    const svg = readFileSync(join(dir, rel), "utf8");
    assert.deepEqual(findReducedMotionFaults(svg), [], rel);
    assert.deepEqual(findAbsentGlyphs(svg), [], rel);
    assert.deepEqual(checkSvgStructure(svg), [], rel);
    assert.deepEqual(findSizeFaults(svg), [], rel);
    assert.deepEqual(findDashes(svg), [], rel);
    assert.deepEqual(findControlCharacters(svg), [], rel);
    assert.deepEqual(findSecretShapes(svg), [], `${rel} carries something token-shaped`);
    assert.deepEqual(svgReferenceCounts(svg), { ids: 0, refs: 0 }, `${rel}: the generator used to emit no ids and no internal refs`);
  }
  const readme = readFileSync(join(dir, GENERATED.readme), "utf8");
  assert.deepEqual(findReadmeFaults(readme, (src) => existsSync(join(dir, src))), []);
  assert.deepEqual(findDashes(readme), []);
  assert.deepEqual(findControlCharacters(readme), []);
});

test("a gate failure is reported with the file and the reason, and the run exits 1", async () => {
  const dir = await builtTree();
  const clean = readFileSync(join(dir, GENERATED.dark), "utf8");
  try {
    writeFileSync(join(dir, GENERATED.dark), clean.replace(MOTION_RULE, ""));
    const results = runGates(url(dir), { typecheck: false });
    assert.equal(exitCodeFor(results), 1);
    const gate = gateNamed(results, "reduced motion");
    assert.equal(gate.status, "fail");
    assert.match(report(results), /GATES FAILED/);
    assert.ok(report(results).includes(GENERATED.dark), "the report does not say which file is wrong");
  } finally {
    writeFileSync(join(dir, GENERATED.dark), clean);
  }
});
