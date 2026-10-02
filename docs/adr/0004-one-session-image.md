# The whole Session is one image

The Profile README renders the entire Session, from Header to Statusline, as a single SVG per Theme Variant rather than one image per Command or real Markdown text. GitHub strips all CSS, so stacked images always get gaps between them, which would break the single-terminal illusion. One image also allows one choreographed timeline (playback, the Banner's reveal, the spinner, the Mascot) and embeds the font once. What this costs:

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

## Amendment, 2026-10-02: two words in the opening paragraph

Verified against the build, because the sentence above describing the timeline had drifted from it.

**"Banner decrypt" was the reveal an early draft asked for, and it is not what runs.** The Banner is
geometry, block art compiled to merged paths per colour (`docs/spec.md` 3.3), so there are no glyphs
to decrypt or scramble through. What ships is a per-letter **stepped reveal**: each letter cuts
through one dim flicker frame and settles, left to right, over 0.45s. The correction and its
reasoning are in `docs/design-contract.md`; this record is the last place that still named the old
behaviour, and the point of the paragraph is unchanged, because one timeline is still what one image
buys.

**"spinners" was plural and there is one.** `docs/spec.md` 3.5 budgets perpetual motion deliberately:
exactly one spinner loops, and its verb is derived from `MASCOT_TIMELINE` so the word names the pose
on screen. A second spinner would be the decoration that budget exists to refuse.

## Considered Options

- One image per Command: modular and individually linkable, but each Command reads as a separate window.
- Markdown text with small images: most accessible and linkable, but loses the terminal look entirely.
