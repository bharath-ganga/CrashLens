'use client';

import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  Bell,
  Boxes,
  Braces,
  CheckCircle2,
  ChevronRight,
  CircleCheck,
  Clipboard,
  Database,
  Download,
  FileCode2,
  FileText,
  Filter,
  GitCommitHorizontal,
  LayoutDashboard,
  ListTree,
  HeartPulse,
  History,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Plug,
  Radio,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import UptimePanel from './uptime-panel';
import AdminClientsPanel from './admin-clients-panel';
import Link from 'next/link';
import {
  analyzeLogs,
  buildReport,
  Incident,
  LogEntry,
  parseLogContent,
  SAMPLE_JSONL,
} from '@/lib/log-analyzer';

const initialLogs = parseLogContent(SAMPLE_JSONL, 'crashlens-sample.jsonl');
const initialIncidents = analyzeLogs(initialLogs);

type WorkspaceRow = Record<string, string | number | null>;
type Workspace = {
  user: { id: string; email: string; name: string };
  team: { id: string; name: string };
  incidents: WorkspaceRow[];
  comments: WorkspaceRow[];
  connectors: WorkspaceRow[];
  invites: WorkspaceRow[];
  members: WorkspaceRow[];
  auditEvents: WorkspaceRow[];
  ingestionCount: number;
  capabilities: Record<string, boolean>;
};
type WorkspaceView =
  | 'overview'
  | 'incidents'
  | 'logs'
  | 'services'
  | 'deployments'
  | 'history'
  | 'team'
  | 'integrations'
  | 'monitoring'
  | 'settings'
  | 'clients';

type IncidentFilter = 'all' | 'open' | 'critical' | 'resolved';

function time(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

function dateTime(timestamp: string) {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

function rootCauseFor(incident: Incident) {
  const trigger = incident.trigger.toLowerCase();
  if (trigger.includes('database connection timeout'))
    return `Database connection timeout in ${incident.service}`;
  if (trigger.includes('outofmemory') || trigger.includes('memory'))
    return `Memory exhaustion in ${incident.service}`;
  if (trigger.includes('redis failover'))
    return `Redis failover affecting ${incident.service}`;
  if (trigger.includes('deploy') || trigger.includes('version'))
    return `Recent deployment affecting ${incident.service}`;
  if (incident.trigger === 'No correlated change found')
    return `Recurring ${incident.title.toLowerCase()} in ${incident.service}`;
  return `${incident.trigger.replace(/[_ ](?:order|user|job)_id=.*/i, '').replace(/[.:]+$/, '')} in ${incident.service}`;
}

function downloadText(content: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: 'text/plain;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const [incidents, setIncidents] = useState<Incident[]>(initialIncidents);
  const [selectedId, setSelectedId] = useState(initialIncidents[0]?.id ?? '');
  const [filename, setFilename] = useState('crashlens-sample.jsonl');
  const [fileSize, setFileSize] = useState('4.2 KB');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'analysis' | 'timeline' | 'logs'>('analysis');
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [error, setError] = useState('');
  const [resolved, setResolved] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<WorkspaceView>('incidents');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [, setWorkspaceMessage] = useState('Connecting secure workspace…');
  const [health, setHealth] = useState<{
    status: string;
    latencyMs?: number;
  } | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [comment, setComment] = useState('');
  const [historyIncidentId, setHistoryIncidentId] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [incidentFilter, setIncidentFilter] = useState<IncidentFilter>('all');
  const [environment, setEnvironment] = useState('Production');
  const [dateRange, setDateRange] = useState('Last 24h');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const selected =
    incidents.find((incident) => incident.id === selectedId) ?? incidents[0];
  const filteredIncidents = useMemo(() => {
    return incidents.filter((incident) => {
      const matchesQuery =
        `${incident.title} ${incident.service} ${incident.trigger}`
          .toLowerCase()
          .includes(query.toLowerCase());
      const isResolved = resolved.includes(incident.id);
      const matchesStatus =
        incidentFilter === 'all' ||
        (incidentFilter === 'open' && !isResolved) ||
        (incidentFilter === 'resolved' && isResolved) ||
        (incidentFilter === 'critical' && incident.severity === 'critical');
      return matchesQuery && matchesStatus;
    });
  }, [incidentFilter, incidents, query, resolved]);
  const serviceCount = new Set(logs.map((log) => log.service)).size;
  const errorCount = logs.filter(
    (log) => log.level === 'error' || log.level === 'fatal',
  ).length;
  const signalBars = useMemo(() => {
    const buckets = new Map<string, number>();
    logs.forEach((log) => {
      const key = log.timestamp.slice(11, 16);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    });
    const values = [...buckets.entries()].slice(-18);
    return values.map(([label, count]) => ({
      label,
      count,
      critical: logs.filter(
        (log) =>
          log.timestamp.slice(11, 16) === label &&
          (log.level === 'fatal' || log.level === 'error'),
      ).length,
    }));
  }, [logs]);
  const metrics: Array<{
    label: string;
    value: string | number;
    note: string;
    icon: LucideIcon;
  }> = [
    {
      label: 'Open incidents',
      value: incidents.length - resolved.length,
      note: `${resolved.length} resolved`,
      icon: AlertTriangle,
    },
    {
      label: 'Critical',
      value: incidents.filter(
        (item) => item.severity === 'critical' && !resolved.includes(item.id),
      ).length,
      note: 'need investigation',
      icon: Activity,
    },
    {
      label: 'Error events',
      value: errorCount,
      note: `${logs.length} total events`,
      icon: FileCode2,
    },
    {
      label: 'Services',
      value: serviceCount,
      note: 'detected automatically',
      icon: Server,
    },
  ];
  const sampleFiles: Array<{
    label: string;
    extension: string;
    icon: LucideIcon;
  }> = [
    { label: 'JSONL', extension: 'jsonl', icon: Braces },
    { label: 'CSV', extension: 'csv', icon: ListTree },
    { label: 'TXT', extension: 'txt', icon: FileText },
  ];

  const loadWorkspace = useCallback(async (quiet = false) => {
    if (!quiet) setWorkspaceBusy(true);
    try {
      const [workspaceResponse, healthResponse] = await Promise.all([
        fetch('/api/workspace', { cache: 'no-store' }),
        fetch('/api/health', { cache: 'no-store' }),
      ]);
      if (!workspaceResponse.ok)
        throw new Error(
          workspaceResponse.status === 401
            ? 'Sign in to enable persistent team storage.'
            : 'Workspace is temporarily unavailable.',
        );
      const data = (await workspaceResponse.json()) as Workspace;
      setWorkspace(data);
      setHistoryIncidentId(
        (current) => current || String(data.incidents[0]?.id ?? ''),
      );
      if (healthResponse.ok)
        setHealth(
          (await healthResponse.json()) as {
            status: string;
            latencyMs?: number;
          },
        );
      setWorkspaceMessage('Persistent workspace connected');
    } catch (reason) {
      setWorkspaceMessage(
        reason instanceof Error ? reason.message : 'Workspace unavailable',
      );
    } finally {
      if (!quiet) setWorkspaceBusy(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadWorkspace(), 0);
    const interval = window.setInterval(() => void loadWorkspace(true), 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [loadWorkspace]);

  async function workspaceAction(body: Record<string, unknown>) {
    setWorkspaceBusy(true);
    setError('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Action failed');
      await loadWorkspace(true);
      setWorkspaceMessage('Workspace updated');
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Workspace action failed',
      );
      return false;
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function processFile(file: File) {
    setError('');
    if (file.size > 5 * 1024 * 1024) {
      setError(
        'File is larger than 5 MB. Split it into a smaller sample first.',
      );
      return;
    }
    setProcessing(true);
    try {
      const content = await file.text();
      const parsed = parseLogContent(content, file.name);
      const grouped = analyzeLogs(parsed);
      if (!parsed.length) throw new Error('No readable log rows were found.');
      if (!grouped.length)
        throw new Error(
          'The file was valid, but it did not contain warning or error signals.',
        );
      setLogs(parsed);
      setIncidents(grouped);
      setSelectedId(grouped[0].id);
      setFilename(file.name);
      setFileSize(`${Math.max(0.1, file.size / 1024).toFixed(1)} KB`);
      setResolved([]);
      setUploadOpen(false);
      setTab('analysis');
      const saved = await workspaceAction({
        action: 'save_analysis',
        payload: {
          filename: file.name,
          format: file.name.split('.').pop() ?? 'txt',
          rowCount: parsed.length,
          rawContent: content.slice(0, 1_000_000),
          incidents: grouped.map((incident) => ({
            ...incident,
            logs: incident.logs.slice(0, 250),
          })),
        },
      });
      setWorkspaceMessage(
        saved
          ? 'Analysis saved to incident history'
          : 'Analysis completed locally; persistent save failed',
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'CrashLens could not read this file.',
      );
    } finally {
      setProcessing(false);
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void processFile(file);
    event.target.value = '';
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void processFile(file);
  }

  function resetSample() {
    setLogs(initialLogs);
    setIncidents(initialIncidents);
    setSelectedId(initialIncidents[0]?.id ?? '');
    setFilename('crashlens-sample.jsonl');
    setFileSize('4.2 KB');
    setError('');
    setUploadOpen(false);
    setResolved([]);
  }

  return (
    <main className="min-h-screen bg-[#090B0F] text-[#F4F7FB]">
      <header className="sticky top-0 z-50 flex h-16 items-center border-b border-[#232936] bg-[#0D1017] px-4 lg:px-5">
        <button
          aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
          onClick={() => setMobileNavOpen((open) => !open)}
          className="mr-3 grid size-9 place-items-center rounded-lg border border-[#232936] bg-[#11151D] text-[#F4F7FB] lg:hidden"
        >
          {mobileNavOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-[#7C6CFF] text-white shadow-[0_8px_24px_rgba(124,108,255,.24)]">
            <Activity size={18} strokeWidth={2.5} />
          </span>
          <span className="text-sm font-semibold tracking-[-0.02em] text-white">
            CrashLens
          </span>
        </div>
        <label className="ml-8 hidden h-9 max-w-lg flex-1 items-center gap-2 rounded-lg border border-[#232936] bg-[#090B0F] px-3 text-[#8B95A7] lg:flex">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search incidents, logs, services…"
            className="w-full bg-transparent text-sm text-[#F4F7FB] outline-none placeholder:text-[#626C7D]"
          />
          <span className="rounded border border-[#2D3442] px-1.5 py-0.5 text-[10px]">
            ⌘K
          </span>
        </label>
        <div className="ml-auto flex items-center gap-2 text-xs text-[#8B95A7] lg:ml-3">
          <select
            value={environment}
            onChange={(event) => setEnvironment(event.target.value)}
            aria-label="Environment"
            className="hidden h-9 rounded-lg border border-[#232936] bg-[#11151D] px-2 text-xs text-[#D9DEEA] outline-none sm:block"
          >
            <option>Production</option>
            <option>Staging</option>
            <option>Development</option>
          </select>
          <select
            value={dateRange}
            onChange={(event) => setDateRange(event.target.value)}
            aria-label="Time range"
            className="hidden h-9 rounded-lg border border-[#232936] bg-[#11151D] px-2 text-xs text-[#D9DEEA] outline-none md:block"
          >
            <option>Last 24h</option>
            <option>Last 7 days</option>
            <option>Last 30 days</option>
          </select>
          <div className="relative">
            <button
              aria-label="Notifications"
              onClick={() => setNotificationsOpen((open) => !open)}
              className="relative grid size-9 place-items-center rounded-lg border border-[#232936] bg-[#11151D] hover:bg-[#171C26]"
            >
              <Bell size={16} />
              <span className="absolute right-2 top-2 size-1.5 rounded-full bg-[#FF4D5E]" />
            </button>
            {notificationsOpen && (
              <div className="absolute right-0 top-11 w-72 rounded-xl border border-[#232936] bg-[#11151D] p-3 shadow-2xl">
                <p className="font-semibold text-[#F4F7FB]">Notifications</p>
                <p className="mt-2 text-xs leading-5">
                  {
                    incidents.filter((item) => item.severity === 'critical')
                      .length
                  }{' '}
                  critical incidents need review.
                </p>
                <button
                  onClick={() => {
                    setView('incidents');
                    setIncidentFilter('critical');
                    setNotificationsOpen(false);
                  }}
                  className="mt-3 text-xs font-semibold text-[#9D91FF]"
                >
                  View critical incidents →
                </button>
              </div>
            )}
          </div>
          <Link
            href="/account"
            aria-label="Open account"
            className="grid size-9 place-items-center rounded-full bg-[#7C6CFF] text-xs font-semibold text-white"
          >
            {(workspace?.user.name || workspace?.user.email || 'CL')
              .slice(0, 2)
              .toUpperCase()}
          </Link>
        </div>
      </header>

      {mobileNavOpen && (
        <button
          aria-label="Close navigation overlay"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 top-16 z-30 bg-black/70 lg:hidden"
        />
      )}
      <div className="flex min-h-[calc(100vh-64px)]">
        <aside
          className={`${mobileNavOpen ? 'fixed inset-y-16 left-0 z-40 flex' : 'hidden'} ${sidebarCollapsed ? 'w-[76px]' : 'w-60'} shrink-0 flex-col border-r border-[#232936] bg-[#0D1017] p-3 transition-[width] lg:static lg:flex`}
        >
          <nav className="space-y-1">
            {(
              [
                ['overview', LayoutDashboard, 'Overview'],
                ['incidents', AlertTriangle, 'Incidents'],
                ['logs', FileCode2, 'Logs'],
                ['services', Boxes, 'Services'],
                ['deployments', GitCommitHorizontal, 'Deployments'],
                ['monitoring', HeartPulse, 'Monitoring'],
                ['integrations', Plug, 'Integrations'],
                ['settings', Settings, 'Settings'],
                ['history', History, 'History'],
                ['team', Users, 'Team'],
                ...(workspace?.capabilities.platformAdmin
                  ? ([['clients', Users, 'Clients']] as const)
                  : []),
              ] as Array<[WorkspaceView, LucideIcon, string]>
            ).map(([key, Icon, label]) => (
              <button
                key={key}
                onClick={() => {
                  setView(key);
                  setMobileNavOpen(false);
                }}
                title={sidebarCollapsed ? label : undefined}
                className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${view === key ? 'bg-[#23283B] text-white' : 'text-[#8B95A7] hover:bg-[#171C26] hover:text-white'}`}
              >
                <Icon
                  size={17}
                  className={view === key ? 'text-[#9D91FF]' : ''}
                />
                {!sidebarCollapsed && label}
                {key === 'incidents' && (
                  <span className="ml-auto rounded-full bg-[#FF4D5E]/15 px-2 py-0.5 text-[11px] font-semibold text-[#FF6B79]">
                    {incidents.length}
                  </span>
                )}
              </button>
            ))}
            {!sidebarCollapsed && (
              <button
                onClick={() => {
                  setUploadOpen(true);
                  setMobileNavOpen(false);
                }}
                className="mt-3 flex h-10 w-full items-center gap-3 rounded-lg border border-[#2D3442] bg-transparent px-3 text-sm font-medium text-[#B5BECD] hover:bg-[#171C26] hover:text-white"
              >
                <Database size={15} />
                Upload source
              </button>
            )}
          </nav>
          {!sidebarCollapsed && (
            <>
              <p className="px-3 pb-2 pt-8 text-[11px] font-medium uppercase tracking-[0.12em] text-[#626C7D]">
                CURRENT SOURCE
              </p>
              <div className="rounded-xl border border-[#232936] bg-[#11151D] p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[#35D07F]">
                  <CheckCircle2 size={14} /> Parsed
                </div>
                <p className="truncate text-sm text-[#F4F7FB]" title={filename}>
                  {filename}
                </p>
                <p className="mt-2 text-xs text-[#8B95A7]">
                  {logs.length} rows · {fileSize}
                </p>
              </div>
              <div className="mt-auto border-t border-[#232936] pt-3">
                <div className="flex items-center gap-2 px-2 text-xs text-[#8B95A7]">
                  <ShieldCheck size={14} className="text-[#35D07F]" /> PII
                  redaction active
                </div>
              </div>
            </>
          )}
          <button
            onClick={() => setSidebarCollapsed((value) => !value)}
            className="mt-3 flex h-9 items-center justify-center rounded-lg border border-[#232936] text-[#8B95A7] hover:bg-[#171C26] hover:text-white"
            aria-label="Collapse sidebar"
          >
            {sidebarCollapsed ? '→' : '←  Collapse'}
          </button>
        </aside>

        <div className="min-w-0 flex-1">
          <section className="border-b border-[#232936] bg-[#090B0F] px-4 py-7 lg:px-8">
            <div className="mx-auto flex max-w-[1500px] flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h1 className="text-2xl font-semibold tracking-[-0.035em] text-[#F4F7FB] lg:text-[30px]">
                  {view[0].toUpperCase()}
                  {view.slice(1)}
                </h1>
                <p className="mt-1.5 text-sm text-[#8B95A7]">
                  {view === 'incidents'
                    ? 'Monitor, investigate and resolve production issues.'
                    : view === 'overview'
                      ? 'A live view of production health and operational risk.'
                      : `Explore ${view} across ${environment.toLowerCase()}.`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href="/samples/crashlens-sample.jsonl"
                  download
                  className="flex h-10 items-center gap-2 rounded-lg border border-[#2D3442] bg-[#11151D] px-4 text-xs font-semibold text-[#D9DEEA] hover:bg-[#171C26]"
                >
                  <Download size={15} />
                  Sample JSONL
                </a>
                <button
                  onClick={() => setUploadOpen(true)}
                  className="flex h-10 items-center gap-2 rounded-lg bg-[#7C6CFF] px-5 text-xs font-semibold text-white shadow-[0_8px_24px_rgba(124,108,255,.2)] hover:bg-[#8A7BFF]"
                >
                  <Upload size={15} />
                  Upload logs
                </button>
              </div>
            </div>
          </section>

          <div className="mx-auto max-w-[1500px] p-4 lg:p-6">
            {error && (
              <div
                role="alert"
                className="mb-4 flex items-start gap-3 border border-[#a53d3d] bg-[#200d0f] p-3 text-xs text-[#FF6B79]"
              >
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>{error}</span>
                <button onClick={() => setError('')} className="ml-auto">
                  <X size={14} />
                </button>
              </div>
            )}

            {view === 'incidents' ? (
              <>
                <div className="mb-5 flex flex-wrap items-center gap-2">
                  {(
                    ['all', 'open', 'critical', 'resolved'] as IncidentFilter[]
                  ).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setIncidentFilter(filter)}
                      className={`rounded-lg px-3 py-2 text-xs font-medium capitalize ${incidentFilter === filter ? 'bg-[#242A3B] text-white' : 'border border-[#232936] bg-[#11151D] text-[#8B95A7] hover:bg-[#171C26]'}`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
                <section className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
                  {metrics.map(({ label, value, note, icon: Icon }) => (
                    <article
                      key={label}
                      className="rounded-xl border border-[#232936] bg-[#11151D] p-4 shadow-[0_10px_30px_rgba(0,0,0,.12)]"
                    >
                      <div className="flex items-center justify-between text-xs font-medium text-[#8B95A7]">
                        <span>{label}</span>
                        <Icon size={15} />
                      </div>
                      <div className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">
                        {value}
                      </div>
                      <p className="mt-1 text-xs text-[#626C7D]">{note}</p>
                    </article>
                  ))}
                </section>

                <section className="mb-5 overflow-hidden rounded-xl border border-[#232936] bg-[#11151D] p-4 shadow-[0_10px_30px_rgba(0,0,0,.12)]">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-[#D9DEEA]">
                      <Radio size={13} className="text-[#9D91FF]" /> Incident
                      activity
                    </div>
                    <div className="flex items-center gap-4 text-xs text-[#626C7D]">
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-[#7C6CFF]" />
                        All events
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-[#FF4D5E]" />
                        Critical
                      </span>
                    </div>
                  </div>
                  <div className="h-[190px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={signalBars}
                        margin={{ top: 8, right: 8, left: -28, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="activityFill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="#7C6CFF"
                              stopOpacity={0.34}
                            />
                            <stop
                              offset="100%"
                              stopColor="#7C6CFF"
                              stopOpacity={0.02}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          vertical={false}
                          stroke="#232936"
                          strokeDasharray="3 5"
                        />
                        <XAxis
                          dataKey="label"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: '#626C7D', fontSize: 11 }}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          allowDecimals={false}
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: '#626C7D', fontSize: 11 }}
                        />
                        <Tooltip
                          contentStyle={{
                            background: '#0D1017',
                            border: '1px solid #2D3442',
                            borderRadius: 8,
                            color: '#F4F7FB',
                            fontSize: 12,
                          }}
                          labelFormatter={(label) => `${label} UTC`}
                        />
                        <Area
                          type="monotone"
                          dataKey="count"
                          name="All events"
                          stroke="#7C6CFF"
                          strokeWidth={2.5}
                          fill="url(#activityFill)"
                          activeDot={{
                            r: 5,
                            fill: '#9D91FF',
                            stroke: '#0D1017',
                            strokeWidth: 2,
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="critical"
                          name="Critical"
                          stroke="#FF4D5E"
                          strokeWidth={2}
                          fill="transparent"
                          dot={{ r: 3, fill: '#FF4D5E', strokeWidth: 0 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section
                  id="incidents"
                  className="grid min-h-[610px] overflow-hidden rounded-xl border border-[#232936] bg-[#11151D] shadow-[0_12px_34px_rgba(0,0,0,.16)] xl:grid-cols-[minmax(520px,.95fr)_minmax(0,1.05fr)]"
                >
                  <div className="border-b border-[#232936] xl:border-b-0 xl:border-r">
                    <div className="flex items-center justify-between border-b border-[#232936] p-4">
                      <div>
                        <h2 className="text-sm font-semibold text-white">
                          Active incidents
                        </h2>
                        <p className="mt-1 text-xs text-[#626C7D]">
                          Grouped by fingerprint and service
                        </p>
                      </div>
                      <label className="flex h-9 w-52 items-center gap-2 rounded-lg border border-[#232936] bg-[#090B0F] px-3 text-[#8B95A7] focus-within:border-[#7C6CFF]">
                        <Search size={15} />
                        <input
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder="Filter incidents or services"
                          className="w-full bg-transparent text-xs text-white outline-none placeholder:text-[#626C7D]"
                        />
                        <Filter size={14} />
                      </label>
                    </div>
                    <div className="grid grid-cols-[1fr_92px_82px_72px] gap-3 border-b border-[#232936] px-4 py-2.5 text-[10px] font-medium uppercase tracking-[.08em] text-[#626C7D]">
                      <span>Incident</span>
                      <span>Service</span>
                      <span>Status</span>
                      <span className="text-right">Events</span>
                    </div>
                    <div className="max-h-[535px] overflow-y-auto">
                      {filteredIncidents.length ? (
                        filteredIncidents.map((incident) => (
                          <button
                            aria-label={`Open incident ${incident.id}: ${incident.title}`}
                            key={incident.id}
                            onClick={() => {
                              setSelectedId(incident.id);
                              setTab('analysis');
                            }}
                            className={`grid w-full grid-cols-[1fr_92px_82px_72px] items-center gap-3 border-b border-[#202633] px-4 py-3 text-left transition-colors ${selected?.id === incident.id ? 'bg-[#1C2130]' : 'bg-[#11151D] hover:bg-[#171C26]'}`}
                          >
                            <span className="min-w-0">
                              <span className="flex items-center gap-2">
                                <span
                                  className={`size-2 shrink-0 rounded-full ${incident.severity === 'critical' ? 'bg-[#FF4D5E]' : incident.severity === 'warning' ? 'bg-[#FF9F43]' : 'bg-[#F4D35E]'}`}
                                />
                                <span className="truncate text-[13px] font-medium text-[#F4F7FB]">
                                  {incident.title}
                                </span>
                              </span>
                              <span className="mt-1.5 flex gap-2 text-[11px] text-[#626C7D]">
                                <span>#{incident.id}</span>
                                <span>{time(incident.started)} UTC</span>
                              </span>
                            </span>
                            <span className="truncate text-xs text-[#B5BECD]">
                              {incident.service}
                            </span>
                            <span
                              className={`w-fit rounded-full px-2 py-1 text-[10px] font-semibold ${resolved.includes(incident.id) ? 'bg-[#35D07F]/12 text-[#55DE96]' : incident.severity === 'critical' ? 'bg-[#FF4D5E]/12 text-[#FF6B79]' : 'bg-[#FF9F43]/12 text-[#FFB66D]'}`}
                            >
                              {resolved.includes(incident.id)
                                ? 'Resolved'
                                : incident.severity === 'critical'
                                  ? 'Critical'
                                  : 'Open'}
                            </span>
                            <span className="text-right">
                              <span className="block text-xs text-[#D9DEEA]">
                                {incident.logs.length}
                              </span>
                              <span className="mt-1 block text-[10px] text-[#FF6B79]">
                                {incident.change}
                              </span>
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="p-8 text-center text-xs text-[#8B95A7]">
                          No incidents match this filter.
                        </div>
                      )}
                    </div>
                  </div>

                  {selected ? (
                    <div className="min-w-0">
                      <div className="border-b border-[#232936] p-4 lg:p-5">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="mb-2 flex items-center gap-2 text-xs text-[#8B95A7]">
                              <span
                                className={`size-1.5 ${selected.severity === 'critical' ? 'bg-[#FF4D5E]' : 'bg-[#FF9F43]'}`}
                              />
                              INCIDENT #{selected.id} /{' '}
                              {resolved.includes(selected.id)
                                ? 'RESOLVED'
                                : selected.status.toUpperCase()}
                            </div>
                            <h2 className="text-xl font-semibold tracking-[-0.03em] text-white">
                              {selected.title}
                            </h2>
                            <p className="mt-1 text-xs text-[#8B95A7]">
                              {selected.service} · {selected.logs.length}{' '}
                              correlated events · {dateTime(selected.started)}{' '}
                              UTC
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => setTab('logs')}
                              className="h-9 rounded-lg border border-[#2D3442] bg-[#171C26] px-3 text-xs font-medium text-[#D9DEEA] hover:bg-[#202633]"
                            >
                              View logs
                            </button>
                            <button
                              onClick={() =>
                                setResolved((items) =>
                                  items.includes(selected.id)
                                    ? items.filter((id) => id !== selected.id)
                                    : [...items, selected.id],
                                )
                              }
                              className="h-9 rounded-lg bg-[#7C6CFF] px-3 text-xs font-semibold text-white hover:bg-[#8A7BFF]"
                            >
                              {resolved.includes(selected.id)
                                ? 'Reopen'
                                : 'Resolve'}
                            </button>
                            <div className="relative">
                              <button
                                aria-label="More incident actions"
                                onClick={() => setMoreOpen((open) => !open)}
                                className="grid size-9 place-items-center rounded-lg border border-[#2D3442] bg-[#171C26] text-[#8B95A7] hover:text-white"
                              >
                                <MoreHorizontal size={17} />
                              </button>
                              {moreOpen && (
                                <div className="absolute right-0 top-11 z-20 w-44 rounded-lg border border-[#2D3442] bg-[#11151D] p-1.5 shadow-2xl">
                                  <button
                                    onClick={() => {
                                      void navigator.clipboard.writeText(
                                        selected.fingerprint,
                                      );
                                      setCopied(true);
                                      setMoreOpen(false);
                                      window.setTimeout(
                                        () => setCopied(false),
                                        1600,
                                      );
                                    }}
                                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-[#D9DEEA] hover:bg-[#171C26]"
                                  >
                                    <Clipboard size={13} />
                                    {copied ? 'Copied' : 'Copy fingerprint'}
                                  </button>
                                  <button
                                    onClick={() => {
                                      downloadText(
                                        buildReport(selected, filename),
                                        `incident-${selected.id}-report.txt`,
                                      );
                                      setMoreOpen(false);
                                    }}
                                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-[#D9DEEA] hover:bg-[#171C26]"
                                  >
                                    <ArrowDownToLine size={13} />
                                    Export report
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="border-b border-[#232936] bg-[#171C26] p-5">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2 text-xs font-medium text-[#9D91FF]">
                            <Sparkles size={14} /> Likely root cause
                          </div>
                          <span className="shrink-0 rounded-full bg-[#7C6CFF]/12 px-2.5 py-1 text-xs font-semibold text-[#9D91FF]">
                            {selected.confidence}% confidence
                          </span>
                        </div>
                        <p className="mt-3 text-lg font-semibold leading-snug text-white">
                          {rootCauseFor(selected)}
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-[#8B95A7]">
                          CrashLens correlated service identity, event order,
                          normalized fingerprints and nearby operational
                          changes.
                        </p>
                      </div>

                      <div className="flex h-11 border-b border-[#232936] bg-[#11151D] px-4">
                        <button
                          onClick={() => setTab('analysis')}
                          className={`mr-6 border-b-2 px-1 text-xs font-bold ${tab === 'analysis' ? 'border-[#7C6CFF] text-[#7C6CFF]' : 'border-transparent text-[#8B95A7]'}`}
                        >
                          AI INVESTIGATION
                        </button>
                        <button
                          onClick={() => setTab('timeline')}
                          className={`mr-6 border-b-2 px-1 text-xs font-bold ${tab === 'timeline' ? 'border-[#7C6CFF] text-[#7C6CFF]' : 'border-transparent text-[#8B95A7]'}`}
                        >
                          TIMELINE
                        </button>
                        <button
                          onClick={() => setTab('logs')}
                          className={`border-b-2 px-1 text-xs font-bold ${tab === 'logs' ? 'border-[#7C6CFF] text-[#7C6CFF]' : 'border-transparent text-[#8B95A7]'}`}
                        >
                          LOGS ({selected.logs.length})
                        </button>
                      </div>

                      <div
                        className="max-h-[315px] overflow-auto p-4 lg:p-5"
                        id="raw-logs"
                      >
                        {tab === 'analysis' ? (
                          <div className="space-y-5">
                            <div className="grid gap-5 md:grid-cols-[1.05fr_.95fr]">
                              <div>
                                <div className="flex items-center justify-between">
                                  <h3 className="text-sm font-semibold text-white">
                                    Evidence
                                  </h3>
                                  <span className="text-xs text-[#626C7D]">
                                    {selected.logs.length} correlated events
                                  </span>
                                </div>
                                <div className="mt-3 space-y-2.5 text-sm text-[#B5BECD]">
                                  <p className="flex gap-2">
                                    <CircleCheck
                                      size={15}
                                      className="mt-0.5 shrink-0 text-[#35D07F]"
                                    />
                                    <span>
                                      <strong className="font-medium text-white">
                                        {selected.service}
                                      </strong>{' '}
                                      produced the first matching error at{' '}
                                      {time(selected.started)} UTC.
                                    </span>
                                  </p>
                                  <p className="flex gap-2">
                                    <CircleCheck
                                      size={15}
                                      className="mt-0.5 shrink-0 text-[#35D07F]"
                                    />
                                    <span>
                                      {selected.logs.length} events share the
                                      normalized{' '}
                                      <strong className="font-medium text-white">
                                        {selected.fingerprint}
                                      </strong>{' '}
                                      fingerprint.
                                    </span>
                                  </p>
                                  <p className="flex gap-2">
                                    <CircleCheck
                                      size={15}
                                      className="mt-0.5 shrink-0 text-[#35D07F]"
                                    />
                                    <span>
                                      {selected.timeline.some(
                                        (event) => event.type === 'deploy',
                                      )
                                        ? 'A deployment signal was detected near the first failure.'
                                        : 'Event timestamps cluster inside the same operational window.'}
                                    </span>
                                  </p>
                                </div>
                              </div>
                              <div className="rounded-lg border border-[#2D3442] bg-[#0D1017] p-4">
                                <p className="text-xs font-medium text-[#9D91FF]">
                                  Recommended action
                                </p>
                                <p className="mt-2 text-sm leading-relaxed text-[#D9DEEA]">
                                  Inspect the {selected.service} dependencies
                                  and recent deployment. Check its connection
                                  pool, then roll back if the error rate
                                  continues rising.
                                </p>
                                <div className="mt-4 flex flex-wrap gap-2">
                                  <button
                                    onClick={() => setTab('logs')}
                                    className="rounded-lg bg-[#7C6CFF] px-3 py-2 text-xs font-semibold text-white"
                                  >
                                    View related logs
                                  </button>
                                  <button
                                    onClick={() => setView('deployments')}
                                    className="rounded-lg border border-[#2D3442] px-3 py-2 text-xs text-[#D9DEEA]"
                                  >
                                    View deployment
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div className="border-t border-[#232936] pt-5">
                              <div className="mb-3">
                                <h3 className="text-sm font-semibold text-white">
                                  Causal chain
                                </h3>
                                <p className="mt-1 text-xs text-[#626C7D]">
                                  How the signal became a production incident
                                </p>
                              </div>
                              <div className="grid items-stretch gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
                                <div className="rounded-lg border border-[#7C6CFF]/55 bg-[#7C6CFF]/8 p-3">
                                  <p className="text-[11px] font-medium uppercase tracking-[.08em] text-[#9D91FF]">
                                    Root signal
                                  </p>
                                  <p className="mt-2 text-sm font-medium text-white">
                                    {rootCauseFor(selected).replace(
                                      ` in ${selected.service}`,
                                      '',
                                    )}
                                  </p>
                                  <p className="mt-1 text-xs text-[#8B95A7]">
                                    {selected.service} ·{' '}
                                    {time(selected.started)}
                                  </p>
                                </div>
                                <ChevronRight
                                  size={18}
                                  className="mx-auto self-center rotate-90 text-[#626C7D] md:rotate-0"
                                />
                                <div className="rounded-lg border border-[#2D3442] bg-[#171C26] p-3">
                                  <p className="text-[11px] font-medium uppercase tracking-[.08em] text-[#8B95A7]">
                                    Incident cluster
                                  </p>
                                  <p className="mt-2 text-sm font-medium text-white">
                                    {selected.logs.length} matching failures
                                  </p>
                                  <p className="mt-1 text-xs text-[#8B95A7]">
                                    {selected.fingerprint}
                                  </p>
                                </div>
                                <ChevronRight
                                  size={18}
                                  className="mx-auto self-center rotate-90 text-[#626C7D] md:rotate-0"
                                />
                                <div className="rounded-lg border border-[#FF4D5E]/45 bg-[#FF4D5E]/8 p-3">
                                  <p className="text-[11px] font-medium uppercase tracking-[.08em] text-[#FF6B79]">
                                    Production impact
                                  </p>
                                  <p className="mt-2 text-sm font-medium text-white">
                                    {selected.title}
                                  </p>
                                  <p className="mt-1 text-xs text-[#8B95A7]">
                                    {selected.status} ·{' '}
                                    {time(selected.lastSeen)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : tab === 'timeline' ? (
                          <div className="max-w-2xl">
                            {selected.timeline.map((event, index) => (
                              <div
                                key={`${event.timestamp}-${index}`}
                                className="grid grid-cols-[46px_18px_1fr] gap-3"
                              >
                                <span className="pt-0.5 text-xs text-[#8B95A7]">
                                  {event.time}
                                </span>
                                <span className="relative flex justify-center">
                                  <span
                                    className={`relative z-10 mt-0.5 size-2.5 border border-[#11151D] ${event.type === 'critical' ? 'bg-[#FF4D5E]' : event.type === 'deploy' ? 'bg-[#7C6CFF]' : event.type === 'alert' ? 'bg-[#FF9F43]' : 'bg-[#757575]'}`}
                                  />
                                  {index < selected.timeline.length - 1 && (
                                    <span className="absolute top-2 h-full w-px bg-[#2D3442]" />
                                  )}
                                </span>
                                <span className="pb-5">
                                  <span
                                    className={`block text-sm ${event.type === 'critical' ? 'text-[#FF6B79]' : 'text-[#D9DEEA]'}`}
                                  >
                                    {event.title}
                                  </span>
                                  <span className="mt-0.5 block text-xs text-[#626C7D]">
                                    {event.detail}
                                  </span>
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="min-w-[650px] text-xs">
                            <div className="grid grid-cols-[70px_58px_130px_1fr] border-b border-[#2D3442] pb-2 text-[#626C7D]">
                              <span>TIME</span>
                              <span>LEVEL</span>
                              <span>SERVICE</span>
                              <span>MESSAGE</span>
                            </div>
                            {selected.logs.map((log) => (
                              <div
                                key={log.id}
                                className="grid grid-cols-[70px_58px_130px_1fr] border-b border-[#202633] py-2 text-[#B5BECD]"
                              >
                                <span>{time(log.timestamp)}</span>
                                <span
                                  className={
                                    log.level === 'fatal' ||
                                    log.level === 'error'
                                      ? 'text-[#FF6B79]'
                                      : 'text-[#FF9F43]'
                                  }
                                >
                                  {log.level.toUpperCase()}
                                </span>
                                <span className="truncate pr-3 text-[#7C6CFF]">
                                  {log.service}
                                </span>
                                <span className="truncate">{log.message}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="grid place-items-center p-10 text-xs text-[#8B95A7]">
                      Upload a file containing errors to create an incident.
                    </div>
                  )}
                </section>
              </>
            ) : [
                'overview',
                'logs',
                'services',
                'deployments',
                'settings',
              ].includes(view) ? (
              <LocalDataConsole
                view={
                  view as
                    | 'overview'
                    | 'logs'
                    | 'services'
                    | 'deployments'
                    | 'settings'
                }
                logs={logs}
                incidents={incidents}
                resolved={resolved}
                query={query}
                filename={filename}
                workspace={workspace}
                onUpload={() => setUploadOpen(true)}
              />
            ) : (
              <OperationsConsole
                view={view}
                workspace={workspace}
                health={health}
                busy={workspaceBusy}
                inviteEmail={inviteEmail}
                setInviteEmail={setInviteEmail}
                comment={comment}
                setComment={setComment}
                historyIncidentId={historyIncidentId}
                setHistoryIncidentId={setHistoryIncidentId}
                action={workspaceAction}
              />
            )}
          </div>
        </div>
      </div>

      {uploadOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#090B0F] p-4">
          <div className="w-full max-w-xl border-2 border-[#7C6CFF] bg-[#171C26] shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#232936] p-5">
              <div>
                <p className="text-xs text-[#7C6CFF]">Log upload</p>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  Analyze a log file
                </h2>
                <p className="mt-1 text-sm text-[#8B95A7]">
                  Analysis runs in the browser, then a redacted copy is saved to
                  your authenticated workspace.
                </p>
              </div>
              <button
                onClick={() => setUploadOpen(false)}
                className="text-[#8B95A7] hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".txt,.log,.csv,.jsonl,.ndjson"
              onChange={onFile}
              className="hidden"
            />
            <button
              type="button"
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={`m-5 grid min-h-52 w-[calc(100%-2.5rem)] cursor-pointer place-items-center border border-dashed p-6 text-center ${dragging ? 'border-[#7C6CFF] bg-[#1C2130]' : 'border-[#353D4D] bg-[#0D1017] hover:border-[#8B95A7]'}`}
            >
              {processing ? (
                <span>
                  <LoaderCircle
                    size={26}
                    className="mx-auto animate-spin text-[#7C6CFF]"
                  />
                  <span className="mt-3 block text-xs text-[#7C6CFF]">
                    PARSING + CLUSTERING
                  </span>
                </span>
              ) : (
                <span>
                  <Upload size={25} className="mx-auto text-[#7C6CFF]" />
                  <span className="mt-3 block text-sm font-medium text-white">
                    Drop a file here or click to browse
                  </span>
                  <span className="mt-2 block text-xs text-[#8B95A7]">
                    TXT · LOG · CSV · JSONL · NDJSON / MAX 5 MB
                  </span>
                </span>
              )}
            </button>
            {error && (
              <p className="mx-5 mb-3 border border-[#8f3333] bg-[#210d0f] p-3 text-xs text-[#FF6B79]">
                {error}
              </p>
            )}
            <div className="border-t border-[#232936] bg-[#0D1017] p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-[#8B95A7]">
                  DON&apos;T HAVE LOGS?
                </span>
                <button
                  onClick={resetSample}
                  className="text-xs font-bold text-[#7C6CFF]"
                >
                  LOAD BUILT-IN SAMPLE
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {sampleFiles.map(({ label, extension, icon: Icon }) => (
                  <a
                    key={label}
                    href={`/samples/crashlens-sample.${extension}`}
                    download
                    className="flex items-center justify-center gap-2 border border-[#2D3442] bg-[#171C26] py-2 text-xs text-[#B5BECD] hover:border-[#7d7d7d] hover:text-white"
                  >
                    <Icon size={12} />
                    {label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function LocalDataConsole({
  view,
  logs,
  incidents,
  resolved,
  query,
  filename,
  workspace,
  onUpload,
}: {
  view: 'overview' | 'logs' | 'services' | 'deployments' | 'settings';
  logs: LogEntry[];
  incidents: Incident[];
  resolved: string[];
  query: string;
  filename: string;
  workspace: Workspace | null;
  onUpload: () => void;
}) {
  const services = useMemo(() => {
    const grouped = new Map<string, LogEntry[]>();
    logs.forEach((log) =>
      grouped.set(log.service, [...(grouped.get(log.service) ?? []), log]),
    );
    return [...grouped.entries()].map(([name, rows]) => ({
      name,
      events: rows.length,
      errors: rows.filter(
        (row) => row.level === 'error' || row.level === 'fatal',
      ).length,
      lastSeen: rows.at(-1)?.timestamp ?? '',
    }));
  }, [logs]);
  const visibleLogs = logs.filter((log) =>
    `${log.service} ${log.message} ${log.level}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const deployments = incidents.flatMap((incident) =>
    incident.timeline
      .filter((event) => event.type === 'deploy')
      .map((event) => ({ ...event, incident })),
  );
  const panel =
    'overflow-hidden rounded-xl border border-[#232936] bg-[#11151D] shadow-[0_12px_34px_rgba(0,0,0,.14)]';

  if (view === 'overview')
    return (
      <div className="grid gap-5 xl:grid-cols-[1.3fr_.7fr]">
        <section className={panel}>
          <div className="border-b border-[#232936] p-5">
            <h2 className="font-semibold">Production health</h2>
            <p className="mt-1 text-sm text-[#8B95A7]">
              Live signals from the current dataset
            </p>
          </div>
          <div className="grid gap-px bg-[#232936] sm:grid-cols-3">
            {[
              ['Open incidents', incidents.length - resolved.length],
              [
                'Critical',
                incidents.filter((item) => item.severity === 'critical').length,
              ],
              ['Services', services.length],
            ].map(([label, value]) => (
              <div key={label} className="bg-[#11151D] p-5">
                <p className="text-xs text-[#8B95A7]">{label}</p>
                <p className="mt-2 text-3xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <div className="p-5">
            <div className="flex items-center gap-2 text-sm text-[#35D07F]">
              <CheckCircle2 size={16} /> Log ingestion is operational
            </div>
            <p className="mt-2 text-xs text-[#626C7D]">
              {logs.length} events parsed from {filename}
            </p>
          </div>
        </section>
        <section className={panel}>
          <div className="border-b border-[#232936] p-5">
            <h2 className="font-semibold">Needs attention</h2>
          </div>
          <div className="divide-y divide-[#232936]">
            {incidents.slice(0, 4).map((incident) => (
              <button
                key={incident.id}
                className="flex w-full items-center gap-3 p-4 text-left hover:bg-[#171C26]"
              >
                <span
                  className={`size-2 rounded-full ${incident.severity === 'critical' ? 'bg-[#FF4D5E]' : 'bg-[#FF9F43]'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {incident.title}
                  </span>
                  <span className="mt-1 block text-xs text-[#626C7D]">
                    {incident.service}
                  </span>
                </span>
                <ChevronRight size={15} className="text-[#626C7D]" />
              </button>
            ))}
          </div>
        </section>
      </div>
    );

  if (view === 'logs')
    return (
      <section className={panel}>
        <div className="flex items-center justify-between border-b border-[#232936] p-5">
          <div>
            <h2 className="font-semibold">Event stream</h2>
            <p className="mt-1 text-xs text-[#8B95A7]">
              {visibleLogs.length} matching log events
            </p>
          </div>
          <button
            onClick={onUpload}
            className="rounded-lg bg-[#7C6CFF] px-4 py-2 text-xs font-semibold"
          >
            Upload logs
          </button>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[100px_80px_150px_1fr] gap-3 border-b border-[#232936] px-5 py-3 text-[10px] uppercase tracking-[.08em] text-[#626C7D]">
              <span>Time</span>
              <span>Level</span>
              <span>Service</span>
              <span>Message</span>
            </div>
            {visibleLogs.slice(0, 100).map((log) => (
              <div
                key={log.id}
                className="grid grid-cols-[100px_80px_150px_1fr] gap-3 border-b border-[#202633] px-5 py-3 text-xs hover:bg-[#171C26]"
              >
                <span className="text-[#8B95A7]">{time(log.timestamp)}</span>
                <span
                  className={
                    log.level === 'error' || log.level === 'fatal'
                      ? 'text-[#FF6B79]'
                      : 'text-[#F4D35E]'
                  }
                >
                  {log.level}
                </span>
                <span>{log.service}</span>
                <span className="truncate text-[#B5BECD]">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    );

  if (view === 'services')
    return (
      <section className={panel}>
        <div className="border-b border-[#232936] p-5">
          <h2 className="font-semibold">Services</h2>
          <p className="mt-1 text-sm text-[#8B95A7]">
            Health inferred from ingested production signals
          </p>
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
          {services.map((service) => (
            <article
              key={service.name}
              className="rounded-xl border border-[#232936] bg-[#0D1017] p-4"
            >
              <div className="flex items-center justify-between">
                <Server size={17} className="text-[#9D91FF]" />
                <span
                  className={`rounded-full px-2 py-1 text-[10px] ${service.errors ? 'bg-[#FF4D5E]/12 text-[#FF6B79]' : 'bg-[#35D07F]/12 text-[#55DE96]'}`}
                >
                  {service.errors ? 'Degraded' : 'Healthy'}
                </span>
              </div>
              <h3 className="mt-4 text-sm font-semibold">{service.name}</h3>
              <div className="mt-3 flex gap-4 text-xs text-[#8B95A7]">
                <span>{service.events} events</span>
                <span>{service.errors} errors</span>
              </div>
              <p className="mt-2 text-[11px] text-[#626C7D]">
                Last seen {service.lastSeen ? dateTime(service.lastSeen) : '—'}{' '}
                UTC
              </p>
            </article>
          ))}
        </div>
      </section>
    );

  if (view === 'deployments')
    return (
      <section className={panel}>
        <div className="border-b border-[#232936] p-5">
          <h2 className="font-semibold">Deployment correlations</h2>
          <p className="mt-1 text-sm text-[#8B95A7]">
            Changes detected near incident start times
          </p>
        </div>
        {deployments.length ? (
          <div className="divide-y divide-[#232936]">
            {deployments.map((deployment, index) => (
              <div
                key={`${deployment.timestamp}-${index}`}
                className="grid gap-3 p-5 md:grid-cols-[120px_1fr_160px]"
              >
                <span className="text-xs text-[#8B95A7]">
                  {dateTime(deployment.timestamp)} UTC
                </span>
                <span>
                  <span className="block text-sm">{deployment.title}</span>
                  <span className="mt-1 block text-xs text-[#626C7D]">
                    {deployment.detail}
                  </span>
                </span>
                <span className="text-xs text-[#FF9F43]">
                  Linked to #{deployment.incident.id}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-10 text-center text-sm text-[#8B95A7]">
            No deployment events were found in this dataset.
          </div>
        )}
      </section>
    );

  return (
    <section className={panel}>
      <div className="border-b border-[#232936] p-5">
        <h2 className="font-semibold">Workspace settings</h2>
        <p className="mt-1 text-sm text-[#8B95A7]">
          Account, storage and analysis configuration
        </p>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-2">
        {[
          ['Workspace', workspace?.team.name ?? 'Local workspace'],
          ['Signed in as', workspace?.user.email ?? 'Local analyzer'],
          ['Current source', filename],
          ['Privacy', 'PII redaction enabled'],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-[#232936] bg-[#0D1017] p-4"
          >
            <p className="text-xs text-[#626C7D]">{label}</p>
            <p className="mt-2 text-sm text-[#D9DEEA]">{value}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-3 border-t border-[#232936] p-5">
        <Link
          href="/account"
          className="rounded-lg bg-[#7C6CFF] px-4 py-2 text-xs font-semibold"
        >
          Manage account
        </Link>
        <button
          onClick={onUpload}
          className="rounded-lg border border-[#2D3442] px-4 py-2 text-xs text-[#D9DEEA]"
        >
          Change data source
        </button>
      </div>
    </section>
  );
}

function OperationsConsole({
  view,
  workspace,
  health,
  busy,
  inviteEmail,
  setInviteEmail,
  comment,
  setComment,
  historyIncidentId,
  setHistoryIncidentId,
  action,
}: {
  view: Exclude<WorkspaceView, 'incidents'>;
  workspace: Workspace | null;
  health: { status: string; latencyMs?: number } | null;
  busy: boolean;
  inviteEmail: string;
  setInviteEmail: (value: string) => void;
  comment: string;
  setComment: (value: string) => void;
  historyIncidentId: string;
  setHistoryIncidentId: (value: string) => void;
  action: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [aiResult, setAiResult] = useState('');
  const selectedHistory = workspace?.incidents.find(
    (incident) => String(incident.id) === historyIncidentId,
  );
  const connectorTypes = [
    ['docker', 'Docker', 'Collector-ready container log endpoint'],
    ['kubernetes', 'Kubernetes', 'Cluster event and pod log ingestion'],
    ['cloudwatch', 'CloudWatch', 'AWS log subscription destination'],
    ['sentry', 'Sentry', 'Issue webhook and event correlation'],
    ['datadog', 'Datadog', 'Monitor and log webhook intake'],
    ['webhook', 'Generic webhook', 'Token-protected JSON log endpoint'],
    ['slack', 'Slack alerts', 'Incident notifications through webhook'],
    ['email', 'Email alerts', 'Provider-ready notification channel'],
    ['openai', 'OpenAI RCA', 'LLM-assisted root-cause investigation'],
  ];

  if (!workspace)
    return (
      <section className="grid min-h-72 place-items-center border border-[#232936] bg-[#11151D] p-10 text-center">
        <div>
          <LoaderCircle
            className="mx-auto mb-3 animate-spin text-[#7C6CFF]"
            size={22}
          />
          <p className="text-sm text-white">
            Connecting authenticated workspace
          </p>
          <p className="mt-1 text-xs text-[#8B95A7]">
            The local analyzer remains available while services initialize.
          </p>
        </div>
      </section>
    );

  if (view === 'clients') return <AdminClientsPanel />;

  if (view === 'history')
    return (
      <section className="grid min-h-[620px] border border-[#232936] bg-[#11151D] xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,.7fr)]">
        <div className="border-b border-[#232936] xl:border-b-0 xl:border-r">
          <div className="flex items-center justify-between border-b border-[#232936] p-4">
            <div>
              <p className="text-xs text-[#7C6CFF]">
                PERSISTENT INCIDENT HISTORY
              </p>
              <p className="mt-1 text-xs text-[#8B95A7]">
                {workspace.ingestionCount} saved ingestion runs · refreshes
                every 15 seconds
              </p>
            </div>
            <History size={18} className="text-[#8B95A7]" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-[#0D1017] text-xs text-[#8B95A7]">
                <tr>
                  <th className="p-3">INCIDENT</th>
                  <th>SERVICE</th>
                  <th>SEVERITY</th>
                  <th>STATUS</th>
                  <th>ASSIGNEE</th>
                  <th>UPDATED</th>
                </tr>
              </thead>
              <tbody>
                {workspace.incidents.map((incident) => (
                  <tr
                    key={String(incident.id)}
                    onClick={() => setHistoryIncidentId(String(incident.id))}
                    className={`cursor-pointer border-t border-[#202633] ${historyIncidentId === String(incident.id) ? 'bg-[#1C2130]' : 'hover:bg-[#171C26]'}`}
                  >
                    <td className="p-3 text-white">{String(incident.title)}</td>
                    <td className="text-[#9D91FF]">
                      {String(incident.service)}
                    </td>
                    <td className="text-[#FF6B79]">
                      {String(incident.severity).toUpperCase()}
                    </td>
                    <td>{String(incident.status)}</td>
                    <td>{String(incident.assignee_name ?? 'Unassigned')}</td>
                    <td className="text-[#8B95A7]">
                      {dateTime(String(incident.updated_at))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!workspace.incidents.length && (
              <p className="p-10 text-center text-xs text-[#8B95A7]">
                Upload a log file to create durable incident history.
              </p>
            )}
          </div>
        </div>
        <div className="p-4 lg:p-5">
          <p className="text-xs text-[#8B95A7]">INCIDENT COLLABORATION</p>
          {selectedHistory ? (
            <>
              <h2 className="mt-2 text-lg font-semibold text-white">
                {String(selectedHistory.title)}
              </h2>
              <p className="mt-1 text-xs text-[#8B95A7]">
                #{String(selectedHistory.id)} ·{' '}
                {String(selectedHistory.fingerprint)}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  disabled={busy}
                  onClick={() =>
                    void action({
                      action: 'update_incident',
                      incidentId: selectedHistory.id,
                      status: 'investigating',
                      assignedTo: workspace.user.id,
                    })
                  }
                  className="border border-[#9D91FF] p-2 text-xs font-bold text-[#9D91FF] disabled:opacity-50"
                >
                  ASSIGN TO ME
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action({
                      action: 'update_incident',
                      incidentId: selectedHistory.id,
                      status: 'resolved',
                    })
                  }
                  className="border border-[#7C6CFF] p-2 text-xs font-bold text-[#7C6CFF] disabled:opacity-50"
                >
                  RESOLVE
                </button>
              </div>
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (
                    await action({
                      action: 'comment',
                      incidentId: selectedHistory.id,
                      comment,
                    })
                  )
                    setComment('');
                }}
                className="mt-5"
              >
                <label
                  htmlFor="incident-comment"
                  className="text-xs text-[#8B95A7]"
                >
                  ADD INVESTIGATION NOTE
                </label>
                <textarea
                  id="incident-comment"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  required
                  maxLength={2000}
                  className="mt-2 h-24 w-full resize-none border border-[#2D3442] bg-[#0D1017] p-3 text-xs text-white outline-none focus:border-[#7C6CFF]"
                  placeholder="What did you find?"
                />
                <button
                  disabled={busy}
                  className="mt-2 flex h-9 items-center gap-2 bg-[#7C6CFF] px-4 text-xs font-bold text-black disabled:opacity-50"
                >
                  <Send size={12} />
                  POST NOTE
                </button>
              </form>
              <div className="mt-5 border-t border-[#232936] pt-4">
                <p className="text-xs text-[#8B95A7]">RECENT NOTES</p>
                {workspace.comments
                  .filter(
                    (item) =>
                      String(item.incident_id) === String(selectedHistory.id),
                  )
                  .slice(0, 5)
                  .map((item) => (
                    <div
                      key={String(item.id)}
                      className="mt-2 border-l-2 border-[#353D4D] bg-[#171C26] p-3"
                    >
                      <p className="text-xs text-[#c0c0c0]">
                        {String(item.body)}
                      </p>
                      <p className="mt-2 text-xs text-[#626C7D]">
                        {String(item.user_name ?? item.user_email)} ·{' '}
                        {dateTime(String(item.created_at))}
                      </p>
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <p className="mt-5 text-xs text-[#8B95A7]">
              Select an incident to collaborate.
            </p>
          )}
        </div>
      </section>
    );

  if (view === 'team')
    return (
      <section className="grid gap-4 lg:grid-cols-2">
        <article className="border border-[#232936] bg-[#11151D]">
          <div className="border-b border-[#232936] p-4">
            <p className="text-xs text-[#7C6CFF]">TEAM MEMBERS</p>
            <h2 className="mt-1 text-lg text-white">{workspace.team.name}</h2>
          </div>
          <div>
            {workspace.members.map((member) => (
              <div
                key={String(member.id)}
                className="flex items-center border-b border-[#202633] p-4"
              >
                <span className="grid size-9 place-items-center bg-[#262626] font-bold text-[#7C6CFF]">
                  {String(member.name).slice(0, 2).toUpperCase()}
                </span>
                <span className="ml-3">
                  <strong className="block text-xs text-white">
                    {String(member.name)}
                  </strong>
                  <span className="text-xs text-[#8B95A7]">
                    {String(member.email)}
                  </span>
                </span>
                <span className="ml-auto border border-[#353D4D] px-2 py-1 text-xs text-[#c0c0c0]">
                  {String(member.role).toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </article>
        <article className="border border-[#232936] bg-[#11151D] p-5">
          <p className="text-xs text-[#7C6CFF]">INVITE COLLABORATOR</p>
          <p className="mt-2 text-xs leading-relaxed text-[#8B95A7]">
            Create a tracked team invitation. Delivery is ready for an email
            provider secret.
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                await action({
                  action: 'invite',
                  email: inviteEmail,
                  role: 'member',
                })
              )
                setInviteEmail('');
            }}
            className="mt-5 flex"
          >
            <input
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              type="email"
              required
              placeholder="engineer@company.com"
              className="min-w-0 flex-1 border border-[#2D3442] bg-[#0D1017] px-3 text-xs text-white outline-none focus:border-[#7C6CFF]"
            />
            <button
              disabled={busy}
              className="bg-[#7C6CFF] px-4 py-3 text-xs font-bold text-black"
            >
              INVITE
            </button>
          </form>
          <div className="mt-5">
            <p className="text-xs text-[#8B95A7]">PENDING INVITES</p>
            {workspace.invites.map((invite) => (
              <div
                key={String(invite.id)}
                className="mt-2 flex border border-[#232936] p-3 text-xs"
              >
                <span className="text-white">{String(invite.email)}</span>
                <span className="ml-auto text-[#FF9F43]">
                  {String(invite.status)}
                </span>
              </div>
            ))}
          </div>
        </article>
      </section>
    );

  if (view === 'integrations')
    return (
      <section>
        <div className="mb-4 border border-[#232936] bg-[#11151D] p-4">
          <p className="text-xs text-[#7C6CFF]">
            INGEST + INVESTIGATE + NOTIFY
          </p>
          <p className="mt-1 text-xs text-[#8B95A7]">
            Configure the integration record here, then add its secret in the
            deployment environment. Secrets are never collected in this browser.
          </p>
        </div>
        <div className="grid gap-px bg-[#232936] border border-[#232936] md:grid-cols-2 xl:grid-cols-3">
          {connectorTypes.map(([type, name, description]) => {
            const connector = workspace.connectors.find(
              (item) => item.type === type,
            );
            const configured =
              type === 'openai'
                ? workspace.capabilities.openai
                : type === 'slack'
                  ? workspace.capabilities.slack
                  : type === 'email'
                    ? workspace.capabilities.email
                    : type === 'webhook'
                      ? workspace.capabilities.externalIngestion
                      : false;
            return (
              <article key={type} className="bg-[#11151D] p-5">
                <div className="flex items-start justify-between">
                  <Plug size={18} className="text-[#9D91FF]" />
                  <span
                    className={`text-xs ${configured ? 'text-[#7C6CFF]' : connector ? 'text-[#FF9F43]' : 'text-[#8B95A7]'}`}
                  >
                    {configured
                      ? 'ACTIVE'
                      : connector
                        ? String(connector.status).toUpperCase()
                        : 'NOT SET'}
                  </span>
                </div>
                <h3 className="mt-4 text-sm font-semibold text-white">
                  {name}
                </h3>
                <p className="mt-1 min-h-8 text-xs leading-relaxed text-[#8B95A7]">
                  {description}
                </p>
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (type === 'slack' && configured) {
                      await action({ action: 'test_slack' });
                      return;
                    }
                    if (type === 'email' && configured) {
                      await action({ action: 'test_email' });
                      return;
                    }
                    if (type === 'openai' && configured && selectedHistory) {
                      const response = await fetch('/api/workspace', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'ai_analysis',
                          incident: selectedHistory,
                        }),
                      });
                      const result = (await response.json()) as {
                        analysis?: string;
                        error?: string;
                      };
                      setAiResult(
                        result.analysis ?? result.error ?? 'No result',
                      );
                      return;
                    }
                    await action({ action: 'connector', type, name });
                  }}
                  className="mt-4 w-full border border-[#353D4D] py-2 text-xs font-bold text-[#D9DEEA] hover:border-[#7C6CFF] hover:text-[#7C6CFF] disabled:opacity-50"
                >
                  {(type === 'slack' || type === 'email') && configured
                    ? 'SEND TEST ALERT'
                    : type === 'openai' && configured
                      ? 'RUN RCA ON LATEST'
                      : connector
                        ? 'UPDATE CONFIGURATION'
                        : 'PREPARE CONNECTOR'}
                </button>
              </article>
            );
          })}
        </div>
        {aiResult && (
          <div className="mt-4 border border-[#9D91FF] bg-[#0D1017] p-4">
            <p className="text-xs text-[#9D91FF]">OPENAI ROOT-CAUSE RESULT</p>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-[#D9DEEA]">
              {aiResult}
            </p>
          </div>
        )}
      </section>
    );

  return (
    <div className="space-y-6">
      <UptimePanel />
      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <article className="border border-[#232936] bg-[#11151D] p-5">
          <p className="text-xs text-[#7C6CFF]">PLATFORM HEALTH</p>
          <div className="mt-5 grid grid-cols-2 gap-px bg-[#232936] border border-[#232936]">
            {[
              ['API', health?.status === 'healthy'],
              ['DATABASE', workspace.capabilities.database],
              ['OBJECT STORAGE', workspace.capabilities.objectStorage],
              ['PII REDACTION', workspace.capabilities.piiRedaction],
              ['OPENAI RCA', workspace.capabilities.openai],
              ['SLACK ALERTS', workspace.capabilities.slack],
              ['EMAIL ALERTS', workspace.capabilities.email],
              ['WEBHOOK INGEST', workspace.capabilities.externalIngestion],
              ['LIVE REFRESH', true],
            ].map(([label, ready]) => (
              <div
                key={String(label)}
                className="flex items-center bg-[#171C26] p-3"
              >
                <span
                  className={`mr-2 size-2 ${ready ? 'bg-[#7C6CFF]' : 'bg-[#FF9F43]'}`}
                />
                <span className="text-xs text-[#c0c0c0]">{String(label)}</span>
                <span className="ml-auto text-xs text-[#8B95A7]">
                  {ready ? 'READY' : 'NEEDS SECRET'}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-[#8B95A7]">
            HEALTH LATENCY: {health?.latencyMs ?? '—'} MS · AUTO REFRESH: 15 SEC
          </p>
        </article>
        <article className="border border-[#232936] bg-[#11151D]">
          <div className="border-b border-[#232936] p-5">
            <p className="text-xs text-[#7C6CFF]">SECURITY AUDIT TRAIL</p>
          </div>
          <div className="max-h-[430px] overflow-auto">
            {workspace.auditEvents.map((event, index) => (
              <div
                key={`${event.target_id}-${index}`}
                className="border-b border-[#202633] p-4"
              >
                <div className="flex">
                  <span className="text-xs text-[#9D91FF]">
                    {String(event.action).toUpperCase()}
                  </span>
                  <span className="ml-auto text-xs text-[#626C7D]">
                    {dateTime(String(event.created_at))}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#8B95A7]">
                  {String(event.target_type)} / {String(event.target_id)}
                </p>
              </div>
            ))}
            {!workspace.auditEvents.length && (
              <p className="p-10 text-center text-xs text-[#8B95A7]">
                Audit events appear after uploads and team actions.
              </p>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
