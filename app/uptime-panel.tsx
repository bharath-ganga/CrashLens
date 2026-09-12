'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
type Row = Record<string, string | number | null>;
type Data = {
  monitors: Row[];
  checks: Row[];
  emails: Row[];
  emailConfigured: boolean;
  schedulerActive: boolean;
};
const input = 'mt-2 w-full border border-[#46564c] bg-[#030504] p-3 text-base';
const button =
  'border border-[#46564c] px-4 py-2 text-sm hover:border-[#d6ff00] disabled:opacity-50';
export default function UptimePanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/monitors', { cache: 'no-store' });
      const d = await r.json() as Data & {error?:string};
      if (!r.ok) throw new Error(d.error);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load monitors');
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void load(),0);
    const timer = setInterval(() => void load(), 15000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [load]);
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/monitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json() as {error?:string;skipped?:boolean};
      if (!r.ok) throw new Error(d.error);
      await load();
      setNotice(
        d.skipped
          ? 'Check is paused, running, or not yet due.'
          : 'Monitor updated.',
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-5 text-base">
      <h2 className="text-2xl font-bold">Website & API uptime</h2>
      {error && (
        <p role="alert" className="border border-[#ff4d4d] p-4 text-[#ff8585]">
          {error}{' '}
          <Link className="underline" href="/account">
            Sign in
          </Link>
        </p>
      )}
      {notice && <output className="block">{notice}</output>}
      {data && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <p className="border border-[#344139] p-4">
              Scheduler: {data.schedulerActive ? 'Running' : 'Not connected'}
            </p>
            <p className="border border-[#344139] p-4">
              Email sender:{' '}
              {data.emailConfigured ? 'Configured' : 'Setup required'}
            </p>
          </div>
          {!data.schedulerActive && (
            <p className="border-l-4 border-[#e5a50a] p-4 text-sm">
              Background checks need the monitoring runner on an always-on
              server. This page only refreshes results. Check now runs a due
              check.
            </p>
          )}
          {!data.emailConfigured && (
            <p className="border-l-4 border-[#e5a50a] p-4 text-sm">
              Emails are queued until a verified sender is connected.
            </p>
          )}
          <form
            className="border border-[#344139] bg-[#090d0a] p-5"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const v = new FormData(form);
              if (
                await act({
                  action: 'create',
                  name: v.get('name'),
                  url: v.get('url'),
                  service: v.get('service'),
                  interval: Number(v.get('interval')),
                })
              )
                form.reset();
            }}
          >
            <h3 className="text-lg font-bold">Add a monitor</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label>
                Name
                <input
                  required
                  name="name"
                  maxLength={100}
                  placeholder="Checkout health"
                  className={input}
                />
              </label>
              <label>
                HTTPS endpoint
                <input
                  required
                  name="url"
                  type="url"
                  placeholder="https://api.yourdomain.com/health"
                  className={input}
                />
              </label>
              <label>
                Service identifier
                <input
                  required
                  name="service"
                  maxLength={100}
                  placeholder="payment-service"
                  className={input}
                />
              </label>
              <label>
                Check interval
                <select name="interval" defaultValue="300" className={input}>
                  <option value="60">1 minute</option>
                  <option value="300">5 minutes</option>
                  <option value="900">15 minutes</option>
                </select>
              </label>
            </div>
            <p className="mt-4 text-sm text-[#91a097]">
              HEAD checks expect HTTP 2xx. Three consecutive failures open an
              incident and queue email; recovery sends another email. Use your
              log service name.
            </p>
            <button
              disabled={busy}
              className="mt-4 bg-[#d6ff00] px-5 py-3 font-bold text-black disabled:opacity-50"
            >
              Create monitor
            </button>
          </form>
          {!data.monitors.length && <p className="p-6">No monitors yet.</p>}
          {data.monitors.map((m) => (
            <article
              key={String(m.id)}
              className="border border-[#344139] bg-[#090d0a] p-5"
            >
              <h3 className="text-xl font-bold">
                {m.name} —{' '}
                {m.enabled ? String(m.status).toUpperCase() : 'PAUSED'}
              </h3>
              <p className="mt-2 break-all text-sm text-[#91a097]">
                {m.url} · {m.service}
              </p>
              <p className="mt-3 text-sm">
                30-day successful checks: {m.uptime_percent ?? '—'}% · Response:{' '}
                {m.last_latency_ms ?? '—'} ms
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  className={button}
                  disabled={busy || !m.enabled}
                  onClick={() => void act({ action: 'check', id: m.id })}
                >
                  Check now
                </button>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void act({
                      action: m.enabled ? 'pause' : 'resume',
                      id: m.id,
                    })
                  }
                >
                  {m.enabled ? 'Pause' : 'Resume'}
                </button>
              </div>
              {m.outage_id && (
                <p className="mt-3 text-[#ff8585]">
                  Open outage — investigate in History.
                </p>
              )}
              <ol className="mt-4 space-y-2">
                {data.checks
                  .filter((c) => c.monitor_id === m.id)
                  .slice(0, 5)
                  .map((c) => (
                    <li
                      key={String(c.id)}
                      className="border-t border-[#26312b] pt-2 text-sm"
                    >
                      {new Date(Number(c.checked_at)).toLocaleString()} ·{' '}
                      {c.ok ? 'UP' : 'FAILED'} ·{' '}
                      {c.http_status ?? 'No response'} · {c.latency_ms} ms{' '}
                      {c.error}
                    </li>
                  ))}
              </ol>
            </article>
          ))}
          <article className="border border-[#344139] p-5">
            <h3 className="text-xl font-bold">Email activity</h3>
            <p className="mt-2 text-sm text-[#91a097]">
              Accepted means the provider accepted the email, not confirmed
              inbox delivery. Delivery stops after five failed attempts.
            </p>
            {!data.emails.length && (
              <p className="mt-4">No emails queued yet.</p>
            )}
            {data.emails.map((m) => (
              <div
                key={String(m.id)}
                className="mt-4 border-t border-[#26312b] pt-3 text-sm"
              >
                <p>
                  {m.subject} — {m.status}
                </p>
                <p>
                  {m.recipient} · {m.attempts} attempts {m.last_error}
                </p>
              </div>
            ))}
          </article>
        </>
      )}
    </section>
  );
}
