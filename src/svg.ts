import { CANVAS_W, FONT_SIZE, canvasH } from "./grid.ts";
import { PALETTES } from "./tokens.ts";
import type { ThemeName } from "./tokens.ts";
import { esc, renderRows } from "./rows.ts";
import type { Row } from "./rows.ts";

export type BuildSvgOptions = {
  rows: Row[];
  theme: ThemeName;
  fontRegularB64: string;
  fontBoldB64: string;
  css?: string;    // animation layer, appended after the base stylesheet
  defs?: string;   // geometry: Banner, Mascot, Scan Sweep
  title: string;   // accessible name
  /**
   * A hook per row, by row index, for motion that addresses rows rather than runs: the playback.
   *
   * It belongs here rather than in `renderRows`, because the index a rule has to name is the row's
   * place in the Session and NOT its place among the elements that get drawn. A blank row emits no
   * element, so `text:nth-of-type()` counts a different sequence from the one the schedule is
   * built on, and the `<text>` elements a caller adds through `defs` are in that sequence too.
   */
  rowClass?: (row: number) => string | undefined;
};

export async function buildSvg(o: BuildSvgOptions): Promise<string> {
  const p = PALETTES[o.theme];
  const h = canvasH(o.rows.length);
  const title = esc(o.title);
  // The row's own hook comes first, so a row that already carries one keeps it and the added one
  // is only ever an extra name for the same element.
  const rows = o.rowClass === undefined ? o.rows : o.rows.map((row, i) => {
    const added = o.rowClass!(i);
    return added === undefined ? row : { ...row, cls: [row.cls, added].filter(Boolean).join(" ") };
  });
  // Base styles are the FINAL STILL FRAME. Animations in o.css drive away from this,
  // so `animation: none` under reduced motion lands exactly here.
  const base = `
    text { font-family: "JBMono"; font-size: ${FONT_SIZE}px; white-space: pre;
      font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0; }
    .text { fill: ${p.text} } .muted { fill: ${p.muted} } .accent { fill: ${p.accent} }
    .warning { fill: ${p.warning} } .error { fill: ${p.error} }
    .bold { fill: ${p.text}; font-weight: 700 }
  `;
  // Two faces, not one with a 400-700 range: a single face makes the browser
  // synthesise the bold, which smears a monospace grid.
  const faces = `
@font-face{font-family:"JBMono";font-style:normal;font-weight:400;src:url(data:font/woff2;base64,${o.fontRegularB64}) format("woff2")}
@font-face{font-family:"JBMono";font-style:normal;font-weight:700;src:url(data:font/woff2;base64,${o.fontBoldB64}) format("woff2")}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_W} ${h}" width="${CANVAS_W}" height="${h}" role="img" aria-label="${title}" shape-rendering="crispEdges">
<title>${title}</title>
<style>${faces}
${base}${o.css ?? ""}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
</style>
<rect width="${CANVAS_W}" height="${h}" fill="${p.bg}"/>
<rect x="0.5" y="0.5" width="${CANVAS_W - 1}" height="${h - 1}" fill="none" stroke="${p.border}" stroke-width="1"/>
${o.defs ?? ""}
${renderRows(rows)}
</svg>`;
}
