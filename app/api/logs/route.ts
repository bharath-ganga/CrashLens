import {
  authenticatedUser,
  ensureDatabase,
  ensureWorkspace,
  getRuntimeEnv,
} from '@/db/runtime';
import { latestAnalysis, saveAnalysis } from '@/db/incidents';
import { analyzeLogs, parseLogContent } from '@/lib/log-analyzer';
import { MAX_LOG_FILE_BYTES, MAX_LOG_FILE_MB } from '@/lib/upload-limits';

export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
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
  return json({ dataset: await latestAnalysis(ctx.runtime, ctx.teamId) });
}

export async function DELETE(request: Request) {
  if (
    request.headers.get('origin') &&
    request.headers.get('origin') !== new URL(request.url).origin
  )
    return json({ error: 'Invalid origin' }, 403);

  const ctx = await context(request);
  if (!ctx) return json({ error: 'Authentication required' }, 401);
  const ingestionId = new URL(request.url).searchParams.get('ingestionId');
  if (!ingestionId)
    return json({ error: 'Choose an uploaded log source to remove' }, 400);

  const ingestion = await ctx.runtime.DB.prepare(
    `SELECT id,filename,file_key,row_count FROM ingestions
     WHERE id=? AND team_id=?`,
  )
    .bind(ingestionId, ctx.teamId)
    .first<{
      id: string;
      filename: string;
      file_key: string | null;
      row_count: number;
    }>();
  if (!ingestion) return json({ error: 'Uploaded logs not found' }, 404);

  if (ingestion.file_key) await ctx.runtime.FILES.delete(ingestion.file_key);
  await ctx.runtime.DB.batch([
    ctx.runtime.DB.prepare(
      `DELETE FROM incident_logs WHERE incident_id IN
       (SELECT id FROM incidents WHERE ingestion_id=? AND team_id=?)`,
    ).bind(ingestion.id, ctx.teamId),
    ctx.runtime.DB.prepare(
      `DELETE FROM comments WHERE incident_id IN
       (SELECT id FROM incidents WHERE ingestion_id=? AND team_id=?)`,
    ).bind(ingestion.id, ctx.teamId),
    ctx.runtime.DB.prepare(
      `DELETE FROM postmortems WHERE incident_id IN
       (SELECT id FROM incidents WHERE ingestion_id=? AND team_id=?)`,
    ).bind(ingestion.id, ctx.teamId),
    ctx.runtime.DB.prepare(
      'DELETE FROM log_entries WHERE ingestion_id=? AND team_id=?',
    ).bind(ingestion.id, ctx.teamId),
    ctx.runtime.DB.prepare(
      'DELETE FROM incidents WHERE ingestion_id=? AND team_id=?',
    ).bind(ingestion.id, ctx.teamId),
    ctx.runtime.DB.prepare(
      'DELETE FROM ingestions WHERE id=? AND team_id=?',
    ).bind(ingestion.id, ctx.teamId),
  ]);
  await ctx.runtime.DB.prepare(
    `INSERT INTO audit_events
     (id,team_id,actor_id,action,target_type,target_id,metadata_json)
     VALUES (?,?,?,?,?,?,?)`,
  )
    .bind(
      crypto.randomUUID(),
      ctx.teamId,
      ctx.user.id,
      'analysis.deleted',
      'ingestion',
      ingestion.id,
      JSON.stringify({
        filename: ingestion.filename,
        rows: ingestion.row_count,
      }),
    )
    .run();

  return json({
    message: 'Uploaded logs removed.',
    dataset: await latestAnalysis(ctx.runtime, ctx.teamId),
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
  if (contentLength > MAX_LOG_FILE_BYTES + 1_000_000)
    return json({ error: `File exceeds ${MAX_LOG_FILE_MB} MB` }, 413);

  try {
    const form = await request.formData();
    const value = form.get('file');
    if (!(value instanceof File))
      return json({ error: 'Choose a log file to upload' }, 400);
    if (value.size > MAX_LOG_FILE_BYTES)
      return json({ error: `File exceeds ${MAX_LOG_FILE_MB} MB` }, 413);

    const filename = value.name.slice(0, 220);
    const extension = filename.toLowerCase().split('.').pop() ?? '';
    if (!['txt', 'log', 'csv', 'jsonl', 'ndjson'].includes(extension))
      return json(
        { error: 'Use a .txt, .log, .csv, .jsonl, or .ndjson file' },
        415,
      );

    const content = await value.text();
    const logs = parseLogContent(content, filename);
    if (!logs.length) return json({ error: 'No readable log rows found' }, 422);
    const incidents = analyzeLogs(logs);
    await saveAnalysis(ctx.runtime, ctx.teamId, ctx.user.id, {
      filename,
      format: extension,
      rawContent: content,
      rowCount: logs.length,
      logs,
      incidents,
    });
    return json(
      { dataset: await latestAnalysis(ctx.runtime, ctx.teamId) },
      201,
    );
  } catch (error) {
    console.error(
      'Server-side log ingestion failed',
      error instanceof Error ? error.message : 'Unknown error',
    );
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'CrashLens could not process this file',
      },
      422,
    );
  }
}
