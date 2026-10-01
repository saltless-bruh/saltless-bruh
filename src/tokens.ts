export type ThemeName = "dark" | "light";

export type Palette = {
  bg: string; surface: string; border: string; text: string;
  muted: string; accent: string; warning: string; error: string;
};

// Everforest Hard, aqua-green accent. Every text role >= 4.5:1 on both bg and surface.
// Verified in docs/research/theme-research.md; accent doubles as success.
// Borders are hue-preserving lightenings of the Everforest borders: the window body is
// only 1.08:1 from GitHub's dimmed canvas and 1.03:1 from white, so the frame is the
// only thing separating the window from the page. Both clear 3:1 on their worst canvas.
export const PALETTES: Record<ThemeName, Palette> = {
  dark: {
    bg: "#272e33", surface: "#2e383c", border: "#677279", text: "#d3c6aa",
    muted: "#9da9a0", accent: "#83c092", warning: "#dbbc7f", error: "#e78183",
  },
  light: {
    bg: "#fffbef", surface: "#f8f5e4", border: "#8d9978", text: "#5c6a72",
    muted: "#667466", accent: "#3f7d4e", warning: "#926900", error: "#cd3a37",
  },
};
