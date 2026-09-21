import { randomBytes, randomUUID, webcrypto } from 'node:crypto';
import { createClient } from '@tursodatabase/serverless/compat';

const baseUrl = (process.env.E2E_BASE_URL || 'http://localhost:3000').replace(
  /\/$/,
  '',
);
const runId = randomUUID();
const userId = `e2e-${runId}`;
const teamId = `team-${userId}`;
const userEmail = `${userId}@sites.test`;
const accountId = userId;
const accountEmail = userEmail;
const password = `CrashLens-E2E-${runId}`;
const origin = new URL(baseUrl).origin;
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const results = [];
let ingestionId = '';
let sessionCookie = '';

function authHeaders() {
  return sessionCookie ? { Cookie: sessionCookie } : {};
}

async function request(name, path, options = {}, expected = [200]) {
  const response = await fetch(`${baseUrl}${path}`, options);
  let body;
  try {
    body = await response.json();
  } catch {
    body = await response.text();
  }
  const ok = expected.includes(response.status);
  results.push({ name, status: response.status, ok });
  if (!ok)
    throw new Error(
      `${name}: expected ${expected.join('/')} but received ${response.status}: ${JSON.stringify(body).slice(0, 400)}`,
    );
  return { response, body };
}

function jsonOptions(body, authenticated = true) {
  return {
    method: 'POST',
    headers: {
      ...(authenticated ? authHeaders() : {}),
      'Content-Type': 'application/json',
      Origin: origin,
    },
    body: JSON.stringify(body),
  };
}

async function passwordHash(value) {
  const salt = randomBytes(32).toString('hex');
  const key = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(value),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await webcrypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(salt),
      iterations: 100000,
    },
    key,
    256,
  );
  return `pbkdf2-sha256:100000:${salt}:${Buffer.from(bits).toString('hex')}`;
}

async function cleanup() {
  const statements = [
    ['DELETE FROM email_preferences WHERE user_id=?', [accountId]],
    ['DELETE FROM account_sessions WHERE user_id=?', [accountId]],
    ['DELETE FROM account_tokens WHERE user_id=?', [accountId]],
    ['DELETE FROM accounts WHERE id=?', [accountId]],
    [
      'DELETE FROM uptime_checks WHERE monitor_id IN (SELECT id FROM uptime_monitors WHERE team_id=?)',
      [teamId],
    ],
    ['DELETE FROM uptime_monitors WHERE team_id=?', [teamId]],
    ['DELETE FROM monitor_projects WHERE team_id=?', [teamId]],
    [
      'DELETE FROM incident_logs WHERE incident_id IN (SELECT id FROM incidents WHERE team_id=?)',
      [teamId],
    ],
    [
      'DELETE FROM comments WHERE incident_id IN (SELECT id FROM incidents WHERE team_id=?)',
      [teamId],
    ],
    ['DELETE FROM postmortems WHERE team_id=?', [teamId]],
    ['DELETE FROM log_entries WHERE team_id=?', [teamId]],
    ['DELETE FROM incidents WHERE team_id=?', [teamId]],
    ['DELETE FROM ingestions WHERE team_id=?', [teamId]],
    ['DELETE FROM telemetry_spans WHERE team_id=?', [teamId]],
    ['DELETE FROM deployments WHERE team_id=?', [teamId]],
    ['DELETE FROM service_objectives WHERE team_id=?', [teamId]],
    ['DELETE FROM integration_outbox WHERE team_id=?', [teamId]],
    [
      'DELETE FROM email_delivery_events WHERE provider_email_id IN (SELECT provider_email_id FROM email_provider_messages WHERE outbox_id IN (SELECT id FROM email_outbox WHERE recipient=?))',
      [accountEmail],
    ],
    [
      'DELETE FROM email_provider_messages WHERE outbox_id IN (SELECT id FROM email_outbox WHERE recipient=?)',
      [accountEmail],
    ],
    ['DELETE FROM email_outbox WHERE recipient=?', [accountEmail]],
    ['DELETE FROM email_outbox WHERE team_id=?', [teamId]],
    ['DELETE FROM audit_events WHERE team_id=?', [teamId]],
    ['DELETE FROM connectors WHERE team_id=?', [teamId]],
    ['DELETE FROM team_invites WHERE team_id=?', [teamId]],
    ['DELETE FROM team_members WHERE team_id=?', [teamId]],
    ['DELETE FROM teams WHERE id=?', [teamId]],
    ['DELETE FROM users WHERE id=?', [userId]],
    [
      'DELETE FROM auth_limits WHERE key IN (SELECT key FROM auth_limits WHERE 0)',
      [],
    ],
  ];
  await db.batch(
    statements.map(([sql, args]) => ({ sql, args })),
    'write',
  );
}

try {
  await cleanup();
  await request('health', '/api/health', {}, [200]);
  await request(
    'workspace rejects anonymous users',
    '/api/workspace',
    {},
    [401],
  );
  await request('logs reject anonymous users', '/api/logs', {}, [401]);
  await request('monitors reject anonymous users', '/api/monitors', {}, [401]);
  await request(
    'intelligence rejects anonymous users',
    '/api/intelligence',
    {},
    [401],
  );
  await request(
    'admin rejects anonymous users',
    '/api/admin/clients',
    {},
    [401],
  );

  await db.execute({
    sql: 'INSERT INTO accounts (id,email,name,password_hash,verified) VALUES (?,?,?,?,1)',
    args: [
      accountId,
      accountEmail,
      'E2E Account',
      await passwordHash(password),
    ],
  });
  const login = await request(
    'account login',
    '/api/account',
    jsonOptions({ action: 'login', email: accountEmail, password }, false),
    [200],
  );
  const cookie = login.response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('account login did not return a session cookie');
  sessionCookie = cookie;
  const accountHeaders = {
    Cookie: cookie,
    Origin: origin,
    'Content-Type': 'application/json',
  };
  const account = await request(
    'account session',
    '/api/account',
    { headers: { Cookie: cookie } },
    [200],
  );
  if (account.body.user?.email !== accountEmail)
    throw new Error('account session returned the wrong user');
  await request(
    'account preferences',
    '/api/account',
    {
      method: 'POST',
      headers: accountHeaders,
      body: JSON.stringify({
        action: 'update_preferences',
        incidentAlerts: true,
        teamActivity: true,
        productUpdates: false,
        digestFrequency: 'weekly',
      }),
    },
    [200],
  );

  const workspace = await request(
    'workspace bootstrap',
    '/api/workspace',
    { headers: authHeaders() },
    [200],
  );
  if (workspace.body.team?.id !== teamId)
    throw new Error('workspace isolation failed');
  await request(
    'connector record',
    '/api/workspace',
    jsonOptions({ action: 'connector', type: 'discord', name: 'E2E Discord' }),
    [201],
  );
  await request(
    'disabled Slack test',
    '/api/workspace',
    jsonOptions({ action: 'test_slack' }),
    [503],
  );
  await request(
    'disabled AI analysis',
    '/api/workspace',
    jsonOptions({ action: 'ai_analysis', incident: {} }),
    [503],
  );

  const form = new FormData();
  form.set(
    'file',
    new File(
      [
        '{"timestamp":"2026-09-22T00:00:00Z","level":"error","service":"e2e-api","message":"database connection timeout request_id=e2e-1"}\n' +
          '{"timestamp":"2026-09-22T00:00:01Z","level":"error","service":"e2e-api","message":"database connection timeout request_id=e2e-2"}\n' +
          '{"timestamp":"2026-09-22T00:00:02Z","level":"info","service":"e2e-api","message":"request recovered"}\n',
      ],
      `e2e-${runId}.jsonl`,
      { type: 'application/x-ndjson' },
    ),
  );
  const upload = await request(
    'log upload',
    '/api/logs',
    { method: 'POST', headers: authHeaders(), body: form },
    [201],
  );
  ingestionId = upload.body.dataset?.ingestion?.id;
  if (!ingestionId) throw new Error('log upload did not persist an ingestion');
  await request('log readback', '/api/logs', { headers: authHeaders() }, [200]);

  const afterUpload = await request(
    'workspace incident readback',
    '/api/workspace',
    { headers: authHeaders() },
    [200],
  );
  const incidentId = afterUpload.body.incidents?.[0]?.id;
  if (!incidentId) throw new Error('log upload did not create an incident');
  await request(
    'incident comment',
    '/api/workspace',
    jsonOptions({
      action: 'comment',
      incidentId,
      comment: 'Automated E2E verification.',
    }),
    [201],
  );
  await request(
    'incident resolution',
    '/api/workspace',
    jsonOptions({
      action: 'update_incident',
      incidentId,
      status: 'resolved',
      assignedTo: userId,
    }),
    [200],
  );

  await request(
    'telemetry ingestion',
    '/api/telemetry',
    jsonOptions({
      spans: [
        {
          spanId: `span-${runId}`,
          traceId: `trace-${runId}`,
          service: 'e2e-api',
          operation: 'POST /checkout',
          status: 'error',
          startedAt: new Date().toISOString(),
          durationMs: 420,
          environment: 'test',
          attributes: { 'service.version': 'e2e' },
        },
      ],
    }),
    [202],
  );
  await request(
    'deployment ingestion',
    '/api/deployments',
    jsonOptions({
      service: 'e2e-api',
      version: `e2e-${runId}`,
      environment: 'test',
      status: 'success',
      actor: 'E2E suite',
    }),
    [202],
  );
  await request(
    'SLO update',
    '/api/intelligence',
    jsonOptions({
      action: 'set_slo',
      service: 'e2e-api',
      targetPercent: 99.9,
      windowDays: 30,
    }),
    [200],
  );
  await request(
    'intelligence readback',
    '/api/intelligence',
    { headers: authHeaders() },
    [200],
  );
  await request(
    'postmortem generation',
    '/api/intelligence',
    jsonOptions({ action: 'generate_postmortem' }),
    [201],
  );

  const monitorState = await request(
    'monitor list',
    '/api/monitors',
    { headers: authHeaders() },
    [200],
  );
  const projectId = monitorState.body.projects?.[0]?.id;
  const monitor = await request(
    'monitor creation',
    '/api/monitors',
    jsonOptions({
      action: 'create',
      projectId,
      name: 'E2E example',
      url: 'https://example.com',
      service: 'e2e-api',
      interval: 300,
      timeout: 10000,
      expectedMin: 200,
      expectedMax: 399,
      assertionType: 'none',
      headers: '{}',
      tags: 'e2e',
    }),
    [201],
  );
  const monitorId = monitor.body.id;
  await request(
    'monitor update',
    '/api/monitors',
    jsonOptions({
      action: 'update',
      id: monitorId,
      name: 'E2E example updated',
      url: 'https://example.com',
      service: 'e2e-api',
      interval: 300,
      timeout: 10000,
      expectedMin: 200,
      expectedMax: 399,
      assertionType: 'none',
      headers: '{}',
      tags: 'e2e,api',
    }),
    [200],
  );
  await request(
    'monitor pause',
    '/api/monitors',
    jsonOptions({ action: 'pause', id: monitorId }),
    [200],
  );
  await request(
    'monitor resume',
    '/api/monitors',
    jsonOptions({ action: 'resume', id: monitorId }),
    [200],
  );
  await request(
    'monitor live check',
    '/api/monitors',
    jsonOptions({ action: 'check', id: monitorId }),
    [200],
  );
  await request(
    'monitor deletion',
    '/api/monitors',
    jsonOptions({ action: 'delete', id: monitorId }),
    [200],
  );

  await request(
    'token ingestion disabled securely',
    '/api/ingest',
    jsonOptions({ source: 'e2e', logs: [{ message: 'test' }] }, false),
    [401],
  );
  await request(
    'cron endpoint rejects missing token',
    '/api/monitor-tick',
    { method: 'POST' },
    [401],
  );
  await request(
    'Resend webhook reports disabled signing',
    '/api/email-webhook',
    { method: 'POST', body: '{}' },
    [503],
  );
  await request(
    'admin rejects non-admin',
    '/api/admin/clients',
    { headers: authHeaders() },
    [403],
  );
  await request(
    'log deletion',
    `/api/logs?ingestionId=${encodeURIComponent(ingestionId)}`,
    { method: 'DELETE', headers: authHeaders() },
    [200],
  );
  const emptyLogs = await request(
    'log deletion readback',
    '/api/logs',
    { headers: authHeaders() },
    [200],
  );
  if (emptyLogs.body.dataset !== null)
    throw new Error('deleted ingestion remained visible');
  await request(
    'account logout',
    '/api/account',
    {
      method: 'POST',
      headers: accountHeaders,
      body: JSON.stringify({ action: 'logout' }),
    },
    [200],
  );
} finally {
  await cleanup();
  db.close();
}

const failed = results.filter((result) => !result.ok);
console.log(
  JSON.stringify(
    {
      baseUrl,
      passed: results.length - failed.length,
      failed: failed.length,
      results,
    },
    null,
    2,
  ),
);
if (failed.length) process.exitCode = 1;
