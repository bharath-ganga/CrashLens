import {
  audit,
  authenticatedUser,
  ensureDatabase,
  ensureWorkspace,
  getRuntimeEnv,
  isPlatformAdmin,
} from '@/db/runtime';
import {
  emailConfigured,
  flushEmails,
  queueEmail,
  queueTeamEmail,
  resendConfiguration,
} from '@/db/email';
import {
  MAX_LOG_FILE_MB,
  MAX_WORKSPACE_PAYLOAD_BYTES,
} from '@/lib/upload-limits';
import { waitUntil } from 'cloudflare:workers';
import {
  flushIntegrationEvents,
  queueIntegrationEvent,
} from '@/db/integrations';

export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function textValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function deliverQueuedEmails(runtime: ReturnType<typeof getRuntimeEnv>) {
  waitUntil(flushEmails(runtime).catch(() => undefined));
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
  const [
    incidents,
    comments,
    connectors,
    invites,
    auditEvents,
    members,
    ingestionCounts,
  ] = await ctx.runtime.DB.batch([
    ctx.runtime.DB.prepare(
      `SELECT i.*, u.name AS assignee_name FROM incidents i LEFT JOIN users u ON u.id = i.assigned_to WHERE i.team_id = ? ORDER BY i.updated_at DESC LIMIT 100`,
    ).bind(ctx.teamId),
    ctx.runtime.DB.prepare(
      `SELECT c.*, u.name AS user_name, u.email AS user_email FROM comments c LEFT JOIN users u ON u.id = c.user_id JOIN incidents i ON i.id = c.incident_id WHERE i.team_id = ? ORDER BY c.created_at DESC LIMIT 200`,
    ).bind(ctx.teamId),
    ctx.runtime.DB.prepare(
      'SELECT id, type, name, status, config_json, created_at, updated_at FROM connectors WHERE team_id = ? ORDER BY created_at DESC',
    ).bind(ctx.teamId),
    ctx.runtime.DB.prepare(
      'SELECT id, email, role, status, created_at FROM team_invites WHERE team_id = ? ORDER BY created_at DESC',
    ).bind(ctx.teamId),
    ctx.runtime.DB.prepare(
      'SELECT action, target_type, target_id, metadata_json, created_at FROM audit_events WHERE team_id = ? ORDER BY created_at DESC LIMIT 50',
    ).bind(ctx.teamId),
    ctx.runtime.DB.prepare(
      `SELECT u.id, u.email, u.name, tm.role FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ?`,
    ).bind(ctx.teamId),
    ctx.runtime.DB.prepare(
      'SELECT COUNT(*) AS count FROM ingestions WHERE team_id = ?',
    ).bind(ctx.teamId),
  ]);
  const ingestionCount = ingestionCounts.results[0] as
    | { count?: number }
    | undefined;
  return json({
    user: ctx.user,
    team: { id: ctx.teamId, name: 'CrashLens Operations' },
    incidents: incidents.results,
    comments: comments.results,
    connectors: connectors.results,
    invites: invites.results,
    members: members.results,
    auditEvents: auditEvents.results,
    ingestionCount: ingestionCount?.count ?? 0,
    capabilities: {
      database: true,
      objectStorage: true,
      openai: Boolean(ctx.runtime.OPENAI_API_KEY),
      slack: Boolean(ctx.runtime.SLACK_WEBHOOK_URL),
      discord: Boolean(ctx.runtime.DISCORD_WEBHOOK_URL),
      sentry: Boolean(ctx.runtime.SENTRY_DSN),
      github: Boolean(
        ctx.runtime.GITHUB_TOKEN && ctx.runtime.GITHUB_REPOSITORY,
      ),
      jira: Boolean(
        ctx.runtime.JIRA_BASE_URL &&
        ctx.runtime.JIRA_EMAIL &&
        ctx.runtime.JIRA_API_TOKEN &&
        ctx.runtime.JIRA_PROJECT_KEY,
      ),
      pagerduty: Boolean(ctx.runtime.PAGERDUTY_ROUTING_KEY),
      outboundWebhook: Boolean(
        ctx.runtime.ALERT_WEBHOOK_URL && ctx.runtime.ALERT_WEBHOOK_SECRET,
      ),
      otlpExport: Boolean(ctx.runtime.OTEL_EXPORTER_OTLP_ENDPOINT),
      email: emailConfigured(ctx.runtime),
      externalIngestion: Boolean(ctx.runtime.INGESTION_TOKEN),
      piiRedaction: true,
      platformAdmin: isPlatformAdmin(ctx.runtime, ctx.user),
    },
  });
}

export async function POST(request: Request) {
  if (
    request.headers.get('origin') &&
    request.headers.get('origin') !== new URL(request.url).origin
  )
    return json({ error: 'Invalid origin' }, 403);
  const ctx = await context(request);
  if (!ctx) return json({ error: 'Authentication required' }, 401);
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_WORKSPACE_PAYLOAD_BYTES)
    return json({ error: `Payload exceeds ${MAX_LOG_FILE_MB} MB` }, 413);
  const body = (await request.json()) as Record<string, unknown>;
  const action = textValue(body.action);

  if (action === 'accept_invite') {
    const inviteId = textValue(body.inviteId);
    const invite = await ctx.runtime.DB.prepare(
      `SELECT id,team_id,role FROM team_invites
       WHERE id=? AND lower(email)=lower(?) AND status='pending'`,
    )
      .bind(inviteId, ctx.user.email)
      .first<{ id: string; team_id: string; role: string }>();
    if (!invite)
      return json(
        { error: 'This invitation is invalid, expired, or already accepted.' },
        404,
      );
    await ctx.runtime.DB.batch([
      ctx.runtime.DB.prepare(
        'INSERT OR IGNORE INTO team_members (team_id,user_id,role) VALUES (?,?,?)',
      ).bind(invite.team_id, ctx.user.id, invite.role),
      ctx.runtime.DB.prepare(
        "UPDATE team_invites SET status='accepted' WHERE id=?",
      ).bind(invite.id),
    ]);
    await audit(
      ctx.runtime.DB,
      invite.team_id,
      ctx.user.id,
      'team.invite_accepted',
      'invite',
      invite.id,
    );
    return json({ ok: true, teamId: invite.team_id });
  }

  if (action === 'save_analysis') {
    return json(
      {
        error:
          'Browser-computed analysis is no longer accepted. Upload the source file to /api/logs.',
      },
      410,
    );
  }
  if (action === 'update_incident') {
    const incidentId = textValue(body.incidentId);
    const status = textValue(body.status, 'investigating');
    const allowed = ['investigating', 'monitoring', 'resolved'];
    if (!incidentId || !allowed.includes(status))
      return json({ error: 'Invalid incident update' }, 400);
    const incident = await ctx.runtime.DB.prepare(
      'SELECT title,service,severity FROM incidents WHERE id=? AND team_id=?',
    )
      .bind(incidentId, ctx.teamId)
      .first<{ title: string; service: string; severity: string }>();
    if (!incident) return json({ error: 'Incident not found' }, 404);
    await ctx.runtime.DB.prepare(
      'UPDATE incidents SET status = ?, assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND team_id = ?',
    )
      .bind(status, textValue(body.assignedTo) || null, incidentId, ctx.teamId)
      .run();
    await audit(
      ctx.runtime.DB,
      ctx.teamId,
      ctx.user.id,
      'incident.updated',
      'incident',
      incidentId,
      { status, assignedTo: body.assignedTo ?? null },
    );
    await queueIntegrationEvent(ctx.runtime, {
      event: status === 'resolved' ? 'resolved' : 'acknowledged',
      id: incidentId,
      teamId: ctx.teamId,
      title: incident.title,
      service: incident.service,
      severity: incident.severity,
      detail: `Incident status changed to ${status} by ${ctx.user.name}.`,
      environment: 'production',
      url: ctx.runtime.APP_ORIGIN,
    });
    waitUntil(flushIntegrationEvents(ctx.runtime).catch(() => undefined));
    await queueTeamEmail(
      ctx.runtime,
      ctx.teamId,
      `incident-status:${incidentId}:${status}`,
      `Incident ${status}: ${incident.title}`,
      `Dear CrashLens team member,\n\nThis message is to confirm that the following incident has been updated.\n\nIncident: ${incident.title}\nService: ${incident.service}\nSeverity: ${incident.severity.toUpperCase()}\nCurrent status: ${status.toUpperCase()}\nUpdated by: ${ctx.user.name}\n\nPlease open CrashLens to review the incident timeline and supporting evidence.\n\nYours sincerely,\nCrashLens Operations Team`,
      'incident',
    );
    deliverQueuedEmails(ctx.runtime);
    return json({ ok: true });
  }
  if (action === 'comment') {
    const incidentId = textValue(body.incidentId);
    const comment = textValue(body.comment).trim().slice(0, 2000);
    if (!incidentId || !comment)
      return json({ error: 'Comment and incident are required' }, 400);
    const exists = await ctx.runtime.DB.prepare(
      'SELECT id FROM incidents WHERE id = ? AND team_id = ?',
    )
      .bind(incidentId, ctx.teamId)
      .first();
    if (!exists) return json({ error: 'Incident not found' }, 404);
    const id = crypto.randomUUID();
    await ctx.runtime.DB.prepare(
      'INSERT INTO comments (id, incident_id, user_id, body) VALUES (?, ?, ?, ?)',
    )
      .bind(id, incidentId, ctx.user.id, comment)
      .run();
    await audit(
      ctx.runtime.DB,
      ctx.teamId,
      ctx.user.id,
      'comment.created',
      'incident',
      incidentId,
    );
    return json({ ok: true, id }, 201);
  }
  if (action === 'invite') {
    const email = textValue(body.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return json({ error: 'Enter a valid email' }, 400);
    const role = textValue(body.role, 'member');
    if (!['member', 'admin'].includes(role))
      return json({ error: 'Choose a valid role' }, 400);
    const id = crypto.randomUUID();
    await ctx.runtime.DB.prepare(
      'INSERT INTO team_invites (id, team_id, email, role, invited_by) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id, ctx.teamId, email, role, ctx.user.id)
      .run();
    await audit(
      ctx.runtime.DB,
      ctx.teamId,
      ctx.user.id,
      'team.invited',
      'invite',
      id,
      { email },
    );
    if (emailConfigured(ctx.runtime)) {
      const origin =
        ctx.runtime.APP_ORIGIN?.replace(/\/$/, '') ??
        new URL(request.url).origin;
      const link = `${origin}/account?mode=login&invite=${encodeURIComponent(id)}`;
      await queueEmail(
        ctx.runtime,
        ctx.teamId,
        email,
        `team-invite:${id}`,
        'You have been invited to join a CrashLens workspace',
        `Dear Colleague,\n\n${ctx.user.name} has invited you to join the CrashLens Operations workspace with the role of ${role}.\n\nTo accept this invitation, please sign in or create an account using this email address. Your verified account will be added to the workspace automatically.\n\n${link}\n\nFor your security, this invitation can be accepted only by an account verified with ${email}. If you were not expecting this invitation, no action is required.\n\nYours sincerely,\nCrashLens Team`,
      );
      deliverQueuedEmails(ctx.runtime);
    }
    return json({ ok: true, id }, 201);
  }
  if (action === 'connector') {
    const type = textValue(body.type).toLowerCase();
    const allowed = [
      'docker',
      'kubernetes',
      'cloudwatch',
      'sentry',
      'github',
      'jira',
      'discord',
      'pagerduty',
      'datadog',
      'opentelemetry',
      'webhook',
      'slack',
      'email',
      'openai',
    ];
    if (!allowed.includes(type))
      return json({ error: 'Unsupported connector' }, 400);
    const existing = await ctx.runtime.DB.prepare(
      'SELECT id FROM connectors WHERE team_id = ? AND type = ?',
    )
      .bind(ctx.teamId, type)
      .first<{ id: string }>();
    const id = existing?.id ?? crypto.randomUUID();
    const status = [
      'openai',
      'slack',
      'discord',
      'email',
      'github',
      'jira',
      'sentry',
      'pagerduty',
    ].includes(type)
      ? 'awaiting_secret'
      : 'ready_for_credentials';
    await ctx.runtime.DB.prepare(`INSERT INTO connectors (id, team_id, type, name, status, config_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status, config_json = excluded.config_json, updated_at = CURRENT_TIMESTAMP`)
      .bind(
        id,
        ctx.teamId,
        type,
        textValue(body.name, type),
        status,
        JSON.stringify(body.config ?? {}),
        ctx.user.id,
      )
      .run();
    await audit(
      ctx.runtime.DB,
      ctx.teamId,
      ctx.user.id,
      'connector.configured',
      'connector',
      id,
      { type },
    );
    return json({ ok: true, id, status }, existing ? 200 : 201);
  }
  if (action === 'ai_analysis') {
    if (!ctx.runtime.OPENAI_API_KEY)
      return json(
        { error: 'OPENAI_API_KEY is not configured', configured: false },
        503,
      );
    const incident = body.incident as Record<string, unknown>;
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.runtime.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        input: `Analyze this production incident. Return a concise root cause, evidence, and three safe next actions. Incident: ${JSON.stringify(incident).slice(0, 12000)}`,
      }),
    });
    if (!response.ok)
      return json({ error: 'OpenAI analysis request failed' }, 502);
    const result = (await response.json()) as { output_text?: string };
    return json({
      analysis: result.output_text ?? 'No analysis returned',
      configured: true,
    });
  }
  if (action === 'test_slack') {
    if (!ctx.runtime.SLACK_WEBHOOK_URL)
      return json(
        { error: 'SLACK_WEBHOOK_URL is not configured', configured: false },
        503,
      );
    const response = await fetch(ctx.runtime.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '✅ CrashLens alert connection verified.' }),
    });
    if (!response.ok)
      return json({ error: 'Slack rejected the test alert' }, 502);
    return json({ ok: true, configured: true });
  }
  if (action === 'test_email') {
    const emailConfiguration = resendConfiguration(ctx.runtime);
    if (!emailConfiguration.configured)
      return json(
        {
          error: emailConfiguration.error,
          configured: false,
        },
        503,
      );
    await queueEmail(
      ctx.runtime,
      ctx.teamId,
      ctx.user.email,
      `test:${ctx.user.id}:${Math.floor(Date.now() / 60000)}`,
      'CrashLens email test',
      'Your CrashLens email test was requested successfully.',
    );
    const delivery = await flushEmails(ctx.runtime);
    if (delivery.failed)
      return json(
        {
          error:
            delivery.error ??
            'Resend could not accept the test email. Check the email outbox for details.',
          configured: true,
          delivery,
        },
        502,
      );
    return json({ ok: true, delivery });
  }
  return json({ error: 'Unknown action' }, 400);
}
