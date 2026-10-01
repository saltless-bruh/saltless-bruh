# Handle-only identity: the real name is never shown

The profile identifies its owner only by the Handle ("Lazie", @saltless-bruh) and never renders the real name anywhere: not in the Header, alt text, copy, links or generated assets. The owner keeps their security handle separate from their legal identity. This deliberately drops the real-name header from the original draft (`saltless-bruh-profile-3a.html`) and rules out linking LinkedIn, whose URL and page carry the real name; contact links stay empty until the Landing Page, HackerOne or HackTheBox profiles exist.

## Consequences

- Any data pulled from GitHub or other sources must be checked so the real name never leaks into a rendered asset.
- Commits stay safe because the git author name is already the Handle.
