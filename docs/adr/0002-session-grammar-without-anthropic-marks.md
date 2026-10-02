# Session Grammar without Anthropic marks

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

## Considered Options

- Copying the CLI faithfully, logo and Clawd included: most recognisable, but trademark risk and it reads as a fan page rather than the Handle's identity.
- Dropping the agent-CLI frame entirely: no risk, but loses the look the owner asked for.
