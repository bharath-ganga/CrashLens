import { env } from 'cloudflare:workers';
import { schemaStatements } from './schema';
export { redactSensitiveData } from '@/lib/security';

export type CrashLensEnv = Cloudflare.Env & {
  DB: D1Database;
  FILES: R2Bucket;
  OPENAI_API_KEY?: string;
  SLACK_WEBHOOK_URL?: string;
  EMAIL_WEBHOOK_URL?: string;
  INGESTION_TOKEN?: string;
};

export function getRuntimeEnv(): CrashLensEnv {
  return env as CrashLensEnv;
}

let schemaReady: Promise<void> | null = null;

export async function ensureDatabase(db: D1Database): Promise<void> {
  schemaReady ??= (async () => {
    for (const statement of schemaStatements) await db.prepare(statement).run();
    await db.prepare('PRAGMA optimize').run();
  })();
  await schemaReady;
}

export function authenticatedUser(request: Request) {
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  const encodedName = request.headers.get('oai-authenticated-user-full-name');
  const encoding = request.headers.get('oai-authenticated-user-full-name-encoding');
  if (!id || !email) return null;
  let name = email.split('@')[0];
  if (encodedName && encoding === 'percent-encoded-utf-8') {
    try { name = decodeURIComponent(encodedName); } catch { /* use email fallback */ }
  }
  return { id, email, name };
}

export async function ensureWorkspace(db: D1Database, user: { id: string; email: string; name: string }) {
  const teamId = 'team-crashlens-operations';
  await db.batch([
    db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name').bind(user.id, user.email, user.name),
    db.prepare('INSERT OR IGNORE INTO teams (id, name, created_by) VALUES (?, ?, ?)').bind(teamId, 'CrashLens Operations', user.id),
    db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner')").bind(teamId, user.id),
  ]);
  return teamId;
}

export async function audit(db: D1Database, teamId: string, actorId: string, action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
  await db.prepare('INSERT INTO audit_events (id, team_id, actor_id, action, target_type, target_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), teamId, actorId, action, targetType, targetId, JSON.stringify(metadata)).run();
}
