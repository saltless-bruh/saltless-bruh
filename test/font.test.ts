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
