'use client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

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
      <Card className="block py-0 border border-border bg-background">
        <div className="flex flex-col gap-4 border-b border-border p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-foreground">
              Production intelligence
            </p>
            <h2 className="mt-2 text-xl font-semibold text-foreground">
              From one failed request to a clear explanation
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              These tools connect errors, request paths, deployments, and
              reliability in one investigation.
            </p>
          </div>
          <div className="flex h-10 items-center gap-2 border border-border bg-muted px-4 text-sm text-muted-foreground">
            <RadioTower size={16} />
            Waiting for real telemetry
          </div>
        </div>
        <div className="grid gap-px bg-muted md:grid-cols-2 xl:grid-cols-3">
          {explanations.map(({ icon: Icon, title, text }, index) => (
            <article key={title} className="bg-background p-5">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center border border-border bg-muted text-foreground">
                  <Icon size={17} />
                </span>
                <span className="text-[11px] text-muted-foreground">
                  0{index + 1}
                </span>
              </div>
              <h3 className="mt-4 text-sm font-semibold text-foreground">
                {title}
              </h3>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {text}
              </p>
            </article>
          ))}
        </div>
      </Card>

      {message && (
        <p className="border border-border bg-background px-4 py-3 text-sm text-foreground">
          {message}
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
        <Card className="block py-0 border border-border bg-background">
          <div className="flex items-center justify-between border-b border-border p-5">
            <div>
              <h3 className="font-semibold text-foreground">
                Latest request trace
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                One request followed across connected services
              </p>
            </div>
            {trace && (
              <span
                className={`text-xs font-semibold ${trace.status === 'error' ? 'text-destructive' : 'text-success'}`}
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
                      className={`w-44 border p-4 ${span.status === 'error' ? 'border-destructive bg-destructive/10' : 'border-border bg-muted'}`}
                    >
                      <p className="text-xs font-semibold text-foreground">
                        {span.service}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        {span.operation}
                      </p>
                      <p className="mt-3 text-[11px] text-muted-foreground">
                        {span.durationMs} ms
                      </p>
                    </div>
                    {index < trace.spans.length - 1 && (
                      <ArrowRight
                        size={18}
                        className="mx-3 text-muted-foreground"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Connect OpenTelemetry to see a real request path.
            </div>
          )}
        </Card>

        <Card className="block py-0 border border-border bg-background p-5">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-foreground">Error anomaly</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Last 15 minutes vs previous 15
              </p>
            </div>
            {data?.anomaly.detected ? (
              <TriangleAlert size={20} className="text-destructive" />
            ) : (
              <CheckCircle2 size={20} className="text-success" />
            )}
          </div>
          <p className="mt-8 text-4xl font-semibold text-foreground">
            {data?.anomaly.changePercent ?? 0}%
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {data?.anomaly.detected
              ? 'Unusual increase detected'
              : 'No unusual spike detected'}
          </p>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="block py-0 border border-border bg-background p-5">
          <GitCommitHorizontal size={18} className="text-foreground" />
          <h3 className="mt-4 text-sm font-semibold text-foreground">
            Possible trigger
          </h3>
          <p className="mt-3 text-lg font-semibold text-foreground">
            {data?.correlation?.deployment?.version ?? 'No recent deployment'}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {data?.correlation?.deployment
              ? `Released before the first failure in ${data.correlation.failure.service}. This is evidence, not final proof.`
              : 'CrashLens checks the 60 minutes before the first error.'}
          </p>
        </Card>
        <Card className="block py-0 border border-border bg-background p-5">
          <ShieldCheck size={18} className="text-foreground" />
          <h3 className="mt-4 text-sm font-semibold text-foreground">
            Service reliability
          </h3>
          <div className="mt-3 flex items-end justify-between">
            <p className="text-3xl font-semibold text-foreground">
              {reliability?.observedPercent == null
                ? '—'
                : `${reliability.observedPercent}%`}
            </p>
            <p className="text-xs text-muted-foreground">
              {reliability?.targetPercent == null
                ? 'Target not configured'
                : `Target ${reliability.targetPercent}%`}
            </p>
          </div>
          <div className="mt-4 h-2 bg-muted">
            <div
              className="h-full bg-primary"
              style={{ width: `${reliability?.errorBudgetRemaining ?? 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {reliability?.errorBudgetRemaining == null
              ? 'Set an SLO to calculate the error budget'
              : `${reliability.errorBudgetRemaining}% error budget remaining`}{' '}
            · {reliability?.observedSpanCount ?? 0} spans
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_90px_auto]">
            <Input
              aria-label="Service name"
              value={serviceInput}
              onChange={(event) => setServiceInput(event.target.value)}
              placeholder="Service name"
              className="min-w-0 border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground"
            />
            <Input
              aria-label="Reliability target percent"
              value={targetInput}
              onChange={(event) => setTargetInput(event.target.value)}
              className="min-w-0 flex-1 border border-border bg-muted px-3 py-2 text-xs text-foreground"
              inputMode="decimal"
              placeholder="99.9"
            />
            <Button
              variant="ghost"
              type="button"
              onClick={() =>
                action('set_slo', {
                  service: serviceInput,
                  targetPercent: Number(targetInput),
                  windowDays: 30,
                })
              }
              disabled={busy}
              className="border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted"
            >
              Save target
            </Button>
          </div>
        </Card>
        <Card className="block py-0 border border-border bg-background p-5">
          <FileText size={18} className="text-foreground" />
          <h3 className="mt-4 text-sm font-semibold text-foreground">
            Postmortem
          </h3>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Create a formal Markdown report with impact, evidence, root-cause
            status, and follow-up actions.
          </p>
          <Button
            variant="ghost"
            type="button"
            onClick={() => action('generate_postmortem')}
            disabled={busy}
            className="mt-5 flex items-center gap-2 border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-60"
          >
            <Download size={14} /> Generate report
          </Button>
        </Card>
      </div>

      <section className="border border-border bg-muted p-5">
        <h3 className="text-sm font-semibold text-foreground">
          How real data reaches this screen
        </h3>
        <div className="mt-4 grid gap-3 text-xs text-foreground md:grid-cols-4">
          {[
            ['1', 'Add an OpenTelemetry SDK to your application.'],
            ['2', 'Send OTLP JSON spans to /api/telemetry.'],
            ['3', 'Send deployment events when CI/CD releases code.'],
            ['4', 'CrashLens joins the signals by service and time.'],
          ].map(([number, text]) => (
            <div
              key={number}
              className="border-l-2 border-foreground pl-3 leading-5"
            >
              <span className="block text-muted-foreground">STEP {number}</span>
              {text}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
