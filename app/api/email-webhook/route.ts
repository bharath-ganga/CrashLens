import { getRuntimeEnv } from '@/db/runtime';
import { Resend } from 'resend';

export const dynamic = 'force-dynamic';

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

export async function POST(request: Request) {
  const env = getRuntimeEnv();
  if (!env.RESEND_API_KEY || !env.RESEND_WEBHOOK_SECRET)
    return json({ error: 'Webhook is not configured' }, 503);
  const payload = await request.text();
  if (payload.length > 128_000)
    return json({ error: 'Payload too large' }, 413);

  try {
    const event = new Resend(env.RESEND_API_KEY).webhooks.verify({
      payload,
      headers: {
        id: request.headers.get('svix-id') ?? '',
        timestamp: request.headers.get('svix-timestamp') ?? '',
        signature: request.headers.get('svix-signature') ?? '',
      },
      webhookSecret: env.RESEND_WEBHOOK_SECRET,
    });

    if (event.type === 'suppression.added') {
      await env.DB.prepare(
        `INSERT INTO email_suppressions (email,reason,provider_email_id)
         VALUES (?,?,?)
         ON CONFLICT(email) DO UPDATE SET reason=excluded.reason,provider_email_id=excluded.provider_email_id,created_at=CURRENT_TIMESTAMP`,
      )
        .bind(
          event.data.email.toLowerCase(),
          event.data.origin,
          event.data.source_id,
        )
        .run();
      return json({ received: true });
    }

    if (event.type === 'suppression.removed') {
      await env.DB.prepare('DELETE FROM email_suppressions WHERE email=?')
        .bind(event.data.email.toLowerCase())
        .run();
      return json({ received: true });
    }

    if (!event.type.startsWith('email.')) return json({ received: true });

    const data = event.data as {
      email_id: string;
      to?: string[];
    };
    const occurredAt = event.created_at || new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE email_provider_messages
         SET last_event=?,last_event_at=? WHERE provider_email_id=?`,
      ).bind(event.type.slice('email.'.length), occurredAt, data.email_id),
      env.DB.prepare(
        `INSERT OR IGNORE INTO email_delivery_events
         (id,provider_email_id,event_type,occurred_at) VALUES (?,?,?,?)`,
      ).bind(crypto.randomUUID(), data.email_id, event.type, occurredAt),
    ]);

    if (
      ['email.bounced', 'email.complained', 'email.suppressed'].includes(
        event.type,
      )
    ) {
      for (const recipient of data.to ?? [])
        await env.DB.prepare(
          `INSERT INTO email_suppressions (email,reason,provider_email_id)
           VALUES (?,?,?)
           ON CONFLICT(email) DO UPDATE SET reason=excluded.reason,provider_email_id=excluded.provider_email_id,created_at=CURRENT_TIMESTAMP`,
        )
          .bind(
            recipient.toLowerCase(),
            event.type.slice('email.'.length),
            data.email_id,
          )
          .run();
    }

    return json({ received: true });
  } catch {
    return json({ error: 'Invalid webhook signature' }, 400);
  }
}
