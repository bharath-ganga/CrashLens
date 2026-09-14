export type TelemetrySpan = {
  id: string;
  traceId: string;
  parentSpanId?: string | null;
  service: string;
  operation: string;
  status: 'ok' | 'error';
  startedAt: string;
  durationMs: number;
  environment: string;
  attributes?: Record<string, unknown>;
};

export type DeploymentSignal = {
  id: string;
  service: string;
  version: string;
  environment: string;
  status: string;
  deployedAt: string;
  actor?: string | null;
};

export function calculateAnomaly(
  currentErrors: number,
  previousErrors: number,
) {
  if (currentErrors === 0) return { detected: false, changePercent: 0 };
  if (previousErrors === 0)
    return { detected: currentErrors >= 3, changePercent: currentErrors * 100 };
  const changePercent = Math.round(
    ((currentErrors - previousErrors) / previousErrors) * 100,
  );
  return {
    detected: currentErrors >= 3 && changePercent >= 100,
    changePercent,
  };
}

export function correlateDeployment(
  service: string,
  errorStartedAt: string,
  deployments: DeploymentSignal[],
) {
  const errorTime = new Date(errorStartedAt).getTime();
  return (
    deployments
      .filter((deployment) => {
        const deployed = new Date(deployment.deployedAt).getTime();
        const minutesBefore = (errorTime - deployed) / 60_000;
        return (
          deployment.service === service &&
          minutesBefore >= 0 &&
          minutesBefore <= 60
        );
      })
      .sort(
        (a, b) =>
          new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime(),
      )[0] ?? null
  );
}

export function errorBudgetPercent(
  successfulRequests: number,
  totalRequests: number,
  targetPercent: number,
) {
  if (!totalRequests) return 100;
  const allowedFailures = totalRequests * (1 - targetPercent / 100);
  if (allowedFailures <= 0)
    return successfulRequests === totalRequests ? 100 : 0;
  const actualFailures = totalRequests - successfulRequests;
  return Math.max(
    0,
    Math.min(100, Math.round((1 - actualFailures / allowedFailures) * 100)),
  );
}

export function buildPostmortem(input: {
  title: string;
  service: string;
  startedAt: string;
  resolvedAt?: string | null;
  deployment?: DeploymentSignal | null;
  traceId?: string | null;
}) {
  const deploymentLine = input.deployment
    ? `Deployment ${input.deployment.version} was released to ${input.deployment.environment} shortly before the incident.`
    : 'No deployment was found in the 60 minutes before the incident.';
  return `# Incident postmortem: ${input.title}

## Summary
CrashLens detected a production failure in **${input.service}** beginning at ${input.startedAt}.

## Impact
Requests handled by ${input.service} may have failed or responded slowly during the incident window.

## Evidence
- ${deploymentLine}
${input.traceId ? `- Trace ${input.traceId} shows the request path across affected services.` : '- No distributed trace was attached.'}

## Root-cause status
The evidence above is correlated automatically. An engineer must confirm the final root cause.

## Follow-up actions
1. Review the first failing span and its logs.
2. Compare the deployed version with the previous stable version.
3. Add or adjust an SLO alert for this service.

## Resolution
${input.resolvedAt ? `Resolved at ${input.resolvedAt}.` : 'The incident is still under investigation.'}
`;
}
