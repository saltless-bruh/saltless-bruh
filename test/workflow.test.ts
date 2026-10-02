import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOKEN_ENV } from "../src/activity.ts";
import { FORBIDDEN_NAMES_ENV } from "../src/content.ts";
import { GENERATED } from "../scripts/gates.ts";

// ---------------------------------------------------------------------------------------------
// The refresh workflow, read as text rather than as parsed YAML.
//
// Three of the properties below are things an earlier draft of the workflow got wrong, and all
// three would have failed SILENTLY: the wrong token returns a thinner calendar rather than an
// error, a `git add` missing one path discards that file's changes every day without complaint,
// and an ungated publish looks exactly like a gated one until the day it is broken. None of them
// can be caught by reading the file once, because the file is correct today and the question is
// whether it is still correct in a month.
//
// The order of the steps is asserted and not just their presence. "Runs the gates" and "runs the
// gates before committing" are different properties, and only the second one is worth anything.
// ---------------------------------------------------------------------------------------------

const WORKFLOW = new URL("../.github/workflows/refresh.yml", import.meta.url);
const yml = readFileSync(WORKFLOW, "utf8");

/**
 * The file with its comments taken out.
 *
 * Every assertion about STRUCTURE reads this, because the comments explain the structure and
 * therefore quote it: the header says the words PROFILE_GH_TOKEN and GITHUB_TOKEN while
 * explaining which of the two does what, and a test that could not tell prose from a YAML key
 * would be a test that forbids the file from explaining itself.
 */
const code = yml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

/** The job's steps, in order, each as the block of text that belongs to it. */
function steps(): string[] {
  const at = code.indexOf("    steps:");
  assert.ok(at >= 0, "the workflow has no steps block");
  const out: string[] = [];
  for (const line of code.slice(at).split("\n").slice(1)) {
    if (/^ {6}- /.test(line)) out.push(line);
    else if (out.length > 0) out[out.length - 1] += `\n${line}`;
  }
  assert.ok(out.length >= 5, `only ${out.length} steps were found, so the parse is wrong`);
  return out;
}

const STEPS = steps();
const at = (needle: string | RegExp): number =>
  STEPS.findIndex((s) => (typeof needle === "string" ? s.includes(needle) : needle.test(s)));

const stepsWith = (needle: string): number[] =>
  STEPS.map((s, i) => (s.includes(needle) ? i : -1)).filter((i) => i >= 0);

// ---------------------------------------------------------------------------------------------
// 1. The token
// ---------------------------------------------------------------------------------------------

test("the fetch reads PROFILE_GH_TOKEN from a repository secret", () => {
  assert.match(code, new RegExp(`${TOKEN_ENV}: \\$\\{\\{ secrets\\.${TOKEN_ENV} \\}\\}`));
  assert.ok(at(`${TOKEN_ENV}: \${{ secrets.${TOKEN_ENV} }}`) >= 0, "no step is given the token");
});

test("the built-in GITHUB_TOKEN is never used as the fetch credential", () => {
  // It cannot reliably read contributionsCollection and it never counts private contributions,
  // so a run using it publishes a thinner calendar as though it were the year (docs/spec.md 5.2).
  assert.ok(!code.includes("secrets.GITHUB_TOKEN"), "the workflow reaches for the built-in token");
  assert.ok(!new RegExp(`${TOKEN_ENV}:\\s*\\$\\{\\{\\s*(?:secrets\\.)?GITHUB_TOKEN`).test(code), "the built-in token is being passed as the fetch credential");
  assert.ok(!/GITHUB_TOKEN:/.test(code), "GITHUB_TOKEN is being set as an environment variable for some step");
});

test("the token is bound to the steps that need it and to no others", () => {
  // A job-level or workflow-level env would put the credential in every step's environment, where
  // any command that dumps its environment, or any future step, prints it into a public log.
  const beforeSteps = code.slice(0, code.indexOf("    steps:"));
  assert.ok(!beforeSteps.includes(TOKEN_ENV), "the token is declared above the step level, so every step carries it");
  const carrying = stepsWith(`${TOKEN_ENV}:`);
  assert.deepEqual(carrying, [at("Check this repository is configured"), at("npm run build")]);
  assert.ok(!STEPS[at("npm run gates")].includes(TOKEN_ENV), "the gates are handed a credential they do not read");
  assert.ok(!STEPS[at("git commit")].includes(TOKEN_ENV), "the commit step is handed the credential");
});

test("nothing in the workflow can print the token", () => {
  // The property is that no command EXPANDS the variable into its output. An earlier version of
  // this test also demanded the surrounding prose match a fixed list of phrasings, which is a test
  // dictating documentation wording: it had to be edited to let the message be corrected, which is
  // the sort of guard people eventually delete. What is pinned is the expansion and `set -x`,
  // which would trace the expanded value of every command in the step.
  assert.ok(!/set\s+-[a-z]*x/.test(code), "a step turns on shell tracing, which prints expanded values");
  for (const line of code.split("\n")) {
    if (!/\becho\b/.test(line)) continue;
    assert.ok(
      !line.includes(`\${${TOKEN_ENV}}`) && !line.includes(`$${TOKEN_ENV}`),
      `this line expands the credential into a log: ${line.trim()}`,
    );
  }
  // The only thing done with the value anywhere is testing it for emptiness.
  const uses = code.split("\n").filter((l) => l.includes(`${TOKEN_ENV}}`) || l.includes(`$${TOKEN_ENV}`));
  for (const line of uses) {
    assert.match(line, /-z "\$\{/, `the credential is used for something other than an emptiness test: ${line.trim()}`);
  }
});

test("the workflow does not send anyone to mint a scope the API does not need", () => {
  // Measured 2026-10-02 (docs/spec.md 5.2): a token scoped `gist, read:org, repo, workflow`, with
  // no `read:user`, returned the whole contribution calendar. The preflight message is read at the
  // moment somebody decides which credential to create, and demanding `read:user` there is what
  // held up the first real build of this project.
  assert.match(code, /repo scope is enough/, "the message does not name the scope that is actually enough");
  assert.doesNotMatch(code, /with the read:user scope/, "the message demands a scope the API does not require");
  assert.doesNotMatch(code, /needs? the read:user/, "the message demands a scope the API does not require");
  // The claim about the built-in token is a different claim and was never measured, so it must not
  // be stated as though it had been.
  assert.match(code, /unverified/, "the GITHUB_TOKEN claim is presented as established when it is not");
});

test("only the token is required, because without it there is nothing to build", () => {
  // ADR 0001, amended 2026-10-02: the owner chose not to configure a private name list, so the
  // daily refresh must run without it. The token is a different case: the build fails rather than
  // inventing a calendar, so a run without it has nothing to publish.
  const preflight = STEPS[at("Check this repository is configured")];
  const required = [...preflight.matchAll(/if \[ -z "\$\{(\w+)\}" \]; then\n((?:.*\n)*?)\s*fi/g)]
    .filter(([, , body]) => /exit 1/.test(body))
    .map(([, name]) => name);
  assert.deepEqual(required, [TOKEN_ENV], `the preflight stops the run for ${required.join(", ")}`);
  // The optional one is still mentioned, so a reader of the log knows the scan is off and why.
  assert.ok(preflight.includes(FORBIDDEN_NAMES_ENV), "the log says nothing about the scan being off");
  assert.match(preflight, /not a fault/, "an unset optional secret reads as a problem");
});

test("the optional secret is still passed through, so setting it later turns the scan on", () => {
  // Opt-out, not removal: nothing about the workflow should need editing to re-arm the gate.
  for (const step of ["npm run build", "npm run gates"]) {
    assert.ok(
      STEPS[at(step)].includes(`${FORBIDDEN_NAMES_ENV}: \${{ secrets.${FORBIDDEN_NAMES_ENV} }}`),
      `${step} does not receive ${FORBIDDEN_NAMES_ENV}, so setting the secret would change nothing`,
    );
  }
});

test("the workflow configures the variable the generator actually reads", () => {
  // A secret passed under a name nothing reads is a gate quietly running unconfigured.
  assert.ok(code.includes(`${FORBIDDEN_NAMES_ENV}: \${{ secrets.${FORBIDDEN_NAMES_ENV} }}`), `the workflow does not pass ${FORBIDDEN_NAMES_ENV}`);
  assert.ok(code.includes(`${TOKEN_ENV}: \${{ secrets.${TOKEN_ENV} }}`), `the workflow does not pass ${TOKEN_ENV}`);
});

// ---------------------------------------------------------------------------------------------
// 2. The three outputs, committed together
// ---------------------------------------------------------------------------------------------

test("the commit carries the assets, the cache and the README together", () => {
  // Leaving the cache out would fetch real figures, publish them and throw the cache away every
  // day, with nothing failing and the symptom being a cache that never updates.
  const commit = STEPS[at("git commit")];
  const add = /git add (.*)/.exec(commit);
  assert.ok(add !== null, "the commit step does not add anything");
  for (const path of ["assets", "cache", GENERATED.readme]) {
    assert.ok(add[1].includes(path), `git add leaves out ${path}, so its changes are discarded every run`);
  }
});

test("the change guard and the commit look at the same three paths", () => {
  // A guard watching fewer paths than the commit adds would skip a run in which only the
  // unwatched one changed, which is the cache, every day.
  const commit = STEPS[at("git commit")];
  const guard = /git status --porcelain (.*)\)/.exec(commit);
  assert.ok(guard !== null, "there is no change guard, so the job commits on every run");
  const add = /git add (.*)/.exec(commit)![1];
  for (const path of ["assets", "cache", GENERATED.readme]) {
    assert.ok(guard[1].includes(path), `the guard does not watch ${path}`);
  }
  assert.deepEqual(
    guard[1].replace(/^-- /, "").trim().split(/\s+/).sort(),
    add.replace(/^-- /, "").trim().split(/\s+/).sort(),
  );
});

test("nothing is committed when nothing changed", () => {
  const commit = STEPS[at("git commit")];
  assert.match(commit, /if \[ -z "\$\(git status --porcelain/, "the guard does not test for an empty status");
  assert.match(commit, /exit 0/, "the guard does not leave the step successfully when there is nothing to do");
  assert.ok(
    commit.indexOf("git status --porcelain") < commit.indexOf("git add"),
    "the guard runs after the add, by which point everything is staged and it can never be empty",
  );
});

// ---------------------------------------------------------------------------------------------
// 3. The gates, before the publish
// ---------------------------------------------------------------------------------------------

test("the gates run, and they run before anything is committed", () => {
  assert.ok(at("npm run gates") >= 0, "the workflow never runs the gates");
  assert.ok(
    at("npm run gates") < at("git commit"),
    "the gates run after the commit, which publishes first and checks afterwards",
  );
  assert.ok(at("npm run build") < at("npm run gates"), "the gates run before the build, so they read the previous day's output");
});

test("the suite runs before the build, and the build before the gates", () => {
  assert.ok(at("npm ci") < at("npm test"), "the suite runs before its dependencies are installed");
  assert.ok(at("npm test") < at("npm run build"), "a broken generator publishes before its tests are run");
});

// ---------------------------------------------------------------------------------------------
// Permissions, triggers and the rest
// ---------------------------------------------------------------------------------------------

test("the workflow asks for the least permission that lets it push", () => {
  const block = /\npermissions:\n((?:  .*\n)+)/.exec(code);
  assert.ok(block !== null, "there is no permissions block, so the job gets the repository default");
  assert.deepEqual(block[1].trim().split("\n").map((l) => l.trim()), ["contents: write"]);
  assert.ok(!/permissions:\s*write-all/.test(code));
});

test("it runs daily and on demand", () => {
  assert.match(code, /schedule:\n\s+- cron: "(\d+) (\d+) \* \* \*"/, "there is no daily cron");
  assert.match(code, /\n {2}workflow_dispatch:/, "there is no manual trigger, so the first run has to wait for the cron");
  const cron = /- cron: "(\d+) (\d+) \* \* \*"/.exec(code)!;
  assert.notEqual(cron[1], "0", "a cron on the hour is queued behind every other scheduled workflow on the platform");
});

test("a run that is committing is never cancelled part way through", () => {
  assert.match(code, /concurrency:/, "two refreshes can run at once and race to commit");
  assert.match(code, /cancel-in-progress: false/, "a refresh can be cancelled between its commit and its push");
});

test("both actions are pinned to a major version", () => {
  const uses = [...code.matchAll(/uses: ([\w-]+\/[\w-]+)@(\S+)/g)];
  assert.ok(uses.length >= 2, "the workflow uses fewer actions than expected");
  for (const [, action, ref] of uses) {
    assert.match(ref, /^v\d+$/, `${action} is pinned to ${ref}, which is not a major version tag`);
  }
});

test("the workflow carries no em-dash and no en-dash", () => {
  assert.ok(!yml.includes("\u2014") && !yml.includes("\u2013"), "the workflow carries a dash this project does not use");
});
