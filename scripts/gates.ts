// Usage: npm run gates            (or: node scripts/gates.ts [root])
//
// The acceptance gates (docs/spec.md 6). Every one of them catches a failure that RENDERS FINE AND
// IS WRONG, which is the whole reason they are code rather than a line on a reviewer's checklist:
// a forbidden name reads as ordinary copy, a missing reduced-motion rule looks identical to a
// present one until someone with vestibular sensitivity loads the page, a glyph the font cannot
// draw is a blank box on their screen and a correct character on ours, and a `url(#id)` with no
// target paints nothing and raises nothing.
//
// THREE STATES, NOT TWO. A gate here reports `pass`, `fail` or `absent`, and the three are kept
// apart deliberately. There is no committed `cache/activity.json`, no `assets/` and no `README.md`
// until the first authenticated refresh has run, because `npm run build` fails rather than
// inventing a calendar (docs/spec.md 5.3). A gate that said "FAILED" for both "this output is
// wrong" and "this output does not exist yet" would be useless on the first real run, which is
// exactly the moment somebody needs to know which of the two it is looking at. So the run exits 1
// when something is wrong, 3 when something could not be checked because it has not been built,
// and 0 only when every gate actually ran and passed.
//
// WHAT COUNTS AS "IN THE TREE". The two scanning gates ask git for the file list whenever `root`
// is a work tree, because the question they answer is "could this be published", and git's own
// ignore rules are the only correct answer to it: a token in the gitignored `.env` is where the
// token is SUPPOSED to live (docs/spec.md 5.2), and the same string in a tracked file is a breach.
// A skip list written out here instead would drift from `.gitignore`, and the direction it drifts
// matters: a skip this file has and `.gitignore` does not is a hole the gate cannot see. Untracked
// files that are not ignored are scanned too, since `git add -A` would commit them.
//
// NOTHING HERE ECHOES WHAT IT IS PROTECTING. A forbidden-name hit names the file and not the name
// (ADR 0001), and a secret hit names the file and the SHAPE that matched, never the match. A gate
// that printed its finding would publish the thing it exists to keep out of the tree, and CI logs
// are public.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TOKEN_ENV } from "../src/activity.ts";
import { COMMITTED_FORBIDDEN_NAMES, CONFIGURED_FORBIDDEN_NAMES, FORBIDDEN_NAMES } from "../src/content.ts";
import { FORBIDDEN_GLYPHS } from "../src/font.ts";

// ---------------------------------------------------------------------------------------------
// The file list
// ---------------------------------------------------------------------------------------------

/**
 * Extensions whose bytes are not text. A DENY list rather than an allow list, on purpose: an
 * allow list silently stops scanning the first time somebody adds a `.py`, a `.sh` or a `.toml`,
 * and a gate that quietly narrows is worse than one that occasionally reads something odd. A file
 * that slips through this and is binary anyway is caught by the NUL-byte check below.
 */
const BINARY = /\.(ttf|otf|woff2?|eot|png|jpe?g|gif|webp|avif|bmp|ico|icns|pdf|zip|t?gz|tar|bz2|xz|7z|rar|mp4|webm|mov|avi|mp3|wav|flac|ogg|wasm|so|dylib|dll|exe|class|jar|pyc|node|db|sqlite3?)$/i;

/** Directories the fallback walk never enters. Everything else about ignoring is git's job. */
const WALK_SKIP = new Set([".git", "node_modules"]);

const dirOf = (root: URL): string => fileURLToPath(root).replace(/\/+$/, "");

function gitListing(dir: string): string[] | null {
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    if (git("rev-parse", "--is-inside-work-tree").trim() !== "true") return null;
    // Tracked AND untracked-but-not-ignored: both are things a commit can carry.
    return git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
      .split("\0")
      .filter((p) => p !== "");
  } catch {
    return null;
  }
}

function walk(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (WALK_SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(relative(base, full));
  }
  return out;
}

/**
 * Every file the scanning gates read, root-relative and sorted.
 *
 * git when there is a git to ask, a plain walk otherwise, which is what the tests' temp
 * directories get. A file whose extension says binary is dropped before it is opened, and
 * anything that is not a regular file is dropped as well: git lists a tracked file that has since
 * been deleted, and it lists a symlink by its own name, which may point at a directory (there is
 * one in this very tree). Following `statSync` rather than `lstatSync` is deliberate: a symlink
 * to a text file still delivers text, and resolving it is what a reader of the repository would
 * see.
 */
export function listFiles(root: URL): string[] {
  const dir = dirOf(root);
  const listed = gitListing(dir) ?? walk(dir, dir);
  return listed
    .filter((rel) => !BINARY.test(rel) && statSync(join(dir, rel), { throwIfNoEntry: false })?.isFile() === true)
    .sort();
}

/** The file as text, or null when its bytes say it is not text after all. */
function readIfText(abs: string): string | null {
  const buf = readFileSync(abs);
  return buf.includes(0) ? null : buf.toString("utf8");
}

// ---------------------------------------------------------------------------------------------
// Gate: forbidden names (ADR 0001)
// ---------------------------------------------------------------------------------------------

/**
 * The forbidden names as lowercase needles, with blanks dropped.
 *
 * Throws on an empty list rather than returning one. An empty needle list makes
 * `scanTreeForForbiddenNames` return `[]` for every tree there is, which reads in a report as
 * "clean" and means "nothing was checked". That is the one failure mode a gate must not have, and
 * it is one edit away: `FORBIDDEN_NAMES` is assembled from a committed entry plus whatever
 * PROFILE_FORBIDDEN_NAMES adds, so removing the committed one is enough to silence the gate.
 */
export function forbiddenNeedles(names: string[]): string[] {
  const needles = names.map((n) => n.trim().toLowerCase()).filter((n) => n !== "");
  if (needles.length === 0) {
    throw new Error("the forbidden-name list is empty, so this scan would pass for every tree there is (ADR 0001)");
  }
  return needles;
}

/**
 * Paths, root-relative, of files carrying a forbidden name (ADR 0001).
 *
 * Case-insensitive, because the name is a name and not a token: a lowercase spelling of it is the
 * same disclosure. The returned paths deliberately do not say WHICH name matched or where, since
 * this list is printed into a build log.
 *
 * This covers fetched data as well as hand-written content, because `cache/activity.json` is a
 * committed file like any other and is in the list this walks. The fetch has its own gate on
 * arrival as well (`src/activity.ts`, which scans the whole response body before the parser
 * runs), and the two are not redundant: that one refuses the data, this one refuses the commit.
 *
 * `names` is a parameter because the two halves of `FORBIDDEN_NAMES` have different reach. The
 * committed half is a public demonstration value and appears in this gate's own source and in
 * three test files, so scanning the tree for it reports the machinery and nothing else. The
 * private half, from PROFILE_FORBIDDEN_NAMES, is what a tree scan is for. See `runGates`.
 */
export function scanTreeForForbiddenNames(root: URL, names: string[] = FORBIDDEN_NAMES): string[] {
  const needles = forbiddenNeedles(names);
  const dir = dirOf(root);
  const hits: string[] = [];
  for (const rel of listFiles(root)) {
    const body = readIfText(join(dir, rel));
    if (body === null) continue;
    const hay = body.toLowerCase();
    if (needles.some((n) => hay.includes(n))) hits.push(rel);
  }
  return hits;
}

/** Which of `names` a single text carries, as a count. Used where the surface is one file. */
export function countNamesIn(text: string, names: string[]): number {
  const hay = text.toLowerCase();
  return forbiddenNeedles(names).filter((n) => hay.includes(n)).length;
}

// ---------------------------------------------------------------------------------------------
// Gate: secrets
// ---------------------------------------------------------------------------------------------

/**
 * Token shapes. Added after a live token was pasted into a session: the gate exists so that a
 * credential cannot be committed even once.
 *
 * Every pattern is a SHAPE a real credential has and ordinary text does not. There is deliberately
 * no general "long high-entropy string" rule, measured rather than assumed: `package-lock.json`
 * carries an 88-character base64 `integrity` hash per dependency and the two SVGs carry a base64
 * font each, so an entropy rule would fire on every build and be switched off within a week.
 *
 * `test/activity.test.ts` holds a deliberate non-credential stand-in, shaped with no lowercase and
 * no digit precisely so it does not trip the gate it exists to defend. Do not "fix" either side.
 */
export type SecretShape = { label: string; pattern: RegExp };

/**
 * A capture that looks like a generated credential rather than a word somebody typed.
 *
 * Two shapes, because one of them does not have mixed case at all: a legacy GitHub personal
 * access token is 40 characters of lowercase hex, which has no uppercase letter to require. The
 * hex arm is only reached when a key named for a credential is on the left of the assignment, so
 * it cannot fire on the commit hashes and `integrity` digests that are all over a lockfile.
 */
const credentialShaped = (s: string): boolean =>
  (/[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s)) || /^[0-9a-f]{32,}$/i.test(s);

export const SECRET_SHAPES: SecretShape[] = [
  { label: "a GitHub token (gh?_ prefix)", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { label: "a GitHub fine-grained token", pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}/ },
  { label: "an Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{24,}/ },
  { label: "an OpenAI API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { label: "an AWS access key id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: "a Slack token", pattern: /\bxox[baprse]-[A-Za-z0-9-]{12,}/ },
  { label: "a Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: "a PEM private key block", pattern: /-----BEGIN[ A-Z]*PRIVATE KEY-----/ },
  { label: "a JSON web token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  // The project's own variable, with a value written beside it. `$` is excluded from the first
  // character of the value so that the one legitimate spelling, the workflow's
  // `${{ secrets.<name> }}` reference, is not read as the secret itself. The whitespace classes
  // are horizontal only, so a blank value at the end of a line (`.env.example`) stays blank
  // rather than reaching forward to the next line for a character.
  {
    label: `${TOKEN_ENV} with a value beside it`,
    pattern: new RegExp(`${TOKEN_ENV}[^\\S\\n]*[=:][^\\S\\n]*["']?[^\\s"'#,}$]`),
  },
];

/**
 * A credential assigned to a key that says what it is: `token = ...`, `api_key: "..."`.
 *
 * Kept apart from SECRET_SHAPES because it needs a predicate on the captured value, not just a
 * match. Bare `key` is deliberately NOT one of the words: it would fire on `@keyframes`, which
 * every generated SVG carries.
 *
 * The leading boundary is `[^A-Za-z0-9]` and not `\b`, measured rather than assumed: `\b` does not
 * fire between an underscore and a letter, so `\btoken\b` misses `my_token = ...`, which is the
 * commonest spelling there is. Underscore and hyphen are separators here, not letters.
 */
const ASSIGNED_SECRET = /(?:^|[^A-Za-z0-9])(?:token|secret|passwd|password|api[_-]?key|access[_-]?key|private[_-]?key|credentials?)["']?[^\S\n]*[=:][^\S\n]*["']?([A-Za-z0-9_\-+/]{20,})/gi;

/** The shapes a text carries, by label, deduplicated. Never the match: the match is the secret. */
export function findSecretShapes(text: string): string[] {
  const found: string[] = [];
  for (const { label, pattern } of SECRET_SHAPES) {
    if (pattern.test(text)) found.push(label);
  }
  for (const m of text.matchAll(ASSIGNED_SECRET)) {
    if (credentialShaped(m[1])) {
      found.push("a credential assigned to a key named for one");
      break;
    }
  }
  return [...new Set(found)];
}

/** `path: shape` for every file carrying a token-shaped string. Never the string itself. */
export function scanTreeForSecrets(root: URL): string[] {
  const dir = dirOf(root);
  const hits: string[] = [];
  for (const rel of listFiles(root)) {
    const body = readIfText(join(dir, rel));
    if (body === null) continue;
    for (const label of findSecretShapes(body)) hits.push(`${rel}: ${label}`);
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------
// Gate: dashes, in anything visible
// ---------------------------------------------------------------------------------------------

/**
 * Zero em-dashes and zero en-dashes in visible copy (docs/spec.md 3.6, docs/design-contract.md).
 *
 * SCOPE, RULED ON AND NOT TO BE WIDENED: `content.json`, `README.md` and the generated
 * `assets/*.svg`. NOT `src/`, `scripts/`, `test/` or `docs/`.
 *
 * The reason is what the rule is for. The ban is a COPY rule: an em-dash reads as an
 * AI-writing tell in prose a stranger reads, so the profile's visible words must not carry one.
 * A comment in a build script is not prose anybody reads on the profile, so scanning it buys a
 * reader nothing and costs a false positive every time somebody writes a clear comment.
 * `scripts/mutation-check.ts` carries one in a comment today, and it is correct there.
 *
 * There is a precedent in this project: the `WINDOW_DAYS` guard first scanned `src/session.ts`
 * for a literal `365` including comments, and it forced a comment to be reworded to pass. It was
 * narrowed to strip comments and strings, keeping template-literal TEXT in scope because text
 * inside a template is printed. Same principle, same exception shape: what reaches a reader is
 * in scope, what only reaches a maintainer is not. A guard people have to fight is a guard people
 * switch off.
 *
 * The forbidden-name gate above is deliberately NOT scoped this way. ADR 0001 is about a name
 * never appearing anywhere at all rather than about prose style, so it reads every committed
 * file, source and tests included. The two are both string scans and they protect different
 * things; do not unify their reach.
 *
 * The characters are written as escapes here so that this file can be read by the gate it
 * implements without excusing itself from it.
 */
const DASHES: [string, string][] = [["\u2014", "an em-dash"], ["\u2013", "an en-dash"]];

export function findDashes(text: string): string[] {
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    for (const [ch, name] of DASHES) {
      if (line.includes(ch)) out.push(`line ${i + 1} carries ${name}`);
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Gate: control characters in generated output
// ---------------------------------------------------------------------------------------------

/**
 * C0 except the newline, DEL, C1, and the byte order mark.
 *
 * The line feed is the one control character generated output is allowed, because the transcript
 * is lines. A tab is not: the Session is a fixed grid measured in columns and a tab is whatever
 * the renderer decides it is. The text is split on newlines before this is applied, so a carriage
 * return left at the end of a line is caught as the stray it would be.
 */
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\ufeff]/;

export function findControlCharacters(text: string): string[] {
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    for (const ch of line) {
      if (!CONTROL.test(ch)) continue;
      const hex = ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
      out.push(`line ${i + 1} carries a control character, U+${hex}`);
    }
  });
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------------------------
// Gate: glyphs the font cannot draw
// ---------------------------------------------------------------------------------------------

/**
 * The ten characters verified absent from JetBrains Mono v2.304 (docs/spec.md 3.3).
 *
 * The list is imported rather than retyped. Retyping it would put the characters into a second
 * file, where they would then have to be excused from this very gate, and would let the two
 * copies disagree about which glyphs the font is missing.
 */
export function findAbsentGlyphs(svg: string): string[] {
  const out: string[] = [];
  for (const ch of FORBIDDEN_GLYPHS) {
    if (!svg.includes(ch)) continue;
    const hex = ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
    out.push(`carries U+${hex}, which the font cannot draw, so it renders as a blank box`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Gate: reduced motion
// ---------------------------------------------------------------------------------------------

/**
 * The rule that collapses the whole motion layer, and the one mechanism that defeats it.
 *
 * Its absence is invisible: the picture animates for everybody and nothing anywhere reports a
 * fault. SMIL is checked in the same gate because SMIL animation keeps running under
 * `prefers-reduced-motion` regardless of the rule, so a file carrying both has the rule and not
 * the behaviour (docs/spec.md 3.1).
 */
const REDUCED_MOTION = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{\s*\*\s*\{\s*animation\s*:\s*none\s*!\s*important\s*;?\s*\}/;
const SMIL = /<(animate|animateTransform|animateMotion|set)\b/;

export function findReducedMotionFaults(svg: string): string[] {
  const out: string[] = [];
  if (!REDUCED_MOTION.test(svg)) {
    out.push("no rule that zeroes every animation under prefers-reduced-motion: reduce");
  }
  const smil = SMIL.exec(svg);
  if (smil !== null) out.push(`uses SMIL (<${smil[1]}>), which keeps running under reduced motion whatever the rule says`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Gate: SVG structure
// ---------------------------------------------------------------------------------------------

/**
 * The structural faults that paint nothing and raise nothing.
 *
 * Implemented here rather than delegated, because the external checker this mirrors lives in a
 * skills directory under the developer's home and is NOT present on a CI runner, so a gate that
 * only shelled out to it would be a gate that never ran in the one place it has to. The external
 * checker is still run, as a cross-check, wherever it exists.
 */
export function checkSvgStructure(svg: string): string[] {
  const out: string[] = [];

  const ids = [...svg.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
  const duplicated = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].sort();
  if (duplicated.length > 0) {
    out.push(`duplicate id(s) ${duplicated.join(", ")}: url(#id) resolves to the first, so one of them paints the wrong thing`);
  }

  const refs = new Set<string>();
  for (const m of svg.matchAll(/url\(\s*#([^)\s"']+)\s*\)/g)) refs.add(m[1]);
  for (const m of svg.matchAll(/(?:xlink:)?href="#([^"]+)"/g)) refs.add(m[1]);
  const known = new Set(ids);
  const dangling = [...refs].filter((r) => !known.has(r)).sort();
  if (dangling.length > 0) {
    out.push(`reference(s) to undefined id(s) ${dangling.join(", ")}: the paint or clip silently does nothing`);
  }

  const openTag = /<svg\b[^>]*>/.exec(svg);
  if (openTag === null) {
    out.push("no <svg> element, so this is not an SVG document at all");
    return out;
  }
  const attr = (name: string): string | null => {
    const m = new RegExp(`\\s${name}="([^"]*)"`).exec(openTag[0]);
    return m === null ? null : m[1];
  };

  const viewBox = attr("viewBox");
  if (viewBox === null) {
    out.push("no viewBox, so the picture cannot scale with the README column");
  } else {
    const nums = viewBox.trim().split(/[\s,]+/).map(Number);
    if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
      out.push(`the viewBox needs four numbers, not ${JSON.stringify(viewBox)}`);
    } else {
      // A width/height that disagrees with the viewBox letterboxes the art inside its own box,
      // which is a wrong render that raises nothing.
      const w = Number(attr("width"));
      const h = Number(attr("height"));
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && nums[2] > 0 && nums[3] > 0) {
        const want = nums[2] / nums[3];
        if (Math.abs(w / h - want) / want > 0.01) {
          out.push(`width/height is ${(w / h).toFixed(3)}:1 but the viewBox is ${want.toFixed(3)}:1, so the art is letterboxed inside the box`);
        }
      }
    }
  }

  if (attr("role") !== "img") out.push('no role="img" on <svg>, so the title is not announced as the picture\'s name');
  if (!/<title>[^<]/.test(svg)) out.push("no <title>, so a screen reader gets nothing from the picture");
  if (/<script/i.test(svg)) out.push("carries a script, which an <img>-embedded SVG will not run and which has no business being there");
  if (/\son[a-z]+="/i.test(svg)) out.push("carries an inline event handler");

  return out;
}

/** The counts the external checker reports, so a change from today's 0 and 0 is visible. */
export function svgReferenceCounts(svg: string): { ids: number; refs: number } {
  const ids = new Set([...svg.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]));
  const refs = new Set<string>();
  for (const m of svg.matchAll(/url\(\s*#([^)\s"']+)\s*\)/g)) refs.add(m[1]);
  for (const m of svg.matchAll(/(?:xlink:)?href="#([^"]+)"/g)) refs.add(m[1]);
  return { ids: ids.size, refs: refs.size };
}

/**
 * `svg-foundry`'s own checker, when it is installed. Its warnings count as failures here: the two
 * it raises that this project cannot tolerate, a missing viewBox and a missing accessible name,
 * are warnings in a general-purpose tool and hard requirements in docs/spec.md.
 */
export const SVG_CHECK_SCRIPT = process.env.SVG_CHECK_SCRIPT
  ?? join(homedir(), ".claude/skills/svg-foundry/scripts/check_svg.py");

export function externalSvgCheck(paths: string[], script: string = SVG_CHECK_SCRIPT): { ran: boolean; problems: string[] } {
  if (!existsSync(script)) return { ran: false, problems: [] };
  let raw: string;
  try {
    raw = execFileSync("python3", [script, "--json", ...paths], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    // The script exits 1 when it finds an error, with the report still on stdout.
    if (typeof err.stdout !== "string" || err.stdout.trim() === "") {
      return { ran: false, problems: [] };
    }
    raw = err.stdout;
  }
  const reports = JSON.parse(raw) as { file: string; errors: string[]; warnings: string[] }[];
  const problems: string[] = [];
  for (const r of reports) {
    for (const e of r.errors) problems.push(`${r.file}: ${e}`);
    for (const w of r.warnings) problems.push(`${r.file}: ${w}`);
  }
  return { ran: true, problems };
}

// ---------------------------------------------------------------------------------------------
// Gate: size budget
// ---------------------------------------------------------------------------------------------

/** Each SVG must be at most this (docs/spec.md 3.1). GitHub serves them on every profile view. */
export const SIZE_BUDGET_BYTES = 250_000;

export function findSizeFaults(svg: string): string[] {
  // Bytes, not characters: the Session draws box-drawing characters and a middle dot, every one
  // of which is three bytes of UTF-8, so a length in characters understates the file it ships.
  const bytes = Buffer.byteLength(svg, "utf8");
  return bytes > SIZE_BUDGET_BYTES
    ? [`${bytes} bytes, over the ${SIZE_BUDGET_BYTES} byte budget by ${bytes - SIZE_BUDGET_BYTES}`]
    : [];
}

// ---------------------------------------------------------------------------------------------
// Gate: the README
// ---------------------------------------------------------------------------------------------

/** GitHub strips all of these from a README silently, so the page renders and renders wrong. */
const README_FORBIDDEN: [RegExp, string][] = [
  [/<script/i, "a <script> element"],
  [/<style/i, "a <style> element"],
  [/style=/i, "an inline style attribute"],
  [/<iframe/i, "an <iframe>"],
  [/<svg/i, "an inline <svg>"],
];

/** Rows the transcript must carry before it is a transcript rather than a stub. */
export const MIN_TRANSCRIPT_ROWS = 20;

/**
 * The README's integrity: that it really points at both Theme Variants, that the files it points
 * at are there, and that it carries the Session as text.
 *
 * `exists` is injected rather than read here so the same function can be driven over a README
 * that has not been written next to its assets yet. The two image paths are read OUT of the
 * README and checked against the filesystem rather than compared with a constant: a renamed
 * asset path is then caught from either side, where comparing against the generator's own
 * constant would move with the rename and notice nothing.
 */
export function findReadmeFaults(readme: string, exists: (src: string) => boolean): string[] {
  const out: string[] = [];

  for (const [pattern, what] of README_FORBIDDEN) {
    if (pattern.test(readme)) out.push(`carries ${what}, which GitHub strips silently`);
  }

  const source = (scheme: string): string | null => {
    const m = new RegExp(`<source[^>]*\\(prefers-color-scheme:\\s*${scheme}\\)"[^>]*srcset="([^"]+)"`).exec(readme);
    return m === null ? null : m[1];
  };
  const dark = source("dark");
  const light = source("light");
  const img = /<img\b[^>]*>/.exec(readme);

  if (dark === null) out.push("no <source> for the dark Theme Variant");
  if (light === null) out.push("no <source> for the light Theme Variant");
  if (dark !== null && light !== null && dark === light) {
    out.push("both Theme Variants point at the same file, so one of the two renders is never served");
  }
  for (const src of [dark, light]) {
    if (src !== null && !exists(src)) out.push(`references ${src}, which is not there`);
  }

  if (img === null) {
    out.push("no <img> fallback, so a client that does not support <picture> gets nothing");
  } else {
    const attr = (name: string): string | null => {
      const m = new RegExp(`\\s${name}="([^"]*)"`).exec(img[0]);
      return m === null ? null : m[1];
    };
    const src = attr("src");
    const alt = attr("alt");
    const width = attr("width");
    if (src === null) out.push("the <img> fallback has no src");
    else if (!exists(src)) out.push(`the <img> fallback references ${src}, which is not there`);
    else if (dark !== null && src !== dark) {
      out.push("the <img> fallback is not the dark variant, which docs/spec.md 1 makes the fallback");
    }
    if (alt === null || alt.trim() === "") out.push("the <img> has no alt text, so the picture has no accessible name");
    if (width !== null && /^\d+(px)?$/.test(width)) {
      out.push(`the <img> is pinned to ${width}, so it cannot shrink to the 308px phone column`);
    }
  }

  const details = /<details>([\s\S]*?)<\/details>/.exec(readme);
  if (details === null) {
    out.push("no <details> transcript block, so the Session's words reach no screen reader, search engine or copy-paste (ADR 0004)");
    return out;
  }
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(details[1]);
  if (summary === null || summary[1].trim() === "") out.push("the transcript block has no <summary> label");
  const fenced = /(?:^|\n)(`{3,})[^\n]*\n([\s\S]*?)\n\1(?=\n|$)/.exec(details[1]);
  if (fenced === null) {
    out.push("the transcript is not inside a fenced code block, so its column grid collapses into prose");
  } else {
    const rows = fenced[2].split("\n");
    if (rows.length < MIN_TRANSCRIPT_ROWS) {
      out.push(`the transcript is ${rows.length} rows, too few to be the Session (at least ${MIN_TRANSCRIPT_ROWS} expected)`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Gate: the type check
// ---------------------------------------------------------------------------------------------

/**
 * `npm run typecheck`, exit 0. Node strips types rather than compiling them, so nothing else in
 * the pipeline ever looks at them: an un-run type check is the same as no types.
 */
export function runTypecheck(root: URL): { ok: boolean; output: string } {
  try {
    execFileSync("npm", ["run", "--silent", "typecheck"], {
      cwd: dirOf(root),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output: "" };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ""}\n${err.stderr ?? ""}`.trim() };
  }
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

/** The generated files, at the paths the build writes them to, relative to the repository root. */
export const GENERATED = {
  dark: "assets/session-dark.svg",
  light: "assets/session-light.svg",
  readme: "README.md",
  cache: "cache/activity.json",
};

export type GateStatus = "pass" | "fail" | "absent";
export type GateResult = {
  gate: string;
  status: GateStatus;
  /** One line of evidence that the gate looked at something, for a report a person skims. */
  detail: string;
  problems: string[];
};

const pass = (gate: string, detail: string): GateResult => ({ gate, status: "pass", detail, problems: [] });
const fail = (gate: string, detail: string, problems: string[]): GateResult => ({ gate, status: "fail", detail, problems });
const absent = (gate: string, missing: string[]): GateResult =>
  ({ gate, status: "absent", detail: `not built yet: ${missing.join(", ")}`, problems: [] });

const verdict = (gate: string, detail: string, problems: string[]): GateResult =>
  problems.length === 0 ? pass(gate, detail) : fail(gate, detail, problems);

export function runGates(root: URL, o: { typecheck?: boolean } = {}): GateResult[] {
  const dir = dirOf(root);
  const abs = (rel: string): string => join(dir, rel);
  const there = (rel: string): boolean => existsSync(abs(rel));
  const read = (rel: string): string => readFileSync(abs(rel), "utf8");
  const results: GateResult[] = [];

  // --- the tree, which is always there to scan -----------------------------------------------
  const files = listFiles(root);
  if (CONFIGURED_FORBIDDEN_NAMES.length === 0) {
    // ABSENT and not PASS. The committed half of the list is a public demonstration value, so a
    // tree scan for it would report this gate's own source and the three test files that exercise
    // it, and nothing about anybody's privacy. With no private names configured there is nothing
    // to look for, and "nothing was checked" must not read as "the tree is clean" (ADR 0001 says
    // this is enforced by a check rather than by discipline, which means the check has to exist).
    results.push({
      gate: "forbidden names",
      status: "absent",
      detail: "no private names configured: set PROFILE_FORBIDDEN_NAMES, locally and as a repository secret, so this gate has something to scan for",
      problems: [],
    });
  } else {
    const hits = scanTreeForForbiddenNames(root, CONFIGURED_FORBIDDEN_NAMES);
    results.push(verdict(
      "forbidden names",
      `${files.length} files scanned for ${CONFIGURED_FORBIDDEN_NAMES.length} configured name(s)`,
      hits.map((h) => `${h} carries a forbidden name (ADR 0001)`),
    ));
  }
  results.push(verdict("secrets", `${files.length} files scanned`, scanTreeForSecrets(root)));

  // --- the committed half of the name list, over the published surfaces only -----------------
  // It cannot be scanned for tree-wide (it lives in the tree by design) but it can still be
  // wrong where it counts: the demonstration name reaching `content.json`, the README or an
  // asset means a placeholder was published as though it were the owner's copy.
  const visible = [GENERATED.dark, GENERATED.light, GENERATED.readme, "content.json"].filter(there);
  const placeholders = visible.flatMap((rel) => {
    const found = countNamesIn(read(rel), COMMITTED_FORBIDDEN_NAMES);
    return found === 0 ? [] : [`${rel} carries ${found} of the committed placeholder name(s), so a placeholder reached a published surface`];
  });
  results.push(visible.length === 0
    ? absent("placeholder names", [GENERATED.readme, "content.json"])
    : verdict("placeholder names", visible.join(", "), placeholders));

  // --- content.json, the one visible surface that exists before a build ----------------------
  if (there("content.json")) {
    results.push(verdict("dashes in content.json", "content.json", findDashes(read("content.json")).map((d) => `content.json ${d}`)));
  } else {
    results.push(absent("dashes in content.json", ["content.json"]));
  }

  // --- the generated output ------------------------------------------------------------------
  const svgPaths = [GENERATED.dark, GENERATED.light];
  const missingSvgs = svgPaths.filter((p) => !there(p));
  if (missingSvgs.length > 0) {
    for (const gate of ["dashes in the assets", "control characters", "glyphs", "reduced motion", "svg structure", "size budget"]) {
      results.push(absent(gate, missingSvgs));
    }
  } else {
    const svgs = svgPaths.map((p) => [p, read(p)] as [string, string]);
    const over = (f: (svg: string) => string[]): string[] =>
      svgs.flatMap(([p, svg]) => f(svg).map((m) => `${p} ${m}`));

    results.push(verdict("dashes in the assets", svgPaths.join(", "), over(findDashes)));
    results.push(verdict("control characters", [...svgPaths, GENERATED.readme].join(", "), [
      ...over(findControlCharacters),
      ...(there(GENERATED.readme) ? findControlCharacters(read(GENERATED.readme)).map((m) => `${GENERATED.readme} ${m}`) : []),
    ]));
    // The README is generated output too, and its transcript is drawn from the same rows, so a
    // glyph the font cannot draw lands there as the same blank box. The build would not get that
    // far (`assertCovered` refuses it), which is exactly why this reads the artifact on disk: the
    // gate's job is the file that shipped, not the run that wrote it.
    results.push(verdict(
      "glyphs",
      `${FORBIDDEN_GLYPHS.length} absent glyphs looked for in ${[...svgPaths, GENERATED.readme].join(", ")}`,
      [
        ...over(findAbsentGlyphs),
        ...(there(GENERATED.readme) ? findAbsentGlyphs(read(GENERATED.readme)).map((m) => `${GENERATED.readme} ${m}`) : []),
      ],
    ));
    results.push(verdict("reduced motion", svgPaths.join(", "), over(findReducedMotionFaults)));

    const external = externalSvgCheck(svgPaths.map(abs));
    const counts = svgs.map(([p, svg]) => {
      const c = svgReferenceCounts(svg);
      return `${p}: ${c.ids} ids, ${c.refs} internal refs`;
    });
    results.push(verdict(
      "svg structure",
      `${counts.join("; ")}${external.ran ? "; svg-foundry check_svg.py agrees" : "; check_svg.py not installed here, native checks only"}`,
      [...over(checkSvgStructure), ...external.problems],
    ));

    results.push(verdict(
      "size budget",
      svgs.map(([p, svg]) => `${p}: ${Buffer.byteLength(svg, "utf8")} bytes`).join("; "),
      over(findSizeFaults),
    ));
  }

  // --- the README ----------------------------------------------------------------------------
  if (!there(GENERATED.readme)) {
    results.push(absent("readme", [GENERATED.readme]));
    results.push(absent("dashes in the readme", [GENERATED.readme]));
  } else {
    const readme = read(GENERATED.readme);
    results.push(verdict("readme", GENERATED.readme, findReadmeFaults(readme, (src) => there(src))));
    results.push(verdict("dashes in the readme", GENERATED.readme, findDashes(readme).map((d) => `${GENERATED.readme} ${d}`)));
  }

  // --- the cache, which is generated output too and has to be committed ----------------------
  if (!there(GENERATED.cache)) {
    results.push(absent("activity cache", [GENERATED.cache]));
  } else {
    const problems: string[] = [];
    try {
      const file = JSON.parse(read(GENERATED.cache)) as { fetchedAt?: unknown; activity?: { calendar?: unknown } };
      if (typeof file.fetchedAt !== "string" || !Number.isFinite(Date.parse(file.fetchedAt))) {
        problems.push("carries no fetchedAt timestamp, so the age of the figures would read as zero");
      }
      if (!Array.isArray(file.activity?.calendar) || file.activity.calendar.length === 0) {
        problems.push("carries no contribution calendar, so the Scan Sweep has nothing real to draw");
      }
    } catch (e) {
      problems.push(`is not valid JSON (${(e as Error).message})`);
    }
    results.push(verdict("activity cache", GENERATED.cache, problems.map((p) => `${GENERATED.cache} ${p}`)));
  }

  // --- the type check ------------------------------------------------------------------------
  if (o.typecheck === false) {
    // Left out on purpose by the caller; not reported, so nothing reads as checked that was not.
  } else if (!there("package.json")) {
    results.push(absent("typecheck", ["package.json"]));
  } else {
    const tsc = runTypecheck(root);
    results.push(tsc.ok ? pass("typecheck", "npm run typecheck exited 0") : fail("typecheck", "npm run typecheck", [tsc.output]));
  }

  return results;
}

/** 0 every gate ran and passed, 1 something is wrong, 3 something has not been built yet. */
export function exitCodeFor(results: GateResult[]): number {
  if (results.some((r) => r.status === "fail")) return 1;
  if (results.some((r) => r.status === "absent")) return 3;
  return 0;
}

export function report(results: GateResult[]): string {
  const width = Math.max(...results.map((r) => r.gate.length));
  const lines = results.map((r) => {
    const head = `  ${r.status.toUpperCase().padEnd(6)} ${r.gate.padEnd(width)}  ${r.detail}`;
    return [head, ...r.problems.map((p) => `           ${p}`)].join("\n");
  });
  const code = exitCodeFor(results);
  const tail = code === 1
    ? "\nGATES FAILED. Each line above says what is wrong and in which file."
    : code === 3
      ? "\nNOT BUILT YET. Nothing above is wrong; the gates marked ABSENT have nothing to read."
        + `\nRun \`npm run build\` with ${TOKEN_ENV} set to write them. Until the first authenticated`
        + "\nrefresh has run there is no cache and no asset, and the build fails rather than inventing"
        + "\na calendar (docs/spec.md 5.3)."
      : "\nall gates passed";
  return `${lines.join("\n")}\n${tail}`;
}

if (import.meta.main) {
  // No argument means this repository. An argument is resolved against the working directory,
  // which is where a person typing a relative path means, and not against this file's directory.
  const root = process.argv[2] === undefined
    ? new URL("../", import.meta.url)
    : pathToFileURL(`${resolve(process.argv[2])}/`);
  const results = runGates(root);
  const code = exitCodeFor(results);
  (code === 0 ? console.log : console.error)(report(results));
  process.exit(code);
}
