// Usage: npm run mutants            (or: node scripts/mutation-check.ts [mutants.json])
//
// Applies each committed mutant to the working tree, runs the tests meant to catch it, then restores
// the file. A mutant no test notices is reported as SURVIVED and the run exits non-zero.
//
// A MUTATED WORKING TREE LOOKS EXACTLY LIKE A BROKEN ONE
//
// That is the hazard this file is mostly about, and it has cost this project real time twice: a red
// suite was escalated as a defect when it was a live mutant mid-run, and on another occasion a crashed
// run left a mutant stranded in src/mascot.ts, where the next agent along correctly suspected it was
// someone's work in progress and left it alone. Nobody reading `git status` or a test summary can tell
// "mid-mutation" from "wrong", and the natural reaction to either, reverting the file or fixing the
// test, silently corrupts a run that is still going.
//
// So the guards below are about legibility and recovery as much as correctness:
//
//   1. NO STALE MARKER. A marker file left behind means a previous run died without restoring. The run
//      refuses to start, names the files, and prints the command that puts them back.
//   2. CLEAN. Every file a mutant touches must match HEAD before anything is applied. This harness
//      restores by taking HEAD's copy back, so an UNCOMMITTED change in one of those files would be
//      silently deleted by the first restore, and every mutant after it would measure a baseline that
//      never had the feature under test. The run then reports a confident "all killed" containing no
//      evidence at all. That has happened here. Commit the feature first, then measure it. Only the
//      files this harness will mutate are checked, so unrelated work elsewhere in the tree is none of
//      its business.
//   3. BASELINE GREEN. The tests named by the mutants must all pass before mutating. A red baseline
//      makes every mutant look killed, which is the same false confidence from the other direction.
//   4. MARKER WHILE RUNNING. For as long as a mutant is applied, MUTATION-IN-PROGRESS.json sits in the
//      repository root naming the mutant and the file. It is deliberately untracked and deliberately
//      loud: it shows up in `git status` and at the top of `ls`, so a red suite can be diagnosed in one
//      look instead of escalated. If you are reading this because a test is failing, look for that file
//      FIRST, and if it is there, do not revert anything: a run is in progress.
//   5. RESTORED, ON EVERY EXIT PATH IT CAN REACH. The file is compared byte for byte against the
//      snapshot taken before the mutant was applied, and the restore also runs from an exit hook, so a
//      thrown error cannot strand a mutant the way one already has. Signals are handled BETWEEN
//      mutants: the loop yields to the event loop each time round, because a signal handler is
//      JavaScript and cannot run while the process is blocked inside the synchronous child that runs
//      the tests. Measured here, that was not a small delay, it was never: the whole script used to be
//      one unbroken synchronous block, so a SIGINT sat queued until the run ended of its own accord.
//      A hard kill during a test run can still strand a mutant, and no process can promise otherwise
//      against SIGKILL. That is what the marker and guard 1 are for: recovery, not prevention.
//
// A mutant must also actually change the file: an anchor that no longer matches, or an edit that writes
// back what was already there, aborts rather than being counted either way.
//
// VERIFYING HEAD WHILE THIS MAY BE RUNNING: do not use the working tree. See docs/design-contract.md,
// "Verifying while another agent may be mutating" — check out HEAD into a throwaway worktree instead.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

/** A literal string swap, or pixels of an art grid. `from` is required so a drifted file fails loudly. */
export type Mutant = {
  id: string;
  file: string;
  tests: string[];
  find?: string;
  replace?: string;
  pixels?: { x: number; y: number; from: string; to: string }[];
};

const ROOT = new URL("..", import.meta.url);
const MARKER = "MUTATION-IN-PROGRESS.json";
const path = (file: string): string => new URL(file, ROOT).pathname;
const read = (file: string): string => readFileSync(path(file), "utf8");

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: ROOT.pathname, encoding: "utf8" });

/** The one mutant currently applied, if any. Everything that can end this process restores it. */
let inFlight: { id: string; file: string; before: string } | null = null;
let cleanedUp = false;

function writeMarker(mutant: { id: string; file: string } | null, mutantsFile: string): void {
  writeFileSync(path(MARKER), JSON.stringify({
    warning: "A MUTATION RUN IS IN PROGRESS. A failing test right now is probably the mutant below, not a defect. Do not revert or 'fix' anything while this file exists.",
    startedAt: new Date().toISOString(),
    pid: process.pid,
    mutants: mutantsFile,
    appliedMutant: mutant?.id ?? null,
    mutatedFiles: mutant ? [mutant.file] : [],
    restoreWith: mutant ? `git checkout -- ${mutant.file}` : null,
  }, null, 2) + "\n");
}

/** Puts back whatever is applied and clears the marker. Safe to call more than once. */
function cleanup(): void {
  if (cleanedUp) return;
  cleanedUp = true;
  if (inFlight !== null) {
    const { id, file, before } = inFlight;
    inFlight = null;
    try {
      git("checkout", "--", file);
      if (read(file) !== before) {
        console.error(`\nCOULD NOT RESTORE ${file} after ${id}. Put it back by hand before anything else runs.`);
      } else {
        console.error(`\nrestored ${file} after ${id}`);
      }
    } catch (e) {
      console.error(`\nCOULD NOT RESTORE ${file} after ${id}: ${String(e)}`);
    }
  }
  rmSync(path(MARKER), { force: true });
}

process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => { cleanup(); process.exit(130); });
}

/** Exit status of the named test files: ok when every test passes. */
function runTests(files: string[]): { ok: boolean; failures: string[] } {
  try {
    execFileSync("node", ["--test", ...files], { cwd: ROOT.pathname, encoding: "utf8", stdio: "pipe" });
    return { ok: true, failures: [] };
  } catch (e) {
    const out = String((e as { stdout?: string }).stdout ?? "");
    const seen: string[] = [];
    for (const line of out.replace(/\u001b\[[0-9;]*m/g, "").split("\n")) {
      if (!line.includes("✖") || line.includes("failing tests")) continue;
      const name = line.split("(")[0].replace("✖", "").trim();
      // node reports the FILE as a failure too, once per failing file; that is not a test name.
      if (name && !name.endsWith(".test.ts") && !seen.includes(name)) seen.push(name);
    }
    return { ok: false, failures: seen };
  }
}

/** The mutated text, or a thrown error if the mutant cannot be applied exactly once. */
function mutate(m: Mutant, src: string): string {
  if (m.pixels) {
    const rows = src.replace(/\n$/, "").split("\n");
    for (const { x, y, from, to } of m.pixels) {
      const row = rows[y];
      if (row === undefined) throw new Error(`${m.id}: ${m.file} has no row ${y}`);
      if (row[x] !== from) throw new Error(`${m.id}: ${m.file} x${x} row ${y} is ${JSON.stringify(row[x])}, not the ${JSON.stringify(from)} this mutant was written against`);
      if (from === to) throw new Error(`${m.id}: the edit at x${x} row ${y} writes back what was already there`);
      rows[y] = row.slice(0, x) + to + row.slice(x + 1);
    }
    return rows.join("\n") + "\n";
  }
  if (m.find === undefined || m.replace === undefined) throw new Error(`${m.id}: needs either find/replace or pixels`);
  const hits = src.split(m.find).length - 1;
  if (hits !== 1) throw new Error(`${m.id}: its anchor matches ${hits} times in ${m.file}, so the edit is not exact`);
  return src.replace(m.find, m.replace);
}

const mutantsFile = process.argv[2] ?? "scripts/mutants.json";

// Guard 1: no stale marker.
if (existsSync(path(MARKER))) {
  const stale = JSON.parse(read(MARKER)) as { appliedMutant: string | null; mutatedFiles: string[]; restoreWith: string | null; startedAt: string };
  console.error(`REFUSING TO RUN. ${MARKER} is still here, so a previous run died without putting its mutant back.`);
  console.error(`  started:  ${stale.startedAt}`);
  console.error(`  mutant:   ${stale.appliedMutant ?? "(none applied when it died)"}`);
  for (const f of stale.mutatedFiles) console.error(`  mutated:  ${f}`);
  console.error(stale.restoreWith ? `\nRestore it, then delete the marker:\n  ${stale.restoreWith}\n  rm ${MARKER}` : `\nNothing was mutated. Just delete the marker:\n  rm ${MARKER}`);
  process.exit(2);
}

const mutants = JSON.parse(read(mutantsFile)) as Mutant[];
if (mutants.length === 0) throw new Error(`${mutantsFile} defines no mutants, so the run would prove nothing`);

// Guard 2: clean.
const touched = [...new Set(mutants.map((m) => m.file))].sort();
const dirty = touched.filter((f) => git("status", "--porcelain", "--", f).trim() !== "");
if (dirty.length > 0) {
  console.error("REFUSING TO RUN. These files have uncommitted changes, and this harness restores with");
  console.error("`git checkout --`, which would throw them away and leave every mutant measuring a baseline");
  console.error("that never had the feature in it. Commit first, then measure:");
  for (const f of dirty) console.error(`  ${f}`);
  process.exit(2);
}

// Guard 3: baseline green.
const allTests = [...new Set(mutants.flatMap((m) => m.tests))].sort();
process.stdout.write(`baseline: ${allTests.length} test file(s) ... `);
const baseline = runTests(allTests);
if (!baseline.ok) {
  console.error("RED. A failing baseline makes every mutant look killed. Fix these first:");
  for (const f of baseline.failures) console.error(`  ${f}`);
  process.exit(2);
}
console.log("green");

// Guard 4: the marker is up for the whole run, naming whatever is applied right now.
writeMarker(null, mutantsFile);

const survived: string[] = [];
for (const m of mutants) {
  // Let the event loop turn, so a SIGINT or SIGTERM that arrived during the last mutant's tests has its
  // handler run HERE, with nothing applied, instead of sitting queued until the whole run finishes.
  await new Promise((resolve) => { setImmediate(resolve); });
  const before = read(m.file);
  const after = mutate(m, before);
  if (after === before) throw new Error(`${m.id}: applying it changed nothing`);
  inFlight = { id: m.id, file: m.file, before };
  writeMarker(m, mutantsFile);
  writeFileSync(path(m.file), after);

  const result = runTests(m.tests);

  git("checkout", "--", m.file);
  inFlight = null;
  writeMarker(null, mutantsFile);
  // Guard 5: restored.
  if (read(m.file) !== before) throw new Error(`${m.id}: ${m.file} did not come back as it was; stopping before the next mutant inherits it`);

  if (result.ok) {
    survived.push(m.id);
    console.log(`SURVIVED  ${m.id}`);
  } else {
    console.log(`KILLED    ${m.id}  [${result.failures.length} test(s)]`);
    for (const name of result.failures.slice(0, 2)) console.log(`           by: ${name}`);
  }
}

rmSync(path(MARKER), { force: true });
cleanedUp = true;

console.log(`\n${mutants.length - survived.length}/${mutants.length} killed`);
if (survived.length > 0) {
  console.error(`SURVIVED: ${survived.join(", ")}`);
  process.exit(1);
}
