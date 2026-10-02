// src/timeline.ts
/**
 * The Mascot's animation states.
 *
 * Node 26 strips types rather than compiling them, so this is a union and not an enum.
 */
export type PoseName =
  | "sleep" | "yawn" | "stretch" | "settle"
  | "peek"
  | "alert" | "swat-up" | "swat-down" | "glare" | "butt-up" | "butt-down" | "recover";

/** Length of the Mascot's master loop, in seconds. */
export const MASTER_SECONDS = 36;

/**
 * States in which she is, or is pretending to be, asleep.
 *
 * The nose bubble inflates across the nap that runs up to the alarm, and that nap is no longer one
 * window: `peek` sits in the middle of it. So the bubble's inflation window is derived by walking
 * back over these states from the pop, rather than by taking the window immediately before it.
 * `peek` counts because the joke is that she never stopped faking the nap: a bubble on the nose
 * says deep sleep while the open eye says otherwise, and the bubble must not blink out to say it.
 */
export const DREAMING: PoseName[] = ["sleep", "peek"];

/**
 * The single source of truth for the Mascot's loop. The mascot art, the rack's alarm and the
 * spinner's verb schedule are all derived from this, so the spinner label always names the pose
 * currently on screen. The gestures keep the length a real cat gives them (a yawn is 3.4s); only
 * the waiting between them is short, so the first event comes 7.5s in.
 *
 * Two stories run in it. The first is the nap: yawn, stretch, settle, then a long sleep in which
 * the nose bubble inflates. `peek` lands at 25s, late on purpose, so it catches a viewer who has
 * been reading rather than one who has just arrived; it is placed while the bubble is still
 * inflating because a bubble plus an open eye is the joke.
 *
 * The second is the alarm, and it replaces the old single `startle`. The rack faults, she wakes
 * angry, hits the chassis twice with a paw, sees that nothing has changed, headbutts it, and the
 * machine comes back green. The bubble now pops at `alert`, so the two jolts the loop used to have
 * became one. She is lying ON the rack and the LEDs are on its front face, so she cannot reach
 * them: every blow lands on the chassis, which is what percussive maintenance actually is.
 */
export const MASCOT_TIMELINE: { state: PoseName; from: number; to: number }[] = [
  { state: "sleep",     from: 0,     to: 7.5 },
  { state: "yawn",      from: 7.5,   to: 10.9 },
  { state: "stretch",   from: 10.9,  to: 15.9 },
  { state: "settle",    from: 15.9,  to: 18.75 },
  { state: "sleep",     from: 18.75, to: 25 },
  { state: "peek",      from: 25,    to: 26 },
  { state: "sleep",     from: 26,    to: 28 },
  { state: "alert",     from: 28,    to: 28.6 },
  { state: "swat-up",   from: 28.6,  to: 29 },
  { state: "swat-down", from: 29,    to: 29.4 },
  { state: "swat-up",   from: 29.4,  to: 29.8 },
  { state: "swat-down", from: 29.8,  to: 30.2 },
  { state: "glare",     from: 30.2,  to: 30.8 },
  { state: "butt-up",   from: 30.8,  to: 31.2 },
  { state: "butt-down", from: 31.2,  to: 31.6 },
  { state: "recover",   from: 31.6,  to: 32.4 },
  { state: "sleep",     from: 32.4,  to: 36 },
];
