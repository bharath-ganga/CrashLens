import { env } from 'cloudflare:workers';
import { sessionUser } from './accounts';
import { createDatabase, type Database } from './database';
export { redactSensitiveData } from '@/lib/security';

export type CrashLensEnv = Cloudflare.Env & {
  DB: Database;
  FILES: R2Bucket;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  OPENAI_API_KEY?: string;
  SLACK_WEBHOOK_URL?: string;
  EMAIL_WEBHOOK_URL?: string;
  INGESTION_TOKEN?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  RESEND_WEBHOOK_SECRET?: string;
  SUPPORT_EMAIL?: string;
  PRIVACY_URL?: string;
  COMPANY_NAME?: string;
  MONITOR_CRON_TOKEN?: string;
  APP_ORIGIN?: string;
  PAGERDUTY_ROUTING_KEY?: string;
  ALERT_WEBHOOK_URL?: string;
  ALERT_WEBHOOK_SECRET?: string;
  ADMIN_EMAILS?: string;
  INGESTION_TEAM_ID?: string;
};

export function getRuntimeEnv(): CrashLensEnv {
  const runtime = env as Omit<CrashLensEnv, 'DB'>;
  if (!runtime.TURSO_DATABASE_URL || !runtime.TURSO_AUTH_TOKEN) {
    throw new Error(
      'TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be configured',
    );
  }
  return {
    ...runtime,
    DB: createDatabase(runtime.TURSO_DATABASE_URL, runtime.TURSO_AUTH_TOKEN),
  } as CrashLensEnv;
}

export function isPlatformAdmin(
  runtime: CrashLensEnv,
  user: { email: string },
) {
  const allowed = (runtime.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(user.email.trim().toLowerCase());
}

export async function ensureDatabase(db: Database): Promise<void> {
  await db.prepare('SELECT 1').first();
}

export async function authenticatedUser(request: Request) {
  const account = await sessionUser(request);
  if (account) return account;
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  const encodedName = request.headers.get('oai-authenticated-user-full-name');
  const encoding = request.headers.get(
    'oai-authenticated-user-full-name-encoding',
  );
  if (!id || !email) return null;
  let name = email.split('@')[0];
  if (encodedName && encoding === 'percent-encoded-utf-8') {
    try {
      name = decodeURIComponent(encodedName);
    } catch {
      /* use email fallback */
    }
  }
  return { id, email, name };
}

export async function ensureWorkspace(
  db: Database,
  user: { id: string; email: string; name: string },
) {
  const membership = await db
    .prepare(
      'SELECT team_id FROM team_members WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
    )
    .bind(user.id)
    .first<{ team_id: string }>();
  const teamId = membership?.team_id ?? `team-${user.id}`;
  const statements = [
    db
      .prepare(
        'INSERT INTO users (id, email, name) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name',
      )
      .bind(user.id, user.email, user.name),
    db
      .prepare(
        'INSERT OR IGNORE INTO teams (id, name, created_by) VALUES (?, ?, ?)',
      )
      .bind(teamId, 'CrashLens Operations', user.id),
    db
      .prepare(
        'INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)',
      )
      .bind(teamId, user.id, 'owner'),
  ];
  await db.batch(statements);
  return teamId;
}

export async function audit(
  db: Database,
  teamId: string,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
) {
  await db
    .prepare(
      'INSERT INTO audit_events (id, team_id, actor_id, action, target_type, target_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      crypto.randomUUID(),
      teamId,
      actorId,
      action,
      targetType,
      targetId,
      JSON.stringify(metadata),
    )
    .run();
}
