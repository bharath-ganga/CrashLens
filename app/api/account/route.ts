import {
  ensureDatabase,
  ensureWorkspace,
  getRuntimeEnv,
  authenticatedUser,
} from '@/db/runtime';
import { emailConfigured, queueEmail, flushEmails } from '@/db/email';
import {
  randomToken,
  tokenHash,
  validPassword,
  hashPassword,
  verifyPassword,
} from '@/lib/passwords';

export const dynamic = 'force-dynamic';
const generic =
  'If this address has an eligible account, an email will arrive shortly.';
function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });
}
function cookie(request: Request, value: string, age: number) {
  return `crashlens_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
function appOrigin(env: ReturnType<typeof getRuntimeEnv>) {
  if (!env.APP_ORIGIN)
    throw new Error('Account email links need APP_ORIGIN configuration.');
  const url = new URL(env.APP_ORIGIN);
  if (
    url.protocol !== 'https:' &&
    !['localhost', '127.0.0.1'].includes(url.hostname)
  )
    throw new Error('APP_ORIGIN must use HTTPS.');
  return url.origin;
}
async function limit(key: string) {
  const db = getRuntimeEnv().DB;
  const now = Date.now();
  const cutoff = now - 15 * 60000;
  const row = await db
    .prepare(`INSERT INTO auth_limits (key,attempts,window_start) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END,
    window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END RETURNING attempts`)
    .bind(await tokenHash(key), now, cutoff, cutoff)
    .first<{ attempts: number }>();
  return (row?.attempts ?? 100) > 10;
}
export async function GET(request: Request) {
  return json({
    user: await authenticatedUser(request),
    emailConfigured: emailConfigured(getRuntimeEnv()),
  });
}
export async function POST(request: Request) {
  const env = getRuntimeEnv();
  await ensureDatabase(env.DB);
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return json({ error: 'Invalid origin' }, 403);
  try {
    const text = await request.text();
    if (text.length > 4096) return json({ error: 'Request too large' }, 413);
    const body = JSON.parse(text);
    const action = String(body.action ?? '');
    if (action === 'logout') {
      const raw = request.headers
        .get('cookie')
        ?.split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith('crashlens_session='))
        ?.slice(18);
      if (raw)
        await env.DB.prepare('DELETE FROM account_sessions WHERE token_hash=?')
          .bind(await tokenHash(raw))
          .run();
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
    }
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    const ip = request.headers.get('cf-connecting-ip') ?? 'local';
    if ((await limit(`ip:${ip}`)) || (email && (await limit(`email:${email}`))))
      return json(
        { error: 'Too many attempts. Try again in 15 minutes.' },
        429,
      );
    if (action === 'verify' || action === 'reset') {
      if (!/^[a-f0-9]{64}$/.test(String(body.token ?? '')))
        return json({ error: 'This link is invalid or expired.' }, 400);
      if (action === 'reset' && !validPassword(body.password))
        return json(
          { error: 'Use a password between 12 and 128 characters.' },
          400,
        );
      const digest = await tokenHash(body.token);
      const kind = action === 'verify' ? 'verify' : 'reset';
      const token = await env.DB.prepare(
        'SELECT user_id FROM account_tokens WHERE token_hash=? AND kind=? AND expires_at>?',
      )
        .bind(digest, kind, Date.now())
        .first<{ user_id: string }>();
      if (!token)
        return json(
          { error: 'This link is invalid, expired, or already used.' },
          400,
        );
      const encoded =
        action === 'reset' ? await hashPassword(body.password) : null;
      // Atomic condition ensures concurrent use of a reset token cannot update twice.
      const update =
        action === 'verify'
          ? env.DB.prepare(
              'UPDATE accounts SET verified=1 WHERE id=? AND EXISTS(SELECT 1 FROM account_tokens WHERE token_hash=? AND expires_at>?)',
            ).bind(token.user_id, digest, Date.now())
          : env.DB.prepare(
              'UPDATE accounts SET password_hash=? WHERE id=? AND EXISTS(SELECT 1 FROM account_tokens WHERE token_hash=? AND expires_at>?)',
            ).bind(encoded, token.user_id, digest, Date.now());
      await env.DB.batch([
        update,
        env.DB.prepare('DELETE FROM account_tokens WHERE user_id=?').bind(
          token.user_id,
        ),
        env.DB.prepare('DELETE FROM account_sessions WHERE user_id=?').bind(
          token.user_id,
        ),
      ]);
      return json({
        message:
          action === 'verify'
            ? 'Email verified. You can sign in now.'
            : 'Password changed. Sign in with your new password.',
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      return json({ error: 'Enter a valid email address.' }, 400);
    const account = await env.DB.prepare('SELECT * FROM accounts WHERE email=?')
      .bind(email)
      .first<{
        id: string;
        email: string;
        name: string;
        password_hash: string;
        verified: number;
      }>();
    if (action === 'login') {
      const candidate = typeof body.password === 'string' ? body.password : '';
      if (candidate.length > 128)
        return json({ error: 'Invalid email or password.' }, 401);
      const valid = await verifyPassword(
        candidate,
        account?.password_hash ??
          `pbkdf2-sha256:100000:${'0'.repeat(64)}:${'0'.repeat(64)}`,
      );
      if (!account || !valid)
        return json({ error: 'Invalid email or password.' }, 401);
      if (!account.verified)
        return json(
          {
            error:
              'Verify your email before signing in. Use Resend verification if needed.',
          },
          403,
        );
      const token = randomToken();
      const digest = await tokenHash(token);
      const team = await ensureWorkspace(env.DB, account);
      await env.DB.prepare(
        'INSERT INTO account_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',
      )
        .bind(digest, account.id, Date.now() + 7 * 86400000)
        .run();
      await queueEmail(
        env,
        team,
        email,
        `login:${digest}`,
        'New sign-in to CrashLens',
        `A sign-in to your CrashLens account succeeded at ${new Date().toISOString()}. If this was not you, open CrashLens and reset your password. Resetting it ends existing sessions.`,
      );
      await flushEmails(env);
      return json({ ok: true }, 200, {
        'Set-Cookie': cookie(request, token, 7 * 86400),
      });
    }
    if (!['signup', 'forgot', 'resend'].includes(action))
      return json({ error: 'Unknown action' }, 400);
    if (!emailConfigured(env))
      return json(
        {
          error:
            'Email sending is not configured. The administrator must connect a verified email sender before registration or password recovery is available.',
        },
        503,
      );
    const origin = appOrigin(env);
    let id = account?.id;
    let name = String(body.name ?? '')
      .trim()
      .slice(0, 100);
    if (action === 'signup') {
      if (!validPassword(body.password) || !name)
        return json(
          {
            error:
              'Enter your name and a password between 12 and 128 characters.',
          },
          400,
        );
      if (account) return json({ message: generic });
      id = crypto.randomUUID();
      const encoded = await hashPassword(body.password);
      await env.DB.prepare(
        'INSERT INTO accounts (id,email,name,password_hash) VALUES (?,?,?,?)',
      )
        .bind(id, email, name, encoded)
        .run();
    } else if (
      !account ||
      (action === 'forgot' && !account.verified) ||
      (action === 'resend' && account.verified)
    )
      return json({ message: generic });
    if (!id) return json({ message: generic });
    name = account?.name ?? name;
    const raw = randomToken();
    const digest = await tokenHash(raw);
    const kind = action === 'forgot' ? 'reset' : 'verify';
    const expires = Date.now() + (kind === 'reset' ? 30 : 60) * 60000;
    const link = `${origin}/account?mode=${kind}#token=${raw}`;
    await env.DB.batch([
      env.DB.prepare(
        'DELETE FROM account_tokens WHERE user_id=? AND kind=?',
      ).bind(id, kind),
      env.DB.prepare(
        'INSERT INTO account_tokens (token_hash,user_id,kind,expires_at) VALUES (?,?,?,?)',
      ).bind(digest, id, kind, expires),
    ]);
    await queueEmail(
      env,
      `account-${id}`,
      email,
      `${kind}:${digest}`,
      kind === 'reset'
        ? 'Reset your CrashLens password'
        : 'Verify your CrashLens email',
      `${name},\n\n${kind === 'reset' ? 'Reset your password' : 'Verify your email'} using this single-use link:\n${link}\n\nExpires in ${kind === 'reset' ? 30 : 60} minutes. Ignore this email if you did not request it.`,
    );
    await flushEmails(env);
    return json({ message: generic });
  } catch {
    return json(
      {
        error:
          'Account request could not be completed. Check configuration and try again.',
      },
      500,
    );
  }
}
