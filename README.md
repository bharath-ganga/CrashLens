# CrashLens

## Local development

Run `npm install` and `npm run dev`. After the first start, run `node scripts/migrate-local.mjs` to apply all schema migrations to the local emulator. Production Sites publishing applies the SQL files in `drizzle/`.

Visit `/account` for CrashLens email/password accounts. Existing ChatGPT access remains available at `/signin-with-chatgpt?return_to=/`. A new CrashLens account gets its own workspace; existing team memberships remain intact. No automatic account merging occurs.

## Email delivery setup (required)

Create a Resend account, verify a sender domain in its dashboard, and configure these server-only secrets in the hosting environment:

- `RESEND_API_KEY`: sending API key.
- `EMAIL_FROM`: a verified address such as `CrashLens <alerts@yourdomain.com>`.
- `APP_ORIGIN`: the exact HTTPS application origin, used for account email links. Never a request-supplied host.

For local development put the same settings in ignored `.dev.vars`. Never commit credentials. Registration and password-based sign-in do not require email delivery or email verification. Existing unverified accounts can sign in with their original password; duplicate signup never overwrites an account. Password recovery still requires a configured sender and a single-use email link. The `verified` field records actual email verification only; it is not an account activation flag. Email ownership is not proven by signup and must not grant access to any other user's workspace. Login notices wait in the outbox when delivery is unavailable.

Email verification links expire in one hour; reset links in 30 minutes. Tokens are single-use, and their database lookup values are SHA-256 hashes. Resetting a password invalidates all sessions. Sessions use random tokens, HttpOnly/SameSite cookies and HTTPS Secure cookies. Authentication is rate limited. Passwords use salted Web Crypto PBKDF2-SHA256 (100,000 iterations, compatible with Workers), with a 12-character minimum. Assess password hashing cost and abuse limits for your production capacity before opening registration broadly.

The outbox stores email bodies until accepted by Resend, then clears them (including account links). Provider acceptance is not inbox delivery. Retries use an idempotency key, exponential backoff, and stop after five failures. Account email links must therefore be treated as sensitive while pending.

## Uptime monitoring

Open Monitoring. Add a public HTTPS health endpoint, service name, and interval. The probe uses HEAD, considers only 2xx healthy, and does not follow redirects. Credentials, query strings, private IP literals, and private DNS answers are rejected. Use a public-egress Workers environment; DNS preflight alone is not DNS pinning or a general private-network SSRF boundary.

Three consecutive failed checks open an outage incident and queue one notification to each workspace member. The next success resolves the outage and queues a recovery message. Repeated failures during the same outage do not flood inboxes. Each uploaded incident also queues an email. Matching service names let you compare the outage with log incidents in History; this is correlation, not proof of a root cause. Uptime is the fraction of successful observed checks over 30 days, not a time-weighted SLA.

### Always-on scheduler (required)

Configure a strong random `MONITOR_CRON_TOKEN` on the app and the runner, and `CRASHLENS_URL` on the runner. Run `node scripts/monitor-runner.mjs` on an always-on host. It POSTs to `/api/monitor-tick` once per minute and processes due monitors with database leases. `--once` performs one tick. The browser is not a scheduler.

The current Sites deployment is owner-private: the platform access gate is separate from this API token and must also allow the scheduler request. An external runner cannot pass that gate with `MONITOR_CRON_TOKEN` alone. Use a hosting arrangement with supported machine access or deploy the app on your own Worker before claiming unattended production monitoring. No cron job, public audience change, or machine access grant is created automatically by this repository. Monitoring displays Not connected until a runner heartbeat has arrived recently.

Sites' existing access gate also remains in front of the new account page. Separate accounts do not automatically make the site public.

## Verification

- `npm test` — parser, redaction, hashing, URL safety, and outage transition tests.
- `npm run lint` and `npx tsc --noEmit`.
- `npm run build`.
- With dev running and migrations applied: `node --experimental-strip-types scripts/test-local.mjs`. This creates disposable local account fixtures, tests verification/reset/session revocation and monitor records, then removes only its fixtures. No real emails are sent. Registration and inbox delivery still require a configured sender and end-to-end provider testing.
