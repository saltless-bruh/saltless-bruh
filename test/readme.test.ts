import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "../src/build.ts";
import { FORBIDDEN_NAMES, loadContent } from "../src/content.ts";
import type { Content } from "../src/content.ts";
import type { Transport } from "../src/activity.ts";
import { DARK_SRC, LIGHT_SRC, renderReadme } from "../src/readme.ts";

// ---------------------------------------------------------------------------------------------
// Most of this file reads the README OFF THE DISK, after a real `build()` wrote it.
//
// That is the point rather than thoroughness. GitHub strips README HTML silently: the page still
// renders, it just renders wrong, so the only check worth having is one that reads what actually
// ships. A test asserting that a string the test itself assembled contains no `<script>` proves
// that the test can concatenate, and nothing about the artifact. So the fixture below drives the
// whole pipeline, into a temp directory laid out the way the repository is, and every structural
// assertion is made against the bytes that came back out of the file.
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const today = new Date().toISOString().slice(0, 10);

/** 53 whole weeks ending today, the shape the GitHub calendar actually arrives in. */
function calendarDays(): { date: string; contributionCount: number }[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: 371 }, (_, i) => ({
    date: new Date(end - (370 - i) * DAY_MS).toISOString().slice(0, 10),
    contributionCount: i % 6,
  }));
}

/** A canned GraphQL body, so nothing here touches the network or the committed cache. */
const okTransport: Transport = async (request) => {
  const content = loadContent();
  const user: Record<string, unknown> = {
    repositories: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: content.lanes.flatMap((l) => l.repos.map((r, i) => ({
        name: r.name,
        languages: { edges: [
          { size: 5000 - i * 300, node: { name: "Python" } },
          { size: 2000 + i * 100, node: { name: "Rust" } },
          { size: 900, node: { name: "TypeScript" } },
        ] },
      }))),
    },
  };
  if (request.variables.withCalendar === true) {
    const days = calendarDays();
    user.contributionsCollection = {
      contributionCalendar: {
        totalContributions: days.reduce((s, d) => s + d.contributionCount, 0),
        weeks: Array.from({ length: Math.ceil(days.length / 7) }, (_, w) => ({ contributionDays: days.slice(w * 7, w * 7 + 7) })),
      },
    };
  }
  return JSON.stringify({ data: { user } });
};

let serial = 0;

/**
 * One real build, into a scratch root arranged like the repository: `README.md` beside an
 * `assets/` directory. The arrangement is what makes the path assertions mean anything, because
 * the README's image paths are resolved against the README's own directory.
 */
async function built(): Promise<{ root: string; readme: string; dark: string; light: string }> {
  const root = mkdtempSync(join(tmpdir(), `readme-test-${serial++}-`));
  const result = await build({
    outDir: pathToFileURL(`${join(root, "assets")}/`),
    cachePath: pathToFileURL(join(root, "activity.json")),
    transport: okTransport,
    log: () => {},
  });
  // Read back from the file, never from the return value: what ships is the file.
  return { root, readme: readFileSync(join(root, "README.md"), "utf8"), dark: result.dark, light: result.light };
}

/** Every image path the README declares, in source order: the two sources and the fallback. */
function imagePaths(readme: string): string[] {
  return [...readme.matchAll(/(?:src|srcset)="([^"]+)"/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------------------------
// The theme swap
// ---------------------------------------------------------------------------------------------

test("the picture swaps on the reader's theme, each media query naming its own variant", async () => {
  const { readme } = await built();
  // Asserted as a pair, because the failure that matters is not a missing element but a source
  // pointing at the wrong file: a dark reader served the light Session renders, and looks wrong
  // in a way no absence-of-element test notices.
  assert.match(readme, /<source media="\(prefers-color-scheme: dark\)" srcset="assets\/session-dark\.svg">/);
  assert.match(readme, /<source media="\(prefers-color-scheme: light\)" srcset="assets\/session-light\.svg">/);
  assert.notEqual(DARK_SRC, LIGHT_SRC, "precondition: the two variants are supposed to be two files");
});

test("the fallback image is the dark variant, which is the recorded decision", async () => {
  const { readme } = await built();
  // CONTEXT.md, "Theme Variant": the dark variant is the fallback. With both media queries
  // present this src is only reached by a client that does not implement <picture> at all, which
  // is exactly the client that cannot be asked what canvas it is drawing on.
  const img = /<img ([^>]*)>/.exec(readme);
  assert.notEqual(img, null, "there is no img at all, so there is no fallback");
  assert.match(img![1], /src="assets\/session-dark\.svg"/);
});

test("the image fills the column rather than being pinned to a pixel width", async () => {
  const { readme } = await built();
  // A fixed width would be legible at 846px and unreadable at the 308px a phone gives the README.
  assert.match(readme, /<img [^>]*width="100%"/);
  assert.ok(!/<img [^>]*width="\d+"/.test(readme), "the image carries a pixel width");
});

test("the fragment mechanism is not used, because the documented one is the picture element", async () => {
  const { readme } = await built();
  // #gh-dark-mode-only still works but the docs stopped describing it, and it depends on GitHub
  // auto-linking the image, which it does not do to an image already inside a link.
  assert.ok(!readme.includes("#gh-dark-mode-only"), "uses the retired fragment mechanism");
  assert.ok(!readme.includes("#gh-light-mode-only"), "uses the retired fragment mechanism");
});

// ---------------------------------------------------------------------------------------------
// The paths
// ---------------------------------------------------------------------------------------------

test("every image path the README declares resolves to a file the same build wrote", async () => {
  const { root, readme, dark, light } = await built();
  const paths = imagePaths(readme);
  assert.deepEqual(paths, [DARK_SRC, LIGHT_SRC, DARK_SRC], "the README names paths other than the two variants");
  const wanted = new Map([[DARK_SRC, dark], [LIGHT_SRC, light]]);
  for (const p of new Set(paths)) {
    const file = join(root, p);
    assert.ok(existsSync(file), `${p} resolves to nothing; the README points at a file the build does not write`);
    // Not just present: the right one. A pair of paths that both resolve but are swapped would
    // pass an existence check and ship a light Session to every dark reader.
    assert.equal(readFileSync(file, "utf8"), wanted.get(p), `${p} is not the variant the README names it as`);
  }
});

test("the README lands beside the assets directory, which is where its own paths resolve from", async () => {
  const { root } = await built();
  // `built` already read it from here, so this pins the other half: not one level deeper, where
  // `assets/session-dark.svg` would resolve to `assets/assets/session-dark.svg` and find nothing.
  assert.ok(existsSync(join(root, "README.md")), "the README is not beside assets/");
  assert.ok(!existsSync(join(root, "assets", "README.md")), "the README is inside assets/, one level below where its paths resolve from");
});

test("the paths are repo-relative, so GitHub serves them raw and never through camo", async () => {
  const { readme } = await built();
  for (const p of imagePaths(readme)) {
    assert.ok(!/^[a-z]+:/i.test(p), `${p} is absolute; an external host is proxied through camo, whose cache goes hours stale`);
    assert.ok(!p.startsWith("/"), `${p} is root-relative, which resolves against github.com rather than the repo`);
    assert.ok(p.startsWith("assets/"), `${p} is outside assets/, which is where the build writes`);
  }
});

// ---------------------------------------------------------------------------------------------
// The accessible name
// ---------------------------------------------------------------------------------------------

test("the image is named by the owner's own alt text, not by the Session's contents", async () => {
  const { readme } = await built();
  const content = loadContent();
  const alt = /<img [^>]*alt="([^"]*)"/.exec(readme);
  assert.notEqual(alt, null, "the image has no alt attribute");
  assert.equal(alt![1], content.readme.imageAlt);
  assert.notEqual(alt![1].trim(), "", "the alt text is blank, which makes the picture nameless");
  // Says what the picture IS. What it CONTAINS is the transcript below it, and a reader who hears
  // the Session read out of the alt text and then again out of the transcript hears it twice.
  assert.ok(!alt![1].includes(content.role), "the alt text recites the Session instead of describing the picture");
  assert.ok(!alt![1].includes(content.handle), "the alt text recites the Session instead of describing the picture");
});

test("the alt text is escaped, so a quote in the owner's words cannot end the attribute", () => {
  const content = loadContent();
  const out = renderReadme({
    content: { ...content, readme: { imageAlt: `a "quoted" <b> & more`, transcriptSummary: content.readme.transcriptSummary } },
    transcript: "x",
  });
  const alt = /<img [^>]*alt="([^"]*)"/.exec(out);
  assert.notEqual(alt, null, "the alt attribute did not survive the quote, so it ended early");
  assert.equal(alt![1], "a &quot;quoted&quot; &lt;b&gt; &amp; more");
  assert.match(out, /width="100%">\n<\/picture>/, "the img tag no longer ends where it should");
});

test("the transcript's label is the owner's word too, and it is escaped the same way", () => {
  const content = loadContent();
  const out = renderReadme({ content, transcript: "x" });
  assert.ok(out.includes(`<summary>${content.readme.transcriptSummary}</summary>`), "the label is not the owner's word");
  const quoted = renderReadme({
    content: { ...content, readme: { ...content.readme, transcriptSummary: "a <b> & c" } },
    transcript: "x",
  });
  assert.ok(quoted.includes("<summary>a &lt;b&gt; &amp; c</summary>"), "the label is injected as markup rather than text");
});

// ---------------------------------------------------------------------------------------------
// The transcript block
// ---------------------------------------------------------------------------------------------

test("the transcript ships whole, as real selectable text under the picture", async () => {
  const { readme } = await built();
  const content = loadContent();
  // Read out of the file, which holds the only copy of these words a reader of the README sees.
  const body = /```+\n([\s\S]*?)\n```+/.exec(readme);
  assert.notEqual(body, null, "there is no fenced block, so the transcript is not in a code block");
  const transcript = body![1];
  for (const cmd of ["/whoami", "/ops", "/stack", "/activity"]) {
    assert.ok(transcript.includes(cmd), `${cmd} is missing from the transcript`);
  }
  // The two the picture cannot give a reader at all: the Banner is geometry, and the spinner's
  // drawn verbs are one-at-a-time alternatives. Both exist as textOnly runs for this block.
  assert.ok(transcript.includes(content.handle), "the handle reaches a reader only here, and it is missing");
  assert.ok(transcript.includes(content.statusline.note), "the not-affiliated note is missing");
  assert.ok(transcript.includes(content.statusline.toggle.word), "the Statusline toggle is missing");
  // Under the picture, not above it: the description is read first, then the content.
  assert.ok(readme.indexOf("</picture>") < readme.indexOf("<details>"), "the transcript comes before the picture");
});

test("the transcript sits in a fenced code block, so its column grid survives", async () => {
  const { readme } = await built();
  // Markdown collapses runs of spaces outside a code block, and every row of the Session is laid
  // out by exactly those spaces. The structure is asserted as one sequence because each blank
  // line in it is load-bearing: without the one after </summary>, GitHub renders the fence as
  // literal text and the whole transcript arrives as a single collapsed paragraph.
  assert.match(readme, /<details>\n<summary>[^\n]*<\/summary>\n\n```+\n[\s\S]*\n```+\n\n<\/details>\n/);
  // An indented row really does keep its indent, which is what the fence is for.
  const indented = /```+\n([\s\S]*?)\n```+/.exec(readme)![1].split("\n").filter((l) => /^ {2,}\S/.test(l));
  assert.ok(indented.length > 0, "no row in the transcript is indented, so this proves nothing");
});

test("the fence is longer than any backtick run inside it, so the transcript cannot end early", () => {
  const content = loadContent();
  const body = "before\n``` not a fence\nmiddle\n````\nafter";
  const out = renderReadme({ content, transcript: body });
  const block = /\n(`{3,})\n([\s\S]*?)\n\1\n/.exec(out);
  assert.notEqual(block, null, "the opening and closing fences do not match");
  assert.equal(block![2], body, "the transcript was cut short by a backtick run inside it");
  assert.ok(block![1].length > 4, `a ${block![1].length}-backtick fence is closed by the four inside the body`);
  // And a transcript with no backticks still gets the ordinary three.
  assert.match(renderReadme({ content, transcript: "plain" }), /\n```\nplain\n```\n/);
});

// ---------------------------------------------------------------------------------------------
// The sanitiser
// ---------------------------------------------------------------------------------------------

test("the generated README uses no markup GitHub strips", async () => {
  const { readme } = await built();
  // Measured against GitHub's own renderer (POST /markdown), 2026-10-02. Each of these is
  // removed or escaped silently: the README still renders, it just renders wrong, so there is no
  // failure to notice after publishing. Asserted over the file, not over a string built here.
  for (const bad of ["<style", "<script", "<iframe", "<svg", "<object", "<embed", "<link", "<form", "<input", "<button"]) {
    assert.ok(!readme.toLowerCase().includes(bad), `uses ${bad}, which GitHub removes`);
  }
  for (const bad of ["style=", "class=", "id=", "role=", "aria-hidden=", "loading=", "srcset=\"http", "javascript:"]) {
    assert.ok(!readme.toLowerCase().includes(bad.toLowerCase()), `uses ${bad}, which GitHub strips`);
  }
  assert.ok(!/\son[a-z]+=/i.test(readme), "carries an inline event handler");
  // No data: URI either: GitHub strips the src outright and the image simply disappears.
  assert.ok(!readme.includes("data:"), "embeds a data: URI, whose src GitHub strips");
});

test("the README carries no em-dash and no forbidden name", async () => {
  const { readme } = await built();
  // Written as escapes on purpose: a gate that scans every committed file for an em-dash
  // must not trip over the test that forbids one.
  assert.ok(!readme.includes("\u2014"), "contains an em-dash, which the copy rules forbid everywhere visible");
  assert.ok(!readme.includes("\u2013"), "contains an en-dash");
  // The gate itself runs inside `build`, before the file is written. This asserts the committed
  // copy clears it, so the name check cannot be satisfied by a README nobody generated.
  const content = loadContent();
  assert.ok(!readme.toLowerCase().includes("firstname lastname"), "the committed forbidden name reached the README");
  assert.ok(readme.includes(content.readme.transcriptSummary), "the README does not carry the owner's own label");
});

test("the assembled README goes through the name gate, not just the parts it was assembled from", async () => {
  // The transcript cleared the gate as rows and the two README strings cleared it as content.json
  // fields, so every word in the file has already been checked and no ordinary content can tell
  // whether the gate over the whole file runs at all. This forbids a string that exists ONLY in
  // the markup this generator writes, which nothing upstream has ever seen. It is the regression
  // guard for the next string added here that does not come from content.json.
  const root = mkdtempSync(join(tmpdir(), `readme-test-${serial++}-`));
  const readmePath = join(root, "README.md");
  FORBIDDEN_NAMES.push("prefers-color-scheme");
  try {
    await assert.rejects(
      () => build({
        outDir: pathToFileURL(`${join(root, "assets")}/`),
        cachePath: pathToFileURL(join(root, "activity.json")),
        transport: okTransport,
        log: () => {},
      }),
      /forbidden name appears in the generated README/,
    );
  } finally {
    FORBIDDEN_NAMES.pop();
  }
  assert.ok(!existsSync(readmePath), "the README was written anyway, so the name reached the disk");
});

test("the README is stable: two builds of the same figures produce the same file", async () => {
  const [a, b] = [await built(), await built()];
  // The refresh workflow commits only when the output changed, so a generator with anything
  // incidental in it would commit on every cron run and keep the repository busy with noise.
  assert.equal(a.readme, b.readme);
});
