import {
  authenticatedUser,
  ensureDatabase,
  ensureWorkspace,
  getRuntimeEnv,
} from '@/db/runtime';
import { monitorUrl, safeMonitorHeaders } from '@/lib/uptime';
import { checkMonitor, type Monitor } from '@/db/monitors';
import { emailConfigured, flushEmails } from '@/db/email';
import { notificationCapabilities, notifyLifecycle } from '@/db/notifications';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const textValue = (value: unknown, fallback = '') =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
async function context(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return null;
  const env = getRuntimeEnv();
  await ensureDatabase(env.DB);
  const team = await ensureWorkspace(env.DB, user);
  return { user, env, team };
}
function configuration(body: Record<string, unknown>) {
  const method = textValue(body.method, 'HEAD').toUpperCase();
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
    throw Error('Choose a supported HTTP method.');
  const interval = Number(body.interval ?? 300);
  if (![60, 300, 600, 900, 1800, 3600].includes(interval))
    throw Error('Choose a valid interval.');
  const timeout = Math.round(Number(body.timeout ?? 10000));
  if (timeout < 1000 || timeout > 30000)
    throw Error('Timeout must be 1–30 seconds.');
  const expectedMin = Math.round(Number(body.expectedMin ?? 200)),
    expectedMax = Math.round(Number(body.expectedMax ?? 299));
  if (expectedMin < 100 || expectedMax > 599 || expectedMin > expectedMax)
    throw Error('Expected status range is invalid.');
  const assertionType = textValue(body.assertionType, 'none');
  if (!['none', 'contains', 'exact', 'regex'].includes(assertionType))
    throw Error('Invalid body assertion.');
  const assertionValue = textValue(body.assertionValue).slice(0, 500);
  if (assertionType !== 'none' && !assertionValue)
    throw Error('Enter an assertion value.');
  let headers: unknown = {};
  try {
    headers =
      typeof body.headers === 'string'
        ? JSON.parse(body.headers)
        : (body.headers ?? {});
  } catch {
    throw Error('Headers must be valid JSON.');
  }
  const safeHeaders = safeMonitorHeaders(headers);
  const requestBody = textValue(body.requestBody).slice(0, 4096);
  if (['GET', 'HEAD'].includes(method) && requestBody)
    throw Error(`${method} checks cannot send a request body.`);
  const tags = textValue(body.tags)
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
  if (tags.some((t) => !/^[a-z0-9_.-]{1,24}$/.test(t)))
    throw Error('Tags use letters, numbers, dots, dashes, or underscores.');
  return {
    method,
    interval,
    timeout,
    expectedMin,
    expectedMax,
    assertionType,
    assertionValue: assertionType === 'none' ? null : assertionValue,
    headers: JSON.stringify(safeHeaders),
    requestBody: requestBody || null,
    tags: JSON.stringify([...new Set(tags)]),
  };
}
export async function GET(request: Request) {
  const ctx = await context(request);
  if (!ctx) return json({ error: 'Sign in to manage monitors.' }, 401);
  const now = Date.now(),
    defaultProject = `project-${ctx.team}`;
  await ctx.env.DB.prepare(
    'INSERT OR IGNORE INTO monitor_projects (id,team_id,name,created_by) VALUES (?,?,?,?)',
  )
    .bind(defaultProject, ctx.team, 'Production', ctx.user.id)
    .run();
  await ctx.env.DB.prepare(
    'UPDATE uptime_monitors SET project_id=? WHERE team_id=? AND project_id IS NULL',
  )
    .bind(defaultProject, ctx.team)
    .run();
  const [projects, monitors, checks, emails, runner, incidents] =
    await Promise.all([
      ctx.env.DB.prepare(
        'SELECT * FROM monitor_projects WHERE team_id=? ORDER BY created_at',
      )
        .bind(ctx.team)
        .all(),
      ctx.env.DB.prepare(
        `SELECT m.*,(SELECT ROUND(100.0*AVG(ok),3) FROM uptime_checks c WHERE c.monitor_id=m.id AND c.checked_at>?) uptime_percent,(SELECT COUNT(*) FROM uptime_checks c WHERE c.monitor_id=m.id AND c.checked_at>? AND c.ok=0) failed_checks FROM uptime_monitors m WHERE m.team_id=? ORDER BY m.created_at DESC`,
      )
        .bind(now - 30 * 86400000, now - 30 * 86400000, ctx.team)
        .all(),
      ctx.env.DB.prepare(
        'SELECT c.* FROM uptime_checks c JOIN uptime_monitors m ON m.id=c.monitor_id WHERE m.team_id=? AND c.checked_at>? ORDER BY c.checked_at DESC LIMIT 2000',
      )
        .bind(ctx.team, now - 90 * 86400000)
        .all(),
      ctx.env.DB.prepare(
        'SELECT id,recipient,subject,status,attempts,last_error,created_at FROM email_outbox WHERE team_id=? ORDER BY created_at DESC LIMIT 30',
      )
        .bind(ctx.team)
        .all(),
      ctx.env.DB.prepare(
        "SELECT last_run_at FROM scheduler_state WHERE id='uptime'",
      ).first<{ last_run_at: number }>(),
      ctx.env.DB.prepare(
        "SELECT id,title,service,status,trigger_text,started_at,last_seen_at,updated_at,fingerprint FROM incidents WHERE team_id=? AND fingerprint LIKE 'uptime:%' ORDER BY updated_at DESC LIMIT 100",
      )
        .bind(ctx.team)
        .all(),
    ]);
  return json({
    now,
    projects: projects.results,
    monitors: monitors.results,
    checks: checks.results,
    emails: emails.results,
    incidents: incidents.results,
    emailConfigured: emailConfigured(ctx.env),
    channels: notificationCapabilities(ctx.env),
    schedulerActive: Boolean(runner && now - runner.last_run_at < 180000),
    lastSchedulerRun: runner?.last_run_at ?? null,
    regions: ['origin'],
  });
}
export async function POST(request: Request) {
  const ctx = await context(request);
  if (!ctx) return json({ error: 'Authentication required' }, 401);
  if (
    request.headers.get('origin') &&
    request.headers.get('origin') !== new URL(request.url).origin
  )
    return json({ error: 'Invalid origin' }, 403);
  try {
    const text = await request.text();
    if (text.length > 16384) return json({ error: 'Request too large' }, 413);
    const body = JSON.parse(text) as Record<string, unknown>;
    const action = textValue(body.action);
    if (action === 'create_project') {
      const name = textValue(body.name).trim().slice(0, 80);
      if (!name) throw Error('Enter a project name.');
      const id = crypto.randomUUID();
      await ctx.env.DB.prepare(
        'INSERT INTO monitor_projects (id,team_id,name,created_by) VALUES (?,?,?,?)',
      )
        .bind(id, ctx.team, name, ctx.user.id)
        .run();
      return json({ id }, 201);
    }
    if (action === 'create') {
      const url = monitorUrl(body.url),
        name = textValue(body.name).trim(),
        service = textValue(body.service).trim();
      if (
        !name ||
        name.length > 100 ||
        !/^[a-zA-Z0-9_.-]{1,100}$/.test(service)
      )
        throw Error('Enter a name and service identifier.');
      const count = await ctx.env.DB.prepare(
        'SELECT COUNT(*) n FROM uptime_monitors WHERE team_id=?',
      )
        .bind(ctx.team)
        .first<{ n: number }>();
      if ((count?.n ?? 0) >= 50)
        throw Error('A workspace supports up to 50 monitors.');
      const project = await ctx.env.DB.prepare(
        'SELECT id FROM monitor_projects WHERE id=? AND team_id=?',
      )
        .bind(textValue(body.projectId), ctx.team)
        .first<{ id: string }>();
      if (!project) throw Error('Choose a project.');
      const c = configuration(body),
        id = crypto.randomUUID();
      await ctx.env.DB.prepare(
        `INSERT INTO uptime_monitors (id,team_id,created_by,name,url,service,interval_seconds,method,timeout_ms,expected_min,expected_max,assertion_type,assertion_value,request_headers_json,request_body,tags_json,project_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
        .bind(
          id,
          ctx.team,
          ctx.user.id,
          name,
          url,
          service,
          c.interval,
          c.method,
          c.timeout,
          c.expectedMin,
          c.expectedMax,
          c.assertionType,
          c.assertionValue,
          c.headers,
          c.requestBody,
          c.tags,
          project.id,
        )
        .run();
      return json({ id }, 201);
    }
    const monitor = await ctx.env.DB.prepare(
      'SELECT * FROM uptime_monitors WHERE id=? AND team_id=?',
    )
      .bind(textValue(body.id), ctx.team)
      .first<Monitor>();
    if (action === 'incident') {
      const incident = await ctx.env.DB.prepare(
        "SELECT * FROM incidents WHERE id=? AND team_id=? AND fingerprint LIKE 'uptime:%'",
      )
        .bind(textValue(body.incidentId), ctx.team)
        .first<Record<string, string>>();
      if (!incident) return json({ error: 'Incident not found' }, 404);
      const status = textValue(body.status);
      if (!['monitoring', 'resolved'].includes(status))
        throw Error('Invalid incident status.');
      await ctx.env.DB.prepare(
        'UPDATE incidents SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND team_id=?',
      )
        .bind(status, incident.id, ctx.team)
        .run();
      await notifyLifecycle(ctx.env, {
        event: status === 'monitoring' ? 'acknowledged' : 'resolved',
        id: incident.id,
        teamId: ctx.team,
        monitor: incident.title,
        service: incident.service,
        url: 'See monitor in CrashLens',
        detail:
          status === 'monitoring'
            ? 'Incident acknowledged by a teammate.'
            : 'Incident manually resolved by a teammate.',
        occurredAt: new Date().toISOString(),
      });
      await flushEmails(ctx.env);
      return json({ ok: true });
    }
    if (!monitor) return json({ error: 'Monitor not found' }, 404);
    if (action === 'check') {
      await ctx.env.DB.prepare(
        'UPDATE uptime_monitors SET next_check_at=0,lease_until=0 WHERE id=? AND team_id=?',
      )
        .bind(monitor.id, ctx.team)
        .run();
      const result = await checkMonitor(ctx.env, {
        ...monitor,
        next_check_at: 0,
      } as Monitor);
      await flushEmails(ctx.env);
      return json(result);
    }
    if (action === 'pause' || action === 'resume') {
      await ctx.env.DB.prepare(
        'UPDATE uptime_monitors SET enabled=?,next_check_at=? WHERE id=? AND team_id=?',
      )
        .bind(
          action === 'resume' ? 1 : 0,
          action === 'resume' ? 0 : Date.now(),
          monitor.id,
          ctx.team,
        )
        .run();
      return json({ ok: true });
    }
    if (action === 'delete') {
      await ctx.env.DB.batch([
        ctx.env.DB.prepare('DELETE FROM uptime_checks WHERE monitor_id=?').bind(
          monitor.id,
        ),
        ctx.env.DB.prepare(
          'DELETE FROM uptime_monitors WHERE id=? AND team_id=?',
        ).bind(monitor.id, ctx.team),
      ]);
      return json({ ok: true });
    }
    if (action === 'update') {
      const c = configuration(body),
        url = monitorUrl(body.url),
        name = textValue(body.name).trim(),
        service = textValue(body.service).trim();
      if (!name || !/^[a-zA-Z0-9_.-]{1,100}$/.test(service))
        throw Error('Enter a valid name and service.');
      await ctx.env.DB.prepare(
        `UPDATE uptime_monitors SET name=?,url=?,service=?,interval_seconds=?,method=?,timeout_ms=?,expected_min=?,expected_max=?,assertion_type=?,assertion_value=?,request_headers_json=?,request_body=?,tags_json=?,next_check_at=0 WHERE id=? AND team_id=?`,
      )
        .bind(
          name,
          url,
          service,
          c.interval,
          c.method,
          c.timeout,
          c.expectedMin,
          c.expectedMax,
          c.assertionType,
          c.assertionValue,
          c.headers,
          c.requestBody,
          c.tags,
          monitor.id,
          ctx.team,
        )
        .run();
      return json({ ok: true });
    }
    throw Error('Unknown action');
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Invalid request' },
      400,
    );
  }
}
