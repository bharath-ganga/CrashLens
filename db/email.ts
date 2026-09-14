import type { CrashLensEnv } from './runtime';

export function emailConfigured(env: CrashLensEnv) {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
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
  if (!emailConfigured(env)) return { configured: false, accepted: 0 };
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
  for (const row of rows.results) {
    const claim = await env.DB.prepare(
      "UPDATE email_outbox SET lease_until = ? WHERE id = ? AND status = 'pending' AND lease_until < ?",
    )
      .bind(now + 60000, row.id, now)
      .run();
    if (!claim.meta.changes) continue;
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': row.id,
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [row.recipient],
          subject: row.subject,
          text: row.body,
          html: buildBrandedEmailHtml(row.subject, row.body),
        }),
      });
      if (!response.ok)
        throw new Error(`Email provider returned ${response.status}`);
      await env.DB.prepare(
        "UPDATE email_outbox SET status = 'accepted', body = '', accepted_at = CURRENT_TIMESTAMP, attempts = attempts + 1, lease_until = 0, last_error = NULL WHERE id = ?",
      )
        .bind(row.id)
        .run();
      accepted++;
    } catch (error) {
      const attempts = row.attempts + 1;
      await env.DB.prepare(
        'UPDATE email_outbox SET attempts = ?, status = ?, next_attempt_at = ?, lease_until = 0, last_error = ? WHERE id = ?',
      )
        .bind(
          attempts,
          attempts >= 5 ? 'failed' : 'pending',
          now + Math.min(3600000, 60000 * 2 ** attempts),
          error instanceof Error ? error.message : 'Email delivery failed',
          row.id,
        )
        .run();
    }
  }
  return { configured: true, accepted };
}
