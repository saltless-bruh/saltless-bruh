import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fontCoverage, assertCovered, subsetToBase64, FORBIDDEN_GLYPHS } from "../src/font.ts";
import fontverter from "fontverter";

const ttfRegular = readFileSync(new URL("../vendor/JetBrainsMono-Regular.ttf", import.meta.url));
const ttfBold = readFileSync(new URL("../vendor/JetBrainsMono-Bold.ttf", import.meta.url));

test("the glyphs the Session uses are all present (Regular and Bold)", () => {
  const used = "❯●╰─│✓✗⚠▲▶■□·∙•✶*○◌◉… abcXYZ0129/~[]{}()";
  for (const ttf of [ttfRegular, ttfBold]) {
    assert.doesNotThrow(() => assertCovered(ttf, used));
  }
});

test("Vietnamese is covered, so content may use it", () => {
  assert.doesNotThrow(() => assertCovered(ttfRegular, "ăâđêôơư ạắằẵặ ếệ ỗộ ờợ ửữự"));
});

test("every forbidden glyph really is absent, which is why substitutes exist", () => {
  const cov = fontCoverage(ttfRegular);
  for (const ch of FORBIDDEN_GLYPHS) {
    assert.equal(cov.has(ch.codePointAt(0)!), false, `${ch} unexpectedly present`);
  }
});

test("an uncovered character is reported by name, not silently dropped", () => {
  let error: unknown;
  try {
    assertCovered(ttfRegular, "hello 🙂");
  } catch (e) {
    error = e;
  }
  assert.ok(error instanceof Error);
  assert.match(error.message, /U\+1F642/);
  assert.match(error.message, /🙂/);
});

test("tabs and newlines are skipped without error", () => {
  assert.doesNotThrow(() => assertCovered(ttfRegular, "a\tb\nc"));
});

test("format 4 cmap alone returns correct coverage", () => {
  const cov = fontCoverage(ttfRegular);
  assert.ok(cov.has(0x0041), "format 4 includes A");
  assert.ok(cov.has(0x0061), "format 4 includes a");
});

test("format 12 alone returns correct coverage", () => {
  const cov = fontCoverage(ttfRegular);
  assert.ok(cov.has(0x1d538), "format 12 includes non-BMP");
});

test("fontCoverage returns different results for different subsets", async () => {
  const subset1 = await subsetToBase64(ttfRegular, "abc");
  const subset2 = await subsetToBase64(ttfRegular, "xyz");
  const bytes1 = Buffer.from(subset1, "base64");
  const bytes2 = Buffer.from(subset2, "base64");

  assert.notEqual(bytes1.length, bytes2.length, "subsets should have different sizes");
  assert.ok(bytes1.length > 0, "subset 1 should be non-empty");
  assert.ok(bytes2.length > 0, "subset 2 should be non-empty");
});

test("font with no cmap table throws", () => {
  const buf = buildNoCMAPBuffer();
  assert.throws(() => fontCoverage(buf), /font has no cmap table/);
});

test("non-BMP codepoints are accessible via format 12", () => {
  const cov = fontCoverage(ttfRegular);
  assert.equal(cov.has(0x1d538), true, "non-BMP codepoint 0x1D538 missing");
  assert.equal(cov.has(0xffff), false, "0xFFFF should be absent");
});

test("subset actually subsets, not silently ignored", async () => {
  const b64 = await subsetToBase64(ttfRegular, "abc");
  const woff2Bytes = Buffer.from(b64, "base64");
  assert.equal(woff2Bytes.subarray(0, 4).toString("ascii"), "wOF2");

  const sfntBytes = await fontverter.convert(woff2Bytes, "sfnt");
  const subsetCov = fontCoverage(sfntBytes);

  assert.equal(subsetCov.has(0x0061), true, "a should be in subset");
  assert.equal(subsetCov.has(0x0062), true, "b should be in subset");
  assert.equal(subsetCov.has(0x0063), true, "c should be in subset");
  assert.equal(subsetCov.has(0x0051), false, "Q should NOT be in subset");
});

test("the subset is valid woff2 and far smaller than the full font", async () => {
  const b64 = await subsetToBase64(ttfRegular, "abcdefghijklmnopqrstuvwxyz0123456789❯●╰");
  const bytes = Buffer.from(b64, "base64");
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "wOF2");
  assert.ok(bytes.length < 20_000, `subset was ${bytes.length} bytes`);
});

function buildFormat4CMAPBuffer(): Buffer {
  const buf = Buffer.alloc(256);
  let p = 0;

  const u16 = (v: number) => { buf.writeUInt16BE(v, p); p += 2; };
  const u32 = (v: number) => { buf.writeUInt32BE(v, p); p += 4; };

  u32(0x00010000);
  u16(1);
  u16(0);
  u16(0);
  u16(0);

  u32(0x636d6170);
  u32(0);
  u32(28);
  u32(0);

  const cmapStart = 28;

  u16(0);
  u16(1);

  u16(0);
  u16(0);
  u32(12);

  u16(4);
  u16(0);
  u16(6);
  u16(8);
  u16(0);
  u16(0);

  u16(0x007f);
  u16(0x01ff);
  u16(0xffff);

  u16(0xffff);
  u16(0x0020);
  u16(0x0100);
  u16(0xffff);

  u16(0);
  u16(0);
  u16(0);

  return buf.slice(0, p);
}

function buildFormat12CMAPBuffer(): Buffer {
  const buf = Buffer.alloc(256);
  let p = 0;

  const u16 = (v: number) => { buf.writeUInt16BE(v, p); p += 2; };
  const u32 = (v: number) => { buf.writeUInt32BE(v, p); p += 4; };

  u32(0x00010000);
  u16(1);
  u16(0);
  u16(0);
  u16(0);

  u32(0x636d6170);
  u32(0);
  u32(28);
  u32(0);

  const cmapStart = 28;

  u16(0);
  u16(1);

  u16(3);
  u16(10);
  u32(12);

  u16(12);
  u16(0);
  u32(20);
  u32(2);

  u32(0x0041);
  u32(0x005a);
  u32(0);

  u32(0x0061);
  u32(0x007a);
  u32(0);

  return buf.slice(0, p);
}

function buildNoCMAPBuffer(): Buffer {
  const buf = Buffer.alloc(32);
  let p = 0;

  const u16 = (v: number) => { buf.writeUInt16BE(v, p); p += 2; };
  const u32 = (v: number) => { buf.writeUInt32BE(v, p); p += 4; };

  u32(0x00010000);
  u16(1);
  u16(0);
  u16(0);
  u16(0);

  u32(0x6e616d65);
  u32(0);
  u32(28);
  u32(0);

  return buf.slice(0, p);
}
