---
name: pr-review-frontend
description: Frontend checklist for reviewing changes to artifacts/ascension in this repo (React 19 + Vite + TanStack Query + Tailwind/Radix). Covers React hooks rules, performance, regressions in shared components, and this app's Arabic-first product conventions. Loaded by the pr-review skill when frontend files changed; can also be used stand-alone.
---

# PR Review — Frontend (React + Vite + TanStack Query)

Stack reminders before you start: React 19, Vite, routing via `wouter`, data fetching via TanStack Query using the **generated** hooks in `lib/api-client-react` (not hand-written `fetch` calls), styling with Tailwind CSS 4 and Radix-based UI components in `src/components/ui`, forms with React Hook Form + Zod, charts with `recharts`.

## 1. Rules of Hooks

Check every changed component and custom hook against the actual rules, not just "does it use hooks":

- Hooks (`useState`, `useEffect`, `useMemo`, `useCallback`, `useQuery`, custom `useXyz` hooks) are called at the top level only — never inside an `if`, a loop, a ternary that skips the call, or after an early `return`. If a component has an early return (e.g. a loading/error guard) followed by more hook calls afterward, that's a Rules-of-Hooks violation even if it happens to work in one render.
- The number and order of hook calls must be the same on every render of a given component — don't make a hook call conditional on props/state.
- Custom hooks are named `useSomething` and themselves only call other hooks from their own top level (same rule, one level down).
- Hooks are only called from React function components or from other hooks — not from plain helper functions, event handlers, or outside a component entirely.
- `useEffect`/`useMemo`/`useCallback` dependency arrays should list everything they actually reference from the enclosing scope. A missing dependency can cause stale data (e.g. an effect that keeps using an old value from before a prop changed); an unnecessary or unstable dependency (a new object/array/function literal created every render) can cause an effect or memo to re-run every single render, defeating the point of memoizing it.

## 2. Performance

- Watch for new object/array/function literals passed as props to a memoized child (`React.memo`) or as a dependency to `useEffect`/`useMemo` — a literal like `{ foo: bar }` or `() => {...}` is a *new* value every render, which silently breaks memoization and dependency comparisons. Prefer `useMemo`/`useCallback` when the value needs to be stable, or restructure so it doesn't need to be.
- Watch for a `useQuery` (or any data fetch) called inside a `.map()` over a list — that's an N+1 network pattern on the frontend, same idea as the backend N+1 problem. Prefer a single batched query, or a query keyed so React Query can share/cache it properly.
- A long list rendered in full (dozens+ of rows/cards) without windowing/virtualization is worth a mention if it's new and likely to grow — not necessarily a blocker for a short list today, but flag it if the underlying data set is expected to scale (e.g. a vocabulary list, an admin table of students).
- Heavy synchronous work (sorting/filtering/transforming a large array) inside the render body on every render, instead of behind a `useMemo`, is worth flagging — especially in frequently re-rendered components like the lesson player.

## 3. Data fetching (TanStack Query)

- New API calls should go through the generated hooks in `lib/api-client-react` (`useSubmitExercise`-style hooks), not a hand-written `fetch`/`axios` call that bypasses the typed client — a hand-written call silently stops benefiting from the OpenAPI contract and can drift from what the API actually returns.
- Check query keys are correct and stable (same shape every time for the same logical query) — a query key that includes a new object/array literal each render defeats caching and can cause refetch loops.
- Check that a mutation which changes server state (completing a lesson, submitting a quiz, updating a profile) invalidates or refetches the queries that should reflect the change afterward (e.g. completing a lesson should invalidate the lesson list, level progress, and dashboard queries) — otherwise the UI shows stale data until an unrelated navigation happens to refetch it.

## 4. Don't break older features (regression check)

- A change to anything in `src/components/ui/*` (the shared Radix-based component library) or a shared layout/hook (`components/layout.tsx`, `components/cms-layout.tsx`, `components/protected-route.tsx`, `hooks/*`) is used across many pages — check the other call sites, not just the page in the diff, especially for prop renames or behavior changes.
- A change to `App.tsx` routing should be checked against the full route list — make sure no existing route was accidentally removed, reordered past a catch-all, or had its guard (`protected-route.tsx`) dropped.
- If a shared type changes shape (especially one derived from the generated API client), check every component destructuring that type still gets what it expects — TypeScript should catch most of this at typecheck time, but double check anything using `any` or a loose cast.

## 5. This app's product conventions (easy to miss if you don't know them)

- **Arabic-first / bilingual**: most user-facing content in this app has an English and Arabic variant (the backend pattern is a field and its `*Ar` counterpart — `title`/`titleAr`, `message`/`messageAr`, etc.). New user-facing text should follow the same pattern rather than being English-only.
- **RTL-aware**: since Arabic is the primary UI language, new layout code should work sensibly in `dir="rtl"`, not just in a left-to-right mental model (careful with hardcoded `left`/`right` in custom CSS instead of logical properties, and with icons/arrows that imply a direction).
- **No emojis in the UI** — this is a stated product convention; flag any new emoji in UI copy.
- **Mobile-first** — check new layouts hold up at a small viewport width, not just on a wide desktop screen.
- **The server is the source of truth for anything gradable.** The frontend should only ever *display* a score/correct-or-not/completion result that came back from the API — it should never compute one itself and present it as final. If you see client-side logic computing a score or pass/fail and rendering it as the result (rather than just as an optimistic loading state before the real response arrives), flag it — this breaks the trust boundary the backend was carefully built around (see `docs/features/lessons.md` and `docs/features/quizzes.md`).

## 6. Forms

- Forms should use React Hook Form with a Zod resolver, consistent with the rest of the app, rather than plain controlled-input state wired up by hand.
- Validation errors should be surfaced to the user near the relevant field, not just logged or silently swallowed.
- Check both loading and error states are handled for form submission (disabled submit button while pending, a visible error message on failure) — a form that just does nothing visible on error is a real usability bug.

## 7. Accessibility (lightweight check, not a full audit)

- Interactive elements are real `<button>`/`<a>` elements (or Radix primitives that render as such), not a `<div onClick>`.
- Form inputs have an associated label (via `<label>`, `aria-label`, or the `field.tsx`/`form.tsx` helpers already in the component library).
- New icon-only buttons have an accessible name (`aria-label` or visually-hidden text), especially important given this is a bilingual app where an icon might be the only universal element.

## 8. Tests

See the main `pr-review` skill for the repo-wide testing policy. As of now, the frontend has no test tooling installed at all (no Vitest/Jest/Testing Library configured). For a frontend PR with real logic (a new hook, non-trivial state management, a scoring/validation display), it's reasonable to ask whether this is a good place to introduce basic component/unit testing — but don't block a simple UI or styling change on introducing a whole test setup from scratch.
