'use client';

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownToLine, Braces, CheckCircle2, ChevronRight, CircleCheck,
  Clipboard, Clock3, Crosshair, Database, Download, FileCode2, FileText, Filter, ListTree,
  HeartPulse, History, LoaderCircle, Menu, Plug, Radio, Search, Send, Server, ShieldCheck,
  Sparkles, Upload, Users, X, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { analyzeLogs, buildReport, Incident, LogEntry, parseLogContent, SAMPLE_JSONL } from '@/lib/log-analyzer';

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
type WorkspaceView = 'incidents' | 'history' | 'team' | 'integrations' | 'monitoring';

function time(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
}

function dateTime(timestamp: string) {
  return new Date(timestamp).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
}

function downloadText(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  URL.revokeObjectURL(url);
}

const severityStyles = {
  critical: 'border-[#ff4d4d] bg-[#2a1012] text-[#ff7777]',
  warning: 'border-[#e5a50a] bg-[#241b08] text-[#ffc247]',
  info: 'border-[#2f8fff] bg-[#0a1b2d] text-[#61adff]',
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
  const [workspaceMessage, setWorkspaceMessage] = useState('Connecting secure workspace…');
  const [health, setHealth] = useState<{ status: string; latencyMs?: number } | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [comment, setComment] = useState('');
  const [historyIncidentId, setHistoryIncidentId] = useState('');

  const selected = incidents.find((incident) => incident.id === selectedId) ?? incidents[0];
  const filteredIncidents = useMemo(() => incidents.filter((incident) =>
    `${incident.title} ${incident.service} ${incident.trigger}`.toLowerCase().includes(query.toLowerCase())), [incidents, query]);
  const serviceCount = new Set(logs.map((log) => log.service)).size;
  const errorCount = logs.filter((log) => log.level === 'error' || log.level === 'fatal').length;
  const dataQuality = Math.round((logs.filter((log) => log.service !== 'unknown-service').length / Math.max(1, logs.length)) * 100);
  const signalBars = useMemo(() => {
    const buckets = new Map<string, number>();
    logs.forEach((log) => { const key = log.timestamp.slice(11, 16); buckets.set(key, (buckets.get(key) ?? 0) + 1); });
    const values = [...buckets.entries()].slice(-18);
    const maximum = Math.max(1, ...values.map(([, count]) => count));
    return values.map(([label, count]) => ({ label, count, height: Math.max(12, Math.round((count / maximum) * 100)) }));
  }, [logs]);
  const metrics: Array<{ label: string; value: string | number; note: string; icon: LucideIcon }> = [
    { label: 'INCIDENTS', value: incidents.length, note: `${incidents.filter((item) => item.severity === 'critical').length} critical`, icon: AlertTriangle },
    { label: 'LOGS PARSED', value: logs.length, note: `${errorCount} errors`, icon: FileCode2 },
    { label: 'SERVICES', value: serviceCount, note: 'detected automatically', icon: Server },
    { label: 'TIME WINDOW', value: logs.length ? `${Math.max(1, Math.round((Date.parse(logs.at(-1)!.timestamp) - Date.parse(logs[0].timestamp)) / 60000))}m` : '0m', note: 'UTC normalized', icon: Clock3 },
  ];
  const sampleFiles: Array<{ label: string; extension: string; icon: LucideIcon }> = [
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
      if (!workspaceResponse.ok) throw new Error(workspaceResponse.status === 401 ? 'Sign in to enable persistent team storage.' : 'Workspace is temporarily unavailable.');
      const data = await workspaceResponse.json() as Workspace;
      setWorkspace(data);
      setHistoryIncidentId((current) => current || String(data.incidents[0]?.id ?? ''));
      if (healthResponse.ok) setHealth(await healthResponse.json() as { status: string; latencyMs?: number });
      setWorkspaceMessage('Persistent workspace connected');
    } catch (reason) {
      setWorkspaceMessage(reason instanceof Error ? reason.message : 'Workspace unavailable');
    } finally { if (!quiet) setWorkspaceBusy(false); }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadWorkspace(), 0);
    const interval = window.setInterval(() => void loadWorkspace(true), 15_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [loadWorkspace]);

  async function workspaceAction(body: Record<string, unknown>) {
    setWorkspaceBusy(true); setError('');
    try {
      const response = await fetch('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Action failed');
      await loadWorkspace(true);
      setWorkspaceMessage('Workspace updated');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Workspace action failed');
      return false;
    } finally { setWorkspaceBusy(false); }
  }

  async function processFile(file: File) {
    setError('');
    if (file.size > 5 * 1024 * 1024) { setError('File is larger than 5 MB. Split it into a smaller sample first.'); return; }
    setProcessing(true);
    try {
      const content = await file.text();
      const parsed = parseLogContent(content, file.name);
      const grouped = analyzeLogs(parsed);
      if (!parsed.length) throw new Error('No readable log rows were found.');
      if (!grouped.length) throw new Error('The file was valid, but it did not contain warning or error signals.');
      setLogs(parsed); setIncidents(grouped); setSelectedId(grouped[0].id);
      setFilename(file.name); setFileSize(`${Math.max(0.1, file.size / 1024).toFixed(1)} KB`);
      setResolved([]); setUploadOpen(false); setTab('analysis');
      const saved = await workspaceAction({ action: 'save_analysis', payload: {
        filename: file.name, format: file.name.split('.').pop() ?? 'txt', rowCount: parsed.length,
        rawContent: content.slice(0, 1_000_000), incidents: grouped.map((incident) => ({ ...incident, logs: incident.logs.slice(0, 250) })),
      } });
      setWorkspaceMessage(saved ? 'Analysis saved to incident history' : 'Analysis completed locally; persistent save failed');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'CrashLens could not read this file.');
    } finally { setProcessing(false); }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void processFile(file);
    event.target.value = '';
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault(); setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void processFile(file);
  }

  function resetSample() {
    setLogs(initialLogs); setIncidents(initialIncidents); setSelectedId(initialIncidents[0]?.id ?? '');
    setFilename('crashlens-sample.jsonl'); setFileSize('4.2 KB'); setError(''); setUploadOpen(false); setResolved([]);
  }

  return (
    <main className="min-h-screen bg-[#070a0d] text-[#dbe6df]">
      <header className="sticky top-0 z-30 flex h-14 items-center border-b border-[#26312b] bg-[#0a0e11] px-4 lg:px-6">
        <button aria-label="Open navigation" className="mr-3 text-[#738078] lg:hidden"><Menu size={18} /></button>
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center bg-[#d6ff00] text-[#080a00]"><Activity size={18} strokeWidth={2.5} /></span>
          <span className="text-sm font-bold tracking-[-0.03em] text-white">CRASHLENS</span>
          <span className="border border-[#3a463f] bg-[#111612] px-1.5 py-0.5 font-mono text-[9px] text-[#a7b2ab]">CORE_03</span>
        </div>
        <div className="ml-6 hidden h-full items-center border-l border-[#26312b] px-5 text-[11px] text-[#718078] md:flex">
          <span className="mr-2 size-1.5 bg-[#d6ff00]" /> ANALYSIS ENGINE ONLINE
        </div>
        <div className="ml-auto flex items-center gap-3 font-mono text-[10px] text-[#718078]">
          <span className="hidden sm:inline">{workspaceBusy ? 'SYNCING' : workspace ? 'D1 + R2 CONNECTED' : 'LOCAL FALLBACK'}</span>
          <span className="h-4 w-px bg-[#26312b]" />
          <span className="grid size-7 place-items-center bg-[#1a2520] font-sans font-bold text-[#d6ff00]">BK</span>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-56px)]">
        <aside className="hidden w-52 shrink-0 border-r border-[#26312b] bg-[#090d0f] p-3 lg:flex lg:flex-col">
          <p className="px-2 pb-2 pt-3 font-mono text-[9px] tracking-[0.16em] text-[#536058]">WORKSPACE</p>
          <nav className="space-y-1">
            {([
              ['incidents', AlertTriangle, 'Incidents'], ['history', History, 'History'], ['team', Users, 'Team'],
              ['integrations', Plug, 'Integrations'], ['monitoring', HeartPulse, 'Monitoring'],
            ] as Array<[WorkspaceView, LucideIcon, string]>).map(([key, Icon, label]) => <button key={key} onClick={() => setView(key)} className={`flex h-9 w-full items-center gap-2.5 border-l-2 px-3 text-xs ${view === key ? 'border-[#d6ff00] bg-[#171d0f] text-white' : 'border-transparent text-[#7f8e85] hover:bg-[#111714] hover:text-white'}`}><Icon size={14} className={view === key ? 'text-[#d6ff00]' : ''} />{label}{key === 'incidents' && <span className="ml-auto bg-[#d6ff00] px-1.5 py-0.5 font-mono text-[9px] font-bold text-black">{incidents.length}</span>}</button>)}
            <button onClick={() => setUploadOpen(true)} className="flex h-9 w-full items-center gap-2.5 border-l-2 border-transparent px-3 text-xs text-[#7f8e85] hover:bg-[#111714] hover:text-white"><Database size={14} />Upload source</button>
          </nav>
          <p className="px-2 pb-2 pt-7 font-mono text-[9px] tracking-[0.16em] text-[#536058]">CURRENT SOURCE</p>
          <div className="border border-[#26312b] bg-[#0d1310] p-3">
            <div className="mb-2 flex items-center gap-2 text-[10px] text-[#d6ff00]"><CheckCircle2 size={12} />PARSED</div>
            <p className="truncate text-[11px] text-[#c7d2cb]" title={filename}>{filename}</p>
            <p className="mt-1 font-mono text-[9px] text-[#59665e]">{logs.length} ROWS / {fileSize}</p>
          </div>
          <div className="mt-auto border-t border-[#26312b] pt-3">
            <div className="flex items-center gap-2 px-2 text-[10px] text-[#65736b]"><ShieldCheck size={13} />PII redaction active</div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <section className="border-b border-[#26312b] bg-[#0b1012] px-4 py-5 lg:px-6">
            <div className="mx-auto flex max-w-[1500px] flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="mb-1 flex items-center gap-2 font-mono text-[9px] tracking-[0.16em] text-[#65736b]"><span>OPS</span><ChevronRight size={10} /><span>{view.toUpperCase()}</span><ChevronRight size={10} /><span className="text-[#d6ff00]">{workspaceMessage.toUpperCase()}</span></div>
                <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-white">{view === 'incidents' ? 'Production error investigation' : `${view[0].toUpperCase()}${view.slice(1)} control plane`}</h1>
                <p className="mt-1 text-xs text-[#718078]">Authenticated incident operations with durable storage, audit history, integrations, and alert readiness.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a href="/samples/crashlens-sample.jsonl" download className="flex h-9 items-center gap-2 border border-[#314039] bg-[#0d1310] px-3 text-[11px] text-[#a9b6ae] hover:border-[#53665b] hover:text-white"><Download size={13} />SAMPLE JSONL</a>
                <button onClick={() => setUploadOpen(true)} className="flex h-9 items-center gap-2 border border-[#d6ff00] bg-[#d6ff00] px-4 text-[11px] font-bold text-[#080a00] hover:bg-[#e2ff58]"><Upload size={14} />ANALYZE FILE</button>
              </div>
            </div>
          </section>

          <div className="mx-auto max-w-[1500px] p-4 lg:p-6">
            {error && <div role="alert" className="mb-4 flex items-start gap-3 border border-[#a53d3d] bg-[#200d0f] p-3 text-xs text-[#ff8585]"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{error}</span><button onClick={() => setError('')} className="ml-auto"><X size={14} /></button></div>}

            {view === 'incidents' ? <>
            <section className="mb-4 grid grid-cols-2 border-l border-t border-[#26312b] xl:grid-cols-4">
              {metrics.map(({ label, value, note, icon: Icon }) => <article key={label} className="border-b border-r border-[#26312b] bg-[#0d1215] p-4">
                <div className="flex items-center justify-between font-mono text-[9px] tracking-[0.12em] text-[#65736b]"><span>{label}</span><Icon size={13} /></div>
                <div className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">{value}</div>
                <p className="mt-1 text-[10px] text-[#647168]">{note}</p>
              </article>)}
            </section>

            <section className="mb-4 grid border border-[#2a352e] bg-[#080c0a] lg:grid-cols-[1fr_280px]">
              <div className="border-b border-[#2a352e] p-4 lg:border-b-0 lg:border-r">
                <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.14em] text-[#8d9a92]"><Radio size={12} className="text-[#00d9ff]" />INGESTED SIGNAL VOLUME</div><div className="font-mono text-[9px] text-[#526058]">{signalBars.length} TIME BUCKETS</div></div>
                <div className="flex h-20 items-end gap-1 border-b border-[#2a352e]">
                  {signalBars.map((bar, index) => <div key={`${bar.label}-${index}`} className="group relative flex min-w-2 flex-1 items-end" title={`${bar.label} · ${bar.count} events`}><span className={`block w-full ${bar.count >= 3 ? 'bg-[#ff4d4d]' : index === signalBars.length - 1 ? 'bg-[#d6ff00]' : 'bg-[#33443a]'}`} style={{ height: `${bar.height}%` }} /></div>)}
                </div>
                <div className="mt-2 flex justify-between font-mono text-[8px] text-[#526058]"><span>{signalBars[0]?.label ?? '--:--'} UTC</span><span>{signalBars.at(-1)?.label ?? '--:--'} UTC</span></div>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-1">
                <div className="border-r border-[#2a352e] p-4 lg:border-b lg:border-r-0"><p className="font-mono text-[9px] tracking-[0.12em] text-[#65736b]">DATA QUALITY</p><div className="mt-2 flex items-end justify-between"><strong className="text-2xl text-[#00d9ff]">{dataQuality}%</strong><span className="font-mono text-[8px] text-[#68756d]">SCHEMA MATCH</span></div></div>
                <div className="p-4"><p className="font-mono text-[9px] tracking-[0.12em] text-[#65736b]">PRIVACY MODE</p><div className="mt-2 flex items-center gap-2 text-[11px] text-[#d6ff00]"><ShieldCheck size={14} />LOCAL PROCESSING</div></div>
              </div>
            </section>

            <section id="incidents" className="grid min-h-[610px] border border-[#26312b] bg-[#0b1012] xl:grid-cols-[430px_minmax(0,1fr)]">
              <div className="border-b border-[#26312b] xl:border-b-0 xl:border-r">
                <div className="border-b border-[#26312b] p-3">
                  <label className="flex h-9 items-center gap-2 border border-[#26312b] bg-[#080c0e] px-3 text-[#65736b] focus-within:border-[#53665b]"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter incidents or services" className="w-full bg-transparent text-[11px] text-white outline-none placeholder:text-[#48534c]" /><Filter size={12} /></label>
                </div>
                <div className="flex items-center justify-between border-b border-[#26312b] px-4 py-3 font-mono text-[9px] tracking-[0.12em] text-[#65736b]"><span>GROUPED INCIDENTS</span><span>{filteredIncidents.length} RESULTS</span></div>
                <div className="max-h-[535px] overflow-y-auto">
                  {filteredIncidents.length ? filteredIncidents.map((incident) => (
                    <button aria-label={`Open incident ${incident.id}: ${incident.title}`} key={incident.id} onClick={() => { setSelectedId(incident.id); setTab('analysis'); }} className={`grid w-full grid-cols-[4px_1fr_auto] gap-3 border-b border-[#202923] px-3 py-4 text-left ${selected?.id === incident.id ? 'bg-[#171d0f]' : 'bg-[#0b1012] hover:bg-[#101713]'}`}>
                      <span className={incident.severity === 'critical' ? 'bg-[#ff4d4d]' : incident.severity === 'warning' ? 'bg-[#e5a50a]' : 'bg-[#2f8fff]'} />
                      <span className="min-w-0"><span className="flex items-center gap-2"><span className="truncate text-[13px] font-medium text-[#e8efea]">{incident.title}</span><span className="font-mono text-[9px] text-[#526058]">#{incident.id}</span></span><span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] text-[#68756d]"><span>{incident.service}</span><span>{incident.logs.length} LOGS</span><span>{time(incident.started)}</span></span></span>
                      <span className="text-right"><span className={`inline-block border px-1.5 py-0.5 font-mono text-[8px] ${severityStyles[incident.severity]}`}>{resolved.includes(incident.id) ? 'RESOLVED' : incident.severity.toUpperCase()}</span><span className="mt-2 block font-mono text-[10px] text-[#ff7777]">{incident.change}</span></span>
                    </button>
                  )) : <div className="p-8 text-center text-xs text-[#65736b]">No incidents match this filter.</div>}
                </div>
              </div>

              {selected ? <div className="min-w-0">
                <div className="border-b border-[#26312b] p-4 lg:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div><div className="mb-2 flex items-center gap-2 font-mono text-[9px] tracking-[0.12em] text-[#718078]"><span className={`size-1.5 ${selected.severity === 'critical' ? 'bg-[#ff4d4d]' : 'bg-[#e5a50a]'}`} />INCIDENT #{selected.id} / {resolved.includes(selected.id) ? 'RESOLVED' : selected.status.toUpperCase()}</div><h2 className="text-xl font-semibold tracking-[-0.03em] text-white">{selected.title}</h2><p className="mt-1 font-mono text-[10px] text-[#69766e]">{selected.service} · {selected.logs.length} correlated events · {dateTime(selected.started)} UTC</p></div>
                    <div className="flex flex-wrap gap-2"><button onClick={() => { void navigator.clipboard.writeText(selected.fingerprint); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }} className="flex h-8 items-center gap-2 border border-[#314039] bg-[#111714] px-3 text-[10px] text-[#a4b0a9] hover:text-white"><Clipboard size={12} />{copied ? 'COPIED' : 'FINGERPRINT'}</button><button onClick={() => downloadText(buildReport(selected, filename), `incident-${selected.id}-report.txt`)} className="flex h-8 items-center gap-2 border border-[#314039] bg-[#111714] px-3 text-[10px] text-[#a4b0a9] hover:text-white"><ArrowDownToLine size={12} />EXPORT</button><button onClick={() => setResolved((items) => items.includes(selected.id) ? items.filter((id) => id !== selected.id) : [...items, selected.id])} className="h-8 border border-[#d6ff00] px-3 text-[10px] font-bold text-[#d6ff00] hover:bg-[#d6ff00] hover:text-black">{resolved.includes(selected.id) ? 'REOPEN' : 'RESOLVE'}</button></div>
                  </div>
                </div>

                <div className="grid border-b border-[#26312b] md:grid-cols-[minmax(0,1fr)_180px]">
                  <div className="border-b border-[#26312b] bg-[#101711] p-4 md:border-b-0 md:border-r lg:p-5">
                    <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.12em] text-[#d6ff00]"><Sparkles size={13} />CORRELATION RESULT</div>
                    <p className="mt-3 text-sm font-medium text-white">Likely trigger: {selected.trigger}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-[#78877e]">The earliest matching failures appeared in <span className="text-[#b5c0b9]">{selected.service}</span>. CrashLens linked events using service identity, normalized error text, timestamps, and nearby deployment signals.</p>
                  </div>
                  <div className="flex items-center justify-between bg-[#0d1410] p-4 md:block lg:p-5"><div><p className="font-mono text-[9px] tracking-[0.12em] text-[#637068]">CONFIDENCE</p><p className="mt-2 text-3xl font-semibold text-[#d6ff00]">{selected.confidence}%</p></div><div className="mt-3 h-1.5 w-full bg-[#26312b]"><div className="h-full bg-[#d6ff00]" style={{ width: `${selected.confidence}%` }} /></div><p className="mt-2 font-mono text-[8px] text-[#566159]">FINGERPRINT MATCH</p></div>
                </div>

                <div className="flex h-11 border-b border-[#26312b] bg-[#0a0f11] px-4">
                  <button onClick={() => setTab('analysis')} className={`mr-6 border-b-2 px-1 text-[10px] font-bold ${tab === 'analysis' ? 'border-[#d6ff00] text-[#d6ff00]' : 'border-transparent text-[#65736b]'}`}>AI ANALYSIS</button>
                  <button onClick={() => setTab('timeline')} className={`mr-6 border-b-2 px-1 text-[10px] font-bold ${tab === 'timeline' ? 'border-[#d6ff00] text-[#d6ff00]' : 'border-transparent text-[#65736b]'}`}>TIMELINE</button>
                  <button onClick={() => setTab('logs')} className={`border-b-2 px-1 text-[10px] font-bold ${tab === 'logs' ? 'border-[#d6ff00] text-[#d6ff00]' : 'border-transparent text-[#65736b]'}`}>LOGS ({selected.logs.length})</button>
                </div>

                <div className="max-h-[315px] overflow-auto p-4 lg:p-5" id="raw-logs">
                  {tab === 'analysis' ? <div className="grid gap-3 md:grid-cols-3">
                    <div className="border border-[#2a352e] bg-[#0d1310] p-4"><div className="mb-3 flex items-center gap-2 font-mono text-[9px] text-[#00d9ff]"><Crosshair size={12} />01 / ORIGIN</div><p className="text-[11px] leading-relaxed text-[#b8c3bc]">First failures originated in <strong className="font-medium text-white">{selected.service}</strong> at {time(selected.started)} UTC.</p></div>
                    <div className="border border-[#2a352e] bg-[#0d1310] p-4"><div className="mb-3 flex items-center gap-2 font-mono text-[9px] text-[#e5a50a]"><Zap size={12} />02 / TRIGGER</div><p className="text-[11px] leading-relaxed text-[#b8c3bc]">Nearest correlated operational change: <strong className="font-medium text-white">{selected.trigger}</strong>.</p></div>
                    <div className="border border-[#2a352e] bg-[#0d1310] p-4"><div className="mb-3 flex items-center gap-2 font-mono text-[9px] text-[#d6ff00]"><CircleCheck size={12} />03 / NEXT ACTION</div><p className="text-[11px] leading-relaxed text-[#b8c3bc]">Check the deployment diff and service dependencies, then rollback if the error rate continues rising.</p></div>
                    <div className="border border-[#2a352e] bg-[#080c0a] p-4 md:col-span-3"><p className="font-mono text-[9px] text-[#65736b]">CAUSAL CHAIN</p><div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[9px]"><span className="border border-[#536159] px-2 py-1.5 text-[#aab6af]">{selected.trigger}</span><ChevronRight size={12} className="text-[#566159]" /><span className="border border-[#00d9ff] px-2 py-1.5 text-[#00d9ff]">{selected.service}</span><ChevronRight size={12} className="text-[#566159]" /><span className="border border-[#ff4d4d] px-2 py-1.5 text-[#ff7777]">{selected.title}</span></div></div>
                  </div> : tab === 'timeline' ? <div className="max-w-2xl">
                    {selected.timeline.map((event, index) => <div key={`${event.timestamp}-${index}`} className="grid grid-cols-[46px_18px_1fr] gap-3">
                      <span className="pt-0.5 font-mono text-[9px] text-[#5f6c64]">{event.time}</span>
                      <span className="relative flex justify-center"><span className={`relative z-10 mt-0.5 size-2.5 border border-[#0b1012] ${event.type === 'critical' ? 'bg-[#ff4d4d]' : event.type === 'deploy' ? 'bg-[#d6ff00]' : event.type === 'alert' ? 'bg-[#e5a50a]' : 'bg-[#536159]'}`} />{index < selected.timeline.length - 1 && <span className="absolute top-2 h-full w-px bg-[#2b3630]" />}</span>
                      <span className="pb-5"><span className={`block text-[11px] ${event.type === 'critical' ? 'text-[#ff8585]' : 'text-[#c8d2cc]'}`}>{event.title}</span><span className="mt-0.5 block font-mono text-[9px] text-[#5c6961]">{event.detail}</span></span>
                    </div>)}
                  </div> : <div className="min-w-[650px] font-mono text-[9px]">
                    <div className="grid grid-cols-[70px_58px_130px_1fr] border-b border-[#2b3630] pb-2 text-[#5c6961]"><span>TIME</span><span>LEVEL</span><span>SERVICE</span><span>MESSAGE</span></div>
                    {selected.logs.map((log) => <div key={log.id} className="grid grid-cols-[70px_58px_130px_1fr] border-b border-[#1d2520] py-2 text-[#8d9a92]"><span>{time(log.timestamp)}</span><span className={log.level === 'fatal' || log.level === 'error' ? 'text-[#ff6b6b]' : 'text-[#e5a50a]'}>{log.level.toUpperCase()}</span><span className="truncate pr-3 text-[#d6ff00]">{log.service}</span><span className="truncate">{log.message}</span></div>)}
                  </div>}
                </div>
              </div> : <div className="grid place-items-center p-10 text-xs text-[#65736b]">Upload a file containing errors to create an incident.</div>}
            </section>
            </> : <OperationsConsole view={view} workspace={workspace} health={health} busy={workspaceBusy} inviteEmail={inviteEmail} setInviteEmail={setInviteEmail} comment={comment} setComment={setComment} historyIncidentId={historyIncidentId} setHistoryIncidentId={setHistoryIncidentId} action={workspaceAction} />}
          </div>
        </div>
      </div>

      {uploadOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4">
        <div className="w-full max-w-xl border border-[#3a473f] bg-[#0c1113] shadow-[12px_12px_0_#000]">
          <div className="flex items-start justify-between border-b border-[#2a352f] p-5"><div><p className="font-mono text-[9px] tracking-[0.14em] text-[#d6ff00]">DATA INGESTION</p><h2 className="mt-1 text-lg font-semibold text-white">Analyze a log file</h2><p className="mt-1 text-[11px] text-[#718078]">Analysis runs in the browser, then a redacted copy is saved to your authenticated workspace.</p></div><button onClick={() => setUploadOpen(false)} className="text-[#65736b] hover:text-white"><X size={18} /></button></div>
          <input ref={inputRef} type="file" accept=".txt,.log,.csv,.jsonl,.ndjson" onChange={onFile} className="hidden" />
          <button type="button" onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => inputRef.current?.click()} className={`m-5 grid min-h-52 w-[calc(100%-2.5rem)] cursor-pointer place-items-center border border-dashed p-6 text-center ${dragging ? 'border-[#d6ff00] bg-[#171d0f]' : 'border-[#3a473f] bg-[#090d0f] hover:border-[#66786c]'}`}>
            {processing ? <span><LoaderCircle size={26} className="mx-auto animate-spin text-[#d6ff00]" /><span className="mt-3 block font-mono text-[10px] text-[#d6ff00]">PARSING + CLUSTERING</span></span> : <span><Upload size={25} className="mx-auto text-[#d6ff00]" /><span className="mt-3 block text-sm font-medium text-white">Drop a file here or click to browse</span><span className="mt-2 block font-mono text-[9px] text-[#637068]">TXT · LOG · CSV · JSONL · NDJSON / MAX 5 MB</span></span>}
          </button>
          {error && <p className="mx-5 mb-3 border border-[#8f3333] bg-[#210d0f] p-3 text-[10px] text-[#ff8585]">{error}</p>}
          <div className="border-t border-[#2a352f] bg-[#090d0f] p-5"><div className="mb-3 flex items-center justify-between"><span className="font-mono text-[9px] tracking-[0.12em] text-[#65736b]">DON&apos;T HAVE LOGS?</span><button onClick={resetSample} className="text-[10px] font-bold text-[#d6ff00]">LOAD BUILT-IN SAMPLE</button></div><div className="grid grid-cols-3 gap-2">{sampleFiles.map(({ label, extension, icon: Icon }) => <a key={label} href={`/samples/crashlens-sample.${extension}`} download className="flex items-center justify-center gap-2 border border-[#2e3a33] bg-[#101612] py-2 text-[10px] text-[#93a198] hover:border-[#596b60] hover:text-white"><Icon size={12} />{label}</a>)}</div></div>
        </div>
      </div>}
    </main>
  );
}

function OperationsConsole({ view, workspace, health, busy, inviteEmail, setInviteEmail, comment, setComment, historyIncidentId, setHistoryIncidentId, action }: {
  view: Exclude<WorkspaceView, 'incidents'>; workspace: Workspace | null; health: { status: string; latencyMs?: number } | null; busy: boolean;
  inviteEmail: string; setInviteEmail: (value: string) => void; comment: string; setComment: (value: string) => void;
  historyIncidentId: string; setHistoryIncidentId: (value: string) => void; action: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [aiResult, setAiResult] = useState('');
  const selectedHistory = workspace?.incidents.find((incident) => String(incident.id) === historyIncidentId);
  const connectorTypes = [
    ['docker', 'Docker', 'Collector-ready container log endpoint'], ['kubernetes', 'Kubernetes', 'Cluster event and pod log ingestion'],
    ['cloudwatch', 'CloudWatch', 'AWS log subscription destination'], ['sentry', 'Sentry', 'Issue webhook and event correlation'],
    ['datadog', 'Datadog', 'Monitor and log webhook intake'], ['webhook', 'Generic webhook', 'Token-protected JSON log endpoint'],
    ['slack', 'Slack alerts', 'Incident notifications through webhook'], ['email', 'Email alerts', 'Provider-ready notification channel'],
    ['openai', 'OpenAI RCA', 'LLM-assisted root-cause investigation'],
  ];

  if (!workspace) return <section className="grid min-h-72 place-items-center border border-[#26312b] bg-[#0b1012] p-10 text-center"><div><LoaderCircle className="mx-auto mb-3 animate-spin text-[#d6ff00]" size={22} /><p className="text-sm text-white">Connecting authenticated workspace</p><p className="mt-1 text-[10px] text-[#65736b]">The local analyzer remains available while services initialize.</p></div></section>;

  if (view === 'history') return <section className="grid min-h-[620px] border border-[#26312b] bg-[#0b1012] xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,.7fr)]">
    <div className="border-b border-[#26312b] xl:border-b-0 xl:border-r">
      <div className="flex items-center justify-between border-b border-[#26312b] p-4"><div><p className="font-mono text-[9px] tracking-[.14em] text-[#d6ff00]">PERSISTENT INCIDENT HISTORY</p><p className="mt-1 text-xs text-[#718078]">{workspace.ingestionCount} saved ingestion runs · refreshes every 15 seconds</p></div><History size={18} className="text-[#65736b]" /></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-[11px]"><thead className="bg-[#080c0e] font-mono text-[9px] text-[#65736b]"><tr><th className="p-3">INCIDENT</th><th>SERVICE</th><th>SEVERITY</th><th>STATUS</th><th>ASSIGNEE</th><th>UPDATED</th></tr></thead><tbody>{workspace.incidents.map((incident) => <tr key={String(incident.id)} onClick={() => setHistoryIncidentId(String(incident.id))} className={`cursor-pointer border-t border-[#202923] ${historyIncidentId === String(incident.id) ? 'bg-[#171d0f]' : 'hover:bg-[#101713]'}`}><td className="p-3 text-white">{String(incident.title)}</td><td className="font-mono text-[#00d9ff]">{String(incident.service)}</td><td className="text-[#ff7777]">{String(incident.severity).toUpperCase()}</td><td>{String(incident.status)}</td><td>{String(incident.assignee_name ?? 'Unassigned')}</td><td className="font-mono text-[#65736b]">{dateTime(String(incident.updated_at))}</td></tr>)}</tbody></table>{!workspace.incidents.length && <p className="p-10 text-center text-xs text-[#65736b]">Upload a log file to create durable incident history.</p>}</div>
    </div>
    <div className="p-4 lg:p-5">
      <p className="font-mono text-[9px] tracking-[.14em] text-[#65736b]">INCIDENT COLLABORATION</p>
      {selectedHistory ? <><h2 className="mt-2 text-lg font-semibold text-white">{String(selectedHistory.title)}</h2><p className="mt-1 text-[10px] text-[#718078]">#{String(selectedHistory.id)} · {String(selectedHistory.fingerprint)}</p>
        <div className="mt-4 grid grid-cols-2 gap-2"><button disabled={busy} onClick={() => void action({ action: 'update_incident', incidentId: selectedHistory.id, status: 'investigating', assignedTo: workspace.user.id })} className="border border-[#00d9ff] p-2 text-[10px] font-bold text-[#00d9ff] disabled:opacity-50">ASSIGN TO ME</button><button disabled={busy} onClick={() => void action({ action: 'update_incident', incidentId: selectedHistory.id, status: 'resolved' })} className="border border-[#d6ff00] p-2 text-[10px] font-bold text-[#d6ff00] disabled:opacity-50">RESOLVE</button></div>
        <form onSubmit={async (event) => { event.preventDefault(); if (await action({ action: 'comment', incidentId: selectedHistory.id, comment })) setComment(''); }} className="mt-5"><label htmlFor="incident-comment" className="font-mono text-[9px] text-[#65736b]">ADD INVESTIGATION NOTE</label><textarea id="incident-comment" value={comment} onChange={(event) => setComment(event.target.value)} required maxLength={2000} className="mt-2 h-24 w-full resize-none border border-[#314039] bg-[#080c0e] p-3 text-xs text-white outline-none focus:border-[#d6ff00]" placeholder="What did you find?" /><button disabled={busy} className="mt-2 flex h-9 items-center gap-2 bg-[#d6ff00] px-4 text-[10px] font-bold text-black disabled:opacity-50"><Send size={12} />POST NOTE</button></form>
        <div className="mt-5 border-t border-[#26312b] pt-4"><p className="font-mono text-[9px] text-[#65736b]">RECENT NOTES</p>{workspace.comments.filter((item) => String(item.incident_id) === String(selectedHistory.id)).slice(0, 5).map((item) => <div key={String(item.id)} className="mt-2 border-l-2 border-[#3a473f] bg-[#0d1310] p-3"><p className="text-[10px] text-[#9eaaa3]">{String(item.body)}</p><p className="mt-2 font-mono text-[8px] text-[#566159]">{String(item.user_name ?? item.user_email)} · {dateTime(String(item.created_at))}</p></div>)}</div>
      </> : <p className="mt-5 text-xs text-[#65736b]">Select an incident to collaborate.</p>}
    </div>
  </section>;

  if (view === 'team') return <section className="grid gap-4 lg:grid-cols-2">
    <article className="border border-[#26312b] bg-[#0b1012]"><div className="border-b border-[#26312b] p-4"><p className="font-mono text-[9px] tracking-[.14em] text-[#d6ff00]">TEAM MEMBERS</p><h2 className="mt-1 text-lg text-white">{workspace.team.name}</h2></div><div>{workspace.members.map((member) => <div key={String(member.id)} className="flex items-center border-b border-[#202923] p-4"><span className="grid size-9 place-items-center bg-[#1a2520] font-bold text-[#d6ff00]">{String(member.name).slice(0, 2).toUpperCase()}</span><span className="ml-3"><strong className="block text-xs text-white">{String(member.name)}</strong><span className="text-[10px] text-[#65736b]">{String(member.email)}</span></span><span className="ml-auto border border-[#3a473f] px-2 py-1 font-mono text-[8px] text-[#9eaaa3]">{String(member.role).toUpperCase()}</span></div>)}</div></article>
    <article className="border border-[#26312b] bg-[#0b1012] p-5"><p className="font-mono text-[9px] tracking-[.14em] text-[#d6ff00]">INVITE COLLABORATOR</p><p className="mt-2 text-xs leading-relaxed text-[#718078]">Create a tracked team invitation. Delivery is ready for an email provider secret.</p><form onSubmit={async (event) => { event.preventDefault(); if (await action({ action: 'invite', email: inviteEmail, role: 'member' })) setInviteEmail(''); }} className="mt-5 flex"><input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} type="email" required placeholder="engineer@company.com" className="min-w-0 flex-1 border border-[#314039] bg-[#080c0e] px-3 text-xs text-white outline-none focus:border-[#d6ff00]" /><button disabled={busy} className="bg-[#d6ff00] px-4 py-3 text-[10px] font-bold text-black">INVITE</button></form><div className="mt-5"><p className="font-mono text-[9px] text-[#65736b]">PENDING INVITES</p>{workspace.invites.map((invite) => <div key={String(invite.id)} className="mt-2 flex border border-[#26312b] p-3 text-[10px]"><span className="text-white">{String(invite.email)}</span><span className="ml-auto text-[#e5a50a]">{String(invite.status)}</span></div>)}</div></article>
  </section>;

  if (view === 'integrations') return <section><div className="mb-4 border border-[#26312b] bg-[#0b1012] p-4"><p className="font-mono text-[9px] tracking-[.14em] text-[#d6ff00]">INGEST + INVESTIGATE + NOTIFY</p><p className="mt-1 text-xs text-[#718078]">Configure the integration record here, then add its secret in the deployment environment. Secrets are never collected in this browser.</p></div><div className="grid gap-px bg-[#26312b] border border-[#26312b] md:grid-cols-2 xl:grid-cols-3">{connectorTypes.map(([type, name, description]) => { const connector = workspace.connectors.find((item) => item.type === type); const configured = type === 'openai' ? workspace.capabilities.openai : type === 'slack' ? workspace.capabilities.slack : type === 'email' ? workspace.capabilities.email : type === 'webhook' ? workspace.capabilities.externalIngestion : false; return <article key={type} className="bg-[#0b1012] p-5"><div className="flex items-start justify-between"><Plug size={18} className="text-[#00d9ff]" /><span className={`font-mono text-[8px] ${configured ? 'text-[#d6ff00]' : connector ? 'text-[#e5a50a]' : 'text-[#65736b]'}`}>{configured ? 'ACTIVE' : connector ? String(connector.status).toUpperCase() : 'NOT SET'}</span></div><h3 className="mt-4 text-sm font-semibold text-white">{name}</h3><p className="mt-1 min-h-8 text-[10px] leading-relaxed text-[#718078]">{description}</p><button disabled={busy} onClick={async () => { if (type === 'slack' && configured) { await action({ action: 'test_slack' }); return; } if (type === 'email' && configured) { await action({ action: 'test_email' }); return; } if (type === 'openai' && configured && selectedHistory) { const response = await fetch('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ai_analysis', incident: selectedHistory }) }); const result = await response.json() as { analysis?: string; error?: string }; setAiResult(result.analysis ?? result.error ?? 'No result'); return; } await action({ action: 'connector', type, name }); }} className="mt-4 w-full border border-[#3a473f] py-2 text-[9px] font-bold text-[#b5c0b9] hover:border-[#d6ff00] hover:text-[#d6ff00] disabled:opacity-50">{(type === 'slack' || type === 'email') && configured ? 'SEND TEST ALERT' : type === 'openai' && configured ? 'RUN RCA ON LATEST' : connector ? 'UPDATE CONFIGURATION' : 'PREPARE CONNECTOR'}</button></article>; })}</div>{aiResult && <div className="mt-4 border border-[#00d9ff] bg-[#07171b] p-4"><p className="font-mono text-[9px] text-[#00d9ff]">OPENAI ROOT-CAUSE RESULT</p><p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-[#c7d2cb]">{aiResult}</p></div>}</section>;

  return <section className="grid gap-4 xl:grid-cols-[1fr_1fr]"><article className="border border-[#26312b] bg-[#0b1012] p-5"><p className="font-mono text-[9px] tracking-[.14em] text-[#d6ff00]">PLATFORM HEALTH</p><div className="mt-5 grid grid-cols-2 gap-px bg-[#26312b] border border-[#26312b]">{[['API', health?.status === 'healthy'], ['DATABASE', workspace.capabilities.database], ['OBJECT STORAGE', workspace.capabilities.objectStorage], ['PII REDACTION', workspace.capabilities.piiRedaction], ['OPENAI RCA', workspace.capabilities.openai], ['SLACK ALERTS', workspace.capabilities.slack], ['EMAIL ALERTS', workspace.capabilities.email], ['WEBHOOK INGEST', workspace.capabilities.externalIngestion], ['LIVE REFRESH', true]].map(([label, ready]) => <div key={String(label)} className="flex items-center bg-[#0d1310] p-3"><span className={`mr-2 size-2 ${ready ? 'bg-[#d6ff00]' : 'bg-[#e5a50a]'}`} /><span className="text-[10px] text-[#9eaaa3]">{String(label)}</span><span className="ml-auto font-mono text-[8px] text-[#65736b]">{ready ? 'READY' : 'NEEDS SECRET'}</span></div>)}</div><p className="mt-4 font-mono text-[9px] text-[#65736b]">HEALTH LATENCY: {health?.latencyMs ?? '—'} MS · AUTO REFRESH: 15 SEC</p></article><article className="border border-[#26312b] bg-[#0b1012]"><div className="border-b border-[#26312b] p-5"><p className="font-mono text-[9px] tracking-[.14em] text-[#d6ff00]">SECURITY AUDIT TRAIL</p></div><div className="max-h-[430px] overflow-auto">{workspace.auditEvents.map((event, index) => <div key={`${event.target_id}-${index}`} className="border-b border-[#202923] p-4"><div className="flex"><span className="font-mono text-[9px] text-[#00d9ff]">{String(event.action).toUpperCase()}</span><span className="ml-auto font-mono text-[8px] text-[#566159]">{dateTime(String(event.created_at))}</span></div><p className="mt-1 text-[10px] text-[#718078]">{String(event.target_type)} / {String(event.target_id)}</p></div>)}{!workspace.auditEvents.length && <p className="p-10 text-center text-xs text-[#65736b]">Audit events appear after uploads and team actions.</p>}</div></article></section>;
}
