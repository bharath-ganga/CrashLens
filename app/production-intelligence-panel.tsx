'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  GitCommitHorizontal,
  Network,
  RadioTower,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';

type Span = {
  id: string;
  traceId: string;
  service: string;
  operation: string;
  status: 'ok' | 'error';
  durationMs: number;
  startedAt: string;
};

type Intelligence = {
  traces: Array<{
    traceId: string;
    status: string;
    durationMs: number;
    failedService: string | null;
    spans: Span[];
  }>;
  deployments: Array<{
    id: string;
    service: string;
    version: string;
    deployedAt: string;
    actor?: string | null;
  }>;
  anomaly: {
    detected: boolean;
    changePercent: number;
    currentErrors: number;
    previousErrors: number;
  };
  correlation: {
    failure: Span;
    deployment: { version: string; service: string; deployedAt: string } | null;
    windowMinutes: number;
  } | null;
  reliability: {
    targetPercent: number | null;
    observedPercent: number | null;
    errorBudgetRemaining: number | null;
    observedSpanCount: number;
  };
};

function download(content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: 'text/markdown' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `crashlens-postmortem-${new Date().toISOString().slice(0, 10)}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

const explanations = [
  {
    icon: RadioTower,
    title: 'Automatic data intake',
    text: 'Your application can send request traces to CrashLens automatically. No file upload is needed.',
  },
  {
    icon: Network,
    title: 'Request tracing',
    text: 'CrashLens follows one customer request through every service and highlights the exact failing step.',
  },
  {
    icon: GitCommitHorizontal,
    title: 'Deployment correlation',
    text: 'It checks whether a new version was released shortly before an error started.',
  },
  {
    icon: Activity,
    title: 'Anomaly detection',
    text: 'It compares recent errors with the previous period and flags a sudden unusual increase.',
  },
  {
    icon: ShieldCheck,
    title: 'Reliability target (SLO)',
    text: 'A target such as 99.9% tells the team how reliable the service should be and how much failure is acceptable.',
  },
  {
    icon: FileText,
    title: 'Postmortem report',
    text: 'After an incident, CrashLens creates a structured report of impact, evidence, and follow-up actions.',
  },
];

export default function ProductionIntelligencePanel() {
  const [data, setData] = useState<Intelligence | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [serviceInput, setServiceInput] = useState('');
  const [targetInput, setTargetInput] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/intelligence', { cache: 'no-store' });
    if (!response.ok) {
      setMessage(
        response.status === 401
          ? 'Sign in to save traces, deployments, SLOs, and reports.'
          : 'Production signals could not be loaded.',
      );
      return;
    }
    setData((await response.json()) as Intelligence);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function action(name: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: name, ...payload }),
      });
      const result = (await response.json()) as {
        error?: string;
        report?: string;
      };
      if (!response.ok) throw new Error(result.error || 'Action failed');
      if (result.report) {
        download(result.report);
        setMessage('Postmortem created, saved, and downloaded.');
      } else if (name === 'set_slo') {
        setMessage('Reliability target saved.');
      }
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  const trace = data?.traces[0];
  const reliability = data?.reliability;

  return (
    <div className="space-y-5">
      <section className="border border-[#232936] bg-[#11151D]">
        <div className="flex flex-col gap-4 border-b border-[#232936] p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#9D91FF]">
              Production intelligence
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              From one failed request to a clear explanation
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-[#8B95A7]">
              These tools connect errors, request paths, deployments, and
              reliability in one investigation.
            </p>
          </div>
          <div className="flex h-10 items-center gap-2 border border-[#343B4A] bg-[#0D1017] px-4 text-sm text-[#8B95A7]">
            <RadioTower size={16} />
            Waiting for real telemetry
          </div>
        </div>
        <div className="grid gap-px bg-[#232936] md:grid-cols-2 xl:grid-cols-3">
          {explanations.map(({ icon: Icon, title, text }, index) => (
            <article key={title} className="bg-[#11151D] p-5">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center border border-[#343B4A] bg-[#171C26] text-[#9D91FF]">
                  <Icon size={17} />
                </span>
                <span className="text-[11px] text-[#626C7D]">0{index + 1}</span>
              </div>
              <h3 className="mt-4 text-sm font-semibold text-white">{title}</h3>
              <p className="mt-2 text-xs leading-5 text-[#8B95A7]">{text}</p>
            </article>
          ))}
        </div>
      </section>

      {message && (
        <p className="border border-[#343B4A] bg-[#11151D] px-4 py-3 text-sm text-[#B5BECD]">
          {message}
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
        <section className="border border-[#232936] bg-[#11151D]">
          <div className="flex items-center justify-between border-b border-[#232936] p-5">
            <div>
              <h3 className="font-semibold text-white">Latest request trace</h3>
              <p className="mt-1 text-xs text-[#8B95A7]">
                One request followed across connected services
              </p>
            </div>
            {trace && (
              <span
                className={`text-xs font-semibold ${trace.status === 'error' ? 'text-[#FF6B79]' : 'text-[#55DE96]'}`}
              >
                {trace.status.toUpperCase()} · {trace.durationMs} ms
              </span>
            )}
          </div>
          {trace ? (
            <div className="overflow-x-auto p-5">
              <div className="flex min-w-max items-center">
                {trace.spans.map((span, index) => (
                  <div key={span.id} className="flex items-center">
                    <div
                      className={`w-44 border p-4 ${span.status === 'error' ? 'border-[#FF4D5E] bg-[#211114]' : 'border-[#343B4A] bg-[#0D1017]'}`}
                    >
                      <p className="text-xs font-semibold text-white">
                        {span.service}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-[#8B95A7]">
                        {span.operation}
                      </p>
                      <p className="mt-3 text-[11px] text-[#626C7D]">
                        {span.durationMs} ms
                      </p>
                    </div>
                    {index < trace.spans.length - 1 && (
                      <ArrowRight size={18} className="mx-3 text-[#626C7D]" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-[#8B95A7]">
              Connect OpenTelemetry to see a real request path.
            </div>
          )}
        </section>

        <section className="border border-[#232936] bg-[#11151D] p-5">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-white">Error anomaly</h3>
              <p className="mt-1 text-xs text-[#8B95A7]">
                Last 15 minutes vs previous 15
              </p>
            </div>
            {data?.anomaly.detected ? (
              <TriangleAlert size={20} className="text-[#FF6B79]" />
            ) : (
              <CheckCircle2 size={20} className="text-[#55DE96]" />
            )}
          </div>
          <p className="mt-8 text-4xl font-semibold text-white">
            {data?.anomaly.changePercent ?? 0}%
          </p>
          <p className="mt-2 text-xs text-[#8B95A7]">
            {data?.anomaly.detected
              ? 'Unusual increase detected'
              : 'No unusual spike detected'}
          </p>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="border border-[#232936] bg-[#11151D] p-5">
          <GitCommitHorizontal size={18} className="text-[#9D91FF]" />
          <h3 className="mt-4 text-sm font-semibold text-white">
            Possible trigger
          </h3>
          <p className="mt-3 text-lg font-semibold text-white">
            {data?.correlation?.deployment?.version ?? 'No recent deployment'}
          </p>
          <p className="mt-2 text-xs leading-5 text-[#8B95A7]">
            {data?.correlation?.deployment
              ? `Released before the first failure in ${data.correlation.failure.service}. This is evidence, not final proof.`
              : 'CrashLens checks the 60 minutes before the first error.'}
          </p>
        </section>
        <section className="border border-[#232936] bg-[#11151D] p-5">
          <ShieldCheck size={18} className="text-[#9D91FF]" />
          <h3 className="mt-4 text-sm font-semibold text-white">
            Service reliability
          </h3>
          <div className="mt-3 flex items-end justify-between">
            <p className="text-3xl font-semibold text-white">
              {reliability?.observedPercent == null
                ? '—'
                : `${reliability.observedPercent}%`}
            </p>
            <p className="text-xs text-[#8B95A7]">
              {reliability?.targetPercent == null
                ? 'Target not configured'
                : `Target ${reliability.targetPercent}%`}
            </p>
          </div>
          <div className="mt-4 h-2 bg-[#232936]">
            <div
              className="h-full bg-[#7C6CFF]"
              style={{ width: `${reliability?.errorBudgetRemaining ?? 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-[#8B95A7]">
            {reliability?.errorBudgetRemaining == null
              ? 'Set an SLO to calculate the error budget'
              : `${reliability.errorBudgetRemaining}% error budget remaining`}{' '}
            · {reliability?.observedSpanCount ?? 0} spans
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_90px_auto]">
            <input
              aria-label="Service name"
              value={serviceInput}
              onChange={(event) => setServiceInput(event.target.value)}
              placeholder="Service name"
              className="min-w-0 border border-[#343B4A] bg-[#0D1017] px-3 py-2 text-xs text-white placeholder:text-[#626C7D]"
            />
            <input
              aria-label="Reliability target percent"
              value={targetInput}
              onChange={(event) => setTargetInput(event.target.value)}
              className="min-w-0 flex-1 border border-[#343B4A] bg-[#0D1017] px-3 py-2 text-xs text-white"
              inputMode="decimal"
              placeholder="99.9"
            />
            <button
              onClick={() =>
                action('set_slo', {
                  service: serviceInput,
                  targetPercent: Number(targetInput),
                  windowDays: 30,
                })
              }
              disabled={busy}
              className="border border-[#343B4A] px-3 py-2 text-xs font-semibold text-white hover:bg-[#171C26]"
            >
              Save target
            </button>
          </div>
        </section>
        <section className="border border-[#232936] bg-[#11151D] p-5">
          <FileText size={18} className="text-[#9D91FF]" />
          <h3 className="mt-4 text-sm font-semibold text-white">Postmortem</h3>
          <p className="mt-2 text-xs leading-5 text-[#8B95A7]">
            Create a formal Markdown report with impact, evidence, root-cause
            status, and follow-up actions.
          </p>
          <button
            onClick={() => action('generate_postmortem')}
            disabled={busy}
            className="mt-5 flex items-center gap-2 border border-[#343B4A] px-3 py-2 text-xs font-semibold text-white hover:bg-[#171C26] disabled:opacity-60"
          >
            <Download size={14} /> Generate report
          </button>
        </section>
      </div>

      <section className="border border-[#232936] bg-[#0D1017] p-5">
        <h3 className="text-sm font-semibold text-white">
          How real data reaches this screen
        </h3>
        <div className="mt-4 grid gap-3 text-xs text-[#B5BECD] md:grid-cols-4">
          {[
            ['1', 'Add an OpenTelemetry SDK to your application.'],
            ['2', 'Send OTLP JSON spans to /api/telemetry.'],
            ['3', 'Send deployment events when CI/CD releases code.'],
            ['4', 'CrashLens joins the signals by service and time.'],
          ].map(([number, text]) => (
            <div
              key={number}
              className="border-l-2 border-[#7C6CFF] pl-3 leading-5"
            >
              <span className="block text-[#626C7D]">STEP {number}</span>
              {text}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
