#!/usr/bin/env node
/**
 * Measure how much concurrency this deployment actually takes.
 *
 * WHY THIS EXISTS
 * ───────────────
 * "How many users can we handle" cannot be answered from instance sizes. The
 * binding constraint in this app is not CPU on the API — a request spends most
 * of its time waiting on Postgres or on an AI provider — it is the voice-call
 * polling path, because every participant in a connecting call polls TWO
 * endpoints once a second, and both of them write to Postgres.
 *
 * So this drives the real polling loop with real sessions, ramps the number of
 * simultaneous callers, and reports where latency stops being flat. That
 * number is the capacity figure; everything else is an estimate.
 *
 * WHAT IT DOES NOT DO
 * ───────────────────
 * It does not exercise AI. Those calls cost money per request and are bounded
 * by the provider's latency rather than by anything here, so loading them
 * measures Anthropic, not this deployment. It also makes no WebRTC connection:
 * the audio is peer-to-peer and never reaches the server, so it is irrelevant
 * to server capacity.
 *
 * RUN IT AGAINST A SCRATCH DEPLOYMENT, NOT PRODUCTION
 * ───────────────────────────────────────────────────
 * It creates users, joins the matching queue, and leaves rows behind. Pointed
 * at a live app it would put test accounts in the pool with real students and
 * skew their matches.
 *
 * THE AUTH RATE LIMIT WILL STOP THE SETUP
 * ────────────────────────────────────────
 * `RATE_LIMIT_AUTH` defaults to 20 per 15-minute window, and it counts
 * registrations. Creating more accounts than that fails partway through with
 * 429s — correctly, since that limiter exists to stop exactly this pattern.
 *
 * Either raise it on the deployment under test and put it back afterwards, or
 * keep the peak stage at 20 and extrapolate. A short run at 10/20 that stays
 * flat already tells you the constraint is higher than that, which is usually
 * the answer you wanted.
 *
 * Usage:
 *   BASE_URL=https://your-app.ondigitalocean.app node scripts/loadtest.mjs
 *
 * Options (environment variables):
 *   STAGES=10,25,50,100   concurrent callers to try, in order
 *   SECONDS=30            how long to hold each stage
 *   POLL_MS=1000          poll interval, matching the client
 *   PREFIX=loadtest       email prefix for the accounts it creates
 */

const BASE = (process.env.BASE_URL ?? '').replace(/\/$/, '');
if (!BASE) {
  console.error('BASE_URL must be set, e.g. https://your-app.ondigitalocean.app');
  process.exit(1);
}

const STAGES = (process.env.STAGES ?? '10,25,50,100')
  .split(',')
  .map((n) => parseInt(n.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);
const HOLD_MS = parseInt(process.env.SECONDS ?? '30', 10) * 1000;
const POLL_MS = parseInt(process.env.POLL_MS ?? '1000', 10);
const PREFIX = process.env.PREFIX ?? 'loadtest';

/** Every account shares one password; these are throwaway users. */
const PASSWORD = 'LoadTest1234';

// ─── Tiny HTTP client that keeps a session cookie ─────────────────────────────

/**
 * One virtual user.
 *
 * Holds its own cookie jar because the whole point is to exercise the session
 * path: `connect-pg-simple` reads the session from Postgres on EVERY request,
 * so a test that skipped authentication would miss a query per call.
 */
class Client {
  constructor(label) {
    this.label = label;
    this.cookie = null;
    this.userId = null;
  }

  async request(method, path, body) {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookie) headers.cookie = this.cookie;

    const started = performance.now();
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const ms = performance.now() - started;

    // express-session rotates the cookie on every response (rolling: true), so
    // the jar has to be updated each time or the session is lost mid-test.
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
      if (c.startsWith('connect.sid=')) this.cookie = c.split(';')[0];
    }

    let payload = null;
    const text = await res.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text.slice(0, 200);
      }
    }
    return { status: res.status, body: payload, ms };
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

async function registerAndLogin(i) {
  const c = new Client(`u${i}`);
  const email = `${PREFIX}+${Date.now()}-${i}@example.invalid`;

  const reg = await c.request('POST', '/api/auth/register', {
    name: `Load ${i}`,
    email,
    password: PASSWORD,
    // Required by registerSchema — the answer is only ever collected at signup.
    referralSource: 'other',
  });

  // A rerun with the same PREFIX finds the address taken; logging in is the
  // right recovery, not a failure.
  if (reg.status >= 400) {
    const login = await c.request('POST', '/api/auth/login', { email, password: PASSWORD });
    if (login.status >= 400) {
      throw new Error(`setup failed for ${email}: register ${reg.status}, login ${login.status}`);
    }
  }

  // The practice pool only offers people who marked themselves available.
  await c.request('PUT', '/api/practice/profile', { isAvailable: true });
  return c;
}

// ─── Statistics ───────────────────────────────────────────────────────────────

function summarise(samples) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    n: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1],
  };
}

const fmt = (ms) => `${ms.toFixed(0)}ms`.padStart(7);

// ─── One stage ────────────────────────────────────────────────────────────────

/**
 * Hold `n` clients polling at the client's real cadence, then report latency.
 *
 * Polls are fired on an interval rather than in a tight loop on purpose: a
 * tight loop measures how fast the server can be saturated, which is not what
 * any student does. This reproduces N people each polling once a second, which
 * is the actual shape of the load.
 */
async function runStage(clients, n) {
  const active = clients.slice(0, n);
  const pollSamples = [];
  const signalSamples = [];
  const errors = new Map();

  const note = (status) => {
    if (status >= 400) errors.set(status, (errors.get(status) ?? 0) + 1);
  };

  let stop = false;
  const loops = active.map(async (c) => {
    while (!stop) {
      const tick = Date.now();

      const poll = await c.request('POST', '/api/practice/poll').catch((e) => ({
        status: 0,
        ms: 0,
        body: String(e),
      }));
      pollSamples.push(poll.ms);
      note(poll.status);

      // In a call, the client polls the signal mailbox on the same timer. The
      // session id is whatever the poll reported; without one this still
      // measures the queue path, which is the other half of the load.
      const sessionId = poll.body?.session?.id;
      if (sessionId) {
        const sig = await c
          .request('GET', `/api/practice/sessions/${sessionId}/signals?after=0`)
          .catch((e) => ({ status: 0, ms: 0, body: String(e) }));
        signalSamples.push(sig.ms);
        note(sig.status);
      }

      const elapsed = Date.now() - tick;
      await new Promise((r) => setTimeout(r, Math.max(0, POLL_MS - elapsed)));
    }
  });

  await new Promise((r) => setTimeout(r, HOLD_MS));
  stop = true;
  await Promise.all(loops);

  return {
    n,
    poll: summarise(pollSamples),
    signals: summarise(signalSamples),
    errors: [...errors.entries()].sort((a, b) => b[1] - a[1]),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const peak = Math.max(...STAGES);
console.log(`Target:  ${BASE}`);
console.log(`Stages:  ${STAGES.join(', ')} concurrent callers, ${HOLD_MS / 1000}s each`);
console.log(`Creating ${peak} accounts…`);

const clients = [];
for (let i = 0; i < peak; i++) {
  try {
    clients.push(await registerAndLogin(i));
  } catch (e) {
    console.error(`  ${e.message}`);
  }
  if ((i + 1) % 10 === 0) process.stdout.write(`  ${i + 1}/${peak}\r`);
}
console.log(`Ready:   ${clients.length} accounts\n`);

if (clients.length === 0) {
  console.error('No accounts could be created — check BASE_URL and that registration is open.');
  process.exit(1);
}

// Everyone joins the pool, so the matcher pairs them and real calls exist to
// poll. Without this every client would only ever exercise the queue path.
console.log('Joining the matching queue…');
await Promise.all(clients.map((c) => c.request('POST', '/api/practice/queue').catch(() => {})));
console.log('Done.\n');

console.log('callers    poll p50   poll p95   poll p99   sig p95   errors');
console.log('─'.repeat(70));

const results = [];
// Measurement is wrapped so that a crash — or Ctrl+C handled below — still
// reaches cleanup. Accounts leaking on a failed run is exactly the case where
// leaving them behind is least welcome.
let measurementError = null;
try {
  for (const n of STAGES) {
    if (n > clients.length) {
      console.log(`${String(n).padEnd(10)} skipped — only ${clients.length} accounts`);
      continue;
    }
    const r = await runStage(clients, n);
    results.push(r);
    const errs = r.errors.length === 0 ? 'none' : r.errors.map(([s, c]) => `${s}×${c}`).join(' ');
    console.log(
      `${String(n).padEnd(10)} ${fmt(r.poll.p50)}   ${fmt(r.poll.p95)}   ${fmt(r.poll.p99)}   ` +
        `${r.signals ? fmt(r.signals.p95) : '      —'}   ${errs}`,
    );
  }
} catch (e) {
  measurementError = e;
  console.error(`\nRun aborted: ${e.message}`);
}

// ─── What the numbers mean ────────────────────────────────────────────────────

console.log('\n─── Reading this ───');
const first = results[0];
const last = results[results.length - 1];
if (first && last && first.n !== last.n) {
  const growth = last.poll.p95 / first.poll.p95;
  console.log(
    `p95 went from ${fmt(first.poll.p95)} at ${first.n} callers to ${fmt(last.poll.p95)} at ${last.n} ` +
      `(${growth.toFixed(1)}×).`,
  );
  if (growth < 1.5) {
    console.log('Flat — the constraint is above the range tested. Raise STAGES and run again.');
  } else if (growth < 3) {
    console.log('Climbing. Capacity is near the top of this range.');
  } else {
    console.log('Saturated inside this range. The knee is the last stage where p95 stayed flat.');
  }
}
console.log(
  'Watch Postgres CPU in the DO dashboard while this runs — it saturates before the API does,\n' +
    'and it is the number that decides when to move to a larger database tier.',
);
// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Remove the accounts this run created.
 *
 * Needs a database connection: there is no delete-account endpoint, and adding
 * one so a load test could tidy up after itself would be a real liability on a
 * real deployment for the sake of a script.
 *
 * Deleting the `users` row is enough. Twenty-two tables reference it with
 * `on delete cascade` — profiles, subscriptions, attempts, queue rows,
 * signals — so they go with it. A handful of CMS and review columns reference
 * users WITHOUT a cascade and are NOT NULL; a load-test account never writes
 * those, but if one somehow did, the delete fails loudly here rather than
 * leaving half a user behind.
 */
async function cleanup() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(
      '\nAccounts were left behind: DATABASE_URL is not set, and they cannot be removed over\n' +
        'HTTP. Re-run with DATABASE_URL to tidy up automatically, or delete them by hand:\n' +
        `  DELETE FROM users WHERE email LIKE '${PREFIX}+%@example.invalid';`,
    );
    return;
  }

  process.stdout.write('\nRemoving test accounts… ');
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const { rowCount } = await client.query(
      `delete from users where email like $1`,
      [`${PREFIX}+%@example.invalid`],
    );
    console.log(`${rowCount} removed.`);
  } catch (e) {
    console.log('failed.');
    console.error(`  ${e.message}`);
    console.error(
      `  Remove them by hand:\n` +
        `  DELETE FROM users WHERE email LIKE '${PREFIX}+%@example.invalid';`,
    );
  } finally {
    await client.end().catch(() => {});
  }
}

// Ctrl+C during a long hold should not strand the accounts either.
let interrupted = false;
process.on('SIGINT', async () => {
  if (interrupted) process.exit(130);
  interrupted = true;
  console.log('\nInterrupted — cleaning up before exit.');
  await cleanup();
  process.exit(130);
});

await cleanup();

if (measurementError) process.exit(1);
