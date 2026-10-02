// src/ramp.ts
//
// The two polychrome treatments in the Statusline, and the colour maths that keeps them honest.
//
// `better-colors` asks for one thing above all others here: a ramp's steps must be evenly spaced
// in PERCEIVED lightness, never in whatever number the format happens to expose, and the spacing
// must be MEASURED rather than judged. Everything in this file exists so that the two ramps below
// are derived from the palette tokens and can be measured by a test rather than eyeballed in a
// render. Nothing here writes a hex literal: every colour is computed from `PALETTES`, so a
// palette change carries both ramps with it.
//
// Two ramps, both constrained to one perceived lightness band, which is what makes them read as a
// family rather than as two unrelated effects:
//
//  - `toggleRamp`  the Statusline toggle's gradient: `muted` to `accent`, one step per character.
//    MEASURED, and the measurement is the interesting part: the two tokens are very nearly
//    ISOLUMINANT. In dark they are 68.08 and 72.63 in CIE L*, and in light they are both 47.33,
//    identical to two decimal places. So the gradient's visible dimension is CHROMA, not lightness,
//    and "evenly spaced in perceived lightness" is satisfied trivially rather than usefully. What
//    has to be even is the perceived STEP, so the path is a straight line in OKLab walked in equal
//    increments: every consecutive pair is then the same perceptual distance apart by construction,
//    and the lightness comes out flat because the endpoints are. `test/ramp.test.ts` measures both.
//
//  - `topTierRamp` the effort scale's top tier, drawn as a rainbow because the owner wants the top
//    tier to look special. A literal rainbow would drop arbitrary hues into a palette that has one
//    accent hue, which reads as confetti stuck onto a terminal. This one sweeps hue around the
//    whole wheel while holding CIE L* exactly at the accent's own lightness and holding chroma
//    constant, so the word reads as one object that happens to be polychrome. Holding L* also
//    holds relative luminance, so every character of it has the same contrast against the window
//    as the accent itself does: the rainbow cannot smuggle in an unreadable character.
//
// The conversions are the published matrices (Ottosson's OKLab, sRGB D65) rather than a library,
// because the project has no runtime dependency and these are twenty lines.
import { PALETTES } from "./tokens.ts";
import type { ThemeName } from "./tokens.ts";
import { gradientClass, rainbowClass } from "./session.ts";

/** Linear-light sRGB, each channel 0..1. In gamut means every channel is inside that range. */
export type Rgb = [number, number, number];
/** OKLab: perceived lightness 0..1, then the two opponent axes. */
export type Oklab = [number, number, number];

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const clamp01 = (c: number): number => (c < 0 ? 0 : c > 1 ? 1 : c);

export function hexToLinear(hex: string): Rgb {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (m === null) throw new Error(`${JSON.stringify(hex)} is not a six-digit hex colour`);
  const n = parseInt(m[1], 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

/** Clamps on the way out, so an out-of-gamut colour becomes a drawable one rather than NaN. */
export function linearToHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(linearToSrgb(clamp01(c)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Whether a linear-light triple is inside sRGB, with a hair of tolerance for rounding. */
export const inGamut = (rgb: Rgb, eps = 1e-6): boolean => rgb.every((c) => c >= -eps && c <= 1 + eps);

export function linearToOklab([r, g, b]: Rgb): Oklab {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

export function oklabToLinear([L, a, b]: Oklab): Rgb {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

/**
 * CIE L*, the number the ramps are MEASURED in.
 *
 * OKLab's own L is what the ramps are BUILT in, because a straight line in OKLab is the thing with
 * even perceived steps. Measuring in the same space the construction used would only prove the
 * arithmetic ran; CIE L* is an independent scale, which is why the tests report it.
 */
export function cieLightness(rgb: Rgb): number {
  const y = 0.2126729 * rgb[0] + 0.7151522 * rgb[1] + 0.0721750 * rgb[2];
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/** WCAG relative luminance of a hex colour. */
export const relativeLuminance = (hex: string): number => {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio between two hex colours, the larger over the smaller. */
export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a), y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Bisection steps. Fixed, so the same palette always yields the same hex. */
const STEPS = 60;

/**
 * The toggle's gradient: `length` colours from `muted` to `accent`, walked in equal OKLab steps.
 *
 * Equal steps along a straight line in OKLab means every consecutive pair is the same perceptual
 * distance apart, which is the strongest reading of "evenly spaced in perceived lightness" that
 * two near-isoluminant endpoints admit. A word of one character gets the accent: the ramp has a
 * bright end and nothing to ramp from.
 */
export function toggleRamp(theme: ThemeName, length: number): string[] {
  if (!Number.isInteger(length) || length < 1) throw new Error(`a gradient needs at least one character, not ${length}`);
  const p = PALETTES[theme];
  if (length === 1) return [p.accent];
  const from = linearToOklab(hexToLinear(p.muted));
  const to = linearToOklab(hexToLinear(p.accent));
  return Array.from({ length }, (_, i) => {
    const f = i / (length - 1);
    return linearToHex(oklabToLinear(from.map((c, k) => c + (to[k] - c) * f) as Oklab));
  });
}

/**
 * The largest OKLab lightness whose colour at this hue and chroma reaches `target` in CIE L*.
 *
 * Bisection rather than a closed form: CIE L* of an OKLab colour at fixed a and b rises
 * monotonically with OKLab L, but through two cube roots and a matrix, so there is nothing to
 * invert analytically and nothing gained by trying.
 */
function lightnessFor(hue: number, chroma: number, target: number): number {
  const at = (L: number): Rgb => oklabToLinear([L, chroma * Math.cos(hue), chroma * Math.sin(hue)]);
  let lo = 0, hi = 1;
  for (let i = 0; i < STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (cieLightness(at(mid)) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The top tier's rainbow: `length` colours, hue swept evenly around the whole wheel from the
 * accent's own hue, every one of them at the accent's CIE L* and at one shared chroma.
 *
 * The chroma is the accent's, reduced for EVERY character together if any single hue would leave
 * sRGB at it. Reducing only the offending hue is the obvious alternative and it is wrong: the word
 * would then have one washed-out character, which reads as a mistake rather than as a sweep.
 */
export function topTierRamp(theme: ThemeName, length: number): string[] {
  if (!Number.isInteger(length) || length < 1) throw new Error(`a rainbow needs at least one character, not ${length}`);
  const accent = hexToLinear(PALETTES[theme].accent);
  const target = cieLightness(accent);
  const [, a, b] = linearToOklab(accent);
  const base = Math.hypot(a, b);
  const hues = Array.from({ length }, (_, i) => Math.atan2(b, a) + (2 * Math.PI * i) / length);
  const colourAt = (hue: number, chroma: number): Rgb => {
    const L = lightnessFor(hue, chroma, target);
    return oklabToLinear([L, chroma * Math.cos(hue), chroma * Math.sin(hue)]);
  };
  const fits = (chroma: number): boolean => hues.every((h) => inGamut(colourAt(h, chroma)));
  let chroma = base;
  if (!fits(chroma)) {
    let lo = 0, hi = base;
    for (let i = 0; i < STEPS; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    chroma = lo;
  }
  return hues.map((h) => linearToHex(colourAt(h, chroma)));
}

/**
 * The one rule per character that paints the two ramps, for one Theme Variant.
 *
 * It is appended after the base stylesheet, so each `fill` here overrides the `accent-bold` role the
 * runs also carry while leaving its font weight alone. Nothing in this stylesheet is animated: the
 * gradient IS the resting state, which is exactly what a reduced-motion reader sees, and the shimmer
 * in `src/playback.ts` only drives opacity over the top of it.
 */
export function rampCss(theme: ThemeName, toggleLength: number, topTierLength: number): string {
  return [
    ...toggleRamp(theme, toggleLength).map((hex, i) => `.${gradientClass(i)} { fill: ${hex} }`),
    ...topTierRamp(theme, topTierLength).map((hex, i) => `.${rainbowClass(i)} { fill: ${hex} }`),
  ].join("\n");
}
