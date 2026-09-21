import type { CrashLensEnv } from './runtime';
import { emailConfigured, queueEmail, queueTeamEmail } from './email';
import { flushIntegrationEvents, queueIntegrationEvent } from './integrations';

type Lifecycle = {
  event: 'opened' | 'resolved' | 'acknowledged';
  id: string;
  teamId: string;
  monitor: string;
  service: string;
  url: string;
  detail: string;
  occurredAt: string;
};

export function notificationCapabilities(env: CrashLensEnv) {
  return {
    email: emailConfigured(env),
    slack: Boolean(env.SLACK_WEBHOOK_URL),
    discord: Boolean(env.DISCORD_WEBHOOK_URL),
    pagerduty: Boolean(env.PAGERDUTY_ROUTING_KEY),
    webhook: Boolean(env.ALERT_WEBHOOK_URL && env.ALERT_WEBHOOK_SECRET),
  };
}

export async function notifyLifecycle(env: CrashLensEnv, incident: Lifecycle) {
  const label =
    incident.event === 'opened'
      ? 'Incident opened'
      : incident.event === 'resolved'
        ? 'Incident resolved'
        : 'Incident acknowledged';
  const subject = `${label}: ${incident.monitor}`;
  const body = `Dear CrashLens team member,\n\nThis message is to notify you that an uptime incident has been ${incident.event}.\n\nMonitor: ${incident.monitor}\nService: ${incident.service}\nEndpoint: ${incident.url}\nDetails: ${incident.detail}\nTime: ${incident.occurredAt}\n\nPlease open CrashLens to review the complete incident history and captured evidence.\n\nYours sincerely,\nCrashLens Operations Team`;
  await queueTeamEmail(
    env,
    incident.teamId,
    `${incident.event}:${incident.id}`,
    subject,
    body,
    'incident',
  );
  await queueIntegrationEvent(env, {
    event: incident.event,
    id: incident.id,
    teamId: incident.teamId,
    title: incident.monitor,
    service: incident.service,
    severity: 'critical',
    detail: `${incident.detail}\nEndpoint: ${incident.url}`,
    environment: 'production',
    url: env.APP_ORIGIN,
  });
  await flushIntegrationEvents(env);
}

export async function queueDueEmailDigests(
  env: CrashLensEnv,
  now = new Date(),
) {
  const recipients = await env.DB.prepare(
    `SELECT u.id,u.email,u.name,tm.team_id,ep.digest_frequency
     FROM users u
     JOIN team_members tm ON tm.user_id=u.id
     JOIN email_preferences ep ON ep.user_id=u.id
     WHERE ep.digest_frequency IN ('daily','weekly')`,
  ).all<{
    id: string;
    email: string;
    name: string;
    team_id: string;
    digest_frequency: 'daily' | 'weekly';
  }>();
  const dayKey = now.toISOString().slice(0, 10);
  let queued = 0;
  for (const recipient of recipients.results) {
    if (recipient.digest_frequency === 'weekly' && now.getUTCDay() !== 1)
      continue;
    const days = recipient.digest_frequency === 'daily' ? 1 : 7;
    const since = new Date(now.getTime() - days * 86400000).toISOString();
    const summary = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) AS critical,
              SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) AS resolved
       FROM incidents WHERE team_id=? AND created_at>=?`,
    )
      .bind(recipient.team_id, since)
      .first<{ total: number; critical: number; resolved: number }>();
    const total = Number(summary?.total ?? 0);
    if (!total) continue;
    await queueEmail(
      env,
      recipient.team_id,
      recipient.email,
      `digest:${recipient.digest_frequency}:${recipient.id}:${dayKey}`,
      `${recipient.digest_frequency === 'daily' ? 'Daily' : 'Weekly'} CrashLens incident summary`,
      `Dear ${recipient.name},\n\nPlease find below your ${recipient.digest_frequency} CrashLens incident summary.\n\nIncidents recorded: ${total}\nCritical incidents: ${Number(summary?.critical ?? 0)}\nResolved incidents: ${Number(summary?.resolved ?? 0)}\nReporting period: Previous ${days} day${days === 1 ? '' : 's'}\n\n${env.APP_ORIGIN ?? ''}\n\nYou may change summary frequency and operational email preferences from your CrashLens account page. Essential security notifications remain enabled.\n\nYours sincerely,\nCrashLens Operations Team`,
    );
    queued++;
  }
  return queued;
}
