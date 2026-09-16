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
