// src/timeline.ts
/** The Mascot's animation states. */
export type PoseName = "sleep" | "yawn" | "stretch" | "settle" | "startle";

/** Length of the Mascot's master loop, in seconds. */
export const MASTER_SECONDS = 36;

/**
 * The single source of truth for the Mascot's loop. The mascot art and the
 * spinner's verb schedule are both derived from this, so the spinner label
 * always names the pose currently on screen. The gestures keep the length a
 * real cat gives them (a yawn is 3.4s); only the waiting between them is short,
 * so the first event comes 7.5s in. The pop at 30s and the loop join at 36s land
 * on breath boundaries (multiples of the 3s breath).
 */
export const MASCOT_TIMELINE: { state: PoseName; from: number; to: number }[] = [
  { state: "sleep",   from: 0,     to: 7.5 },
  { state: "yawn",    from: 7.5,   to: 10.9 },
  { state: "stretch", from: 10.9,  to: 15.9 },
  { state: "settle",  from: 15.9,  to: 18.75 },
  { state: "sleep",   from: 18.75, to: 30 },
  { state: "startle", from: 30,    to: 30.8 },
  { state: "sleep",   from: 30.8,  to: 36 },
];
