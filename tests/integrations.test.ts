import assert from 'node:assert/strict';
import test from 'node:test';
import {
  integrationRequest,
  type IntegrationEvent,
} from '../db/integrations.ts';
import type { CrashLensEnv } from '../db/runtime.ts';

const event: IntegrationEvent = {
  event: 'opened',
  id: '6f73cb3e-3e8d-41d8-90ea-bfe5f55e39b2',
  teamId: 'team-1',
  title: 'Database connection timeout',
  service: 'checkout',
  severity: 'critical',
  detail: 'Connection pool exhausted after deployment.',
  environment: 'production',
  release: '2026.09.22',
  url: 'https://crashlens.example/incidents/1',
};

function environment(values: Record<string, string>) {
  return values as unknown as CrashLensEnv;
}

function bodyText(body: BodyInit | null | undefined) {
  if (typeof body !== 'string') throw new Error('Expected a string body');
  return body;
}

void test('maps a crash to a useful deduplicated PagerDuty event', async () => {
  const request = await integrationRequest(
    'pagerduty',
    event,
    environment({ PAGERDUTY_ROUTING_KEY: 'routing-secret' }),
  );
  const body = JSON.parse(bodyText(request.init.body)) as Record<
    string,
    unknown
  >;
  assert.equal(body.dedup_key, event.id);
  assert.equal(body.event_action, 'trigger');
  assert.equal(request.url, 'https://events.pagerduty.com/v2/enqueue');
});

void test('maps incident metadata into a GitHub issue without leaking the token', async () => {
  const request = await integrationRequest(
    'github',
    event,
    environment({
      GITHUB_TOKEN: 'github-secret',
      GITHUB_REPOSITORY: 'owner/repository',
      GITHUB_LABELS: 'bug,production',
    }),
  );
  const body = JSON.parse(bodyText(request.init.body)) as {
    body: string;
    labels: string[];
  };
  assert.match(body.body, /checkout/);
  assert.match(body.body, /2026\.09\.22/);
  assert.deepEqual(body.labels, ['bug', 'production']);
  assert.doesNotMatch(JSON.stringify(body), /github-secret/);
});

void test('signs generic webhook payloads and preserves an idempotency key', async () => {
  const request = await integrationRequest(
    'webhook',
    event,
    environment({
      ALERT_WEBHOOK_URL: 'https://hooks.example/incidents',
      ALERT_WEBHOOK_SECRET: 'webhook-secret',
    }),
  );
  const headers = request.init.headers as Record<string, string>;
  assert.match(headers['X-CrashLens-Signature'], /^sha256=[a-f0-9]{64}$/);
  assert.equal(headers['Idempotency-Key'], `${event.id}:opened`);
  assert.doesNotMatch(bodyText(request.init.body), /webhook-secret/);
});

void test('maps a redacted incident to the Sentry store protocol', async () => {
  const request = await integrationRequest(
    'sentry',
    event,
    environment({ SENTRY_DSN: 'https://public-key@sentry.example/42' }),
  );
  const body = JSON.parse(bodyText(request.init.body)) as {
    event_id: string;
    environment: string;
    release: string;
    tags: Record<string, string>;
  };
  assert.equal(body.event_id.length, 32);
  assert.equal(body.environment, 'production');
  assert.equal(body.release, '2026.09.22');
  assert.equal(body.tags.service, 'checkout');
});
