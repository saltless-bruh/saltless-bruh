import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ENGINES, chromeArgs, command, firefoxArgs, firefoxPrefs, firefoxProfile,
  freeze, parseEngine, shiftDelays, wrapperPage,
} from "../scripts/render-check.ts";
import { bannerRevealCss, playbackCss, playbackMarks } from "../src/playback.ts";
import { scanCss } from "../src/scan.ts";

// ---------------------------------------------------------------------------------------------
// scripts/render-check.ts is the instrument the cross-browser verification in docs/spec.md 1.2 was
// produced with, and an instrument that lies is worse than one that is missing, because its output
// looks like evidence. Every test here pins a way it could lie QUIETLY: a run that still writes a
// PNG, still exits 0, and measures something other than what it claims to.
// ---------------------------------------------------------------------------------------------

const shot = (o: Partial<Parameters<typeof command>[0]> = {}) =>
  ({ engine: "chrome" as const, width: 846, reduced: false, out: "/tmp/out.png", page: "/tmp/page.html", ...o });

test("an unrecognised engine is refused, not quietly resolved to the default", () => {
  // THE failure this file exists for. `--engine=firefix` falling back to Chrome would run both
  // halves of a cross-browser comparison on Chrome and report that the engines agree. That is not
  // a missing check, it is a fabricated result, and nothing downstream could tell the difference.
  assert.throws(() => parseEngine(["--engine=firefix"]), /unknown engine/);
  assert.throws(() => parseEngine(["--engine=Firefox"]), /unknown engine/);
  assert.throws(() => parseEngine(["--engine="]), /unknown engine/);
  assert.throws(() => parseEngine(["--engine=chromium"]), /unknown engine/);
});

test("the error names the engines that do exist, so the fix does not need the source", () => {
  assert.throws(() => parseEngine(["--engine=safari"]), (e: Error) =>
    ENGINES.every((name) => e.message.includes(name)));
});

test("no --engine means Chrome, and --engine=chrome means the same thing", () => {
  assert.equal(parseEngine([]), "chrome");
  assert.equal(parseEngine(["--width=308", "--reduced"]), "chrome");
  assert.equal(parseEngine(["--engine=chrome"]), "chrome");
});

test("--engine=firefox reaches the Firefox binary and not Chrome's", () => {
  const dir = mkdtempSync(join(tmpdir(), "rc-test-"));
  try {
    assert.equal(parseEngine(["--engine=firefox"]), "firefox");
    const ff = command(shot({ engine: "firefox" }), join(dir, "p"));
    assert.equal(ff.bin, "firefox");
    assert.ok(!ff.args.some((a) => a.includes("headless=new")), "that is Chrome's spelling of the flag");
    const cr = command(shot(), join(dir, "q"));
    assert.equal(cr.bin, "google-chrome-stable");
    assert.notEqual(ff.bin, cr.bin);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("each engine is asked for reduced motion in the one way it understands", () => {
  // Chrome has a flag; Firefox has none and takes a pref. Either request going missing produces a
  // full-motion render presented as a reduced-motion one, which is a passing acceptance gate 2
  // that checked nothing.
  assert.ok(chromeArgs(shot({ reduced: true })).includes("--force-prefers-reduced-motion"));
  assert.ok(!chromeArgs(shot({ reduced: false })).includes("--force-prefers-reduced-motion"));
  assert.match(firefoxPrefs(true), /ui\.prefersReducedMotion", 1\)/);
});

test("Firefox's pref is written on BOTH runs, so the host's own setting cannot leak in", () => {
  // Writing it only for --reduced would leave the ordinary run on whatever the machine has set.
  // On a developer who uses reduced motion, every frame would render reduced and the reduced-vs-
  // normal comparison would be two copies of the same picture agreeing with each other.
  assert.match(firefoxPrefs(false), /ui\.prefersReducedMotion", 0\)/);
  assert.notEqual(firefoxPrefs(true), firefoxPrefs(false));
});

test("the profile Firefox is pointed at is the profile that was written", () => {
  const dir = mkdtempSync(join(tmpdir(), "rc-test-"));
  try {
    const profile = join(dir, "profile");
    const { args } = command(shot({ engine: "firefox", reduced: true }), profile);
    const at = args.indexOf("--profile");
    assert.notEqual(at, -1, "Firefox was launched with no profile at all");
    assert.equal(args[at + 1], profile);
    assert.match(readFileSync(join(profile, "user.js"), "utf8"), /ui\.prefersReducedMotion", 1\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("both engines are given the same window size, so width cannot masquerade as an engine difference", () => {
  const dir = mkdtempSync(join(tmpdir(), "rc-test-"));
  try {
    for (const width of [846, 308]) {
      const size = (args: string[]) => args.find((a) => a.includes("window-size"))?.replace(/^--window-size[=\s]?/, "");
      const cr = size(chromeArgs(shot({ width })));
      const ff = size(firefoxArgs(shot({ engine: "firefox", width }), firefoxProfile(join(dir, `p${width}`), false)));
      assert.equal(cr, ff, `the engines were sized differently at ${width}px`);
      assert.ok(cr?.startsWith(String(width + 40)), `the window does not hold a ${width}px image`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("both engines write to the output path they were given", () => {
  const dir = mkdtempSync(join(tmpdir(), "rc-test-"));
  try {
    const out = join(dir, "frame.png");
    assert.ok(chromeArgs(shot({ out })).some((a) => a === `--screenshot=${out}`));
    const ff = firefoxArgs(shot({ engine: "firefox", out }), firefoxProfile(join(dir, "p"), false));
    assert.equal(ff[ff.indexOf("--screenshot") + 1], out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the asset is loaded through an <img>, which is the restricted context being verified", () => {
  // Rendering the SVG as a top-level document would exercise a context GitHub never serves, where
  // the CSP in docs/spec.md 1.1 is not what decides whether the <style> block runs. The whole
  // point of this instrument is that the picture is inside an <img>.
  const page = wrapperPage("/tmp/session-dark.svg", 846, "#0d1117");
  assert.match(page, /<img src="file:\/\/[^"]*session-dark\.svg"/);
  assert.match(page, /width:846px/);
  assert.match(page, /background:#0d1117/);
});

test("a freeze shifts every explicit delay by the same amount, so the stagger survives", () => {
  // Measured against the REAL generated stylesheet, not a hand-written sample. The blanket
  // `*{animation-delay:-Xs}` rule REPLACES a row's own delay, so without this every row of the
  // playback lands on one instant: the cascade vanishes and the frame looks finished at any freeze.
  const marks = playbackMarks(Array.from({ length: 6 }, () => ({})));
  const css = playbackCss(marks);
  const shifted = shiftDelays(css, 1.5);
  assert.match(shifted, /\.pr-0\{animation-delay:-1\.5s!important\}/);
  // .pr-1's own delay is 0.026s, so frozen at 1.5s it is 0.026 - 1.5 behind.
  assert.match(shifted, /\.pr-1\{animation-delay:-1\.474s!important\}/);
  for (const m of shifted.matchAll(/animation-delay:(-?[\d.]+)s/g)) {
    assert.ok(Number(m[1]) < 0, `a frozen clock ran forwards to ${m[1]}s`);
  }
});

test("the shifted delay is the animation shorthand's SECOND time, never its duration", () => {
  // `animation: banner-letter 0.09s step-end 0.18s backwards`: the first time is how long the
  // letter takes, the second is when it starts. Reading the first would freeze every letter on the
  // same frame while still producing a plausible-looking Banner.
  const shifted = shiftDelays(bannerRevealCss(3), 0);
  assert.match(shifted, /\.bl-0\{animation-delay:0s!important\}/);
  assert.match(shifted, /\.bl-1\{animation-delay:0\.09s!important\}/);
  assert.match(shifted, /\.bl-2\{animation-delay:0\.18s!important\}/);
});

test("a keyframe's own stops are not mistaken for rules with delays", () => {
  // `@keyframes row-arrive { from { ... } }` offers `from { ... }` to the same regex. It carries no
  // `animation:`, so it is skipped; an emitted `from{animation-delay:...}` would be nonsense the
  // browser drops silently, taking the real rule's ordering with it.
  const shifted = shiftDelays(playbackCss(playbackMarks([{}, {}])), 1);
  assert.doesNotMatch(shifted, /(from|to|\d+%)\{animation-delay/);
});

test("an animation with no delay of its own is left to the blanket rule", () => {
  // The Scan Sweep's four layers run on the master clock with no stagger. Emitting a shifted delay
  // for them would be harmless; emitting a WRONG one would move the beam. Neither should appear.
  assert.equal(shiftDelays(scanCss(), 2), "");
});

test("freezing a document with nothing animated in it fails instead of rendering a live frame", () => {
  // A silent pass here is the worst case: the caller asked for one instant, got an unfrozen render,
  // and compared it against another engine's unfrozen render at a different instant.
  assert.throws(() => freeze("<svg></svg>", 1, "still.svg"), /nothing in it is animated/);
});

test("a freeze pauses the clock as well as setting it", () => {
  const out = freeze("<svg><style>.a{animation: x 1s 0.5s}</style></svg>", 2, "a.svg");
  assert.match(out, /animation-play-state:paused!important/);
  assert.match(out, /\*\{animation-delay:-2s!important/);
  // The per-rule shift must come AFTER the blanket rule, or the blanket rule wins and the stagger
  // is flattened by the very mechanism meant to preserve it.
  assert.ok(out.indexOf(".a{animation-delay:-1.5s!important}") > out.indexOf("*{animation-delay:-2s"));
});
