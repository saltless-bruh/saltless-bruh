# The whole Session is one image

The Profile README renders the entire Session, from Header to Statusline, as a single SVG per Theme Variant rather than one image per Command or real Markdown text. GitHub strips all CSS, so stacked images always get gaps between them, which would break the single-terminal illusion. One image also allows one choreographed timeline (playback, the spinner, the Mascot, the Scan Sweep) and embeds the font once. What this costs:

- Repo names inside the Session can't be clicked. GitHub's native pinned repos under the README cover that.
- The whole file is regenerated whenever Activity refreshes.

## Amendment, 2026-10-03: the transcript block is deleted, and the alt text is the whole of it

**Superseding the 2026-10-02 amendment below, which is left standing because it records what the
block was and why it was built.** Read the two in order: that one says the alt text stopped carrying
the Session's text because the transcript started carrying it, and this one says the transcript is
gone and nothing took it over.

**What changed.** `src/readme.ts` no longer emits the `<details>Session transcript</details>` block.
The README is now the generated-file comment, the themed `<picture>`, and nothing else.
`readme.transcriptSummary` is deleted from `content.json` and from its validation in
`src/content.ts`, because a validated key nothing renders reads as maintained.

**The owner's reasoning, recorded as given.** Nobody opens it, and it makes the page look cluttered
under an otherwise clean image. A collapsed disclosure triangle under a full-width picture is the
one element on the page that asks the reader to do something, and it was asking on behalf of content
nobody wanted.

**What the accessible path is now, in plain terms: the `alt` attribute, and that is all of it.**
One sentence, `readme.imageAlt` in `content.json`, owner copy like every other visible string. The
shipped string is

> A terminal session, drawn as one picture.

which is the previous string with its trailing clause, *"The same words are in the transcript below
it"*, removed and nothing else rewritten. The clause had to go either way: with the block deleted it
was simply false, and an `alt` that points at something that does not exist is worse than one that
says less.

**What was traded, stated without softening, because a later reader has to be able to see it.** The
Session's 67 rows are no longer available as text to anybody: not to a screen reader, not to a search
engine, not to copy-paste, and not to a client that will not render an SVG. Everything the picture
says about the owner, the Lanes, the seven repos, the language shares and the year of activity is now
carried by the picture alone. The sentence above tells a screen reader user that a picture exists and
nothing that is in it: not the handle, not the discipline, not one repository name. The owner's route
for a reader who wants the detail is the repository's own `docs/`, which works for somebody already
browsing the repository and does not reach somebody whose screen reader has just read them the
profile page. A minimal alternative carrying the handle and the role was offered and declined. **This
is a presentation decision taken over an accessibility one, knowingly, by the owner, on 2026-10-03.**

**It is one commit to reverse, and this is what that commit is.** Put the `transcript` parameter back
on `renderReadme`, re-emit the block with its fence (the fence length must be computed from the body,
see the deleted `fence()` helper in this file's history), restore `readme.transcriptSummary` and its
`text()` call, and turn gate 11 back around. The measurements the block relied on are still recorded
and still true: `docs/spec.md` 1.1 has `<details>`, `<summary>` and a fence inside them surviving
GitHub's sanitiser, with the blank line after `</summary>` required.

**Gate 11 inverted rather than stopped.** `findReadmeFaults` in `scripts/gates.ts` used to fail if
the README had no `<details>` block, no `<summary>`, no fence, or fewer than twenty rows inside it.
It now fails if any of `<details>`, `<summary>` or a fence is present, one finding per piece, each
naming this amendment. Deleting the assertion was the alternative and it is refused: the alt text no
longer describes the content, so this gate is the only thing standing between a future change and a
profile whose accessible surface is one short sentence by accident rather than by decision.

**A correction to the amendment below, which gave a reason that has stopped being the reason.** It
says the spinner's resting verb carries a `textOnly` run so that one of the drawn alternatives
reaches a reader through the transcript. No reader is reached by it now, and the run is still
required: `src/build.ts` reads that run's COLUMN to stack the drawn verbs on, and `rowsToFullText`
must see every projection for the ADR 0001 name gate. The mechanism is unchanged and its
justification moved.

## Amendment, 2026-10-02: the transcript block, not the alt text

**Superseded by the 2026-10-03 amendment above: the block this records was deleted.** Kept because
it is the record of what was built and why, and because the amendment above is a reversal of it
rather than a replacement for it.

This ADR originally accepted that "screen readers get the content only through the image's alt
text, which therefore carries the Session's full text". That cost is no longer paid, and the alt
text no longer carries it. The generator also writes the Session as plain text into a `<details>`
block directly under the picture (`docs/spec.md` 1, implemented in `src/readme.ts`), so a screen
reader, a search engine, a copy-paste and any client that will not render an SVG all get real
text. The `alt` attribute is therefore a short description of what the picture **is**, because
reciting what it contains would mean hearing the whole Session twice.

This is why the spinner's resting verb carries a `textOnly` run in `src/rows.ts`: the drawn verbs are
one-at-a-time alternatives, so none of them reaches a reader except through that block.

**The handle used to need one too, and no longer does.** It was spelled by the Banner, which is block
art with no text in it, so a `textOnly` run was shimmed onto the Banner's middle row to put the owner's
name into the transcript and in front of the ADR 0001 scan. The Header is a shell prompt now
(`docs/spec.md` 3.3), where the handle is real text: one run draws it and transcribes it, and the
special case is gone. That is the direction this kind of change is supposed to go and it is recorded
because it went that way by luck rather than by design.

## Amendment, 2026-10-02: two words in the opening paragraph

Verified against the build, because the sentence above describing the timeline had drifted from it.

**"Banner decrypt" was the reveal an early draft asked for, and it is not what runs.** The Banner is
geometry, block art compiled to merged paths per colour (`docs/spec.md` 3.3), so there are no glyphs
to decrypt or scramble through. What ships is a per-letter **stepped reveal**: each letter cuts
through one dim flicker frame and settles, left to right, over 0.45s. The correction and its
reasoning are in `docs/design-contract.md`; this record is the last place that still named the old
behaviour, and the point of the paragraph is unchanged, because one timeline is still what one image
buys.

**Second amendment, the same day: the Banner is no longer drawn at all**, so neither the decrypt nor
the stepped reveal runs. The Header became a shell prompt because the wordmark and the pixel cat were
the same visual language and competed (`docs/spec.md` 3.3). The paragraph above is left standing
rather than deleted: it records what the reveal actually was, and `src/banner.ts` and the reveal are
both retained for the Landing Page, so the correction still has a subject.

**"spinners" was plural and there is one.** `docs/spec.md` 3.5 budgets perpetual motion deliberately:
exactly one spinner loops, and its verb is derived from `MASCOT_TIMELINE` so the word names the pose
on screen. A second spinner would be the decoration that budget exists to refuse.

## Considered Options

- One image per Command: modular and individually linkable, but each Command reads as a separate window.
- Markdown text with small images: most accessible and linkable, but loses the terminal look entirely.
