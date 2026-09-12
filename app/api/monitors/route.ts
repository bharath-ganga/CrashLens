import {
  authenticatedUser,
  ensureDatabase,
  ensureWorkspace,
  getRuntimeEnv,
} from '@/db/runtime';
import { monitorUrl } from '@/lib/uptime';
import { checkMonitor, type Monitor } from '@/db/monitors';
import { emailConfigured, flushEmails } from '@/db/email';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const user = await authenticatedUser(request);
  if (!user)
    return Response.json(
      { error: 'Sign in to manage monitors.' },
      { status: 401 },
    );
  const env = getRuntimeEnv();
  await ensureDatabase(env.DB);
  const team = await ensureWorkspace(env.DB, user);
  const now = Date.now();
  const [monitors, checks, emails, runner] = await Promise.all([
    env.DB.prepare(
      `SELECT m.*, (SELECT ROUND(100.0 * AVG(ok),2) FROM uptime_checks c WHERE c.monitor_id=m.id AND c.checked_at>?) AS uptime_percent FROM uptime_monitors m WHERE m.team_id=? ORDER BY m.created_at DESC`,
    )
      .bind(now - 30 * 86400000, team)
      .all(),
    env.DB.prepare(
      'SELECT c.* FROM uptime_checks c JOIN uptime_monitors m ON m.id=c.monitor_id WHERE m.team_id=? ORDER BY c.checked_at DESC LIMIT 100',
    )
      .bind(team)
      .all(),
    env.DB.prepare(
      'SELECT id,recipient,subject,status,attempts,last_error,created_at FROM email_outbox WHERE team_id=? ORDER BY created_at DESC LIMIT 30',
    )
      .bind(team)
      .all(),
    env.DB.prepare(
      "SELECT last_run_at FROM scheduler_state WHERE id='uptime'",
    ).first<{ last_run_at: number }>(),
  ]);
  return Response.json(
    {
      monitors: monitors.results,
      checks: checks.results,
      emails: emails.results,
      emailConfigured: emailConfigured(env),
      schedulerActive: Boolean(runner && now - runner.last_run_at < 180000),
      lastSchedulerRun: runner?.last_run_at ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const user = await authenticatedUser(request);
  if (!user)
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (
    request.headers.get('origin') &&
    request.headers.get('origin') !== new URL(request.url).origin
  )
    return Response.json({ error: 'Invalid origin' }, { status: 403 });
  const env = getRuntimeEnv();
  await ensureDatabase(env.DB);
  const team = await ensureWorkspace(env.DB, user);
  try {
    const text = await request.text();
    if (text.length > 4096)
      return Response.json({ error: 'Request too large' }, { status: 413 });
    const body = JSON.parse(text);
    if (body.action === 'create') {
      const url = monitorUrl(body.url);
      const name = String(body.name ?? '').trim();
      const service = String(body.service ?? '').trim();
      if (
        !name ||
        name.length > 100 ||
        !/^[a-zA-Z0-9_.-]{1,100}$/.test(service)
      )
        throw new Error(
          'Enter a name and service identifier (letters, numbers, dots, dashes).',
        );
      const count = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM uptime_monitors WHERE team_id=?',
      )
        .bind(team)
        .first<{ n: number }>();
      if ((count?.n ?? 0) >= 20)
        throw new Error('A workspace supports up to 20 monitors.');
      const interval = Number(body.interval ?? 300);
      if (![60, 300, 900].includes(interval))
        throw new Error('Choose a valid check interval.');
      const id = crypto.randomUUID();
      await env.DB.prepare(
        'INSERT INTO uptime_monitors (id,team_id,created_by,name,url,service,interval_seconds) VALUES (?,?,?,?,?,?,?)',
      )
        .bind(id, team, user.id, name, url, service, interval)
        .run();
      return Response.json({ id }, { status: 201 });
    }
    const monitor = await env.DB.prepare(
      'SELECT * FROM uptime_monitors WHERE id=? AND team_id=?',
    )
      .bind(String(body.id ?? ''), team)
      .first<Monitor>();
    if (!monitor)
      return Response.json({ error: 'Monitor not found' }, { status: 404 });
    if (body.action === 'check') {
      const result = await checkMonitor(env, monitor);
      await flushEmails(env);
      return Response.json(result);
    }
    if (body.action === 'pause' || body.action === 'resume') {
      await env.DB.prepare(
        'UPDATE uptime_monitors SET enabled=? WHERE id=? AND team_id=?',
      )
        .bind(body.action === 'resume' ? 1 : 0, monitor.id, team)
        .run();
      return Response.json({ ok: true });
    }
    throw new Error('Unknown action');
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid request' },
      { status: 400 },
    );
  }
}
