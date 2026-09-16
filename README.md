# CrashLens

**Production error investigation, distributed tracing, and uptime monitoring in one workspace.**

CrashLens collects application logs and telemetry, removes common sensitive values, groups related failures into incidents, and builds an evidence-based timeline. It helps an engineer answer four questions quickly:

1. What failed?
2. Which service was affected?
3. Did a recent deployment contribute?
4. What should the team investigate next?

## Live deployments

| Environment | URL | Access |
| --- | --- | --- |
| Cloudflare production | [crashlens-production.bharathganga7.workers.dev](https://crashlens-production.bharathganga7.workers.dev/) | Public application; a CrashLens account is required for workspace data |
| OpenAI Sites preview | [crashlens.bharathganga7.chatgpt.site](https://crashlens.bharathganga7.chatgpt.site/) | Owner-private preview deployment |

The Cloudflare deployment is the primary live application. The Sites deployment is kept private for owner testing.

## Highlights

| Area                  | What CrashLens provides                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| Incident intelligence | Log parsing, duplicate detection, fingerprints, clustering, severity scoring, timelines, and status management |
| Distributed tracing   | OpenTelemetry-compatible JSON ingestion and request paths across multiple services                             |
| Change correlation    | Matches failures with deployments made during the previous 60 minutes                                          |
| Reliability           | HTTP uptime monitors, service-level objectives (SLOs), and error-budget tracking                               |
| Notifications         | Formal account emails plus incident notifications through email, Slack, PagerDuty, and signed webhooks         |
| Collaboration         | Team workspaces, invitations, assignments, comments, audit history, and administrator client records           |
| Reporting             | Downloadable Markdown postmortems containing impact, evidence, root-cause status, and follow-up actions        |
| Security              | Password hashing, session protection, rate limiting, PII redaction, SSRF controls, and server-only credentials |

## How it works

```text
Log files / API logs / OpenTelemetry / uptime checks / deployments
                              │
                              ▼
                    Cloudflare Worker APIs
                              │
                    parse, normalize, redact
                              │
                 ┌────────────┴────────────┐
                 ▼                         ▼
        Cloudflare D1                Cloudflare R2
   normalized events, incidents    redacted source files
                 └────────────┬────────────┘
                              ▼
            timelines, correlations, alerts, reports
```

CrashLens treats correlations as investigation evidence—not proof of a root cause. An engineer must confirm the final conclusion.

## Main features

### Incident investigation

- Upload `.txt`, `.log`, `.csv`, `.jsonl`, or `.ndjson` files up to 50 MB.
- Parse files on the server and normalize timestamps, severity levels, service names, and messages.
- Redact common credentials and sensitive values before storing anything.
- Persist normalized log entries and generated incidents in D1, and retain the redacted source file in R2.
- Reload previous investigations from the authenticated workspace instead of relying on browser memory.
- Group repeated errors using stable fingerprints.
- Build a chronological timeline for each incident.
- Assign incidents, add comments, and move them through investigating, monitoring, and resolved states.

### Production intelligence

- Accept simple span JSON and OpenTelemetry Protocol JSON at `POST /api/telemetry`.
- Reconstruct one request across connected services.
- Highlight the first failing service and operation.
- Detect error-rate changes by comparing the latest 15 minutes with the previous period.
- Record CI/CD releases through `POST /api/deployments`.
- Correlate a failure with a same-service deployment from the previous 60 minutes.
- Configure an SLO and calculate its remaining error budget.
- Save and download a structured incident postmortem.

### Uptime monitoring

- Organize monitors into projects.
- Check public HTTPS endpoints using `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, or `DELETE`.
- Configure intervals, timeouts, expected status ranges, safe headers, request bodies, and tags.
- Validate response bodies using `contains`, `exact`, or `regex` assertions.
- Display 30-day uptime history and response-time charts from 24 hours to 90 days.
- Open an outage after three consecutive failures and resolve it after recovery.
- Acknowledge and resolve monitoring incidents without producing duplicate outage alerts.

### Accounts and teams

- Create a separate CrashLens email/password account.
- Sign in using a secure HTTP-only session cookie.
- Request a single-use password-reset email.
- Receive a formal security notice after a successful password sign-in.
- Keep optional ChatGPT access alongside separate CrashLens accounts.
- View registered client details from the administrator-only dashboard.

## Technology stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| UI | React 19, TypeScript, Tailwind CSS v4, shadcn-style components, Base UI, Lucide | Responsive dashboard, forms, navigation, themes, and accessible controls |
| Charts | Recharts | Incident activity, uptime, latency, and reliability visualization |
| Framework and build | vinext, Vite | React application routing, server rendering, API routes, and production bundles |
| Runtime | Cloudflare Workers with Node.js compatibility | Server-side authentication, ingestion, analysis, monitoring, and APIs |
| Relational storage | Cloudflare D1 / SQLite | Accounts, teams, logs, incidents, traces, deployments, monitors, notes, and audit history |
| Object storage | Cloudflare R2 | Private storage for redacted uploaded source files |
| Authentication | CrashLens accounts, PBKDF2 password hashing, HTTP-only sessions | Account registration, sign-in, password recovery, and protected workspaces |
| Email and alerts | Resend, Slack, PagerDuty, signed webhooks | Security emails and incident lifecycle notifications |
| Intelligence | Deterministic parsing and correlation with optional OpenAI assistance | Fingerprinting, anomaly detection, deployment correlation, and investigation summaries |
| Hosting | Cloudflare Workers and OpenAI Sites | Production deployment and owner-private preview |
| Quality | Node test runner, TypeScript, oxlint, oxfmt | Automated tests, type safety, linting, and formatting |

## Project structure

```text
CrashLens/
├── app/                       React pages and server API route handlers
│   ├── api/logs/              Multipart file ingestion and persisted-log APIs
│   ├── api/account/           Registration, login, sessions, and password recovery
│   ├── api/workspace/         Incidents, collaboration, settings, and workspace data
│   ├── api/telemetry/         Trace and OpenTelemetry ingestion
│   ├── api/deployments/       Deployment event ingestion and correlation
│   ├── api/monitors/          Uptime monitor configuration and results
│   └── api/monitor-tick/      Scheduled monitor execution endpoint
├── components/                Application shell and reusable UI components
├── db/                        D1 queries for auth, logs, incidents, monitors, and teams
├── drizzle/                   Immutable D1 schema migrations
├── lib/                       Parsers, analyzers, redaction, security, and uptime logic
├── scripts/                   Migration, deployment, monitoring, and integration scripts
├── tests/                     Node-based unit and security tests
├── public/                    Static assets and social preview image
├── .openai/hosting.json       OpenAI Sites project configuration
├── wrangler.production.jsonc  Cloudflare Worker, D1, and R2 bindings
└── package.json               Commands and dependencies
```

### Persistence model

| Data | Storage | Notes |
| --- | --- | --- |
| Uploaded source file | R2 | Stored privately after secrets and sensitive fields are redacted |
| Normalized log events | D1 | Parsed server-side and linked to an ingestion run and workspace |
| Incidents and evidence | D1 | Fingerprints, timelines, related logs, severity, assignments, and status |
| Operational data | D1 | Accounts, teams, comments, monitors, telemetry, deployments, SLOs, and postmortems |

## Local setup

### Requirements

- Node.js 22.13 or newer
- npm

### Start the application

```bash
git clone https://github.com/bharath-ganga/CrashLens.git
cd CrashLens
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

After the first development start creates the local D1 emulator, apply the SQL migrations:

```bash
node scripts/migrate-local.mjs
```

Restart the development server after changing `.dev.vars`.

## Cloudflare deployment

The production Worker uses these resources:

- Worker: `crashlens-production`
- D1 database: `crashlens-production-db` with binding `DB`
- Private R2 bucket: `crashlens-production-files` with binding `FILES`
- Live application: [crashlens-production.bharathganga7.workers.dev](https://crashlens-production.bharathganga7.workers.dev/)

Authenticate Wrangler, apply the committed migrations, and deploy:

```bash
npx wrangler login
npm run migrate:cloudflare
npm run deploy:cloudflare
```

Add production credentials with `npx wrangler secret put VARIABLE_NAME`. Set `APP_ORIGIN` to the final `https://...workers.dev` or custom-domain origin. Do not upload the local `.dev.vars` file unchanged because its origin may point to localhost.

The browser calls APIs on the same Worker origin, so separate browser CORS rules are not required. R2 remains private and is accessed through the Worker's `FILES` binding; no public bucket URL or R2 CORS policy is needed.

## Environment configuration

Copy the example file and add only the values you need:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

Important server-only variables:

| Variable                | Purpose                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `RESEND_API_KEY`        | Sends security, password-reset, and incident emails           |
| `EMAIL_FROM`            | Verified sender, for example `CrashLens <alerts@example.com>` |
| `APP_ORIGIN`            | Exact application origin used in account links                |
| `ADMIN_EMAILS`          | Comma-separated administrator email allowlist                 |
| `INGESTION_TOKEN`       | Protects machine log, trace, and deployment ingestion         |
| `INGESTION_TEAM_ID`     | Routes machine data into the correct team workspace           |
| `MONITOR_CRON_TOKEN`    | Authenticates the external uptime runner                      |
| `SLACK_WEBHOOK_URL`     | Optional Slack incident notifications                         |
| `PAGERDUTY_ROUTING_KEY` | Optional PagerDuty Events API integration                     |
| `ALERT_WEBHOOK_URL`     | Optional lifecycle-event destination                          |
| `ALERT_WEBHOOK_SECRET`  | Signs lifecycle webhooks using HMAC-SHA256                    |
| `OPENAI_API_KEY`        | Optional LLM-assisted investigation                           |

Never commit `.dev.vars`, API keys, database URLs, or webhook secrets.

## Using real data

### Test log investigation

1. Open CrashLens and select **Upload source**.
2. Upload a log export from your application or observability provider.
3. Wait while the Worker parses, redacts, fingerprints, and persists the file server-side.
4. Open a generated incident and review its timeline, related logs, evidence, and possible trigger.
5. Refresh or sign in again to confirm the investigation is still available from D1 and R2.

### Test production intelligence

1. Create an account or sign in.
2. Open **Intelligence** in the sidebar.
3. Configure `INGESTION_TOKEN` and `INGESTION_TEAM_ID`.
4. Send real application traces to `POST /api/telemetry`.
5. Send release events from CI/CD to `POST /api/deployments`.
6. Review request paths, anomalies, possible deployment triggers, and reliability targets.
7. Select **Generate report** to save and download a Markdown postmortem.

## API examples

Machine endpoints require `X-CrashLens-Ingest-Token`. Configure `INGESTION_TEAM_ID` using the team ID returned by authenticated `GET /api/workspace`; otherwise external data will not appear in the expected workspace.

### Send traces

```bash
curl -X POST https://your-crashlens-host/api/telemetry \
  -H "Content-Type: application/json" \
  -H "X-CrashLens-Ingest-Token: YOUR_TOKEN" \
  -d '{
    "spans": [{
      "spanId": "SPAN_ID",
      "traceId": "TRACE_ID",
      "service": "YOUR_SERVICE",
      "operation": "REQUEST_NAME",
      "status": "ok",
      "startedAt": "2026-09-16T10:00:00Z",
      "durationMs": 125,
      "environment": "production"
    }]
  }'
```

The endpoint accepts up to 5,000 spans per request and stores bounded attributes, trace relationships, service, operation, status, timestamp, duration, and environment.

### Record a deployment

```bash
curl -X POST https://your-crashlens-host/api/deployments \
  -H "Content-Type: application/json" \
  -H "X-CrashLens-Ingest-Token: YOUR_TOKEN" \
  -d '{
    "service": "payment-service",
    "version": "checkout-v318",
    "environment": "production",
    "status": "success",
    "actor": "github-actions"
  }'
```

### Send structured logs

```bash
curl -X POST https://your-crashlens-host/api/ingest \
  -H "Content-Type: application/json" \
  -H "X-CrashLens-Ingest-Token: YOUR_TOKEN" \
  -d '{
    "source": "payment-service",
    "logs": [
      {
        "timestamp": "2026-09-14T14:32:00Z",
        "level": "error",
        "service": "payment-service",
        "message": "Database connection timeout"
      }
    ]
  }'
```

## Email behavior

Account creation and password sign-in do not require email verification. Password recovery does require a configured and verified sender.

- Verification links expire after one hour.
- Password-reset links expire after 30 minutes.
- Tokens are single-use and stored as SHA-256 digests.
- Resetting a password invalidates existing sessions.
- Login notifications remain in the outbox when email delivery is unavailable.
- Provider acceptance means that Resend accepted the request; it does not guarantee inbox delivery.

Resend configuration:

1. Create a Resend account.
2. Verify a sender domain.
3. Create a sending API key.
4. Add `RESEND_API_KEY`, `EMAIL_FROM`, and `APP_ORIGIN` to `.dev.vars` locally and to the hosting environment in production.

## Uptime runner

The browser is not an always-on scheduler. An external process must call the monitor tick endpoint once per minute:

```bash
node scripts/monitor-runner.mjs
```

Use `--once` to execute one tick. The runner requires `CRASHLENS_URL` and the same `MONITOR_CRON_TOKEN` configured on the application.

The Sites deployment is currently owner-private. That access gate is separate from `MONITOR_CRON_TOKEN`, so an external runner also needs a hosting arrangement that supports machine access. Do not claim unattended monitoring until the runner can reach the deployed endpoint.

## Security design

- Passwords use salted PBKDF2-SHA256 with 100,000 iterations.
- Sessions use random tokens and HTTP-only, SameSite cookies; production cookies are Secure.
- Authentication endpoints are rate limited.
- Uploaded content is redacted before D1/R2 persistence.
- Monitor targets are HTTPS-only.
- Credentials, query strings, redirects, private IP literals, and private DNS answers are rejected for monitors.
- Sensitive request headers and oversized responses are blocked.
- Alert webhooks can be signed using HMAC-SHA256.
- Administrator APIs validate the email allowlist on every request.

Security controls reduce risk but do not replace a dedicated security review before opening the service to untrusted public users.

## Database migrations

Committed migrations live in [`drizzle`](./drizzle):

- `0001_production_foundation.sql` — teams, incidents, logs, integrations, and audit records
- `0002_monitoring_email.sql` — monitoring and email delivery
- `0003_accounts.sql` — separate CrashLens accounts and sessions
- `0004_uptime_control.sql` — projects, advanced checks, regions, and evidence
- `0005_production_intelligence.sql` — traces, deployments, SLOs, and postmortems
- `0006_remove_demo_data.sql` — removes legacy seeded demonstration records
- `0007_persistent_server_ingestion.sql` — persists ingestion runs and normalized server-parsed logs

Sites applies committed migrations during publishing. For local development, use `node scripts/migrate-local.mjs` after the local emulator has been created.

## Verification

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

For authenticated local integration checks, start the development server, apply migrations, and run:

```bash
node --experimental-strip-types scripts/test-local.mjs
```

The integration script creates disposable local fixtures and removes only those fixtures. It does not send real emails.

## Current limitations

- Deployment correlation is time-and-service-based evidence, not causal proof.
- Automatic monitoring requires a reachable external scheduler.
- True multi-region consensus requires runners deployed in multiple regions.
- Email delivery and third-party alerts require separately configured provider credentials.
- The OpenAI Sites preview remains owner-private; the Cloudflare production URL is public and protects workspace data with application authentication.

## Resume summary

> Built CrashLens, a full-stack production observability platform using React, TypeScript, Cloudflare Workers, D1, R2, and Resend. Implemented server-side log ingestion and persistence, secure authentication, incident clustering, distributed tracing, deployment correlation, SLO/error-budget tracking, uptime monitoring, multi-channel alerts, team collaboration, and automated postmortem generation.

## License

This repository does not currently declare an open-source license. Add a license before allowing third parties to reuse or redistribute the project.
