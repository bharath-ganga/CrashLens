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
  Braces,
  CheckCircle2,
  ChevronRight,
  CircleCheck,
  Clipboard,
  Clock3,
  Crosshair,
  Database,
  Download,
  FileCode2,
  FileText,
  Filter,
  ListTree,
  HeartPulse,
  History,
  LoaderCircle,
  Menu,
  Plug,
  Radio,
  Search,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  X,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
  | 'incidents'
  | 'history'
  | 'team'
  | 'integrations'
  | 'monitoring'
  | 'clients';

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

const severityStyles = {
  critical: 'border-[#ff4d4d] bg-[#2a1012] text-[#ff7777]',
  warning: 'border-[#e5a50a] bg-[#241b08] text-[#ffc247]',
  info: 'border-[#e5e5e5] bg-[#151515] text-[#e5e5e5]',
};

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
  const [workspaceMessage, setWorkspaceMessage] = useState(
    'Connecting secure workspace…',
  );
  const [health, setHealth] = useState<{
    status: string;
    latencyMs?: number;
  } | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [comment, setComment] = useState('');
  const [historyIncidentId, setHistoryIncidentId] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const selected =
    incidents.find((incident) => incident.id === selectedId) ?? incidents[0];
  const filteredIncidents = useMemo(
    () =>
      incidents.filter((incident) =>
        `${incident.title} ${incident.service} ${incident.trigger}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [incidents, query],
  );
  const serviceCount = new Set(logs.map((log) => log.service)).size;
  const errorCount = logs.filter(
    (log) => log.level === 'error' || log.level === 'fatal',
  ).length;
  const dataQuality = Math.round(
    (logs.filter((log) => log.service !== 'unknown-service').length /
      Math.max(1, logs.length)) *
      100,
  );
  const signalBars = useMemo(() => {
    const buckets = new Map<string, number>();
    logs.forEach((log) => {
      const key = log.timestamp.slice(11, 16);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    });
    const values = [...buckets.entries()].slice(-18);
    const maximum = Math.max(1, ...values.map(([, count]) => count));
    return values.map(([label, count]) => ({
      label,
      count,
      height: Math.max(12, Math.round((count / maximum) * 100)),
    }));
  }, [logs]);
  const metrics: Array<{
    label: string;
    value: string | number;
    note: string;
    icon: LucideIcon;
  }> = [
    {
      label: 'INCIDENTS',
      value: incidents.length,
      note: `${incidents.filter((item) => item.severity === 'critical').length} critical`,
      icon: AlertTriangle,
    },
    {
      label: 'LOGS PARSED',
      value: logs.length,
      note: `${errorCount} errors`,
      icon: FileCode2,
    },
    {
      label: 'SERVICES',
      value: serviceCount,
      note: 'detected automatically',
      icon: Server,
    },
    {
      label: 'TIME WINDOW',
      value: logs.length
        ? `${Math.max(1, Math.round((Date.parse(logs.at(-1)!.timestamp) - Date.parse(logs[0].timestamp)) / 60000))}m`
        : '0m',
      note: 'UTC normalized',
      icon: Clock3,
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
    <main className="min-h-screen bg-[#090909] text-[#f2f2f2]">
      <header className="sticky top-0 z-50 flex h-16 items-center border-b-2 border-[#f5f5f5] bg-[#0b0b0b] px-4 lg:px-6">
        <button
          aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
          onClick={() => setMobileNavOpen((open) => !open)}
          className="mr-3 grid size-9 place-items-center border border-[#3f3f3f] bg-[#151515] text-[#f5f5f5] lg:hidden"
        >
          {mobileNavOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center bg-[#f5f5f5] text-[#0b0b0b]">
            <Activity size={19} strokeWidth={3} />
          </span>
          <span className="text-base font-black tracking-[-0.04em] text-white">
            CRASHLENS
          </span>
          <span className="border border-[#6b6b6b] bg-[#151515] px-2 py-1 text-sm font-bold text-[#f5f5f5]">
            PROD / 05
          </span>
        </div>
        <div className="ml-8 hidden h-full items-center border-x border-[#383838] px-5 text-xs text-[#cccccc] md:flex">
          <span className="mr-2 size-2 bg-[#f5f5f5]" /> System operational
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-[#999999]">
          <span className="hidden border border-[#464646] bg-[#151515] px-2 py-1 sm:inline">
            {workspaceBusy
              ? 'SYNCING'
              : workspace
                ? 'D1 + R2 CONNECTED'
                : 'LOCAL FALLBACK'}
          </span>
          <span className="h-4 w-px bg-[#383838]" />
          <Link
            href="/account"
            className="border border-[#3f3f3f] px-3 py-2 text-sm text-[#d4d4d4]"
          >
            Account
          </Link>
        </div>
      </header>

      {mobileNavOpen && (
        <button
          aria-label="Close navigation overlay"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 top-16 z-30 bg-[#090909] lg:hidden"
        />
      )}
      <div className="flex min-h-[calc(100vh-64px)]">
        <aside
          className={`${mobileNavOpen ? 'fixed inset-y-16 left-0 z-40 flex' : 'hidden'} w-64 shrink-0 flex-col border-r-2 border-[#383838] bg-[#0d0d0d] p-3 lg:static lg:flex`}
        >
          <p className="px-3 pb-3 pt-4 text-xs font-bold tracking-[0.18em] text-[#999999]">
            CONTROL PLANE
          </p>
          <nav className="space-y-1">
            {(
              [
                ['incidents', AlertTriangle, 'Incidents'],
                ['history', History, 'History'],
                ['team', Users, 'Team'],
                ['integrations', Plug, 'Integrations'],
                ['monitoring', HeartPulse, 'Monitoring'],
                ...(workspace?.capabilities.platformAdmin
                  ? ([['clients', Users, 'Clients']] as const)
                  : []),
              ] as Array<[WorkspaceView, LucideIcon, string]>
            ).map(([key, Icon, label], index) => (
              <button
                key={key}
                onClick={() => {
                  setView(key);
                  setMobileNavOpen(false);
                }}
                className={`flex h-11 w-full items-center gap-3 border px-3 text-sm font-semibold ${view === key ? 'border-[#f5f5f5] bg-[#f5f5f5] text-[#0b0b0b]' : 'border-transparent text-[#aaaaaa] hover:border-[#3f3f3f] hover:bg-[#181818] hover:text-white'}`}
              >
                <span className="text-sm opacity-60">0{index + 1}</span>
                <Icon size={15} />
                {label}
                {key === 'incidents' && (
                  <span
                    className={`ml-auto px-1.5 py-0.5 text-xs font-black ${view === key ? 'bg-[#0b0b0b] text-[#f5f5f5]' : 'bg-[#343434] text-white'}`}
                  >
                    {incidents.length}
                  </span>
                )}
              </button>
            ))}
            <button
              onClick={() => {
                setUploadOpen(true);
                setMobileNavOpen(false);
              }}
              className="mt-3 flex h-11 w-full items-center gap-3 border border-[#d4d4d4] bg-[#101010] px-3 text-sm font-bold text-[#d4d4d4] hover:bg-[#d4d4d4] hover:text-[#050505]"
            >
              <Database size={15} />
              Upload source
            </button>
          </nav>
          <p className="px-3 pb-2 pt-8 text-xs font-bold text-[#999999]">
            CURRENT SOURCE
          </p>
          <div className="border border-[#3f3f3f] bg-[#151515] p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-[#f5f5f5]">
              <CheckCircle2 size={14} />
              PARSED
            </div>
            <p className="truncate text-sm text-[#ededed]" title={filename}>
              {filename}
            </p>
            <p className="mt-2 text-sm text-[#999999]">
              {logs.length} ROWS / {fileSize}
            </p>
          </div>
          <div className="mt-auto border-t border-[#383838] pt-3">
            <div className="flex items-center gap-2 px-2 text-xs text-[#aaaaaa]">
              <ShieldCheck size={14} className="text-[#d4d4d4]" />
              PII REDACTION / ACTIVE
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <section className="border-b-2 border-[#383838] bg-[#101010] px-4 py-6 lg:px-8">
            <div className="mx-auto flex max-w-[1500px] flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-bold text-[#999999]">
                  <span>OPS</span>
                  <ChevronRight size={12} />
                  <span>{view.toUpperCase()}</span>
                  <ChevronRight size={12} />
                  <span className="text-[#f5f5f5]">
                    {workspaceMessage.toUpperCase()}
                  </span>
                </div>
                <h1 className="text-2xl font-black tracking-[-0.045em] text-white lg:text-[32px]">
                  {view === 'incidents'
                    ? 'Incidents'
                    : `${view[0].toUpperCase()}${view.slice(1)} control plane`}
                </h1>
                <p className="mt-2 text-sm text-[#adadad]">
                  Authenticated incident operations with durable storage, audit
                  history, integrations, and alert readiness.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href="/samples/crashlens-sample.jsonl"
                  download
                  className="flex h-11 items-center gap-2 border border-[#6b6b6b] bg-[#151515] px-4 text-xs font-bold text-[#e3e3e3] hover:border-white hover:text-white"
                >
                  <Download size={15} />
                  SAMPLE JSONL
                </a>
                <button
                  onClick={() => setUploadOpen(true)}
                  className="flex h-11 items-center gap-2 border border-[#f5f5f5] bg-[#f5f5f5] px-5 text-xs font-black text-[#0b0b0b] hover:bg-white"
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
                className="mb-4 flex items-start gap-3 border border-[#a53d3d] bg-[#200d0f] p-3 text-xs text-[#ff8585]"
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
                <section className="mb-4 grid grid-cols-2 border-l-2 border-t-2 border-[#3f3f3f] xl:grid-cols-4">
                  {metrics.map(({ label, value, note, icon: Icon }) => (
                    <article
                      key={label}
                      className="border-b border-r border-[#383838] bg-[#1a1a1a] p-4"
                    >
                      <div className="flex items-center justify-between text-sm font-bold text-[#aaaaaa]">
                        <span>{label}</span>
                        <Icon size={15} />
                      </div>
                      <div className="mt-3 text-3xl font-black tracking-[-0.04em] text-white">
                        {value}
                      </div>
                      <p className="mt-1 text-xs text-[#999999]">{note}</p>
                    </article>
                  ))}
                </section>

                <section className="mb-4 grid border border-[#414141] bg-[#111111] lg:grid-cols-[1fr_280px]">
                  <div className="border-b border-[#414141] p-4 lg:border-b-0 lg:border-r">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-[#b0b0b0]">
                        <Radio size={12} className="text-[#d4d4d4]" />
                        INGESTED SIGNAL VOLUME
                      </div>
                      <div className="text-xs text-[#737373]">
                        {signalBars.length} TIME BUCKETS
                      </div>
                    </div>
                    <div className="flex h-20 items-end gap-1 border-b border-[#414141]">
                      {signalBars.map((bar, index) => (
                        <div
                          key={`${bar.label}-${index}`}
                          className="group relative flex min-w-2 flex-1 items-end"
                          title={`${bar.label} · ${bar.count} events`}
                        >
                          <span
                            className={`block w-full ${bar.count >= 3 ? 'bg-[#ff4d4d]' : index === signalBars.length - 1 ? 'bg-[#f5f5f5]' : 'bg-[#4f4f4f]'}`}
                            style={{ height: `${bar.height}%` }}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex justify-between text-xs text-[#737373]">
                      <span>{signalBars[0]?.label ?? '--:--'} UTC</span>
                      <span>{signalBars.at(-1)?.label ?? '--:--'} UTC</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-1">
                    <div className="border-r border-[#414141] p-4 lg:border-b lg:border-r-0">
                      <p className="text-xs text-[#8f8f8f]">DATA QUALITY</p>
                      <div className="mt-2 flex items-end justify-between">
                        <strong className="text-2xl text-[#d4d4d4]">
                          {dataQuality}%
                        </strong>
                        <span className="text-xs text-[#919191]">
                          SCHEMA MATCH
                        </span>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-xs text-[#8f8f8f]">PRIVACY MODE</p>
                      <div className="mt-2 flex items-center gap-2 text-sm text-[#f5f5f5]">
                        <ShieldCheck size={14} />
                        Redaction enabled
                      </div>
                    </div>
                  </div>
                </section>

                <section
                  id="incidents"
                  className="grid min-h-[610px] border border-[#383838] bg-[#161616] xl:grid-cols-[430px_minmax(0,1fr)]"
                >
                  <div className="border-b border-[#383838] xl:border-b-0 xl:border-r">
                    <div className="border-b border-[#383838] p-3">
                      <label className="flex h-11 items-center gap-2 border border-[#3f3f3f] bg-[#111111] px-3 text-[#aaaaaa] focus-within:border-[#f5f5f5]">
                        <Search size={15} />
                        <input
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder="Filter incidents or services"
                          className="w-full bg-[#111111] text-sm text-white outline-none placeholder:text-[#7a7a7a]"
                        />
                        <Filter size={14} />
                      </label>
                    </div>
                    <div className="flex items-center justify-between border-b border-[#383838] px-4 py-3 text-xs text-[#8f8f8f]">
                      <span>GROUPED INCIDENTS</span>
                      <span>{filteredIncidents.length} RESULTS</span>
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
                            className={`grid w-full grid-cols-[4px_1fr_auto] gap-3 border-b border-[#303030] px-3 py-4 text-left ${selected?.id === incident.id ? 'bg-[#232323]' : 'bg-[#161616] hover:bg-[#1e1e1e]'}`}
                          >
                            <span
                              className={
                                incident.severity === 'critical'
                                  ? 'bg-[#ff4d4d]'
                                  : incident.severity === 'warning'
                                    ? 'bg-[#e5a50a]'
                                    : 'bg-[#e5e5e5]'
                              }
                            />
                            <span className="min-w-0">
                              <span className="flex items-center gap-2">
                                <span className="truncate text-[13px] font-medium text-[#f3f3f3]">
                                  {incident.title}
                                </span>
                                <span className="text-xs text-[#737373]">
                                  #{incident.id}
                                </span>
                              </span>
                              <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#919191]">
                                <span>{incident.service}</span>
                                <span>{incident.logs.length} LOGS</span>
                                <span>{time(incident.started)}</span>
                              </span>
                            </span>
                            <span className="text-right">
                              <span
                                className={`inline-block border px-1.5 py-0.5 text-xs ${severityStyles[incident.severity]}`}
                              >
                                {resolved.includes(incident.id)
                                  ? 'RESOLVED'
                                  : incident.severity.toUpperCase()}
                              </span>
                              <span className="mt-2 block text-xs text-[#ff7777]">
                                {incident.change}
                              </span>
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="p-8 text-center text-xs text-[#8f8f8f]">
                          No incidents match this filter.
                        </div>
                      )}
                    </div>
                  </div>

                  {selected ? (
                    <div className="min-w-0">
                      <div className="border-b border-[#383838] p-4 lg:p-5">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="mb-2 flex items-center gap-2 text-xs text-[#999999]">
                              <span
                                className={`size-1.5 ${selected.severity === 'critical' ? 'bg-[#ff4d4d]' : 'bg-[#e5a50a]'}`}
                              />
                              INCIDENT #{selected.id} /{' '}
                              {resolved.includes(selected.id)
                                ? 'RESOLVED'
                                : selected.status.toUpperCase()}
                            </div>
                            <h2 className="text-xl font-semibold tracking-[-0.03em] text-white">
                              {selected.title}
                            </h2>
                            <p className="mt-1 text-xs text-[#929292]">
                              {selected.service} · {selected.logs.length}{' '}
                              correlated events · {dateTime(selected.started)}{' '}
                              UTC
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => {
                                void navigator.clipboard.writeText(
                                  selected.fingerprint,
                                );
                                setCopied(true);
                                window.setTimeout(() => setCopied(false), 1600);
                              }}
                              className="flex h-8 items-center gap-2 border border-[#4c4c4c] bg-[#202020] px-3 text-xs text-[#c7c7c7] hover:text-white"
                            >
                              <Clipboard size={12} />
                              {copied ? 'COPIED' : 'FINGERPRINT'}
                            </button>
                            <button
                              onClick={() =>
                                downloadText(
                                  buildReport(selected, filename),
                                  `incident-${selected.id}-report.txt`,
                                )
                              }
                              className="flex h-8 items-center gap-2 border border-[#4c4c4c] bg-[#202020] px-3 text-xs text-[#c7c7c7] hover:text-white"
                            >
                              <ArrowDownToLine size={12} />
                              EXPORT
                            </button>
                            <button
                              onClick={() =>
                                setResolved((items) =>
                                  items.includes(selected.id)
                                    ? items.filter((id) => id !== selected.id)
                                    : [...items, selected.id],
                                )
                              }
                              className="h-8 border border-[#f5f5f5] px-3 text-xs font-bold text-[#f5f5f5] hover:bg-[#f5f5f5] hover:text-black"
                            >
                              {resolved.includes(selected.id)
                                ? 'REOPEN'
                                : 'RESOLVE'}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid border-b border-[#383838] md:grid-cols-[minmax(0,1fr)_180px]">
                        <div className="border-b border-[#383838] bg-[#1e1e1e] p-4 md:border-b-0 md:border-r lg:p-5">
                          <div className="flex items-center gap-2 text-xs text-[#f5f5f5]">
                            <Sparkles size={13} />
                            CORRELATION RESULT
                          </div>
                          <p className="mt-3 text-sm font-medium text-white">
                            Likely trigger: {selected.trigger}
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-[#a0a0a0]">
                            The earliest matching failures appeared in{' '}
                            <span className="text-[#d6d6d6]">
                              {selected.service}
                            </span>
                            . CrashLens linked events using service identity,
                            normalized error text, timestamps, and nearby
                            deployment signals.
                          </p>
                        </div>
                        <div className="flex items-center justify-between bg-[#1b1b1b] p-4 md:block lg:p-5">
                          <div>
                            <p className="text-xs text-[#8a8a8a]">CONFIDENCE</p>
                            <p className="mt-2 text-3xl font-semibold text-[#f5f5f5]">
                              {selected.confidence}%
                            </p>
                          </div>
                          <div className="mt-3 h-1.5 w-full bg-[#383838]">
                            <div
                              className="h-full bg-[#f5f5f5]"
                              style={{ width: `${selected.confidence}%` }}
                            />
                          </div>
                          <p className="mt-2 text-xs text-[#777777]">
                            FINGERPRINT MATCH
                          </p>
                        </div>
                      </div>

                      <div className="flex h-11 border-b border-[#383838] bg-[#151515] px-4">
                        <button
                          onClick={() => setTab('analysis')}
                          className={`mr-6 border-b-2 px-1 text-xs font-bold ${tab === 'analysis' ? 'border-[#f5f5f5] text-[#f5f5f5]' : 'border-transparent text-[#8f8f8f]'}`}
                        >
                          AI ANALYSIS
                        </button>
                        <button
                          onClick={() => setTab('timeline')}
                          className={`mr-6 border-b-2 px-1 text-xs font-bold ${tab === 'timeline' ? 'border-[#f5f5f5] text-[#f5f5f5]' : 'border-transparent text-[#8f8f8f]'}`}
                        >
                          TIMELINE
                        </button>
                        <button
                          onClick={() => setTab('logs')}
                          className={`border-b-2 px-1 text-xs font-bold ${tab === 'logs' ? 'border-[#f5f5f5] text-[#f5f5f5]' : 'border-transparent text-[#8f8f8f]'}`}
                        >
                          LOGS ({selected.logs.length})
                        </button>
                      </div>

                      <div
                        className="max-h-[315px] overflow-auto p-4 lg:p-5"
                        id="raw-logs"
                      >
                        {tab === 'analysis' ? (
                          <div className="grid gap-3 md:grid-cols-3">
                            <div className="border border-[#414141] bg-[#1b1b1b] p-4">
                              <div className="mb-3 flex items-center gap-2 text-xs text-[#d4d4d4]">
                                <Crosshair size={12} />
                                01 / ORIGIN
                              </div>
                              <p className="text-sm leading-relaxed text-[#dadada]">
                                First failures originated in{' '}
                                <strong className="font-medium text-white">
                                  {selected.service}
                                </strong>{' '}
                                at {time(selected.started)} UTC.
                              </p>
                            </div>
                            <div className="border border-[#414141] bg-[#1b1b1b] p-4">
                              <div className="mb-3 flex items-center gap-2 text-xs text-[#e5a50a]">
                                <Zap size={12} />
                                02 / TRIGGER
                              </div>
                              <p className="text-sm leading-relaxed text-[#dadada]">
                                Nearest correlated operational change:{' '}
                                <strong className="font-medium text-white">
                                  {selected.trigger}
                                </strong>
                                .
                              </p>
                            </div>
                            <div className="border border-[#414141] bg-[#1b1b1b] p-4">
                              <div className="mb-3 flex items-center gap-2 text-xs text-[#f5f5f5]">
                                <CircleCheck size={12} />
                                03 / NEXT ACTION
                              </div>
                              <p className="text-sm leading-relaxed text-[#dadada]">
                                Check the deployment diff and service
                                dependencies, then rollback if the error rate
                                continues rising.
                              </p>
                            </div>
                            <div className="border border-[#414141] bg-[#111111] p-4 md:col-span-3">
                              <p className="text-xs text-[#8f8f8f]">
                                CAUSAL CHAIN
                              </p>
                              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                                <span className="border border-[#757575] px-2 py-1.5 text-[#cecece]">
                                  {selected.trigger}
                                </span>
                                <ChevronRight
                                  size={12}
                                  className="text-[#777777]"
                                />
                                <span className="border border-[#d4d4d4] px-2 py-1.5 text-[#d4d4d4]">
                                  {selected.service}
                                </span>
                                <ChevronRight
                                  size={12}
                                  className="text-[#777777]"
                                />
                                <span className="border border-[#ff4d4d] px-2 py-1.5 text-[#ff7777]">
                                  {selected.title}
                                </span>
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
                                <span className="pt-0.5 text-xs text-[#858585]">
                                  {event.time}
                                </span>
                                <span className="relative flex justify-center">
                                  <span
                                    className={`relative z-10 mt-0.5 size-2.5 border border-[#161616] ${event.type === 'critical' ? 'bg-[#ff4d4d]' : event.type === 'deploy' ? 'bg-[#f5f5f5]' : event.type === 'alert' ? 'bg-[#e5a50a]' : 'bg-[#757575]'}`}
                                  />
                                  {index < selected.timeline.length - 1 && (
                                    <span className="absolute top-2 h-full w-px bg-[#424242]" />
                                  )}
                                </span>
                                <span className="pb-5">
                                  <span
                                    className={`block text-sm ${event.type === 'critical' ? 'text-[#ff8585]' : 'text-[#e5e5e5]'}`}
                                  >
                                    {event.title}
                                  </span>
                                  <span className="mt-0.5 block text-xs text-[#808080]">
                                    {event.detail}
                                  </span>
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="min-w-[650px] text-xs">
                            <div className="grid grid-cols-[70px_58px_130px_1fr] border-b border-[#424242] pb-2 text-[#808080]">
                              <span>TIME</span>
                              <span>LEVEL</span>
                              <span>SERVICE</span>
                              <span>MESSAGE</span>
                            </div>
                            {selected.logs.map((log) => (
                              <div
                                key={log.id}
                                className="grid grid-cols-[70px_58px_130px_1fr] border-b border-[#2a2a2a] py-2 text-[#b0b0b0]"
                              >
                                <span>{time(log.timestamp)}</span>
                                <span
                                  className={
                                    log.level === 'fatal' ||
                                    log.level === 'error'
                                      ? 'text-[#ff6b6b]'
                                      : 'text-[#e5a50a]'
                                  }
                                >
                                  {log.level.toUpperCase()}
                                </span>
                                <span className="truncate pr-3 text-[#f5f5f5]">
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
                    <div className="grid place-items-center p-10 text-xs text-[#8f8f8f]">
                      Upload a file containing errors to create an incident.
                    </div>
                  )}
                </section>
              </>
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
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#090909] p-4">
          <div className="w-full max-w-xl border-2 border-[#f5f5f5] bg-[#181818] shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#414141] p-5">
              <div>
                <p className="text-xs text-[#f5f5f5]">Log upload</p>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  Analyze a log file
                </h2>
                <p className="mt-1 text-sm text-[#999999]">
                  Analysis runs in the browser, then a redacted copy is saved to
                  your authenticated workspace.
                </p>
              </div>
              <button
                onClick={() => setUploadOpen(false)}
                className="text-[#8f8f8f] hover:text-white"
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
              className={`m-5 grid min-h-52 w-[calc(100%-2.5rem)] cursor-pointer place-items-center border border-dashed p-6 text-center ${dragging ? 'border-[#f5f5f5] bg-[#232323]' : 'border-[#5a5a5a] bg-[#131313] hover:border-[#929292]'}`}
            >
              {processing ? (
                <span>
                  <LoaderCircle
                    size={26}
                    className="mx-auto animate-spin text-[#f5f5f5]"
                  />
                  <span className="mt-3 block text-xs text-[#f5f5f5]">
                    PARSING + CLUSTERING
                  </span>
                </span>
              ) : (
                <span>
                  <Upload size={25} className="mx-auto text-[#f5f5f5]" />
                  <span className="mt-3 block text-sm font-medium text-white">
                    Drop a file here or click to browse
                  </span>
                  <span className="mt-2 block text-xs text-[#8a8a8a]">
                    TXT · LOG · CSV · JSONL · NDJSON / MAX 5 MB
                  </span>
                </span>
              )}
            </button>
            {error && (
              <p className="mx-5 mb-3 border border-[#8f3333] bg-[#210d0f] p-3 text-xs text-[#ff8585]">
                {error}
              </p>
            )}
            <div className="border-t border-[#414141] bg-[#131313] p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-[#8f8f8f]">
                  DON&apos;T HAVE LOGS?
                </span>
                <button
                  onClick={resetSample}
                  className="text-xs font-bold text-[#f5f5f5]"
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
                    className="flex items-center justify-center gap-2 border border-[#484848] bg-[#1c1c1c] py-2 text-xs text-[#b7b7b7] hover:border-[#7d7d7d] hover:text-white"
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
      <section className="grid min-h-72 place-items-center border border-[#383838] bg-[#161616] p-10 text-center">
        <div>
          <LoaderCircle
            className="mx-auto mb-3 animate-spin text-[#f5f5f5]"
            size={22}
          />
          <p className="text-sm text-white">
            Connecting authenticated workspace
          </p>
          <p className="mt-1 text-xs text-[#8f8f8f]">
            The local analyzer remains available while services initialize.
          </p>
        </div>
      </section>
    );

  if (view === 'clients') return <AdminClientsPanel />;

  if (view === 'history')
    return (
      <section className="grid min-h-[620px] border border-[#383838] bg-[#161616] xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,.7fr)]">
        <div className="border-b border-[#383838] xl:border-b-0 xl:border-r">
          <div className="flex items-center justify-between border-b border-[#383838] p-4">
            <div>
              <p className="text-xs text-[#f5f5f5]">
                PERSISTENT INCIDENT HISTORY
              </p>
              <p className="mt-1 text-xs text-[#999999]">
                {workspace.ingestionCount} saved ingestion runs · refreshes
                every 15 seconds
              </p>
            </div>
            <History size={18} className="text-[#8f8f8f]" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-[#111111] text-xs text-[#8f8f8f]">
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
                    className={`cursor-pointer border-t border-[#303030] ${historyIncidentId === String(incident.id) ? 'bg-[#232323]' : 'hover:bg-[#1e1e1e]'}`}
                  >
                    <td className="p-3 text-white">{String(incident.title)}</td>
                    <td className="text-[#d4d4d4]">
                      {String(incident.service)}
                    </td>
                    <td className="text-[#ff7777]">
                      {String(incident.severity).toUpperCase()}
                    </td>
                    <td>{String(incident.status)}</td>
                    <td>{String(incident.assignee_name ?? 'Unassigned')}</td>
                    <td className="text-[#8f8f8f]">
                      {dateTime(String(incident.updated_at))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!workspace.incidents.length && (
              <p className="p-10 text-center text-xs text-[#8f8f8f]">
                Upload a log file to create durable incident history.
              </p>
            )}
          </div>
        </div>
        <div className="p-4 lg:p-5">
          <p className="text-xs text-[#8f8f8f]">INCIDENT COLLABORATION</p>
          {selectedHistory ? (
            <>
              <h2 className="mt-2 text-lg font-semibold text-white">
                {String(selectedHistory.title)}
              </h2>
              <p className="mt-1 text-xs text-[#999999]">
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
                  className="border border-[#d4d4d4] p-2 text-xs font-bold text-[#d4d4d4] disabled:opacity-50"
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
                  className="border border-[#f5f5f5] p-2 text-xs font-bold text-[#f5f5f5] disabled:opacity-50"
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
                  className="text-xs text-[#8f8f8f]"
                >
                  ADD INVESTIGATION NOTE
                </label>
                <textarea
                  id="incident-comment"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  required
                  maxLength={2000}
                  className="mt-2 h-24 w-full resize-none border border-[#4c4c4c] bg-[#111111] p-3 text-xs text-white outline-none focus:border-[#f5f5f5]"
                  placeholder="What did you find?"
                />
                <button
                  disabled={busy}
                  className="mt-2 flex h-9 items-center gap-2 bg-[#f5f5f5] px-4 text-xs font-bold text-black disabled:opacity-50"
                >
                  <Send size={12} />
                  POST NOTE
                </button>
              </form>
              <div className="mt-5 border-t border-[#383838] pt-4">
                <p className="text-xs text-[#8f8f8f]">RECENT NOTES</p>
                {workspace.comments
                  .filter(
                    (item) =>
                      String(item.incident_id) === String(selectedHistory.id),
                  )
                  .slice(0, 5)
                  .map((item) => (
                    <div
                      key={String(item.id)}
                      className="mt-2 border-l-2 border-[#5a5a5a] bg-[#1b1b1b] p-3"
                    >
                      <p className="text-xs text-[#c0c0c0]">
                        {String(item.body)}
                      </p>
                      <p className="mt-2 text-xs text-[#777777]">
                        {String(item.user_name ?? item.user_email)} ·{' '}
                        {dateTime(String(item.created_at))}
                      </p>
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <p className="mt-5 text-xs text-[#8f8f8f]">
              Select an incident to collaborate.
            </p>
          )}
        </div>
      </section>
    );

  if (view === 'team')
    return (
      <section className="grid gap-4 lg:grid-cols-2">
        <article className="border border-[#383838] bg-[#161616]">
          <div className="border-b border-[#383838] p-4">
            <p className="text-xs text-[#f5f5f5]">TEAM MEMBERS</p>
            <h2 className="mt-1 text-lg text-white">{workspace.team.name}</h2>
          </div>
          <div>
            {workspace.members.map((member) => (
              <div
                key={String(member.id)}
                className="flex items-center border-b border-[#303030] p-4"
              >
                <span className="grid size-9 place-items-center bg-[#262626] font-bold text-[#f5f5f5]">
                  {String(member.name).slice(0, 2).toUpperCase()}
                </span>
                <span className="ml-3">
                  <strong className="block text-xs text-white">
                    {String(member.name)}
                  </strong>
                  <span className="text-xs text-[#8f8f8f]">
                    {String(member.email)}
                  </span>
                </span>
                <span className="ml-auto border border-[#5a5a5a] px-2 py-1 text-xs text-[#c0c0c0]">
                  {String(member.role).toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </article>
        <article className="border border-[#383838] bg-[#161616] p-5">
          <p className="text-xs text-[#f5f5f5]">INVITE COLLABORATOR</p>
          <p className="mt-2 text-xs leading-relaxed text-[#999999]">
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
              className="min-w-0 flex-1 border border-[#4c4c4c] bg-[#111111] px-3 text-xs text-white outline-none focus:border-[#f5f5f5]"
            />
            <button
              disabled={busy}
              className="bg-[#f5f5f5] px-4 py-3 text-xs font-bold text-black"
            >
              INVITE
            </button>
          </form>
          <div className="mt-5">
            <p className="text-xs text-[#8f8f8f]">PENDING INVITES</p>
            {workspace.invites.map((invite) => (
              <div
                key={String(invite.id)}
                className="mt-2 flex border border-[#383838] p-3 text-xs"
              >
                <span className="text-white">{String(invite.email)}</span>
                <span className="ml-auto text-[#e5a50a]">
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
        <div className="mb-4 border border-[#383838] bg-[#161616] p-4">
          <p className="text-xs text-[#f5f5f5]">
            INGEST + INVESTIGATE + NOTIFY
          </p>
          <p className="mt-1 text-xs text-[#999999]">
            Configure the integration record here, then add its secret in the
            deployment environment. Secrets are never collected in this browser.
          </p>
        </div>
        <div className="grid gap-px bg-[#383838] border border-[#383838] md:grid-cols-2 xl:grid-cols-3">
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
              <article key={type} className="bg-[#161616] p-5">
                <div className="flex items-start justify-between">
                  <Plug size={18} className="text-[#d4d4d4]" />
                  <span
                    className={`text-xs ${configured ? 'text-[#f5f5f5]' : connector ? 'text-[#e5a50a]' : 'text-[#8f8f8f]'}`}
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
                <p className="mt-1 min-h-8 text-xs leading-relaxed text-[#999999]">
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
                  className="mt-4 w-full border border-[#5a5a5a] py-2 text-xs font-bold text-[#d6d6d6] hover:border-[#f5f5f5] hover:text-[#f5f5f5] disabled:opacity-50"
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
          <div className="mt-4 border border-[#d4d4d4] bg-[#101010] p-4">
            <p className="text-xs text-[#d4d4d4]">OPENAI ROOT-CAUSE RESULT</p>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-[#e3e3e3]">
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
        <article className="border border-[#383838] bg-[#161616] p-5">
          <p className="text-xs text-[#f5f5f5]">PLATFORM HEALTH</p>
          <div className="mt-5 grid grid-cols-2 gap-px bg-[#383838] border border-[#383838]">
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
                className="flex items-center bg-[#1b1b1b] p-3"
              >
                <span
                  className={`mr-2 size-2 ${ready ? 'bg-[#f5f5f5]' : 'bg-[#e5a50a]'}`}
                />
                <span className="text-xs text-[#c0c0c0]">{String(label)}</span>
                <span className="ml-auto text-xs text-[#8f8f8f]">
                  {ready ? 'READY' : 'NEEDS SECRET'}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-[#8f8f8f]">
            HEALTH LATENCY: {health?.latencyMs ?? '—'} MS · AUTO REFRESH: 15 SEC
          </p>
        </article>
        <article className="border border-[#383838] bg-[#161616]">
          <div className="border-b border-[#383838] p-5">
            <p className="text-xs text-[#f5f5f5]">SECURITY AUDIT TRAIL</p>
          </div>
          <div className="max-h-[430px] overflow-auto">
            {workspace.auditEvents.map((event, index) => (
              <div
                key={`${event.target_id}-${index}`}
                className="border-b border-[#303030] p-4"
              >
                <div className="flex">
                  <span className="text-xs text-[#d4d4d4]">
                    {String(event.action).toUpperCase()}
                  </span>
                  <span className="ml-auto text-xs text-[#777777]">
                    {dateTime(String(event.created_at))}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#999999]">
                  {String(event.target_type)} / {String(event.target_id)}
                </p>
              </div>
            ))}
            {!workspace.auditEvents.length && (
              <p className="p-10 text-center text-xs text-[#8f8f8f]">
                Audit events appear after uploads and team actions.
              </p>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
