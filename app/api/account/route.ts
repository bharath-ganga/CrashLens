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
import { waitUntil } from 'cloudflare:workers';

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
function deliverQueuedEmails(env: ReturnType<typeof getRuntimeEnv>) {
  waitUntil(
    flushEmails(env)
      .then((result) => {
        if (result.failed)
          console.warn('One or more queued account emails will be retried', {
            failed: result.failed,
          });
      })
      .catch(() => {
        console.warn('Queued account email delivery will be retried');
      }),
  );
}
function signInDetails(request: Request) {
  const cf = (
    request as Request & {
      cf?: { city?: string; country?: string; region?: string };
    }
  ).cf;
  const location = [cf?.city, cf?.region, cf?.country]
    .filter(Boolean)
    .join(', ');
  const agent =
    request.headers.get('user-agent') ?? 'Unknown browser or device';
  return {
    ip: request.headers.get('cf-connecting-ip') ?? 'Unavailable',
    location: location || 'Unavailable',
    device: agent.slice(0, 300),
  };
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
  const user = await authenticatedUser(request);
  const preferences = user
    ? await getRuntimeEnv()
        .DB.prepare(
          `SELECT incident_alerts,team_activity,product_updates,digest_frequency
           FROM email_preferences WHERE user_id=?`,
        )
        .bind(user.id)
        .first<{
          incident_alerts: number;
          team_activity: number;
          product_updates: number;
          digest_frequency: string;
        }>()
    : null;
  return json({
    user,
    emailConfigured: emailConfigured(getRuntimeEnv()),
    preferences: user
      ? {
          incidentAlerts: Boolean(preferences?.incident_alerts ?? 1),
          teamActivity: Boolean(preferences?.team_activity ?? 1),
          productUpdates: Boolean(preferences?.product_updates ?? 0),
          digestFrequency: preferences?.digest_frequency ?? 'none',
        }
      : null,
  });
}
export async function POST(request: Request) {
  const env = getRuntimeEnv();
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return json({ error: 'Invalid origin' }, 403);
  try {
    await ensureDatabase(env.DB);
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
    if (action === 'update_preferences') {
      const user = await authenticatedUser(request);
      if (!user) return json({ error: 'Authentication required' }, 401);
      const digest = ['none', 'daily', 'weekly'].includes(body.digestFrequency)
        ? body.digestFrequency
        : 'none';
      await env.DB.prepare(
        `INSERT INTO email_preferences
         (user_id,incident_alerts,team_activity,product_updates,digest_frequency)
         VALUES (?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET
           incident_alerts=excluded.incident_alerts,
           team_activity=excluded.team_activity,
           product_updates=excluded.product_updates,
           digest_frequency=excluded.digest_frequency,
           updated_at=CURRENT_TIMESTAMP`,
      )
        .bind(
          user.id,
          body.incidentAlerts ? 1 : 0,
          body.teamActivity ? 1 : 0,
          body.productUpdates ? 1 : 0,
          digest,
        )
        .run();
      return json({ message: 'Email preferences updated successfully.' });
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
      const tokenAccount = await env.DB.prepare(
        'SELECT email,name FROM accounts WHERE id=?',
      )
        .bind(token.user_id)
        .first<{ email: string; name: string }>();
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
      if (action === 'reset' && tokenAccount && emailConfigured(env)) {
        await queueEmail(
          env,
          `account-${token.user_id}`,
          tokenAccount.email,
          `password-changed:${digest}`,
          'Security confirmation: Your CrashLens password was changed',
          `Dear ${tokenAccount.name},\n\nThis message is to confirm that the password associated with your CrashLens account was changed successfully. All existing sessions have been securely terminated.\n\nIf you made this change, no further action is required. If you did not authorize it, please contact your administrator immediately.\n\nYours sincerely,\nCrashLens Security Team`,
        );
        deliverQueuedEmails(env);
      }
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
              'Please verify your email address before signing in. You may request a new verification email below.',
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
        'Security notification: New sign-in to your CrashLens account',
        `Dear ${account.name},\n\nThis message is to formally confirm that a new sign-in to your CrashLens account was completed successfully.\n\nDate and time: ${new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'long', timeZone: 'UTC' }).format(new Date())} UTC\nIP address: ${signInDetails(request).ip}\nApproximate location: ${signInDetails(request).location}\nBrowser or device: ${signInDetails(request).device}\n\nIf you authorized this activity, no further action is required. If you do not recognize this sign-in, please reset your password immediately. Resetting your password will securely terminate all existing sessions.\n\nYours sincerely,\nCrashLens Security Team`,
      );
      deliverQueuedEmails(env);
      return json({ ok: true }, 200, {
        'Set-Cookie': cookie(request, token, 7 * 86400),
      });
    }
    if (!['signup', 'forgot', 'resend'].includes(action))
      return json({ error: 'Unknown action' }, 400);
    if (action === 'signup') {
      const name = String(body.name ?? '')
        .trim()
        .slice(0, 100);
      if (!name || !validPassword(body.password))
        return json(
          {
            error:
              'Enter your name and a password between 12 and 128 characters.',
          },
          400,
        );
      if (!emailConfigured(env))
        return json(
          {
            error:
              'Account registration is temporarily unavailable because email verification is not configured.',
          },
          503,
        );
      if (account)
        return json(
          {
            error:
              'An account already uses this email. Sign in with your existing password, or use Forgot password.',
          },
          409,
        );
      const created = await env.DB.prepare(
        'INSERT INTO accounts (id,email,name,password_hash) VALUES (?,?,?,?) ON CONFLICT(email) DO NOTHING RETURNING id',
      )
        .bind(
          crypto.randomUUID(),
          email,
          name,
          await hashPassword(body.password),
        )
        .first<{ id: string }>();
      if (!created)
        return json(
          { error: 'An account already uses this email. Please sign in.' },
          409,
        );
      const raw = randomToken();
      const digest = await tokenHash(raw);
      const link = `${appOrigin(env)}/account?mode=verify#token=${raw}`;
      await env.DB.prepare(
        'INSERT INTO account_tokens (token_hash,user_id,kind,expires_at) VALUES (?,?,?,?)',
      )
        .bind(digest, created.id, 'verify', Date.now() + 60 * 60000)
        .run();
      await queueEmail(
        env,
        `account-${created.id}`,
        email,
        `welcome:${created.id}`,
        'Welcome to CrashLens — Please verify your email address',
        `Dear ${name},\n\nWelcome to CrashLens.\n\nWe are pleased to confirm that your account has been created successfully. Before signing in, please verify ownership of your email address using the secure, single-use link below.\n\n${link}\n\nThis link will expire in 60 minutes. For the security of your account, please keep your sign-in credentials confidential. CrashLens will never ask you to disclose your password by email.\n\nIf you did not create this account, no action is required.\n\nYours sincerely,\nCrashLens Team`,
      );
      deliverQueuedEmails(env);
      return json(
        {
          message:
            'Account created. Please check your email and verify your address before signing in.',
        },
        201,
      );
    }
    if (!emailConfigured(env))
      return json(
        {
          error:
            'Email sending is not configured. Password recovery requires an email sender. You can still create an account and sign in.',
        },
        503,
      );
    const origin = appOrigin(env);
    const id = account?.id;
    if (!account || (action === 'resend' && account.verified))
      return json({ message: generic });
    if (!id) return json({ message: generic });
    const name = account.name;
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
        ? 'Action required: Reset your CrashLens password'
        : 'Action required: Verify your CrashLens email address',
      kind === 'reset'
        ? `Dear ${name},\n\nWe received a request to reset the password associated with your CrashLens account. Please use the secure, single-use link below to create a new password.\n\n${link}\n\nFor your protection, this link will expire in 30 minutes. If you did not submit this request, no action is required; your existing password will remain unchanged.\n\nYours sincerely,\nCrashLens Security Team`
        : `Dear ${name},\n\nThank you for using CrashLens. Please confirm ownership of your email address by using the secure, single-use link below.\n\n${link}\n\nThis link will expire in 60 minutes. If you did not request this verification, no action is required.\n\nYours sincerely,\nCrashLens Security Team`,
    );
    deliverQueuedEmails(env);
    return json({ message: generic });
  } catch (error) {
    console.error(
      'Account request failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    return json(
      {
        error:
          'Account request could not be completed. Check configuration and try again.',
      },
      500,
    );
  }
}
