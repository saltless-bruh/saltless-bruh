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
│  ┌─ the Session, 72 cols ───────────────────────────────────────────────────────┐ │
│  │ [Mascot: cat asleep on rack]   B A N N E R                                   │ │
│  │  rack LEDs blink -> Finding    role line                                     │ │
│  │                                ~/saltless-bruh                               │ │
│  │ ───────────────────────────────────────────────────────────────────────────  │ │
│  │ > /whoami     three lines of copy                                            │ │
│  │ > /ops        three Lanes, seven repos, one line each                        │ │
│  │ > /stack      languages by size + tool rows                                  │ │
│  │ > /activity   Scan Sweep + "N/365 days up - M contributions"                 │ │
│  │ * <verb>...   spinner, loops forever                                         │ │
│  │ ───────────────────────────────────────────────────────────────────────────  │ │
│  │ Effort  low  medium  [lazy]  xhigh  max            Ultrachill on             │ │
│  │ >> autopilot on        terminal-style design, not affiliated with Anthropic  │ │
│  └──────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│ <details> Session transcript </details>   <- real selectable text, same content   │
│ real Markdown links                                                               │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**Transcript block.** ADR 0004 accepted that an image exposes text only through `alt`. This spec improves on that: the generator also emits the Session as plain text inside a `<details>` block under the image. Screen readers, search and copy-paste then get real text, and `alt` stays a short description. ADR 0004 should be amended to record this.

## 2. Build pipeline

```
content.json  (the only file the user edits)
     +
GitHub GraphQL  ->  cache/activity.json (cache)         .github/workflows/refresh.yml
     +                                                   daily cron + push + manual
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

Measured; sources in [`docs/research/`](research/).

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
| Columns | 72 (= 864 units) |
| Padding | 16 units each side |
| Canvas width | 896 units |
| Canvas height | 32 + rows x 24 |

At 846px the cell is ~11.3px; at 308px it is ~4.1px. A `viewBox` with no fixed pixel width lets the image scale to the column.

### 3.3 Glyphs

Verified present in JetBrains Mono v2.304, so the Session needs no hand-drawn glyph paths: `❯ ● ╰ ─ │ ✓ ✗ ⚠ ▲ ▶ ■ □ · ∙ • ✶ * ○ ◌ ◉ …`, all printable ASCII, all box-drawing, all block and quadrant characters, and full Vietnamese.

Verified **absent**, and therefore forbidden: `⎿ ✻ ✢ ✽ ✔ ✘ ◼ ◻ ⏵ ⏸`. The substitutes above replace them.

Text is rendered as `<text>`. The Banner, the Mascot and the Scan Sweep are **geometry**, not glyphs: block art compiled to merged paths per colour, with `shape-rendering="crispEdges"`, which avoids seam hairlines at fractional scale and gives the Mascot per-part groups to animate.

**Weight.** Both Regular and Bold are vendored and subset, and each gets its own `@font-face`. A single face with `font-weight: 400 700` would make the browser synthesise fake bold, which smears a monospace grid. Emphasis otherwise comes from the Accent, not from weight.

**Two-row repo entries.** A repo name and its description cannot share a row: a name at column 7 leaves only 37 columns for the description, which no useful sentence fits. The name sits on one row and the description is indented on the next, which also reads more like real command output.

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

**The frame carries the window.** Everforest's own border colours are too faint against GitHub's canvases: the dark window body is only 1.08:1 from the dark-dimmed canvas and the light body is 1.03:1 from white, so without a visible edge the window simply dissolves into the page. The two border values above are hue-preserving lightenings of the Everforest borders, chosen to clear 3:1 against the worst canvas each one faces (dark `#677279` is 3.02:1 on dimmed and 3.84:1 on dark; light `#8d9978` is 3.02:1 on white).

### 3.5 Motion

Every animation must justify itself in one sentence. Anything that cannot is cut.

| Element | Behaviour | Why it earns its place |
|---|---|---|
| Playback | Once on load, about 4.3s: Banner decrypts, then each Command types and prints | Storytelling: establishes that this is a session being run, not a poster |
| Banner | Resolves from random block glyphs over 0.8s | Hierarchy: it is the one moment of spectacle, spent on the name |
| Spinner | After playback, one spinner loops. Its verb names whatever the Mascot is doing right now, on the same 36s clock | State: it is a readout of the Mascot, not decoration, which is why it may loop at all |
| Mascot | 36s master loop: breathing at 3.0s, with a yawn, a stretch, a settle, a one-second peek at the viewer, and an alarm she wakes to | Storytelling: the operator naps while the agents work, which is the whole metaphor |
| Mascot micro-layers | Ear 17s, tail 23s. Co-prime periods mean the combined pattern does not visibly repeat | Keeps the loop from reading as a loop |
| Rack LEDs, healthy | 7s, 11s and 13s flickers, staggered so no two are ever lit at the same instant | State: three services on their own clocks; this is the cause the sleeping cat is the effect of |
| Rack LEDs, faulting | From 28s to 31.6s they are `error` and flash in unison at 2.5Hz, then hold steady `accent` for the recovery beat | State: unison is what reads as one machine in trouble, precisely because the healthy state is defined by never agreeing |
| Scan Sweep | Beam crosses the calendar once during playback, then once per 36s master loop | Storytelling: the calendar is read as something being scanned, not a heatmap |
| Ultrachill shimmer | A bright band crosses the word once every 9s, a quarter of the master loop | Hierarchy: it marks the one joke in the Statusline without running constantly |

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
- No Anthropic name, logo, mascot, brand colour or verb list (ADR 0002). The Statusline carries the not-affiliated note.
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
| `Effort`, the word before the levels | The glyph set `❯ ● ╰ ─ │ ▶▶ ✶` |
| `scan complete:`, `days up`, `contributions` | The `·` between the two halves of the result line |
| The `Ultrachill` toggle and the state it reads | The spinner's `…`, which is punctuation on a word rather than a word |
| Every spinner verb | The command names `/whoami /ops /stack /activity`, which are the borrowed CLI shape, not the owner's prose |
| The mode badge and the not-affiliated note | The order of the fragments in a sentence, and the columns they land on |

A sentence assembled from several of these is built from **labelled fragments, never a template
with placeholders**. Each fragment is then validated on its own like every other visible string,
and the sentence's order stays structural, which is grammar. A placeholder syntax would mean a
mini template engine, and would let the owner write a sentence the layout cannot fit. Punctuation
that belongs to one fragment travels with it (`scan complete:` keeps its colon); punctuation that
is the same for every value it decorates belongs to the generator (the spinner's `…`).

### 4.2 The keys

| Key | Meaning |
|---|---|
| `handle`, `cwd` | Identity line |
| `login` | The GitHub account name the API is queried by, e.g. `saltless-bruh`. Nothing draws it, and it is a different value from `handle`, which is the nickname (CONTEXT.md: the Handle is both). It is validated like every other string here, so a wrong one fails the build instead of returning no user from the API |
| `role` | The one-line role under the Banner |
| `whoami` | Up to 3 lines of copy |
| `lanes[]` | Each has a `label` and `repos[]`, each repo a `name` and a one-line `blurb` |
| `stackRows[]` | Each has a `label` and `items[]`, printed as plain text |
| `verbs` | Spinner words, grouped by Mascot state. Every state in `MASCOT_TIMELINE` needs at least one: `sleep`, `yawn`, `stretch`, `settle`, `peek`, and the alarm's `alert`, `swat-up`, `swat-down`, `glare`, `butt-up`, `butt-down`, `recover`. A state with several words rotates through them while that state is on screen. Giving the two halves of a blow the same word is deliberate: the spinner then holds one phrase across the whole gesture instead of flickering between two |
| `activityLine` | The words of the `/activity` result line, as labelled fragments: `label` (`scan complete:`), `daysUp` (`days up`) and `contributions`. The generator supplies the order, the numbers and the `·` |
| `statusline` | `effortWord` (the word before the levels, e.g. `Effort`; a longer word pushes the levels along), `effortLabels`, `effortSelected`, `modeBadge`, `note`, and `toggle` (the shimmering word and the state it reads, e.g. `Ultrachill` / `on`). The toggle is not one of the effort labels, so it has its own key |

Validation rules, all enforced at build time:

1. Every rendered row fits in 72 columns.
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

**It needs the `read:user` scope, and the workflow's built-in `GITHUB_TOKEN` will not do.** The
contribution calendar sits behind `contributionsCollection`, which the built-in token cannot
reliably read, and private contributions are only counted for the token's own owner.

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
7. No row exceeds 72 columns, and every codepoint is in the font subset.
8. Both variants are valid, parseable XML.

Checked by the owner after publishing, because they cannot be tested here: Safari, iOS, and the GitHub mobile app.

## 7. Accessibility

Targets WCAG 2.1 AA, with one documented exception.

| Criterion | Status |
|---|---|
| 1.1.1 Non-text content | `alt` describes the image; the transcript block carries the full text as real Markdown |
| 1.4.3 Contrast (text) | Every text role is at least 4.5:1 on both `bg` and `surface` of its own variant |
| 1.4.11 Non-text contrast | The window frame clears 3:1 against every canvas it faces |
| 1.4.4 Resize | The SVG has no fixed pixel width, so it scales with the column and survives 200% zoom |
| 2.1.1 Keyboard | Nothing inside the image is interactive; the transcript is native Markdown |
| 2.3.1 Flashes | Nothing flashes more than three times a second |
| **2.2.2 Pause, Stop, Hide** | **Not met in the strict sense.** Motion runs longer than 5s and a README image cannot host a pause control |

The 2.2.2 gap is mitigated, not ignored: `prefers-reduced-motion` removes all motion, every loop is low-amplitude, and the content is fully available as text in the transcript regardless of motion state. Nothing in the Session depends on seeing the animation.

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
