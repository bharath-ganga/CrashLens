import { ensureDatabase, getRuntimeEnv } from '@/db/runtime';
import { runMonitoring } from '@/db/monitors';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const env = getRuntimeEnv();
  if (
    !env.MONITOR_CRON_TOKEN ||
    request.headers.get('authorization') !== `Bearer ${env.MONITOR_CRON_TOKEN}`
  )
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureDatabase(env.DB);
  return Response.json(await runMonitoring(env));
}
