'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  FolderKanban,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
type Row = Record<string, string | number | null>;
type Data = {
  now: number;
  projects: Row[];
  monitors: Row[];
  checks: Row[];
  incidents: Row[];
  emails: Row[];
  schedulerActive: boolean;
  lastSchedulerRun: number | null;
  channels: Record<string, boolean>;
  regions: string[];
  error?: string;
};
const field =
  'w-full border border-[#484848] bg-[#0a0a0a] px-3 py-2.5 text-sm text-[#f7f7f7] outline-none focus:border-[#f5f5f5]';
const button =
  'inline-flex items-center justify-center gap-2 border border-[#545454] bg-[#1d1d1d] px-3 py-2 text-sm font-semibold hover:bg-[#282828] disabled:cursor-not-allowed disabled:opacity-40';
const empty: Data = {
  now: 0,
  projects: [],
  monitors: [],
  checks: [],
  incidents: [],
  emails: [],
  schedulerActive: false,
  lastSchedulerRun: null,
  channels: {},
  regions: [],
};
function ago(value: number | null, now: number) {
  if (!value) return 'never';
  const sec = Math.max(0, Math.floor((now - value) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}
function duration(start: string, end: string | null | undefined, now: number) {
  const ms = Math.max(
    0,
    (end ? new Date(end).getTime() : now) - new Date(start).getTime(),
  );
  const min = Math.floor(ms / 60000);
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
}
function Form({
  projects,
  monitor,
  onDone,
}: {
  projects: Row[];
  monitor?: Row;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    const payload = Object.fromEntries(f);
    const r = await fetch('/api/monitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        action: monitor ? 'update' : 'create',
        id: monitor?.id,
      }),
    });
    const d = (await r.json()) as { error?: string };
    setBusy(false);
    if (!r.ok) {
      setError(d.error || 'Could not save monitor');
      return;
    }
    onDone();
  }
  const val = (key: string, fallback = '') =>
    String(monitor?.[key] ?? fallback);
  return (
    <form
      onSubmit={submit}
      className="border-t border-[#333333] bg-[#141414] p-5"
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm">
          Monitor name
          <input
            className={field}
            name="name"
            defaultValue={val('name')}
            required
          />
        </label>
        <label className="text-sm">
          Service ID
          <input
            className={field}
            name="service"
            defaultValue={val('service')}
            placeholder="payment-service"
            required
          />
        </label>
        <label className="text-sm md:col-span-2">
          Public HTTPS endpoint
          <input
            className={field}
            name="url"
            type="url"
            defaultValue={val('url', 'https://')}
            required
          />
        </label>
        <label className="text-sm">
          Project
          <select
            className={field}
            name="projectId"
            defaultValue={val('project_id', String(projects[0]?.id ?? ''))}
          >
            {projects.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Method
          <select
            className={field}
            name="method"
            defaultValue={val('method', 'HEAD')}
          >
            {['HEAD', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Interval
          <select
            className={field}
            name="interval"
            defaultValue={val('interval_seconds', '300')}
          >
            {[
              [60, '1 minute'],
              [300, '5 minutes'],
              [600, '10 minutes'],
              [900, '15 minutes'],
              [1800, '30 minutes'],
              [3600, '1 hour'],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Timeout (ms)
          <input
            className={field}
            name="timeout"
            type="number"
            min="1000"
            max="30000"
            defaultValue={val('timeout_ms', '10000')}
          />
        </label>
        <label className="text-sm">
          Minimum status
          <input
            className={field}
            name="expectedMin"
            type="number"
            min="100"
            max="599"
            defaultValue={val('expected_min', '200')}
          />
        </label>
        <label className="text-sm">
          Maximum status
          <input
            className={field}
            name="expectedMax"
            type="number"
            min="100"
            max="599"
            defaultValue={val('expected_max', '299')}
          />
        </label>
        <label className="text-sm">
          Body assertion
          <select
            className={field}
            name="assertionType"
            defaultValue={val('assertion_type', 'none')}
          >
            {['none', 'contains', 'exact', 'regex'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Assertion value
          <input
            className={field}
            name="assertionValue"
            defaultValue={val('assertion_value')}
          />
        </label>
        <label className="text-sm md:col-span-2">
          Request headers JSON
          <textarea
            className={field}
            rows={2}
            name="headers"
            defaultValue={val('request_headers_json', '{}')}
          />
        </label>
        <label className="text-sm md:col-span-2">
          Request body
          <textarea
            className={field}
            rows={2}
            name="requestBody"
            defaultValue={val('request_body')}
          />
        </label>
        <label className="text-sm md:col-span-2">
          Tags, comma separated
          <input
            className={field}
            name="tags"
            defaultValue={
              monitor?.tags_json
                ? JSON.parse(String(monitor.tags_json)).join(', ')
                : ''
            }
            placeholder="api, production, checkout"
          />
        </label>
      </div>
      {error && (
        <p className="mt-4 border border-[#ff5757] p-3 text-sm text-[#ff8585]">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-3">
        <button
          disabled={busy}
          className="bg-[#f5f5f5] px-5 py-2.5 font-bold text-[#080808]"
        >
          {busy ? 'Saving…' : monitor ? 'Save monitor' : 'Create monitor'}
        </button>
        <button type="button" className={button} onClick={onDone}>
          Cancel
        </button>
      </div>
      <p className="mt-3 text-xs text-[#a8a8a8]">
        Secret headers such as Authorization and Cookie are blocked. Redirects
        and private-network destinations are never followed.
      </p>
    </form>
  );
}
export default function UptimePanel() {
  const [data, setData] = useState<Data>(empty),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [project, setProject] = useState('all'),
    [showForm, setShowForm] = useState(false),
    [editing, setEditing] = useState<Row | null>(null),
    [range, setRange] = useState(7),
    [filter, setFilter] = useState('all'),
    [deleteId, setDeleteId] = useState('');
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/monitors', { cache: 'no-store' }),
        d = (await r.json()) as Data;
      if (!r.ok) throw Error(d.error || 'Monitoring unavailable');
      setData(d);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Monitoring unavailable');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    queueMicrotask(() => void load());
    const id = setInterval(() => void load(), 15000);
    return () => clearInterval(id);
  }, [load]);
  async function act(payload: Record<string, unknown>) {
    setError('');
    const r = await fetch('/api/monitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      d = (await r.json()) as { error?: string };
    if (!r.ok) {
      setError(d.error || 'Action failed');
      return;
    }
    setDeleteId('');
    await load();
  }
  const monitors = data.monitors.filter(
      (m) => project === 'all' || m.project_id === project,
    ),
    checks = data.checks.filter((c) =>
      monitors.some((m) => m.id === c.monitor_id),
    );
  const cutoff = data.now - range * 86400000;
  const chart = [...checks]
    .filter((c) => Number(c.checked_at) > cutoff)
    .reverse()
    .map((c) => ({
      time: new Date(Number(c.checked_at)).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      latency: Number(c.latency_ms),
      ok: Number(c.ok),
    }));
  const days = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(data.now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (29 - i));
    const next = date.getTime() + 86400000,
      rows = checks.filter(
        (c) =>
          Number(c.checked_at) >= date.getTime() && Number(c.checked_at) < next,
      );
    return {
      date: date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      state: !rows.length
        ? 'none'
        : rows.some((c) => !Number(c.ok))
          ? 'down'
          : 'up',
    };
  });
  const incidents = data.incidents.filter(
    (i) =>
      filter === 'all' ||
      (filter === 'live'
        ? i.status === 'investigating'
        : filter === 'ack'
          ? i.status === 'monitoring'
          : i.status === 'resolved'),
  );
  if (loading)
    return (
      <section className="border border-[#333333] bg-[#101010] p-8">
        Loading monitor control…
      </section>
    );
  return (
    <section className="overflow-hidden border border-[#333333] bg-[#0d0d0d] text-[#f3f3f3]">
      <header className="border-b border-[#333333] bg-[#181818] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs tracking-[.2em] text-[#f5f5f5]">
              UPTIME CONTROL
            </p>
            <h2 className="mt-2 text-2xl font-bold">Endpoint monitoring</h2>
            <p className="mt-1 text-sm text-[#adadad]">
              Checks, evidence, outages, performance, and notifications in one
              operations view.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className={button}
              onClick={() => {
                setEditing(null);
                setShowForm(!showForm);
              }}
            >
              <Plus size={15} />
              New monitor
            </button>
            <button className={button} onClick={() => void load()}>
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-px border border-[#333333] bg-[#333333] md:grid-cols-4">
          <Metric label="MONITORS" value={String(monitors.length)} />
          <Metric
            label="ACTIVE"
            value={String(monitors.filter((m) => Number(m.enabled)).length)}
          />
          <Metric
            label="LIVE INCIDENTS"
            value={String(
              data.incidents.filter((i) => i.status === 'investigating').length,
            )}
            danger
          />
          <Metric
            label="SCHEDULER"
            value={data.schedulerActive ? 'ONLINE' : 'OFFLINE'}
            danger={!data.schedulerActive}
          />
        </div>
      </header>
      {error && (
        <p className="m-5 border border-[#ff5757] bg-[#230d0d] p-3 text-sm text-[#ff8585]">
          {error}
        </p>
      )}
      <div className="grid border-b border-[#333333] xl:grid-cols-[240px_1fr]">
        <aside className="border-b border-[#333333] bg-[#101010] p-4 xl:border-b-0 xl:border-r">
          <p className="text-xs font-bold tracking-widest text-[#adadad]">
            PROJECTS
          </p>
          <button
            className={`mt-3 w-full border p-3 text-left text-sm ${project === 'all' ? 'border-[#f5f5f5] bg-[#202020]' : 'border-[#333333]'}`}
            onClick={() => setProject('all')}
          >
            All projects{' '}
            <span className="float-right">{data.monitors.length}</span>
          </button>
          {data.projects.map((p) => (
            <button
              key={String(p.id)}
              className={`mt-2 w-full border p-3 text-left text-sm ${project === p.id ? 'border-[#f5f5f5] bg-[#202020]' : 'border-[#333333]'}`}
              onClick={() => setProject(String(p.id))}
            >
              <FolderKanban className="mr-2 inline" size={14} />
              {p.name}
              <span className="float-right">
                {data.monitors.filter((m) => m.project_id === p.id).length}
              </span>
            </button>
          ))}
          <form
            className="mt-4 flex"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await act({ action: 'create_project', name: f.get('name') });
              e.currentTarget.reset();
            }}
          >
            <input
              name="name"
              className={field}
              placeholder="New project"
              required
            />
            <button
              className="border border-l-0 border-[#484848] px-3"
              aria-label="Add project"
            >
              <Plus size={16} />
            </button>
          </form>
          <div className="mt-6 border-t border-[#333333] pt-4 text-xs text-[#adadad]">
            <p
              className={
                data.schedulerActive ? 'text-[#f5f5f5]' : 'text-[#ffc247]'
              }
            >
              {data.schedulerActive
                ? 'MONITOR NETWORK ONLINE'
                : 'SCHEDULER NOT CONNECTED'}
            </p>
            <p className="mt-2">
              Last heartbeat: {ago(data.lastSchedulerRun, data.now)}
            </p>
            <p className="mt-2">
              Region: origin. Deploy regional agents for geographic consensus.
            </p>
          </div>
        </aside>
        <div>
          {showForm && (
            <Form
              projects={data.projects}
              monitor={editing ?? undefined}
              onDone={() => {
                setShowForm(false);
                setEditing(null);
                void load();
              }}
            />
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-[#333333] bg-[#141414] text-xs text-[#adadad]">
                <tr>
                  {[
                    'MONITOR',
                    'METHOD',
                    'INTERVAL',
                    'EXPECTED',
                    'LAST CHECK',
                    'STATUS',
                    'ACTIONS',
                  ].map((h) => (
                    <th key={h} className="p-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monitors.map((m) => (
                  <tr key={String(m.id)} className="border-b border-[#252525]">
                    <td className="p-3">
                      <strong>{m.name}</strong>
                      <p className="max-w-[340px] truncate text-xs text-[#adadad]">
                        {m.url}
                      </p>
                      <div className="mt-1 flex gap-1">
                        {JSON.parse(String(m.tags_json || '[]')).map(
                          (t: string) => (
                            <span
                              key={t}
                              className="bg-[#222222] px-2 py-0.5 text-xs text-[#d4d4d4]"
                            >
                              {t}
                            </span>
                          ),
                        )}
                      </div>
                    </td>
                    <td className="p-3 font-mono">{m.method}</td>
                    <td className="p-3">{m.interval_seconds}s</td>
                    <td className="p-3">
                      {m.expected_min}–{m.expected_max}
                    </td>
                    <td className="p-3">
                      {m.last_checked_at
                        ? ago(Number(m.last_checked_at), data.now)
                        : 'Never'}
                      <p className="text-xs text-[#adadad]">
                        {m.last_latency_ms ?? '—'} ms
                      </p>
                    </td>
                    <td className="p-3">
                      <Status
                        value={Number(m.enabled) ? String(m.status) : 'paused'}
                      />
                    </td>
                    <td className="p-3">
                      <div className="flex gap-2">
                        <button
                          title="Check now"
                          className={button}
                          disabled={!Number(m.enabled)}
                          onClick={() =>
                            void act({ action: 'check', id: m.id })
                          }
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          title={Number(m.enabled) ? 'Pause' : 'Resume'}
                          className={button}
                          onClick={() =>
                            void act({
                              action: Number(m.enabled) ? 'pause' : 'resume',
                              id: m.id,
                            })
                          }
                        >
                          {Number(m.enabled) ? (
                            <Pause size={14} />
                          ) : (
                            <Play size={14} />
                          )}
                        </button>
                        <button
                          title="Edit"
                          className={button}
                          onClick={() => {
                            setEditing(m);
                            setShowForm(true);
                          }}
                        >
                          <Settings2 size={14} />
                        </button>
                        <button
                          title="Delete"
                          className={`${button} text-[#ff8585]`}
                          onClick={() => setDeleteId(String(m.id))}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      {deleteId === m.id && (
                        <div className="mt-2 border border-[#ff5757] p-2 text-xs">
                          Delete monitor and its checks?{' '}
                          <button
                            className="ml-2 underline"
                            onClick={() =>
                              void act({ action: 'delete', id: m.id })
                            }
                          >
                            Confirm
                          </button>
                          <button
                            className="ml-2 underline"
                            onClick={() => setDeleteId('')}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!monitors.length && (
              <p className="p-8 text-center text-[#adadad]">
                No monitors in this project.
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="grid gap-px border-b border-[#333333] bg-[#333333] lg:grid-cols-2">
        <article className="bg-[#101010] p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs tracking-widest text-[#f5f5f5]">
                30-DAY AVAILABILITY
              </p>
              <h3 className="mt-2 text-xl font-bold">Service status</h3>
            </div>
            <span className="text-sm text-[#adadad]">
              {checks.length} checks
            </span>
          </div>
          <div className="mt-5 flex h-24 items-end gap-1">
            {days.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.state}`}
                className={`min-w-1 flex-1 ${d.state === 'up' ? 'bg-[#f5f5f5]' : d.state === 'down' ? 'bg-[#ff5757]' : 'bg-[#303030]'}`}
                style={{ height: d.state === 'none' ? '25%' : '100%' }}
              />
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-[#adadad]">
            <span>■ Operational</span>
            <span className="text-[#ff8585]">■ Disrupted</span>
            <span>■ No data</span>
          </div>
        </article>
        <article className="bg-[#101010] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs tracking-widest text-[#f5f5f5]">
                PERFORMANCE
              </p>
              <h3 className="mt-2 text-xl font-bold">Response time</h3>
            </div>
            <div className="flex">
              {[1, 7, 30, 90].map((v) => (
                <button
                  key={v}
                  className={`border px-3 py-1 text-xs ${range === v ? 'border-[#f5f5f5] text-[#f5f5f5]' : 'border-[#484848]'}`}
                  onClick={() => setRange(v)}
                >
                  {v === 1 ? '24H' : `${v}D`}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart}>
                <CartesianGrid stroke="#252525" />
                <XAxis dataKey="time" stroke="#999999" fontSize={11} />
                <YAxis stroke="#999999" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: '#0d0d0d',
                    border: '1px solid #484848',
                    borderRadius: 0,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="latency"
                  stroke="#f5f5f5"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>
      </div>
      <div className="grid gap-px bg-[#333333] lg:grid-cols-[1.4fr_1fr]">
        <article className="bg-[#101010] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs tracking-widest text-[#f5f5f5]">
                INCIDENT HISTORY
              </p>
              <h3 className="mt-2 text-xl font-bold">Outage timeline</h3>
            </div>
            <div className="flex">
              {[
                ['all', 'ALL'],
                ['live', 'LIVE'],
                ['ack', 'ACKNOWLEDGED'],
                ['resolved', 'RESOLVED'],
              ].map(([v, l]) => (
                <button
                  key={v}
                  className={`border px-3 py-1 text-xs ${filter === v ? 'border-[#f5f5f5]' : 'border-[#484848]'}`}
                  onClick={() => setFilter(v)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {incidents.map((i) => (
              <div key={String(i.id)} className="border border-[#333333] p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <Status value={String(i.status)} />
                    <h4 className="mt-2 font-bold">{i.title}</h4>
                    <p className="mt-1 text-sm text-[#adadad]">
                      {i.trigger_text}
                    </p>
                  </div>
                  <div className="text-right text-xs text-[#adadad]">
                    <p>{new Date(String(i.started_at)).toLocaleString()}</p>
                    <p>
                      {duration(
                        String(i.started_at),
                        i.status === 'resolved' ? String(i.updated_at) : null,
                        data.now,
                      )}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  {i.status === 'investigating' && (
                    <button
                      className={button}
                      onClick={() =>
                        void act({
                          action: 'incident',
                          incidentId: i.id,
                          status: 'monitoring',
                        })
                      }
                    >
                      Acknowledge
                    </button>
                  )}
                  {i.status !== 'resolved' && (
                    <button
                      className={button}
                      onClick={() =>
                        void act({
                          action: 'incident',
                          incidentId: i.id,
                          status: 'resolved',
                        })
                      }
                    >
                      Resolve
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!incidents.length && (
              <p className="py-8 text-center text-[#adadad]">
                No incidents in this view.
              </p>
            )}
          </div>
        </article>
        <article className="bg-[#101010] p-5">
          <p className="text-xs tracking-widest text-[#f5f5f5]">
            NOTIFICATIONS
          </p>
          <h3 className="mt-2 text-xl font-bold">Destinations</h3>
          <p className="mt-2 text-sm text-[#adadad]">
            Opened, acknowledged, and resolved lifecycle events.
          </p>
          <div className="mt-4 space-y-2">
            {[
              ['email', 'Email'],
              ['slack', 'Slack'],
              ['pagerduty', 'PagerDuty'],
              ['webhook', 'Signed webhook'],
            ].map(([key, label]) => (
              <div
                key={key}
                className="flex items-center border border-[#333333] p-3"
              >
                <Bell size={15} />
                <span className="ml-3">{label}</span>
                <span
                  className={`ml-auto text-xs ${data.channels[key] ? 'text-[#f5f5f5]' : 'text-[#ffc247]'}`}
                >
                  {data.channels[key] ? 'ACTIVE' : 'NEEDS SECRET'}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-[#adadad]">
            Channel credentials stay in server environment variables. Webhooks
            are signed with HMAC-SHA256.
          </p>
          <div className="mt-6 border-t border-[#333333] pt-4">
            <p className="text-xs tracking-widest text-[#f5f5f5]">
              CAPTURED EVIDENCE
            </p>
            {checks.slice(0, 5).map((c) => (
              <div
                key={String(c.id)}
                className="mt-3 border-l-2 border-[#484848] pl-3 text-xs"
              >
                <p>
                  {new Date(Number(c.checked_at)).toLocaleString()} ·{' '}
                  {c.region || 'origin'} · {c.http_status ?? 'NO RESPONSE'} ·{' '}
                  {c.latency_ms}ms
                </p>
                <p
                  className={Number(c.ok) ? 'text-[#f5f5f5]' : 'text-[#ff8585]'}
                >
                  {Number(c.ok) ? 'Healthy' : c.error}
                </p>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
function Metric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="bg-[#101010] p-4">
      <p className="text-xs text-[#adadad]">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${danger ? 'text-[#ff8585]' : 'text-[#f3f3f3]'}`}
      >
        {value}
      </p>
    </div>
  );
}
function Status({ value }: { value: string }) {
  const good = ['up', 'resolved'].includes(value),
    bad = ['down', 'investigating'].includes(value);
  return (
    <span
      className={`inline-flex items-center gap-1 border px-2 py-1 text-xs font-bold uppercase ${good ? 'border-[#737373] text-[#f5f5f5]' : bad ? 'border-[#943c3c] text-[#ff8585]' : 'border-[#735d2c] text-[#ffc247]'}`}
    >
      {good ? (
        <CheckCircle2 size={12} />
      ) : bad ? (
        <AlertTriangle size={12} />
      ) : value === 'paused' ? (
        <Pause size={12} />
      ) : (
        <Clock3 size={12} />
      )}{' '}
      {value}
    </span>
  );
}
