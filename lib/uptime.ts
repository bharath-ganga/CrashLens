// Allow only public DNS hostnames; redirects are never followed by the probe.
export function monitorUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2048)
    throw new Error('Enter a public HTTPS URL.');
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Enter a valid HTTPS URL.');
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.port && url.port !== '443') ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
    /(?:^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(
      host,
    ) ||
    host.endsWith('.arpa')
  ) {
    throw new Error(
      'Use a public HTTPS hostname with no credentials, query string, fragment, or custom port.',
    );
  }
  return url.href;
}

export function publicIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return false;
  const [a, b] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0)
  );
}

export function nextMonitorState(
  previous: string,
  failures: number,
  ok: boolean,
  threshold: number,
) {
  const count = ok ? 0 : failures + 1;
  const status = ok
    ? 'up'
    : count >= threshold
      ? 'down'
      : previous === 'down'
        ? 'down'
        : 'degraded';
  return {
    status,
    failures: count,
    opened: status === 'down' && previous !== 'down',
    recovered: ok && previous === 'down',
  };
}

export type Probe = {
  ok: boolean;
  latencyMs: number;
  httpStatus: number | null;
  error: string | null;
  evidence: Record<string, unknown>;
};

export type ProbeConfig = {
  method?: string;
  timeoutMs?: number;
  expectedMin?: number;
  expectedMax?: number;
  assertionType?: string;
  assertionValue?: string | null;
  headers?: Record<string, string>;
  body?: string | null;
};

export function safeMonitorHeaders(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Headers must be a JSON object.');
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      !/^[a-z0-9-]{1,60}$/i.test(key) ||
      typeof value !== 'string' ||
      value.length > 500
    )
      throw new Error('Invalid request header.');
    if (/^(authorization|cookie|proxy-|x-api-key)/i.test(key))
      throw new Error('Secret-bearing request headers are not stored.');
    output[key] = value;
  }
  return output;
}

function assertionMatches(type: string, expected: string, actual: string) {
  if (type === 'contains') return actual.includes(expected);
  if (type === 'exact') return actual === expected;
  if (type === 'regex') {
    if (
      expected.length > 200 ||
      /\\\d|\(\?[:=!<]|\([^)]*[+*][^)]*\)[+*{]/.test(expected)
    )
      throw new Error('Unsafe regular expression');
    return new RegExp(expected).test(actual.slice(0, 16000));
  }
  return true;
}

export async function probeEndpoint(
  input: string,
  fetcher: typeof fetch = fetch,
  config: ProbeConfig = {},
): Promise<Probe> {
  const start = Date.now();
  try {
    const target = new URL(monitorUrl(input));
    // Reject DNS names which resolve into a private network. Cloudflare's public
    // outbound fetch also supplies network isolation; do not run this on a private-network proxy.
    const dns = await fetcher(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(target.hostname)}&type=A`,
      {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      },
    );
    if (!dns.ok) throw new Error('DNS lookup unavailable');
    const data = (await dns.json()) as {
      Answer?: { type: number; data: string }[];
    };
    const addresses = (data.Answer ?? []).filter((a) => a.type === 1);
    if (!addresses.length || addresses.some((a) => !publicIPv4(a.data)))
      throw new Error('Endpoint must resolve to public IPv4 addresses');
    const method = String(config.method ?? 'HEAD').toUpperCase();
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
      throw new Error('Unsupported method');
    const timeoutMs = Math.max(
      1000,
      Math.min(30000, Number(config.timeoutMs ?? 10000)),
    );
    const response = await fetcher(target.href, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'CrashLens-Uptime/1.0',
        'Cache-Control': 'no-cache',
        ...safeMonitorHeaders(config.headers ?? {}),
      },
      body: ['GET', 'HEAD'].includes(method)
        ? undefined
        : String(config.body ?? '').slice(0, 4096),
    });
    const min = Number(config.expectedMin ?? 200),
      max = Number(config.expectedMax ?? 299);
    const responseText =
      method === 'HEAD' ? '' : (await response.text()).slice(0, 16000);
    const assertionType = String(config.assertionType ?? 'none');
    const assertionValue = String(config.assertionValue ?? '');
    const statusOk = response.status >= min && response.status <= max;
    const assertionOk =
      assertionType === 'none' ||
      assertionMatches(assertionType, assertionValue, responseText);
    const ok = statusOk && assertionOk;
    return {
      ok,
      latencyMs: Date.now() - start,
      httpStatus: response.status,
      error: ok
        ? null
        : !statusOk
          ? `Expected HTTP ${min}-${max}, got ${response.status}`
          : `Body assertion ${assertionType} failed`,
      evidence: {
        method,
        status: response.status,
        expectedStatus: `${min}-${max}`,
        assertion: assertionType,
        contentType: response.headers.get('content-type'),
        responseBytes: responseText.length,
        capturedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      httpStatus: null,
      error:
        error instanceof Error && error.name === 'TimeoutError'
          ? 'Check timed out'
          : 'Connection or public DNS check failed',
      evidence: {
        capturedAt: new Date().toISOString(),
        outcome: 'connection_failed',
      },
    };
  }
}
