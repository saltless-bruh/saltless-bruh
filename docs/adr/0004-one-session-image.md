# The whole Session is one image

The Profile README renders the entire Session, from Header to Statusline, as a single SVG per Theme Variant rather than one image per Command or real Markdown text. GitHub strips all CSS, so stacked images always get gaps between them, which would break the single-terminal illusion. One image also allows one choreographed timeline (playback, Banner decrypt, spinners, Mascot) and embeds the font once. What this costs:

- Repo names inside the Session can't be clicked. GitHub's native pinned repos under the README cover that.
- Screen readers get the content only through the image's alt text, which therefore carries the Session's full text.
- The whole file is regenerated whenever Activity refreshes.

## Considered Options

- One image per Command: modular and individually linkable, but each Command reads as a separate window.
- Markdown text with small images: most accessible and linkable, but loses the terminal look entirely.
