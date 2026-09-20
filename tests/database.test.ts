import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDatabaseRow } from '../db/rows.ts';

void test('normalizes Turso array rows into JSON-safe named objects', () => {
  const row = normalizeDatabaseRow(
    ['id', 'email', 'name'],
    ['user-1', 'operator@example.test', 'Operator'],
  );

  assert.deepEqual(row, {
    id: 'user-1',
    email: 'operator@example.test',
    name: 'Operator',
  });
  assert.equal(
    JSON.stringify(row),
    '{"id":"user-1","email":"operator@example.test","name":"Operator"}',
  );
});

void test('preserves database rows that are already plain objects', () => {
  const row = { id: 'user-1', name: 'Operator' };
  assert.equal(normalizeDatabaseRow(['id', 'name'], row), row);
});
