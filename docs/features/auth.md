# Feature: Sign Up / Log In (Auth)

## What it does
Lets a person create an account, log in, log out, and check who is currently logged in. A brand-new account is automatically enrolled in the default curriculum (currently English-for-Arabic-speakers) so they're ready to take the placement test.

## Where the code lives
- `artifacts/api-server/src/routes/auth.ts` — the 4 endpoints: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `artifacts/api-server/src/middlewares/auth.ts` — `requireAuth` and role guards (`requireAdmin`, `requireStudent`, etc.) used by every other protected route
- `lib/db/src/schema/users.ts` — `users` table and `student_profiles` table (one profile per user, created at registration)
- Sessions are stored in Postgres (`session` table) via `connect-pg-simple`, not in a token — the browser just holds a cookie

## How it works
1. Register: checks name/email/password are present and password is at least 6 characters, checks the email isn't already used, hashes the password with bcrypt, creates the user row, then creates a matching `student_profiles` row and enrolls them in the first active curriculum.
2. Login: looks up the user by email, compares the password against the stored hash, and starts a session if it matches.
3. Both register and login store `userId`, `role`, `name`, `email` in the session so later requests don't need to hit the database just to know who's asking.
4. Logout destroys the session server-side.
5. Every other protected route checks `req.session.userId` (and sometimes `req.session.role`) through the middleware — this is the single gate the whole app relies on.

## Quality check

**Solid:**
- Passwords are hashed with bcrypt, never stored or logged in plain text.
- Login and register are both rate-limited (10 attempts / 15 min per IP) — see `app.ts` — so basic brute-forcing is covered.
- Sessions live in Postgres, so restarting the API server doesn't log everyone out, and it works across multiple server instances (important once you're past one box).
- Cookies are `httpOnly`, and `secure` + proper `sameSite` in production.
- `requireAuth`/`requireAdmin`/etc. are used consistently everywhere else in the codebase — this part is trustworthy.

**Issues found:**
1. **Register/login don't use the validation rules that already exist.** There's a ready-made `registerSchema` / `loginSchema` (in `lib/validate.ts`) that checks the email actually looks like an email, caps the password length, and restricts `country`/`preferredLanguage` to valid values — but `auth.ts` does its own hand-rolled checks instead and skips all of that. Today, someone can register with `email: "not-an-email"` and it will be accepted. This is an easy fix: swap the manual `if` checks for `validate(res, registerSchema, req.body)` / `validate(res, loginSchema, req.body)`, the same pattern used everywhere else in the app.
2. **No email verification.** Anyone can sign up with an email they don't own. Fine for a v1 with 10k users, but worth planning for before you rely on email for password resets or notifications.
3. **No "forgot password" flow.** If someone forgets their password today, there's no way for them to get back in on their own — support would have to do it manually in the database.
4. **Duplicate-email race condition (minor, low risk).** If the exact same email registers twice at the exact same instant, the "already registered" check can miss it and the second insert will fail at the database level instead of returning a clean "email already registered" message. It'll show a generic error rather than break anything, but the error message won't be as friendly as it should be.

## Suggested next steps
- Switch `auth.ts` to use `registerSchema`/`loginSchema` from `lib/validate.ts` (small change, closes gap #1).
- Decide if email verification and password reset are needed before or shortly after launch — likely yes, since users will lose access to their account otherwise.
