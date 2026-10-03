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

test("the image is named by the owner's own alt text, and it is the only text the README has", async () => {
  const { readme } = await built();
  const content = loadContent();
  const alt = /<img [^>]*alt="([^"]*)"/.exec(readme);
  assert.notEqual(alt, null, "the image has no alt attribute");
  assert.equal(alt![1], content.readme.imageAlt);
  assert.notEqual(alt![1].trim(), "", "the alt text is blank, which makes the picture nameless");
  // It is not a line lifted out of the Session. Until 2026-10-03 the reason was that a reader who
  // heard a Session line in the alt and again in the transcript heard it twice; the transcript is
  // gone, and the rule stands on its own footing. The alt is a sentence written to be the picture's
  // name, and a row copied out of the picture is not that, whatever else it is.
  for (const [i, line] of content.whoami.entries()) {
    assert.ok(!alt![1].includes(line), `the alt text carries whoami[${i}] verbatim rather than describing the picture`);
  }
  // There was an assertion here that the alt must not name the handle, and it is deliberately gone:
  // it existed because the transcript already said the handle, and with the transcript deleted the
  // alt is the only place a screen reader could ever be told it. Whether it does is the owner's
  // copy decision (docs/spec.md 4.2), so this no longer forbids either answer.
});

test("the alt text is escaped, so a quote in the owner's words cannot end the attribute", () => {
  const content = loadContent();
  const out = renderReadme({ content: { ...content, readme: { imageAlt: `a "quoted" <b> & more` } } });
  const alt = /<img [^>]*alt="([^"]*)"/.exec(out);
  assert.notEqual(alt, null, "the alt attribute did not survive the quote, so it ended early");
  assert.equal(alt![1], "a &quot;quoted&quot; &lt;b&gt; &amp; more");
  assert.match(out, /width="100%">\n<\/picture>/, "the img tag no longer ends where it should");
});

// ---------------------------------------------------------------------------------------------
// The transcript block, which is deleted: these are the inversion
//
// The owner removed the `<details>Session transcript</details>` block on 2026-10-03 because nobody
// opened it and it read as clutter under a full-width picture (ADR 0004, third amendment). The
// tests that required it are not deleted along with it, they are turned around: the one thing that
// can now go wrong is the block coming back, by a revert, a merge or a hand edit, and nothing else
// in the suite would notice if it did.
// ---------------------------------------------------------------------------------------------

test("the README is the picture and nothing else", async () => {
  const { readme } = await built();
  // Asserted as one shape rather than as a list of absences, because the shape is the claim: a
  // generated-file notice, the themed picture, and the end of the file.
  assert.match(
    readme,
    /^<!-- Generated by src\/readme\.ts[^>]*-->\n<picture>\n  <source [^\n]*>\n  <source [^\n]*>\n  <img [^\n]*>\n<\/picture>\n$/,
  );
});

test("the transcript block has not come back, in any of the shapes it could come back in", async () => {
  const { readme } = await built();
  const content = loadContent();
  for (const markup of ["<details", "</details", "<summary", "</summary"]) {
    assert.ok(!readme.toLowerCase().includes(markup), `the README carries ${markup}, so the retired transcript block is back`);
  }
  // The fence is refused as well as the block. The generator had exactly one reason to put a fenced
  // code block in a README it writes itself, and a fence with no `<details>` around it is the same
  // regression with the disclosure triangle filed off.
  assert.ok(!/(?:^|\n)`{3,}/.test(readme), "the README carries a fenced code block, which only the transcript ever needed");
  // And the Session's own text is not in the file by some other route: no row of it, and none of
  // the box-drawing the rows are built from.
  assert.ok(!/[─│┌└├❯●▲]/.test(readme), "the README carries the Session's box-drawing, so some projection of it is being published again");
  assert.ok(!readme.includes(content.statusline.help[0]), "the README carries the Statusline's key hints, which only the transcript ever printed");
  assert.ok(!readme.includes(content.lanes[0].repos[0].blurb), "the README carries a repo blurb, which only the transcript ever printed");
});

test("the picture's accessible name is the whole of the README's text, which is the trade that was made", async () => {
  const { readme } = await built();
  const content = loadContent();
  // Not a style assertion: it is the measurement behind ADR 0004's third amendment, kept executable
  // so that the day somebody adds real Markdown under the picture, this is where they are told that
  // the premise changed. There is no text in the file outside the markup at all, which means the
  // alt attribute holds every word a reader of the README can be given.
  const prose = readme
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "")
    .trim();
  assert.equal(prose, "", "the README now carries prose outside the picture, so the alt text is no longer the only text");
  assert.ok(readme.includes(content.readme.imageAlt), "the README does not carry the owner's own alt text");
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
  assert.ok(readme.includes(content.readme.imageAlt), "the README does not carry the owner's own alt text");
});

test("the assembled README goes through the name gate, not just the parts it was assembled from", async () => {
  // `imageAlt` cleared the gate as a content.json field, so every word in the file has already been
  // checked and no ordinary content can tell whether the gate over the whole file runs at all. This
  // forbids a string that exists ONLY in the markup this generator writes, which nothing upstream
  // has ever seen. It is the regression guard for the next string added here that does not come
  // from content.json.
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
