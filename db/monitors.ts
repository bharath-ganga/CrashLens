import type { CrashLensEnv } from './runtime';
import { nextMonitorState, probeEndpoint } from '../lib/uptime';
import { flushEmails } from './email';
import { notifyLifecycle } from './notifications';

export type Monitor = {
  id: string;
  team_id: string;
  created_by: string;
  name: string;
  url: string;
  service: string;
  interval_seconds: number;
  failure_threshold: number;
  status: string;
  consecutive_failures: number;
  outage_id: string | null;
  method: string;
  timeout_ms: number;
  expected_min: number;
  expected_max: number;
  assertion_type: string;
  assertion_value: string | null;
  request_headers_json: string;
  request_body: string | null;
};

export async function checkMonitor(env: CrashLensEnv, monitor: Monitor) {
  const now = Date.now();
  const claim = await env.DB.prepare(
    'UPDATE uptime_monitors SET lease_until = ? WHERE id = ? AND enabled = 1 AND lease_until < ? AND next_check_at <= ?',
  )
    .bind(now + 60000, monitor.id, now, now)
    .run();
  if (!claim.meta.changes) return { skipped: true };
  const result = await probeEndpoint(monitor.url, fetch, {
    method: monitor.method,
    timeoutMs: monitor.timeout_ms,
    expectedMin: monitor.expected_min,
    expectedMax: monitor.expected_max,
    assertionType: monitor.assertion_type,
    assertionValue: monitor.assertion_value,
    headers: JSON.parse(monitor.request_headers_json),
    body: monitor.request_body,
  });
  const next = nextMonitorState(
    monitor.status,
    monitor.consecutive_failures,
    result.ok,
    monitor.failure_threshold,
  );
  const outageId = next.opened ? crypto.randomUUID() : monitor.outage_id;
  const statements = [
    env.DB.prepare(
      'INSERT INTO uptime_checks (id,monitor_id,checked_at,ok,latency_ms,http_status,error,region,evidence_json) VALUES (?,?,?,?,?,?,?,?,?)',
    ).bind(
      crypto.randomUUID(),
      monitor.id,
      now,
      result.ok ? 1 : 0,
      result.latencyMs,
      result.httpStatus,
      result.error,
      'origin',
      JSON.stringify(result.evidence),
    ),
    env.DB.prepare(`UPDATE uptime_monitors SET status=?,consecutive_failures=?,last_checked_at=?,next_check_at=?,lease_until=0,
      last_latency_ms=?,last_http_status=?,last_error=?,outage_id=? WHERE id=?`).bind(
      next.status,
      next.failures,
      now,
      now + monitor.interval_seconds * 1000,
      result.latencyMs,
      result.httpStatus,
      result.error,
      next.recovered ? null : outageId,
      monitor.id,
    ),
  ];
  if (next.opened)
    statements.push(
      env.DB.prepare(`INSERT INTO incidents
    (id,team_id,title,service,severity,status,trigger_text,confidence,fingerprint,started_at,last_seen_at,log_count,created_by)
    VALUES (?,?,?,?,'critical','investigating',?,0,?,?,?,0,?)`).bind(
        outageId,
        monitor.team_id,
        `${monitor.name} is down`,
        monitor.service,
        `${monitor.failure_threshold} consecutive failed HTTP checks. Cause not established.`,
        `uptime:${monitor.id}`,
        new Date(now).toISOString(),
        new Date(now).toISOString(),
        monitor.created_by,
      ),
    );
  if (next.recovered && outageId)
    statements.push(
      env.DB.prepare(
        "UPDATE incidents SET status='resolved',last_seen_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND team_id=?",
      ).bind(new Date(now).toISOString(), outageId, monitor.team_id),
    );
  await env.DB.batch(statements);
  if ((next.opened || next.recovered) && outageId)
    await notifyLifecycle(env, {
      event: next.opened ? 'opened' : 'resolved',
      id: outageId,
      teamId: monitor.team_id,
      monitor: monitor.name,
      service: monitor.service,
      url: monitor.url,
      detail:
        result.error ?? `HTTP ${result.httpStatus}, ${result.latencyMs} ms`,
      occurredAt: new Date(now).toISOString(),
    });
  return result;
}

export async function runMonitoring(env: CrashLensEnv) {
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO scheduler_state (id,last_run_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET last_run_at=excluded.last_run_at',
  )
    .bind('uptime', now)
    .run();
  const due = await env.DB.prepare(
    'SELECT * FROM uptime_monitors WHERE enabled=1 AND next_check_at <= ? AND lease_until < ? ORDER BY next_check_at LIMIT 10',
  )
    .bind(now, now)
    .all<Monitor>();
  for (let i = 0; i < due.results.length; i += 3)
    await Promise.all(
      due.results.slice(i, i + 3).map((m) => checkMonitor(env, m)),
    );
  await env.DB.prepare(
    'DELETE FROM uptime_checks WHERE id IN (SELECT id FROM uptime_checks WHERE checked_at < ? LIMIT 1000)',
  )
    .bind(now - 30 * 86400000)
    .run();
  const mail = await flushEmails(env);
  return { checked: due.results.length, mail };
}
