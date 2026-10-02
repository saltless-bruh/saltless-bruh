# Session Grammar without Anthropic marks

> **Partly superseded.** Two clauses of the decision below no longer describe what ships: the
> Statusline's not-affiliated note, and the mode badge in the list of borrowed conventions. Both are
> recorded in *Amendment, 2026-10-02 (second)*, which is the current decision. **Everything else
> below still binds**, and the amendment weakens none of it. This pointer sits above the decision
> rather than inside it because the decision is the record of what was decided then; three separate
> times this repository has had an ADR drift out of step with the code, and each time the drift was
> found by somebody reading the first paragraph and nothing else.

The Session borrows an agent CLI's layout and glyph conventions (rule-bordered `❯` prompt, `●` tool calls with `╰` results, breathing spinner, mode badge, effort picker) but never Anthropic's marks: no "Claude" or "Claude Code" name, no logo, no `✻` used as a logo, no Clawd mascot or near-copy, no Claude orange (`#D77757` / `#D97757`) and no copy of Claude Code's spinner-verb list. The Header carries the Handle instead, and the Statusline states that the design is not affiliated with Anthropic. Anthropic's trademark guidelines forbid implied sponsorship or affiliation, and its Agent SDK guidance excludes "Claude Code-branded ASCII art or visual elements"; the homage stays recognisable through grammar, not marks.

## Amendment, 2026-10-02: two corrections, and where the line now gets drawn

**The result glyph is `╰`, not `⎿`.** The list above named `⎿` when this was written. That character
is **absent from JetBrains Mono v2.304** (`docs/spec.md` 3.3), so it is one of the ten this build
forbids outright: it is in `FORBIDDEN_GLYPHS` in `src/font.ts` and `npm run gates` fails on finding
it in any generated file. An ADR naming a glyph the gates reject describes a Session that cannot be
built, so the decision is recorded against the glyph that ships. Nothing about the decision changes;
`╰` is the substitute and reads the same way.

**There is no task list.** It was listed as borrowed and nothing renders one: the Session is the
Header, `/whoami`, `/ops`, `/stack`, `/activity`, the spinner and the Statusline. A reader comparing
this list against the picture would go looking for a Command that was never built.

**Where "Session Grammar" ends and copy begins is now a test, not a judgement.** `docs/spec.md` 4.1
states it: if it is a word a reader could read aloud as part of a sentence about the owner or their
machine it is copy and lives in `content.json`; if it is a glyph or a structural mark carrying no
lexical content it is Session Grammar and stays in the generator. That is what keeps this decision
enforceable. The glyph set above is grammar by that test, which is why it is the generator's and not
the owner's, and it is also why `Effort` and the spinner's verbs are the owner's and not the
generator's.

## Amendment, 2026-10-02 (second): the not-affiliated note is deleted, and the mode badge with it

The owner revisited this decision on **2026-10-02**, after reviewing the published profile, and asked
for the Statusline's note to be removed. It is recorded here rather than left to contradict
`src/session.ts`.

**What was deleted.** `statusline.note`, which read *"terminal-style design, not affiliated with
Anthropic"*. The key is gone from `content.json`, its validation is gone from `src/content.ts`, and
the row is gone from `src/session.ts`.

**The measured fact the decision turns on.** That string was **the only occurrence of the word
"Anthropic" in the entire published profile**. Counted before the deletion: one in `content.json`,
one in `README.md`'s transcript and one in each generated asset, all of them the same sentence and
all of them that sentence. So the ADR's rule above, *never Anthropic's marks*, was being satisfied by
a profile whose single utterance of the name was the disclaimer printed to satisfy it. **Deleting it
takes the profile from one mention to zero**, which satisfies this ADR's own rule more completely
than printing the line did.

**The owner's reasoning, recorded as given.**

- The Session is a **static picture**, not a functioning product that could be mistaken for one. The
  trademark concern the note answers is implied sponsorship or affiliation, and that concern has
  force where a reader might believe they are using the thing; nobody can believe they are using a
  README image.
- **Other agent CLIs that borrow this same grammar carry no such line.** A disclaimer that none of
  the neighbours print reads as a claim of proximity rather than as a distance from it.
- The guidance this ADR cites excludes *"Claude Code-branded ASCII art or visual elements"*, and
  **none of that is what this uses**. There is no logo, no name, no Claude orange, and no copy of the
  spinner-verb list. What is borrowed is **layout grammar**: a rule-bordered prompt, tool-call
  bullets with nested results, a spinner, an effort picker.

**What still holds, unchanged and unweakened.** No "Claude" or "Claude Code" name anywhere. No logo
and no `✻` used as one. No Clawd mascot or near-copy; the Mascot is a cat on a server rack, drawn for
this profile. No Claude orange (`#D77757` / `#D97757`); the palette is Everforest Hard with an
aqua-green Accent (`docs/spec.md` 3.4). No copy of Claude Code's spinner-verb list; every verb is the
owner's and lives in `content.json`, bound to the Mascot's own poses. **Grammar only.** None of that
was traded for the deletion, and the deletion is not a licence to revisit any of it: the note was
removed because the name it carried was the last one on the page, not because the rule relaxed.

**The mode badge is no longer drawn either**, and it is named here for the same reason the task list
was named in the first amendment: it is in the list of borrowed conventions in the decision above, and
a reader comparing that list against the picture would go looking for a row that is not there. It was
`▶▶ autopilot on`, and it shared its row with the note. It went for a reason about the reference
rather than about marks: running the effort command there **replaces** the statusline, so the badge
and the effort panel are never on screen together, and drawing both put two unrelated readouts in the
panel's last two rows. The borrowed conventions that remain are the rule-bordered `❯` prompt, `●` tool
calls with `╰` results, the spinner and the effort picker.

## Considered Options

- Copying the CLI faithfully, logo and Clawd included: most recognisable, but trademark risk and it reads as a fan page rather than the Handle's identity.
- Dropping the agent-CLI frame entirely: no risk, but loses the look the owner asked for.
