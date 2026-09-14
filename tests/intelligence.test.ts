import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPostmortem,
  calculateAnomaly,
  correlateDeployment,
  errorBudgetPercent,
} from '../lib/intelligence.ts';

void test('detects a meaningful error spike', () => {
  assert.deepEqual(calculateAnomaly(9, 3), {
    detected: true,
    changePercent: 200,
  });
  assert.equal(calculateAnomaly(2, 0).detected, false);
});

void test('correlates only a recent deployment for the same service', () => {
  const match = correlateDeployment('payment-service', '2026-09-14T14:32:00Z', [
    {
      id: 'd1',
      service: 'payment-service',
      version: '318',
      environment: 'production',
      status: 'success',
      deployedAt: '2026-09-14T14:26:00Z',
    },
    {
      id: 'd2',
      service: 'catalog-service',
      version: '99',
      environment: 'production',
      status: 'success',
      deployedAt: '2026-09-14T14:30:00Z',
    },
  ]);
  assert.equal(match?.version, '318');
});

void test('calculates remaining error budget', () => {
  assert.equal(errorBudgetPercent(999, 1000, 99.9), 0);
  assert.equal(errorBudgetPercent(1000, 1000, 99.9), 100);
});

void test('postmortem states that correlation needs human confirmation', () => {
  const report = buildPostmortem({
    title: 'Checkout failures',
    service: 'payment-service',
    startedAt: '2026-09-14T14:32:00Z',
  });
  assert.match(report, /engineer must confirm/i);
});
