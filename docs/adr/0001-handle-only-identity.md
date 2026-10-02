# Handle-only identity: the real name is never shown

The profile identifies its owner only by the Handle ("Lazie", @saltless-bruh) and never renders the real name anywhere: not in the Header, alt text, copy, links or generated assets. The owner keeps their security handle separate from their legal identity. This deliberately drops the real-name header from the original draft (`saltless-bruh-profile-3a.html`) and rules out linking LinkedIn, whose URL and page carry the real name; contact links stay empty until the Landing Page, HackerOne or HackTheBox profiles exist.

## Consequences

- Any data pulled from GitHub or other sources must be checked so the real name never leaks into a rendered asset.
- Commits stay safe because the git author name is already the Handle.

## The mechanism, added 2026-10-02

`scripts/gates.ts` sends a reader here when the name gate reports `absent`, and until now this record
named no mechanism to come and read about. It is this:

- **The list has two halves.** `FORBIDDEN_NAMES` in `src/content.ts` is a committed placeholder;
  `PROFILE_FORBIDDEN_NAMES` in the environment adds the real spellings. The private half is never in
  the tree, which is the whole point, so it goes in `.env` locally (loaded by
  `node --env-file-if-exists=.env`) and in a repository secret for the workflow.
- **With nothing configured the gate reports a PASS that says it scanned for nothing, not clean.**
  "Nothing was checked" must not be readable as "the tree is clean", which is the failure this
  decision cannot afford, and the wording is what carries that. It reported `absent` and held back
  the run until the amendment below; only the status changed, never the distinction.
- **It is checked in three places, not one.** The fetched response body on arrival, before parsing
  (`src/activity.ts`), because a name can arrive in a field the query never asked for; the complete
  projection of the composed Session's rows (`rowsToFullText`), never the transcript, so a run the
  picture draws but the transcript omits cannot hide one; and every committed file, by a tree scan.
- A name found in fetched data **fails the build** rather than falling back to the cache. Staleness is
  an availability problem; this is not one, and serving yesterday's figures over it would make a
  privacy breach quiet.

## Amendment, 2026-10-02: the policy stands, the enforcement became opt-in

**The decision above is unchanged.** The profile shows the Handle and never the real name, and that
is true of the built output today: the generated `README.md`, both Theme Variants, `content.json`
and `cache/activity.json` were checked directly and carry no real name at all. `content.json`
holds the Handle and the `login`, and the transcript holds what the picture shows. What follows
changed the ENFORCEMENT, not the policy.

The original wording, and `docs/spec.md` 3.6, said this was "enforced by a build check, not by
discipline". The tree scan that does that enforcing needs the private name to look for, and only
the owner can supply it, through `PROFILE_FORBIDDEN_NAMES`. The owner revisited that on
2026-10-02 and chose **not** to configure it. Their reason, as given: the name is among the most
common in Vietnam, so on its own it is weak identifying information and they do not consider it
worth protecting with a check. That is their call about their own privacy.

So the enforcement is now **available and off by default** rather than required:

- The tree scan reports PASS with a visible note saying that no private names are configured and
  that therefore nothing was scanned for. It is deliberately worded so it cannot be read as "the
  tree was checked and is clean", which is a different claim. It no longer holds back the run, and
  the daily refresh no longer requires the secret.
- Turning it back on is one line, in `.env` locally or as a repository secret of the same name:

      PROFILE_FORBIDDEN_NAMES=The Name,Another Spelling

  With it set, the scan runs over every file a commit could carry and FAILS on a hit. This is
  opt-out, not removal, and a test pins that.

Two halves of the check were never configuration-dependent and are untouched:

- **The scan over FETCHED data** (`src/activity.ts`) still runs on every build, over the whole
  response body, before the parser. That is the path that matters most and the one nobody
  inspects: a name arriving in a repository description or a commit message. It costs nothing to
  leave armed.
- **The committed placeholder** is still scanned for in the generated output on every run, so a
  demonstration value reaching a published surface still fails.

The gate was a net against future accident, not a fix for a present leak. Recorded here with the
reason and the one line that reverses it, because an ADR that claims an enforcement the code no
longer performs is the failure this project has already had to correct three times.
