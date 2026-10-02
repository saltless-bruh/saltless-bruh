// test/activity.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspect } from "node:util";

/**
 * Everything a thrown value would show a person who printed it: the message, the stack, the
 * cause chain and any property hung off it. A leak check that reads only `message` misses a
 * credential riding along as a `cause`, which is exactly how one escapes in practice.
 */
const everythingIn = (e: unknown): string => inspect(e, { depth: 10 });
import { ACTIVITY_QUERY, CACHE_PATH, fetchActivity, githubTransport, loadActivity, MAX_LANGUAGES, TOKEN_ENV, trimToWindow, WINDOW_DAYS } from "../src/activity.ts";
import type { Transport } from "../src/activity.ts";
import { languageShares } from "../src/session.ts";
import type { Activity } from "../src/session.ts";
import { FORBIDDEN_NAMES } from "../src/content.ts";

const DAY_MS = 86_400_000;
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** `n` consecutive days ending on `endIso`, oldest first. */
function daysEnding(endIso: string, n: number, count: (i: number) => number = () => 1): { date: string; count: number }[] {
  const end = Date.parse(`${endIso}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => ({
    date: isoDay(end - (n - 1 - i) * DAY_MS),
    count: count(i),
  }));
}

test("the window keeps the last 365 days and drops what is older", () => {
  const kept = trimToWindow(daysEnding("2026-10-02", 371), "2026-10-02");
  assert.equal(kept.length, WINDOW_DAYS);
  assert.equal(kept[0].date, "2025-10-03");
  assert.equal(kept.at(-1)?.date, "2026-10-02");
});

test("the window drops days that have not happened yet", () => {
  // GitHub returns whole weeks, so the newest week can reach past today.
  const days = [...daysEnding("2026-10-02", 10), { date: "2026-10-03", count: 9 }];
  const kept = trimToWindow(days, "2026-10-02");
  assert.equal(kept.at(-1)?.date, "2026-10-02");
  assert.ok(!kept.some((d) => d.date === "2026-10-03"), "kept a day that has not happened yet");
});

test("a calendar shorter than the window is kept whole rather than padded", () => {
  assert.equal(trimToWindow(daysEnding("2026-10-02", 30), "2026-10-02").length, 30);
});

test("the window comes back oldest first whatever order it arrived in", () => {
  const scrambled = daysEnding("2026-10-02", 5).reverse();
  assert.deepEqual(
    trimToWindow(scrambled, "2026-10-02").map((d) => d.date),
    daysEnding("2026-10-02", 5).map((d) => d.date),
  );
});

test("a day whose date is not an ISO day fails loudly instead of being dropped", () => {
  assert.throws(() => trimToWindow([{ date: "d0", count: 1 }], "2026-10-02"), /d0/);
});

// ---------------------------------------------------------------------------
// Fixture transport. Nothing in this file touches the network: every test hands
// fetchActivity a transport over a canned response body.
// ---------------------------------------------------------------------------

type RepoFixture = { name: string; description?: string; languages: { name: string; size: number }[] };
type PageFixture = {
  days?: { date: string; count: number }[];
  /** What the API claims the calendar totals. Defaults to the honest sum of `days`. */
  total?: number;
  repos?: RepoFixture[];
  hasNextPage?: boolean;
  endCursor?: string | null;
};

const today = isoDay(Date.now());

function weeksOf(days: { date: string; count: number }[]): { contributionDays: { date: string; contributionCount: number }[] }[] {
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push({ contributionDays: days.slice(i, i + 7).map((d) => ({ date: d.date, contributionCount: d.count })) });
  }
  return weeks;
}

function pageBody(page: PageFixture, withCalendar: boolean): string {
  const days = page.days ?? [];
  const user: Record<string, unknown> = {
    repositories: {
      pageInfo: { hasNextPage: page.hasNextPage ?? false, endCursor: page.endCursor ?? null },
      nodes: (page.repos ?? []).map((r) => ({
        name: r.name,
        ...(r.description === undefined ? {} : { description: r.description }),
        languages: { edges: r.languages.map((l) => ({ size: l.size, node: { name: l.name } })) },
      })),
    },
  };
  if (withCalendar) {
    user.contributionsCollection = {
      contributionCalendar: {
        totalContributions: page.total ?? days.reduce((s, d) => s + d.count, 0),
        weeks: weeksOf(days),
      },
    };
  }
  return JSON.stringify({ data: { user } });
}

/** A transport over fixture pages that records every request it was handed. */
function transportOf(pages: PageFixture[]): { transport: Transport; sent: { query: string; variables: Record<string, unknown> }[] } {
  const sent: { query: string; variables: Record<string, unknown> }[] = [];
  let i = 0;
  const transport: Transport = async (request) => {
    sent.push(request);
    const page = pages[Math.min(i, pages.length - 1)];
    i += 1;
    return pageBody(page, request.variables.withCalendar === true);
  };
  return { transport, sent };
}

const onePage = (repos: RepoFixture[], days = daysEnding(today, 7)): Transport => transportOf([{ days, repos }]).transport;

test("the figures it reports cover the 365 day window, not the whole 53 weeks", async () => {
  // 371 days arrive; the six oldest fall outside the window the activity line claims.
  const days = daysEnding(today, 371, (i) => (i < 6 ? 5 : i % 2));
  const inWindow = days.slice(6);
  const a = await fetchActivity({ login: "x", transport: transportOf([{ days, repos: [] }]).transport });
  assert.equal(a.calendar.length, WINDOW_DAYS);
  assert.equal(a.totalContributions, inWindow.reduce((s, d) => s + d.count, 0));
  assert.equal(a.activeDays, inWindow.filter((d) => d.count > 0).length);
});

test("language bytes are summed across every repository and ordered largest first", async () => {
  const a = await fetchActivity({ login: "x", transport: onePage([
    { name: "one", languages: [{ name: "Python", size: 100 }, { name: "Rust", size: 400 }] },
    { name: "two", languages: [{ name: "Python", size: 350 }] },
  ]) });
  assert.deepEqual(a.languages, [{ name: "Python", bytes: 450 }, { name: "Rust", bytes: 400 }]);
});

test("only the repositories the content names are counted, when it names any", async () => {
  const a = await fetchActivity({ login: "x", repoNames: ["KEPT"], transport: onePage([
    { name: "kept", languages: [{ name: "Python", size: 10 }] },
    { name: "skipped", languages: [{ name: "Rust", size: 999 }] },
  ]) });
  assert.deepEqual(a.languages, [{ name: "Python", bytes: 10 }]);
});

test("with no repository names given every repository counts", async () => {
  const a = await fetchActivity({ login: "x", transport: onePage([
    { name: "kept", languages: [{ name: "Python", size: 10 }] },
    { name: "other", languages: [{ name: "Rust", size: 999 }] },
  ]) });
  assert.deepEqual(a.languages.map((l) => l.name), ["Rust", "Python"]);
});

test("it keeps only as many languages as the stack rows print", async () => {
  const languages = Array.from({ length: MAX_LANGUAGES + 3 }, (_, i) => ({ name: `L${i}`, size: 100 - i }));
  const a = await fetchActivity({ login: "x", transport: onePage([{ name: "one", languages }]) });
  assert.equal(a.languages.length, MAX_LANGUAGES);
  assert.equal(a.languages[0].name, "L0");
});

test("it follows the repository cursor until the pages run out", async () => {
  const { transport, sent } = transportOf([
    { days: daysEnding(today, 7), repos: [{ name: "a", languages: [{ name: "Python", size: 1 }] }], hasNextPage: true, endCursor: "c1" },
    { repos: [{ name: "b", languages: [{ name: "Python", size: 2 }] }] },
  ]);
  const a = await fetchActivity({ login: "x", transport });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].variables.cursor, "c1");
  assert.deepEqual(a.languages, [{ name: "Python", bytes: 3 }]);
});

test("the calendar is asked for once however many repository pages there are", async () => {
  const { transport, sent } = transportOf([
    { days: daysEnding(today, 7), repos: [], hasNextPage: true, endCursor: "c1" },
    { repos: [] },
  ]);
  await fetchActivity({ login: "x", transport });
  assert.equal(sent.filter((s) => s.variables.withCalendar === true).length, 1);
});

test("a calendar that does not add up to its own total is refused", async () => {
  const transport = transportOf([{ days: daysEnding(today, 7, () => 1), total: 99, repos: [] }]).transport;
  await assert.rejects(() => fetchActivity({ login: "x", transport }), /adds up to 7 but reports 99/);
});

test("a GraphQL errors array fails the fetch instead of being parsed around", async () => {
  const transport: Transport = async () => JSON.stringify({ errors: [{ message: "Bad credentials" }] });
  await assert.rejects(() => fetchActivity({ login: "x", transport }), /Bad credentials/);
});

test("an unknown login fails rather than reporting an empty year", async () => {
  const transport: Transport = async () => JSON.stringify({ data: { user: null } });
  await assert.rejects(() => fetchActivity({ login: "x", transport }), /no user/i);
});

test("the language list it produces is the shape languageShares consumes", async () => {
  const a = await fetchActivity({ login: "x", transport: onePage([
    { name: "one", languages: [{ name: "Python", size: 300 }, { name: "Rust", size: 200 }, { name: "Nix", size: 100 }] },
  ]) });
  const shares = languageShares(a.languages);
  assert.deepEqual(shares.map((s) => s.name), ["Python", "Rust", "Nix"]);
  assert.equal(shares.reduce((s, x) => s + x.pct, 0), 100);
});

// ---------------------------------------------------------------------------
// The privacy gate (ADR 0001). The name is built from FORBIDDEN_NAMES at runtime,
// so no committed file in this repo carries it.
// ---------------------------------------------------------------------------

const forbidden = FORBIDDEN_NAMES[0];

test("a forbidden name arriving in a fetched repository description fails the fetch", async () => {
  // `description` is a field the query does not even ask for. The gate still has to see it:
  // what matters is that the name arrived, not which field carried it.
  const transport = onePage([
    { name: "one", description: `built by ${forbidden} in 2026`, languages: [{ name: "Python", size: 1 }] },
  ]);
  await assert.rejects(() => fetchActivity({ login: "x", transport }), /forbidden name/i);
});

test("the forbidden-name failure does not repeat the name it is protecting", async () => {
  const transport = onePage([{ name: "one", description: forbidden, languages: [{ name: "Python", size: 1 }] }]);
  await assert.rejects(
    () => fetchActivity({ login: "x", transport }),
    (e: Error) => {
      assert.ok(!everythingIn(e).toLowerCase().includes(forbidden.toLowerCase()), "the error echoes the name it is protecting");
      return true;
    },
  );
});

test("the gate runs before the parser, so a broken body is never quoted back", async () => {
  // A JSON syntax error quotes the source text near the fault, so the name has to be ruled
  // out before the parser is allowed to speak.
  const transport: Transport = async () => `{ "data": broken ${forbidden}`;
  await assert.rejects(() => fetchActivity({ login: "x", transport }), /forbidden name/i);
});

// ---------------------------------------------------------------------------
// The credential. Read from the environment, never from an argument, a flag or a
// file in the tree, and never visible in anything this module produces.
//
// The stand-in below is deliberately NOT shaped like a GitHub token: a committed
// file that looked like a credential would trip the secret gate it exists to defend.
// ---------------------------------------------------------------------------

const FAKE_TOKEN = "TOKEN-VALUE-THAT-MUST-NEVER-APPEAR";

async function withToken<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const before = process.env[TOKEN_ENV];
  if (value === undefined) delete process.env[TOKEN_ENV];
  else process.env[TOKEN_ENV] = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env[TOKEN_ENV];
    else process.env[TOKEN_ENV] = before;
  }
}

type Call = { url: string; init: RequestInit };

/** Swaps the platform fetch for the duration of `fn`, so the real transport runs offline. */
async function withStubbedFetch<T>(reply: () => Response, fn: () => Promise<T>): Promise<{ outcome: T | Error; calls: Call[] }> {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return reply();
  }) as typeof fetch;
  try {
    return { outcome: await fn().catch((e: Error) => e), calls };
  } finally {
    globalThis.fetch = real;
  }
}

const okReply = (): Response => new Response(JSON.stringify({ data: { user: null } }), { status: 200 });

test("with the variable unset the failure names the variable and where to set it", async () => {
  assert.equal(TOKEN_ENV, "PROFILE_GH_TOKEN");
  await withToken(undefined, async () => {
    await assert.rejects(
      () => githubTransport({ query: ACTIVITY_QUERY, variables: {} }),
      (e: Error) => {
        assert.match(e.message, /PROFILE_GH_TOKEN/);
        assert.match(e.message, /\.env\.example/);
        // The scope advice, which is MEASURED (docs/spec.md 5.2): a token scoped
        // `gist, read:org, repo, workflow` with no `read:user` returned the whole calendar. This
        // message used to demand `read:user`, which is read at the moment somebody decides which
        // credential to mint and sent them to make one they did not need.
        assert.match(e.message, /repo scope/, "the message does not name the scope that is actually enough");
        assert.doesNotMatch(e.message, /needs? the read:user/, "the message demands a scope the API does not require");
        return true;
      },
    );
  });
});

test("an empty variable counts as unset rather than as a token worth sending", async () => {
  const { outcome, calls } = await withStubbedFetch(okReply, () => withToken("   ", () => githubTransport({ query: ACTIVITY_QUERY, variables: {} })));
  assert.ok(outcome instanceof Error, "a blank token was accepted");
  assert.equal(calls.length, 0, "a request went out with a blank token");
});

test("the transport posts the query to the GitHub GraphQL endpoint", async () => {
  const { calls } = await withStubbedFetch(okReply, () => withToken(FAKE_TOKEN, () => githubTransport({ query: ACTIVITY_QUERY, variables: { login: "x" } })));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/graphql");
  assert.equal(calls[0].init.method, "POST");
  assert.ok(String(calls[0].init.body).includes("contributionCalendar"), "the query was not sent");
});

test("the token rides in the Authorization header and nowhere else", async () => {
  const { outcome, calls } = await withStubbedFetch(okReply, () => withToken(FAKE_TOKEN, () => githubTransport({ query: ACTIVITY_QUERY, variables: { login: "x" } })));
  const headers = calls[0].init.headers as Record<string, string>;
  assert.ok(String(headers.authorization).includes(FAKE_TOKEN), "the token was never sent, so the fetch is unauthenticated");
  assert.ok(!calls[0].url.includes(FAKE_TOKEN), "the token is in the URL");
  assert.ok(!String(calls[0].init.body).includes(FAKE_TOKEN), "the token is in the request body");
  assert.ok(!String(outcome).includes(FAKE_TOKEN), "the token came back out of the transport");
});

test("no failure path lets the token escape into an error", async () => {
  const leaky = `Bad credentials: ${FAKE_TOKEN}`;
  const paths: { what: string; run: () => Promise<unknown> }[] = [
    { what: "a transport that throws", run: () => fetchActivity({ login: "x", transport: async () => { throw new Error(`socket hang up while sending ${FAKE_TOKEN}`); } }) },
    { what: "a GraphQL error echoing the credential", run: () => fetchActivity({ login: "x", transport: async () => JSON.stringify({ errors: [{ message: leaky }] }) }) },
    { what: "a body that is not JSON", run: () => fetchActivity({ login: "x", transport: async () => `not json at all ${FAKE_TOKEN}` }) },
    {
      what: "an HTTP failure from the real transport",
      run: async () => {
        const { outcome } = await withStubbedFetch(() => new Response(leaky, { status: 401 }), () => githubTransport({ query: ACTIVITY_QUERY, variables: {} }));
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    },
    {
      what: "the platform fetch rejecting",
      run: async () => {
        const real = globalThis.fetch;
        globalThis.fetch = (async () => { throw new Error(`connect ECONNREFUSED while sending ${FAKE_TOKEN}`); }) as typeof fetch;
        try {
          return await githubTransport({ query: ACTIVITY_QUERY, variables: {} });
        } finally {
          globalThis.fetch = real;
        }
      },
    },
  ];
  await withToken(FAKE_TOKEN, async () => {
    for (const p of paths) {
      const e = await p.run().then(() => null, (err: Error) => err);
      assert.ok(e !== null, `${p.what} did not fail at all`);
      assert.ok(!everythingIn(e).includes(FAKE_TOKEN), `${p.what} leaked the token`);
    }
  });
});

test("a credential echoed back inside a response never survives into the parsed data", async () => {
  const transport = onePage([{ name: "one", languages: [{ name: `Python ${FAKE_TOKEN}`, size: 5 }] }]);
  const a = await withToken(FAKE_TOKEN, () => fetchActivity({ login: "x", transport }));
  assert.ok(!JSON.stringify(a).includes(FAKE_TOKEN), "the token survived into the parsed activity");
});

test("an HTTP failure does not quote a response body that has not been through the gate", async () => {
  // At that point the body has not been scanned, so quoting it could put a forbidden name into
  // a build log. The status is enough to act on.
  const { outcome } = await withStubbedFetch(
    () => new Response(`{"message":"blocked, see ${forbidden}"}`, { status: 403 }),
    () => withToken(FAKE_TOKEN, () => githubTransport({ query: ACTIVITY_QUERY, variables: {} })),
  );
  assert.ok(outcome instanceof Error, "a 403 was treated as a success");
  assert.ok(!outcome.message.toLowerCase().includes(forbidden.toLowerCase()), "an ungated response body reached the error message");
});

// ---------------------------------------------------------------------------
// The committed cache. A build with no network and no token reads it; a build with
// neither it nor a token fails rather than printing a figure nobody measured.
// ---------------------------------------------------------------------------

const tmpBase = pathToFileURL(`${mkdtempSync(join(tmpdir(), "activity-cache-"))}/`);
let tmpSeq = 0;
/** A cache path inside a directory that does not exist yet. */
const tmpCache = (): URL => new URL(`run-${tmpSeq++}/activity.json`, tmpBase);

const SAMPLE: Activity = {
  totalContributions: 12,
  activeDays: 2,
  calendar: [{ date: "2026-01-01", count: 4 }, { date: "2026-01-02", count: 8 }],
  languages: [{ name: "Python", bytes: 10 }],
};

const agoIso = (seconds: number): string => new Date(Date.now() - seconds * 1000).toISOString();

function writeCacheFixture(path: URL, activity: unknown, fetchedAt = new Date().toISOString()): void {
  mkdirSync(dirname(fileURLToPath(path)), { recursive: true });
  writeFileSync(path, JSON.stringify({ fetchedAt, activity }));
}

const offline: Transport = async () => { throw new Error("getaddrinfo ENOTFOUND api.github.com"); };

test("the cache lives at cache/activity.json so a fresh checkout can build offline", () => {
  assert.ok(CACHE_PATH.pathname.endsWith("/cache/activity.json"), CACHE_PATH.pathname);
});

test("a successful fetch writes the cache and reports the data as fresh", async () => {
  const cachePath = tmpCache();
  const loaded = await loadActivity({ login: "x", cachePath, transport: onePage([{ name: "one", languages: [{ name: "Python", size: 5 }] }]) });
  assert.equal(loaded.source, "network");
  assert.equal(loaded.staleNote, null);
  assert.equal(loaded.ageSeconds, null);
  assert.deepEqual(JSON.parse(readFileSync(cachePath, "utf8")).activity, loaded.activity);
});

test("the cache holds parsed data only, never the raw response and never a credential", async () => {
  const cachePath = tmpCache();
  await withToken(FAKE_TOKEN, () => loadActivity({
    login: "x",
    cachePath,
    transport: onePage([{ name: "one", description: `echoed ${FAKE_TOKEN}`, languages: [{ name: `Python ${FAKE_TOKEN}`, size: 5 }] }]),
  }));
  const text = readFileSync(cachePath, "utf8");
  assert.ok(!text.includes(FAKE_TOKEN), "the cache carries the credential");
  assert.ok(!text.includes("contributionCalendar"), "the cache carries the raw response or the query");
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ["activity", "fetchedAt"]);
});

test("a failed fetch falls back to the cache and says how stale the figures are", async () => {
  const cachePath = tmpCache();
  writeCacheFixture(cachePath, SAMPLE, agoIso(3 * 86_400));
  const loaded = await loadActivity({ login: "x", cachePath, transport: offline });
  assert.equal(loaded.source, "cache");
  assert.deepEqual(loaded.activity, SAMPLE);
  assert.ok(loaded.ageSeconds !== null && loaded.ageSeconds >= 3 * 86_400, `age was ${loaded.ageSeconds}`);
  assert.match(String(loaded.staleNote), /stale/i);
  assert.match(String(loaded.staleNote), /3 days/);
  assert.match(String(loaded.staleNote), /ENOTFOUND/);
});

test("with no token but a valid cache the build still gets real figures", async () => {
  const cachePath = tmpCache();
  writeCacheFixture(cachePath, SAMPLE, agoIso(5 * 3600));
  const loaded = await withToken(undefined, () => loadActivity({ login: "x", cachePath }));
  assert.equal(loaded.source, "cache");
  assert.equal(loaded.activity.totalContributions, 12);
  assert.match(String(loaded.staleNote), /5 hours/);
  assert.match(String(loaded.staleNote), /PROFILE_GH_TOKEN/);
});

test("with neither a fetch nor a cache it fails loudly instead of emitting zeros", async () => {
  const cachePath = tmpCache();
  await assert.rejects(
    () => withToken(undefined, () => loadActivity({ login: "x", cachePath })),
    (e: Error) => {
      assert.match(e.message, /PROFILE_GH_TOKEN/);
      assert.match(e.message, /cache/i);
      return true;
    },
  );
  assert.ok(!existsSync(fileURLToPath(cachePath)), "a placeholder cache was written");
});

test("a cache missing required fields is rejected rather than half used", async () => {
  const cachePath = tmpCache();
  writeCacheFixture(cachePath, { totalContributions: 5 });
  await assert.rejects(() => withToken(undefined, () => loadActivity({ login: "x", cachePath })), /cache/i);
});

test("a cache whose counts are not whole numbers is rejected", async () => {
  // JSON cannot carry NaN, so a corrupted figure arrives as a string, a null or a fraction.
  for (const bad of ["12", null, -1, 1.5, {}]) {
    const cachePath = tmpCache();
    writeCacheFixture(cachePath, { ...SAMPLE, totalContributions: bad });
    await assert.rejects(
      () => withToken(undefined, () => loadActivity({ login: "x", cachePath })),
      /cache/i,
      `accepted ${JSON.stringify(bad)} as a contribution total`,
    );
  }
});

test("a cache whose calendar entries are malformed is rejected", async () => {
  const cachePath = tmpCache();
  writeCacheFixture(cachePath, { ...SAMPLE, calendar: [{ date: "not-a-day", count: 1 }] });
  await assert.rejects(() => withToken(undefined, () => loadActivity({ login: "x", cachePath })), /cache/i);
});

test("a cache carrying a forbidden name is refused", async () => {
  const cachePath = tmpCache();
  writeCacheFixture(cachePath, { ...SAMPLE, languages: [{ name: forbidden, bytes: 1 }] });
  await assert.rejects(() => withToken(undefined, () => loadActivity({ login: "x", cachePath })), /forbidden name/i);
});

test("a forbidden name in fetched data is not papered over by a healthy cache", async () => {
  const cachePath = tmpCache();
  writeCacheFixture(cachePath, SAMPLE);
  const transport = onePage([{ name: "one", description: forbidden, languages: [{ name: "Python", size: 1 }] }]);
  await assert.rejects(() => loadActivity({ login: "x", cachePath, transport }), /forbidden name/i);
  // And the clean cache is left exactly as it was, not overwritten with the rejected data.
  assert.deepEqual(JSON.parse(readFileSync(cachePath, "utf8")).activity, SAMPLE);
});
