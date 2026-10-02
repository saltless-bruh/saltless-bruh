/**
 * Declarations for the two font dependencies, which ship JavaScript without types.
 *
 * Without these the strict check reports `subset-font` and `fontverter` as implicit `any` and stops, which is how the
 * type check came to be a command nobody could run clean. These are hand-written against the installed packages'
 * own signatures (`node_modules/subset-font/index.js` line 41, `node_modules/fontverter/index.js` lines 6 and 23),
 * narrowed to what this repo actually calls: a wrong guess here would be worse than no types at all, so the options
 * neither file passes are declared but left optional rather than invented. If either package starts shipping its own
 * declarations, delete the matching block.
 */

declare module "subset-font" {
  /** The container formats fontverter converts between, which is also what subset-font will emit. */
  type FontFormat = "sfnt" | "woff" | "woff2" | "truetype";

  /**
   * Subsets `originalFont` to the glyphs `text` needs and re-encodes it. `targetFormat` defaults to the format the
   * input was detected as. Resolves to the subset font; the build calls it with `{ targetFormat: "woff2" }`.
   */
  export default function subsetFont(
    originalFont: Buffer,
    text: string,
    options?: {
      targetFormat?: FontFormat;
      preserveNameIds?: number[];
      keepFeatures?: string[];
      variationAxes?: Record<string, number | { min?: number; max?: number; default?: number }>;
      noLayoutClosure?: boolean;
      glyphNames?: boolean;
    },
  ): Promise<Buffer>;
}

declare module "fontverter" {
  type FontFormat = "sfnt" | "woff" | "woff2" | "truetype";

  /** The format a font buffer is in, read from its first four bytes, or undefined if it is none of them. */
  export function detectFormat(buffer: Buffer): FontFormat | undefined;

  /** Re-containers a font. `fromFormat` defaults to the detected format. */
  export function convert(buffer: Buffer, toFormat: FontFormat, fromFormat?: FontFormat): Promise<Buffer>;

  const fontverter: { detectFormat: typeof detectFormat; convert: typeof convert };
  export default fontverter;
}
