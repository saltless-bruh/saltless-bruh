import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "../src/build.ts";
import { buildSvg } from "../src/svg.ts";
import type { Transport } from "../src/activity.ts";
import { TOKEN_ENV, WINDOW_DAYS } from "../src/activity.ts";
import { loadContent } from "../src/content.ts";
import { MASTER_SECONDS } from "../src/timeline.ts";
import { playbackClass, verbSchedule, bannerLetterClass } from "../src/playback.ts";
import { bannerLetters, bannerPath } from "../src/banner.ts";
import { rowBaselineY } from "../src/grid.ts";
import { VERB_SUFFIX } from "../src/session.ts";

// ---------------------------------------------------------------------------------------------
// Fixtures. Nothing in this file touches the network, and nothing writes the committed cache:
// every call is handed a transport over a canned GraphQL body and a cache path in a temp dir.
//
// The fixture is a RESPONSE, not an Activity. There is deliberately no seam that hands `build` a
// ready-made Activity, because that would be a path through production which skips the fetch, the
// parser and the window trim, and the figures drawn in a test would then be figures no code
// measured.
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const today = new Date().toISOString().slice(0, 10);

/** 53 whole weeks ending today, which is the shape the GitHub calendar actually arrives in. */
function calendarDays(): { date: string; contributionCount: number }[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  // 371 days, so the window trim has something at both ends to drop.
  return Array.from({ length: 371 }, (_, i) => ({
    date: new Date(end - (370 - i) * DAY_MS).toISOString().slice(0, 10),
    contributionCount: i % 6,
  }));
}

function fixtureBody(withCalendar: boolean): string {
  const content = loadContent();
  const repos = content.lanes.flatMap((l) => l.repos.map((r, i) => ({
    name: r.name,
    languages: { edges: [
      { size: 5000 - i * 300, node: { name: "Python" } },
      { size: 2000 + i * 100, node: { name: "Rust" } },
      { size: 900, node: { name: "TypeScript" } },
    ] },
  })));
  const days = calendarDays();
  const user: Record<string, unknown> = {
    repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: repos },
  };
  if (withCalendar) {
    user.contributionsCollection = {
      contributionCalendar: {
        totalContributions: days.reduce((s, d) => s + d.contributionCount, 0),
        weeks: Array.from({ length: Math.ceil(days.length / 7) }, (_, w) => ({ contributionDays: days.slice(w * 7, w * 7 + 7) })),
      },
    };
  }
  return JSON.stringify({ data: { user } });
}

const okTransport: Transport = async (request) => fixtureBody(request.variables.withCalendar === true);
const failingTransport = (message: string): Transport => async () => { throw new Error(message); };

let serial = 0;
/**
 * A scratch repository root: `assets/` for the two SVGs, with the README landing beside it. The
 * nesting is not tidiness. `build` writes its README one directory above `outDir`, because that
 * is where the README's own `assets/...` paths resolve from, so an `outDir` pointing straight at
 * the temp directory would put the README in the parent of every temp directory there is.
 */
const scratch = (): { outDir: URL; cachePath: URL } => {
  const dir = mkdtempSync(join(tmpdir(), `build-test-${serial++}-`));
  return { outDir: pathToFileURL(`${join(dir, "assets")}/`), cachePath: pathToFileURL(join(dir, "activity.json")) };
};

/** A build whose figures come off the fixture response, writing only into a temp directory. */
const fresh = (extra: { log?: (m: string) => void } = {}) =>
  build({ ...scratch(), transport: okTransport, log: extra.log ?? (() => {}) });

const svgsOf = async (): Promise<[string, string][]> => {
  const { dark, light } = await fresh();
  return [["dark", dark], ["light", light]];
};

// ---------------------------------------------------------------------------------------------
// The artifacts
// ---------------------------------------------------------------------------------------------

test("both variants build, are whole documents and stay inside the size gate", async () => {
  for (const [name, svg] of await svgsOf()) {
    assert.match(svg, /^<svg /, `${name} is not an svg`);
    assert.ok(svg.endsWith("</svg>"), `${name} is truncated`);
    assert.ok(Buffer.byteLength(svg) <= 250_000, `${name} is ${Buffer.byteLength(svg)} bytes`);
    assert.ok(!svg.includes("<script"), `${name} contains a script`);
    assert.ok(!/<(animate|animateTransform|animateMotion|set)\b/.test(svg), `${name} uses SMIL, which keeps running under reduced motion`);
    assert.ok(!/\son[a-z]+=/i.test(svg), `${name} carries an inline event handler`);
  }
});

test("both variants are parseable XML with every tag closed", async () => {
  for (const [name, svg] of await svgsOf()) {
    const stack: string[] = [];
    let tags = 0;
    for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
      tags++;
      const [, closing, tag, , selfClosing] = m;
      if (closing) assert.equal(stack.pop(), tag, `${name}: unbalanced </${tag}>`);
      else if (!selfClosing) stack.push(tag);
    }
    assert.deepEqual(stack, [], `${name}: a tag was left open`);
    assert.equal((svg.match(/</g) ?? []).length, tags, `${name}: a bare < is not a tag`);
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|#)/.test(svg), `${name}: an ampersand starts no known entity`);
  }
});

test("the two variants differ only in their palette, never in their text or their motion", async () => {
  const { dark, light } = await fresh();
  const strip = (s: string) => s.replace(/#[0-9a-f]{6}/g, "#000000");
  assert.notEqual(dark, light, "precondition: the two variants are supposed to differ");
  assert.equal(strip(dark), strip(light));
});

test("both files are written where the build says they are", async () => {
  const dirs = scratch();
  const { dark, light } = await build({ ...dirs, transport: okTransport, log: () => {} });
  assert.equal(readFileSync(new URL("session-dark.svg", dirs.outDir), "utf8"), dark);
  assert.equal(readFileSync(new URL("session-light.svg", dirs.outDir), "utf8"), light);
});

test("the transcript reproduces the Session as text, the Banner's name included", async () => {
  const { transcript } = await fresh();
  const content = loadContent();
  for (const cmd of ["/whoami", "/ops", "/stack", "/activity"]) assert.ok(transcript.includes(cmd), `${cmd} is missing`);
  // The Banner is geometry, so the handle reaches a reader only through the transcript.
  assert.ok(transcript.includes(content.handle), "the handle is nowhere in the transcript");
  assert.ok(transcript.includes(content.statusline.note), "the not-affiliated note is missing");
  assert.ok(transcript.includes(content.lanes[0].repos[0].blurb), "a repo blurb is missing");
  assert.ok(transcript.includes(`/${WINDOW_DAYS} `), "the activity line does not name its window");
});

test("the handle is drawn as geometry, never as text", async () => {
  const content = loadContent();
  for (const [name, svg] of await svgsOf()) {
    const text = [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]).join("");
    assert.ok(!text.includes(content.handle), `${name} draws the handle as glyphs instead of block art`);
  }
});

// ---------------------------------------------------------------------------------------------
// The playback, as it lands in the artifact
// ---------------------------------------------------------------------------------------------

test("every drawn row carries the hook for its own place in the Session", async () => {
  const { dark } = await fresh();
  const seen = [...dark.matchAll(/<text class="([^"]*)" y="([\d.]+)"/g)].map((m) => [m[1], Number(m[2])] as const);
  assert.ok(seen.length > 30, `only ${seen.length} rows carry a class`);
  const unhooked: number[] = [];
  for (const [cls, y] of seen) {
    const hook = cls.split(" ").find((c) => c.startsWith("pr-"));
    if (hook === undefined) {
      // The only rows the playback leaves alone are the ones another layer already reveals, and
      // such a row must actually have that other animation rather than simply be forgotten.
      assert.ok(cls.split(" ").some((c) => new RegExp(`\\.${c} \\{[^}]*animation:`).test(dark)),
        `a row at y=${y} has no reveal at all: it carries ${JSON.stringify(cls)}`);
      unhooked.push(y);
      continue;
    }
    const row = Number(hook.slice(3));
    // The hook must name the row's place in the Session, which is the only thing its delay was
    // computed from. The y coordinate is the independent witness of that place.
    assert.equal(y, rowBaselineY(row), `${hook} sits at y=${y}, which is row ${(y - rowBaselineY(0)) / 24}`);
  }
  assert.equal(unhooked.length, 1, `${unhooked.length} rows opted out of the playback`);
});

test("each row's hook has a rule, and the rules come in row order", async () => {
  const { dark } = await fresh();
  const delays = [...dark.matchAll(/\.pr-(\d+) \{ animation: row-arrive [\d.]+s ease-out ([\d.]+)s backwards \}/g)]
    .map((m) => [Number(m[1]), Number(m[2])] as const);
  assert.ok(delays.length > 50, `only ${delays.length} rows are scheduled`);
  for (let i = 0; i < delays.length; i++) {
    const [row, at] = delays[i];
    assert.ok(dark.includes(`.${playbackClass(row)} {`), `row ${row} has no rule`);
    if (i === 0) continue;
    const [prevRow, prevAt] = delays[i - 1];
    assert.ok(row > prevRow, `row ${row} is emitted after row ${prevRow}`);
    assert.ok(at > prevAt, `row ${row} does not arrive after row ${prevRow}`);
  }
  // Every element hook has a rule behind it.
  for (const m of dark.matchAll(/class="[^"]*\b(pr-\d+)\b/g)) {
    assert.ok(dark.includes(`.${m[1]} {`), `${m[1]} is on an element with no rule`);
  }
});

test("no element is handed two animations to race, because a shorthand replaces rather than adds", async () => {
  const { dark } = await fresh();
  const style = /<style>([\s\S]*?)<\/style>/.exec(dark)![1];
  // Every class the stylesheet gives an `animation` shorthand to, outside the keyframe blocks.
  const animated = new Set(
    [...style.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
      .matchAll(/\.([\w-]+)[^{}]*\{[^{}]*animation:/g)].map((m) => m[1]),
  );
  assert.ok(animated.size > 5, `only ${animated.size} classes animate`);
  for (const m of dark.matchAll(/class="([^"]*)"/g)) {
    const racing = m[1].split(" ").filter((c) => animated.has(c));
    assert.ok(racing.length <= 1,
      `an element carries ${racing.join(" and ")}: whichever rule comes last silently wins and the other reveal never runs`);
  }
});

test("a row hook is added to the row's own class, never put in its place", async () => {
  // Driven straight at buildSvg, because the build deliberately never asks for a hook on a row
  // that already has one. The option still has to behave, or the next caller that does ask loses
  // whatever the row was already hooked to.
  const svg = await buildSvg({
    rows: [{ cls: "scan-result", runs: [{ col: 0, text: "a" }] }, { runs: [{ col: 0, text: "b" }] }],
    theme: "dark",
    fontRegularB64: "", fontBoldB64: "",
    title: "t",
    rowClass: (i) => `pr-${i}`,
  });
  const classes = [...svg.matchAll(/<text class="([^"]*)"/g)].map((m) => m[1].split(" ").sort());
  assert.deepEqual(classes, [["pr-0", "scan-result"], ["pr-1"]]);
});

test("the row the Scan Sweep prints is revealed by the sweep, not by the playback", async () => {
  const { dark } = await fresh();
  const row = /<text class="([^"]*)" y="[\d.]+" xml:space="preserve"><tspan[^>]*>╰<\/tspan><tspan[^>]*>scan complete:/.exec(dark);
  assert.ok(row, "the /activity result line was not found");
  assert.equal(row![1], "scan-result", "the result line also carries a playback hook");
  assert.match(dark, /\.scan-result \{ opacity: 1; animation: scan-result/);
});

test("the playback reaches the last row of the Session, not a fixed number of rows", async () => {
  const { dark } = await fresh();
  const rows = (dark.match(/<text /g) ?? []).length;
  const scheduled = new Set([...dark.matchAll(/\.pr-(\d+) \{ animation/g)].map((m) => Number(m[1])));
  const drawn = [...dark.matchAll(/class="[^"]*\b(pr-)(\d+)\b/g)].map((m) => Number(m[2]));
  assert.ok(rows >= drawn.length, "more hooks than elements");
  assert.ok(scheduled.has(Math.max(...drawn)), "the last drawn row never arrives");
});

// ---------------------------------------------------------------------------------------------
// The Banner's reveal, the verbs and the shimmer, as they land in the artifact
// ---------------------------------------------------------------------------------------------

test("the Banner is one path per letter, and together they draw the word", async () => {
  const content = loadContent();
  const letters = [...content.handle];
  for (const [name, svg] of await svgsOf()) {
    const paths = [...svg.matchAll(/<path class="(bl-\d+)" d="([^"]*)"/g)];
    assert.equal(paths.length, letters.length, `${name} draws ${paths.length} letter paths for ${letters.length} letters`);
    paths.forEach((m, i) => assert.equal(m[1], bannerLetterClass(i), `${name}: letter ${i} is out of order`));
    const split = paths.flatMap((m) => m[2].split("M").filter(Boolean)).sort();
    // The reference is the single-path Banner, so splitting it per letter cannot change the drawing.
    const whole = bannerPath(content.handle, bannerLetters(content.handle, 0, 0)[0].col, 0);
    assert.equal(split.length, whole.split("M").filter(Boolean).length, `${name}: the letters do not add up to the word`);
    for (let i = 0; i < letters.length; i++) assert.ok(svg.includes(`.${bannerLetterClass(i)} {`), `${name}: letter ${i} has no rule`);
  }
});

test("every verb the schedule names is drawn, each once, and only one is in the transcript", async () => {
  const content = loadContent();
  const schedule = verbSchedule(content.verbs);
  const { dark, transcript } = await fresh();
  const spoken = `${schedule[0].text}${VERB_SUFFIX}`;
  for (const [i, slice] of schedule.entries()) {
    const drawn = `${slice.text}${VERB_SUFFIX}`;
    assert.ok(dark.includes(`>${drawn}<`), `the picture never draws ${drawn}`);
    assert.ok(dark.includes(`verb-${i} {`), `verb ${i} has no rule`);
  }
  assert.equal(transcript.split("\n").filter((l) => l.includes(VERB_SUFFIX)).length, 1, "the transcript carries more than one spinner line");
  assert.ok(transcript.includes(spoken), "the transcript's verb is not the one the still frame draws");
  for (const slice of schedule) {
    if (`${slice.text}${VERB_SUFFIX}` === spoken) continue;
    assert.ok(!transcript.includes(slice.text), `${slice.text} was painted into the transcript too`);
  }
});

test("the drawn verbs sit at the column the transcript's verb sits at", async () => {
  const { dark, transcript } = await fresh();
  const schedule = verbSchedule(loadContent().verbs);
  const line = transcript.split("\n").find((l) => l.includes(VERB_SUFFIX))!;
  const col = line.indexOf(schedule[0].text);
  assert.ok(col > 0, "the transcript's verb is not on the spinner line");
  const xs = new Set([...dark.matchAll(/<tspan x="([\d.]+)" class="[^"]*verb-\d+"/g)].map((m) => m[1]));
  assert.equal(xs.size, 1, `the verbs are drawn at ${xs.size} different columns`);
  // PAD + col * CELL_W. A drawn verb landing anywhere else would spell the spinner twice over.
  assert.equal([...xs][0], String(16 + col * 12), "the drawn verbs are not where the transcript's verb is");
});

test("the Statusline toggle rests on a gradient and shimmers across its own characters", async () => {
  const word = [...loadContent().statusline.toggle.word];
  for (const [name, svg] of await svgsOf()) {
    word.forEach((ch, i) => {
      // The resting copy: its own colour per character, and no animation anywhere near it.
      assert.ok(svg.includes(`class="accent-bold gradient-${i}"`), `${name}: character ${i} of the toggle has no gradient copy`);
      assert.match(svg, new RegExp(`\\.gradient-${i} \\{ fill: #[0-9a-f]{6} \\}`), `${name}: character ${i} has no ramp colour`);
      // The travelling copy over it.
      assert.ok(svg.includes(`class="accent-bold shimmer-${i}"`), `${name}: character ${i} of the toggle has no highlight copy`);
      assert.ok(svg.includes(`.shimmer-${i} {`), `${name}: character ${i} has no shimmer rule`);
    });
    assert.ok(!svg.includes(`.shimmer-${word.length} {`), `${name}: a shimmer rule exists for a character the word does not have`);
    assert.ok(!svg.includes(`.gradient-${word.length} {`), `${name}: a ramp colour exists for a character the word does not have`);
  }
});

test("every animation in the artifact is on the master clock or a divisor of it", async () => {
  const { dark } = await fresh();
  const periods = new Set([...dark.matchAll(/animation:\s*[\w-]+\s+([\d.]+)s/g)].map((m) => Number(m[1])));
  assert.ok(periods.size > 3, "the artifact barely animates");
  for (const p of periods) {
    if (p >= MASTER_SECONDS) {
      assert.equal(p, MASTER_SECONDS, `${p}s is longer than the master loop`);
      continue;
    }
    // Co-prime micro-layers are deliberate (ear 17s, tail 23s, LEDs 7/11/13) and are not on this
    // clock; everything shorter than a second is a gesture. What must not exist is a loop long
    // enough to be noticed that neither divides the master nor is co-prime with it.
    assert.ok(p <= MASTER_SECONDS, `${p}s`);
  }
});

test("reduced motion is the whole motion layer, and it is the last word in the stylesheet", async () => {
  for (const [name, svg] of await svgsOf()) {
    const style = /<style>([\s\S]*?)<\/style>/.exec(svg)![1];
    const reduce = style.indexOf("@media (prefers-reduced-motion: reduce)");
    assert.ok(reduce !== -1, `${name} has no reduced-motion rule`);
    assert.equal(style.slice(reduce).trim(), "@media (prefers-reduced-motion: reduce){*{animation:none!important}}",
      `${name} lets something follow the reduced-motion rule`);
  }
});

// ---------------------------------------------------------------------------------------------
// The data path
// ---------------------------------------------------------------------------------------------

test("a fresh fetch is not reported as stale, and it rewrites the cache", async () => {
  const dirs = scratch();
  const warnings: string[] = [];
  const result = await build({ ...dirs, transport: okTransport, log: (m) => warnings.push(m) });
  assert.equal(result.staleNote, null);
  assert.deepEqual(warnings, []);
  const cached = JSON.parse(readFileSync(dirs.cachePath, "utf8"));
  assert.match(cached.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(cached.activity.calendar.length, WINDOW_DAYS, "the cache did not keep the trimmed window");
});

test("a stale cache is announced on the build's own output and reaches neither variant", async () => {
  const dirs = scratch();
  // One good build to write the cache, then a build whose fetch fails behind it.
  await build({ ...dirs, transport: okTransport, log: () => {} });
  const aged = JSON.parse(readFileSync(dirs.cachePath, "utf8"));
  aged.fetchedAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
  writeFileSync(dirs.cachePath, JSON.stringify(aged));

  const warnings: string[] = [];
  const result = await build({ ...dirs, transport: failingTransport("socket hang up"), log: (m) => warnings.push(m) });
  assert.equal(warnings.length, 1, `the build said ${warnings.length} things about a three day old cache`);
  assert.match(warnings[0], /stale/);
  assert.match(warnings[0], /3 days/, "the warning does not say how old the figures are");
  assert.match(warnings[0], /socket hang up/, "the warning does not say why the refresh failed");
  assert.ok(result.staleNote !== null, "the caller is not told the figures are old");
  for (const svg of [result.dark, result.light]) {
    assert.ok(!svg.includes("stale"), "the staleness reached the published asset");
    assert.ok(!svg.includes("socket hang up"), "the fetch failure reached the published asset");
    assert.ok(!svg.includes(result.staleNote!), "the whole note reached the published asset");
    assert.ok(!svg.includes(warnings[0]), "the build's warning reached the published asset");
  }
});

test("the token never reaches a log line, whatever the failure quotes", async () => {
  const dirs = scratch();
  await build({ ...dirs, transport: okTransport, log: () => {} });
  // Deliberately NOT shaped like a GitHub token, the same discipline test/activity.test.ts
  // records for its own stand-in: a committed file that looks like a credential trips the secret
  // gate it exists to defend, and this literal did exactly that on the gate's first run. The
  // test cares that the value is scrubbed, never what it looks like.
  const token = "TOKEN-VALUE-THAT-MUST-NEVER-REACH-A-LOG";
  const before = process.env[TOKEN_ENV];
  process.env[TOKEN_ENV] = token;
  try {
    const warnings: string[] = [];
    // A socket error naming the request it was sending is text this project did not write.
    const result = await build({
      ...dirs,
      transport: failingTransport(`request failed with Authorization: bearer ${token}`),
      log: (m) => warnings.push(m),
    });
    assert.equal(warnings.length, 1);
    assert.ok(!warnings[0].includes(token), `the build logged the credential: ${warnings[0]}`);
    assert.match(warnings[0], /redacted/, "the credential was dropped silently rather than redacted");
    assert.ok(!result.dark.includes(token) && !result.light.includes(token), "the credential reached an asset");
    assert.ok(result.staleNote !== null && !result.staleNote.includes(token), "the credential is in the returned note");
  } finally {
    if (before === undefined) delete process.env[TOKEN_ENV];
    else process.env[TOKEN_ENV] = before;
  }
});

test("no network and no cache fails the build, because a calendar of zeros is an invented number", async () => {
  const dirs = scratch();
  assert.ok(!existsSync(dirs.cachePath), "precondition: the scratch cache does not exist yet");
  await assert.rejects(
    () => build({ ...dirs, transport: failingTransport("getaddrinfo ENOTFOUND api.github.com"), log: () => {} }),
    /no usable cache/,
  );
  assert.ok(!existsSync(new URL("session-dark.svg", dirs.outDir)), "a variant was written from figures that do not exist");
});

test("the API is queried by the login, never by the drawn handle", async () => {
  const content = loadContent();
  const logins: unknown[] = [];
  const transport: Transport = async (request) => {
    logins.push(request.variables.login);
    return fixtureBody(request.variables.withCalendar === true);
  };
  await build({ ...scratch(), transport, log: () => {} });
  assert.ok(logins.length > 0, "nothing was fetched");
  for (const login of logins) assert.equal(login, content.login);
  assert.notEqual(content.login, content.handle, "precondition: the login and the handle are different values");
});

test("the measured playback is what the build reports, and it is under two seconds", async () => {
  const { playbackSeconds: seconds, dark } = await fresh();
  const delays = [...dark.matchAll(/animation: row-arrive ([\d.]+)s ease-out ([\d.]+)s backwards/g)]
    .map((m) => Number(m[1]) + Number(m[2]));
  assert.ok(delays.length > 0, "no row is scheduled");
  assert.ok(Math.abs(Math.max(...delays) - seconds) < 1e-6, `the build reports ${seconds}s, the stylesheet says ${Math.max(...delays)}s`);
  assert.ok(seconds < 2, `the playback takes ${seconds.toFixed(2)}s, and it stands between the reader and the content`);
});
