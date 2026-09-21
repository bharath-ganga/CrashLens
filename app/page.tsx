'use client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

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
  CheckCircle2,
  ChevronRight,
  CircleCheck,
  Clipboard,
  FileCode2,
  Filter,
  History,
  LoaderCircle,
  MoreHorizontal,
  Plug,
  Radio,
  ScanSearch,
  Search,
  Send,
  Server,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import UptimePanel from './uptime-panel';
import AdminClientsPanel from './admin-clients-panel';
import ProductionIntelligencePanel from './production-intelligence-panel';
import Link from 'next/link';
import { WorkspaceShell } from '@/components/workspace-shell';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { buildReport, Incident, LogEntry } from '@/lib/log-analyzer';
import { MAX_LOG_FILE_BYTES, MAX_LOG_FILE_MB } from '@/lib/upload-limits';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const initialLogs: LogEntry[] = [];
const initialIncidents: Incident[] = [];

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
type Dataset = {
  ingestion: {
    id: string;
    filename: string;
    format: string;
    rowCount: number;
    createdAt: string;
  };
  incidents: Incident[];
  logs: LogEntry[];
  stats: { total: number; errors: number; services: number };
  activity: Array<{ label: string; count: number; critical: number }>;
  services: Array<{
    service: string;
    events: number;
    errors: number;
    last_seen: string;
  }>;
};
type WorkspaceView =
  | 'overview'
  | 'incidents'
  | 'logs'
  | 'services'
  | 'deployments'
  | 'intelligence'
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

function incidentEvents(incident: Incident) {
  return incident.eventCount ?? incident.logs.length;
}

function recommendedActionFor(incident: Incident) {
  if (incident.fingerprint.endsWith(':rate-limit'))
    return `Review the ${incident.service} rate-limit policy and identify the request IDs producing repeated 429 responses.`;
  if (incident.fingerprint.endsWith(':video-download'))
    return `Inspect the failed media segment requests in ${incident.service}, then verify the upstream URL and retry policy.`;
  if (incident.fingerprint.endsWith(':url-validation'))
    return `Review the blocked hostname and URL-validation events. Confirm they are rejected client input rather than valid traffic.`;
  if (incident.fingerprint.endsWith(':route-not-found'))
    return `Review the missing request paths and decide whether they are stale clients, probes, or routes that should exist.`;
  return `Inspect the matching ${incident.service} events and their request or trace IDs. Confirm the cause before changing production.`;
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
  const [filename, setFilename] = useState('');
  const [ingestionId, setIngestionId] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'analysis' | 'timeline' | 'logs'>('analysis');
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [removeLogsOpen, setRemoveLogsOpen] = useState(false);
  const [removingLogs, setRemovingLogs] = useState(false);
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
  const [incidentFilter, setIncidentFilter] = useState<IncidentFilter>('all');
  const [environment, setEnvironment] = useState('Production');
  const [dateRange, setDateRange] = useState('Last 24h');
  const [datasetStats, setDatasetStats] = useState({
    total: 0,
    errors: 0,
    services: 0,
  });
  const [datasetActivity, setDatasetActivity] = useState<Dataset['activity']>(
    [],
  );
  const [datasetServices, setDatasetServices] = useState<Dataset['services']>(
    [],
  );

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
  const serviceCount = datasetStats.services;
  const errorCount = datasetStats.errors;
  const signalBars = useMemo(() => {
    if (datasetActivity.length) return datasetActivity;
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
  }, [datasetActivity, logs]);
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
      note: `${datasetStats.total} total events`,
      icon: FileCode2,
    },
    {
      label: 'Services',
      value: serviceCount,
      note: 'detected automatically',
      icon: Server,
    },
  ];
  const applyDataset = useCallback((dataset: Dataset) => {
    setLogs(dataset.logs);
    setIncidents(dataset.incidents);
    setSelectedId((current) =>
      dataset.incidents.some((incident) => incident.id === current)
        ? current
        : (dataset.incidents[0]?.id ?? ''),
    );
    setFilename(dataset.ingestion.filename);
    setIngestionId(dataset.ingestion.id);
    setDatasetStats(dataset.stats);
    setDatasetActivity(dataset.activity);
    setDatasetServices(dataset.services);
  }, []);
  const clearDataset = useCallback(() => {
    setLogs([]);
    setIncidents([]);
    setSelectedId('');
    setFilename('');
    setIngestionId('');
    setResolved([]);
    setDatasetStats({ total: 0, errors: 0, services: 0 });
    setDatasetActivity([]);
    setDatasetServices([]);
  }, []);
  const loadWorkspace = useCallback(
    async (quiet = false) => {
      if (!quiet) setWorkspaceBusy(true);
      try {
        const [workspaceResponse, healthResponse, logsResponse] =
          await Promise.all([
            fetch('/api/workspace', { cache: 'no-store' }),
            fetch('/api/health', { cache: 'no-store' }),
            fetch('/api/logs', { cache: 'no-store' }),
          ]);
        if (!workspaceResponse.ok)
          throw new Error(
            workspaceResponse.status === 401
              ? 'Sign in to enable persistent team storage.'
              : 'Workspace is temporarily unavailable.',
          );
        const data = (await workspaceResponse.json()) as Workspace;
        setWorkspace(data);
        if (logsResponse.ok) {
          const logData = (await logsResponse.json()) as {
            dataset: Dataset | null;
          };
          if (logData.dataset) applyDataset(logData.dataset);
          else clearDataset();
        }
        setHistoryIncidentId((current) =>
          data.incidents.some((incident) => String(incident.id) === current)
            ? current
            : String(data.incidents[0]?.id ?? ''),
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
    },
    [applyDataset, clearDataset],
  );

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
    if (file.size > MAX_LOG_FILE_BYTES) {
      setError(
        `File is larger than ${MAX_LOG_FILE_MB} MB. Split it into a smaller file first.`,
      );
      return;
    }
    setProcessing(true);
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch('/api/logs', {
        method: 'POST',
        body: form,
      });
      const result = (await response.json()) as {
        dataset?: Dataset;
        error?: string;
      };
      if (!response.ok || !result.dataset)
        throw new Error(result.error ?? 'Server-side ingestion failed.');
      applyDataset(result.dataset);
      setResolved([]);
      setUploadOpen(false);
      setTab('analysis');
      await loadWorkspace(true);
      setWorkspaceMessage('Logs parsed and saved by the server');
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

  async function removeCurrentLogs() {
    if (!ingestionId) return;
    setRemovingLogs(true);
    setError('');
    try {
      const response = await fetch(
        `/api/logs?ingestionId=${encodeURIComponent(ingestionId)}`,
        { method: 'DELETE' },
      );
      const result = (await response.json()) as {
        dataset?: Dataset | null;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? 'Uploaded logs could not be removed.');
      if (result.dataset) applyDataset(result.dataset);
      else clearDataset();
      setRemoveLogsOpen(false);
      await loadWorkspace(true);
      setWorkspaceMessage('Uploaded logs and derived incident data removed');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Uploaded logs could not be removed.',
      );
    } finally {
      setRemovingLogs(false);
    }
  }

  return (
    <WorkspaceShell
      view={view}
      onNavigate={(value) => setView(value as WorkspaceView)}
      query={query}
      onSearch={setQuery}
      environment={environment}
      onEnvironment={setEnvironment}
      dateRange={dateRange}
      onDateRange={setDateRange}
      onUpload={() => setUploadOpen(true)}
      onRemoveLogs={() => setRemoveLogsOpen(true)}
      onCritical={() => {
        setView('incidents');
        setIncidentFilter('critical');
      }}
      criticalCount={
        incidents.filter((item) => item.severity === 'critical').length
      }
      user={workspace?.user}
      admin={workspace?.capabilities.platformAdmin}
      filename={filename}
      logCount={datasetStats.total}
    >
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-3 border border-destructive bg-destructive/10 p-3 text-xs text-destructive"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
          <Button
            variant="ghost"
            type="button"
            onClick={() => setError('')}
            className="ml-auto"
          >
            <X size={14} />
          </Button>
        </div>
      )}

      {view === 'incidents' ? (
        <>
          <Tabs
            value={incidentFilter}
            onValueChange={(value) =>
              setIncidentFilter(value as IncidentFilter)
            }
            className="mb-6"
          >
            <TabsList variant="line">
              {(['all', 'open', 'critical', 'resolved'] as const).map(
                (filter) => (
                  <TabsTrigger
                    key={filter}
                    value={filter}
                    className="px-4 capitalize"
                  >
                    {filter === 'all' ? 'All incidents' : filter}
                  </TabsTrigger>
                ),
              )}
            </TabsList>
          </Tabs>
          <section className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {metrics.map(({ label, value, note, icon: Icon }) => (
              <Card
                key={label}
                className="block py-0 rounded-none border border-border bg-background p-4 shadow-none"
              >
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                  <span>{label}</span>
                  <Icon size={15} />
                </div>
                <div className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground">
                  {value}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{note}</p>
              </Card>
            ))}
          </section>

          <Card className="block py-0 mb-5 overflow-hidden rounded-none border border-border bg-background p-4 shadow-none">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Radio size={13} className="text-foreground" /> Incident
                activity
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-primary" />
                  All events
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-destructive" />
                  Critical
                </span>
              </div>
            </div>
            <div className="h-[190px] w-full">
              {logs.length === 0 ? (
                <Empty className="h-full">
                  <EmptyHeader>
                    <EmptyTitle>No activity yet</EmptyTitle>
                    <EmptyDescription>
                      Event volume will appear here when you upload logs.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ChartContainer
                  className="h-full w-full aspect-auto"
                  config={{
                    count: {
                      label: 'All events',
                      color: 'var(--chart-primary)',
                    },
                    critical: {
                      label: 'Critical',
                      color: 'var(--destructive)',
                    },
                  }}
                >
                  <AreaChart
                    data={signalBars}
                    margin={{ top: 8, right: 8, left: -28, bottom: 0 }}
                  >
                    <CartesianGrid
                      vertical={false}
                      stroke="var(--chart-grid)"
                      strokeDasharray="3 5"
                    />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="count"
                      name="All events"
                      stroke="var(--chart-primary)"
                      strokeWidth={2.5}
                      fill="var(--chart-primary-fill)"
                      activeDot={{
                        r: 5,
                        fill: 'var(--chart-primary)',
                        stroke: 'var(--background)',
                        strokeWidth: 2,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="critical"
                      name="Critical"
                      stroke="var(--destructive)"
                      strokeWidth={2}
                      fill="transparent"
                      dot={{
                        r: 3,
                        fill: 'var(--destructive)',
                        strokeWidth: 0,
                      }}
                    />
                  </AreaChart>
                </ChartContainer>
              )}
            </div>
          </Card>

          <Card
            id="incidents"
            className="block py-0 grid min-h-[610px] overflow-hidden rounded-none border border-border bg-background shadow-none xl:grid-cols-[minmax(520px,.95fr)_minmax(0,1.05fr)]"
          >
            <div className="border-b border-border xl:border-b-0 xl:border-r">
              <div className="flex items-center justify-between border-b border-border p-4">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Active incidents
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Grouped by fingerprint and service
                  </p>
                </div>
                <Label className="flex h-9 w-52 items-center gap-2 rounded-none border border-border bg-background px-3 text-muted-foreground focus-within:border-foreground">
                  <Search size={15} />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter incidents or services"
                    className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  <Filter size={14} />
                </Label>
              </div>
              <div className="grid grid-cols-[1fr_92px_82px_72px] gap-3 border-b border-border px-4 py-2.5 text-[10px] font-medium uppercase tracking-[.08em] text-muted-foreground">
                <span>Incident</span>
                <span>Service</span>
                <span>Status</span>
                <span className="text-right">Events</span>
              </div>
              <div className="max-h-[535px] overflow-y-auto">
                {filteredIncidents.length ? (
                  filteredIncidents.map((incident) => (
                    <Button
                      variant="ghost"
                      type="button"
                      aria-label={`Open incident ${incident.id}: ${incident.title}`}
                      key={incident.id}
                      onClick={() => {
                        setSelectedId(incident.id);
                        setTab('analysis');
                      }}
                      className={`grid h-auto w-full grid-cols-[1fr_92px_82px_72px] items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors ${selected?.id === incident.id ? 'bg-muted' : 'bg-background hover:bg-muted'}`}
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span
                            className={`size-2 shrink-0 rounded-full ${incident.severity === 'critical' ? 'bg-destructive' : 'bg-warning'}`}
                          />
                          <span className="truncate text-[13px] font-medium text-foreground">
                            {incident.title}
                          </span>
                        </span>
                        <span className="mt-1.5 flex gap-2 text-[11px] text-muted-foreground">
                          <span>#{incident.id}</span>
                          <span>{time(incident.started)} UTC</span>
                        </span>
                      </span>
                      <span className="truncate text-xs text-foreground">
                        {incident.service}
                      </span>
                      <Badge
                        className={`w-fit rounded-full px-2 py-1 text-[10px] font-semibold ${resolved.includes(incident.id) ? 'bg-success/10 text-success' : incident.severity === 'critical' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}`}
                      >
                        {resolved.includes(incident.id)
                          ? 'Resolved'
                          : incident.severity === 'critical'
                            ? 'Critical'
                            : 'Open'}
                      </Badge>
                      <span className="text-right">
                        <span className="block text-xs text-foreground">
                          {incidentEvents(incident)}
                        </span>
                        <span className="mt-1 block text-[10px] text-destructive">
                          {incident.change}
                        </span>
                      </span>
                    </Button>
                  ))
                ) : (
                  <div className="p-8 text-center text-xs text-muted-foreground">
                    No incidents match this filter.
                  </div>
                )}
              </div>
            </div>

            {selected ? (
              <div className="min-w-0">
                <div className="border-b border-border p-4 lg:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className={`size-1.5 ${selected.severity === 'critical' ? 'bg-destructive' : 'bg-warning'}`}
                        />
                        INCIDENT #{selected.id} /{' '}
                        {resolved.includes(selected.id)
                          ? 'RESOLVED'
                          : selected.status.toUpperCase()}
                      </div>
                      <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">
                        {selected.title}
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selected.service} · {incidentEvents(selected)}{' '}
                        correlated events · {dateTime(selected.started)} UTC
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => setTab('logs')}
                        className="h-9 rounded-none border border-border bg-muted px-3 text-xs font-medium text-foreground hover:bg-muted"
                      >
                        View logs
                      </Button>
                      <Button
                        variant="default"
                        type="button"
                        onClick={() =>
                          setResolved((items) =>
                            items.includes(selected.id)
                              ? items.filter((id) => id !== selected.id)
                              : [...items, selected.id],
                          )
                        }
                        className="h-9 rounded-none bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary"
                      >
                        {resolved.includes(selected.id) ? 'Reopen' : 'Resolve'}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="outline"
                              size="icon"
                              aria-label="More incident actions"
                            />
                          }
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              void navigator.clipboard.writeText(
                                selected.fingerprint,
                              );
                              setCopied(true);
                              window.setTimeout(() => setCopied(false), 1600);
                            }}
                            className="flex w-full items-center gap-2 rounded-none px-3 py-2 text-left text-xs text-foreground hover:bg-muted"
                          >
                            <Clipboard size={13} />
                            {copied ? 'Copied' : 'Copy fingerprint'}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              downloadText(
                                buildReport(selected, filename),
                                `incident-${selected.id}-report.txt`,
                              );
                            }}
                            className="flex w-full items-center gap-2 rounded-none px-3 py-2 text-left text-xs text-foreground hover:bg-muted"
                          >
                            <ArrowDownToLine size={13} />
                            Export report
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>

                <Card className="block py-0 border-b border-border bg-muted p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <Sparkles size={14} /> Evidence-based assessment
                    </div>
                    <Badge
                      variant="secondary"
                      className="shrink-0 px-2.5 py-1 text-xs font-medium"
                    >
                      {selected.confidence}% confidence
                    </Badge>
                  </div>
                  <p className="mt-3 text-lg font-semibold leading-snug text-foreground">
                    {rootCauseFor(selected)}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Based on parsed event fields, severity, timestamps, and the
                    normalized fingerprint. A trigger is shown only when an
                    explicit change event exists in the source data.
                  </p>
                </Card>

                <Tabs
                  value={tab}
                  onValueChange={(value) => setTab(value as typeof tab)}
                  className="border-b px-5 py-2"
                >
                  <TabsList variant="line">
                    <TabsTrigger value="analysis">Investigation</TabsTrigger>
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    <TabsTrigger value="logs">
                      Logs ({incidentEvents(selected)})
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <div
                  className="max-h-[315px] overflow-auto p-4 lg:p-5"
                  id="raw-logs"
                >
                  {tab === 'analysis' ? (
                    <div className="space-y-5">
                      <div className="grid gap-5 md:grid-cols-[1.05fr_.95fr]">
                        <div>
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-foreground">
                              Evidence
                            </h3>
                            <span className="text-xs text-muted-foreground">
                              {incidentEvents(selected)} correlated events
                            </span>
                          </div>
                          <div className="mt-3 space-y-2.5 text-sm text-foreground">
                            <p className="flex gap-2">
                              <CircleCheck
                                size={15}
                                className="mt-0.5 shrink-0 text-success"
                              />
                              <span>
                                <strong className="font-medium text-foreground">
                                  {selected.service}
                                </strong>{' '}
                                produced the first matching error at{' '}
                                {time(selected.started)} UTC.
                              </span>
                            </p>
                            <p className="flex gap-2">
                              <CircleCheck
                                size={15}
                                className="mt-0.5 shrink-0 text-success"
                              />
                              <span>
                                {incidentEvents(selected)} events share the
                                normalized{' '}
                                <strong className="font-medium text-foreground">
                                  {selected.fingerprint}
                                </strong>{' '}
                                fingerprint.
                              </span>
                            </p>
                            <p className="flex gap-2">
                              <CircleCheck
                                size={15}
                                className="mt-0.5 shrink-0 text-success"
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
                        <div className="rounded-none border border-border bg-muted p-4">
                          <p className="text-xs font-medium text-foreground">
                            Recommended action
                          </p>
                          <p className="mt-2 text-sm leading-relaxed text-foreground">
                            {recommendedActionFor(selected)}
                          </p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button
                              variant="default"
                              type="button"
                              onClick={() => setTab('logs')}
                              className="rounded-none bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                            >
                              View related logs
                            </Button>
                            {selected.timeline.some(
                              (event) => event.type === 'deploy',
                            ) && (
                              <Button
                                variant="ghost"
                                type="button"
                                onClick={() => setView('deployments')}
                                className="rounded-none border border-border px-3 py-2 text-xs text-foreground"
                              >
                                View deployment
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="border-t border-border pt-5">
                        <div className="mb-3">
                          <h3 className="text-sm font-semibold text-foreground">
                            Causal chain
                          </h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            How the signal became a production incident
                          </p>
                        </div>
                        <div className="grid items-stretch gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
                          <div className="rounded-none border border-foreground/55 bg-primary/8 p-3">
                            <p className="text-[11px] font-medium uppercase tracking-[.08em] text-foreground">
                              Root signal
                            </p>
                            <p className="mt-2 text-sm font-medium text-foreground">
                              {rootCauseFor(selected).replace(
                                ` in ${selected.service}`,
                                '',
                              )}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {selected.service} · {time(selected.started)}
                            </p>
                          </div>
                          <ChevronRight
                            size={18}
                            className="mx-auto self-center rotate-90 text-muted-foreground md:rotate-0"
                          />
                          <Card className="block py-0 rounded-none border border-border bg-muted p-3">
                            <p className="text-[11px] font-medium uppercase tracking-[.08em] text-muted-foreground">
                              Incident cluster
                            </p>
                            <p className="mt-2 text-sm font-medium text-foreground">
                              {incidentEvents(selected)} matching events
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {selected.fingerprint}
                            </p>
                          </Card>
                          <ChevronRight
                            size={18}
                            className="mx-auto self-center rotate-90 text-muted-foreground md:rotate-0"
                          />
                          <div className="rounded-none border border-destructive bg-destructive/10 p-3">
                            <p className="text-[11px] font-medium uppercase tracking-[.08em] text-destructive">
                              Production impact
                            </p>
                            <p className="mt-2 text-sm font-medium text-foreground">
                              {selected.title}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {selected.status} · {time(selected.lastSeen)}
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
                          <span className="pt-0.5 text-xs text-muted-foreground">
                            {event.time}
                          </span>
                          <span className="relative flex justify-center">
                            <span
                              className={`relative z-10 mt-0.5 size-2.5 border border-border ${event.type === 'critical' ? 'bg-destructive' : event.type === 'deploy' ? 'bg-primary' : event.type === 'alert' ? 'bg-warning' : 'bg-muted'}`}
                            />
                            {index < selected.timeline.length - 1 && (
                              <span className="absolute top-2 h-full w-px bg-muted" />
                            )}
                          </span>
                          <span className="pb-5">
                            <span
                              className={`block text-sm ${event.type === 'critical' ? 'text-destructive' : 'text-foreground'}`}
                            >
                              {event.title}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {event.detail}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="min-w-[650px] text-xs">
                      <div className="grid grid-cols-[70px_58px_130px_1fr] border-b border-border pb-2 text-muted-foreground">
                        <span>TIME</span>
                        <span>LEVEL</span>
                        <span>SERVICE</span>
                        <span>MESSAGE</span>
                      </div>
                      {selected.logs.map((log) => (
                        <div
                          key={log.id}
                          className="grid grid-cols-[70px_58px_130px_1fr] border-b border-border py-2 text-foreground"
                        >
                          <span>{time(log.timestamp)}</span>
                          <span
                            className={
                              log.level === 'fatal' || log.level === 'error'
                                ? 'text-destructive'
                                : 'text-warning'
                            }
                          >
                            {log.level.toUpperCase()}
                          </span>
                          <span className="truncate pr-3 text-foreground">
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
              <Empty className="min-h-80 p-10">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ScanSearch />
                  </EmptyMedia>
                  <EmptyTitle>No investigation selected</EmptyTitle>
                  <EmptyDescription>
                    Upload your application logs to group related errors and see
                    what happened.
                  </EmptyDescription>
                </EmptyHeader>
                <Button variant="outline" onClick={() => setUploadOpen(true)}>
                  <Upload />
                  Upload your first logs
                </Button>
              </Empty>
            )}
          </Card>
        </>
      ) : view === 'intelligence' ? (
        <ProductionIntelligencePanel />
      ) : ['overview', 'logs', 'services', 'deployments', 'settings'].includes(
          view,
        ) ? (
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
          stats={datasetStats}
          servicesSummary={datasetServices}
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
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-xl p-0 gap-0">
          <DialogHeader className="p-6 border-b">
            <DialogTitle className="text-xl">Upload log file</DialogTitle>
            <DialogDescription>
              The server parses every record, computes incidents, and saves the
              redacted source plus normalized events.
            </DialogDescription>
          </DialogHeader>
          <Input
            ref={inputRef}
            type="file"
            accept=".txt,.log,.csv,.jsonl,.ndjson"
            onChange={onFile}
            className="hidden"
          />
          <Button
            variant="ghost"
            type="button"
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`m-5 grid h-auto min-h-52 w-[calc(100%-2.5rem)] cursor-pointer place-items-center whitespace-normal border border-dashed p-6 text-center ${dragging ? 'border-foreground bg-muted' : 'border-border bg-muted hover:border-border'}`}
          >
            {processing ? (
              <span>
                <LoaderCircle
                  size={26}
                  className="mx-auto animate-spin text-foreground"
                />
                <span className="mt-3 block text-xs text-foreground">
                  UPLOADING · SERVER ANALYSIS
                </span>
              </span>
            ) : (
              <span>
                <Upload size={25} className="mx-auto text-foreground" />
                <span className="mt-3 block text-sm font-medium text-foreground">
                  Drop a file here or click to browse
                </span>
                <span className="mt-2 block text-xs text-muted-foreground">
                  TXT · LOG · CSV · JSONL · NDJSON / MAX {MAX_LOG_FILE_MB} MB
                </span>
              </span>
            )}
          </Button>
          {error && (
            <p className="mx-5 mb-3 border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="border-t border-border bg-muted p-5 text-xs leading-5 text-muted-foreground">
            Upload logs exported by your application, container platform, or
            observability provider. CrashLens will not create artificial
            incidents.
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={removeLogsOpen} onOpenChange={setRemoveLogsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="text-destructive">
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>Remove uploaded logs?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {filename || 'this source'}, its stored
              log records, and all incidents derived from it. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingLogs}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removingLogs}
              onClick={(event) => {
                event.preventDefault();
                void removeCurrentLogs();
              }}
            >
              {removingLogs ? 'Removing…' : 'Remove logs'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspaceShell>
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
  stats,
  servicesSummary,
  onUpload,
}: {
  view: 'overview' | 'logs' | 'services' | 'deployments' | 'settings';
  logs: LogEntry[];
  incidents: Incident[];
  resolved: string[];
  query: string;
  filename: string;
  workspace: Workspace | null;
  stats: Dataset['stats'];
  servicesSummary: Dataset['services'];
  onUpload: () => void;
}) {
  const services = useMemo(() => {
    if (servicesSummary.length)
      return servicesSummary.map((row) => ({
        name: row.service,
        events: Number(row.events),
        errors: Number(row.errors),
        lastSeen: row.last_seen,
      }));
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
  }, [logs, servicesSummary]);
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
    'overflow-hidden rounded-none border border-border bg-background shadow-none';

  if (view === 'overview')
    return (
      <div className="grid gap-5 xl:grid-cols-[1.3fr_.7fr]">
        <section className={panel}>
          <div className="border-b border-border p-5">
            <h2 className="font-semibold">Production health</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Live signals from the current dataset
            </p>
          </div>
          <div className="grid gap-px bg-muted sm:grid-cols-3">
            {[
              ['Open incidents', incidents.length - resolved.length],
              [
                'Critical',
                incidents.filter((item) => item.severity === 'critical').length,
              ],
              ['Services', services.length],
            ].map(([label, value]) => (
              <div key={label} className="bg-background p-5">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-2 text-3xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <div className="p-5">
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 size={16} /> Log ingestion is operational
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {filename
                ? `${stats.total} events parsed and persisted from ${filename}`
                : 'No log source is connected yet.'}
            </p>
          </div>
        </section>
        <section className={panel}>
          <div className="border-b border-border p-5">
            <h2 className="font-semibold">Needs attention</h2>
          </div>
          <div className="divide-y divide-border">
            {incidents.slice(0, 4).map((incident) => (
              <Button
                variant="ghost"
                type="button"
                key={incident.id}
                className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted"
              >
                <span
                  className={`size-2 rounded-full ${incident.severity === 'critical' ? 'bg-destructive' : 'bg-warning'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {incident.title}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {incident.service}
                  </span>
                </span>
                <ChevronRight size={15} className="text-muted-foreground" />
              </Button>
            ))}
          </div>
        </section>
      </div>
    );

  if (view === 'logs')
    return (
      <section className={panel}>
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h2 className="font-semibold">Event stream</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {query
                ? `${visibleLogs.length} matches in the latest ${logs.length.toLocaleString()} loaded events`
                : `Showing the latest ${logs.length.toLocaleString()} of ${stats.total.toLocaleString()} persisted events`}
            </p>
          </div>
          <Button
            variant="default"
            type="button"
            onClick={onUpload}
            className="rounded-none bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
          >
            Upload logs
          </Button>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[100px_80px_150px_1fr] gap-3 border-b border-border px-5 py-3 text-[10px] uppercase tracking-[.08em] text-muted-foreground">
              <span>Time</span>
              <span>Level</span>
              <span>Service</span>
              <span>Message</span>
            </div>
            {visibleLogs.slice(0, 100).map((log) => (
              <Card
                key={log.id}
                className="block py-0 grid grid-cols-[100px_80px_150px_1fr] gap-3 border-b border-border px-5 py-3 text-xs hover:bg-muted"
              >
                <span className="text-muted-foreground">
                  {time(log.timestamp)}
                </span>
                <span
                  className={
                    log.level === 'error' || log.level === 'fatal'
                      ? 'text-destructive'
                      : 'text-warning'
                  }
                >
                  {log.level}
                </span>
                <span>{log.service}</span>
                <span className="truncate text-foreground">{log.message}</span>
              </Card>
            ))}
          </div>
        </div>
      </section>
    );

  if (view === 'services')
    return (
      <section className={panel}>
        <div className="border-b border-border p-5">
          <h2 className="font-semibold">Services</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Health inferred from ingested production signals
          </p>
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
          {services.map((service) => (
            <article
              key={service.name}
              className="rounded-none border border-border bg-muted p-4"
            >
              <div className="flex items-center justify-between">
                <Server size={17} className="text-foreground" />
                <Badge
                  className={`rounded-full px-2 py-1 text-[10px] ${service.errors ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'}`}
                >
                  {service.errors ? 'Degraded' : 'Healthy'}
                </Badge>
              </div>
              <h3 className="mt-4 text-sm font-semibold">{service.name}</h3>
              <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                <span>{service.events} events</span>
                <span>{service.errors} errors</span>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
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
        <div className="border-b border-border p-5">
          <h2 className="font-semibold">Deployment correlations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Changes detected near incident start times
          </p>
        </div>
        {deployments.length ? (
          <div className="divide-y divide-border">
            {deployments.map((deployment, index) => (
              <div
                key={`${deployment.timestamp}-${index}`}
                className="grid gap-3 p-5 md:grid-cols-[120px_1fr_160px]"
              >
                <span className="text-xs text-muted-foreground">
                  {dateTime(deployment.timestamp)} UTC
                </span>
                <span>
                  <span className="block text-sm">{deployment.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {deployment.detail}
                  </span>
                </span>
                <span className="text-xs text-warning">
                  Linked to #{deployment.incident.id}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No deployment events were found in this dataset.
          </div>
        )}
      </section>
    );

  return (
    <section className={panel}>
      <div className="border-b border-border p-5">
        <h2 className="font-semibold">Workspace settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Account, storage and analysis configuration
        </p>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-2">
        {[
          ['Workspace', workspace?.team.name ?? 'Local workspace'],
          ['Signed in as', workspace?.user.email ?? 'Local analyzer'],
          ['Current source', filename || 'No source connected'],
          ['Privacy', 'PII redaction enabled'],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-none border border-border bg-muted p-4"
          >
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 text-sm text-foreground">{value}</p>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-5">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Appearance
        </p>
        <ThemeToggle />
      </div>
      <div className="flex gap-3 border-t border-border p-5">
        <Link
          href="/account"
          className="rounded-none bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/80"
        >
          Manage account
        </Link>
        <Button
          variant="ghost"
          type="button"
          onClick={onUpload}
          className="rounded-none border border-border px-4 py-2 text-xs text-foreground"
        >
          Change data source
        </Button>
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
    ['github', 'GitHub Issues', 'Deduplicated engineering follow-up issues'],
    ['jira', 'Jira', 'Project issue creation for incident follow-up'],
    ['discord', 'Discord', 'Incident notifications through webhooks'],
    ['pagerduty', 'PagerDuty', 'Trigger and resolve on-call incidents'],
    ['datadog', 'Datadog', 'Monitor and log webhook intake'],
    [
      'opentelemetry',
      'OpenTelemetry',
      'Distributed request traces through the OTLP JSON endpoint',
    ],
    ['webhook', 'Generic webhook', 'Token-protected JSON log endpoint'],
    ['slack', 'Slack alerts', 'Incident notifications through webhook'],
    ['email', 'Email alerts', 'Provider-ready notification channel'],
    ['openai', 'OpenAI RCA', 'LLM-assisted root-cause investigation'],
  ];

  if (!workspace)
    return (
      <Card className="block py-0 grid min-h-72 place-items-center border border-border bg-background p-10 text-center">
        <div>
          <LoaderCircle
            className="mx-auto mb-3 animate-spin text-foreground"
            size={22}
          />
          <p className="text-sm text-foreground">
            Connecting authenticated workspace
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The local analyzer remains available while services initialize.
          </p>
        </div>
      </Card>
    );

  if (view === 'clients') return <AdminClientsPanel />;

  if (view === 'history')
    return (
      <Card className="block py-0 grid min-h-[620px] border border-border bg-background xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,.7fr)]">
        <div className="border-b border-border xl:border-b-0 xl:border-r">
          <div className="flex items-center justify-between border-b border-border p-4">
            <div>
              <p className="text-xs text-foreground">
                PERSISTENT INCIDENT HISTORY
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {workspace.ingestionCount} saved ingestion runs · refreshes
                every 15 seconds
              </p>
            </div>
            <History size={18} className="text-muted-foreground" />
          </div>
          <div className="overflow-x-auto">
            <Table className="w-full min-w-[700px] text-left text-sm">
              <TableHeader className="bg-muted text-xs text-muted-foreground">
                <TableRow>
                  <TableHead className="p-3">INCIDENT</TableHead>
                  <TableHead>SERVICE</TableHead>
                  <TableHead>SEVERITY</TableHead>
                  <TableHead>STATUS</TableHead>
                  <TableHead>ASSIGNEE</TableHead>
                  <TableHead>UPDATED</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspace.incidents.map((incident) => (
                  <TableRow
                    key={String(incident.id)}
                    onClick={() => setHistoryIncidentId(String(incident.id))}
                    className={`cursor-pointer border-t border-border ${historyIncidentId === String(incident.id) ? 'bg-muted' : 'hover:bg-muted'}`}
                  >
                    <TableCell className="p-3 text-foreground">
                      {String(incident.title)}
                    </TableCell>
                    <TableCell className="text-foreground">
                      {String(incident.service)}
                    </TableCell>
                    <TableCell className="text-destructive">
                      {String(incident.severity).toUpperCase()}
                    </TableCell>
                    <TableCell>{String(incident.status)}</TableCell>
                    <TableCell>
                      {String(incident.assignee_name ?? 'Unassigned')}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {dateTime(String(incident.updated_at))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!workspace.incidents.length && (
              <p className="p-10 text-center text-xs text-muted-foreground">
                Upload a log file to create durable incident history.
              </p>
            )}
          </div>
        </div>
        <div className="p-4 lg:p-5">
          <p className="text-xs text-muted-foreground">
            INCIDENT COLLABORATION
          </p>
          {selectedHistory ? (
            <>
              <h2 className="mt-2 text-lg font-semibold text-foreground">
                {String(selectedHistory.title)}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                #{String(selectedHistory.id)} ·{' '}
                {String(selectedHistory.fingerprint)}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void action({
                      action: 'update_incident',
                      incidentId: selectedHistory.id,
                      status: 'investigating',
                      assignedTo: workspace.user.id,
                    })
                  }
                  className="border border-foreground p-2 text-xs font-bold text-foreground disabled:opacity-50"
                >
                  ASSIGN TO ME
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void action({
                      action: 'update_incident',
                      incidentId: selectedHistory.id,
                      status: 'resolved',
                    })
                  }
                  className="border border-foreground p-2 text-xs font-bold text-foreground disabled:opacity-50"
                >
                  RESOLVE
                </Button>
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
                <Label
                  htmlFor="incident-comment"
                  className="text-xs text-muted-foreground"
                >
                  ADD INVESTIGATION NOTE
                </Label>
                <Textarea
                  id="incident-comment"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  required
                  maxLength={2000}
                  className="mt-2 h-24 w-full resize-none border border-border bg-muted p-3 text-xs text-foreground outline-none focus:border-foreground"
                  placeholder="What did you find?"
                />
                <Button
                  variant="default"
                  type="submit"
                  disabled={busy}
                  className="mt-2 flex h-9 items-center gap-2 bg-primary px-4 text-xs font-bold text-primary-foreground disabled:opacity-50"
                >
                  <Send size={12} />
                  POST NOTE
                </Button>
              </form>
              <div className="mt-5 border-t border-border pt-4">
                <p className="text-xs text-muted-foreground">RECENT NOTES</p>
                {workspace.comments
                  .filter(
                    (item) =>
                      String(item.incident_id) === String(selectedHistory.id),
                  )
                  .slice(0, 5)
                  .map((item) => (
                    <Card
                      key={String(item.id)}
                      className="block py-0 mt-2 border-l-2 border-border bg-muted p-3"
                    >
                      <p className="text-xs text-foreground">
                        {String(item.body)}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {String(item.user_name ?? item.user_email)} ·{' '}
                        {dateTime(String(item.created_at))}
                      </p>
                    </Card>
                  ))}
              </div>
            </>
          ) : (
            <p className="mt-5 text-xs text-muted-foreground">
              Select an incident to collaborate.
            </p>
          )}
        </div>
      </Card>
    );

  if (view === 'team')
    return (
      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="block py-0 border border-border bg-background">
          <div className="border-b border-border p-4">
            <p className="text-xs text-foreground">TEAM MEMBERS</p>
            <h2 className="mt-1 text-lg text-foreground">
              {workspace.team.name}
            </h2>
          </div>
          <div>
            {workspace.members.map((member) => (
              <div
                key={String(member.id)}
                className="flex items-center border-b border-border p-4"
              >
                <span className="grid size-9 place-items-center bg-muted font-bold text-foreground">
                  {String(member.name).slice(0, 2).toUpperCase()}
                </span>
                <span className="ml-3">
                  <strong className="block text-xs text-foreground">
                    {String(member.name)}
                  </strong>
                  <span className="text-xs text-muted-foreground">
                    {String(member.email)}
                  </span>
                </span>
                <span className="ml-auto border border-border px-2 py-1 text-xs text-foreground">
                  {String(member.role).toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="block py-0 border border-border bg-background p-5">
          <p className="text-xs text-foreground">INVITE COLLABORATOR</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
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
            <Input
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              type="email"
              required
              placeholder="engineer@company.com"
              className="min-w-0 flex-1 border border-border bg-muted px-3 text-xs text-foreground outline-none focus:border-foreground"
            />
            <Button
              variant="default"
              type="submit"
              disabled={busy}
              className="bg-primary px-4 py-3 text-xs font-bold text-primary-foreground"
            >
              INVITE
            </Button>
          </form>
          <div className="mt-5">
            <p className="text-xs text-muted-foreground">PENDING INVITES</p>
            {workspace.invites.map((invite) => (
              <div
                key={String(invite.id)}
                className="mt-2 flex border border-border p-3 text-xs"
              >
                <span className="text-foreground">{String(invite.email)}</span>
                <span className="ml-auto text-warning">
                  {String(invite.status)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </section>
    );

  if (view === 'integrations')
    return (
      <section>
        <Card className="block py-0 mb-4 border border-border bg-background p-4">
          <p className="text-xs text-foreground">
            INGEST + INVESTIGATE + NOTIFY
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Configure the integration record here, then add its secret in the
            deployment environment. Secrets are never collected in this browser.
          </p>
        </Card>
        <div className="grid gap-px bg-muted border border-border md:grid-cols-2 xl:grid-cols-3">
          {connectorTypes.map(([type, name, description]) => {
            const connector = workspace.connectors.find(
              (item) => item.type === type,
            );
            const configured =
              type === 'openai'
                ? workspace.capabilities.openai
                : type === 'slack'
                  ? workspace.capabilities.slack
                  : type === 'discord'
                    ? workspace.capabilities.discord
                    : type === 'sentry'
                      ? workspace.capabilities.sentry
                      : type === 'github'
                        ? workspace.capabilities.github
                        : type === 'jira'
                          ? workspace.capabilities.jira
                          : type === 'pagerduty'
                            ? workspace.capabilities.pagerduty
                            : type === 'opentelemetry'
                              ? workspace.capabilities.otlpExport ||
                                workspace.capabilities.externalIngestion
                              : type === 'email'
                                ? workspace.capabilities.email
                                : type === 'webhook'
                                  ? workspace.capabilities.outboundWebhook
                                  : false;
            return (
              <article key={type} className="bg-background p-5">
                <div className="flex items-start justify-between">
                  <Plug size={18} className="text-foreground" />
                  <span
                    className={`text-xs ${configured ? 'text-foreground' : connector ? 'text-warning' : 'text-muted-foreground'}`}
                  >
                    {configured
                      ? 'ACTIVE'
                      : connector
                        ? String(connector.status).toUpperCase()
                        : 'NOT SET'}
                  </span>
                </div>
                <h3 className="mt-4 text-sm font-semibold text-foreground">
                  {name}
                </h3>
                <p className="mt-1 min-h-8 text-xs leading-relaxed text-muted-foreground">
                  {description}
                </p>
                <Button
                  variant="ghost"
                  type="button"
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
                  className="mt-4 w-full border border-border py-2 text-xs font-bold text-foreground hover:border-foreground hover:text-foreground disabled:opacity-50"
                >
                  {(type === 'slack' || type === 'email') && configured
                    ? 'SEND TEST ALERT'
                    : type === 'openai' && configured
                      ? 'RUN RCA ON LATEST'
                      : connector
                        ? 'UPDATE CONFIGURATION'
                        : 'PREPARE CONNECTOR'}
                </Button>
              </article>
            );
          })}
        </div>
        {aiResult && (
          <div className="mt-4 border border-foreground bg-muted p-4">
            <p className="text-xs text-foreground">OPENAI ROOT-CAUSE RESULT</p>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground">
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
        <Card className="block py-0 border border-border bg-background p-5">
          <p className="text-xs text-foreground">PLATFORM HEALTH</p>
          <div className="mt-5 grid grid-cols-2 gap-px bg-muted border border-border">
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
                className="flex items-center bg-muted p-3"
              >
                <span
                  className={`mr-2 size-2 ${ready ? 'bg-primary' : 'bg-warning'}`}
                />
                <span className="text-xs text-foreground">{String(label)}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {ready ? 'READY' : 'NEEDS SECRET'}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            HEALTH LATENCY: {health?.latencyMs ?? '—'} MS · AUTO REFRESH: 15 SEC
          </p>
        </Card>
        <Card className="block py-0 border border-border bg-background">
          <div className="border-b border-border p-5">
            <p className="text-xs text-foreground">SECURITY AUDIT TRAIL</p>
          </div>
          <div className="max-h-[430px] overflow-auto">
            {workspace.auditEvents.map((event, index) => (
              <div
                key={`${event.target_id}-${index}`}
                className="border-b border-border p-4"
              >
                <div className="flex">
                  <span className="text-xs text-foreground">
                    {String(event.action).toUpperCase()}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {dateTime(String(event.created_at))}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {String(event.target_type)} / {String(event.target_id)}
                </p>
              </div>
            ))}
            {!workspace.auditEvents.length && (
              <p className="p-10 text-center text-xs text-muted-foreground">
                Audit events appear after uploads and team actions.
              </p>
            )}
          </div>
        </Card>
      </section>
    </div>
  );
}
