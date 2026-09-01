import type { Incident } from '@/lib/log-analyzer';
import { audit, redactSensitiveData, type CrashLensEnv } from './runtime';

type SaveAnalysisInput = {
  filename: string;
  format: string;
  rawContent?: string;
  rowCount: number;
  incidents: Incident[];
};

export async function saveAnalysis(env: CrashLensEnv, teamId: string, actorId: string, input: SaveAnalysisInput) {
  const ingestionId = crypto.randomUUID();
  const fileKey = input.rawContent ? `${teamId}/${ingestionId}/${input.filename.replace(/[^a-zA-Z0-9_.-]/g, '_')}` : null;
  if (fileKey && input.rawContent) {
    await env.FILES.put(fileKey, redactSensitiveData(input.rawContent), {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' },
      customMetadata: { originalFilename: input.filename, redacted: 'true' },
    });
  }
  await env.DB.prepare('INSERT INTO ingestions (id, team_id, filename, format, row_count, file_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(ingestionId, teamId, input.filename, input.format, input.rowCount, fileKey, actorId).run();

  for (const incident of input.incidents.slice(0, 100)) {
    const incidentId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO incidents
      (id, team_id, ingestion_id, title, service, severity, status, trigger_text, confidence, fingerprint, started_at, last_seen_at, log_count, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(incidentId, teamId, ingestionId, incident.title.slice(0, 180), incident.service.slice(0, 100), incident.severity,
        incident.status.toLowerCase(), redactSensitiveData(incident.trigger).slice(0, 500), incident.confidence, incident.fingerprint.slice(0, 220),
        incident.started, incident.lastSeen, incident.logs.length, actorId).run();
    const logStatements = incident.logs.slice(0, 500).map((log) => env.DB.prepare(
      'INSERT INTO incident_logs (id, incident_id, timestamp, level, service, message, raw_redacted) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), incidentId, log.timestamp, log.level, log.service.slice(0, 100), redactSensitiveData(log.message).slice(0, 4000), redactSensitiveData(log.raw).slice(0, 8000)));
    for (let index = 0; index < logStatements.length; index += 50) await env.DB.batch(logStatements.slice(index, index + 50));
  }
  await audit(env.DB, teamId, actorId, 'analysis.saved', 'ingestion', ingestionId, { filename: input.filename, incidents: input.incidents.length, rows: input.rowCount });
  return ingestionId;
}
