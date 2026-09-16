import type { Incident, LogEntry, TimelineEvent } from '@/lib/log-analyzer';
import { audit, redactSensitiveData, type CrashLensEnv } from './runtime';
import { queueTeamEmail, flushEmails } from './email';

type SaveAnalysisInput = {
  filename: string;
  format: string;
  rawContent?: string;
  rowCount: number;
  logs: LogEntry[];
  incidents: Incident[];
};

type StoredIncident = {
  id: string;
  title: string;
  service: string;
  severity: Incident['severity'];
  status: string;
  trigger_text: string | null;
  confidence: number;
  fingerprint: string;
  started_at: string;
  last_seen_at: string;
  log_count: number;
  timeline_json: string;
  change_text: string;
};

function timeline(value: string): TimelineEvent[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as TimelineEvent[]) : [];
  } catch {
    return [];
  }
}

export async function saveAnalysis(
  env: CrashLensEnv,
  teamId: string,
  actorId: string,
  input: SaveAnalysisInput,
) {
  const ingestionId = crypto.randomUUID();
  const fileKey = input.rawContent
    ? `${teamId}/${ingestionId}/${input.filename.replace(/[^a-zA-Z0-9_.-]/g, '_')}`
    : null;
  if (fileKey && input.rawContent) {
    await env.FILES.put(fileKey, redactSensitiveData(input.rawContent), {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' },
      customMetadata: { originalFilename: input.filename, redacted: 'true' },
    });
  }
  await env.DB.prepare(
    'INSERT INTO ingestions (id, team_id, filename, format, row_count, file_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      ingestionId,
      teamId,
      input.filename,
      input.format,
      input.rowCount,
      fileKey,
      actorId,
    )
    .run();

  const persistedLogs = input.logs.map((log) =>
    env.DB.prepare(
      `INSERT INTO log_entries
      (id, team_id, ingestion_id, timestamp, level, service, event_name, message, raw_redacted, request_id, trace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      teamId,
      ingestionId,
      log.timestamp,
      log.level,
      log.service.slice(0, 100),
      log.eventName?.slice(0, 160) ?? null,
      redactSensitiveData(log.message).slice(0, 4000),
      redactSensitiveData(log.raw).slice(0, 8000),
      log.requestId?.slice(0, 180) ?? null,
      log.traceId?.slice(0, 180) ?? null,
    ),
  );
  for (let index = 0; index < persistedLogs.length; index += 100)
    await env.DB.batch(persistedLogs.slice(index, index + 100));

  for (const incident of input.incidents.slice(0, 100)) {
    const incidentId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO incidents
      (id, team_id, ingestion_id, title, service, severity, status, trigger_text, confidence, fingerprint, started_at, last_seen_at, log_count, created_by, timeline_json, change_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        incidentId,
        teamId,
        ingestionId,
        incident.title.slice(0, 180),
        incident.service.slice(0, 100),
        incident.severity,
        incident.status.toLowerCase(),
        redactSensitiveData(incident.trigger).slice(0, 500),
        incident.confidence,
        incident.fingerprint.slice(0, 220),
        incident.started,
        incident.lastSeen,
        incident.logs.length,
        actorId,
        JSON.stringify(incident.timeline).slice(0, 16000),
        incident.change.slice(0, 80),
      )
      .run();
    const logStatements = incident.logs
      .slice(0, 500)
      .map((log) =>
        env.DB.prepare(
          'INSERT INTO incident_logs (id, incident_id, timestamp, level, service, message, raw_redacted) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          crypto.randomUUID(),
          incidentId,
          log.timestamp,
          log.level,
          log.service.slice(0, 100),
          redactSensitiveData(log.message).slice(0, 4000),
          redactSensitiveData(log.raw).slice(0, 8000),
        ),
      );
    for (let index = 0; index < logStatements.length; index += 50)
      await env.DB.batch(logStatements.slice(index, index + 50));
    await queueTeamEmail(
      env,
      teamId,
      `incident:${incidentId}`,
      `CrashLens: ${redactSensitiveData(incident.title).slice(0, 120)}`,
      `${incident.severity.toUpperCase()} incident in ${redactSensitiveData(incident.service)}.\n${incident.logs.length} related logs.\nOpen CrashLens History to investigate.\nIncident: ${incidentId}`,
    );
  }
  await audit(
    env.DB,
    teamId,
    actorId,
    'analysis.saved',
    'ingestion',
    ingestionId,
    {
      filename: input.filename,
      incidents: input.incidents.length,
      rows: input.rowCount,
    },
  );
  const critical = input.incidents.filter(
    (incident) => incident.severity === 'critical',
  );
  if (critical.length) {
    const summary = `CrashLens detected ${critical.length} critical incident${critical.length === 1 ? '' : 's'} in ${input.filename}: ${critical
      .slice(0, 3)
      .map((incident) => `${incident.title} (${incident.service})`)
      .join(', ')}`;
    const deliveries: Promise<Response>[] = [];
    if (env.SLACK_WEBHOOK_URL)
      deliveries.push(
        fetch(env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `🚨 ${summary}` }),
        }),
      );
    if (env.EMAIL_WEBHOOK_URL)
      deliveries.push(
        fetch(env.EMAIL_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: 'CrashLens critical incident alert',
            text: summary,
            severity: 'critical',
            ingestionId,
          }),
        }),
      );
    if (deliveries.length) await Promise.allSettled(deliveries);
  }
  await flushEmails(env);
  return ingestionId;
}

export async function latestAnalysis(env: CrashLensEnv, teamId: string) {
  const ingestion = await env.DB.prepare(
    `SELECT id, filename, format, row_count, created_at
     FROM ingestions WHERE team_id = ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(teamId)
    .first<{
      id: string;
      filename: string;
      format: string;
      row_count: number;
      created_at: string;
    }>();
  if (!ingestion) return null;

  const [incidentRows, incidentLogRows, logRows, totals, activity, services] =
    await Promise.all([
      env.DB.prepare(
        `SELECT id, title, service, severity, status, trigger_text, confidence,
                fingerprint, started_at, last_seen_at, log_count,
                timeline_json, change_text
         FROM incidents WHERE team_id = ? AND ingestion_id = ?
         ORDER BY CASE severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END DESC,
                  log_count DESC`,
      )
        .bind(teamId, ingestion.id)
        .all<StoredIncident>(),
      env.DB.prepare(
        `SELECT l.*, i.id AS stored_incident_id
         FROM incident_logs l JOIN incidents i ON i.id = l.incident_id
         WHERE i.team_id = ? AND i.ingestion_id = ?
         ORDER BY l.timestamp`,
      )
        .bind(teamId, ingestion.id)
        .all<Record<string, string>>(),
      env.DB.prepare(
        `SELECT id, timestamp, level, service, event_name, message,
                request_id, trace_id
         FROM log_entries WHERE team_id = ? AND ingestion_id = ?
         ORDER BY timestamp DESC LIMIT 1000`,
      )
        .bind(teamId, ingestion.id)
        .all<Record<string, string | null>>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN level IN ('error','fatal') THEN 1 ELSE 0 END) AS errors,
                COUNT(DISTINCT service) AS services
         FROM log_entries WHERE team_id = ? AND ingestion_id = ?`,
      )
        .bind(teamId, ingestion.id)
        .first<{ total: number; errors: number; services: number }>(),
      env.DB.prepare(
        `SELECT substr(timestamp, 12, 5) AS label, COUNT(*) AS count,
                SUM(CASE WHEN level IN ('error','fatal') THEN 1 ELSE 0 END) AS critical
         FROM log_entries WHERE team_id = ? AND ingestion_id = ?
         GROUP BY substr(timestamp, 1, 16) ORDER BY MIN(timestamp) DESC LIMIT 24`,
      )
        .bind(teamId, ingestion.id)
        .all<{ label: string; count: number; critical: number }>(),
      env.DB.prepare(
        `SELECT service, COUNT(*) AS events,
                SUM(CASE WHEN level IN ('error','fatal') THEN 1 ELSE 0 END) AS errors,
                MAX(timestamp) AS last_seen
         FROM log_entries WHERE team_id = ? AND ingestion_id = ?
         GROUP BY service ORDER BY events DESC`,
      )
        .bind(teamId, ingestion.id)
        .all<{
          service: string;
          events: number;
          errors: number;
          last_seen: string;
        }>(),
    ]);

  const logsByIncident = new Map<string, LogEntry[]>();
  for (const row of incidentLogRows.results) {
    const id = String(row.stored_incident_id);
    const rows = logsByIncident.get(id) ?? [];
    rows.push({
      id: String(row.id),
      timestamp: String(row.timestamp),
      level: String(row.level) as LogEntry['level'],
      service: String(row.service),
      message: String(row.message),
      raw: String(row.raw_redacted),
    });
    logsByIncident.set(id, rows);
  }

  const incidents: Incident[] = incidentRows.results.map((row) => ({
    id: row.id,
    title: row.title,
    service: row.service,
    severity: row.severity,
    status: row.status === 'monitoring' ? 'Monitoring' : 'Investigating',
    trigger: row.trigger_text ?? 'No correlated change found',
    confidence: Number(row.confidence),
    fingerprint: row.fingerprint,
    started: row.started_at,
    lastSeen: row.last_seen_at,
    change: row.change_text,
    eventCount: Number(row.log_count),
    timeline: timeline(row.timeline_json),
    logs: logsByIncident.get(row.id) ?? [],
  }));

  const logs: LogEntry[] = [...logRows.results].reverse().map((row) => ({
    id: String(row.id),
    timestamp: String(row.timestamp),
    level: String(row.level) as LogEntry['level'],
    service: String(row.service),
    message: String(row.message),
    raw: String(row.message),
    eventName: row.event_name ? String(row.event_name) : undefined,
    requestId: row.request_id ? String(row.request_id) : undefined,
    traceId: row.trace_id ? String(row.trace_id) : undefined,
  }));

  return {
    ingestion: {
      id: ingestion.id,
      filename: ingestion.filename,
      format: ingestion.format,
      rowCount: Number(ingestion.row_count),
      createdAt: ingestion.created_at,
    },
    incidents,
    logs,
    stats: {
      total: Number(totals?.total ?? 0),
      errors: Number(totals?.errors ?? 0),
      services: Number(totals?.services ?? 0),
    },
    activity: [...activity.results].reverse(),
    services: services.results,
  };
}
