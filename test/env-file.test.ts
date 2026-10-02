import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOKEN_ENV } from "../src/activity.ts";
import { FORBIDDEN_NAMES_ENV } from "../src/content.ts";

// ---------------------------------------------------------------------------------------------
// `.env` has to be READ, not merely documented.
//
// This file exists because of a gap that had every appearance of being closed. `.env.example`
// documented the file, `.gitignore` excluded it, `docs/spec.md` 5.2 said the credential comes from
// it locally, and the gates' own message told the owner to set a variable there. Nothing loaded it:
// `npm run build` was `node src/build.ts` and `npm run gates` was `node scripts/gates.ts`, neither
// with an `--env-file` flag. A correctly written `.env` was read by nobody, and the gate went on
// reporting the name scan as unchecked while the owner had every reason to believe it was
// configured. The owner followed those instructions and nothing happened.
//
// That is the worst shape a gap can take: the instructions, the example file and the ignore rule
// all agree with each other, and the mechanism they describe does not exist. Agreement between
// documents is not evidence; only running the real command is.
//
// So every assertion below reads the REAL script out of `package.json` and runs the REAL flag in a
// real subprocess. Nothing here constructs a command line of its own, because the entire failure
// was that the command actually shipped differed from the command documented.
// ---------------------------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

/** The scripts that must see `.env`: the two that read the credential and the name list. */
const NEED_ENV = ["build", "gates"];

/** The env-file flag as that script really spells it, or null if it carries none. */
function envFlagOf(script: string): string | null {
  const m = /--env-file(?:-if-exists)?=\S+/.exec(scripts[script] ?? "");
  return m === null ? null : m[0];
}

/**
 * Runs `node <flag> probe.mjs` with `cwd` as the working directory.
 *
 * The probe imports the project's OWN constants and prints what `process.env` holds for them, so
 * what is proven is that the variable the generator actually reads is the variable `.env` delivers,
 * rather than that some string arrived somewhere. It also prints CONFIGURED_FORBIDDEN_NAMES, which
 * `src/content.ts` computes once at module load, so the whole chain from the file to the value the
 * gate uses is covered in one go.
 */
function probe(flag: string | null, cwd: string): { status: number; out: string } {
  const probePath = join(cwd, "probe.mjs");
  writeFileSync(probePath, [
    `import { TOKEN_ENV } from ${JSON.stringify(join(ROOT, "src/activity.ts"))};`,
    `import { FORBIDDEN_NAMES_ENV, CONFIGURED_FORBIDDEN_NAMES } from ${JSON.stringify(join(ROOT, "src/content.ts"))};`,
    "console.log(JSON.stringify({",
    "  token: process.env[TOKEN_ENV] ?? null,",
    "  names: process.env[FORBIDDEN_NAMES_ENV] ?? null,",
    "  configured: CONFIGURED_FORBIDDEN_NAMES,",
    "}));",
  ].join("\n"));
  try {
    const out = execFileSync("node", [...(flag === null ? [] : [flag]), "probe.mjs"], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      // A value inherited from the developer's own shell would make this pass for the wrong
      // reason, so the child starts with neither variable set and must get them from the file.
      env: { ...process.env, [TOKEN_ENV]: undefined, [FORBIDDEN_NAMES_ENV]: undefined } as NodeJS.ProcessEnv,
    });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const withEnvFile = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "env-file-"));
  writeFileSync(join(dir, ".env"), body);
  return dir;
};

test("the scripts that need .env say so in package.json, not only in the documentation", () => {
  for (const name of NEED_ENV) {
    assert.ok(scripts[name] !== undefined, `there is no ${name} script`);
    assert.notEqual(
      envFlagOf(name),
      null,
      `npm run ${name} does not load .env, so a correctly written one is read by nobody: ${scripts[name]}`,
    );
    assert.match(envFlagOf(name)!, /=\.env$/, `npm run ${name} loads the wrong file`);
  }
});

test("the flag is the if-exists form, so a machine with no .env still runs", () => {
  // `--env-file=.env` exits with "not found" when the file is absent, which is every CI run (the
  // values come from secrets there) and every fresh clone. The plain form passes on any developer
  // machine that happens to have a `.env` and fails only where nobody is watching it fail.
  for (const name of NEED_ENV) {
    assert.match(
      envFlagOf(name)!,
      /^--env-file-if-exists=/,
      `npm run ${name} uses the strict form, which fails outright when there is no .env: ${scripts[name]}`,
    );
  }
});

test("a .env really reaches the variables the generator reads", () => {
  const dir = withEnvFile(`${TOKEN_ENV}=env-file-delivered-this-value\n${FORBIDDEN_NAMES_ENV}=Ada Lovelace,Grace Hopper\n`);
  const run = probe(envFlagOf("gates"), dir);
  assert.equal(run.status, 0, run.out);
  const got = JSON.parse(run.out) as { token: string | null; names: string | null; configured: string[] };
  assert.equal(got.token, "env-file-delivered-this-value", "the credential does not arrive from .env");
  assert.equal(got.names, "Ada Lovelace,Grace Hopper");
  // The whole chain, not just the raw variable: this is the value the forbidden-name gate scans by.
  assert.deepEqual(got.configured, ["Ada Lovelace", "Grace Hopper"]);
});

test("without the flag nothing arrives, which is what the gap looked like", () => {
  // The control. If this passed, the test above would be proving nothing about the flag.
  const dir = withEnvFile(`${TOKEN_ENV}=env-file-delivered-this-value\n${FORBIDDEN_NAMES_ENV}=Ada Lovelace\n`);
  const run = probe(null, dir);
  assert.equal(run.status, 0, run.out);
  const got = JSON.parse(run.out) as { token: string | null; names: string | null; configured: string[] };
  assert.equal(got.token, null);
  assert.equal(got.names, null);
  assert.deepEqual(got.configured, []);
});

test("a missing .env is not an error, because CI has none", () => {
  const dir = mkdtempSync(join(tmpdir(), "env-file-none-"));
  const run = probe(envFlagOf("gates"), dir);
  assert.equal(run.status, 0, `a run with no .env failed, which breaks CI and every fresh clone: ${run.out}`);
  const got = JSON.parse(run.out.slice(run.out.indexOf("{"))) as { configured: string[] };
  assert.deepEqual(got.configured, [], "nothing should be configured when there is no file to configure from");
});

test("the test suite is deliberately NOT given .env, so a local file cannot change a result", () => {
  // Hermetic on purpose: a suite whose outcome depended on the developer's own `.env` would pass
  // on their machine and nowhere else. The gates take the name list as a parameter precisely so
  // both halves of that fork can be driven without an environment.
  assert.equal(envFlagOf("test"), null, "npm test loads .env, so its results depend on the machine it runs on");
});
