'use client';

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownToLine, Braces, CheckCircle2, ChevronRight,
  Clock3, Database, Download, FileCode2, FileText, Filter, ListTree,
  LoaderCircle, Menu, Search, Server, ShieldCheck, Sparkles, TerminalSquare, Upload, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { analyzeLogs, buildReport, Incident, LogEntry, parseLogContent, SAMPLE_JSONL } from '@/lib/log-analyzer';

const initialLogs = parseLogContent(SAMPLE_JSONL, 'crashlens-sample.jsonl');
const initialIncidents = analyzeLogs(initialLogs);

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
  const [tab, setTab] = useState<'timeline' | 'logs'>('timeline');
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [error, setError] = useState('');
  const [resolved, setResolved] = useState<string[]>([]);

  const selected = incidents.find((incident) => incident.id === selectedId) ?? incidents[0];
  const filteredIncidents = useMemo(() => incidents.filter((incident) =>
    `${incident.title} ${incident.service} ${incident.trigger}`.toLowerCase().includes(query.toLowerCase())), [incidents, query]);
  const serviceCount = new Set(logs.map((log) => log.service)).size;
  const errorCount = logs.filter((log) => log.level === 'error' || log.level === 'fatal').length;
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
      setResolved([]); setUploadOpen(false); setTab('timeline');
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
          <span className="grid size-8 place-items-center bg-[#a3ff12] text-[#061006]"><Activity size={18} strokeWidth={2.5} /></span>
          <span className="text-sm font-bold tracking-[-0.03em] text-white">CRASHLENS</span>
          <span className="border border-[#304037] bg-[#111814] px-1.5 py-0.5 font-mono text-[9px] text-[#93a39a]">MVP_02</span>
        </div>
        <div className="ml-6 hidden h-full items-center border-l border-[#26312b] px-5 text-[11px] text-[#718078] md:flex">
          <span className="mr-2 size-1.5 bg-[#a3ff12]" /> ANALYSIS ENGINE ONLINE
        </div>
        <div className="ml-auto flex items-center gap-3 font-mono text-[10px] text-[#718078]">
          <span className="hidden sm:inline">LOCAL-FIRST / FILE MODE</span>
          <span className="h-4 w-px bg-[#26312b]" />
          <span className="grid size-7 place-items-center bg-[#1a2520] font-sans font-bold text-[#a3ff12]">BK</span>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-56px)]">
        <aside className="hidden w-52 shrink-0 border-r border-[#26312b] bg-[#090d0f] p-3 lg:flex lg:flex-col">
          <p className="px-2 pb-2 pt-3 font-mono text-[9px] tracking-[0.16em] text-[#536058]">WORKSPACE</p>
          <nav className="space-y-1">
            <a className="flex h-9 items-center gap-2.5 border-l-2 border-[#a3ff12] bg-[#121a16] px-3 text-xs text-white" href="#incidents"><AlertTriangle size={14} className="text-[#a3ff12]" />Incidents<span className="ml-auto bg-[#a3ff12] px-1.5 py-0.5 font-mono text-[9px] font-bold text-black">{incidents.length}</span></a>
            <button onClick={() => setUploadOpen(true)} className="flex h-9 w-full items-center gap-2.5 px-3 text-xs text-[#7f8e85] hover:bg-[#111714] hover:text-white"><Database size={14} />Data sources</button>
            <a className="flex h-9 items-center gap-2.5 px-3 text-xs text-[#7f8e85] hover:bg-[#111714] hover:text-white" href="#raw-logs"><TerminalSquare size={14} />Raw logs</a>
          </nav>
          <p className="px-2 pb-2 pt-7 font-mono text-[9px] tracking-[0.16em] text-[#536058]">CURRENT SOURCE</p>
          <div className="border border-[#26312b] bg-[#0d1310] p-3">
            <div className="mb-2 flex items-center gap-2 text-[10px] text-[#a3ff12]"><CheckCircle2 size={12} />PARSED</div>
            <p className="truncate text-[11px] text-[#c7d2cb]" title={filename}>{filename}</p>
            <p className="mt-1 font-mono text-[9px] text-[#59665e]">{logs.length} ROWS / {fileSize}</p>
          </div>
          <div className="mt-auto border-t border-[#26312b] pt-3">
            <div className="flex items-center gap-2 px-2 text-[10px] text-[#65736b]"><ShieldCheck size={13} />Files stay in this browser</div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <section className="border-b border-[#26312b] bg-[#0b1012] px-4 py-5 lg:px-6">
            <div className="mx-auto flex max-w-[1500px] flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="mb-1 flex items-center gap-2 font-mono text-[9px] tracking-[0.16em] text-[#65736b]"><span>OPS</span><ChevronRight size={10} /><span>INCIDENTS</span><ChevronRight size={10} /><span className="text-[#a3ff12]">LIVE ANALYSIS</span></div>
                <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-white">Production error investigation</h1>
                <p className="mt-1 text-xs text-[#718078]">Upload logs. CrashLens normalizes, groups, and reconstructs the failure sequence.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a href="/samples/crashlens-sample.jsonl" download className="flex h-9 items-center gap-2 border border-[#314039] bg-[#0d1310] px-3 text-[11px] text-[#a9b6ae] hover:border-[#53665b] hover:text-white"><Download size={13} />SAMPLE JSONL</a>
                <button onClick={() => setUploadOpen(true)} className="flex h-9 items-center gap-2 border border-[#a3ff12] bg-[#a3ff12] px-4 text-[11px] font-bold text-[#061006] hover:bg-[#b8ff45]"><Upload size={14} />ANALYZE FILE</button>
              </div>
            </div>
          </section>

          <div className="mx-auto max-w-[1500px] p-4 lg:p-6">
            {error && <div role="alert" className="mb-4 flex items-start gap-3 border border-[#a53d3d] bg-[#200d0f] p-3 text-xs text-[#ff8585]"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{error}</span><button onClick={() => setError('')} className="ml-auto"><X size={14} /></button></div>}

            <section className="mb-4 grid grid-cols-2 border-l border-t border-[#26312b] xl:grid-cols-4">
              {metrics.map(({ label, value, note, icon: Icon }) => <article key={label} className="border-b border-r border-[#26312b] bg-[#0d1215] p-4">
                <div className="flex items-center justify-between font-mono text-[9px] tracking-[0.12em] text-[#65736b]"><span>{label}</span><Icon size={13} /></div>
                <div className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">{value}</div>
                <p className="mt-1 text-[10px] text-[#647168]">{note}</p>
              </article>)}
            </section>

            <section id="incidents" className="grid min-h-[610px] border border-[#26312b] bg-[#0b1012] xl:grid-cols-[430px_minmax(0,1fr)]">
              <div className="border-b border-[#26312b] xl:border-b-0 xl:border-r">
                <div className="border-b border-[#26312b] p-3">
                  <label className="flex h-9 items-center gap-2 border border-[#26312b] bg-[#080c0e] px-3 text-[#65736b] focus-within:border-[#53665b]"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter incidents or services" className="w-full bg-transparent text-[11px] text-white outline-none placeholder:text-[#48534c]" /><Filter size={12} /></label>
                </div>
                <div className="flex items-center justify-between border-b border-[#26312b] px-4 py-3 font-mono text-[9px] tracking-[0.12em] text-[#65736b]"><span>GROUPED INCIDENTS</span><span>{filteredIncidents.length} RESULTS</span></div>
                <div className="max-h-[535px] overflow-y-auto">
                  {filteredIncidents.length ? filteredIncidents.map((incident) => (
                    <button aria-label={`Open incident ${incident.id}: ${incident.title}`} key={incident.id} onClick={() => { setSelectedId(incident.id); setTab('timeline'); }} className={`grid w-full grid-cols-[4px_1fr_auto] gap-3 border-b border-[#202923] px-3 py-4 text-left ${selected?.id === incident.id ? 'bg-[#131c17]' : 'bg-[#0b1012] hover:bg-[#101713]'}`}>
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
                    <div className="flex gap-2"><button onClick={() => downloadText(buildReport(selected, filename), `incident-${selected.id}-report.txt`)} className="flex h-8 items-center gap-2 border border-[#314039] bg-[#111714] px-3 text-[10px] text-[#a4b0a9] hover:text-white"><ArrowDownToLine size={12} />EXPORT REPORT</button><button onClick={() => setResolved((items) => items.includes(selected.id) ? items.filter((id) => id !== selected.id) : [...items, selected.id])} className="h-8 border border-[#a3ff12] px-3 text-[10px] font-bold text-[#a3ff12] hover:bg-[#a3ff12] hover:text-black">{resolved.includes(selected.id) ? 'REOPEN' : 'MARK RESOLVED'}</button></div>
                  </div>
                </div>

                <div className="grid border-b border-[#26312b] md:grid-cols-[minmax(0,1fr)_180px]">
                  <div className="border-b border-[#26312b] bg-[#101711] p-4 md:border-b-0 md:border-r lg:p-5">
                    <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.12em] text-[#a3ff12]"><Sparkles size={13} />CORRELATION RESULT</div>
                    <p className="mt-3 text-sm font-medium text-white">Likely trigger: {selected.trigger}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-[#78877e]">The earliest matching failures appeared in <span className="text-[#b5c0b9]">{selected.service}</span>. CrashLens linked events using service identity, normalized error text, timestamps, and nearby deployment signals.</p>
                  </div>
                  <div className="flex items-center justify-between bg-[#0d1410] p-4 md:block lg:p-5"><div><p className="font-mono text-[9px] tracking-[0.12em] text-[#637068]">CONFIDENCE</p><p className="mt-2 text-3xl font-semibold text-[#a3ff12]">{selected.confidence}%</p></div><div className="mt-3 h-1.5 w-full bg-[#26312b]"><div className="h-full bg-[#a3ff12]" style={{ width: `${selected.confidence}%` }} /></div><p className="mt-2 font-mono text-[8px] text-[#566159]">FINGERPRINT MATCH</p></div>
                </div>

                <div className="flex h-11 border-b border-[#26312b] bg-[#0a0f11] px-4">
                  <button onClick={() => setTab('timeline')} className={`mr-6 border-b-2 px-1 text-[10px] font-bold ${tab === 'timeline' ? 'border-[#a3ff12] text-[#a3ff12]' : 'border-transparent text-[#65736b]'}`}>TIMELINE</button>
                  <button onClick={() => setTab('logs')} className={`border-b-2 px-1 text-[10px] font-bold ${tab === 'logs' ? 'border-[#a3ff12] text-[#a3ff12]' : 'border-transparent text-[#65736b]'}`}>RELATED LOGS ({selected.logs.length})</button>
                </div>

                <div className="max-h-[315px] overflow-auto p-4 lg:p-5" id="raw-logs">
                  {tab === 'timeline' ? <div className="max-w-2xl">
                    {selected.timeline.map((event, index) => <div key={`${event.timestamp}-${index}`} className="grid grid-cols-[46px_18px_1fr] gap-3">
                      <span className="pt-0.5 font-mono text-[9px] text-[#5f6c64]">{event.time}</span>
                      <span className="relative flex justify-center"><span className={`relative z-10 mt-0.5 size-2.5 border border-[#0b1012] ${event.type === 'critical' ? 'bg-[#ff4d4d]' : event.type === 'deploy' ? 'bg-[#a3ff12]' : event.type === 'alert' ? 'bg-[#e5a50a]' : 'bg-[#536159]'}`} />{index < selected.timeline.length - 1 && <span className="absolute top-2 h-full w-px bg-[#2b3630]" />}</span>
                      <span className="pb-5"><span className={`block text-[11px] ${event.type === 'critical' ? 'text-[#ff8585]' : 'text-[#c8d2cc]'}`}>{event.title}</span><span className="mt-0.5 block font-mono text-[9px] text-[#5c6961]">{event.detail}</span></span>
                    </div>)}
                  </div> : <div className="min-w-[650px] font-mono text-[9px]">
                    <div className="grid grid-cols-[70px_58px_130px_1fr] border-b border-[#2b3630] pb-2 text-[#5c6961]"><span>TIME</span><span>LEVEL</span><span>SERVICE</span><span>MESSAGE</span></div>
                    {selected.logs.map((log) => <div key={log.id} className="grid grid-cols-[70px_58px_130px_1fr] border-b border-[#1d2520] py-2 text-[#8d9a92]"><span>{time(log.timestamp)}</span><span className={log.level === 'fatal' || log.level === 'error' ? 'text-[#ff6b6b]' : 'text-[#e5a50a]'}>{log.level.toUpperCase()}</span><span className="truncate pr-3 text-[#a3ff12]">{log.service}</span><span className="truncate">{log.message}</span></div>)}
                  </div>}
                </div>
              </div> : <div className="grid place-items-center p-10 text-xs text-[#65736b]">Upload a file containing errors to create an incident.</div>}
            </section>
          </div>
        </div>
      </div>

      {uploadOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4">
        <div className="w-full max-w-xl border border-[#3a473f] bg-[#0c1113] shadow-[12px_12px_0_#000]">
          <div className="flex items-start justify-between border-b border-[#2a352f] p-5"><div><p className="font-mono text-[9px] tracking-[0.14em] text-[#a3ff12]">DATA INGESTION</p><h2 className="mt-1 text-lg font-semibold text-white">Analyze a log file</h2><p className="mt-1 text-[11px] text-[#718078]">CrashLens reads the file locally. Nothing is uploaded to a server.</p></div><button onClick={() => setUploadOpen(false)} className="text-[#65736b] hover:text-white"><X size={18} /></button></div>
          <input ref={inputRef} type="file" accept=".txt,.log,.csv,.jsonl,.ndjson" onChange={onFile} className="hidden" />
          <button type="button" onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => inputRef.current?.click()} className={`m-5 grid min-h-52 w-[calc(100%-2.5rem)] cursor-pointer place-items-center border border-dashed p-6 text-center ${dragging ? 'border-[#a3ff12] bg-[#131c12]' : 'border-[#3a473f] bg-[#090d0f] hover:border-[#66786c]'}`}>
            {processing ? <span><LoaderCircle size={26} className="mx-auto animate-spin text-[#a3ff12]" /><span className="mt-3 block font-mono text-[10px] text-[#a3ff12]">PARSING + CLUSTERING</span></span> : <span><Upload size={25} className="mx-auto text-[#a3ff12]" /><span className="mt-3 block text-sm font-medium text-white">Drop a file here or click to browse</span><span className="mt-2 block font-mono text-[9px] text-[#637068]">TXT · LOG · CSV · JSONL · NDJSON / MAX 5 MB</span></span>}
          </button>
          {error && <p className="mx-5 mb-3 border border-[#8f3333] bg-[#210d0f] p-3 text-[10px] text-[#ff8585]">{error}</p>}
          <div className="border-t border-[#2a352f] bg-[#090d0f] p-5"><div className="mb-3 flex items-center justify-between"><span className="font-mono text-[9px] tracking-[0.12em] text-[#65736b]">DON&apos;T HAVE LOGS?</span><button onClick={resetSample} className="text-[10px] font-bold text-[#a3ff12]">LOAD BUILT-IN SAMPLE</button></div><div className="grid grid-cols-3 gap-2">{sampleFiles.map(({ label, extension, icon: Icon }) => <a key={label} href={`/samples/crashlens-sample.${extension}`} download className="flex items-center justify-center gap-2 border border-[#2e3a33] bg-[#101612] py-2 text-[10px] text-[#93a198] hover:border-[#596b60] hover:text-white"><Icon size={12} />{label}</a>)}</div></div>
        </div>
      </div>}
    </main>
  );
}
