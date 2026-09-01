import assert from 'node:assert/strict';
import test from 'node:test';
import { redactSensitiveData } from '../lib/security.ts';

void test('redacts common sensitive values before persistence', () => {
  const value = redactSensitiveData('email=dev@example.com token=abc123 ip=10.2.3.4 card=4111 1111 1111 1111');
  assert.equal(value.includes('dev@example.com'), false);
  assert.equal(value.includes('abc123'), false);
  assert.equal(value.includes('10.2.3.4'), false);
  assert.equal(value.includes('4111 1111 1111 1111'), false);
});
