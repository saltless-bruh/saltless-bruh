# Editing your profile

Everything you see on the profile comes from `content.json`. You never need to touch `src/`.

## Change the words

Open `content.json`, change any value, then run:

    npm run build

The build fails with a clear message if something will not render, so a mistake can never ship silently. The message names what is wrong, for example `content.json: whoami must have 1 to 3 lines` or `content.json: repo saltpilot needs a non-blank blurb`.

| Key | What it is |
|---|---|
| `handle` | The big lettering at the top. Short works best; it is drawn at about 5 columns per letter. |
| `cwd` | The path under the role line. |
| `role` | One line under the lettering. |
| `whoami` | One to three lines of prose for `/whoami`. |
| `lanes` | The groups under `/ops`. Each has a `label` and a list of repos with a `name` and a one-line `blurb`. |
| `stackRows` | The rows under `/stack`. Each has a `label` (which may be empty) and a list of `items`, printed as plain text. |
| `verbs` | The spinner's words, grouped by what the cat is doing: `sleep`, `yawn`, `stretch`, `settle`, `startle`. The spinner always names the pose on screen, so give `yawn` a yawning word. Give `sleep` several and it rotates through them during the long naps. Every group needs at least one word. |
| `statusline` | The effort labels, which one is highlighted (`effortSelected`, which must be one of the labels), the mode badge and the footer note. |

## Rules the build enforces

1. **Nothing blank, nothing missing.** Every field above must be present and be text. Only a `stackRows` label may be empty. `whoami` takes at most three lines, `lanes` and `stackRows` cannot be empty, and every lane needs repos.
2. **72 columns.** Nothing may be wider. Long blurbs are the usual cause; the error names the row.
3. **Drawable characters only.** Plain text and Vietnamese are fine. Emoji are not, and the error names the field and the character with its code, for example `content.json: role: character ... (U+1F642) is not in the font`. A short list of symbols the font lacks is refused too; it is `FORBIDDEN_GLYPHS` in `src/font.ts`.
4. **No forbidden names.** The build refuses to write anything containing one, whichever field it is in, and matches without regard to case. The error names the field but never repeats the name.

## Keeping a name private

`FORBIDDEN_NAMES` in `src/content.ts` is itself committed, so never put a private string there: that would publish the very thing it protects.

Set the environment variable `PROFILE_FORBIDDEN_NAMES` to a comma-separated list instead. It is added to the committed list, and leaving it unset or empty changes nothing:

    PROFILE_FORBIDDEN_NAMES="First Last,Last First" npm run build

Set it the same way in CI, as a repository secret. The check also runs over everything fetched from the API.
