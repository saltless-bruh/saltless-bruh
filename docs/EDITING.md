# Editing your profile

Everything you see on the profile comes from `content.json`. You never need to touch `src/`.

## Change the words

Open `content.json`, change any value, then run:

    npm run build

The build fails with a clear message if something will not render, so a mistake can never ship silently. The message names what is wrong, for example `content.json: whoami must have 1 to 3 lines` or `content.json: repo saltpilot needs a non-blank blurb`.

| Key | What it is |
|---|---|
| `handle` | The nickname. It is spelled in the shell prompt at the top and again in the startup block beside the cat. |
| `login` | Your GitHub account name, which the figures are fetched for. It is also the path the prompt prints. |
| `prompt` | The `host` you are logged in to, and the `command` the cat is the output of. |
| `startup` | The three lines beside the cat: a `version`, a `colourWord` drawn in the colour it names, the `model` line after it, and a `status` line. |
| `whoami` | One to three lines of prose for `/whoami`. |
| `lanes` | The groups under `/ops`. Each has a `label` and a list of repos with a `name` and a one-line `blurb`. |
| `stackRows` | The rows under `/stack`. Each has a `label` (which may be empty) and a list of `items`, printed as plain text. |
| `verbs` | The spinner's words, grouped by what the cat is doing: `sleep`, `yawn`, `stretch`, `settle`, `peek`, then the alarm, `alert`, `swat-up`, `swat-down`, `glare`, `butt-up`, `butt-down`, `recover`. The spinner always names the pose on screen, so give `yawn` a yawning word. Give `sleep` several and it rotates through them during the long naps. Every group needs at least one word. The two halves of a blow (`swat-up` and `swat-down`, `butt-up` and `butt-down`) usually want the SAME word, so the spinner holds one phrase for the whole gesture instead of flickering. **The alarm's words shipped as a first draft and are yours to rewrite.** |
| `statusline` | The effort panel at the bottom, which is the last thing on the page: the `effortWord` heading, the two `effortEnds` above the track, the `effortLabels` and which one is highlighted (`effortSelected`, which must be one of them), the `toggle` word and its state, the `toggleNote` gloss, the `toggleHint` under the toggle, and the `help` key hints that close the Session. |
| `readme` | One line, `imageAlt`, and it is **the only text the README has**. It is what a screen reader says instead of the picture, and since the fold-out transcript was removed on 2026-10-03 there is nothing else under the picture for it to point at, so do not write "see below" or anything like it. It cannot hold the session (67 rows do not fit in an attribute), so it says what the picture is; if you want it to name you or say what you do, that is your call and this is the one place left to do it. Changing it is a one-line edit here and a rebuild, and nothing else moves. |

## Rules the build enforces

1. **Nothing blank, nothing missing.** Every field above must be present and be text. Only a `stackRows` label may be empty. `whoami` takes at most three lines, `lanes` and `stackRows` cannot be empty, and every lane needs repos.
2. **84 columns.** Nothing may be wider. Long blurbs are the usual cause; the error names the row.
3. **Drawable characters only.** Plain text and Vietnamese are fine. Emoji are not, and the error names the field and the character with its code, for example `content.json: startup.status: character ... (U+1F642) is not in the font`. A short list of symbols the font lacks is refused too; it is `FORBIDDEN_GLYPHS` in `src/font.ts`.
4. **No forbidden names.** The build refuses to write anything containing one, whichever field it is in, and matches without regard to case. The error names the field but never repeats the name.

## Keeping a name private

`FORBIDDEN_NAMES` in `src/content.ts` is itself committed, so never put a private string there: that would publish the very thing it protects.

Set the environment variable `PROFILE_FORBIDDEN_NAMES` to a comma-separated list instead. It is added to the committed list, and leaving it unset or empty changes nothing.

The easy way is `.env`, which is gitignored and never committed. Copy `.env.example` to `.env` and fill in both lines:

    PROFILE_GH_TOKEN=your-token
    PROFILE_FORBIDDEN_NAMES=First Last,Last First

**The name goes on the RIGHT of the `=`.** A name written as a key sets nothing, and the gates now say so distinctly instead of reporting the scan as unconfigured, because the two look identical from the outside and only one of them is your mistake to find.

`npm run build` and `npm run gates` both read `.env`. Nothing else does, so if you would rather not keep a file, put it on the command line instead and remember that the gates need it too:

    PROFILE_FORBIDDEN_NAMES="First Last,Last First" npm run build
    PROFILE_FORBIDDEN_NAMES="First Last,Last First" npm run gates

Set it the same way in CI, as a repository secret of the same name. The check also runs over everything fetched from the API.

**Setting it is optional.** The owner weighed their own name and chose not to (ADR 0001, amended 2026-10-02), so with nothing set the scan passes carrying a note that it scanned for nothing, and neither a build nor the daily refresh is held back. That note is deliberately not the same sentence as "the tree is clean", because nothing was checked and that is a different claim. Set it and the scan runs over every file a commit could carry and fails on a hit.

**Do not put your handle or your login here.** They are what the profile exists to show, so they are in `content.json`, the README and both assets by design. The gate fails and says so, rather than listing the six files it is deliberately in.

Two checks never depended on this and always run: the scan over everything fetched from the API, which is where a name you did not write could arrive, and a scan of the generated output for the placeholder that ships in `src/content.ts`.
