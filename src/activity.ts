// src/activity.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoForbiddenNames } from "./content.ts";
import type { Activity } from "./session.ts";

/** One day of the contribution calendar, in the shape the Session already consumes. */
type Day = Activity["calendar"][number];

/** Days the activity line counts against: the Session prints "N/365 days up". */
export const WINDOW_DAYS = 365;

/** Languages kept, largest first. The /stack rows print one row per language. */
export const MAX_LANGUAGES = 6;

/** Repositories asked for per page, and the ceiling that stops an endless cursor loop. */
const REPOS_PER_PAGE = 100;
const MAX_PAGES = 20;
/** Languages per repository, largest first. Nothing real has more than a dozen. */
const LANGUAGES_PER_REPO = 12;

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const dayStart = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

/**
 * The one place the token is read from. It is never a function argument, a CLI flag, or a file
 * in the repository, so no caller can hold one and no commit can carry one.
 */
export const TOKEN_ENV = "PROFILE_GH_TOKEN";

const REDACTED = "[redacted]";

/**
 * Takes the token out of text that is about to be quoted, stored or returned.
 *
 * Nothing here ever puts the credential in a message on purpose. This is for the text this
 * module did not write: a fetch error that names the request it was sending, a GraphQL error
 * that echoes its own input. Applying it once, where the response arrives and where a failure
 * is worded, covers everything downstream, the committed cache included.
 */
function redact(text: string): string {
  const token = process.env[TOKEN_ENV];
  if (!token) return text;
  return text.split(token).join(REDACTED);
}

function fail(message: string): never {
  throw new Error(redact(message));
}

/**
 * The last WINDOW_DAYS days ending on `endIso`, oldest first.
 *
 * The calendar GitHub returns is 53 whole weeks, so it can reach past both ends of the window
 * the activity line claims: days older than a year at the start, and, in the newest week, days
 * that have not happened yet. Both are dropped, so "N/365 days up" counts the 365 days it names
 * and the Scan Sweep is handed a chronological run of real days.
 */
export function trimToWindow(days: Day[], endIso: string): Day[] {
  if (!ISO_DAY.test(endIso)) fail(`the window must end on an ISO day (YYYY-MM-DD), not ${endIso}`);
  const end = dayStart(endIso);
  const start = end - (WINDOW_DAYS - 1) * DAY_MS;
  const kept: Day[] = [];
  for (const day of days) {
    // A day the window cannot place is a broken response, not a day to quietly drop: a short
    // calendar would then read as a quiet year instead of as a failure.
    if (!ISO_DAY.test(day.date)) fail(`the contribution calendar carries ${day.date}, which is not an ISO day (YYYY-MM-DD)`);
    const at = dayStart(day.date);
    if (at >= start && at <= end) kept.push(day);
  }
  return kept.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// The GraphQL request
// ---------------------------------------------------------------------------

export const API_URL = "https://api.github.com/graphql";

/**
 * One query document, sent once per page of repositories.
 *
 * `contributionsCollection` carries the whole year day by day, so it is asked for on the first
 * page only: `@include` keeps it out of the follow-up pages instead of re-sending 365 days with
 * every cursor. Languages are ordered by size so that the per-repository cap keeps the biggest
 * ones rather than an arbitrary twelve.
 */
export const ACTIVITY_QUERY = `query ProfileActivity($login: String!, $cursor: String, $withCalendar: Boolean!) {
  user(login: $login) {
    contributionsCollection @include(if: $withCalendar) {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
    repositories(first: ${REPOS_PER_PAGE}, after: $cursor, ownerAffiliations: OWNER, isFork: false) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        languages(first: ${LANGUAGES_PER_REPO}, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name } }
        }
      }
    }
  }
}`;

export type GraphQLRequest = { query: string; variables: Record<string, unknown> };

/**
 * Sends one GraphQL request and returns the raw response body.
 *
 * The seam exists so the tests can drive the real parser over canned bodies without a network
 * or a credential. The transport never receives the token: it reads it from the environment
 * itself, so no caller can pass one in.
 */
export type Transport = (request: GraphQLRequest) => Promise<string>;

/**
 * The real transport. It reads the token from the environment at call time, so the credential
 * never crosses a function boundary, and it quotes a status rather than a response body: the
 * body has not been through the forbidden-name gate at that point.
 */
export const githubTransport: Transport = async (request) => {
  const token = process.env[TOKEN_ENV] ?? "";
  if (token.trim() === "") {
    // Names the variable and where to put it. Nothing about a value, present or absent.
    fail(`${TOKEN_ENV} is not set, so the activity cannot be fetched. Copy .env.example to .env and fill it in, or add an Actions secret of the same name. The token needs the read:user scope.`);
  }
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      authorization: `bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "profile-session",
    },
    body: JSON.stringify(request),
  }).catch((e: Error) => fail(`the request to the GitHub API failed (${e.message})`));

  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? `, so ${TOKEN_ENV} is either invalid or missing the read:user scope` : "";
    fail(`the GitHub API returned ${res.status}${hint}`);
  }
  return await res.text();
};

// ---------------------------------------------------------------------------
// Parsing what came back
// ---------------------------------------------------------------------------

type RawDay = { date?: unknown; contributionCount?: unknown };
type RawCalendar = { totalContributions?: unknown; weeks?: { contributionDays?: RawDay[] }[] };
type RawEdge = { size?: unknown; node?: { name?: unknown } | null } | null;
type RawRepo = { name?: unknown; languages?: { edges?: RawEdge[] | null } | null };
type RawUser = {
  contributionsCollection?: { contributionCalendar?: RawCalendar | null } | null;
  repositories?: { pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } | null; nodes?: (RawRepo | null)[] | null } | null;
};

/** One page of the response, with the optional bits of the envelope already resolved. */
type Page = { calendar: RawCalendar | null; repos: RawRepo[]; hasNextPage: boolean; endCursor: string | null };

function checkedInt(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) fail(`${what} is not a whole count in the GitHub API response`);
  return v;
}

function checkedText(v: unknown, what: string): string {
  if (typeof v !== "string" || v.trim() === "") fail(`${what} is missing from the GitHub API response`);
  return v;
}

function parsePage(raw: string): Page {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    fail(`the GitHub API response is not valid JSON (${(e as Error).message})`);
  }
  const envelope = json as { data?: { user?: RawUser | null } | null; errors?: { message?: unknown }[] } | null;
  if (Array.isArray(envelope?.errors) && envelope.errors.length > 0) {
    const said = envelope.errors.map((e) => (typeof e?.message === "string" ? e.message : "an unnamed error")).join("; ");
    fail(`the GitHub API rejected the query: ${said}`);
  }
  const user = envelope?.data?.user ?? null;
  if (user === null) fail("the GitHub API returned no user for that login, so there is nothing to report");
  const info = user.repositories?.pageInfo;
  if (!info) fail("the GitHub API response carries no repository page");
  return {
    calendar: user.contributionsCollection?.contributionCalendar ?? null,
    repos: (user.repositories?.nodes ?? []).filter((r): r is RawRepo => r !== null),
    hasNextPage: info.hasNextPage === true,
    endCursor: typeof info.endCursor === "string" ? info.endCursor : null,
  };
}

function readCalendar(cal: RawCalendar | null): Day[] {
  if (cal === null) fail("the GitHub API response carries no contribution calendar");
  const days = (cal.weeks ?? []).flatMap((w) => w.contributionDays ?? []).map((d) => ({
    date: checkedText(d.date, "a contribution day's date"),
    count: checkedInt(d.contributionCount, "a contribution count"),
  }));
  const sum = days.reduce((s, d) => s + d.count, 0);
  const stated = checkedInt(cal.totalContributions, "the calendar total");
  // The calendar total is, by definition, the sum of the calendar's own days. When they
  // disagree the response is incomplete, and the headline figure would be wrong in a way
  // nothing downstream could notice.
  if (sum !== stated) fail(`the contribution calendar adds up to ${sum} but reports ${stated}, so the response is incomplete`);
  return days;
}

// ---------------------------------------------------------------------------
// The fetch
// ---------------------------------------------------------------------------

/**
 * A forbidden name that arrived through fetched data (ADR 0001).
 *
 * Kept apart from every other failure because it is not an availability problem: falling back
 * to yesterday's figures would turn a privacy breach into a silent one.
 */
export class ForbiddenNameError extends Error {}

/**
 * The owner's real activity: the contribution calendar trimmed to the window the Session
 * claims, and language byte totals across the repositories it is told to count.
 *
 * `login` is the GitHub account name the API is queried by (`content.json`'s `login`), which is a
 * different value from the drawn handle. `repoNames` narrows the language totals to the repos
 * `content.json` features; an empty list counts every repository the owner owns.
 */
export async function fetchActivity(o: { login: string; repoNames?: string[]; transport: Transport }): Promise<Activity> {
  const wanted = new Set((o.repoNames ?? []).map((n) => n.toLowerCase()));
  const bytes = new Map<string, number>();
  let calendar: Day[] | null = null;
  let cursor: string | null = null;
  let pages = 0;

  for (;;) {
    const withCalendar = pages === 0;
    const raw = redact(await o.transport({ query: ACTIVITY_QUERY, variables: { login: o.login, cursor, withCalendar } })
      .catch((e: Error) => fail(`the activity fetch failed (${e.message})`)));
    // Fetched data is untrusted. ADR 0001 says the real name must never reach a rendered asset,
    // and the cheapest way to keep that promise is to refuse the data on arrival rather than
    // chase it downstream. The whole body is scanned, not only the fields that are kept: a name
    // in a field this query does not ask for is still a name that arrived. The scan also runs
    // before the parser, because a JSON syntax error quotes the text around the fault.
    try {
      assertNoForbiddenNames(raw, "data fetched from the GitHub API");
    } catch (e) {
      throw new ForbiddenNameError(redact((e as Error).message));
    }
    const page = parsePage(raw);
    pages += 1;
    if (withCalendar) calendar = readCalendar(page.calendar);

    for (const repo of page.repos) {
      if (wanted.size > 0 && !wanted.has(checkedText(repo.name, "a repository name").toLowerCase())) continue;
      for (const edge of repo.languages?.edges ?? []) {
        if (edge === null) continue;
        const name = checkedText(edge.node?.name, "a language name");
        bytes.set(name, (bytes.get(name) ?? 0) + checkedInt(edge.size, `the byte size of ${name}`));
      }
    }

    if (!page.hasNextPage) break;
    // A partial language total is a wrong number that looks like data, so the ceiling is a
    // failure rather than a quiet stop.
    if (pages >= MAX_PAGES) fail(`the owner has more than ${MAX_PAGES * REPOS_PER_PAGE} repositories, so the language totals would be partial`);
    if (page.endCursor === null) fail("the GitHub API says there are more repositories but gave no cursor to reach them");
    cursor = page.endCursor;
  }

  if (calendar === null) fail("the first page of the GitHub API response carried no contribution calendar");
  const inWindow = trimToWindow(calendar, utcDay(new Date()));
  return {
    // Both figures describe the same 365 days. The API's own total covers the whole 53-week
    // calendar, which can be longer than the window the activity line names.
    totalContributions: inWindow.reduce((s, d) => s + d.count, 0),
    activeDays: inWindow.filter((d) => d.count > 0).length,
    calendar: inWindow,
    // The tie-break on name keeps the committed cache from churning between two equal sizes.
    languages: [...bytes]
      .map(([name, size]) => ({ name, bytes: size }))
      .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
      .slice(0, MAX_LANGUAGES),
  };
}

// ---------------------------------------------------------------------------
// The committed cache
// ---------------------------------------------------------------------------

/**
 * Where the cache lives. It is committed, so a clone with no network and no credential still
 * builds; the refresh workflow rewrites it daily.
 */
export const CACHE_PATH = new URL("../cache/activity.json", import.meta.url);

/**
 * One successful fetch, parsed. Never the raw response, never a credential: the response is
 * scrubbed where it arrives, so everything derived from it is already clean.
 *
 * The timestamp lives inside the file rather than being read off the filesystem, because a
 * checkout resets every mtime and the staleness of the figures would then read as zero.
 */
type CacheFile = { fetchedAt: string; activity: Activity };

export type LoadedActivity = {
  activity: Activity;
  source: "network" | "cache";
  /** How old the figures are, in whole seconds. Null when they came straight off the network. */
  ageSeconds: number | null;
  /** Why they are not fresh, with the age and the reason spelled out. Null when they are. */
  staleNote: string | null;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function badCache(what: string): never {
  fail(`the activity cache is unusable: ${what}. Delete it and rebuild with ${TOKEN_ENV} set, so the figures come from a real fetch instead of a guess.`);
}

/** A count has to be a whole number of things. A string, a null or a fraction is corruption. */
function cachedCount(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) badCache(`${what} is not a whole count`);
  return v;
}

/** Rebuilds the record field by field, so a half-written cache cannot be half-used. */
function checkedCache(v: unknown): CacheFile {
  if (!isObj(v)) badCache("the top level is not an object");
  const { fetchedAt, activity } = v;
  if (typeof fetchedAt !== "string" || !Number.isFinite(Date.parse(fetchedAt))) badCache("fetchedAt is not a timestamp");
  if (!isObj(activity)) badCache("there is no activity record");
  if (!Array.isArray(activity.calendar)) badCache("activity.calendar is not a list");
  if (!Array.isArray(activity.languages)) badCache("activity.languages is not a list");

  const calendar = activity.calendar.map((d: unknown, i) => {
    if (!isObj(d)) badCache(`calendar[${i}] is not an object`);
    if (typeof d.date !== "string" || !ISO_DAY.test(d.date)) badCache(`calendar[${i}].date is not an ISO day`);
    return { date: d.date, count: cachedCount(d.count, `calendar[${i}].count`) };
  });
  const languages = activity.languages.map((l: unknown, i) => {
    if (!isObj(l)) badCache(`languages[${i}] is not an object`);
    if (typeof l.name !== "string" || l.name.trim() === "") badCache(`languages[${i}].name is blank`);
    return { name: l.name, bytes: cachedCount(l.bytes, `languages[${i}].bytes`) };
  });

  return {
    fetchedAt,
    activity: {
      totalContributions: cachedCount(activity.totalContributions, "activity.totalContributions"),
      activeDays: cachedCount(activity.activeDays, "activity.activeDays"),
      calendar,
      languages,
    },
  };
}

function readText(path: URL): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    // Kept apart from a corrupt cache: there is nothing here to delete, only something to make.
    fail(`there is no activity cache yet, so run the refresh with ${TOKEN_ENV} set to write one`);
  }
}

function readCache(path: URL): CacheFile {
  const raw = readText(path);
  // Names first. The cache is a file a person can hand-edit, and a JSON syntax error quotes the
  // text around the fault, so nothing below is allowed to speak until the file has cleared.
  assertNoForbiddenNames(raw, "the activity cache");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    badCache(`it is not valid JSON (${(e as Error).message})`);
  }
  return checkedCache(parsed);
}

function writeCache(path: URL, activity: Activity): void {
  const file: CacheFile = { fetchedAt: new Date().toISOString(), activity };
  mkdirSync(dirname(fileURLToPath(path)), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

/** The age in the largest unit that still reads as a number, for a build log a person skims. */
function describeAge(seconds: number): string {
  for (const [size, unit] of [[86_400, "day"], [3_600, "hour"], [60, "minute"]] as [number, string][]) {
    if (seconds >= size) {
      const n = Math.floor(seconds / size);
      return `${n} ${unit}${n === 1 ? "" : "s"}`;
    }
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

/**
 * The activity the build should print: fetched when that works, the cache when it does not.
 *
 * A fetch that succeeds refreshes the cache. A fetch that fails is not hidden: the caller gets
 * the cached figures along with their age and the reason the refresh did not happen, so nothing
 * downstream can present stale data as current. With no cache to fall back on it throws, because
 * the alternative is a calendar of zeros, and a calendar of zeros is a number nobody measured.
 */
export async function loadActivity(o: {
  login: string;
  repoNames?: string[];
  cachePath?: URL;
  transport?: Transport;
}): Promise<LoadedActivity> {
  const cachePath = o.cachePath ?? CACHE_PATH;
  let failure: string;
  try {
    const activity = await fetchActivity({
      login: o.login,
      repoNames: o.repoNames,
      transport: o.transport ?? githubTransport,
    });
    writeCache(cachePath, activity);
    return { activity, source: "network", ageSeconds: null, staleNote: null };
  } catch (e) {
    if (e instanceof ForbiddenNameError) throw e;
    failure = redact((e as Error).message);
  }

  let cached: CacheFile;
  try {
    cached = readCache(cachePath);
  } catch (e) {
    fail(`the activity could not be fetched and there is no usable cache behind it, so there are no real figures to print. The fetch said: ${failure} The cache said: ${redact((e as Error).message)}`);
  }
  const ageSeconds = Math.max(0, Math.round((Date.now() - Date.parse(cached.fetchedAt)) / 1000));
  return {
    activity: cached.activity,
    source: "cache",
    ageSeconds,
    staleNote: `the activity figures are stale: they were fetched ${describeAge(ageSeconds)} ago and the refresh failed (${failure})`,
  };
}
