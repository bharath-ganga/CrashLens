# CrashLens production setup

CrashLens has a complete deployable foundation: authenticated workspaces, D1 incident history, R2 log archives, audit events, team comments and assignment, token-protected ingestion, PII redaction, health monitoring, and optional OpenAI/Slack integrations.

## Runtime secrets

Add these to the deployment environment. Never put their values in Git.

- `INGESTION_TOKEN`: protects `POST /api/ingest` for Docker, Kubernetes, CloudWatch, Sentry, Datadog, or custom collectors.
- `OPENAI_API_KEY`: enables the OpenAI root-cause analysis action.
- `SLACK_WEBHOOK_URL`: enables test and incident Slack notifications.

Email delivery and vendor collectors need the chosen provider credentials. The dashboard records connector readiness without pretending those external accounts are connected.

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
