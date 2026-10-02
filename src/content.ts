// src/content.ts
import { readFileSync } from "node:fs";
import { assertCovered, FORBIDDEN_GLYPHS } from "./font.ts";
import { MASCOT_TIMELINE, type PoseName } from "./timeline.ts";
import { rowsToFullText } from "./rows.ts";
import type { Row } from "./rows.ts";

export type Repo = { name: string; blurb: string };
export type Lane = { label: string; repos: Repo[] };
export type StackRow = { label: string; items: string[] };
/** The Statusline toggle: the owner's word and the state it reads, e.g. "Ultrachill" and "on". */
export type Toggle = { word: string; state: string };
/**
 * The two ends of the effort axis, which the panel prints above the track: `start` sits at its left
 * end and `end` at its right. Named for the positions rather than for the words, because the words
 * are the owner's and the positions are the layout's.
 */
export type EffortEnds = { start: string; end: string };
/**
 * The effort panel's copy, which is the whole Statusline.
 *
 * There is no `modeBadge` and no `note`, and both absences are decisions. The badge is not on screen
 * beside an effort panel in the grammar this borrows, because the effort command replaces the
 * statusline rather than sitting above it. The note said "not affiliated with Anthropic" and was
 * measured to be the only occurrence of that name in the whole published profile, so removing it
 * satisfies ADR 0002's own rule more completely than printing it did; ADR 0002 records that.
 */
export type Statusline = {
  effortWord: string; effortEnds: EffortEnds; effortLabels: string[]; effortSelected: string;
  toggle: Toggle;
  /** The one-line gloss on the toggle, under the scale. The only string that describes the picture. */
  toggleNote: string;
  /** The hint under the toggle, e.g. "Tab to toggle". */
  toggleHint: string;
  /** The panel's key hints, as labelled fragments; the generator supplies the separator between them. */
  help: string[];
};
/**
 * The /activity result line as labelled fragments: `<label> N/365 <daysUp> · M <contributions>`.
 * Fragments rather than a template with placeholders, so each one is validated like every other
 * visible string, and the order of the sentence stays in the generator, where the layout is.
 */
export type ActivityLine = { label: string; daysUp: string; contributions: string };
/** Spinner words grouped by Mascot state, so the label names the pose on screen. */
export type Verbs = Record<PoseName, string[]>;
/**
 * The two visible strings the README itself carries, outside the Session.
 *
 * `imageAlt` names what the picture IS, not what it contains, because what it contains is the
 * transcript directly below it; a screen reader that hears the Session twice is worse served
 * than one that hears a description and then the content. `transcriptSummary` is the word on the
 * `<details>` toggle. Both are read aloud, so both are the owner's (docs/spec.md 4.1).
 */
export type ReadmeCopy = { imageAlt: string; transcriptSummary: string };
/**
 * The shell prompt the Header is built from: the host the Handle is logged in to, and the command
 * whose output the Mascot is. Both are read aloud, so both are the owner's (docs/spec.md 4.1); the
 * prompt's own marks are Session Grammar and stay in the generator, and the path is not here at all
 * because it is the `login` with a `~/` in front of it.
 */
export type Prompt = { host: string; command: string };
/**
 * The three lines printed beside the Mascot, mirroring an agent CLI's startup block.
 *
 * Labelled fragments, not a template (docs/spec.md 4.1), and the split in the middle line is the
 * reason: `colourWord` is drawn in the colour it NAMES, so it has to be its own run, and the
 * generator supplies only the space between the two halves.
 *
 * - `version` sits after the Handle on the first line.
 * - `colourWord` plus `model` is the second, which parodies an agent CLI's model-effort-plan line
 *   slot for slot.
 * - `status` is the third.
 */
export type Startup = { version: string; colourWord: string; model: string; status: string };
export type Content = {
  handle: string; login: string; prompt: Prompt; startup: Startup; whoami: string[];
  lanes: Lane[]; stackRows: StackRow[]; verbs: Verbs;
  activityLine: ActivityLine; statusline: Statusline; readme: ReadmeCopy;
};

/**
 * The committed half of the list: a demonstration value, and public by definition.
 *
 * It is here so the machinery is testable with nothing configured, and it is the reason this
 * file, `test/content.test.ts` and `test/readme.test.ts` all carry the literal. Being committed
 * is exactly what makes it NOT a disclosure, which is why the tree scan in `scripts/gates.ts`
 * cannot use it: a needle that is published in the gate's own source would report every file
 * that tests the gate, and a gate whose output is mostly its own machinery is a gate people
 * learn to ignore. The tree scan uses CONFIGURED_FORBIDDEN_NAMES; this half is still scanned
 * for in the GENERATED output, where finding it means a placeholder reached a published surface.
 */
export const COMMITTED_FORBIDDEN_NAMES: string[] = ["Firstname Lastname"];

/**
 * The one place the private half of the list is read from. Named, so the message that tells a
 * person which variable to set cannot drift from the variable that is actually read.
 */
export const FORBIDDEN_NAMES_ENV = "PROFILE_FORBIDDEN_NAMES";

/**
 * The private half: real names, from the environment, never from a committed file.
 *
 * Set it to a comma-separated list, locally and in CI. Unset or empty changes nothing here, and
 * `scripts/gates.ts` reports the tree scan as unchecked rather than as clean when this is empty,
 * because the two are not the same thing.
 */
export const CONFIGURED_FORBIDDEN_NAMES: string[] =
  (process.env[FORBIDDEN_NAMES_ENV] ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * Strings that must never reach a published file (ADR 0001).
 * Each entry is matched case-insensitively against all content and all fetched data.
 *
 * This list is committed, so it is public: never write a private string into it.
 * Set PROFILE_FORBIDDEN_NAMES to a comma-separated list instead, locally and in CI.
 * It is merged with the committed entries; unset or empty changes nothing.
 */
export const FORBIDDEN_NAMES: string[] = [...COMMITTED_FORBIDDEN_NAMES, ...CONFIGURED_FORBIDDEN_NAMES];

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

/**
 * The ADR 0001 gate over a composed Session. It reads the complete projection of the rows and
 * never the transcript: a run the picture draws but the transcript omits, or the other way
 * round, must not be able to hide a name from this check. Call this rather than passing
 * `rowsToText` yourself, so the choice of projection cannot be got wrong at the call site.
 */
export function assertRowsCarryNoForbiddenNames(rows: Row[], where: string): void {
  assertNoForbiddenNames(rowsToFullText(rows), where);
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

/**
 * An account name the GitHub API is queried by. Not drawn anywhere, so it has no width to check,
 * but it is refused in the two shapes a person actually pastes by mistake: "@name", which is how
 * prose writes it, and "owner/repo", which is how a URL does. GitHub does not publish its own
 * character rule in its documentation, so this refuses only what certainly cannot be an account
 * name rather than guessing at the whole rule and rejecting a valid one.
 */
function accountName(v: unknown, field: string): void {
  text(v, field);
  if (typeof v === "string" && !/^[^\s@/]+$/.test(v)) {
    fail(`${field} must be a GitHub account name, with no spaces, "@" or "/" (the API is queried by it; it is not the drawn handle)`);
  }
}

/** Checks the shape the rest of the generator relies on, so `as Content` is honest. */
function assertShape(c: unknown): asserts c is Content {
  if (!isObj(c)) fail("the top level must be an object");
  text(c.handle, "handle");
  // The Handle is two values, not one: the nickname that is drawn, and the account the GitHub API
  // is queried by (CONTEXT.md). Nothing renders the login, but it is validated here like every
  // other string so a wrong one fails the build instead of returning no user from the API.
  accountName(c.login, "login");
  // The Header's prompt. There is no separate working-directory field any more: the path the prompt
  // prints is the login, and a path drawn twice is the same fact twice.
  if (!isObj(c.prompt)) fail("prompt must be an object");
  text(c.prompt.host, "prompt.host");
  text(c.prompt.command, "prompt.command");
  // The startup block beside the Mascot. Four fields rather than three lines, because the word that
  // is drawn in the colour it names has to be a fragment of its own.
  if (!isObj(c.startup)) fail("startup must be an object");
  text(c.startup.version, "startup.version");
  text(c.startup.colourWord, "startup.colourWord");
  text(c.startup.model, "startup.model");
  text(c.startup.status, "startup.status");
  // There is NO `role` key, and its absence is the decision rather than an omission: it said
  // "Offensive Security · Agentic AI Systems" four rows above a `whoami` line that said the same
  // words in lower case, so the Session stated the owner's discipline twice and the role row sat
  // orphaned between the startup block and the rule. `/whoami` is the one place it is said now.

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

  if (!isObj(c.activityLine)) fail("activityLine must be an object");
  text(c.activityLine.label, "activityLine.label");
  text(c.activityLine.daysUp, "activityLine.daysUp");
  text(c.activityLine.contributions, "activityLine.contributions");

  if (!isObj(c.statusline)) fail("statusline must be an object");
  const {
    effortWord, effortEnds, effortLabels, effortSelected,
    toggle, toggleNote, toggleHint, help,
  } = c.statusline;
  text(effortWord, "statusline.effortWord");
  // The axis is labelled at both ends, so both words are the owner's and both are checked here.
  if (!isObj(effortEnds)) fail("statusline.effortEnds must be an object");
  text(effortEnds.start, "statusline.effortEnds.start");
  text(effortEnds.end, "statusline.effortEnds.end");
  if (!Array.isArray(effortLabels) || effortLabels.length === 0) fail("statusline.effortLabels must not be empty");
  effortLabels.forEach((label, i) => text(label, `statusline.effortLabels[${i}]`));
  if (!effortLabels.includes(effortSelected)) fail("statusline.effortSelected must be one of effortLabels");
  // The gloss, the hint and the key fragments are all words a reader reads aloud, so all of them
  // are copy by the docs/spec.md 4.1 test and none of them may live in the generator.
  text(toggleNote, "statusline.toggleNote");
  text(toggleHint, "statusline.toggleHint");
  if (!Array.isArray(help) || help.length === 0) fail("statusline.help must list at least one fragment");
  help.forEach((fragment, i) => text(fragment, `statusline.help[${i}]`));
  // The toggle is its own copy, not one of the effort labels, so it needs its own home here:
  // every visible word belongs to the owner, and the copy audit only reads this file.
  if (!isObj(toggle)) fail("statusline.toggle must be an object");
  text(toggle.word, "statusline.toggle.word");
  text(toggle.state, "statusline.toggle.state");

  // The README's own two words. They are validated here like every other visible string, so a
  // missing one fails the build instead of writing the literal "undefined" into the one element
  // a screen reader reads first.
  if (!isObj(c.readme)) fail("readme must be an object");
  text(c.readme.imageAlt, "readme.imageAlt");
  text(c.readme.transcriptSummary, "readme.transcriptSummary");
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
