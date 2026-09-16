import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeLogs, parseLogContent } from '../lib/log-analyzer.ts';

void test('parses JSONL and groups related production failures', () => {
  const fixture = [
    '{"timestamp":"2026-01-01T00:00:00Z","level":"error","service":"payment-service","message":"connection timeout request=1"}',
    '{"timestamp":"2026-01-01T00:00:01Z","level":"error","service":"payment-service","message":"connection timeout request=2"}',
    '{"timestamp":"2026-01-01T00:00:02Z","level":"error","service":"payment-service","message":"connection timeout request=3"}',
  ].join('\n');
  const logs = parseLogContent(fixture, 'test-fixture.jsonl');
  const incidents = analyzeLogs(logs);
  assert.equal(logs.length, 3);
  assert.ok(incidents.length >= 1);
  assert.ok(
    incidents.some((incident) => incident.service === 'payment-service'),
  );
  assert.ok(incidents.every((incident) => incident.timeline.length > 0));
});

void test('parses CSV fields into normalized entries', () => {
  const logs = parseLogContent(
    'timestamp,level,service,message\n2026-01-01T00:00:00Z,error,api,connection refused',
    'events.csv',
  );
  assert.equal(logs.length, 1);
  assert.equal(logs[0].service, 'api');
  assert.equal(logs[0].level, 'error');
});

void test('detects JSON records inside .log files without inventing deployments', () => {
  const fixture = [
    JSON.stringify({
      level: 'info',
      time: '2026-09-13T19:00:00.000Z',
      app: 'apple-music-covers-api',
      version: '1.2.0',
      event: 'http.request.start',
      requestId: 'request-1',
      msg: 'Request received',
    }),
    JSON.stringify({
      level: 'warn',
      time: '2026-09-13T19:00:01.000Z',
      app: 'apple-music-covers-api',
      version: '1.2.0',
      event: 'rate_limit.threshold_exceeded',
      requestId: 'request-1',
      msg: 'Rate limit exceeded',
    }),
    JSON.stringify({
      level: 'warn',
      time: '2026-09-13T19:00:01.001Z',
      app: 'apple-music-covers-api',
      version: '1.2.0',
      event: 'api.error.operational',
      requestId: 'request-1',
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded',
      },
      msg: 'Operational error occurred',
    }),
  ].join('\n');

  const logs = parseLogContent(fixture, 'production.log');
  const incidents = analyzeLogs(logs);
  assert.equal(logs.length, 3);
  assert.equal(logs[0].message, 'Request received');
  assert.equal(logs[2].message, '[RATE_LIMIT_EXCEEDED] Rate limit exceeded');
  assert.equal(incidents[0].title, 'Rate limit errors');
  assert.equal(incidents[0].logs.length, 2);
  assert.equal(incidents[0].trigger, 'No correlated change found');
  assert.equal(
    incidents[0].timeline.some((event) => event.type === 'deploy'),
    false,
  );
});
