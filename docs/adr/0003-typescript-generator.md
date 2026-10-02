# TypeScript generator despite a Python-first author

The generator that renders the Session SVGs and refreshes Activity is written in TypeScript and run on Node, even though the Handle's own work is mostly Python and the reference profile (HocVoNgThai) uses Python. The Landing Page will be built later on the web stack, so one language lets both surfaces share code and the single token file. It also leaves room to use anime.js at build time later. Node 26, which is already installed, runs `.ts` files directly without a build step.

## Consequences, recorded 2026-10-02 against the built generator

Checked against the code rather than assumed. The decision held; one consequence of it did not get
written down and shapes every file.

- **Node STRIPS the types, it does not compile them.** Nothing type-level may survive to runtime, so
  the generator uses `as const` arrays plus a derived union wherever another codebase would reach for
  an `enum` (`PoseName` in `src/timeline.ts` is the one with the comment explaining why). Enums,
  parameter properties and namespaces are all unavailable. This is a constraint of the decision, not
  a style preference.
- **Type checking is therefore a separate step that nothing runs implicitly.** `npm run typecheck` is
  `tsc`, and it is a gate (`docs/spec.md` 6) precisely because the runtime will happily execute code
  `tsc` would reject.
- **No build step still holds.** `npm run build` is `node src/build.ts` and `npm test` is
  `node --test`, both over `.ts` sources, with no bundler, transpiler or output directory.

## Considered Options

- Python: the author's strongest language and the reference's choice, but nothing would carry over to the Landing Page.
- Rust: on-brand with saltnitor, but the slowest to iterate on for SVG string templating.
