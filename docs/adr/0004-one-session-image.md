# The whole Session is one image

The Profile README renders the entire Session, from Header to Statusline, as a single SVG per Theme Variant rather than one image per Command or real Markdown text. GitHub strips all CSS, so stacked images always get gaps between them, which would break the single-terminal illusion. One image also allows one choreographed timeline (playback, Banner decrypt, spinners, Mascot) and embeds the font once. What this costs:

- Repo names inside the Session can't be clicked. GitHub's native pinned repos under the README cover that.
- The whole file is regenerated whenever Activity refreshes.

## Amendment, 2026-10-02: the transcript block, not the alt text

This ADR originally accepted that "screen readers get the content only through the image's alt
text, which therefore carries the Session's full text". That cost is no longer paid, and the alt
text no longer carries it. The generator also writes the Session as plain text into a `<details>`
block directly under the picture (`docs/spec.md` 1, implemented in `src/readme.ts`), so a screen
reader, a search engine, a copy-paste and any client that will not render an SVG all get real
text. The `alt` attribute is therefore a short description of what the picture **is**, because
reciting what it contains would mean hearing the whole Session twice.

This is why the handle and the spinner's resting verb carry `textOnly` runs in `src/rows.ts`: the
Banner is geometry and the drawn verbs are one-at-a-time alternatives, so neither reaches a reader
except through that block.

## Considered Options

- One image per Command: modular and individually linkable, but each Command reads as a separate window.
- Markdown text with small images: most accessible and linkable, but loses the terminal look entirely.
