# Design contract for the remaining tasks

Distilled from the skills loaded for this project: `tui-design`, `better-colors`, `pixel-art-sprites`,
`animation-vocabulary`, `brandkit`, `design-taste-frontend`, `ascii-art`. Carried into every remaining dispatch.
This is what those skills actually change, not a summary of them.

## Naming the motion precisely

Using the right term keeps the implementation honest, because each name implies its own correct timing.

| Element | Correct name | What that implies |
|---|---|---|
| Commands appearing on load | **Typewriter**, driven by a **stagger** | Characters or rows arrive in sequence, not a fade of the whole block |
| Banner resolving | **Stepped reveal**, per letter, driven by a **stagger** | Letters resolve in sequence, left to right, each cutting through one flicker frame before it settles |
| Pose swaps | **Stepped animation** | Frames cut. `step-end`, never interpolation |
| Breathing, ear, tail | **Idle animation** | Subtle motion while nothing is happening. 1 to 2 pixels, never more |
| `Ultrachill` | **Shimmer** | A sheen travels across; it does not blink or pulse |
| Scan beam | **Stepped** translate plus **reveal** | Advances in whole columns, matching the pixel grid |

**The Banner's row used to say TEXT SCRAMBLE, and it was corrected in Task 9.** A scramble settles to
final glyphs, which presumes there are glyphs to scramble through. The Banner has none: it is
geometry, block art compiled to merged paths per colour (`docs/spec.md` 3.3), so a real scramble
would mean compiling and shipping a drawn path for every letter in every frame of noise, which is
both a large asset and a thing the architecture does not have a mechanism for. The per-letter
stepped reveal is the same intent on the mechanism that exists: the name RESOLVES rather than
fading in, letter by letter, each one cutting through a single dim frame before it settles. The
difference a viewer could tell is that a letter passes through one wrong-looking state rather than
several. The line was corrected rather than left standing, because a contract that describes
something the architecture cannot do is read by the next person as a thing that was skipped.

Two rules that follow from the vocabulary and apply everywhere:

- **Frequency of use.** The more often something is seen, the shorter and subtler it must be. This is why the mascot's
  gaps were cut rather than its gestures, and why the shimmer fires once per quarter-loop rather than continuously.
- **Purposeful animation.** Every animation names its job in one sentence, or it is removed. The motion table in
  `docs/spec.md` is that list.

## Colour

Verified, not assumed:

- **The scan-sweep intensity ramp is already perceptually even.** `better-colors` requires ramp steps to be evenly
  spaced in *perceived* lightness rather than in whatever number the format exposes. I measured the planned
  `0.35 + 0.65 x intensity` opacity ramp by compositing the accent over the background and converting to CIE L*: the
  gaps come out 8.9, 8.6, 8.1, 8.2 in dark (spread 0.8) and 8.5, 8.3, 8.6, 8.4 in light (spread 0.3). Solving for
  perfectly even steps moves the alphas by at most 0.03, which is invisible. **Keep the linear ramp.** Recorded so
  nobody "fixes" it later on principle.
- **Never report a contrast number that was not measured.** Every figure in the ledger comes from a computation or a
  rendered-pixel sample. Keep it that way.

**The ramp was judged against fixture data built to look busy. Task 12 judged it against the real year, and it
holds.** The owner's calendar is **97 active days in 365, 26.6%**, so the grid is sparse and the question was
whether the Scan Sweep still reads as scanning a network or as a mostly empty box. Rendered and looked at, at
846px and 308px, dark and light:

- **It reads.** The beam's before/after difference is the effect, and it survives sparsity because the silent
  days are *drawn*, not omitted: what the beam crosses is a complete lattice of targets, most of them quiet,
  which is exactly what section 7 of `docs/spec.md` says a quiet day should mean.
- **The sparsity is distributed, not clustered, which is what saves it.** 39 of the 53 columns contain at least
  one lit cell, and the longest run of columns with nothing lit at all is **3**, about 140ms of the 2.5s
  crossing. The beam is never crossing a void for long enough to look broken.
- **The hits still register when scattered.** 48 cells reach the top two bands, and 21 of them have another hit
  directly below, so the merged-bar behaviour the geometry was designed for still happens on real data rather
  than only on busy fixtures.
- **The honest weakness, recorded rather than fixed.** Only 20 of 53 columns contain a hit, so about 1.56s of
  the 2.5s crossing passes with no flare, and one stretch of 10 consecutive columns (0.47s) has none at all. A
  scanner crossing a quiet quarter and reporting nothing is information rather than a fault, and 0.47s is short,
  so nothing was changed. If a future year is quieter still, the lever is the **quartile thresholds**, not the
  opacity ramp: the ramp is measured perceptually even and retuning it to compensate for sparse data would be
  fixing the wrong thing.

The real data also gives the grid a shape the fixtures never had: the last 12 columns carry 41 lit cells against
16 in the first 12, so it reads as quiet-then-busy rather than as noise. That is the data being real, and it is
an argument for never making this band look busier than it is.

## The two Statusline ramps, measured 2026-10-02

Added when the Statusline became a panel. Both are computed from the palette in `src/ramp.ts` and
measured by `test/ramp.test.ts`; neither is a hex literal, so a palette change carries both. Recorded
here, like the scan sweep's ramp above, so nobody retunes them on principle.

**The toggle's gradient, and the finding that shaped it.** `better-colors` asks for steps evenly
spaced in *perceived* lightness. Measured, the two tokens it runs between are very nearly
ISOLUMINANT: `muted` and `accent` are 68.08 and 72.63 in CIE L* in dark, and **47.33 and 47.33 in
light, identical to two decimal places**. So an even-lightness ramp between them is satisfied
trivially and would show a reader nothing; what travels across the word is CHROMA, from okC 0.019 to
0.091 in dark and 0.027 to 0.098 in light. The ramp is therefore the straight line between the two in
OKLab walked in equal increments, which makes every consecutive pair the same perceptual distance
apart by construction. Measured over ten characters: L* steps of 0.29 to 0.65 in dark (span 4.55) and
-0.07 to 0.05 in light (span 0.00). **The unevenness in those numbers is eight-bit quantisation, not
the ramp**: one code value is about 0.3 L* at this lightness and a step is about 0.5, so a ten-step
ramp across 4.55 L* cannot be smoother than it is. The test bounds the deviation by a measured
one-code nudge rather than by a tolerance somebody picked.

**The top tier's rainbow, and why it is allowed at all.** A literal rainbow drops arbitrary hues into
a palette that has exactly one accent hue, and reads as confetti stuck onto a terminal. This one
sweeps hue evenly around the whole wheel from the accent's own hue while holding **CIE L\* exactly at
the accent's** and chroma constant, so the four characters read as one object that happens to be
polychrome. Measured: L* flat within **0.041** in dark and **0.121** in light, against a target of
72.627 and 47.331. Holding L* holds relative luminance, so every character measures the accent's own
contrast against the window: **6.51:1 in dark and 4.77 to 4.79:1 in light**, all of them clear of
4.5:1, and the rainbow cannot smuggle in a character that is harder to read than the Session's own
Accent. Chroma is reduced for all four together if any one hue would leave sRGB, never for one alone,
because one washed-out character reads as a mistake rather than as a sweep.

This is a deliberate, recorded exception to the one-accent rule in `docs/spec.md` 3.4, taken on the
owner's instruction, and it is confined to one word of four characters.

Two standing weaknesses, both accepted for now and recorded so they are not discovered as surprises:

- **Art borrows text roles.** The mascot paints its body with the `text` token and its rack with `surface`. A cat is
  not text. If body-text colour is ever retuned, the cat changes with it. The clean fix is art-role tokens
  (`art-body`, `art-panel`) that alias today's values. Low value while the palette is locked; worth doing before any
  palette change.
- **The accent carries many jobs**: prompt, tool bullet, banner, rack LEDs, cat speckles, scan hits, and success. In a
  terminal this largely reads as "the system's colour" and is coherent, but the decorative cat speckles are the
  weakest use and the first thing to drop if the accent starts feeling noisy.

## Pixel art

From `pixel-art-sprites`, the rules that still bind the remaining visual work:

- **A readable silhouette beats detail.** If the shape cannot be identified at 1x, the sprite has failed, regardless of
  how good it looks zoomed in. This is the standard the 308px phone render is judged against, not desktop.
- **Hard edges.** No anti-aliasing, which is why `shape-rendering="crispEdges"` is pinned by a test.
- **Fewer colours force better decisions.** The nine-colour grid is a constraint to work inside, not to escape.

## Terminal craft

From `tui-design`:

- **Pair every status colour with a word or glyph.** Colour alone never carries meaning. Already in the spec; it also
  means the scan sweep needs its printed result line, not just coloured dots.
- **Do not dim important values until they stop being readable.** The muted token is for genuinely secondary text.
- **Do not claim formal accessibility compliance from a palette alone.** The spec's accessibility section states
  measured contrast and one documented exception; it should not be read as a compliance claim.
- **Motion must not hide the final state.** The playback reveals rows on load; the finished Session must be the
  resting state, which is also what a reduced-motion viewer sees immediately.

## Copy

From `design-taste-frontend`, the rules that genuinely apply to a terminal rather than a landing page:

- **Zero em-dashes** anywhere visible. Enforced by the gates in Task 11.
- **No invented numbers.** Every figure is fetched or computed. Already a spec rule and a gate.
- **Copy self-audit before shipping.** Re-read every visible string in `content.json` and the generated transcript for
  anything grammatically broken or trying too hard. Task 12.

Most of that skill addresses landing pages and does not apply here; the deliberate departures are already recorded in
`docs/spec.md` section 8.

## What `ascii-art` is for

It is an image-to-ASCII converter, not a lettering system. The banner is hand-authored from a glyph table, which stays
the right approach because it must land on exact columns. The skill is available if a future variant wants a figlet
wordmark or an image converted to block art.

## Motion review, 2026-10-02

What the animation review settled. Recorded so these are not revisited on principle.

### Three deliberate choices that look like violations

- **Reduced motion collapses to zero**, not to "gentler". The usual rule keeps opacity and colour and drops
  movement. It inverts here: in this sprite the *opacity* animations are the large-area motion, since the whole cat
  redraws between poses, and the *transforms* are the one-pixel ones. Keeping opacity would preserve the provocative
  part and remove the harmless part. The still frame is the content, so zero is right. `src/svg.ts:39`.
- **`step-end` on the movement animations is not missing easing.** Easing a 1px translate produces subpixel
  positions that `shape-rendering="crispEdges"` snaps anyway, giving an irregular stutter. A hard cut is the honest
  encoding, and it matches the pixel-art convention of frames cutting rather than tweening.
- **The ear is painted twice on purpose.** The static pass covers the whole cat, then the `.ear` overlay repaints
  the ear box and translates it -1px, so what renders is the union: the tip extends and straightens while the base
  stays attached to the head. Excluding the ear from the static pass, which is the obvious "do not paint twice"
  cleanup, opens a 1px gap between the lifted ear and the head in four of the five poses. Only `yawn` has a natural
  silhouette break there. A test pins this.

The tail used that same mechanism and it was wrong there, because the tail is 1px wide so the union doubled its
thickness and read as swelling. The tail is drawn detached from the body, with no ink adjacency across either box
edge in any pose, so it became a real displacement instead.

### Durations here are ambient, not UI

The sub-300ms budget governs motion that answers a user action. Nothing in the Mascot does; these are idle loops on
a decorative image. The budget that does bind is frequency, which is why the Mascot's gaps were cut rather than its
gestures.

### One root cause worth remembering

A gesture expressed as a percentage of its cycle silently changes speed when that cycle is retuned. The three rack
LEDs shared one keyframe across 7s, 11s and 13s periods, so the same flash lasted 350ms, 550ms and 650ms. Derive
stops from target millisecond values. This is the same lesson already recorded for `BREATH_SECONDS`.

### Pre-flagged for the playback

The playback fires on every page load and stands between the reader and the content, which is the sharpest frequency
constraint in the project. The finished Session must be the resting state, and must be what a reduced-motion viewer
sees immediately.

**Settled in Task 9, and measured.** Rows arrive 26ms apart and each takes 180ms to settle, so the last
row lands at `26ms x (rows - 1) + 180ms`. That figure belongs to the content, not to the design: the
57-row Session measured in Task 9 finished at 1.636s, and the owner's real content is 58 rows and
finishes at **1.66s**.

**Re-measured in Task 12 against the real content, in both engines.** Frozen frames through real headless
Chrome and Firefox at 846px and 308px: the last row's band is far from settled at 1.45s and 1.50s, ramps
from 1.55s, and is pixel-identical to the settled frame from 1.66s, at both widths in Chrome and at 846px
in Firefox. Firefox at 308px is within 22/255 of settled at 1.66s and exact by 1.70s, which is the tiny
text's antialiasing rather than a different schedule. Quote the formula rather than one of its answers;
quoting an answer is what made the previous number wrong without anybody editing it.

The unit is the ROW, not the character. A per-character typewriter across the whole Session is the obvious
reading of the word and it is ruled out by arithmetic: the Session carries roughly 2,600 characters, and at
any rate that reads as typing that is tens of seconds of a reader looking at a page that is not there yet.
The wording above already allows this ("characters or rows arrive in sequence").

**A row whose reveal another layer owns keeps it.** The `/activity` result line is printed by the Scan Sweep
when the beam has finished crossing, which is deliberately later than the playback, so the playback does not
touch that row. This is not a tidiness rule: two `animation` shorthands reaching one element from two rules
do not compose, the later rule replaces the earlier outright, and which of the two reveals survived would
otherwise be decided by the order the stylesheets happen to be concatenated in.

**The spinner's verbs are not subject to the playback.** They are on the Mascot's clock, undelayed, because
the whole point of them is that the word names the pose on screen; any offset would slide the words off the
picture by exactly that offset. They are invisible during the playback anyway, because their row is.

## Verifying while another agent may be mutating

Added after it cost two rounds in one session. Both times a red test was reported as a defect and
escalated, and both times it was a live mutant in someone's mutation run. There was nothing wrong
either time.

**A mutated working tree looks exactly like a broken one.** Nothing in `git status` or a test summary
distinguishes "this file is mid-mutation" from "this file is wrong", and the natural reaction to a red
suite, reverting the file or fixing the test, silently corrupts a run that is still going.

### If a test is failing, check this first

Look for **`MUTATION-IN-PROGRESS.json`** in the repository root. `scripts/mutation-check.ts` writes it
for as long as a mutant is applied, and it names the mutant, the file and the command that puts the
file back. It is untracked and deliberately loud, so it shows up in `git status` and at the top of `ls`.

If that file is there: **do not revert anything and do not fix the test.** A run is in progress and the
failure is its mutant. Wait, or ask whoever started it. If the run has clearly died, the marker tells you
exactly which file to restore, and the next run refuses to start until you have.

### Do not verify HEAD in the working tree

While any agent may be mutating, the working tree is not a trustworthy place to measure anything. Check
HEAD out somewhere else instead:

```sh
git worktree add --detach /tmp/verify HEAD
ln -s "$PWD/node_modules" /tmp/verify/node_modules
( cd /tmp/verify && npm test && npx tsc )
git worktree remove --force /tmp/verify
```

That is how a trustworthy test count was produced while three agents were editing the same branch. It
costs seconds and it is the only number worth quoting in a report.

### What the harness guarantees, and what it cannot

`npm run mutants` refuses to start if a previous run left a marker behind, or if any file it is about to
mutate has uncommitted changes. The second one matters more than it looks: the harness restores with
`git checkout --`, so an uncommitted change in a mutated file is destroyed by the first restore and
every mutant after it measures a baseline that never contained the feature under test. The run then
reports a confident "all killed" containing no evidence whatsoever. **Commit the feature, then measure
it.** It also requires the baseline to be green first, because a red baseline makes every mutant look
killed from the other direction.

It restores from an exit hook, and between mutants it yields to the event loop so a SIGINT or SIGTERM is
handled with nothing applied. It cannot do better than that: a signal handler is JavaScript and cannot
run while the process is blocked inside the synchronous child that runs the tests, and nothing survives
SIGKILL. A hard kill mid-test can still strand a mutant, which is exactly why the marker exists. The
marker is the recovery path, not a formality.
