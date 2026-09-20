import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBrandedEmailHtml,
  flushEmailsWithClient,
  resendConfiguration,
  type ResendEmailClient,
} from '../db/email.ts';
import type { CrashLensEnv } from '../db/runtime.ts';

function result(changes = 0) {
  return {
    results: [],
    success: true as const,
    meta: {
      changes,
      duration: 0,
      last_row_id: null,
      rows_read: 0,
      rows_written: changes,
    },
  };
}

function emailEnvironment(overrides: Record<string, unknown> = {}) {
  const state = {
    accepted: false,
    failure: '' as string,
  };
  const row = {
    id: 'outbox-123',
    recipient: 'operator@customer.test',
    subject: 'Private incident subject',
    body: 'Private incident payload',
    attempts: 0,
  };
  const DB = {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          args = values;
          return this;
        },
        async all() {
          if (sql.includes("FROM email_outbox WHERE status = 'pending'"))
            return { ...result(), results: [row] };
          return result();
        },
        async first() {
          return null;
        },
        async run() {
          if (sql.includes('SET lease_until = ?')) return result(1);
          if (sql.includes("SET status = 'accepted'")) state.accepted = true;
          if (sql.includes('SET attempts = ?')) state.failure = String(args[3]);
          return result(1);
        },
      };
    },
    async batch() {
      return [];
    },
  };
  const env = {
    DB,
    RESEND_API_KEY: 're_test_123456789',
    EMAIL_FROM: 'CrashLens <alerts@mail.crashlens.dev>',
    ...overrides,
  } as unknown as CrashLensEnv;
  return { env, state, row };
}

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

void test('reports actionable Resend configuration failures', () => {
  assert.match(
    (
      resendConfiguration(emailEnvironment({ RESEND_API_KEY: '' }).env) as {
        error: string;
      }
    ).error,
    /RESEND_API_KEY is missing/,
  );
  assert.match(
    (
      resendConfiguration(
        emailEnvironment({ RESEND_API_KEY: 'bad-key' }).env,
      ) as {
        error: string;
      }
    ).error,
    /begin with "re_"/,
  );
  assert.match(
    (
      resendConfiguration(emailEnvironment({ EMAIL_FROM: '' }).env) as {
        error: string;
      }
    ).error,
    /EMAIL_FROM is missing/,
  );
  assert.match(
    (
      resendConfiguration(
        emailEnvironment({ EMAIL_FROM: 'CrashLens <alerts@example.com>' }).env,
      ) as { error: string }
    ).error,
    /placeholder domain/,
  );
});

void test('sends queued email through the Resend SDK client without a real API call', async (t) => {
  t.mock.method(console, 'info', () => undefined);
  const { env, state } = emailEnvironment();
  let request: Record<string, unknown> | undefined;
  let idempotencyKey: string | undefined;
  const client: ResendEmailClient = {
    emails: {
      async send(message, options) {
        request = message;
        idempotencyKey = options?.idempotencyKey;
        return { data: { id: 'resend-email-123' }, error: null };
      },
    },
  };

  const delivery = await flushEmailsWithClient(env, client);

  assert.deepEqual(delivery, { configured: true, accepted: 1, failed: 0 });
  assert.equal(state.accepted, true);
  assert.equal(request?.from, 'CrashLens <alerts@mail.crashlens.dev>');
  assert.deepEqual(request?.to, ['operator@customer.test']);
  assert.equal(idempotencyKey, 'outbox-123');
});

void test('stores and logs sanitized Resend failures', async (t) => {
  const { env, state, row } = emailEnvironment({
    RESEND_API_KEY: 're_super_secret_key',
  });
  const logs: unknown[][] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => {
    logs.push(args);
  });
  const client: ResendEmailClient = {
    emails: {
      async send() {
        return {
          data: null,
          error: {
            name: 'invalid_api_key',
            statusCode: 403,
            message: 'API key re_super_secret_key rejected',
          },
        };
      },
    },
  };

  const delivery = await flushEmailsWithClient(env, client);
  const serializedLogs = JSON.stringify(logs);

  assert.deepEqual(delivery, {
    configured: true,
    accepted: 0,
    failed: 1,
    error:
      'Resend rejected RESEND_API_KEY. Replace the deployment secret with a valid API key.',
  });
  assert.match(state.failure, /Replace the deployment secret/);
  assert.doesNotMatch(state.failure, /re_super_secret_key/);
  assert.doesNotMatch(serializedLogs, /re_super_secret_key/);
  assert.doesNotMatch(serializedLogs, new RegExp(row.recipient));
  assert.doesNotMatch(serializedLogs, /Private incident/);
});

void test('identifies a Resend 401 validation response as an invalid API key', async (t) => {
  const { env, state } = emailEnvironment();
  t.mock.method(console, 'warn', () => undefined);
  const client: ResendEmailClient = {
    emails: {
      async send() {
        return {
          data: null,
          error: {
            name: 'validation_error',
            statusCode: 401,
            message: 'API key is invalid',
          },
        };
      },
    },
  };

  const delivery = await flushEmailsWithClient(env, client);

  assert.equal(
    delivery.error,
    'Resend rejected RESEND_API_KEY. Replace the deployment secret with a valid API key.',
  );
  assert.match(state.failure, /Replace the deployment secret/);
});
