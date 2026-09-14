import {
  authenticatedUser,
  ensureDatabase,
  ensureWorkspace,
  getRuntimeEnv,
} from '@/db/runtime';

export const dynamic = 'force-dynamic';

type InputSpan = {
  id?: string;
  spanId?: string;
  traceId?: string;
  parentSpanId?: string;
  service?: string;
  operation?: string;
  name?: string;
  status?: string | { code?: number | string };
  startedAt?: string;
  startTimeUnixNano?: string;
  durationMs?: number;
  endTimeUnixNano?: string;
  environment?: string;
  attributes?: unknown;
};

function attributeMap(attributes: unknown) {
  if (!Array.isArray(attributes))
    return typeof attributes === 'object' && attributes ? attributes : {};
  return Object.fromEntries(
    attributes.map((item) => {
      const row = item as { key?: string; value?: Record<string, unknown> };
      const value = row.value ? Object.values(row.value)[0] : null;
      return [row.key ?? 'unknown', value];
    }),
  );
}

function nanoToIso(value?: string) {
  if (!value) return new Date().toISOString();
  return new Date(Number(BigInt(value) / BigInt(1_000_000))).toISOString();
}

function duration(input: InputSpan) {
  if (Number.isFinite(input.durationMs))
    return Math.max(0, Number(input.durationMs));
  if (!input.startTimeUnixNano || !input.endTimeUnixNano) return 0;
  return Number(
    (BigInt(input.endTimeUnixNano) - BigInt(input.startTimeUnixNano)) /
      BigInt(1_000_000),
  );
}

function isError(status: InputSpan['status']) {
  if (typeof status === 'string') return status.toLowerCase() === 'error';
  return (
    status?.code === 2 ||
    String(status?.code).toUpperCase() === 'STATUS_CODE_ERROR'
  );
}

function extract(body: Record<string, unknown>) {
  if (Array.isArray(body.spans)) return body.spans as InputSpan[];
  const output: InputSpan[] = [];
  for (const resourceSpan of (body.resourceSpans as Array<
    Record<string, unknown>
  >) ?? []) {
    const resource = resourceSpan.resource as
      | { attributes?: unknown }
      | undefined;
    const resourceAttributes = attributeMap(resource?.attributes) as Record<
      string,
      unknown
    >;
    for (const scope of (resourceSpan.scopeSpans as Array<
      Record<string, unknown>
    >) ?? []) {
      for (const span of (scope.spans as InputSpan[]) ?? []) {
        output.push({
          ...span,
          service:
            typeof resourceAttributes['service.name'] === 'string'
              ? resourceAttributes['service.name']
              : (span.service ?? 'unknown-service'),
          environment:
            typeof resourceAttributes['deployment.environment.name'] ===
            'string'
              ? resourceAttributes['deployment.environment.name']
              : (span.environment ?? 'production'),
        });
      }
    }
  }
  return output;
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
    name: 'Telemetry Collector',
  };
  const teamId =
    runtime.INGESTION_TEAM_ID || (await ensureWorkspace(runtime.DB, actor));
  const body = (await request.json()) as Record<string, unknown>;
  const spans = extract(body);
  if (!spans.length || spans.length > 5000)
    return Response.json({ error: 'Provide 1–5000 spans' }, { status: 400 });
  const statements = spans.map((span) => {
    const attributes = attributeMap(span.attributes);
    return runtime.DB.prepare(
      `INSERT OR IGNORE INTO telemetry_spans
         (id, team_id, trace_id, parent_span_id, service, operation, status, started_at, duration_ms, environment, attributes_json, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'otel')`,
    ).bind(
      span.spanId ?? span.id ?? crypto.randomUUID(),
      teamId,
      span.traceId ?? crypto.randomUUID(),
      span.parentSpanId ?? null,
      String(span.service ?? 'unknown-service').slice(0, 100),
      String(span.operation ?? span.name ?? 'request').slice(0, 180),
      isError(span.status) ? 'error' : 'ok',
      span.startedAt ?? nanoToIso(span.startTimeUnixNano),
      duration(span),
      String(span.environment ?? 'production').slice(0, 50),
      JSON.stringify(attributes).slice(0, 8000),
    );
  });
  for (let index = 0; index < statements.length; index += 50)
    await runtime.DB.batch(statements.slice(index, index + 50));
  return Response.json({ accepted: spans.length }, { status: 202 });
}
