# CrashLens

**Production error investigation, distributed tracing, and uptime monitoring in one workspace.**

CrashLens collects application logs and telemetry, removes common sensitive values, groups related failures into incidents, and builds an evidence-based timeline. It helps an engineer answer four questions quickly:

1. What failed?
2. Which service was affected?
3. Did a recent deployment contribute?
4. What should the team investigate next?

> The hosted application is currently owner-private. Run the project locally to explore every feature.

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
Logs / OpenTelemetry / uptime checks / deployment events
                         │
                         ▼
              Normalize and redact data
                         │
                         ▼
             Group related failure signals
                         │
                         ▼
       Correlate traces, changes, and error spikes
                         │
                         ▼
       Incident timeline, alerts, and postmortem
```

CrashLens treats correlations as investigation evidence—not proof of a root cause. An engineer must confirm the final conclusion.

## Main features

### Incident investigation

- Upload `.txt`, `.log`, `.csv`, `.jsonl`, or `.ndjson` files up to 5 MB.
- Parse and normalize timestamps, severity levels, service names, and messages.
- Redact common credentials and sensitive values before persistence.
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

- **Frontend:** React 19, TypeScript, Tailwind CSS, Recharts, Lucide icons
- **Application framework:** vinext
- **Runtime:** Cloudflare Workers
- **Database:** Cloudflare D1 / SQLite
- **Object storage:** Cloudflare R2
- **Email:** Resend
- **Hosting:** OpenAI Sites
- **Quality:** Node test runner, oxlint, TypeScript, oxfmt

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
3. Open the generated incident.
4. Review the analysis, timeline, related logs, and possible trigger.
5. Save the analysis to your authenticated workspace.

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
- The hosted application remains private until its access policy is intentionally changed.

## Resume summary

> Built CrashLens, a full-stack production observability platform using React, TypeScript, Cloudflare Workers, D1, R2, and Resend. Implemented secure authentication, log clustering, distributed tracing, deployment correlation, SLO/error-budget tracking, uptime monitoring, multi-channel alerts, team collaboration, and automated postmortem generation.

## License

This repository does not currently declare an open-source license. Add a license before allowing third parties to reuse or redistribute the project.
