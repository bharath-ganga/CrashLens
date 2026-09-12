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
};

export async function probeEndpoint(
  input: string,
  fetcher: typeof fetch = fetch,
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
    const response = await fetcher(target.href, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'CrashLens-Uptime/1.0',
        'Cache-Control': 'no-cache',
      },
    });
    await response.body?.cancel();
    return {
      ok: response.status >= 200 && response.status < 300,
      latencyMs: Date.now() - start,
      httpStatus: response.status,
      error:
        response.status >= 200 && response.status < 300
          ? null
          : `HTTP ${response.status} (redirects are not followed)`,
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
    };
  }
}
