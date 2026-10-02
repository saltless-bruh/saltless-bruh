import test from "node:test";
import assert from "node:assert/strict";
import {
  cieLightness, contrastRatio, hexToLinear, inGamut, linearToHex, linearToOklab, oklabToLinear,
  rampCss, toggleRamp, topTierRamp,
} from "../src/ramp.ts";
import { PALETTES } from "../src/tokens.ts";
import type { ThemeName } from "../src/tokens.ts";

const THEMES: ThemeName[] = ["dark", "light"];
const L = (hex: string): number => cieLightness(hexToLinear(hex));
const chromaOf = (hex: string): number => {
  const [, a, b] = linearToOklab(hexToLinear(hex));
  return Math.hypot(a, b);
};
const hueOf = (hex: string): number => {
  const [, a, b] = linearToOklab(hexToLinear(hex));
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
};
/** The same colour with one eight-bit code added to its green channel: one step of the output grid. */
const nudged = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return `#${(n + 0x000100).toString(16).padStart(6, "0")}`;
};

/** Perceptual distance between two colours, in OKLab, which is the space the ramps are built in. */
const distance = (x: string, y: string): number => {
  const p = linearToOklab(hexToLinear(x));
  const q = linearToOklab(hexToLinear(y));
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

// ---- the conversions, which every measurement below rests on -------------------------------

test("a colour survives a round trip through OKLab", () => {
  for (const hex of ["#000000", "#ffffff", "#83c092", "#3f7d4e", "#272e33", "#fffbef", "#e78183"]) {
    assert.equal(linearToHex(oklabToLinear(linearToOklab(hexToLinear(hex)))), hex);
  }
});

test("CIE L* is measured on an independent scale, pinned at the ends and at mid grey", () => {
  // Black and white are exact by definition, and #777777 is the published value for that grey.
  assert.equal(L("#000000"), 0);
  assert.equal(Math.round(L("#ffffff")), 100);
  assert.ok(Math.abs(L("#777777") - 50.03) < 0.05, `#777777 measured ${L("#777777")}`);
});

test("contrast is the WCAG ratio, pinned at the one pair everybody knows", () => {
  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 1e-9);
  assert.ok(Math.abs(contrastRatio("#ffffff", "#ffffff") - 1) < 1e-9);
  // and it is symmetric, so a pair cannot measure differently depending on which way round it is read
  assert.equal(contrastRatio("#83c092", "#272e33"), contrastRatio("#272e33", "#83c092"));
});

test("a colour outside sRGB is reported as outside it", () => {
  assert.ok(inGamut([0, 0.5, 1]));
  assert.ok(!inGamut([1.2, 0, 0]));
  assert.ok(!inGamut([0, -0.2, 0]));
});

// ---- the toggle's gradient -------------------------------------------------------------------

for (const theme of THEMES) {
  test(`the toggle's gradient runs from muted to accent and nowhere else (${theme})`, () => {
    const p = PALETTES[theme];
    const ramp = toggleRamp(theme, 10);
    assert.equal(ramp.length, 10);
    assert.equal(ramp[0], p.muted, "the ramp does not start on the muted token");
    assert.equal(ramp.at(-1), p.accent, "the ramp does not end on the Accent");
    // Derived from the palette, not written down: every step is a colour the tokens imply.
    assert.equal(new Set(ramp).size, ramp.length, "two characters share a colour, so the ramp has a flat spot");
  });

  test(`the gradient is the OKLab segment between the two tokens, walked in equal steps (${theme})`, () => {
    // Re-derived here from the palette rather than read back from the generator: a ramp built in
    // another space, from another pair of tokens, or with the steps bunched at one end all fail.
    const p = PALETTES[theme];
    const from = linearToOklab(hexToLinear(p.muted));
    const to = linearToOklab(hexToLinear(p.accent));
    const ramp = toggleRamp(theme, 10);
    ramp.forEach((hex, i) => {
      const f = i / (ramp.length - 1);
      const want = linearToHex(oklabToLinear([0, 1, 2].map((k) => from[k] + (to[k] - from[k]) * f) as [number, number, number]));
      assert.equal(hex, want, `step ${i} is not ${f} of the way along the segment`);
    });
  });

  test(`the gradient's steps are as evenly spaced as eight bits allow (${theme})`, () => {
    const ramp = toggleRamp(theme, 10);
    const steps = ramp.slice(1).map((hex, i) => distance(ramp[i], hex));
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    // The steps are equal before quantisation, so what is left to measure is the eight-bit grid
    // itself. The bound is that grid, measured rather than guessed: one code value on one channel.
    const quantum = distance(ramp[0], nudged(ramp[0]));
    assert.ok(quantum > 0, "a one-code nudge measured as no change at all");
    for (const step of steps) {
      assert.ok(Math.abs(step - mean) <= quantum, `a step of ${step} where the mean is ${mean} and one code is ${quantum}`);
    }
    // MEASURED, and the measurement is the finding: the two tokens are very nearly isoluminant, so
    // what a reader sees travel across the word is CHROMA and not lightness. A test that only
    // asserted even lightness steps would pass on a ramp that did nothing at all.
    const lightness = ramp.map(L);
    assert.ok(Math.abs(lightness.at(-1)! - lightness[0]) < 6, "the tokens are no longer near-isoluminant; re-read the note in src/ramp.ts");
    const chroma = ramp.map(chromaOf);
    assert.ok(chroma.at(-1)! > chroma[0] * 2.5, "the ramp's chroma barely moves, so the word has no gradient to show");
    for (let i = 1; i < chroma.length; i++) {
      assert.ok(chroma[i] > chroma[i - 1], `chroma falls back at step ${i}, so the ramp is not monotone`);
    }
  });

  test(`every colour of the gradient is readable on its own window (${theme})`, () => {
    const p = PALETTES[theme];
    for (const hex of toggleRamp(theme, 10)) {
      assert.ok(contrastRatio(hex, p.bg) >= 4.5, `${hex} measures ${contrastRatio(hex, p.bg).toFixed(2)}:1 on bg`);
      assert.ok(contrastRatio(hex, p.surface) >= 4.5, `${hex} measures ${contrastRatio(hex, p.surface).toFixed(2)}:1 on surface`);
    }
  });
}

test("a one-character word gets the top of the ramp rather than a division by zero", () => {
  for (const theme of THEMES) assert.deepEqual(toggleRamp(theme, 1), [PALETTES[theme].accent]);
});

test("a gradient of no characters is refused rather than returned empty", () => {
  assert.throws(() => toggleRamp("dark", 0), /at least one character/);
  assert.throws(() => toggleRamp("dark", 2.5), /at least one character/);
});

// ---- the top tier's rainbow --------------------------------------------------------------------

for (const theme of THEMES) {
  test(`the rainbow holds one perceived lightness, the Accent's own (${theme})`, () => {
    const p = PALETTES[theme];
    const ramp = topTierRamp(theme, 4);
    const target = L(p.accent);
    const lightness = ramp.map(L);
    // THE WHOLE DISCIPLINE OF THIS RAINBOW. Hues swept around the wheel at one lightness read as a
    // single polychrome object; the same hues at whatever lightness they fall out at read as
    // confetti. A tenth of a CIE L* unit is far inside what an eye can see.
    for (const value of lightness) {
      assert.ok(Math.abs(value - target) < 0.3, `a character at L* ${value.toFixed(3)} where the Accent is ${target.toFixed(3)}`);
    }
    assert.ok(Math.max(...lightness) - Math.min(...lightness) < 0.3, "the rainbow is not flat in lightness");
  });

  test(`the rainbow sweeps the whole wheel at one chroma (${theme})`, () => {
    const ramp = topTierRamp(theme, 4);
    assert.equal(ramp[0], PALETTES[theme].accent, "the sweep starts on the Accent itself");
    const hues = ramp.map(hueOf);
    for (let i = 1; i < hues.length; i++) {
      const step = (hues[i] - hues[i - 1] + 360) % 360;
      assert.ok(Math.abs(step - 360 / ramp.length) < 2, `a hue step of ${step.toFixed(1)} degrees`);
    }
    const chroma = ramp.map(chromaOf);
    assert.ok(Math.max(...chroma) - Math.min(...chroma) < 0.005, "the characters are not at one chroma");
    // One colour per character: a sweep that repeated itself would read as a pattern, not a sweep.
    assert.equal(new Set(ramp).size, ramp.length);
  });

  test(`every colour of the rainbow is as readable as the Accent it is held to (${theme})`, () => {
    const p = PALETTES[theme];
    const reference = contrastRatio(p.accent, p.bg);
    for (const hex of topTierRamp(theme, 4)) {
      assert.ok(contrastRatio(hex, p.bg) >= 4.5, `${hex} measures ${contrastRatio(hex, p.bg).toFixed(2)}:1 on bg`);
      assert.ok(contrastRatio(hex, p.surface) >= 4.5, `${hex} measures ${contrastRatio(hex, p.surface).toFixed(2)}:1 on surface`);
      // Holding lightness holds relative luminance, so the rainbow cannot smuggle in a character
      // that is harder to read than the Accent the rest of the Session is written in.
      assert.ok(Math.abs(contrastRatio(hex, p.bg) - reference) < 0.05, `${hex} is not the Accent's own contrast`);
    }
  });

  test(`the rainbow stays inside sRGB at every length it could be asked for (${theme})`, () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 12]) {
      const ramp = topTierRamp(theme, n);
      assert.equal(ramp.length, n);
      for (const hex of ramp) {
        // linearToHex clamps, so an out-of-gamut colour would come back as a changed one: the test
        // is that converting the hex back gives the lightness that was asked for.
        assert.ok(Math.abs(L(hex) - L(PALETTES[theme].accent)) < 0.5, `${n} characters: ${hex} left the band`);
      }
    }
  });
}

test("a rainbow of no characters is refused rather than returned empty", () => {
  assert.throws(() => topTierRamp("dark", 0), /at least one character/);
});

// ---- the stylesheet the two ramps become --------------------------------------------------------

for (const theme of THEMES) {
  test(`the ramp stylesheet is one rule per character, and no more (${theme})`, () => {
    const css = rampCss(theme, 10, 4);
    toggleRamp(theme, 10).forEach((hex, i) => assert.ok(css.includes(`.gradient-${i} { fill: ${hex} }`), `gradient ${i}`));
    topTierRamp(theme, 4).forEach((hex, i) => assert.ok(css.includes(`.rainbow-${i} { fill: ${hex} }`), `rainbow ${i}`));
    assert.ok(!css.includes(".gradient-10"), "a rule for a character the word does not have");
    assert.ok(!css.includes(".rainbow-4"), "a rule for a character the level does not have");
    assert.equal([...css.matchAll(/fill:/g)].length, 14, "the stylesheet carries rules nothing asked for");
    // Nothing in it moves: the gradient is the resting state, which is what reduced motion shows.
    assert.ok(!/animation|@keyframes|opacity/.test(css), "the resting ramps must not animate");
  });
}

test("the two variants get different ramps, because each is computed from its own tokens", () => {
  assert.notEqual(rampCss("dark", 10, 4), rampCss("light", 10, 4));
  for (const hex of toggleRamp("dark", 10)) {
    assert.ok(!toggleRamp("light", 10).includes(hex), `${hex} appears in both variants`);
  }
});
