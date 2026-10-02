// src/content.ts
import { readFileSync } from "node:fs";
import { assertCovered, FORBIDDEN_GLYPHS } from "./font.ts";
import { MASCOT_TIMELINE, type PoseName } from "./timeline.ts";

export type Repo = { name: string; blurb: string };
export type Lane = { label: string; repos: Repo[] };
export type StackRow = { label: string; items: string[] };
/** The Statusline toggle: the owner's word and the state it reads, e.g. "Ultrachill" and "on". */
export type Toggle = { word: string; state: string };
export type Statusline = {
  effortLabels: string[]; effortSelected: string; modeBadge: string; note: string; toggle: Toggle;
};
/** Spinner words grouped by Mascot state, so the label names the pose on screen. */
export type Verbs = Record<PoseName, string[]>;
export type Content = {
  handle: string; cwd: string; role: string; whoami: string[];
  lanes: Lane[]; stackRows: StackRow[]; verbs: Verbs; statusline: Statusline;
};

/**
 * Strings that must never reach a published file (ADR 0001).
 * Each entry is matched case-insensitively against all content and all fetched data.
 *
 * This list is committed, so it is public: never write a private string into it.
 * Set PROFILE_FORBIDDEN_NAMES to a comma-separated list instead, locally and in CI.
 * It is merged with the committed entries; unset or empty changes nothing.
 */
export const FORBIDDEN_NAMES: string[] = [
  ...["Firstname Lastname"],
  ...(process.env.PROFILE_FORBIDDEN_NAMES ?? "").split(",").map((s) => s.trim()).filter(Boolean),
];

/**
 * Throws without echoing the name, so a build log never repeats what it is protecting.
 * `where` is quoted in the message, so it must not itself carry unchecked content.
 */
export function assertNoForbiddenNames(text: string, where: string): void {
  const hay = text.toLowerCase();
  for (const name of FORBIDDEN_NAMES) {
    if (name && hay.includes(name.toLowerCase())) {
      throw new Error(`forbidden name appears in ${where} (ADR 0001 forbids publishing it)`);
    }
  }
}

const DEFAULT_PATH = new URL("../content.json", import.meta.url);
const FONT_PATH = new URL("../vendor/JetBrainsMono-Regular.ttf", import.meta.url);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function fail(msg: string): never {
  throw new Error(`content.json: ${msg}`);
}

/** A string that is drawn. Blank is refused unless the field can meaningfully be empty. */
function text(v: unknown, field: string, allowBlank = false): void {
  if (typeof v !== "string") fail(`${field} must be a string`);
  if (!allowBlank && v.trim() === "") fail(`${field} must not be blank`);
}

/** Checks the shape the rest of the generator relies on, so `as Content` is honest. */
function assertShape(c: unknown): asserts c is Content {
  if (!isObj(c)) fail("the top level must be an object");
  text(c.handle, "handle");
  text(c.cwd, "cwd");
  text(c.role, "role");

  if (!Array.isArray(c.whoami) || c.whoami.length < 1 || c.whoami.length > 3) fail("whoami must have 1 to 3 lines");
  c.whoami.forEach((line, i) => text(line, `whoami[${i}]`));

  if (!Array.isArray(c.lanes) || c.lanes.length === 0) fail("lanes must be a non-empty list");
  c.lanes.forEach((lane: unknown, i) => {
    if (!isObj(lane)) fail(`lanes[${i}] must be an object`);
    text(lane.label, `lanes[${i}].label`);
    if (!Array.isArray(lane.repos) || lane.repos.length === 0) fail(`lane ${lane.label} has no repos`);
    lane.repos.forEach((repo: unknown, j) => {
      if (!isObj(repo)) fail(`lanes[${i}].repos[${j}] must be an object`);
      text(repo.name, `lanes[${i}].repos[${j}].name`);
      if (typeof repo.blurb !== "string" || repo.blurb.trim() === "") fail(`repo ${repo.name} needs a non-blank blurb`);
    });
  });

  if (!Array.isArray(c.stackRows) || c.stackRows.length === 0) fail("stackRows must be a non-empty list");
  c.stackRows.forEach((row: unknown, i) => {
    if (!isObj(row)) fail(`stackRows[${i}] must be an object`);
    text(row.label, `stackRows[${i}].label`, true);
    if (!Array.isArray(row.items) || row.items.length === 0) fail(`stackRows[${i}].items must be a non-empty list`);
    row.items.forEach((item, j) => text(item, `stackRows[${i}].items[${j}]`));
  });

  if (!isObj(c.verbs)) fail("verbs must be an object keyed by mascot state");
  // Every state the Mascot can reach needs at least one word, or the spinner would
  // go blank exactly when the cat does something worth naming.
  for (const state of new Set(MASCOT_TIMELINE.map((w) => w.state))) {
    const words = c.verbs[state];
    if (!Array.isArray(words) || words.length === 0) fail(`verbs.${state} must list at least one word`);
    words.forEach((word, i) => text(word, `verbs.${state}[${i}]`));
  }

  if (!isObj(c.statusline)) fail("statusline must be an object");
  const { effortLabels, effortSelected, modeBadge, note, toggle } = c.statusline;
  if (!Array.isArray(effortLabels) || effortLabels.length === 0) fail("statusline.effortLabels must not be empty");
  effortLabels.forEach((label, i) => text(label, `statusline.effortLabels[${i}]`));
  if (!effortLabels.includes(effortSelected)) fail("statusline.effortSelected must be one of effortLabels");
  text(modeBadge, "statusline.modeBadge");
  text(note, "statusline.note");
  // The toggle is its own copy, not one of the effort labels, so it needs its own home here:
  // every visible word belongs to the owner, and the copy audit only reads this file.
  if (!isObj(toggle)) fail("statusline.toggle must be an object");
  text(toggle.word, "statusline.toggle.word");
  text(toggle.state, "statusline.toggle.state");
}

/**
 * Throws on a forbidden name in any string value or object key. A key is checked before it
 * is used to build a path, so the path in a message never carries a name it has not cleared.
 */
function assertNoNames(v: unknown, path = ""): void {
  if (typeof v === "string") assertNoForbiddenNames(v, `content.json field ${path || "(top level)"}`);
  else if (Array.isArray(v)) v.forEach((x, i) => assertNoNames(x, `${path}[${i}]`));
  else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      assertNoForbiddenNames(k, `content.json, in a key under ${path || "the top level"}`);
      assertNoNames(x, path ? `${path}.${k}` : k);
    }
  }
}

/** Every string value in the document with the path that leads to it, e.g. `lanes[0].repos[1].blurb`. */
function* strings(v: unknown, path = ""): Generator<[string, string]> {
  if (typeof v === "string") yield [path, v];
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* strings(v[i], `${path}[${i}]`);
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) yield* strings(x, path ? `${path}.${k}` : k);
}

export function loadContent(path?: string): Content {
  const raw = readFileSync(path ?? DEFAULT_PATH, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // V8 quotes the source text near a syntax error, so rule out a name before repeating it.
    assertNoForbiddenNames(raw, "content.json");
    return fail(`not valid JSON (${(e as Error).message})`);
  }

  // Names are scanned first. Every message below can quote a value from the file (a repo
  // name, a lane label), and a build log may be public, so nothing is quoted until it is
  // known to carry no forbidden name. The raw text is scanned as well because JSON.parse
  // keeps only the last of two duplicate keys, and the file itself is what gets committed.
  assertNoNames(parsed);
  assertNoForbiddenNames(raw, "content.json");
  assertShape(parsed);

  // Everything visible must be drawable. Checked string by string so the failure names the
  // field; unknown extra fields are covered too.
  const ttf = readFileSync(FONT_PATH);
  for (const [field, value] of strings(parsed)) {
    for (const ch of FORBIDDEN_GLYPHS) {
      if (value.includes(ch)) {
        const hex = ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
        fail(`${field} uses ${ch} (U+${hex}), which the font cannot draw`);
      }
    }
    try {
      assertCovered(ttf, value);
    } catch (e) {
      fail(`${field}: ${(e as Error).message}`);
    }
  }
  return parsed;
}
