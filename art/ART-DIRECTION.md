# Lazie: art direction for the additional poses

The owner chose the pixel cat from their original mockup over the hand-drawn block version, and asked for the full
animated story kept. The sleep pose already exists as artwork. Everything else is drawn in the same style, plus the
nose bubble.

**Every pose is an edit of a copy of the owner's own grid, never a generated image.** That provenance is the point:
`sleep.grid.txt` is the original artwork converted losslessly, and each other pose moves, opens or flattens part of
it. No AI image tool has touched any file in this directory, and none should.

**The second-by-second timings below are stale.** They were written against a 60-second loop; the loop is 36 seconds
and `MASCOT_TIMELINE` in `src/timeline.ts` is the only place the schedule is written down. Read the poses here and the
times there.

## The source

`sleep.grid.txt` is the original artwork converted to a 64x28 character grid, one character per pixel, verified
lossless: re-rendering it produces a pixel-identical image to the original SVG, and merging horizontal runs reduces
818 rectangles to 240.

`palette.json` maps each grid character to its original colour. Those colours are the OLD design's phosphor green and
must be replaced (see Recolour below).

| char | original | what it is |
|---|---|---|
| `1` | `#c2f7d3` | the zZz glyphs, lightest tint |
| `2` | `#8fefb0` | the cat's body, the main mass |
| `3` | `#2b372e` | darkest: the closed eyes, and the rack's interior |
| `4` | `#2bb862` | accent speckle: the dappled back, the paws, the nose |
| `5` | `#111a13` | rack body |
| `6` | `#3fe07a` | rack LEDs, brightest |
| `7` | `#1f8a4a` | rack LED dim state |
| `8` | `#3f5043` | rack ventilation slots |
| `9` | `#0e140f` | rack plinth, darkest |
| space | none | transparent |

## Anatomy, measured from the grid

The cat faces the viewer with its body loafing away to the right. Rows are from the top.

| feature | location |
|---|---|
| ear tips | row 4, x24 and x30 |
| head | rows 5 to 7, x22 to x31 |
| closed eyes | row 7, x25 and x26, and x29 and x30 (char `3`) |
| nose | row 8, x27 (char `4`) |
| body | rows 7 to 10, reaching x47 at its widest |
| dappled back | char `4` speckles on rows 8 and 9 around x34, x37, x40, x43 |
| front paws | row 10, x23 to x24 and x27 to x28 (char `4`) |
| tail | the char `4` run near x45 to x47, rows 8 to 10 |
| zZz | rows 0 to 4, x45 to x51 (char `1`) |
| rack | rows 11 to 27 |

Free space available for new art: everything left of x21, everything above row 4 except the zZz, and x48 to x63.

## The poses

Each is a complete 64x28 grid file, same dimensions and same character set. Change only the cat; leave the rack rows
(11 to 27) byte-identical in every pose, so the rack can be emitted once and shared.

**`yawn.grid.txt`** (plays 15.0s to 18.4s)
The head tips back slightly and the mouth opens. Keep the eyes closed but squeeze them: the existing eye pixels may
narrow or shift up one row. Open a mouth below the nose as a dark (`3`) opening roughly 3 pixels wide and 2 tall,
centred near x27 on rows 9 and 10. A yawn is the one moment the silhouette breaks, so make it readable at a glance.

**`stretch.grid.txt`** (18.4s to 23.4s)
Front paws push forward into the free space left of the head, and the back arches. Extend the paw pixels left to about
x19, lower the head by one row, and raise the mid-back by one row. The body should visibly lengthen.

**`settle.grid.txt`** (23.4s to 26.25s)
Halfway between stretch and sleep: paws partly drawn back, head returning. It exists so the return to sleep is not an
abrupt cut, so it should look like an in-between frame, not a pose in its own right.

`startle.grid.txt` existed and has been **replaced by the alarm**, below.

## The peek

**`peek.grid.txt`**
One eye opens and looks straight out at the viewer while the nose bubble is still inflating, then closes again. A
bubble says deep sleep and an open eye says she is faking it, which is the better joke, so the zZz and the bubble
both stay.

It is a **two-pixel edit of `sleep.grid.txt` and nothing else**: x29 and x30 on row 6 go from `2` to `3`, which turns
the right eye's one-row slit into a 2 x 2 hole. Two pixels is the whole budget. A symmetric hole has no sideways
bias, so the gaze reads as straight out rather than sideways, which is what a pupil nudged to one side of a 2px eye
would give instead. Everything else, the ears included, is untouched: anything more and she has woken up, which is
the opposite of the gag.

## The alarm

The rack faults, she wakes angry, hits the chassis twice with a paw, sees that nothing changed, headbutts it, and
the machine comes back green. **She is lying ON the rack and the LEDs are on its front face, so she cannot reach
them.** Every blow lands on the chassis. That is what percussive maintenance is, and it is the physically honest
version; a test measures it from the artwork rather than trusting this paragraph.

Two rules hold across all seven:

- **The head stays in columns 22 to 31.** `EAR_X` in `src/mascot.ts` is fixed at columns 29 and 30, so a head that
  moved out of them would leave the ear overlay flicking a pixel of the cat's back. This is why the headbutt is a
  downward drive rather than a lunge to the left.
- **Ears back is drawn as the two 1px tips folding into a flat skull**, not as new ink. At 308px an eye is about two
  device pixels and an open one does not read; the silhouette losing its two points does. Flat is the cue that
  survives phone width.

**`alert.grid.txt`** — the LEDs go red, the bubble pops, the ears pin back and both eyes open into 2 x 2 holes.
The body is planted: rows 7 to 10 are `sleep`'s byte for byte, because she is braced to hit something rather than
leaping. The jolt is read on the face and in the silhouette.

**`swat-up.grid.txt`** — the near foreleg lifts clear above the skull: an accent paw at x21 and x22 on row 4 on a
one-pixel forearm down x21, joining the body at row 8. The tucked paw at x23 and x24 on row 10 becomes body, because
that is the paw that left.

**`swat-down.grid.txt`** — the same foreleg slammed flat along row 10, paw (accent) at x18 and x19, forearm to x21.
That lands on the rack's top line directly above the LED columns, which is what makes hitting the chassis read as
going for the lights. Two `1` impact sparks at x17 row 8 and x16 row 9, drawn clear of body ink so no two paths meet
on a bare edge.

Only the foreleg and its sparks differ between the two halves. Isolating the moving part is what makes 400ms read as
a deliberate whack rather than the whole cat twitching.

**`glare.grid.txt`** — still red, nothing fixed. The eyes narrow from the alert's 2 x 2 holes to a single hard slit
on row 6, one row above where the sleeping slit sits, and the paw is tucked again. The stillness is the beat; the
LEDs say why.

**`butt-up.grid.txt`** — the head rears two rows onto a stretched neck: skull top at row 3, two rows of open eye,
jaw at row 6, neck filling row 7. The highest the skull ever gets.

**`butt-down.grid.txt`** — `sleep.grid.txt` with rows 0 to 5 cleared, so the skull top drops to row 6, three rows
below the rear, and the ears vanish entirely. The eyes are back to slits: a cat squeezes them shut on impact, and at
this size that reads as effort. Two `1` sparks at x19 row 9 and x20 row 10, on the chassis beside her.

**`recover.grid.txt`** — ears up, both eyes open, no zZz: `sleep.grid.txt` minus the zZz plus four `3` pixels on
row 6. It is deliberately the in-between back to sleep, so the only things that change at the final cut are the eyes
closing and the zZz returning.

## The rack LEDs are a third state layer, not artwork

The grid files hold one rack, healthy. The fault and the steady-green hold are drawn by `src/mascot.ts` as two extra
banks over the same lit pixels, in `error` and `accent`, hidden in the still frame. They are not in these files
because they are states the loop drives to, exactly as the bubble is.

## The nose bubble

Drawn as its own layer, not baked into the poses, so it can animate independently.

It inflates during the long sleep window, 26.25s to 48.75s, in four discrete steps, then pops exactly at 48.75s, which
is the instant `startle` begins. Place it adjacent to the nose at row 8, x27, growing into the free space up and to the
left of the head: start as a single pixel around x21 row 7, and grow to roughly 3x3 by the final step. Use char `1`
(the lightest tint) so it reads as translucent. The pop is two frames: a small burst ring, then nothing.

Each bubble step is a separate small grid or a set of pixel coordinates, whichever is cleaner to animate.

## Recolour to Everforest

The original phosphor-green palette belongs to the old design. Map every character to a palette token so both theme
variants work. Use `PALETTES` from `src/tokens.ts`; do not hardcode hex.

| char | token | reason |
|---|---|---|
| `1` zZz, bubble | `muted` | quiet, recedes |
| `2` cat body | `text` | the main silhouette, highest contrast against the window |
| `3` eyes (cat rows) | `bg` | reads as a hole, and gives the eyes their darkness |
| `3` frame (rack rows) | `border` | **amended after review**, see below |
| `4` speckle, paws, nose, tail | `accent` | the one accent, used sparingly as detail |
| `5` rack body | `surface` | a panel sitting on the window |
| `6` LED lit | `accent` | the lit state |
| `7` LED dim | `muted` | the unlit state |
| `8` vents | `border` | structural lines |
| `9` plinth | `border` | structural |

**Amendment: the rack needs its frame.** The first version of this table sent every `3` to `bg`. In the cat rows that is right
(an eye is a hole). In the rack rows it dissolved the rack: the panel is `surface`, which sits at 1.15:1 (dark) and 1.06:1 (light)
from the window, so a panel alone has no silhouette and the LEDs and vents read as bars floating in space. In the rack rows, `3`
is the rack's frame (its outer edge, and the lines between the three units) and is drawn in `border`: 2.79:1 against the window
in dark and 2.92:1 in light, 2.44:1 and 2.75:1 against the panel. The cat against the panel stays at 7.11:1 and 5.10:1. This is the
same device the Session window uses (an opaque panel plus a one-pixel frame). The plinth (`9`) is unchanged.

**Check the cat reads against the rack.** The previous hand-drawn version failed exactly here: cat and rack measured
1.13:1 in light mode and merged into one mass. With `text` on `surface` this should be about 7.1:1 dark and 5.1:1
light, which is ample, but verify it rather than assuming, and report both figures.

## Placement and scale

One art pixel is 6 units square. The scene is therefore 384 by 168 units, which is exactly 32 columns by 7 rows on the
text grid. Square pixels, integer alignment, no resampling. Derive this from `CELL_W` and `CELL_H`; do not hardcode 6.

## Hard constraints, unchanged

- CSS `@keyframes` only. No SMIL.
- Animate `opacity` and `transform` only.
- Base CSS must be the sleep pose with everything else hidden, because that is what a reduced-motion viewer sees.
- Every keyframe percentage derived from `MASCOT_TIMELINE` in `src/timeline.ts`, never hand-typed.
- Pose swaps use `step-end` so frames cut rather than cross-fade.
