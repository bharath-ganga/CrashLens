import type { CrashLensEnv } from './runtime';

export type IntegrationEvent = {
  event: 'opened' | 'acknowledged' | 'resolved';
  id: string;
  teamId: string;
  title: string;
  service: string;
  severity: string;
  detail: string;
  environment?: string;
  release?: string;
  url?: string;
};

type Provider =
  | 'slack'
  | 'discord'
  | 'pagerduty'
  | 'webhook'
  | 'sentry'
  | 'github'
  | 'jira'
  | 'otlp';

function configuredProviders(env: CrashLensEnv, event: IntegrationEvent) {
  const lifecycle: Array<[Provider, boolean]> = [
    ['slack', Boolean(env.SLACK_WEBHOOK_URL)],
    ['discord', Boolean(env.DISCORD_WEBHOOK_URL)],
    ['pagerduty', Boolean(env.PAGERDUTY_ROUTING_KEY)],
    ['webhook', Boolean(env.ALERT_WEBHOOK_URL && env.ALERT_WEBHOOK_SECRET)],
    ['otlp', Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT)],
  ];
  if (event.event === 'opened')
    lifecycle.push(
      ['sentry', Boolean(env.SENTRY_DSN)],
      ['github', Boolean(env.GITHUB_TOKEN && env.GITHUB_REPOSITORY)],
      [
        'jira',
        Boolean(
          env.JIRA_BASE_URL &&
          env.JIRA_EMAIL &&
          env.JIRA_API_TOKEN &&
          env.JIRA_PROJECT_KEY,
        ),
      ],
    );
  return lifecycle
    .filter(([, enabled]) => enabled)
    .map(([provider]) => provider);
}

async function signature(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return [
    ...new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function stableEventId(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function integrationRequest(
  provider: Provider,
  event: IntegrationEvent,
  env: CrashLensEnv,
):
  | Promise<{ url: string; init: RequestInit }>
  | { url: string; init: RequestInit } {
  const link = event.url || env.APP_ORIGIN || '';
  const summary = `${event.title} · ${event.service} · ${event.severity.toUpperCase()}`;
  if (provider === 'slack')
    return {
      url: env.SLACK_WEBHOOK_URL!,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*CrashLens ${event.event}*\n${summary}\n${event.detail}\n${link}`,
        }),
      },
    };
  if (provider === 'discord')
    return {
      url: env.DISCORD_WEBHOOK_URL!,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'CrashLens',
          embeds: [
            {
              title: `Incident ${event.event}: ${event.title}`,
              description: event.detail,
              url: link || undefined,
              color: event.severity === 'critical' ? 15158332 : 15844367,
              fields: [
                { name: 'Service', value: event.service, inline: true },
                {
                  name: 'Environment',
                  value: event.environment || 'production',
                  inline: true,
                },
                {
                  name: 'Release',
                  value: event.release || 'unknown',
                  inline: true,
                },
              ],
            },
          ],
        }),
      },
    };
  if (provider === 'pagerduty')
    return {
      url: 'https://events.pagerduty.com/v2/enqueue',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routing_key: env.PAGERDUTY_ROUTING_KEY,
          event_action:
            event.event === 'opened'
              ? 'trigger'
              : event.event === 'resolved'
                ? 'resolve'
                : 'acknowledge',
          dedup_key: event.id,
          payload: {
            summary,
            source: 'CrashLens',
            severity: event.severity === 'critical' ? 'critical' : 'warning',
            custom_details: event,
          },
        }),
      },
    };
  if (provider === 'webhook') {
    const body = JSON.stringify({
      type: `incident.${event.event}`,
      incident: event,
    });
    return signature(env.ALERT_WEBHOOK_SECRET!, body).then((digest) => ({
      url: env.ALERT_WEBHOOK_URL!,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CrashLens-Signature': `sha256=${digest}`,
          'X-CrashLens-Event': `incident.${event.event}`,
          'Idempotency-Key': `${event.id}:${event.event}`,
        },
        body,
      },
    }));
  }
  if (provider === 'github')
    return {
      url: `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/issues`,
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          title: `[CrashLens] ${event.title}`,
          body: `## CrashLens incident\n\n**Service:** ${event.service}\n**Severity:** ${event.severity}\n**Environment:** ${event.environment || 'production'}\n**Release:** ${event.release || 'unknown'}\n**Signature:** \`${event.id}\`\n\n${event.detail}\n\n${link}`,
          labels: (env.GITHUB_LABELS || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      },
    };
  if (provider === 'jira')
    return {
      url: `${env.JIRA_BASE_URL!.replace(/\/+$/, '')}/rest/api/3/issue`,
      init: {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`)}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            project: { key: env.JIRA_PROJECT_KEY },
            issuetype: { name: env.JIRA_ISSUE_TYPE || 'Bug' },
            summary: `[CrashLens] ${event.title}`,
            description: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: `${summary}\nEnvironment: ${event.environment || 'production'}\nRelease: ${event.release || 'unknown'}\nSignature: ${event.id}\n\n${event.detail}\n${link}`,
                    },
                  ],
                },
              ],
            },
            labels: ['crashlens', event.severity],
          },
        }),
      },
    };
  if (provider === 'sentry') {
    const dsn = new URL(env.SENTRY_DSN!);
    const project = dsn.pathname.replace(/^\//, '');
    return stableEventId(`${event.id}:${event.event}`).then((eventId) => ({
      url: `${dsn.protocol}//${dsn.host}/api/${project}/store/?sentry_version=7&sentry_key=${encodeURIComponent(dsn.username)}`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          timestamp: new Date().toISOString(),
          platform: 'javascript',
          level: event.severity === 'critical' ? 'fatal' : 'error',
          environment: event.environment || 'production',
          release: event.release,
          server_name: event.service,
          message: event.title,
          exception: { values: [{ type: event.title, value: event.detail }] },
          tags: { service: event.service, crashlens_incident: event.id },
        }),
      },
    }));
  }
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT!.replace(/\/+$/, '');
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    headers = {
      ...headers,
      ...JSON.parse(env.OTEL_EXPORTER_OTLP_HEADERS || '{}'),
    };
  } catch {
    /* invalid optional headers are ignored */
  }
  return {
    url: `${endpoint}/v1/logs`,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'CrashLens' } },
              ],
            },
            scopeLogs: [
              {
                scope: { name: 'crashlens.integrations' },
                logRecords: [
                  {
                    timeUnixNano: `${BigInt(Date.now()) * BigInt(1_000_000)}`,
                    severityText: event.severity.toUpperCase(),
                    body: { stringValue: summary },
                    attributes: Object.entries({
                      'incident.id': event.id,
                      'incident.event': event.event,
                      'service.name': event.service,
                      'deployment.environment.name':
                        event.environment || 'production',
                      'service.version': event.release || '',
                    }).map(([key, value]) => ({
                      key,
                      value: { stringValue: value },
                    })),
                  },
                ],
              },
            ],
          },
        ],
      }),
    },
  };
}

export async function queueIntegrationEvent(
  env: CrashLensEnv,
  event: IntegrationEvent,
) {
  for (const provider of configuredProviders(env, event))
    await env.DB.prepare(`INSERT OR IGNORE INTO integration_outbox
      (id,team_id,provider,event_key,payload_json) VALUES (?,?,?,?,?)`)
      .bind(
        crypto.randomUUID(),
        event.teamId,
        provider,
        `${event.id}:${event.event}`,
        JSON.stringify(event).slice(0, 16000),
      )
      .run();
}

export async function flushIntegrationEvents(env: CrashLensEnv) {
  const now = Date.now();
  const rows =
    await env.DB.prepare(`SELECT id,provider,payload_json,attempts FROM integration_outbox
    WHERE status='pending' AND next_attempt_at<=? AND lease_until<? ORDER BY created_at LIMIT 20`)
      .bind(now, now)
      .all<{
        id: string;
        provider: Provider;
        payload_json: string;
        attempts: number;
      }>();
  let delivered = 0;
  let failed = 0;
  for (const row of rows.results) {
    const claim = await env.DB.prepare(
      "UPDATE integration_outbox SET lease_until=? WHERE id=? AND status='pending' AND lease_until<?",
    )
      .bind(now + 60_000, row.id, now)
      .run();
    if (!claim.meta.changes) continue;
    try {
      const request = await integrationRequest(
        row.provider,
        JSON.parse(row.payload_json) as IntegrationEvent,
        env,
      );
      const response = await fetch(request.url, {
        ...request.init,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await env.DB.prepare(
        "UPDATE integration_outbox SET status='delivered',payload_json='',attempts=attempts+1,lease_until=0,last_error=NULL,delivered_at=CURRENT_TIMESTAMP WHERE id=?",
      )
        .bind(row.id)
        .run();
      delivered++;
    } catch {
      const attempts = row.attempts + 1;
      await env.DB.prepare(
        'UPDATE integration_outbox SET attempts=?,status=?,next_attempt_at=?,lease_until=0,last_error=? WHERE id=?',
      )
        .bind(
          attempts,
          attempts >= 5 ? 'failed' : 'pending',
          now + Math.min(3_600_000, 30_000 * 2 ** attempts),
          `${row.provider} delivery failed; retry scheduled.`,
          row.id,
        )
        .run();
      failed++;
    }
  }
  return { queued: rows.results.length, delivered, failed };
}
