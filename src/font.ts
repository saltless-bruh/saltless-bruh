import subsetFont from "subset-font";

// Verified absent from JetBrains Mono v2.304. Emitting any of these renders a blank box.
export const FORBIDDEN_GLYPHS = "⎿✻✢✽✔✘◼◻⏵⏸";

/** Every codepoint the font can draw, read from its cmap (formats 4 and 12). */
export function fontCoverage(ttf: Buffer): Set<number> {
  const u16 = (o: number) => ttf.readUInt16BE(o);
  const u32 = (o: number) => ttf.readUInt32BE(o);
  let cmap = 0;
  for (let t = 0, n = u16(4); t < n; t++) {
    const rec = 12 + t * 16;
    if (ttf.toString("ascii", rec, rec + 4) === "cmap") cmap = u32(rec + 8);
  }
  if (!cmap) throw new Error("font has no cmap table");

  const out = new Set<number>();
  for (let s = 0, ns = u16(cmap + 2); s < ns; s++) {
    const off = cmap + u32(cmap + 4 + s * 8 + 4);
    const fmt = u16(off);
    if (fmt === 4) {
      const segX2 = u16(off + 6);
      const ends = off + 14;
      const starts = ends + segX2 + 2;
      for (let k = 0; k < segX2 / 2; k++) {
        const end = u16(ends + k * 2);
        const start = u16(starts + k * 2);
        if (start === 0xffff) continue;
        for (let c = start; c <= end; c++) out.add(c);
      }
    } else if (fmt === 12) {
      const groups = u32(off + 12);
      for (let k = 0; k < groups; k++) {
        const g = off + 16 + k * 12;
        for (let c = u32(g); c <= u32(g + 4); c++) out.add(c);
      }
    }
  }
  return out;
}

/** Throws naming the first character the font cannot draw. */
export function assertCovered(ttf: Buffer, text: string): void {
  const cov = fontCoverage(ttf);
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x0a || cp === 0x09) continue;
    if (!cov.has(cp)) {
      const hex = cp.toString(16).toUpperCase().padStart(4, "0");
      throw new Error(`character ${JSON.stringify(ch)} (U+${hex}) is not in the font`);
    }
  }
}

export async function subsetToBase64(ttf: Buffer, chars: string): Promise<string> {
  const out = await subsetFont(ttf, chars, { targetFormat: "woff2" });
  return out.toString("base64");
}
