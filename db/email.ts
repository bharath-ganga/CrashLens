import type { CrashLensEnv } from './runtime';

export function emailConfigured(env: CrashLensEnv) {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
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
