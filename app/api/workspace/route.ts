import { audit, authenticatedUser, ensureDatabase, ensureWorkspace, getRuntimeEnv } from '@/db/runtime';
import { saveAnalysis } from '@/db/incidents';
import { emailConfigured, queueEmail, flushEmails } from '@/db/email';

export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function textValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

async function context(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return null;
  const runtime = getRuntimeEnv();
  await ensureDatabase(runtime.DB);
  const teamId = await ensureWorkspace(runtime.DB, user);
  return { user, runtime, teamId };
}

export async function GET(request: Request) {
  const ctx = await context(request);
  if (!ctx) return json({ error: 'Authentication required' }, 401);
  const [incidents, comments, connectors, invites, auditEvents, members, ingestionCount] = await Promise.all([
    ctx.runtime.DB.prepare(`SELECT i.*, u.name AS assignee_name FROM incidents i LEFT JOIN users u ON u.id = i.assigned_to WHERE i.team_id = ? ORDER BY i.updated_at DESC LIMIT 100`).bind(ctx.teamId).all(),
    ctx.runtime.DB.prepare(`SELECT c.*, u.name AS user_name, u.email AS user_email FROM comments c LEFT JOIN users u ON u.id = c.user_id JOIN incidents i ON i.id = c.incident_id WHERE i.team_id = ? ORDER BY c.created_at DESC LIMIT 200`).bind(ctx.teamId).all(),
    ctx.runtime.DB.prepare('SELECT id, type, name, status, config_json, created_at, updated_at FROM connectors WHERE team_id = ? ORDER BY created_at DESC').bind(ctx.teamId).all(),
    ctx.runtime.DB.prepare('SELECT id, email, role, status, created_at FROM team_invites WHERE team_id = ? ORDER BY created_at DESC').bind(ctx.teamId).all(),
    ctx.runtime.DB.prepare('SELECT action, target_type, target_id, metadata_json, created_at FROM audit_events WHERE team_id = ? ORDER BY created_at DESC LIMIT 50').bind(ctx.teamId).all(),
    ctx.runtime.DB.prepare(`SELECT u.id, u.email, u.name, tm.role FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ?`).bind(ctx.teamId).all(),
    ctx.runtime.DB.prepare('SELECT COUNT(*) AS count FROM ingestions WHERE team_id = ?').bind(ctx.teamId).first<{ count: number }>(),
  ]);
  return json({
    user: ctx.user, team: { id: ctx.teamId, name: 'CrashLens Operations' }, incidents: incidents.results,
    comments: comments.results, connectors: connectors.results, invites: invites.results, members: members.results,
    auditEvents: auditEvents.results, ingestionCount: ingestionCount?.count ?? 0,
    capabilities: {
      database: true, objectStorage: true,
      openai: Boolean(ctx.runtime.OPENAI_API_KEY), slack: Boolean(ctx.runtime.SLACK_WEBHOOK_URL),
      email: emailConfigured(ctx.runtime),
      externalIngestion: Boolean(ctx.runtime.INGESTION_TOKEN), piiRedaction: true,
    },
  });
}

export async function POST(request: Request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return json({error:'Invalid origin'},403);
  const ctx = await context(request);
  if (!ctx) return json({ error: 'Authentication required' }, 401);
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 6 * 1024 * 1024) return json({ error: 'Payload exceeds 6 MB' }, 413);
  const body = await request.json() as Record<string, unknown>;
  const action = textValue(body.action);

  if (action === 'save_analysis') {
    const payload = body.payload as Parameters<typeof saveAnalysis>[3];
    if (!payload?.filename || !Array.isArray(payload.incidents)) return json({ error: 'Invalid analysis payload' }, 400);
    const ingestionId = await saveAnalysis(ctx.runtime, ctx.teamId, ctx.user.id, payload);
    return json({ ok: true, ingestionId }, 201);
  }
  if (action === 'update_incident') {
    const incidentId = textValue(body.incidentId);
    const status = textValue(body.status, 'investigating');
    const allowed = ['investigating', 'monitoring', 'resolved'];
    if (!incidentId || !allowed.includes(status)) return json({ error: 'Invalid incident update' }, 400);
    await ctx.runtime.DB.prepare('UPDATE incidents SET status = ?, assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND team_id = ?')
      .bind(status, textValue(body.assignedTo) || null, incidentId, ctx.teamId).run();
    await audit(ctx.runtime.DB, ctx.teamId, ctx.user.id, 'incident.updated', 'incident', incidentId, { status, assignedTo: body.assignedTo ?? null });
    return json({ ok: true });
  }
  if (action === 'comment') {
    const incidentId = textValue(body.incidentId);
    const comment = textValue(body.comment).trim().slice(0, 2000);
    if (!incidentId || !comment) return json({ error: 'Comment and incident are required' }, 400);
    const exists = await ctx.runtime.DB.prepare('SELECT id FROM incidents WHERE id = ? AND team_id = ?').bind(incidentId, ctx.teamId).first();
    if (!exists) return json({ error: 'Incident not found' }, 404);
    const id = crypto.randomUUID();
    await ctx.runtime.DB.prepare('INSERT INTO comments (id, incident_id, user_id, body) VALUES (?, ?, ?, ?)').bind(id, incidentId, ctx.user.id, comment).run();
    await audit(ctx.runtime.DB, ctx.teamId, ctx.user.id, 'comment.created', 'incident', incidentId);
    return json({ ok: true, id }, 201);
  }
  if (action === 'invite') {
    const email = textValue(body.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email' }, 400);
    const id = crypto.randomUUID();
    await ctx.runtime.DB.prepare('INSERT INTO team_invites (id, team_id, email, role, invited_by) VALUES (?, ?, ?, ?, ?)').bind(id, ctx.teamId, email, textValue(body.role, 'member'), ctx.user.id).run();
    await audit(ctx.runtime.DB, ctx.teamId, ctx.user.id, 'team.invited', 'invite', id, { email });
    return json({ ok: true, id }, 201);
  }
  if (action === 'connector') {
    const type = textValue(body.type).toLowerCase();
    const allowed = ['docker', 'kubernetes', 'cloudwatch', 'sentry', 'datadog', 'webhook', 'slack', 'email', 'openai'];
    if (!allowed.includes(type)) return json({ error: 'Unsupported connector' }, 400);
    const existing = await ctx.runtime.DB.prepare('SELECT id FROM connectors WHERE team_id = ? AND type = ?').bind(ctx.teamId, type).first<{ id: string }>();
    const id = existing?.id ?? crypto.randomUUID();
    const status = ['openai', 'slack', 'email'].includes(type) ? 'awaiting_secret' : 'ready_for_credentials';
    await ctx.runtime.DB.prepare(`INSERT INTO connectors (id, team_id, type, name, status, config_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status, config_json = excluded.config_json, updated_at = CURRENT_TIMESTAMP`)
      .bind(id, ctx.teamId, type, textValue(body.name, type), status, JSON.stringify(body.config ?? {}), ctx.user.id).run();
    await audit(ctx.runtime.DB, ctx.teamId, ctx.user.id, 'connector.configured', 'connector', id, { type });
    return json({ ok: true, id, status }, existing ? 200 : 201);
  }
  if (action === 'ai_analysis') {
    if (!ctx.runtime.OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY is not configured', configured: false }, 503);
    const incident = body.incident as Record<string, unknown>;
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${ctx.runtime.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.4-mini', input: `Analyze this production incident. Return a concise root cause, evidence, and three safe next actions. Incident: ${JSON.stringify(incident).slice(0, 12000)}` }),
    });
    if (!response.ok) return json({ error: 'OpenAI analysis request failed' }, 502);
    const result = await response.json() as { output_text?: string };
    return json({ analysis: result.output_text ?? 'No analysis returned', configured: true });
  }
  if (action === 'test_slack') {
    if (!ctx.runtime.SLACK_WEBHOOK_URL) return json({ error: 'SLACK_WEBHOOK_URL is not configured', configured: false }, 503);
    const response = await fetch(ctx.runtime.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '✅ CrashLens alert connection verified.' }) });
    if (!response.ok) return json({ error: 'Slack rejected the test alert' }, 502);
    return json({ ok: true, configured: true });
  }
  if (action === 'test_email') {
    if (!emailConfigured(ctx.runtime)) return json({error:'Configure RESEND_API_KEY and EMAIL_FROM first.',configured:false},503);
    await queueEmail(ctx.runtime,ctx.teamId,ctx.user.email,`test:${ctx.user.id}:${Math.floor(Date.now()/60000)}`,'CrashLens email test','Your CrashLens email test was requested successfully.');
    const delivery = await flushEmails(ctx.runtime);
    return json({ok:true,delivery});
  }
  return json({ error: 'Unknown action' }, 400);
}
