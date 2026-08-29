---
name: CSS @import ordering in PostCSS / Tailwind v4
description: Google Fonts @import url() must be the very first line in index.css or PostCSS throws "@import must precede all other statements".
---

## Rule
Place `@import url('https://fonts.googleapis.com/...')` as line 1 of `index.css`, before `@import 'tailwindcss'` and `@import 'tw-animate-css'`.

**Why:** PostCSS processes `@import 'tailwindcss'` first and expands it to thousands of lines. Any `@import url(...)` after that expanded content violates the CSS spec rule that @imports must precede all other statements.

**How to apply:** Always put external URL imports first in the cascade, then processed imports (tailwindcss, tw-animate-css), then @plugin directives.
