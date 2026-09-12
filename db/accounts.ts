import { getRuntimeEnv } from './runtime';
import { tokenHash } from '../lib/passwords';
export async function sessionUser(request: Request) {
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('crashlens_session='))
    ?.slice('crashlens_session='.length);
  if (!cookie || !/^[a-f0-9]{64}$/.test(cookie)) return null;
  return getRuntimeEnv()
    .DB.prepare(`SELECT a.id,a.email,a.name FROM account_sessions s JOIN accounts a ON a.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`)
    .bind(await tokenHash(cookie), Date.now())
    .first<{ id: string; email: string; name: string }>();
}
