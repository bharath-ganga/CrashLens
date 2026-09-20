import type { CrashLensEnv } from './runtime';
import { emailConfigured, queueTeamEmail } from './email';

type Lifecycle = {
  event: 'opened' | 'resolved' | 'acknowledged';
  id: string;
  teamId: string;
  monitor: string;
  service: string;
  url: string;
  detail: string;
  occurredAt: string;
};

async function hmac(secret: string, body: string) {
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

export function notificationCapabilities(env: CrashLensEnv) {
  return {
    email: emailConfigured(env),
    slack: Boolean(env.SLACK_WEBHOOK_URL),
    pagerduty: Boolean(env.PAGERDUTY_ROUTING_KEY),
    webhook: Boolean(env.ALERT_WEBHOOK_URL && env.ALERT_WEBHOOK_SECRET),
  };
}

export async function notifyLifecycle(env: CrashLensEnv, incident: Lifecycle) {
  const subject = `${incident.event.toUpperCase()}: ${incident.monitor}`;
  const body = `${incident.monitor} (${incident.service}) — ${incident.detail}\nEndpoint: ${incident.url}\nTime: ${incident.occurredAt}\nOpen CrashLens History for evidence.`;
  await queueTeamEmail(
    env,
    incident.teamId,
    `${incident.event}:${incident.id}`,
    subject,
    body,
  );
  const jobs: Promise<unknown>[] = [];
  if (env.SLACK_WEBHOOK_URL)
    jobs.push(
      fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `*${subject}*\n${body}` }),
        signal: AbortSignal.timeout(10000),
      }),
    );
  if (env.PAGERDUTY_ROUTING_KEY)
    jobs.push(
      fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routing_key: env.PAGERDUTY_ROUTING_KEY,
          event_action: incident.event === 'opened' ? 'trigger' : 'resolve',
          dedup_key: incident.id,
          payload: {
            summary: subject,
            source: 'CrashLens',
            severity: 'critical',
            custom_details: {
              service: incident.service,
              url: incident.url,
              detail: incident.detail,
            },
          },
        }),
        signal: AbortSignal.timeout(10000),
      }),
    );
  if (env.ALERT_WEBHOOK_URL && env.ALERT_WEBHOOK_SECRET) {
    const payload = JSON.stringify({
      type: `incident.${incident.event}`,
      incident,
    });
    jobs.push(
      hmac(env.ALERT_WEBHOOK_SECRET, payload).then((signature) =>
        fetch(env.ALERT_WEBHOOK_URL!, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CrashLens-Signature': `sha256=${signature}`,
          },
          body: payload,
          signal: AbortSignal.timeout(10000),
        }),
      ),
    );
  }
  await Promise.allSettled(jobs);
}
