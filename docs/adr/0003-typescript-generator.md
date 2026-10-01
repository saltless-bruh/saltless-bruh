# TypeScript generator despite a Python-first author

The generator that renders the Session SVGs and refreshes Activity is written in TypeScript and run on Node, even though the Handle's own work is mostly Python and the reference profile (HocVoNgThai) uses Python. The Landing Page will be built later on the web stack, so one language lets both surfaces share code and the single token file. It also leaves room to use anime.js at build time later. Node 26, which is already installed, runs `.ts` files directly without a build step.

## Considered Options

- Python: the author's strongest language and the reference's choice, but nothing would carry over to the Landing Page.
- Rust: on-brand with saltnitor, but the slowest to iterate on for SVG string templating.
