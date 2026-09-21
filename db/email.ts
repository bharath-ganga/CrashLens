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

export function deliverableEmailAddress(email: string) {
  const normalized = email.trim().toLowerCase();
  return !normalized.endsWith('.local') && !normalized.endsWith('.test');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

type EmailBranding = {
  appOrigin?: string;
  companyName?: string;
  privacyUrl?: string;
  supportEmail?: string;
};

export function buildBrandedEmailHtml(
  subject: string,
  body: string,
  branding: EmailBranding = {},
) {
  const actionLabel = /reset.*password|password.*reset/i.test(subject)
    ? 'Reset password securely'
    : /verify/i.test(subject)
      ? 'Verify email address'
      : 'Open CrashLens';
  const content = body
    .split(/\n\n+/)
    .map((paragraph) => {
      const value = paragraph.trim();
      if (/^https?:\/\/\S+$/.test(value)) {
        const safeUrl = escapeHtml(value);
        return `<p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#6f5cf1;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:7px">${actionLabel}</a></p><p style="margin:0 auto 22px;max-width:470px;color:#667085;font-size:12px;line-height:1.6;word-break:break-all">If the button does not work, copy and paste this link into your browser:<br>${safeUrl}</p>`;
      }
      return `<p style="margin:0 auto 20px;max-width:470px;color:#475467;font-size:15px;line-height:1.65">${escapeHtml(value).replaceAll('\n', '<br>')}</p>`;
    })
    .join('');

  const company = escapeHtml(branding.companyName?.trim() || 'CrashLens');
  const logoUrl = branding.appOrigin
    ? escapeHtml(`${branding.appOrigin.replace(/\/+$/, '')}/crashlens-mark.png`)
    : '';
  const brandMark = logoUrl
    ? `<img src="${logoUrl}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border:0;border-radius:10px">`
    : `<span style="display:block;width:40px;height:40px;border-radius:10px;background:#6f5cf1;color:#ffffff;text-align:center;font-size:24px;line-height:40px;font-weight:700">∿</span>`;
  const links = [
    branding.appOrigin
      ? `<a href="${escapeHtml(branding.appOrigin)}" style="color:#475467">Website</a>`
      : '',
    branding.privacyUrl
      ? `<a href="${escapeHtml(branding.privacyUrl)}" style="color:#475467">Privacy</a>`
      : '',
    branding.supportEmail
      ? `<a href="mailto:${escapeHtml(branding.supportEmail)}" style="color:#475467">Support</a>`
      : '',
  ].filter(Boolean);
  const footerLinks = links.length
    ? `<br>${links.join(' &nbsp;·&nbsp; ')}`
    : '';
  const year = new Date().getUTCFullYear();
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Inter,Segoe UI,Arial,sans-serif;color:#101828"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:28px 16px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e4e7ec;border-radius:12px;overflow:hidden"><tr><td align="center" style="background:#0d1017;padding:25px 28px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td width="40" style="width:40px">${brandMark}</td><td style="padding-left:12px;color:#ffffff;font-size:21px;line-height:1.2;font-weight:700">${company}</td></tr></table></td></tr><tr><td align="center" style="padding:30px 28px 10px;text-align:center"><h1 style="margin:0 auto 24px;max-width:480px;color:#101828;font-size:22px;line-height:1.35;font-weight:600">${escapeHtml(subject)}</h1>${content}<table role="presentation" width="82%" cellspacing="0" cellpadding="0" style="margin:28px auto 0;border-top:1px solid #d0d5dd"><tr><td style="height:1px;font-size:1px;line-height:1px">&nbsp;</td></tr></table></td></tr><tr><td align="center" style="padding:10px 28px 28px;text-align:center;color:#667085;font-size:12px;line-height:1.7"><div>This is an automated notification from ${company}. Please do not reply.</div><div style="margin-top:8px">© ${year} ${company}. All rights reserved.</div>${footerLinks}</td></tr></table></td></tr></table></body></html>`;
}

export async function queueEmail(
  env: CrashLensEnv,
  teamId: string,
  recipient: string,
  event: string,
  subject: string,
  body: string,
) {
  const normalizedRecipient = recipient.trim().toLowerCase();
  const testRecipient = !deliverableEmailAddress(normalizedRecipient);
  const suppression = await env.DB.prepare(
    'SELECT reason FROM email_suppressions WHERE email=?',
  )
    .bind(normalizedRecipient)
    .first<{ reason: string }>();
  await env.DB.prepare(`INSERT OR IGNORE INTO email_outbox (id,event_key,team_id,recipient,subject,body,status,last_error)
    VALUES (?,?,?,?,?,?,?,?)`)
    .bind(
      crypto.randomUUID(),
      event,
      teamId,
      normalizedRecipient,
      subject.slice(0, 180),
      body.slice(0, 12000),
      suppression || testRecipient ? 'suppressed' : 'pending',
      suppression
        ? `Recipient suppressed: ${suppression.reason}`
        : testRecipient
          ? 'Recipient uses a reserved non-deliverable domain.'
          : null,
    )
    .run();
}

export async function queueTeamEmail(
  env: CrashLensEnv,
  teamId: string,
  event: string,
  subject: string,
  body: string,
  category: 'incident' | 'team' | 'product' = 'incident',
) {
  const preferenceColumn =
    category === 'incident'
      ? 'incident_alerts'
      : category === 'team'
        ? 'team_activity'
        : 'product_updates';
  const members = await env.DB.prepare(
    `SELECT u.email FROM users u
     JOIN team_members tm ON tm.user_id = u.id
     LEFT JOIN email_preferences ep ON ep.user_id = u.id
     WHERE tm.team_id = ? AND COALESCE(ep.${preferenceColumn}, ${category === 'product' ? 0 : 1}) = 1`,
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
            html: buildBrandedEmailHtml(row.subject, row.body, {
              appOrigin: env.APP_ORIGIN,
              companyName: env.COMPANY_NAME,
              privacyUrl: env.PRIVACY_URL,
              supportEmail: env.SUPPORT_EMAIL,
            }),
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
      await env.DB.prepare(
        `INSERT INTO email_provider_messages
         (provider_email_id,outbox_id,recipient,last_event,last_event_at)
         VALUES (?,?,?,'sent',CURRENT_TIMESTAMP)
         ON CONFLICT(provider_email_id) DO UPDATE SET last_event='sent',last_event_at=CURRENT_TIMESTAMP`,
      )
        .bind(response.data.id, row.id, row.recipient)
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
