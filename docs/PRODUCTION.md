# CrashLens production setup

CrashLens has a complete deployable foundation: authenticated workspaces, D1 incident history, R2 log archives, audit events, team comments and assignment, token-protected ingestion, PII redaction, health monitoring, and optional OpenAI/Slack integrations.

## Runtime secrets

Add these to the deployment environment. Never put their values in Git.

- `INGESTION_TOKEN`: protects `POST /api/ingest` for Docker, Kubernetes, CloudWatch, Sentry, Datadog, or custom collectors.
- `OPENAI_API_KEY`: enables the OpenAI root-cause analysis action.
- `SLACK_WEBHOOK_URL`: enables test and incident Slack notifications.
- `RESEND_API_KEY`: server-only Resend sending key. Store it as an encrypted deployment secret; valid keys begin with `re_`.
- `EMAIL_FROM`: sender mailbox on a domain verified in Resend, for example `CrashLens <alerts@mail.yourdomain.com>`.
- `APP_ORIGIN`: public HTTPS origin used in transactional email links.
- `RESEND_WEBHOOK_SECRET`: signing secret for the Resend webhook at `/api/email-webhook`.
- `SUPPORT_EMAIL`: support address displayed in transactional email footers.
- `PRIVACY_URL`: public privacy-notice URL displayed in transactional email footers.
- `COMPANY_NAME`: legal or product name displayed in transactional email branding.
- `MONITOR_CRON_TOKEN`: random server-only token used by the Cloudflare scheduled handler.
- `EMAIL_WEBHOOK_URL`: optional legacy webhook used only for critical-ingestion alerts.

For local tests only, `EMAIL_FROM=CrashLens <onboarding@resend.dev>` can send to the address associated with the Resend account. Production and delivery to arbitrary recipients require a verified domain. Do not place a real API key in `.env.example`, `.dev.vars.example`, Wrangler configuration, source control, or logs.

After configuring the deployment, redeploy CrashLens and run the email connection test from the application. The test reports invalid keys, sender/domain problems, permissions, rate limits, and quota failures without exposing credentials or message content. Delivery uses Resend idempotency keys and the persistent outbox retry policy.

Configure the Resend webhook for `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`, `suppression.added`, and `suppression.removed`. CrashLens verifies every webhook signature, records sanitized delivery events, and suppresses recipients after bounce, complaint, or provider suppression. Security email cannot be disabled through user preferences.

The Cloudflare deployment uses a one-minute Cron Trigger. It runs uptime checks, retries queued mail, and prepares opted-in daily or weekly incident summaries. SPF and DKIM must be verified for the sending domain. Publish a DMARC TXT record at `_dmarc.<sending-domain>` before moving from monitoring to enforcement.

## External ingestion format

Send `POST /api/ingest` with header `x-crashlens-ingest-token` and JSON:

```json
{
  "source": "payment-service",
  "logs": [
    {
      "timestamp": "2026-09-02T14:32:00Z",
      "level": "error",
      "service": "payment-service",
      "message": "Payment request timed out"
    }
  ]
}
```

The API accepts 1–5000 records per request, normalizes and redacts them, groups incidents, saves metadata to D1, and archives the redacted payload in R2.

## Local verification

```bash
npm test
npm run lint
npm run build
```
