// src/timeline.ts
/** The Mascot's animation states. */
export type PoseName = "sleep" | "yawn" | "stretch" | "settle" | "startle";

/** Length of the Mascot's master loop, in seconds. */
export const MASTER_SECONDS = 60;

/**
 * The single source of truth for the Mascot's loop. The mascot art and the
 * spinner's verb schedule are both derived from this, so the spinner label
 * always names the pose currently on screen. Hand-offs land on breath
 * boundaries (multiples of 3.75s) wherever possible.
 */
export const MASCOT_TIMELINE: { state: PoseName; from: number; to: number }[] = [
  { state: "sleep",   from: 0,     to: 15 },
  { state: "yawn",    from: 15,    to: 18.4 },
  { state: "stretch", from: 18.4,  to: 23.4 },
  { state: "settle",  from: 23.4,  to: 26.25 },
  { state: "sleep",   from: 26.25, to: 48.75 },
  { state: "startle", from: 48.75, to: 49.55 },
  { state: "sleep",   from: 49.55, to: 60 },
];
