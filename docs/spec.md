# Profile Session: build spec

What the `saltless-bruh/saltless-bruh` Profile README is, and the rules anything that renders it must obey. Terms are defined in [`CONTEXT.md`](../CONTEXT.md); decisions behind them are in [`docs/adr/`](adr/). This spec says *what must be true*, not how to build it; the plan does that.

## 1. Product

**Design read:** a developer profile for recruiters and fellow engineers, in a terminal language, built as hand-authored SVG on an Everforest palette with restrained motion.

**Dials:** variance 5, motion 5, density 8. A terminal is a fixed grid, so variance stays low on purpose; density is high because a terminal column is dense by nature; motion sits mid because the page must feel alive without becoming a screensaver.

One image per Theme Variant, rendering the whole Session, plus real Markdown beneath it.

```
github.com/saltless-bruh
┌─ Profile README ────────────────────────────────── ~846px desktop, ~308px phone ─┐
│ <picture>  dark themes  -> assets/session-dark.svg                                │
│            light themes -> assets/session-light.svg                               │
│            <img> fallback = session-dark.svg,  alt = one-line description         │
│                                                                                   │
│  ┌─ the Session, 84 cols ───────────────────────────────────────────────────────┐ │
│  │ ┌─(HANDLE@host)-[~/login]                                                    │ │
│  │ └─$ <the command whose output the Mascot is>                                 │ │
│  │                                                                              │ │
│  │ [Mascot: cat asleep on rack]  HANDLE  vVERSION                               │ │
│  │  rack LEDs blink -> Finding   <colour word> <model line>                     │ │
│  │                               <status line>                                  │ │
│  │                                                                              │ │
│  │ ───────────────────────────────────────────────────────────────────────────  │ │
│  │ > /whoami     three lines of copy                                            │ │
│  │ > /ops        three Lanes as a tree, seven repos, one line each              │ │
│  │ > /stack      languages as bars + percentages, bracketed tool rows           │ │
│  │ > /activity   Scan Sweep + "N/365 days up - M contributions"                 │ │
│  │ * <verb>...   spinner, loops forever                                         │ │
│  │ ───────────────────────────────────────────────────────────────────────────  │ │
│  │ Effort                                                                       │ │
│  │        Faster                               Smarter        │ Ultrachill  on  │ │
│  │        ───────────────────────────────────────▲────        │ Tab to toggle   │ │
│  │           low    medium    high    xhigh    lazy           │                 │ │
│  │                                                            │                 │ │
│  │        Ultrachill: dynamic nap on every task               │                 │ │
│  │   <-/-> to adjust - Enter to confirm - Esc to cancel                         │ │
│  └──────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│ <details> Session transcript </details>   <- real selectable text, same content   │
│ real Markdown links                                                               │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**Transcript block.** ADR 0004 accepted that an image exposes text only through `alt`. This spec improves on that: the generator also emits the Session as plain text inside a `<details>` block under the image. Screen readers, search and copy-paste then get real text, and `alt` stays a short description. ADR 0004 is amended to record this.

### 1.1 The delivery mechanism, measured

Everything in this section was measured against live GitHub on **2026-10-02**, before the README
generator was built on it. It is recorded here rather than in `docs/research/`, which is gitignored
so that third-party content and screenshots carrying the real name stay out of the repository.
None of this is either of those, and the first fact below is one the whole animated profile
depends on.

**The method, because it is what makes these re-checkable.** Each claim comes from POSTing the
real generated README to `https://api.github.com/markdown`, which is GitHub's own renderer behind
its own sanitiser, and reading what came back; and from fetching live response headers. Nothing
here comes from a secondary source, a blog post or a memory of how GitHub used to behave.

**The documentation page is now a weaker source than the renderer itself, and it moves fast.**
GitHub's `basic-writing-and-formatting-syntax` page has **dropped its entire "Specifying the theme
an image is shown to" section**; `prefers-color-scheme` no longer appears anywhere on it. What
survives is one line, *"The `<picture>` HTML element is supported"*, and the canonical dark/light
snippet now exists only in the 2022-08-15 GA changelog. The research notes written on 2026-10-01
stated that the page carries the snippet, and one day later it did not. So: verify against the
renderer, and treat the docs page as a statement of support rather than a specification.

| What was measured | Result |
|---|---|
| **The raw asset response** (`raw.githubusercontent.com`, an SVG) | `content-type: image/svg+xml`, `cache-control: max-age=300`, `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` |
| **Repo-relative image paths** | Rewritten to `raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>`. Both `srcset` and `src`. **Not camo** |
| **Camo, for contrast** | A camo-served SVG whose origin sends `cache-control: no-cache, must-revalidate` returned `age: 13130` (3.6 hours), `x-cache: HIT` |
| **`<picture>` through the sanitiser** | Both `<source media srcset>` elements survive verbatim, wrapped in `<themed-picture data-catalyst-inline="true">` |
| **`<img src alt width="100%">`** | Survives. GitHub appends its own `style="max-width: 100%;"` and wraps the image in `<a target="_blank" rel="noopener noreferrer" href="<src>">` |
| **`<details>` / `<summary>` with a fence inside** | Survive; the fence becomes `<pre><code>` with the column grid and the box-drawing glyphs intact. The blank line after `</summary>` is **required**: without it the fence renders as literal text |
| **An HTML comment** | Removed from the output entirely, so a generated-file notice at the top of the README costs a reader nothing |
| **`<script>` inside the fence** | Returned escaped as `&lt;script&gt;`. Nothing the transcript carries can climb out of the code block and become markup |

**`style-src 'unsafe-inline'` in that first row is the single fact the animated profile rests on.**
It is what permits the SVG's own `<style>` block, and therefore its `@keyframes`, to run at all
inside an `<img>`. If that policy ever tightens, every animation in section 3.5 stops and the
Session becomes the still frame. That is a survivable failure, because reduced motion already
requires the still frame to be the correct resting state, but it is the thing to check first if
the profile ever looks dead.

### 1.2 Chrome and Firefox, measured

Gate 1 asks for both engines, and an `<img>`-embedded SVG running its own `@keyframes` is exactly the
kind of restricted context where two engines could reasonably disagree. They do not. Measured
2026-10-02 on Chrome 153.0.8010.52 and Firefox 157.0, by rendering the same frozen instants of the
same asset through `scripts/render-check.ts --engine=` and differencing the PNGs.

| What was compared | Result |
|---|---|
| The SVG's `<style>` and `@keyframes` running inside `<img>` at all | **Both.** The CSP above is honoured identically; neither engine needs a fallback |
| The Mascot across all twelve poses of the 36s loop | **Pixel-identical** in eleven. The art is geometry at `crispEdges`, so there is nothing for a rasteriser to differ on |
| The Scan Sweep's beam position, at eight instants across the crossing | **Identical** at every one |
| The `/activity` result line | Absent at every instant the beam is still crossing, present from 2.55s, in **both** |
| The Ultrachill shimmer, per character across the word | **Identical** numbers. The sheen is on the same two characters in both at every step |
| The playback's last row reaching its settled value | Both reach it by 1.66s at 846px. At 308px Firefox is still within 22/255 of settled at 1.66s and exact by 1.70s |
| `prefers-reduced-motion: reduce`, both variants, both widths | **Both** collapse to the same still frame; the two engines differ only by text antialiasing |
| Everything else | Differs by about **1.4% of pixels, entirely glyph antialiasing**: it survives no downsampling, vanishing by 8x in every frame |

**The one real difference is a measuring hazard, not a viewer-visible one, and it is worth knowing
before it costs somebody an afternoon.** At a freeze landing *exactly* on a keyframe stop the two
engines resolve the boundary differently: Chrome applies the stop's own value, Firefox holds the
preceding step. It was found at `--freeze=28.80`, which is exactly the fifth 200ms stop of the fault
flash, where Chrome showed the bank lit and Firefox showed it dim. Ten milliseconds either side they
agree, and at `29.00` they agree because that stop is emitted as `80.556%` and therefore falls at
29.00016s rather than on the round number. Nothing a viewer sees depends on it, because an exact
boundary has zero duration in real playback and both engines run the flash at 2.5Hz. **So: when
comparing engines, do not freeze on a round multiple of a gesture's own step.** Offset by 10ms and
the comparison is clean.

**Firefox also screenshots on load rather than after a settle budget.** Chrome's
`--virtual-time-budget` lets the page run first; Firefox's `--screenshot` fires immediately, so an
unfrozen Firefox render catches the first instant of the playback and looks like a broken asset. That
is the harness, not the engine. `--freeze` removes the difference, which is the other reason every
comparison above uses it.

**How Firefox is asked for reduced motion.** It has no flag. `scripts/render-check.ts` writes a
throwaway profile whose `user.js` sets `ui.prefersReducedMotion`. MDN documents only the OS-level
toggles and never names that pref, so it was confirmed against the binary rather than taken from a
page: a probe whose rule only fires under `reduce` rendered green at `0` and red at `1`.

**Why the assets are repo-relative and not absolute.** The 5-minute `max-age` above is what makes
a refreshed Session appear promptly. An absolute URL to a third-party host would be rewritten to
camo instead, whose cache was measured serving a copy 3.6 hours old of an image whose own origin
asked for `no-cache`. `src/readme.ts` therefore emits `assets/...` and a test asserts every
declared path is relative and under `assets/`.

**The `<img>` fallback is the dark variant.** With both media queries present the `src` is only
reached by a client that does not implement `<picture>` at all. Readability does not decide it:
`src/svg.ts` paints a full-size opaque background rect plus a border stroke, so each variant
carries its own panel and is legible on any canvas. Consistency decides it, and `CONTEXT.md`
records dark as the fallback. GitHub's own GA example happens to use light; this is a deliberate
local departure, not an oversight.

## 2. Build pipeline

```
content.json  (the only file the user edits)
     +
GitHub GraphQL  ->  cache/activity.json (cache)         .github/workflows/refresh.yml
     +                                                   daily cron + manual dispatch
design tokens                                            commits only when output changed
     |
     v
  generator (TypeScript, Node 26, no build step)
     |
     +-> assets/session-dark.svg
     +-> assets/session-light.svg
     +-> README.md
```

Assets are committed to `main` and referenced by relative path, so GitHub serves them from `raw.githubusercontent.com` with a 5-minute cache and never through the image proxy.

## 3. Hard constraints

Measured. The working notes are in `docs/research/`, which is **gitignored**, so a clone does not
have them: anything from there that the build actually depends on is restated in this file. For
the README's delivery mechanism, including the content-security policy that lets the SVG animate
at all, see [1.1](#11-the-delivery-mechanism-measured), which carries both the findings and the
method for re-checking them.

### 3.1 Platform

| Rule | Value |
|---|---|
| Rendering surface | `<img>`-embedded SVG: no JavaScript, no interaction, no external resources |
| Animation | CSS `@keyframes` only. **No SMIL**: SMIL keeps running under reduced motion, CSS does not |
| Fonts | Must be embedded as base64 `@font-face`. External fonts and `@import` are blocked |
| Theme switching | `<picture>` with two files. Not SVG-internal `prefers-color-scheme` (fails in Safari) |
| Markdown | `<style>`, `class`, inline `style`, `<iframe>` and inline `<svg>` are stripped. Layout is tables, `align`, and image `width` |
| Column width | README is ~846px desktop, ~308px on a 390px phone |
| Refresh | Cron minimum 5 minutes; scheduled workflows auto-disable after 60 days without repo activity |
| Size | Each SVG <= 250 KB |

### 3.2 Grid

Measured from JetBrains Mono v2.304: unitsPerEm 1000, advance 600 (exactly 0.6em, uniform across all glyphs), cap height 730, ascender 1020, descender -300.

| Quantity | Value |
|---|---|
| Font size | 20 units |
| Cell | 12 x 24 units (advance 20 x 0.6 = 12 exactly) |
| Columns | 84 (= 1008 units) |
| Padding | 16 units each side |
| Canvas width | 1040 units |
| Canvas height | 32 + rows x 24 |

At 846px the cell is ~9.8px; at 308px it is ~3.6px. A `viewBox` with no fixed pixel width lets the image scale to the column.

**84 columns, and the number is a measurement.** The canvas scales into the README column, so the
column count is what sets the rendered TEXT size. At 72 columns the 20-unit font rendered at
**18.9px** in an 846px column, where a terminal is 13 to 15px; that is what read as everything being
huge and cramped. At 84 it renders at **16.3px** and the existing line lengths still nearly fill the
row. **96 was built and rendered beside 84 and rejected by the owner**: it gets the size right too,
and it opens a visible dead margin on the right, because the copy was written for 72 and does not
grow with the grid. 84 is the widest setting the existing copy still fills. Pinned by
`test/grid.test.ts`, which computes both figures rather than quoting them.

**The row pitch is locked to twice the column, so the line-height ratio is structurally 1.2x and
EXTRA LEADING CANNOT BE BOUGHT AT ANY SCALE.** `src/mascot.ts:33` refuses to load unless an art pixel
is square, which is `CELL_W / 2 === CELL_H / 4`; with `PX = CELL_W / 2` that leaves `CELL_H = 2 x
CELL_W` and nothing else. `CELL_H / FONT_SIZE` is therefore 1.2 at every font size and every column
count. Raising `CELL_H` alone breaks the sprite; raising both holds the ratio and only changes the
absolute size. This is recorded because it was found by breaking it, and because adding leading is
the first thing a reader of the two tables above will reach for.

### 3.3 Glyphs

Verified present in JetBrains Mono v2.304, so the Session needs no hand-drawn glyph paths: `❯ ● ╰ ─ │ ✓ ✗ ⚠ ▲ ▶ ← → ■ □ · ∙ • ✶ * ○ ◌ ◉ …`, all printable ASCII, all box-drawing, all block and quadrant characters, and full Vietnamese.

**`←` (U+2190) and `→` (U+2192) were added to that list on 2026-10-02**, when the Statusline panel
gained the key hints its reference carries. They were measured the way everything else here is,
against the vendored faces rather than against a character chart: `assertCovered` on both Regular
and Bold reports them present. They are listed because the glyph set is a record of what was
checked; a glyph used but unlisted is indistinguishable from one nobody checked.

**Named individually on 2026-10-02, for the same reason:** `├` (U+251C) and `└` (U+2514), which
draw the `/ops` tree, and the eighth blocks `▏▎▍▌▋▊▉` (U+258F down to U+2589) with `█` (U+2588),
which draw the `/stack` bars. All nine are inside the "box-drawing" and "block" families the line
above already claims, and all nine were put through `assertCovered` on both faces rather than
inferred from that claim.

Verified **absent**, and therefore forbidden: `⎿ ✻ ✢ ✽ ✔ ✘ ◼ ◻ ⏵ ⏸`. The substitutes above replace them.

Text is rendered as `<text>`. The Mascot and the Scan Sweep are **geometry**, not glyphs: block art compiled to merged paths per colour, with `shape-rendering="crispEdges"`, which avoids seam hairlines at fractional scale and gives the Mascot per-part groups to animate.

**The Scan Sweep's pitch is its own, and it did not shrink when the text did.** It was `CELL_W`, one
week per text column, which made the band 53 of 72 columns. At 84 columns that stops working: the
cells are geometry rather than glyphs, so at a 12-unit pitch on the wider canvas the band falls from
79% of the row to 67% and reads as stranded, ending before the two-thirds point while every rule
above it runs the full width. The pitch is therefore **14 units**, which is `12 x 84 / 72`, so **the
band's rendered size is unchanged**: at 846px a 12-unit pitch on the old 896-unit canvas was 11.33px
and 14 units on the 1040-unit canvas is 11.38px. That is the whole rule and it is the right one here,
because 84 columns exists to make the TEXT smaller and the sweep was never too big. It fills 742 of
the 948 units from its own column to the margin, **78.3% against 79.1% before**.

**It cost one row, and the squareness is why.** GitHub's own calendar uses square cells, so the row
pitch follows the column pitch rather than the text grid, and seven cells at 14 units are 98 units
where a four-row band is 96. `SCAN_ROWS` is therefore **5**, with the 22 units of slack split above
and below for the beam's overhang. **No pitch above 12 fits four rows at all**, and `src/scan.ts`
throws rather than drawing the sweep into the row above it. The cell grows with the pitch (12 units)
and the gutter stays 2, because the gutter is the beam's own width: the beam sits in it exactly, and
a hit closing it is the band's loudest signal. `BEAM_W` is now read off `GAP` instead of being the
same number written down twice.

**The Banner was geometry too, and it is no longer drawn.** The Header was a block-art wordmark
beside the Mascot, and looked at live the two competed: the same blocks, the same Accent, the same
weight, so the Header read as two drawings rather than as one picture. It is now a Kali-style shell
prompt, `┌─(HANDLE@host)-[~/login]` over `└─$ <command>`, with the Mascot as that command's output.
A prompt is terminal rather than decoration dressed as terminal, so the name stops being an object
that has to justify itself and takes the one place a name structurally belongs in a shell, and the
cat finally has a reason to be there. `src/banner.ts` is retained with its tests for the Landing
Page and carries a note at the top saying so; nothing in the Session calls it.

A consequence worth recording, because it removed a special case rather than adding one: the Handle
used to need a `textOnly` run shimmed onto the Banner's row to reach the transcript at all, since
block art carries no text. In the prompt it is real text, so one run draws it and transcribes it.

**The `/stack` language rows are drawn as well as printed.** Each row is the language, a bar, and
the whole percentage right-aligned at the far end of the bar's field. The bar is `BAR_COLS = 34`
columns at a full 100%, a named constant rather than whatever is left over between the longest
name and the margin, because a figure whose drawn length changed with the data would mean 90% was a
different length in two builds of the same profile. It is drawn to the nearest **eighth** of a
column: a bar rounded to whole columns could say only 34 things, so 3% and 5% would be the same
picture, where an eighth is 0.37 of a point and the length a reader sees is the figure beside it.
The length is taken from the printed whole percentage and not from the raw byte share, so the
drawing and the number cannot disagree; the rounding is done once, in eighths, with the whole
blocks as the whole part of it, because flooring to columns and rounding the remainder separately
carries past the end of the glyph table at shares like 47%.

The constant costs the name field: a language name has 37 columns before the row overruns, against
73 before (25 and 61 when the Session was 72 columns wide; both move with `COLS`). That is stated here and pinned by a test so a build failing on a long language name is a
known price rather than a surprise.

**A language whose share rounds away keeps its row, printed `<1%`.** The owner's decision. An empty
bar beside `<1%` says present and too small to draw, which is true; `0%` beside the same blank
reads as a language that failed to measure, which is the one reading that is false, and an earlier
copy audit flagged exactly that. With no bytes at all the figure stays `0%`, because `<1%` is a
claim that something is there.

**The `/stack` tool rows are bracketed**, `[metasploit] [burp]`, one column between tags. Two words
separated by spaces read as prose, so `peass-ng pspy` is one tool or two depending on the reader;
brackets make each one a unit. They cost two columns a tool and buy back one from the separator,
and every shipped row still lands on a single row, the widest at 64 of 84 columns. A row too wide
is refused and names itself rather than wrapping.

**Weight.** Both Regular and Bold are vendored and subset, and each gets its own `@font-face`. A single face with `font-weight: 400 700` would make the browser synthesise fake bold, which smears a monospace grid. Emphasis otherwise comes from the Accent, not from weight.

**Two-row repo entries, drawn as a tree.** A repo name and its description cannot share a row: a name at column 7 leaves only 37 columns for the description, which no useful sentence fits. A two-column name-and-blurb table was costed again on 2026-10-02 and rejected on the owner's own copy: the blurbs run 40 to 61 characters against a longest name of 25, so six or seven of the seven overflow at any sensible gutter, and the only way to make it fit is to rewrite the owner's sentences, which is not a layout fix. The name sits on one row and the description is indented on the next, which also reads more like real command output.

Containment is **drawn** rather than implied by that indent: `├─` on every repo but the last in its Lane, `└─` on the last, and a `│` carried down the description row of a non-last repo, with that column left blank under the last, which is what closes the branch. Every connector comes from the repo's position in its Lane, so a Lane of one gets `└─` for the same reason the last of seven does. This is what `tree(1)` prints, which makes it terminal-native rather than decorative, and it is the same alphabet as the Header prompt's `┌─`/`└─`. It costs no rows and no columns: the connectors go at column 4, which the indent was already leaving blank, and the name and description stay at columns 7 and 9.

**The Header is flush left, and the Mascot is placed by its INK rather than by its grid.** Until
2026-10-02 the sprite sat at the command's column, which is where a shell's output belongs relative
to what printed it. The reasoning is sound and the result was wrong: the sprite and the startup block
beside it are the widest object on the page, so a four-column indent made the whole Header read as
floating in from the margin while the prompt's `┌─`/`└─` above it and every rule below it ran from
column 0. The reference this grammar is borrowed from puts its own startup banner flush against that
margin. The sprite's column is therefore **0**, and because `mascotDefs` subtracts `MASCOT_INK_LEFT`
(10 art pixels of blank left edge in the source grids) the column it is handed is the column the
leftmost **painted** pixel lands on, not where the art file begins. The startup block's column is
re-derived from the sprite rather than adjusted to follow it, so it moved from 29 to 25 with no
constant edited. The two prompt rows are unchanged: they already started at column 0, so the Header
now shares one spine from its first row to its last.

**The role line is deleted.** It read "Offensive Security · Agentic AI Systems" and `/whoami`'s first
line reads "offensive security. agentic ai systems." four rows below it, so the Session stated the
owner's discipline twice in two cases; a copy audit flagged the redundancy and it grew more visible as
the Header did. The row also had nothing around it, alone between the startup block and the rule,
which is what made it read as orphaned rather than as the Header's closing statement. The blank row
above it **stays**: the artwork's ink reaches the bottom of its own band with no margin, so whatever
is printed under it lands under three units away, and that clearance was never the role line's. The
`role` key is gone from `content.json` and from its validation; the SVG's accessible name, which was
the only other reader of it, now reads `whoami[0]`.

**The Statusline's two panes are divided by a `│`.** The effort scale and the toggle shared their rows
with nothing but whitespace between them, so the toggle read as having drifted right rather than as
occupying a pane. The divider sits **immediately left of the toggle block with one clear column on
each side**, derived from the toggle's own column. **What that column is derived from changed on
2026-10-03**: it used to be the toggle's wording, and it is now the track's end, so the divider follows
the SCALE and a re-worded toggle no longer moves it (3.3, E44). It is the `/ops` tree's own continuation
mark, read off that constant rather than retyped: `┃`, `╎` and a box corner would each be a new mark to
learn for a job the Session's existing alphabet already does. It spans the **five** rows the two panes
share, from the `Faster`/`Smarter` row down to the gloss row and through the row of air above it, and
not the `Effort` heading above them, which sits outside both panes, nor the key hints below, which run
the full width under both. The span is taken from where the pane's rows start and end rather than
written down, which is why the row of air joined it with no edit. **The span was
decided by rendering both** at 846px and 308px: stopped at the levels row, the gloss, which is the
longest line in the left pane, is the one row reaching across the boundary with nothing marking it,
and the toggle, which is the thing the divider exists to separate, is the one row not separated.
Colour is **`muted`**, measured at **5.65:1 on the dark window and 4.77:1 on the light one**. `border`
was the alternative and is refused on a measurement rather than on taste: **2.79:1 and 2.92:1**, so a
structural mark drawn in it would miss the 3:1 that 1.4.11 asks of exactly this kind of element, and
it is not a text role at all by the 4.5:1 rule in 3.4.

**The effort track declares its own width: 44 columns, a named constant.** The owner calls this E44.
Until 2026-10-03 the track ended at `toggleCol - PANEL_GAP` while `toggleCol` was the right edge less
the toggle's own width, so **the scale's width was a function of the toggle's wording**: renaming
`Ultrachill` to anything longer silently shrank the scale, and the five levels each lost a column to a
word that has nothing to do with them. That is backwards. The scale is the panel's content and the
toggle is a secondary readout beside it, so the dependency now runs the other way: `trackCol` is the
heading's length plus two, the track is 44 columns, the toggle's column follows from the track's end
plus the existing gap with the divider in it, and **the toggle pane is whatever remains to the right
edge**. 44 was compared against 40 rendered and chosen by the owner: at 40 the five levels sit on
8-column slots and `medium` and `xhigh` leave one or two blank columns between neighbours, so the
scale reads as a list of words again, which is the exact complaint the panel exists to answer. Two
guards keep the inversion honest and both name their numbers rather than overflowing: the levels must
fit the 44 columns, and the toggle and its hint must each fit the pane the track leaves. The visible
price, accepted with the 84-column grid for the same reason, is that the toggle is left-aligned in its
pane rather than flush right, so about **12 columns of the row sit blank to the right of it**.

**The toggle sits on the TRACK's row, with its hint on the levels row. This is a deliberate departure
from the reference, which puts its own toggle on the LABELS row.** The owner has looked at both
rendered and prefers this one; it is recorded here so nobody corrects it back. Before, the toggle sat
on the gloss row, the fourth of the pane's rows, with the hint on a fifth row below the panes
entirely, so the right pane began three rows below the block it belongs beside and read as having sunk
to the bottom. Level with the track it toggles, the two panes start on one floor and the eye pairs
them.

**One row of air separates the scale from the gloss, and the divider runs through it.** The two end
labels, the track and the levels are ONE object, a scale read top to bottom; the gloss is a separate
statement about a different control. Butted together they read as a four-row block whose fourth row is
an orphan, and one row of air makes the scale a unit and the gloss a caption. The blank is INSIDE the
pane, so the boundary continues through it: a divider that broke across a gap would read as two rules
rather than as one boundary, and because the span is derived from where the pane's rows start and end
it followed the new row without an edit. **The two changes together cost nothing**: lifting the hint
onto the levels row freed exactly the row the blank consumes, so the panel is the same ten rows it was.

### 3.4 Palette

Everforest Hard with an aqua-green Accent. Every text role is at least 4.5:1 on both `bg` and `surface` of its own variant.

| Token | Dark | Light |
|---|---|---|
| bg | `#272e33` | `#fffbef` |
| surface | `#2e383c` | `#f8f5e4` |
| border | `#677279` | `#8d9978` |
| text | `#d3c6aa` | `#5c6a72` |
| muted | `#9da9a0` | `#667466` |
| **accent** (= success) | `#83c092` | `#3f7d4e` |
| warning | `#dbbc7f` | `#926900` |
| error | `#e78183` | `#cd3a37` |

Rules: one Accent everywhere; the same hue in both variants with only lightness shifted; opaque window background with a 1px frame; status colours only inside command output and always paired with a glyph or word, never used as decoration.

**One word in the Header breaks that last rule on purpose, and it is the only one.** The startup
block's model line begins with the word `red`, drawn in the `error` token. `red cat` puns on `red
hat`, which puns on `red team`, which is what the owner does, so drawing the word in the actual red
makes the pun visual as well as verbal. The usual objection does not bite here because the word IS
"red": a reader parses it as a colour being named, not as a fault state, which is the thing
`tui-design`'s one-colour-one-meaning rule is protecting against. Measured: `error` is **5.16:1 on
the dark window and 4.77:1 on the light one**, which is the same 4.5:1 every other text role clears.
What it does NOT do is separate from the `muted` text beside it by lightness: that pair measures
**1.10:1 in dark and 1.00:1 in light**, so the word is told from its line by hue alone and a protan
or deutan reader will see one muted line. Nothing is lost when that happens except the pun's visual
half, which is why it ships; the sentence reads the same either way. A second word in the `error`
token would not be covered by any of this, and a test pins that there is exactly one.

**The frame carries the window.** Everforest's own border colours are too faint against GitHub's canvases: the dark window body is only 1.08:1 from the dark-dimmed canvas and the light body is 1.03:1 from white, so without a visible edge the window simply dissolves into the page. The two border values above are hue-preserving lightenings of the Everforest borders, chosen to clear 3:1 against the worst canvas each one faces (dark `#677279` is 3.02:1 on dimmed and 3.84:1 on dark; light `#8d9978` is 3.02:1 on white).

**Those three figures are the TOKENS. What renders is less, and at 308px the frame is not there at all.**
Measured from rendered pixels in Task 12, which is the first time this pair was sampled rather than
computed, on the 896-unit canvas of the time. The frame is `stroke-width="1"` in the `viewBox`
(`src/svg.ts`), so it was **0.94
device pixels at 846px and 0.34 at 308px**, and a sub-pixel stroke is antialiased into whatever it
sits on:

| Width | Engine | Frame as rendered, vs its canvas | |
|---|---|---|---|
| 846px dark, on dark | Chrome | 3.62:1 | clears 3:1 |
| 846px dark, on dark-dimmed | Chrome | **2.84:1** | misses, where the token computes 3.02:1 |
| 846px dark, on dark-high-contrast | Chrome | 3.92:1 | clears 3:1 |
| 846px light, on white | Chrome 2.80:1, Firefox 3.02:1 | | borderline |
| **308px light, on white** | Chrome **1.43:1**, Firefox **1.00:1** | | **the frame is gone** |
| **308px dark, on dark** | Chrome **1.94:1**, Firefox **1.37:1** | | **the frame is gone** |

At 308px Firefox drops the stroke entirely: the edge pixel is the window body's own colour. What is
left holding the window is the body-against-canvas step, which is 1.37:1 in dark and **1.03:1 in
light**, and 1.03:1 is the exact number quoted two paragraphs above as the reason the frame exists.
So on a phone in light mode the window has no edge, at the width `docs/design-contract.md` says the
work is judged at. Nothing else is affected: every text role still clears 4.5:1, so this costs the
terminal-window illusion rather than any legibility.

**The fix is one attribute and it is measured, not proposed.** Adding
`vector-effect="non-scaling-stroke"` to that rect renders the stroke at one device pixel whatever the
scale, and at 308px it brings the light frame to **3.02:1 in both engines**, which is exactly the
figure the token was chosen for. `stroke-width="2"` was tried as the obvious alternative and is worse
and engine-dependent (2.06:1 Chrome, 3.02:1 Firefox), because it is still sub-pixel at 308px.

**THAT ATTRIBUTE IS NOW IN `src/svg.ts`, so the table above describes a state the build no longer
emits, and what it emits instead still misses 3:1.** Noticed while rendering the 84-column grid and
re-measured rather than assumed, Chrome only, from the same rendered pixels the rest of this section
comes from: the frame against its canvas is **3.84:1 at 846px dark and 3.02:1 at 846px light**, and
**2.65:1 and 1.97:1 at 308px**. So the frame is no longer GONE at phone width, which is what the table
above says, and it is not the 3.02:1 the attribute was expected to give either. The reason is the rect
itself rather than the attribute: it is drawn at `x="0.5"` in the `viewBox`, which is not a whole
device pixel once the canvas is scaled to 308px, so a one-pixel stroke still straddles two. The honest
reading is that the 1.4.11 exception in section 7 **narrowed and did not close**, and the remaining
lever is the rect's own coordinates, not its stroke. Left for the owner, like the attribute was,
because it alters published output; recorded here so the numbers above are not read as current.

### 3.5 Motion

Every animation must justify itself in one sentence. Anything that cannot is cut.

| Element | Behaviour | Why it earns its place |
|---|---|---|
| Playback | Once on load, 1.896s measured against the owner's content: rows arrive 26ms apart, each settling over 180ms | Storytelling: establishes that this is a session being run, not a poster |
| Spinner | After playback, one spinner loops. Its verb names whatever the Mascot is doing right now, on the same 36s clock | State: it is a readout of the Mascot, not decoration, which is why it may loop at all |
| Mascot | 36s master loop: breathing at 3.0s, with a yawn, a stretch, a settle, a one-second peek at the viewer, and an alarm she wakes to | Storytelling: the operator naps while the agents work, which is the whole metaphor |
| Mascot micro-layers | Ear 17s, tail 23s. Co-prime periods mean the combined pattern does not visibly repeat | Keeps the loop from reading as a loop |
| Rack LEDs, healthy | 7s, 11s and 13s flickers, staggered so no two are ever lit at the same instant | State: three services on their own clocks; this is the cause the sleeping cat is the effect of |
| Rack LEDs, faulting | From 28s to 31.6s they are `error` and flash in unison at 2.5Hz, then hold steady `accent` for the recovery beat | State: unison is what reads as one machine in trouble, precisely because the healthy state is defined by never agreeing |
| Scan Sweep | Beam crosses the calendar once during playback, then once per 36s master loop | Storytelling: the calendar is read as something being scanned, not a heatmap |
| Ultrachill shimmer | A bright band crosses the word once every 9s, a quarter of the master loop | Hierarchy: it marks the one joke in the Statusline without running constantly |

**The toggle is a gradient standing still, and the shimmer now travels it.** Until 2026-10-02 the
word was uniform `muted` at rest and the shimmer was the only thing that made it worth looking at,
which meant that at rest it was plain and that a reduced-motion reader, and most visitors, never saw
the point of it at all. The resting word now carries one point of a measured `muted`-to-`accent`
ramp per character, so it reads as polychrome with nothing running; the sheen lifts each character
in turn to the ramp's bright end and dissolves into it. **The cadence is unchanged**, and
deliberately so: this is the one place in the Session where making the still frame carry the idea
removed the argument for a fourth continuous loop rather than strengthening it. The budget above
still has three.

**The playback is the one animation with a hard ceiling, because it is the one everybody waits on.** It
fires on every page load and stands between a reader and the content, so the unit is the row and not the
character: the Session carries about 2,600 characters, and a per-character typewriter at any readable rate
is tens of seconds of a visitor looking at a page that is not there. Rows arrive 26ms apart and settle over
180ms, so the figure is `26ms x (rows - 1) + 180ms` and it moves when the content does. **Against the
owner's real content it is 1.92s**: 68 rows, measured in headless Chrome **and Firefox** at both 846px and
308px rather than computed, and printed by `npm run build` on every run so it cannot go stale again. The
ceiling is what matters and it is unchanged; an earlier 57-row Session measured 1.64s and this section
quoted that one length as though it were the rule, a 58-row one measured 1.66s, and a 68-row one 1.92s.

**1.92s was the closest this has come to the ceiling, and two rows came back off the same day.** The
Statusline became a panel (eight rows) and the Header became a shell prompt (two), so ten rows arrived
in one morning and each one costs 26ms. Then the owner's review deleted the role row and the row that
carried the mode badge and the not-affiliated note, and **66 rows measured 1.87s**. Worth stating
plainly, because the arithmetic is easy to misread: the badge and the note were **one row, not two**,
since the badge sat at the left margin and the note was flush right on the same line. Three deletions
of copy removed two rows.

**One row went back on with the 84-column grid, and it is the sweep's, not the copy's.** The Scan
Sweep's pitch grew with the Session (3.3) and seven square cells at 14 units no longer fit a four-row
band, so `SCAN_ROWS` is 5 and the owner's content is **67 rows, measuring 1.896s**. Nothing else moved:
the Session does not wrap, so a wider grid changes no row count, and the Statusline's two changes of
the same day, the lifted toggle and the row of air above the gloss, cancel each other exactly. **1.896s
is four milliseconds under the 1.9s the instruction below names**, which is close enough to say out
loud: the next row added fires it.

> **THE NEXT ROWS ADDED TO THE SESSION MUST COME WITH A REDUCTION IN THE 26ms STAGGER.** That is the
> lever, and it is the only one: the stagger is a design constant rather than a measurement, so it can
> be retuned, while the row budget is the content and cutting content to protect an animation would be
> the wrong trade. Nobody can perceive the difference between a 1.9s reveal and a 2.0s one; the ceiling
> exists because tens of seconds is intolerable, not because two is a cliff. This is written as an
> instruction rather than as an observation so that whoever adds the row that takes this past 1.9s
> finds the constraint here instead of discovering it in a render. The two rows deleted on 2026-10-02
> bought **six rows** of headroom at today's stagger, and they are not a budget to spend: they came out
> because the page read as cluttered.

The startup block beside the Mascot cost nothing, because it prints into rows the sprite had already
reserved. That is the shape to prefer when there is a choice, and the `/ops` tree and the `/stack`
bars were both built to it: each draws into columns their own section was already leaving blank, so
three changes landed on 2026-10-02 for **zero extra rows**. The Statusline's pane divider is the
fourth and newest of them: it draws into a gutter the panel was already leaving blank between the
scale and the toggle, so it adds structure for no rows at all.

**There is no Banner reveal any more.** It resolved the wordmark letter by letter over 0.45s and was the
Session's one moment of spectacle; the wordmark was retired with the Header (3.3), so the spectacle went
with it. Nothing replaced it, and the motion budget is one loop lighter for it. The reveal's code is
retained in `src/playback.ts` with the alphabet it drove, unused, for the Landing Page.

**The loop is 36 seconds, and the gaps are what got cut.** An earlier 60-second version put the first event 15 seconds in, past the point most visitors look away, while only about 12 of those 60 seconds contained any event at all. Shortening the gesture durations would have been the wrong fix: a 3.4-second yawn is a yawn, a 1-second one is a twitch. So every gesture kept its length and the waiting between them was halved. The first event now lands at 7.5s and the longest wait is 11.25s.

**Perpetual motion is budgeted.** Several independent loops running at once reads as a screensaver, so only the spinner, the Mascot (with its micro-layers) and the LEDs run continuously, all of them low-amplitude. The Scan Sweep deliberately does **not** free-run on a short cycle: it is the widest moving element on the page, so it fires once on load and then rests, re-firing only on the Mascot boundary. The Ultrachill shimmer fires once per quarter-loop for the same reason.

**Everything derives from one timeline.** `MASCOT_TIMELINE` in `src/timeline.ts` is the only place a pose boundary is written down; every keyframe percentage, the bubble's pop instant and the spinner's verb schedule are computed from it. This is not tidiness. When the loop was retimed from 60s to 36s, the single value that had been hand-typed rather than derived, a breath count, silently produced a 2.25-second breath instead of 3.0 and was caught only because everything around it moved correctly. A derived value cannot drift; a copied one always can.

**The spinner is bound to the Mascot.** The Mascot's timeline is the single source of truth for both. The spinner's verb is derived from it, so the label always names the pose on screen: `Yawning…` while the cat yawns, `Stretching…` while it stretches, the alarm's own verbs while she deals with the rack, and a slow rotation through the sleep verbs the rest of the time. A spinner cycling words unrelated to the picture would be decoration; this one reports state, and the two together read as one coordinated motion rather than two loops competing.

The alarm needs it more than the rest of the loop does. Everforest's `error` and `accent` sit at the same lightness (measured: 1.26:1 apart in dark, 1.00:1 in light), so red-to-green is a pure hue change, which is the pair a protan or deutan viewer cannot separate and which is weak at 308px anyway. The fault is therefore carried by **behaviour** (three lights agreeing, at 2.5Hz, against a healthy state where they never agree) and **named by the spinner**, never by colour alone.

**The alarm replaces the old `startle`, and the two jolts became one.** The nose bubble used to pop at its own moment and the cat startled at another. The bubble now pops at the instant the alarm begins, so the loop has one shock rather than two. The peek is placed late, at 25s, deliberately: it catches a viewer who has been reading rather than one who has just arrived. It lands while the bubble is still inflating, because a bubble says deep sleep and an open eye says she is faking it.

A scroll-triggered peek was considered and is **impossible**: GitHub renders the Session inside an `<img>`, which is a separate document with scripts disabled and no knowledge of the host page's scroll position. The loop clock is the only trigger available.

**Reduced motion is structural, not an add-on.** Base CSS must already be the correct final still frame: Session fully visible, Mascot on its rest pose, Scan Sweep showing all hits. Every animation drives *away from* that base and returns to it. The whole motion layer then collapses with one rule:

```css
@media (prefers-reduced-motion: reduce) { * { animation: none !important } }
```

Animation must only touch `opacity` and `transform`. No `filter`, `mask` or `blur`.

### 3.6 Identity and copy

- The real name must never appear in any committed file, generated asset, alt text or transcript (ADR 0001). This is enforced by a build check, not by discipline.
- No Anthropic name, logo, mascot, brand colour or verb list (ADR 0002). **The Statusline no longer
  carries a not-affiliated note**, amended into ADR 0002 on 2026-10-02: that line was measured to be
  the only occurrence of the name anywhere in the published profile, so deleting it takes the profile
  from one mention to zero and satisfies this rule more completely than printing it did. Everything
  the rule forbids is still forbidden, unweakened; what is borrowed is layout grammar.
- No invented numbers. Every figure shown is fetched or computed.
- No em-dashes and no emoji in visible copy.

## 4. Content ownership

**All visible wording lives in `content.json`. The generator contains none of it.** The repository ships that file with neutral placeholder values; the owner replaces them. The generator validates the file and fails the build on a violation rather than rendering something broken.

### 4.1 Copy or Session Grammar: the test

The rule, so the copy self-audit applies a definition instead of making a judgement:

> If it is a word a reader could read aloud as part of a sentence about the owner or their
> machine, it is **copy** and lives in `content.json`. If it is a glyph or a structural mark that
> carries no lexical content, it is **Session Grammar** and stays in the generator.

| In `content.json`, by that test | In the generator, by that test |
|---|---|
| `Effort`, the word before the levels | The glyph set `❯ ● ╰ ─ │ ✶` |
| `scan complete:`, `days up`, `contributions` | The `·` between the two halves of the result line |
| The `Ultrachill` toggle and the state it reads | The spinner's `…`, which is punctuation on a word rather than a word |
| The gloss on the toggle, its hint, and each key hint | The `·` between two key hints, and the `▲` on the effort track |
| Every spinner verb | The command names `/whoami /ops /stack /activity`, which are the borrowed CLI shape, not the owner's prose |
| Every key hint on the panel's closing line | The order of the fragments in a sentence, and the columns they land on |
| The prompt's host, and the command whose output the Mascot is | The prompt's own marks, `┌─( @ )-[ ] └─$`, and the `~/` in front of the path |

A sentence assembled from several of these is built from **labelled fragments, never a template
with placeholders**. Each fragment is then validated on its own like every other visible string,
and the sentence's order stays structural, which is grammar. A placeholder syntax would mean a
mini template engine, and would let the owner write a sentence the layout cannot fit. Punctuation
that belongs to one fragment travels with it (`scan complete:` keeps its colon); punctuation that
is the same for every value it decorates belongs to the generator (the spinner's `…`).

### 4.2 The keys

| Key | Meaning |
|---|---|
| `handle` | The nickname the prompt spells, in the Accent |
| `login` | The GitHub account name the API is queried by, e.g. `saltless-bruh`. It is a different value from `handle`, which is the nickname (CONTEXT.md: the Handle is both). The prompt's path is this with a `~/` in front of it, which is why **there is no `cwd` key**: a path kept in a second field is a path that can disagree with the account the figures came from, and printed in the prompt and again on its own row it is the same fact twice |
| `prompt` | `host`, the machine the Handle is logged in to, and `command`, the one whose output the Mascot is. The prompt's own marks are Session Grammar and stay in the generator |
| `startup` | The three lines printed beside the Mascot, as labelled fragments: `version` (after the Handle on the first line), `colourWord` and `model` (the second), and `status` (the third). The split in the middle line is not decoration: `colourWord` is DRAWN IN THE COLOUR IT NAMES, so it has to be a run of its own, and the generator supplies only the space between the two halves. The block's column is measured from the Mascot's own ink, so retouching the art moves the text instead of colliding with it, and its rows are measured from the band's foot: the block is GROUNDED on the sprite, its last line level with the sprite's last row |
| `whoami` | Up to 3 lines of copy. **There is no `role` key**: it printed the owner's discipline on a row of its own, four rows above `whoami`'s first line, which printed the same words in lower case. One statement, in the Command whose job is to make it. The SVG's accessible name reads `whoami[0]`, which is the only thing that ever read `role` besides the deleted row |
| `lanes[]` | Each has a `label` and `repos[]`, each repo a `name` and a one-line `blurb` |
| `stackRows[]` | Each has a `label` and `items[]`. Each item is printed in brackets, which are Session Grammar and belong to the generator; a row with an empty `label` is a continuation of the one above it and its items stay in the same column |
| `verbs` | Spinner words, grouped by Mascot state. Every state in `MASCOT_TIMELINE` needs at least one: `sleep`, `yawn`, `stretch`, `settle`, `peek`, and the alarm's `alert`, `swat-up`, `swat-down`, `glare`, `butt-up`, `butt-down`, `recover`. A state with several words rotates through them while that state is on screen. Giving the two halves of a blow the same word is deliberate: the spinner then holds one phrase across the whole gesture instead of flickering between two |
| `activityLine` | The words of the `/activity` result line, as labelled fragments: `label` (`scan complete:`), `daysUp` (`days up`) and `contributions`. The generator supplies the order, the numbers and the `·` |
| `statusline` | The effort panel's copy. `effortWord` is the heading, and the panel's track is indented by its length plus two, so a longer word still pushes the whole block along; what it no longer changes is the track's WIDTH, which is a fixed 44 columns (3.3). `effortEnds` is `start` and `end`, the two words above the ends of the track (`Faster` / `Smarter`). `effortLabels` are the levels, left to right, and the LAST of them is the scale's top tier, which is drawn as a rainbow. `effortSelected` names one of them. `toggle` is the shimmering word and the state it reads (`Ultrachill` / `on`), drawn level with the TRACK, and `toggleHint` the line under it, level with the levels; `toggleNote` is the one-line gloss under the scale, with a row of air above it. Neither the toggle nor the hint sizes anything any more: both have to fit the pane the fixed track leaves, and a build fails naming the numbers if one does not. `help` is the key hints as labelled fragments, which the generator joins with its own `·`, and it is the **last row of the Session**. **There is no `modeBadge` and no `note`**: they shared one row under `help`, and both are gone (ADR 0002's second amendment). The badge went because the grammar this borrows replaces the statusline when the effort picker opens, so the two are never on screen together; the note went because it was the only occurrence of the word "Anthropic" in the whole published profile |
| `readme` | The two visible strings the README carries outside the Session: `imageAlt`, the picture's accessible name, and `transcriptSummary`, the word on the `<details>` toggle. `imageAlt` says what the picture **is**, not what it contains: the contents are the transcript directly below it, and a reader who hears the Session out of the alt text and then again out of the transcript hears it twice |

Validation rules, all enforced at build time:

1. Every rendered row fits in 84 columns.
2. Every codepoint used exists in the font subset.
3. No string matches the forbidden-names list. For a composed Session this is checked against the
   **complete projection** of its rows (`rowsToFullText`), never the transcript: a run the picture
   draws but the transcript omits, or the other way round, must not be able to hide a name.
4. `lanes` and `stackRows` are non-empty; every repo has a non-empty blurb.

## 5. Data

### 5.1 The query

One GraphQL query document against `https://api.github.com/graphql`, sent once per page of
repositories:

- `user(login: $login).contributionsCollection.contributionCalendar`: `totalContributions` and
  per-day `date` and `contributionCount`, which drive the Scan Sweep and the "N/365 days up" line.
  `$login` comes from `content.json`'s `login`, not from `handle`.
- `repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, isFork: false)` with
  per-language byte sizes, ordered by size, filtered to the repos named in `content.json`, which
  drives the `/stack` language rows. An empty list of names counts every repository the owner owns.

`contributionsCollection` is wrapped in `@include(if: $withCalendar)` and asked for on the first
page only, so the follow-up pages do not re-send a year of days with every cursor.

**Repositories are paginated to the end rather than capped at one page.** A truncated page would
produce a byte total that is wrong and looks exactly like a right one. The ceiling is 20 pages,
and reaching it fails the build instead of reporting a partial total.

### 5.2 Auth

Read from `PROFILE_GH_TOKEN` in the environment, never from an argument, a CLI flag, or a file in
the tree. Locally it comes from `.env` (gitignored, see `.env.example`); in CI from a repository
secret of the same name.

**`.env` is loaded by `node --env-file-if-exists=.env`, on `npm run build` and `npm run gates`
specifically.** Naming the mechanism here rather than just the file is not pedantry: for a while
this section said the credential came from `.env`, `.env.example` documented it and `.gitignore`
excluded it, and no script loaded it, so a correctly written `.env` was read by nobody and the
name gate reported itself unchecked while the owner had every reason to think it was configured.
Three documents agreeing with each other is not evidence that the mechanism exists;
`test/env-file.test.ts` runs the real script's real flag instead. The `-if-exists` form is
deliberate: the strict `--env-file` exits 9 when the file is absent, which is every CI run, where
the values come from secrets, and every fresh clone. `npm test` is deliberately NOT given the
flag, so a developer's own `.env` cannot change a test result.

**`read:user` is NOT required. Measured 2026-10-02**, against the live API, with the query
`src/activity.ts` actually sends and a token whose scopes were exactly `gist, read:org, repo,
workflow`:

- `user(login: $login).contributionsCollection.contributionCalendar` returned 950 contributions
  across 53 weeks and 370 days.
- `viewer.contributionsCollection.restrictedContributionsCount` returned 0, so nothing was being
  withheld from that total.
- The repositories and languages half returned 16 repositories.

So a user token with `repo` is enough for the owner's own figures. GitHub's own scope documentation
is consistent with this: it describes `read:user` as granting access to read a user's profile data
and nowhere lists it as required for contribution data. An earlier version of this section said the
scope "must be `read:user`", which is false, and the cost was practical rather than cosmetic: it
implied a new personal access token had to be minted before any local build could run, which is what
held up the first real build.

`read:user` is still the safe recommendation for the two cases that measurement did **not** exercise:
a token that must read a **different** user's contributions, and one that must include restricted
contributions. Neither is what this profile does.

**The workflow's built-in `GITHUB_TOKEN` is still assumed not to do, and that half is UNVERIFIED.**
The measurement above used a user token; the built-in credential is an installation token scoped to
one repository, which is a different kind of credential, so nothing here promotes the one result to
cover the other. The standing reasons are that `contributionsCollection` is not reliably readable by
it and that private contributions are only counted for the token's own owner. Treat that as untested
rather than as measured, and keep using `PROFILE_GH_TOKEN`.

The token must never appear in an error message, a thrown value, the cache, a log line, or a
generated asset. Two rules keep that true rather than hoping for it: the response body is scrubbed
of the token where it arrives, so everything derived from it is already clean, and every failure
message is scrubbed on the way out, which covers text the generator did not write (a socket error
naming its request, a GraphQL error echoing its input). A failure quotes an HTTP status and never
a response body, because at that point the body has not yet cleared the forbidden-name gate.

### 5.3 The cache

The parsed result is cached to `cache/activity.json`, which is committed, so a clone with no
network and no token still builds and the test suite needs no network. The file holds parsed
figures only: never the raw response, never the query, never a credential. It carries its own
`fetchedAt` timestamp rather than relying on the filesystem, because a checkout resets every mtime
and the age of the figures would then read as zero.

- Fetch succeeds: the cache is rewritten and the fresh data is used.
- Fetch fails with a cache behind it: the cached figures are used, and the caller is handed their
  age and the reason the refresh failed, so nothing downstream can present last week's numbers as
  today's.
- Fetch fails with no cache: the build fails. Emitting zeros is the easy alternative and it is
  ruled out, because a calendar of zeros is an invented number wearing the shape of data (3.6).
- The cache is rebuilt field by field on read, so a half-written file is refused rather than
  half-used, and a count arriving as a string, a null or a fraction is corruption rather than a
  figure to print.

The file is created by the first authenticated refresh. Until one has run, a build fails loudly,
which is the behaviour above and not a gap.

### 5.4 Two decisions worth not re-deriving

**The printed total is the sum over the window, not the API's `totalContributions`.** The calendar
arrives as 53 whole weeks, which is up to 371 days, and it is trimmed to the last 365 days ending
today: days older than the window at one end, and days in the current week that have not happened
yet at the other. The API's own total covers the whole calendar, so printing it beside
"N/365 days up" would put two different year-lengths in one sentence. Both figures are individually
real, which is exactly why this is the class of error 3.6 exists to prevent. The API's total is
still asked for and put to better use: the sum of the calendar's days must equal it, and a
disagreement means the response was incomplete and fails the build, which catches a wrong headline
figure that nothing downstream could question.

**The forbidden-name gate reads the whole response body, not the fields that are kept.** It runs on
arrival, before the parser, because a JSON syntax error quotes the text around the fault. Scanning
only the fields the generator keeps would be a gate that the next added field walks straight around;
a repository description the query does not even request is still a name that arrived. A name in
fetched data is also the one failure the cache does not cover: it is not an availability problem,
and serving yesterday's figures over the top of it would turn a privacy breach into a quiet one.

Implementation: `src/activity.ts` (`fetchActivity`, `loadActivity`), tests in `test/activity.test.ts`.

## 6. Acceptance gates

The work is done when all of these pass:

1. Renders in Chrome and Firefox, both variants, on GitHub's dark, dark-dimmed, dark-high-contrast and light canvases.
2. With reduced motion forced, the render equals the final still frame.
3. A 390px-wide render is legible.
4. Each SVG is <= 250 KB.
5. The transcript block reproduces the Session as text.
6. A scan of every committed file finds zero occurrences of the forbidden names.
7. No row exceeds 84 columns, and every codepoint is in the font subset.
8. Both variants are valid, parseable XML.

Checked by the owner after publishing, because they cannot be tested here: Safari, iOS, and the GitHub mobile app.

Everything above that can be checked by a machine is checked by one: `npm run gates` (`scripts/gates.ts`),
which the refresh workflow runs before it commits anything. It adds the gates that only exist because a
failure would be invisible rather than because the list above asked for them: no em-dash or en-dash in
visible copy, no control character in generated output, none of the ten absent glyphs (3.3), the
reduced-motion rule present and actually zeroing animation, SVG structural integrity (duplicate ids,
references with no target, a missing `viewBox`, a box the art is letterboxed in), the README referencing
both assets and the transcript block and carrying none of the HTML GitHub strips, no token-shaped string
anywhere in the tree, and `npm run typecheck` at exit 0.

**It reports three states, not two.** A gate passes, fails, or is `absent` because the thing it reads is not
there, and the run exits 0, 1 and 3 for the three. Until the first authenticated refresh there is no cache
and no asset (5.3), and a gate that failed identically for "this output is wrong" and "this output does not
exist yet" would be useless on the first real run, which is the one time somebody has to tell them apart.

An absence also carries WHY, because the remedy differs and the summary states it rather than assuming:
`unbuilt` for the generated output, which a build writes, and `missing` for `content.json` and
`package.json`, which ship with the repository and which a build does not write. A mixed run prints every
cause it found. The first version of this named one cause, and on a tree where every file existed and only a
variable was unset it said "NOT BUILT YET, run `npm run build`", which is the one command that could not
help.

**Gate 6 reads the private half of the forbidden-name list, and it is opt-in.** `FORBIDDEN_NAMES` is a
committed placeholder plus whatever `PROFILE_FORBIDDEN_NAMES` adds (4.2). The committed entry is published in
`src/content.ts` by design, so scanning the tree for it reports the gate's own source and the tests that
exercise it and nothing about anybody's privacy; the private half is what a tree scan is for.

With nothing configured the gate **passes, carrying a note that it scanned for nothing**. That is ADR 0001's
amendment of 2026-10-02: the owner weighed their own name and chose not to configure one, the policy itself
still holds in the built output, and the refresh is no longer held back by it. The note is worded so it
cannot be read as "the tree was checked and is clean", which is a different claim, and the run's summary
repeats that a gate passed without checking anything. Configured, the scan runs and fails on a hit: this is
opt-out, not removal. Configuring a name the profile is built to show, such as the handle, fails with that
contradiction named rather than with the six files it is deliberately in.

Two halves were never configuration-dependent and still run on every build: the scan over fetched data
(5.4), and the committed placeholder over the generated output, where finding it means a placeholder reached
a published surface.

## 7. Accessibility

Targets WCAG 2.1 AA, with two documented exceptions: 2.2.2, which is structural and accepted, and
1.4.11 at phone width, which was found by measuring rendered pixels in Task 12 and has a one-attribute
fix waiting on the owner (3.4).

| Criterion | Status |
|---|---|
| 1.1.1 Non-text content | `alt` describes the image; the transcript block carries the full text as real Markdown |
| 1.4.3 Contrast (text) | Every text role is at least 4.5:1 on both `bg` and `surface` of its own variant |
| **1.4.11 Non-text contrast** | **Not met at phone width.** The frame's tokens clear 3:1, but the stroke is sub-pixel below about 500px and antialiases away: at 308px it measures 1.43:1 in Chrome and 1.00:1 in Firefox. Measured, with the one-attribute fix, in 3.4. No text is affected |
| 1.4.4 Resize | The SVG has no fixed pixel width, so it scales with the column and survives 200% zoom |
| 2.1.1 Keyboard | Nothing inside the image is interactive; the transcript is native Markdown |
| 2.3.1 Flashes | Nothing flashes more than three times a second |
| **2.2.2 Pause, Stop, Hide** | **Not met in the strict sense.** Motion runs longer than 5s and a README image cannot host a pause control |

The 2.2.2 gap is mitigated, not ignored: `prefers-reduced-motion` removes all motion, every loop is low-amplitude, and the content is fully available as text in the transcript regardless of motion state. Nothing in the Session depends on seeing the animation.

The 1.4.11 gap costs the window's edge and nothing else. Every text role still clears 4.5:1 at every width, and the Session's content, hierarchy and figures are unaffected; what a phone reader loses is the sense of a bounded terminal rather than anything they need to read.

**The Statusline's pane divider is a structural graphical object, so 1.4.11 applies to it and it meets
it.** The `│` between the effort scale and the toggle, down the five rows the two panes share, is drawn
in `muted`, which measures **5.65:1 on
the dark window and 4.77:1 on the light one**, both well clear of 3:1. It is drawn as a `<text>` run
rather than as a stroke, so unlike the window frame it is a whole glyph at any scale and does not
antialias away at phone width; it was read at 308px in both variants. `border` was weighed as the
quieter alternative and refused on this criterion: **2.79:1 and 2.92:1**, which misses 3:1 in both.
Nothing rests on seeing the divider, because the two panes are also separated by six blank columns and
the transcript carries each row as text.

The `/stack` bars are graphical objects conveying information, so 1.4.11 applies to them and they
meet it: a bar is the Accent on the window, which measures 6.51:1 in dark and 4.77:1 in light, well
clear of 3:1. Nothing rests on seeing them, because every bar is paired with the same figure printed
as text at the end of its own row, and the transcript carries both. The one case where the drawing
says nothing is a share that rounds away, and that row prints `<1%` rather than relying on a blank.

A day with no activity is drawn, not omitted: it sits at 0.45 opacity of the `border` token, which measures 1.60:1 against the window in dark and 1.54:1 in light. It is below 3:1 by design, because a quiet day being quiet is itself the meaning; the figures that matter are printed as text on the result line. Before the beam reaches it the same cell sits at 0.30 of that token (1.35:1 and 1.32:1), so an unprobed cell and a probed silent one are deliberately close: what the sweep reveals about a quiet day is that there was nothing to reveal.

## 8. Deliberate overrides

Several choices here are things a design review would normally flag. Each is a brief-driven decision, not a default, and is recorded so a reviewer does not "fix" it.

| Normally flagged | Why it stands |
|---|---|
| A terminal window built from primitives, usually an AI tell | The owner asked for a terminal, CLI and TUI aesthetic explicitly. The terminal is the subject, not set dressing |
| Near-black background with a green accent, a common generated-design cluster | Green is the owner's stated preference and the palette is Everforest, a real terminal theme. The accent is a desaturated sage, not acid green |
| Monospace used for every label | The subject is a terminal; a proportional face would break the column grid the whole design rests on |
| High density, far above a portfolio default | A terminal column is dense by nature; the density dial is set to 8 deliberately |
| Dark-only brutalist doctrine | Overridden in favour of two Theme Variants, because GitHub has real light-theme readers |

## 9. Out of scope

The Landing Page (deferred, gets its own interview), contact links (none until those profiles exist), and anime.js (a build-time option only if hand-written keyframes prove insufficient).
