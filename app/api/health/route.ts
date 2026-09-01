import { ensureDatabase, getRuntimeEnv } from '@/db/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();
  try {
    const runtime = getRuntimeEnv();
    await ensureDatabase(runtime.DB);
    const result = await runtime.DB.prepare('SELECT 1 AS healthy').first<{ healthy: number }>();
    return Response.json({ status: result?.healthy === 1 ? 'healthy' : 'degraded', database: 'connected', storage: Boolean(runtime.FILES), latencyMs: Date.now() - started, timestamp: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'unhealthy', database: 'unavailable', latencyMs: Date.now() - started, timestamp: new Date().toISOString() }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
