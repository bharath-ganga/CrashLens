import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_LOG_FILE_BYTES,
  MAX_LOG_FILE_MB,
  MAX_WORKSPACE_PAYLOAD_BYTES,
} from '../lib/upload-limits.ts';

void test('accepts log files and analyzed workspace payloads up to 50 MB', () => {
  assert.equal(MAX_LOG_FILE_MB, 50);
  assert.equal(MAX_LOG_FILE_BYTES, 50 * 1024 * 1024);
  assert.equal(MAX_WORKSPACE_PAYLOAD_BYTES, MAX_LOG_FILE_BYTES);
});
