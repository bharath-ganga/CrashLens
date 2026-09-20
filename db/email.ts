import type { CrashLensEnv } from './runtime';
import { Resend } from 'resend';

type ResendError = {
  message?: string;
  name?: string;
  statusCode?: number | null;
};

export type ResendEmailClient = {
  emails: {
    send(
      message: {
        from: string;
        to: string[];
        subject: string;
        text: string;
        html: string;
      },
      options?: { idempotencyKey?: string },
    ): Promise<{
      data: { id: string } | null;
      error: ResendError | null;
    }>;
  };
};

type ResendConfiguration =
  | { configured: true; apiKey: string; from: string }
  | { configured: false; error: string };

const EMAIL_ADDRESS = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

function senderAddress(from: string) {
  const match = from.match(/<([^<>]+)>\s*$/);
  return (match?.[1] ?? from).trim().toLowerCase();
}

export function resendConfiguration(env: CrashLensEnv): ResendConfiguration {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey)
    return {
      configured: false,
      error:
        'RESEND_API_KEY is missing. Add a Resend API key as a deployment secret.',
    };
  if (!/^re_[A-Za-z0-9_-]{8,}$/.test(apiKey))
    return {
      configured: false,
      error: 'RESEND_API_KEY is invalid. Resend API keys begin with "re_".',
    };
  if (!from)
    return {
      configured: false,
      error:
        'EMAIL_FROM is missing. Use an address on a verified Resend domain.',
    };
  const address = senderAddress(from);
  if (!EMAIL_ADDRESS.test(address))
    return {
      configured: false,
      error:
        'EMAIL_FROM is invalid. Use "CrashLens <alerts@verified-domain.example>" or a plain email address.',
    };
  if (/@(example\.com|example\.net|example\.org)$/i.test(address))
    return {
      configured: false,
      error:
        'EMAIL_FROM uses a placeholder domain. Configure a verified Resend domain or onboarding@resend.dev for development.',
    };
  return { configured: true, apiKey, from };
}

export function emailConfigured(env: CrashLensEnv) {
  return resendConfiguration(env).configured;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function buildBrandedEmailHtml(subject: string, body: string) {
  const actionLabel = /reset.*password|password.*reset/i.test(subject)
    ? 'Reset password securely'
    : 'Open CrashLens';
  const content = body
    .split(/\n\n+/)
    .map((paragraph) => {
      const value = paragraph.trim();
      if (/^https?:\/\/\S+$/.test(value)) {
        const safeUrl = escapeHtml(value);
        return `<p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#7c6cff;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${actionLabel}</a></p><p style="margin:0 0 22px;color:#667085;font-size:12px;line-height:1.6;word-break:break-all">If the button does not work, copy and paste this link into your browser:<br>${safeUrl}</p>`;
      }
      return `<p style="margin:0 0 18px;color:#344054;font-size:15px;line-height:1.7">${escapeHtml(value).replaceAll('\n', '<br>')}</p>`;
    })
    .join('');

  return `<!doctype html><html><body style="margin:0;background:#f2f4f7;font-family:Inter,Segoe UI,Arial,sans-serif;color:#101828"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f4f7;padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e4e7ec;border-radius:12px;overflow:hidden"><tr><td style="background:#0d1017;padding:22px 28px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="width:34px;height:34px;background:#7c6cff;border-radius:9px;text-align:center;color:#ffffff;font-weight:700;font-size:18px">C</td><td style="padding-left:11px;color:#ffffff;font-size:17px;font-weight:700">CrashLens</td></tr></table></td></tr><tr><td style="padding:32px 28px 24px"><h1 style="margin:0 0 22px;color:#101828;font-size:24px;line-height:1.3">${escapeHtml(subject)}</h1>${content}</td></tr><tr><td style="border-top:1px solid #e4e7ec;padding:20px 28px;color:#667085;font-size:12px;line-height:1.6">This is an automated security notification from CrashLens. Please do not reply to this email.</td></tr></table></td></tr></table></body></html>`;
}

export async function queueEmail(
  env: CrashLensEnv,
  teamId: string,
  recipient: string,
  event: string,
  subject: string,
  body: string,
) {
  await env.DB.prepare(`INSERT OR IGNORE INTO email_outbox (id,event_key,team_id,recipient,subject,body)
    VALUES (?,?,?,?,?,?)`)
    .bind(
      crypto.randomUUID(),
      event,
      teamId,
      recipient,
      subject.slice(0, 180),
      body.slice(0, 12000),
    )
    .run();
}

export async function queueTeamEmail(
  env: CrashLensEnv,
  teamId: string,
  event: string,
  subject: string,
  body: string,
) {
  const members = await env.DB.prepare(
    'SELECT u.email FROM users u JOIN team_members tm ON tm.user_id = u.id WHERE tm.team_id = ?',
  )
    .bind(teamId)
    .all<{ email: string }>();
  for (const member of members.results) {
    if (!member.email.endsWith('.local') && !member.email.endsWith('.test'))
      await queueEmail(env, teamId, member.email, event, subject, body);
  }
}

export async function flushEmails(env: CrashLensEnv) {
  return flushEmailsWithClient(env);
}

function providerError(error: ResendError) {
  if (error.statusCode === 401)
    return 'Resend rejected RESEND_API_KEY. Replace the deployment secret with a valid API key.';
  switch (error.name) {
    case 'invalid_api_key':
    case 'missing_api_key':
      return 'Resend rejected RESEND_API_KEY. Replace the deployment secret with a valid API key.';
    case 'restricted_api_key':
      return 'RESEND_API_KEY is not permitted to send this email. Review the key permissions in Resend.';
    case 'invalid_from_address':
      return 'Resend rejected EMAIL_FROM. Use a valid sender on a verified Resend domain.';
    case 'validation_error':
      return 'Resend rejected the email configuration. Verify EMAIL_FROM and its domain in Resend.';
    case 'rate_limit_exceeded':
      return 'Resend rate limit reached. CrashLens will retry automatically.';
    case 'daily_quota_exceeded':
    case 'monthly_quota_exceeded':
      return 'Resend sending quota exceeded. Increase the quota or wait for it to reset.';
    default:
      return 'Resend could not accept the email. CrashLens will retry automatically.';
  }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Resend request timed out.')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function flushEmailsWithClient(
  env: CrashLensEnv,
  suppliedClient?: ResendEmailClient,
) {
  const configuration = resendConfiguration(env);
  if (!configuration.configured)
    return {
      configured: false as const,
      accepted: 0,
      failed: 0,
      error: configuration.error,
    };
  const client = suppliedClient ?? new Resend(configuration.apiKey);
  const now = Date.now();
  const rows = await env.DB.prepare(
    `SELECT * FROM email_outbox WHERE status = 'pending' AND next_attempt_at <= ? AND lease_until < ? LIMIT 10`,
  )
    .bind(now, now)
    .all<{
      id: string;
      recipient: string;
      subject: string;
      body: string;
      attempts: number;
    }>();
  let accepted = 0;
  let failed = 0;
  let lastError: string | undefined;
  for (const row of rows.results) {
    const claim = await env.DB.prepare(
      "UPDATE email_outbox SET lease_until = ? WHERE id = ? AND status = 'pending' AND lease_until < ?",
    )
      .bind(now + 60000, row.id, now)
      .run();
    if (!claim.meta.changes) continue;
    try {
      const response = await withTimeout(
        client.emails.send(
          {
            from: configuration.from,
            to: [row.recipient],
            subject: row.subject,
            text: row.body,
            html: buildBrandedEmailHtml(row.subject, row.body),
          },
          { idempotencyKey: row.id },
        ),
        10000,
      );
      if (response.error) {
        console.warn('Resend rejected an outbox email', {
          outboxId: row.id,
          code: response.error.name ?? 'unknown',
          statusCode: response.error.statusCode ?? null,
        });
        throw new Error(providerError(response.error));
      }
      if (!response.data?.id)
        throw new Error(
          'Resend returned an invalid response. CrashLens will retry automatically.',
        );
      await env.DB.prepare(
        "UPDATE email_outbox SET status = 'accepted', body = '', accepted_at = CURRENT_TIMESTAMP, attempts = attempts + 1, lease_until = 0, last_error = NULL WHERE id = ?",
      )
        .bind(row.id)
        .run();
      accepted++;
      console.info('Resend accepted an outbox email', { outboxId: row.id });
    } catch (error) {
      const attempts = row.attempts + 1;
      const message =
        error instanceof Error && error.message.startsWith('Resend')
          ? error.message
          : 'Resend request failed. CrashLens will retry automatically.';
      lastError = message;
      await env.DB.prepare(
        'UPDATE email_outbox SET attempts = ?, status = ?, next_attempt_at = ?, lease_until = 0, last_error = ? WHERE id = ?',
      )
        .bind(
          attempts,
          attempts >= 5 ? 'failed' : 'pending',
          now + Math.min(3600000, 60000 * 2 ** attempts),
          message,
          row.id,
        )
        .run();
      failed++;
      console.warn('Resend delivery attempt failed', {
        outboxId: row.id,
        attempt: attempts,
        willRetry: attempts < 5,
      });
    }
  }
  return {
    configured: true as const,
    accepted,
    failed,
    ...(lastError ? { error: lastError } : {}),
  };
}
