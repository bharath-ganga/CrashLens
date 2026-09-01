import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeLogs, parseLogContent, SAMPLE_JSONL } from '../lib/log-analyzer.ts';

void test('parses JSONL and groups related production failures', () => {
  const logs = parseLogContent(SAMPLE_JSONL, 'sample.jsonl');
  const incidents = analyzeLogs(logs);
  assert.ok(logs.length >= 10);
  assert.ok(incidents.length >= 3);
  assert.ok(incidents.some((incident) => incident.service === 'payment-service'));
  assert.ok(incidents.every((incident) => incident.timeline.length > 0));
});

void test('parses CSV fields into normalized entries', () => {
  const logs = parseLogContent('timestamp,level,service,message\n2026-01-01T00:00:00Z,error,api,connection refused', 'events.csv');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].service, 'api');
  assert.equal(logs[0].level, 'error');
});
