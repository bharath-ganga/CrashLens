'use client';

import { useState } from 'react';
import { Activity, AlertTriangle, ArrowUpRight, Boxes, Check, ChevronDown, Clock3, Command, FileUp, GitCommitHorizontal, Search, Settings2, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const incidents = [
  { id: '42', title: 'Checkout failures', service: 'payment-service', logs: '2,391', change: '+312%', status: 'Investigating', tone: 'critical', time: '14:32', trigger: 'Deployment #318', confidence: '87%', lead: '6 minutes before spike' },
  { id: '41', title: 'Elevated auth latency', service: 'identity-api', logs: '847', change: '+89%', status: 'Monitoring', tone: 'warning', time: '13:54', trigger: 'Redis failover', confidence: '73%', lead: '4 minutes before spike' },
  { id: '40', title: 'Image processing retries', service: 'media-worker', logs: '304', change: '+41%', status: 'Resolved', tone: 'resolved', time: '12:18', trigger: 'Memory limit reached', confidence: '91%', lead: '2 minutes before spike' },
];

const timeline = [
  { time: '14:26', title: 'Deployment completed', detail: 'payment-service · #318', type: 'deploy' },
  { time: '14:29', title: 'DB connections increased', detail: '42 → 118 active connections', type: 'signal' },
  { time: '14:31', title: 'API latency increased', detail: 'p95 crossed 1.8s', type: 'signal' },
  { time: '14:32', title: 'Error rate spiked', detail: '0.8% → 12.4%', type: 'critical' },
  { time: '14:34', title: 'Alert triggered', detail: 'Checkout SLO burn rate', type: 'alert' },
];

export default function Home() {
  const [selectedId, setSelectedId] = useState('42');
  const [ingestOpen, setIngestOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const selected = incidents.find((item) => item.id === selectedId) ?? incidents[0];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-5 px-5 lg:px-8">
          <div className="flex items-center gap-2.5 pr-4">
            <div className="grid size-8 place-items-center rounded-lg bg-lime-300 text-slate-950 shadow-[0_0_24px_rgba(190,242,100,.2)]"><Activity size={18} strokeWidth={2.4} /></div>
            <span className="text-[15px] font-semibold tracking-[-0.02em]">CrashLens</span>
          </div>
          <div className="hidden h-5 w-px bg-white/10 md:block" />
          <div className="hidden items-center gap-2 text-xs text-slate-400 md:flex"><span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />Production<ChevronDown size={13} /></div>
          <div className="ml-auto flex items-center gap-2">
            <button className="hidden h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3 text-xs text-slate-400 transition hover:border-white/20 hover:text-white sm:flex"><Search size={14} /> Search incidents <kbd className="ml-4 text-[10px] text-slate-600">⌘ K</kbd></button>
            <button aria-label="Settings" className="grid size-9 place-items-center rounded-lg text-slate-500 transition hover:bg-white/5 hover:text-white"><Settings2 size={16} /></button>
            <div className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-cyan-200 to-blue-500 text-[10px] font-bold text-slate-950">BK</div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-5 py-7 lg:px-8">
        <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div><p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">Live operations</p><h1 className="text-2xl font-semibold tracking-[-0.035em] text-white md:text-[28px]">Incident overview</h1><p className="mt-1 text-sm text-slate-500">AI-grouped production signals across 18 services</p></div>
          <div className="flex items-center gap-2"><span className="flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-xs text-slate-400"><Clock3 size={13} /> Last 24 hours <ChevronDown size={13} /></span><button onClick={() => setIngestOpen(true)} className="rounded-lg bg-lime-300 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-lime-200">Ingest logs</button></div>
        </div>

        <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Open incidents', '3', '2 need attention', AlertTriangle],
            ['Logs analyzed', '84.2k', '+18% today', Boxes],
            ['Mean time to detect', '2m 14s', '31s faster', Activity],
            ['Services healthy', '16 / 18', '88.9% coverage', Check],
          ].map(([label, value, note, Icon], index) => (
            <article key={String(label)} className="metric-card rounded-xl border border-white/[0.075] bg-card p-4 md:p-5">
              <div className="mb-4 flex items-center justify-between text-slate-500"><span className="text-xs">{String(label)}</span><Icon size={15} className={index === 0 ? 'text-red-400' : index === 3 ? 'text-emerald-400' : ''} /></div>
              <div className="text-xl font-semibold tracking-[-0.03em] text-white md:text-2xl">{String(value)}</div><p className="mt-1 text-[11px] text-slate-500">{String(note)}</p>
            </article>
          ))}
        </section>

        <section className="grid min-h-[560px] gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(520px,.95fr)]">
          <div className="overflow-hidden rounded-xl border border-white/[0.075] bg-card">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4"><div><h2 className="text-sm font-semibold text-white">Active incidents</h2><p className="mt-0.5 text-[11px] text-slate-500">Grouped by stack trace, service and time</p></div><button className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white"><Settings2 size={13} /> Filter</button></div>
            <div>
              {incidents.map((incident) => (
                <button type="button" onClick={() => { setSelectedId(incident.id); setAnalysisOpen(false); }} key={incident.id} className={`group grid w-full grid-cols-[auto_1fr_auto] gap-4 border-b border-white/[0.06] px-5 py-5 text-left transition last:border-0 ${selected.id === incident.id ? 'bg-white/[0.045] shadow-[inset_2px_0_0_#bef264]' : 'hover:bg-white/[0.025]'}`}>
                  <span className={`mt-1 size-2 rounded-full ${incident.tone === 'critical' ? 'bg-red-400 shadow-[0_0_9px_#f87171]' : incident.tone === 'warning' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                  <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium text-slate-100">{incident.title}</h3><span className="text-[10px] text-slate-600">#{incident.id}</span><span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${incident.tone === 'critical' ? 'bg-red-400/10 text-red-300' : incident.tone === 'warning' ? 'bg-amber-400/10 text-amber-300' : 'bg-emerald-400/10 text-emerald-300'}`}>{incident.status}</span></div><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500"><span>{incident.service}</span><span>{incident.logs} logs</span><span>Started {incident.time}</span></div></div>
                  <div className="text-right"><span className={`text-xs font-semibold ${incident.tone === 'critical' ? 'text-red-300' : 'text-amber-300'}`}>{incident.change}</span><ArrowUpRight size={14} className="ml-auto mt-3 text-slate-600 transition group-hover:text-slate-300" /></div>
                </button>
              ))}
            </div>
          </div>

          <aside className="rounded-xl border border-white/[0.075] bg-card p-5 md:p-6">
            <div className="flex items-start justify-between gap-4"><div><div className={`mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] ${selected.tone === 'critical' ? 'text-red-300' : selected.tone === 'warning' ? 'text-amber-300' : 'text-emerald-300'}`}><span className="size-1.5 rounded-full bg-current" /> Incident #{selected.id} · {selected.status}</div><h2 className="text-xl font-semibold tracking-[-0.03em] text-white">{selected.title}</h2><p className="mt-1 text-xs text-slate-500">{selected.service} · {selected.logs} related logs</p></div><button onClick={() => setAnalysisOpen((value) => !value)} className="rounded-lg border border-white/10 px-3 py-2 text-[11px] text-slate-400 hover:text-white">{analysisOpen ? 'Hide analysis' : 'View details'}</button></div>
            <div className="my-5 rounded-xl border border-lime-300/15 bg-lime-300/[0.045] p-4"><div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-lime-200"><Sparkles size={13} /> Likely trigger · {selected.confidence} confidence</div><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium text-white">{selected.trigger}</p><p className="mt-1 text-[11px] text-slate-500">{selected.service} · {selected.lead}</p></div><GitCommitHorizontal size={19} className="text-lime-300" /></div></div>
            {analysisOpen && <div className="mb-5 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4 text-[11px] leading-relaxed text-slate-400"><span className="mb-1 block font-medium text-cyan-200">CrashLens analysis</span>{selected.trigger} is the strongest correlated change. The first matching error appeared in {selected.service}, then propagated to two downstream dependencies. Rolling back and checking the connection pool is the recommended first action.</div>}
            <div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Incident timeline</h3><span className="text-[10px] text-slate-600">8 minute window</span></div>
            <div>
              {timeline.map((item, index) => (
                <div key={item.time} className="grid grid-cols-[44px_18px_1fr] gap-3"><span className="pt-0.5 font-mono text-[10px] text-slate-600">{item.time}</span><div className="relative flex justify-center"><span className={`relative z-10 mt-1 size-2.5 rounded-full border-2 border-card ${item.type === 'critical' ? 'bg-red-400 shadow-[0_0_8px_#f87171]' : item.type === 'deploy' ? 'bg-lime-300' : 'bg-slate-600'}`} />{index < timeline.length - 1 && <span className="absolute top-3 h-full w-px bg-white/[0.09]" />}</div><div className="pb-5"><p className={`text-xs ${item.type === 'critical' ? 'font-medium text-red-200' : 'text-slate-200'}`}>{item.title}</p><p className="mt-0.5 text-[10px] text-slate-600">{item.detail}</p></div></div>
              ))}
            </div>
            <button onClick={() => setAnalysisOpen(true)} className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] py-2.5 text-xs text-slate-400 transition hover:bg-white/[0.05] hover:text-white"><Command size={13} /> Ask CrashLens about this incident</button>
          </aside>
        </section>
      </div>

      <Dialog open={ingestOpen} onOpenChange={setIngestOpen}>
        <DialogContent className="border border-white/10 bg-[#10151d] p-0 text-slate-100 sm:max-w-lg">
          <DialogHeader className="p-5 pb-0"><DialogTitle>Ingest production logs</DialogTitle><DialogDescription>Drop a log export and CrashLens will group related errors into incidents.</DialogDescription></DialogHeader>
          <button onClick={() => setUploaded(true)} className={`mx-5 grid min-h-44 place-items-center rounded-xl border border-dashed p-6 text-center transition ${uploaded ? 'border-lime-300/40 bg-lime-300/[0.04]' : 'border-white/15 bg-white/[0.025] hover:border-white/25'}`}>
            <span><span className={`mx-auto mb-3 grid size-10 place-items-center rounded-full ${uploaded ? 'bg-lime-300 text-slate-950' : 'bg-white/[0.06] text-slate-400'}`}>{uploaded ? <Check size={18} /> : <FileUp size={18} />}</span><span className="block text-sm font-medium">{uploaded ? 'production-logs.jsonl ready' : 'Choose a log file'}</span><span className="mt-1 block text-[11px] text-slate-500">JSONL, TXT, or CSV · up to 50 MB</span></span>
          </button>
          <DialogFooter className="border-white/10 bg-white/[0.02]">
            <Button variant="ghost" onClick={() => setIngestOpen(false)}>Cancel</Button><Button disabled={!uploaded} onClick={() => setIngestOpen(false)} className="bg-lime-300 text-slate-950 hover:bg-lime-200">Analyze logs</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
