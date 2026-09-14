# CrashLens

CrashLens is a production incident investigation and uptime-monitoring platform. It ingests TXT, CSV, JSON, and JSONL logs, redacts sensitive values, groups related errors into incidents, correlates them with deployments and uptime failures, and builds an investigation timeline. The interface uses a solid, square-edged operations-console design.

## What is included

- Log upload, parsing, duplicate detection, redaction, incident grouping, severity scoring, timelines, and history.
- Separate CrashLens email/password accounts, team workspaces, sessions, password reset, and optional ChatGPT access.
- Project-based HTTP monitors with GET, HEAD, POST, PUT, PATCH, and DELETE checks.
- Configurable intervals, timeouts, expected status ranges, body assertions (`contains`, `exact`, and `regex`), safe request headers, request bodies, and tags.
- 30-day uptime bars, 24-hour to 90-day response-time charts, captured check evidence, and manual checks.
- Automatic outage incidents after three failures, recovery detection, acknowledge/resolve actions, and incident filters.
- Email, Slack, PagerDuty, and HMAC-SHA256 signed webhook lifecycle notifications.
- SSRF defenses: HTTPS-only destinations, blocked credentials/query strings/private addresses, DNS checks, no redirects, header restrictions, response-size limits, and database leases.
- OpenTelemetry-compatible request traces, error-spike detection, deployment correlation, service-level objectives (SLOs), error budgets, and downloadable postmortems.

## Architecture

The web application is built with vinext/React and runs on Cloudflare Workers through Sites. D1 stores accounts, teams, uploaded logs, incidents, monitors, checks, projects, sessions, and the email outbox. Resend delivers account and incident emails. An external runner calls the authenticated monitor tick endpoint once per minute.

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

Open Monitoring, choose or create a project, and add a public HTTPS endpoint. Configure its service name, method, interval, timeout, expected HTTP status range, optional response-body assertion, headers, body, and tags. Credentials, query strings, private IP literals, private DNS answers, redirects, and sensitive headers are rejected. Use a public-egress Workers environment; DNS preflight alone is not DNS pinning or a general private-network SSRF boundary.

Three consecutive failed checks open an outage incident and queue one notification to each workspace member. The next success resolves the outage and queues a recovery message. Repeated failures during the same outage do not flood inboxes. Each uploaded incident also queues an email. Matching service names let you compare the outage with log incidents in History; this is correlation, not proof of a root cause. Uptime is the fraction of successful observed checks over 30 days, not a time-weighted SLA.

### Optional alert destinations

Configure any of these server-only values in `.dev.vars` locally and in the hosting environment for production:

- `SLACK_WEBHOOK_URL` — Slack incoming-webhook URL.
- `PAGERDUTY_ROUTING_KEY` — PagerDuty Events API v2 integration key.
- `ALERT_WEBHOOK_URL` — HTTPS endpoint that receives CrashLens lifecycle JSON.
- `ALERT_WEBHOOK_SECRET` — secret used to sign the webhook body in `X-CrashLens-Signature` as `sha256=<hex>`.

Lifecycle events are `opened`, `acknowledged`, and `resolved`. Keep every credential out of Git.

### Always-on scheduler (required)

Configure a strong random `MONITOR_CRON_TOKEN` on the app and the runner, and `CRASHLENS_URL` on the runner. Run `node scripts/monitor-runner.mjs` on an always-on host. It POSTs to `/api/monitor-tick` once per minute and processes due monitors with database leases. `--once` performs one tick. The browser is not a scheduler.

The current Sites deployment is owner-private: the platform access gate is separate from this API token and must also allow the scheduler request. An external runner cannot pass that gate with `MONITOR_CRON_TOKEN` alone. Use a hosting arrangement with supported machine access or deploy the app on your own Worker before claiming unattended production monitoring. No cron job, public audience change, or machine access grant is created automatically by this repository. Monitoring displays Not connected until a runner heartbeat has arrived recently.

Sites' existing access gate also remains in front of the new account page. Separate accounts do not automatically make the site public.

## Production intelligence

Open **Intelligence** and select **Load sample signals** for a complete demonstration. CrashLens shows one checkout request moving through the gateway, checkout service, payment service, and database call. The failing span is highlighted, a recent deployment is shown as a possible trigger, the error rate is compared with the previous 15-minute period, and service reliability is compared with a 99.9% target. **Generate report** saves and downloads a Markdown postmortem. Deployment correlation is evidence, not proof; an engineer must confirm the root cause.

For real application data, configure `INGESTION_TOKEN` and `INGESTION_TEAM_ID`, then send OpenTelemetry Protocol JSON or the simpler `spans` JSON format to `POST /api/telemetry` with `X-CrashLens-Ingest-Token`. Send CI/CD releases to `POST /api/deployments` with `service`, `version`, and optional `environment`, `status`, `actor`, `source`, and ISO `deployedAt`. A ready-to-send trace example is available at `/samples/crashlens-otel.json`. `INGESTION_TEAM_ID` must match the team id returned by the authenticated `/api/workspace` response, otherwise machine data will not appear in that workspace.

```bash
curl -X POST https://your-crashlens-host/api/telemetry \
  -H "Content-Type: application/json" \
  -H "X-CrashLens-Ingest-Token: YOUR_TOKEN" \
  --data-binary @public/samples/crashlens-otel.json
```

The endpoint accepts up to 5,000 spans per request and stores service, operation, status, timestamps, duration, environment, trace relationships, and bounded attributes in D1. Keep the token server-side and rotate it if exposed.

### Regional monitoring status

The repository records the check region and exposes the evidence in the dashboard. The bundled runner performs checks from its own `origin` region. True US/EU/APAC consensus requires deploying runners in those regions and securely coordinating their results; the UI does not claim those agents exist until they are actually deployed.

## Database migrations

Schema changes live in `drizzle/`. Migration `0004_uptime_control.sql` adds monitor projects, advanced HTTP configuration, regions, and evidence. Migration `0005_production_intelligence.sql` adds traces, deployments, SLOs, and postmortems. Run `node scripts/migrate-local.mjs` after pulling changes. Sites applies committed migrations when publishing.

## Platform client administration

Set the server-only `ADMIN_EMAILS` variable to a comma-separated list of trusted administrator email addresses. Signed-in administrators then see a **Clients** section containing registered account names, emails, verification state, active-session count, workspace, incident and upload totals, and the account creation date/time in both the browser's local time and UTC. The API checks the allowlist on every request; hiding the navigation item is not the security boundary.

For local development, add `ADMIN_EMAILS=you@example.com` to `.dev.vars`. Configure the same value in the hosted Sites environment. Never expose this endpoint to every registered account.

## Verification

- `npm test` — parser, redaction, hashing, URL safety, probe configuration, and outage transition tests.
- `npm run lint` and `npx tsc --noEmit`.
- `npm run build`.
- With dev running and migrations applied: `node --experimental-strip-types scripts/test-local.mjs`. This creates disposable local account fixtures, tests verification/reset/session revocation and monitor records, then removes only its fixtures. No real emails are sent. Registration and inbox delivery still require a configured sender and end-to-end provider testing.
