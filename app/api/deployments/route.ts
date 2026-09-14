import {
  authenticatedUser,
  ensureDatabase,
  ensureWorkspace,
  getRuntimeEnv,
} from '@/db/runtime';

export const dynamic = 'force-dynamic';

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  const tokenValid =
    Boolean(runtime.INGESTION_TOKEN) &&
    request.headers.get('x-crashlens-ingest-token') === runtime.INGESTION_TOKEN;
  const user = await authenticatedUser(request);
  if (!tokenValid && !user)
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (
    !tokenValid &&
    request.headers.get('origin') &&
    request.headers.get('origin') !== new URL(request.url).origin
  )
    return Response.json({ error: 'Invalid origin' }, { status: 403 });
  await ensureDatabase(runtime.DB);
  const actor = user ?? {
    id: 'external-ingestion',
    email: 'ingestion@crashlens.local',
    name: 'Deployment Pipeline',
  };
  const teamId =
    runtime.INGESTION_TEAM_ID || (await ensureWorkspace(runtime.DB, actor));
  const body = (await request.json()) as Record<string, unknown>;
  const service = text(body.service).trim().slice(0, 100);
  const version = text(body.version).trim().slice(0, 160);
  if (!service || !version)
    return Response.json(
      { error: 'service and version are required' },
      { status: 400 },
    );
  const deployedAt = text(body.deployedAt, new Date().toISOString());
  if (Number.isNaN(new Date(deployedAt).getTime()))
    return Response.json(
      { error: 'deployedAt must be an ISO date' },
      { status: 400 },
    );
  const id = crypto.randomUUID();
  await runtime.DB.prepare(
    `INSERT INTO deployments
     (id, team_id, service, version, environment, status, actor, deployed_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      teamId,
      service,
      version,
      text(body.environment, 'production').slice(0, 50),
      text(body.status, 'success').slice(0, 40),
      text(body.actor, actor.name).slice(0, 120),
      deployedAt,
      text(body.source, 'ci').slice(0, 50),
    )
    .run();
  return Response.json({ accepted: true, id }, { status: 202 });
}
