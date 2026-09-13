import {
  authenticatedUser,
  ensureDatabase,
  getRuntimeEnv,
  isPlatformAdmin,
} from '@/db/runtime';

export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function GET(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return json({ error: 'Authentication required' }, 401);

  const runtime = getRuntimeEnv();
  if (!isPlatformAdmin(runtime, user)) {
    return json({ error: 'Platform administrator access required' }, 403);
  }

  await ensureDatabase(runtime.DB);
  const [clients, totals] = await Promise.all([
    runtime.DB.prepare(`
      SELECT
        a.id,
        a.name,
        a.email,
        a.verified,
        a.created_at,
        (SELECT COUNT(*) FROM account_sessions s
          WHERE s.user_id = a.id AND s.expires_at > ?) AS active_sessions,
        (SELECT t.name FROM teams t
          WHERE t.created_by = a.id ORDER BY t.created_at LIMIT 1) AS workspace_name,
        (SELECT COUNT(*) FROM ingestions i WHERE i.created_by = a.id) AS ingestion_count,
        (SELECT COUNT(*) FROM incidents i WHERE i.created_by = a.id) AS incident_count,
        (SELECT MAX(e.created_at) FROM audit_events e WHERE e.actor_id = a.id) AS last_activity
      FROM accounts a
      ORDER BY a.created_at DESC
      LIMIT 250
    `)
      .bind(Date.now())
      .all(),
    runtime.DB.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) AS verified,
        SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS new_30_days
      FROM accounts
    `).first<{
      total: number;
      verified: number | null;
      new_30_days: number | null;
    }>(),
  ]);

  return json({
    clients: clients.results,
    totals: {
      total: totals?.total ?? 0,
      verified: totals?.verified ?? 0,
      new30Days: totals?.new_30_days ?? 0,
    },
    generatedAt: new Date().toISOString(),
  });
}
