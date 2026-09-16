'use client';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
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
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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
  'w-full border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-foreground';
const button =
  'inline-flex items-center justify-center gap-2 border border-border bg-muted px-3 py-2 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40';
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
      className="border-t border-border bg-background p-5"
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Label className="text-sm">
          Monitor name
          <Input
            className={field}
            name="name"
            defaultValue={val('name')}
            required
          />
        </Label>
        <Label className="text-sm">
          Service ID
          <Input
            className={field}
            name="service"
            defaultValue={val('service')}
            placeholder="payment-service"
            required
          />
        </Label>
        <Label className="text-sm md:col-span-2">
          Public HTTPS endpoint
          <Input
            className={field}
            name="url"
            type="url"
            defaultValue={val('url', 'https://')}
            required
          />
        </Label>
        <Label className="text-sm">
          Project
          <NativeSelect
            className={field}
            name="projectId"
            defaultValue={val('project_id', String(projects[0]?.id ?? ''))}
          >
            {projects.map((p) => (
              <NativeSelectOption key={String(p.id)} value={String(p.id)}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
        <Label className="text-sm">
          Method
          <NativeSelect
            className={field}
            name="method"
            defaultValue={val('method', 'HEAD')}
          >
            {['HEAD', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((v) => (
              <NativeSelectOption key={v}>{v}</NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
        <Label className="text-sm">
          Interval
          <NativeSelect
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
              <NativeSelectOption key={v} value={v}>
                {l}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
        <Label className="text-sm">
          Timeout (ms)
          <Input
            className={field}
            name="timeout"
            type="number"
            min="1000"
            max="30000"
            defaultValue={val('timeout_ms', '10000')}
          />
        </Label>
        <Label className="text-sm">
          Minimum status
          <Input
            className={field}
            name="expectedMin"
            type="number"
            min="100"
            max="599"
            defaultValue={val('expected_min', '200')}
          />
        </Label>
        <Label className="text-sm">
          Maximum status
          <Input
            className={field}
            name="expectedMax"
            type="number"
            min="100"
            max="599"
            defaultValue={val('expected_max', '299')}
          />
        </Label>
        <Label className="text-sm">
          Body assertion
          <NativeSelect
            className={field}
            name="assertionType"
            defaultValue={val('assertion_type', 'none')}
          >
            {['none', 'contains', 'exact', 'regex'].map((v) => (
              <NativeSelectOption key={v}>{v}</NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
        <Label className="text-sm">
          Assertion value
          <Input
            className={field}
            name="assertionValue"
            defaultValue={val('assertion_value')}
          />
        </Label>
        <Label className="text-sm md:col-span-2">
          Request headers JSON
          <Textarea
            className={field}
            rows={2}
            name="headers"
            defaultValue={val('request_headers_json', '{}')}
          />
        </Label>
        <Label className="text-sm md:col-span-2">
          Request body
          <Textarea
            className={field}
            rows={2}
            name="requestBody"
            defaultValue={val('request_body')}
          />
        </Label>
        <Label className="text-sm md:col-span-2">
          Tags, comma separated
          <Input
            className={field}
            name="tags"
            defaultValue={
              monitor?.tags_json
                ? JSON.parse(String(monitor.tags_json)).join(', ')
                : ''
            }
            placeholder="api, production, checkout"
          />
        </Label>
      </div>
      {error && (
        <p className="mt-4 border border-destructive p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-3">
        <Button
          variant="default"
          type="submit"
          disabled={busy}
          className="bg-primary px-5 py-2.5 font-bold text-primary-foreground"
        >
          {busy ? 'Saving…' : monitor ? 'Save monitor' : 'Create monitor'}
        </Button>
        <Button
          variant="ghost"
          type="button"
          className={button}
          onClick={onDone}
        >
          Cancel
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
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
      <section className="border border-border bg-muted p-8">
        Loading monitor control…
      </section>
    );
  return (
    <section className="overflow-hidden border border-border bg-background text-foreground">
      <header className="border-b border-border bg-background p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Monitor overview</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Checks, evidence, outages, performance, and notifications in one
              operations view.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              type="button"
              className={button}
              onClick={() => {
                setEditing(null);
                setShowForm(!showForm);
              }}
            >
              <Plus size={15} />
              New monitor
            </Button>
            <Button
              variant="ghost"
              type="button"
              className={button}
              onClick={() => void load()}
            >
              <RefreshCw size={15} />
              Refresh
            </Button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-px border border-border bg-muted md:grid-cols-4">
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
        <p className="m-5 border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="grid border-b border-border xl:grid-cols-[240px_1fr]">
        <aside className="border-b border-border bg-muted p-4 xl:border-b-0 xl:border-r">
          <p className="text-xs font-bold tracking-widest text-muted-foreground">
            PROJECTS
          </p>
          <Button
            variant="ghost"
            type="button"
            className={`mt-3 w-full border p-3 text-left text-sm ${project === 'all' ? 'border-foreground bg-muted' : 'border-border'}`}
            onClick={() => setProject('all')}
          >
            All projects{' '}
            <span className="float-right">{data.monitors.length}</span>
          </Button>
          {data.projects.map((p) => (
            <Button
              variant="ghost"
              type="button"
              key={String(p.id)}
              className={`mt-2 w-full border p-3 text-left text-sm ${project === p.id ? 'border-foreground bg-muted' : 'border-border'}`}
              onClick={() => setProject(String(p.id))}
            >
              <FolderKanban className="mr-2 inline" size={14} />
              {p.name}
              <span className="float-right">
                {data.monitors.filter((m) => m.project_id === p.id).length}
              </span>
            </Button>
          ))}
          <form
            className="mt-4 flex"
            onSubmit={async (e) => {
              e.preventDefault();
              const formElement = e.currentTarget;
              const f = new FormData(formElement);
              await act({ action: 'create_project', name: f.get('name') });
              formElement.reset();
            }}
          >
            <Input
              name="name"
              className={field}
              placeholder="New project"
              required
            />
            <Button
              variant="ghost"
              type="submit"
              className="border border-l-0 border-border px-3"
              aria-label="Add project"
            >
              <Plus size={16} />
            </Button>
          </form>
          <div className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
            <p
              className={
                data.schedulerActive ? 'text-foreground' : 'text-warning'
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
          <Dialog open={showForm} onOpenChange={setShowForm}>
            <DialogContent className="sm:max-w-4xl p-0">
              <DialogHeader className="px-6 pt-6">
                <DialogTitle>
                  {editing ? 'Edit monitor' : 'Create monitor'}
                </DialogTitle>
                <DialogDescription>
                  Configure an endpoint check and the conditions that trigger an
                  incident.
                </DialogDescription>
              </DialogHeader>
              <Form
                projects={data.projects}
                monitor={editing ?? undefined}
                onDone={() => {
                  setShowForm(false);
                  setEditing(null);
                  void load();
                }}
              />
            </DialogContent>
          </Dialog>
          <div className="overflow-x-auto">
            <Table className="w-full min-w-[900px] text-left text-sm">
              <TableHeader className="border-b border-border bg-background text-xs text-muted-foreground">
                <TableRow>
                  {[
                    'MONITOR',
                    'METHOD',
                    'INTERVAL',
                    'EXPECTED',
                    'LAST CHECK',
                    'STATUS',
                    'ACTIONS',
                  ].map((h) => (
                    <TableHead key={h} className="p-3">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {monitors.map((m) => (
                  <TableRow
                    key={String(m.id)}
                    className="border-b border-border"
                  >
                    <TableCell className="p-3">
                      <strong>{m.name}</strong>
                      <p className="max-w-[340px] truncate text-xs text-muted-foreground">
                        {m.url}
                      </p>
                      <div className="mt-1 flex gap-1">
                        {JSON.parse(String(m.tags_json || '[]')).map(
                          (t: string) => (
                            <span
                              key={t}
                              className="bg-muted px-2 py-0.5 text-xs text-foreground"
                            >
                              {t}
                            </span>
                          ),
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="p-3 font-mono">{m.method}</TableCell>
                    <TableCell className="p-3">{m.interval_seconds}s</TableCell>
                    <TableCell className="p-3">
                      {m.expected_min}–{m.expected_max}
                    </TableCell>
                    <TableCell className="p-3">
                      {m.last_checked_at
                        ? ago(Number(m.last_checked_at), data.now)
                        : 'Never'}
                      <p className="text-xs text-muted-foreground">
                        {m.last_latency_ms ?? '—'} ms
                      </p>
                    </TableCell>
                    <TableCell className="p-3">
                      <Status
                        value={Number(m.enabled) ? String(m.status) : 'paused'}
                      />
                    </TableCell>
                    <TableCell className="p-3">
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          type="button"
                          title="Check now"
                          className={button}
                          disabled={!Number(m.enabled)}
                          onClick={() =>
                            void act({ action: 'check', id: m.id })
                          }
                        >
                          <RefreshCw size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          type="button"
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
                        </Button>
                        <Button
                          variant="ghost"
                          type="button"
                          title="Edit"
                          className={button}
                          onClick={() => {
                            setEditing(m);
                            setShowForm(true);
                          }}
                        >
                          <Settings2 size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          type="button"
                          title="Delete"
                          className={`${button} text-destructive`}
                          onClick={() => setDeleteId(String(m.id))}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                      {deleteId === m.id && (
                        <div className="mt-2 border border-destructive p-2 text-xs">
                          Delete monitor and its checks?{' '}
                          <Button
                            variant="ghost"
                            type="button"
                            className="ml-2 underline"
                            onClick={() =>
                              void act({ action: 'delete', id: m.id })
                            }
                          >
                            Confirm
                          </Button>
                          <Button
                            variant="ghost"
                            type="button"
                            className="ml-2 underline"
                            onClick={() => setDeleteId('')}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!monitors.length && (
              <p className="p-8 text-center text-muted-foreground">
                No monitors in this project.
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="grid gap-px border-b border-border bg-muted lg:grid-cols-2">
        <article className="bg-background p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs tracking-widest text-foreground">
                30-DAY AVAILABILITY
              </p>
              <h3 className="mt-2 text-xl font-bold">Service status</h3>
            </div>
            <span className="text-sm text-muted-foreground">
              {checks.length} checks
            </span>
          </div>
          <div className="mt-5 flex h-24 items-end gap-1">
            {days.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.state}`}
                className={`min-w-1 flex-1 ${d.state === 'up' ? 'bg-primary' : d.state === 'down' ? 'bg-destructive/10' : 'bg-muted'}`}
                style={{ height: d.state === 'none' ? '25%' : '100%' }}
              />
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
            <span>■ Operational</span>
            <span className="text-destructive">■ Disrupted</span>
            <span>■ No data</span>
          </div>
        </article>
        <article className="bg-background p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs tracking-widest text-foreground">
                PERFORMANCE
              </p>
              <h3 className="mt-2 text-xl font-bold">Response time</h3>
            </div>
            <div className="flex">
              {[1, 7, 30, 90].map((v) => (
                <Button
                  variant="ghost"
                  type="button"
                  key={v}
                  className={`border px-3 py-1 text-xs ${range === v ? 'border-foreground text-foreground' : 'border-border'}`}
                  onClick={() => setRange(v)}
                >
                  {v === 1 ? '24H' : `${v}D`}
                </Button>
              ))}
            </div>
          </div>
          <div className="mt-4 h-52">
            <ChartContainer
              className="h-full w-full aspect-auto"
              config={{
                latency: { label: 'Response time (ms)', color: '#262626' },
              }}
            >
              <LineChart data={chart}>
                <CartesianGrid stroke="#e5e5e5" vertical={false} />
                <XAxis dataKey="time" stroke="#737373" fontSize={11} />
                <YAxis stroke="#737373" fontSize={11} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  type="monotone"
                  dataKey="latency"
                  stroke="#262626"
                  dot={false}
                />
              </LineChart>
            </ChartContainer>
          </div>
        </article>
      </div>
      <div className="grid gap-px bg-muted lg:grid-cols-[1.4fr_1fr]">
        <article className="bg-background p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs tracking-widest text-foreground">
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
                <Button
                  variant="ghost"
                  type="button"
                  key={v}
                  className={`border px-3 py-1 text-xs ${filter === v ? 'border-foreground' : 'border-border'}`}
                  onClick={() => setFilter(v)}
                >
                  {l}
                </Button>
              ))}
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {incidents.map((i) => (
              <div key={String(i.id)} className="border border-border p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <Status value={String(i.status)} />
                    <h4 className="mt-2 font-bold">{i.title}</h4>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {i.trigger_text}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
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
                    <Button
                      variant="ghost"
                      type="button"
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
                    </Button>
                  )}
                  {i.status !== 'resolved' && (
                    <Button
                      variant="ghost"
                      type="button"
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
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {!incidents.length && (
              <p className="py-8 text-center text-muted-foreground">
                No incidents in this view.
              </p>
            )}
          </div>
        </article>
        <article className="bg-background p-6">
          <p className="text-xs tracking-widest text-foreground">
            NOTIFICATIONS
          </p>
          <h3 className="mt-2 text-xl font-bold">Destinations</h3>
          <p className="mt-2 text-sm text-muted-foreground">
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
                className="flex items-center border border-border p-3"
              >
                <Bell size={15} />
                <span className="ml-3">{label}</span>
                <span
                  className={`ml-auto text-xs ${data.channels[key] ? 'text-foreground' : 'text-warning'}`}
                >
                  {data.channels[key] ? 'ACTIVE' : 'NEEDS SECRET'}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Channel credentials stay in server environment variables. Webhooks
            are signed with HMAC-SHA256.
          </p>
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-xs tracking-widest text-foreground">
              CAPTURED EVIDENCE
            </p>
            {checks.slice(0, 5).map((c) => (
              <div
                key={String(c.id)}
                className="mt-3 border-l-2 border-border pl-3 text-xs"
              >
                <p>
                  {new Date(Number(c.checked_at)).toLocaleString()} ·{' '}
                  {c.region || 'origin'} · {c.http_status ?? 'NO RESPONSE'} ·{' '}
                  {c.latency_ms}ms
                </p>
                <p
                  className={
                    Number(c.ok) ? 'text-foreground' : 'text-destructive'
                  }
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
    <div className="bg-muted p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${danger ? 'text-destructive' : 'text-foreground'}`}
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
      className={`inline-flex items-center gap-1 border px-2 py-1 text-xs font-bold uppercase ${good ? 'border-border text-foreground' : bad ? 'border-destructive text-destructive' : 'border-warning text-warning'}`}
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
