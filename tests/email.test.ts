import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBrandedEmailHtml } from '../db/email.ts';

void test('renders a branded password-reset email with a secure action', () => {
  const html = buildBrandedEmailHtml(
    'CrashLens password reset request',
    'Dear Ganga,\n\nPlease reset your password.\n\nhttps://crashlens.example/account?mode=reset#token=abc\n\nKind regards,\nCrashLens Security Team',
  );

  assert.match(html, /CrashLens password reset request/);
  assert.match(html, />Reset password securely</);
  assert.match(html, /Kind regards/);
  assert.match(html, /CrashLens Security Team/);
});

void test('escapes untrusted email content before rendering HTML', () => {
  const html = buildBrandedEmailHtml(
    'Security notice',
    'Dear <script>alert(1)</script>,',
  );

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
