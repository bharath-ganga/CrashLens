import { analyzeLogs, type LogEntry } from '@/lib/log-analyzer';
import { ensureDatabase, ensureWorkspace, getRuntimeEnv, redactSensitiveData } from '@/db/runtime';
import { saveAnalysis } from '@/db/incidents';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  if (!runtime.INGESTION_TOKEN || request.headers.get('x-crashlens-ingest-token') !== runtime.INGESTION_TOKEN) {
    return Response.json({ error: 'Invalid ingestion token' }, { status: 401 });
  }
  const body = await request.json() as { source?: string; logs?: Array<Partial<LogEntry>> };
  if (!Array.isArray(body.logs) || body.logs.length === 0 || body.logs.length > 5000) return Response.json({ error: 'Provide 1–5000 logs' }, { status: 400 });
  await ensureDatabase(runtime.DB);
  const serviceUser = { id: 'external-ingestion', email: 'ingestion@crashlens.local', name: 'Ingestion Service' };
  const teamId = await ensureWorkspace(runtime.DB, serviceUser);
  const logs: LogEntry[] = body.logs.map((log, index) => ({
    id: log.id ?? `external-${index}`, timestamp: log.timestamp ?? new Date().toISOString(), level: log.level ?? 'info',
    service: String(log.service ?? body.source ?? 'external-service').slice(0, 100), message: redactSensitiveData(String(log.message ?? '')).slice(0, 4000), raw: redactSensitiveData(String(log.raw ?? log.message ?? '')).slice(0, 8000),
  }));
  const incidents = analyzeLogs(logs);
  const ingestionId = await saveAnalysis(runtime, teamId, serviceUser.id, { filename: `${body.source ?? 'webhook'}-${Date.now()}.jsonl`, format: 'webhook', rowCount: logs.length, incidents });
  return Response.json({ accepted: logs.length, incidents: incidents.length, ingestionId }, { status: 202 });
}
