import {
  audit,
  authenticatedUser,
  ensureDatabase,
  ensureWorkspace,
  getRuntimeEnv,
} from '@/db/runtime';
import {
  buildPostmortem,
  calculateAnomaly,
  correlateDeployment,
  errorBudgetPercent,
  type DeploymentSignal,
  type TelemetrySpan,
} from '@/lib/intelligence';

export const dynamic = 'force-dynamic';

async function context(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return null;
  const runtime = getRuntimeEnv();
  await ensureDatabase(runtime.DB);
  const teamId = await ensureWorkspace(runtime.DB, user);
  return { user, runtime, teamId };
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function textValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function mapSpan(row: Record<string, unknown>): TelemetrySpan {
  return {
    id: String(row.id),
    traceId: String(row.trace_id),
    parentSpanId: textValue(row.parent_span_id) || null,
    service: String(row.service),
    operation: String(row.operation),
    status: row.status === 'error' ? 'error' : 'ok',
    startedAt: String(row.started_at),
    durationMs: Number(row.duration_ms),
    environment: String(row.environment),
    attributes: JSON.parse(textValue(row.attributes_json, '{}')),
  };
}

function mapDeployment(row: Record<string, unknown>): DeploymentSignal {
  return {
    id: String(row.id),
    service: String(row.service),
    version: String(row.version),
    environment: String(row.environment),
    status: String(row.status),
    deployedAt: String(row.deployed_at),
    actor: textValue(row.actor) || null,
  };
}

export async function GET(request: Request) {
  const ctx = await context(request);
  if (!ctx) return json({ error: 'Authentication required' }, 401);
  const [spanRows, deploymentRows, objectives, reports] = await Promise.all([
    ctx.runtime.DB.prepare(
      'SELECT * FROM telemetry_spans WHERE team_id = ? ORDER BY started_at DESC LIMIT 300',
    )
      .bind(ctx.teamId)
      .all(),
    ctx.runtime.DB.prepare(
      'SELECT * FROM deployments WHERE team_id = ? ORDER BY deployed_at DESC LIMIT 50',
    )
      .bind(ctx.teamId)
      .all(),
    ctx.runtime.DB.prepare(
      'SELECT service, target_percent, window_days FROM service_objectives WHERE team_id = ? ORDER BY service',
    )
      .bind(ctx.teamId)
      .all(),
    ctx.runtime.DB.prepare(
      'SELECT id, incident_id, title, created_at FROM postmortems WHERE team_id = ? ORDER BY created_at DESC LIMIT 10',
    )
      .bind(ctx.teamId)
      .all(),
  ]);
  const spans = spanRows.results.map(mapSpan);
  const deployments = deploymentRows.results.map(mapDeployment);
  const traces = [...new Set(spans.map((span) => span.traceId))].map(
    (traceId) => {
      const traceSpans = spans
        .filter((span) => span.traceId === traceId)
        .sort(
          (a, b) =>
            new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
        );
      const failed = traceSpans.find((span) => span.status === 'error');
      return {
        traceId,
        startedAt: traceSpans[0]?.startedAt,
        durationMs: traceSpans.reduce(
          (longest, span) => Math.max(longest, span.durationMs),
          0,
        ),
        status: failed ? 'error' : 'ok',
        failedService: failed?.service ?? null,
        spans: traceSpans,
      };
    },
  );
  const now = Date.now();
  const currentErrors = spans.filter(
    (span) =>
      span.status === 'error' &&
      now - new Date(span.startedAt).getTime() <= 15 * 60_000,
  ).length;
  const previousErrors = spans.filter((span) => {
    const age = now - new Date(span.startedAt).getTime();
    return span.status === 'error' && age > 15 * 60_000 && age <= 30 * 60_000;
  }).length;
  const latestFailure = spans.find((span) => span.status === 'error');
  const deployment = latestFailure
    ? correlateDeployment(
        latestFailure.service,
        latestFailure.startedAt,
        deployments,
      )
    : null;
  const total = spans.length;
  const successful = spans.filter((span) => span.status === 'ok').length;
  const target = Number(
    (objectives.results[0] as Record<string, unknown> | undefined)
      ?.target_percent ?? 99.9,
  );
  return json({
    spans,
    traces,
    deployments,
    objectives: objectives.results,
    reports: reports.results,
    anomaly: {
      ...calculateAnomaly(currentErrors, previousErrors),
      currentErrors,
      previousErrors,
    },
    correlation: latestFailure
      ? { failure: latestFailure, deployment, windowMinutes: 60 }
      : null,
    reliability: {
      targetPercent: target,
      observedPercent: total
        ? Number(((successful / total) * 100).toFixed(2))
        : null,
      errorBudgetRemaining: errorBudgetPercent(successful, total, target),
      sampleSize: total,
    },
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
  const body = (await request.json()) as Record<string, unknown>;
  const action = textValue(body.action);

  if (action === 'seed_demo') {
    const base = Date.now();
    const traceId = `trace-demo-${base}`;
    const deploymentId = crypto.randomUUID();
    await ctx.runtime.DB.prepare(
      `INSERT INTO deployments (id, team_id, service, version, environment, status, actor, deployed_at, source)
       VALUES (?, ?, 'payment-service', 'checkout-v318', 'production', 'success', ?, ?, 'demo')`,
    )
      .bind(
        deploymentId,
        ctx.teamId,
        ctx.user.name,
        new Date(base - 8 * 60_000).toISOString(),
      )
      .run();
    const spanData = [
      ['gateway', 'POST /checkout', 'ok', 810, null, -3_000],
      ['checkout-service', 'create-order', 'ok', 690, 'gateway', -2_900],
      [
        'payment-service',
        'charge-card',
        'error',
        612,
        'checkout-service',
        -2_800,
      ],
      [
        'payment-service',
        'postgres.query',
        'error',
        590,
        'payment-service',
        -2_700,
      ],
      [
        'payment-service',
        'connection-pool.acquire',
        'error',
        570,
        'payment-service',
        -2_650,
      ],
    ] as const;
    await ctx.runtime.DB.batch(
      spanData.map(
        ([service, operation, status, duration, parent, offset], index) =>
          ctx.runtime.DB.prepare(
            `INSERT INTO telemetry_spans
           (id, team_id, trace_id, parent_span_id, service, operation, status, started_at, duration_ms, environment, attributes_json, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'production', ?, 'demo')`,
          ).bind(
            `${traceId}-${index}`,
            ctx.teamId,
            traceId,
            parent ? `${traceId}-${Math.max(0, index - 1)}` : null,
            service,
            operation,
            status,
            new Date(base + offset).toISOString(),
            duration,
            JSON.stringify({ 'http.route': '/checkout', 'demo.signal': true }),
          ),
      ),
    );
    await ctx.runtime.DB.prepare(
      `INSERT INTO service_objectives (id, team_id, service, target_percent, window_days)
       VALUES (?, ?, 'payment-service', 99.9, 30)
       ON CONFLICT(team_id, service) DO UPDATE SET target_percent = 99.9, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(crypto.randomUUID(), ctx.teamId)
      .run();
    await audit(
      ctx.runtime.DB,
      ctx.teamId,
      ctx.user.id,
      'intelligence.demo_loaded',
      'trace',
      traceId,
    );
    return json({ ok: true, traceId }, 201);
  }

  if (action === 'set_slo') {
    const service = textValue(body.service).trim().slice(0, 100);
    const target = Number(body.targetPercent);
    const windowDays = Number(body.windowDays ?? 30);
    if (
      !service ||
      !Number.isFinite(target) ||
      target < 90 ||
      target > 100 ||
      ![7, 14, 30, 90].includes(windowDays)
    )
      return json(
        {
          error:
            'Provide a service, target from 90–100%, and a supported window.',
        },
        400,
      );
    await ctx.runtime.DB.prepare(
      `INSERT INTO service_objectives (id, team_id, service, target_percent, window_days)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(team_id, service) DO UPDATE SET target_percent = excluded.target_percent,
       window_days = excluded.window_days, updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(crypto.randomUUID(), ctx.teamId, service, target, windowDays)
      .run();
    await audit(
      ctx.runtime.DB,
      ctx.teamId,
      ctx.user.id,
      'slo.updated',
      'service',
      service,
      { target, windowDays },
    );
    return json({ ok: true });
  }

  if (action === 'generate_postmortem') {
    const [incident, failedSpan, deployment] = await Promise.all([
      ctx.runtime.DB.prepare(
        'SELECT id, title, service, started_at, status, updated_at FROM incidents WHERE team_id = ? ORDER BY created_at DESC LIMIT 1',
      )
        .bind(ctx.teamId)
        .first<Record<string, unknown>>(),
      ctx.runtime.DB.prepare(
        "SELECT trace_id, service, started_at FROM telemetry_spans WHERE team_id = ? AND status = 'error' ORDER BY started_at DESC LIMIT 1",
      )
        .bind(ctx.teamId)
        .first<Record<string, unknown>>(),
      ctx.runtime.DB.prepare(
        'SELECT * FROM deployments WHERE team_id = ? ORDER BY deployed_at DESC LIMIT 1',
      )
        .bind(ctx.teamId)
        .first<Record<string, unknown>>(),
    ]);
    const report = buildPostmortem({
      title: textValue(incident?.title, 'Production request failure'),
      service: textValue(
        incident?.service,
        textValue(failedSpan?.service, 'payment-service'),
      ),
      startedAt: textValue(
        incident?.started_at,
        textValue(failedSpan?.started_at, new Date().toISOString()),
      ),
      resolvedAt:
        incident?.status === 'resolved' ? String(incident.updated_at) : null,
      deployment: deployment ? mapDeployment(deployment) : null,
      traceId: textValue(failedSpan?.trace_id) || null,
    });
    const id = crypto.randomUUID();
    await ctx.runtime.DB.prepare(
      'INSERT INTO postmortems (id, team_id, incident_id, title, report_markdown, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(
        id,
        ctx.teamId,
        incident?.id ?? null,
        textValue(incident?.title, 'Production request failure'),
        report,
        ctx.user.id,
      )
      .run();
    return json({ ok: true, id, report }, 201);
  }
  return json({ error: 'Unknown action' }, 400);
}
