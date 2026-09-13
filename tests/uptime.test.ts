import assert from 'node:assert/strict';
import test from 'node:test';
import {
  monitorUrl,
  publicIPv4,
  nextMonitorState,
  probeEndpoint,
  safeMonitorHeaders,
} from '../lib/uptime.ts';
void test('monitor URLs reject credentials, local addresses, redirects-to-local entrypoints and non-HTTPS', () => {
  for (const url of [
    'http://example.com',
    'https://127.0.0.1',
    'https://[::1]',
    'https://localhost',
    'https://host.internal',
    'https://user:pass@example.com',
    'https://example.com/?token=x',
    'https://example.com:444/',
  ])
    assert.throws(() => monitorUrl(url));
  assert.equal(
    monitorUrl('https://status.cloudflare.com/health'),
    'https://status.cloudflare.com/health',
  );
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.1.1',
    '192.168.0.1',
    '100.64.0.1',
  ])
    assert.equal(publicIPv4(ip), false);
  assert.equal(publicIPv4('1.1.1.1'), true);
});
void test('outage opens once after threshold and recovers once', () => {
  assert.equal(nextMonitorState('up', 0, false, 3).opened, false);
  assert.equal(nextMonitorState('degraded', 2, false, 3).opened, true);
  assert.equal(nextMonitorState('down', 3, false, 3).opened, false);
  assert.equal(nextMonitorState('down', 4, true, 3).recovered, true);
  assert.equal(nextMonitorState('up', 0, true, 3).recovered, false);
});
void test('private DNS answers prevent the actual endpoint fetch', async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return Response.json({ Answer: [{ type: 1, data: '10.0.0.1' }] });
  }) as typeof fetch;
  assert.equal(
    (await probeEndpoint('https://example.com/', fetcher)).ok,
    false,
  );
  assert.equal(calls, 1);
});
void test('successful public probe uses HEAD without following redirects', async () => {
  const fetcher = (async (url: unknown, init: RequestInit) => {
    if (String(url).includes('dns-query'))
      return Response.json({ Answer: [{ type: 1, data: '1.1.1.1' }] });
    assert.equal(init.method, 'HEAD');
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  assert.equal((await probeEndpoint('https://example.com/', fetcher)).ok, true);
});
void test('advanced probe validates method, status, headers, and response body', async () => {
  const fetcher = (async (url: unknown, init: RequestInit) => {
    if (String(url).includes('dns-query'))
      return Response.json({ Answer: [{ type: 1, data: '1.1.1.1' }] });
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('x-environment'), 'production');
    assert.equal(init.body, '{"ping":true}');
    return new Response('{"status":"ready"}', {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const result = await probeEndpoint('https://example.com/health', fetcher, {
    method: 'POST',
    timeoutMs: 5000,
    expectedMin: 200,
    expectedMax: 204,
    assertionType: 'contains',
    assertionValue: 'ready',
    headers: { 'x-environment': 'production' },
    body: '{"ping":true}',
  });
  assert.equal(result.ok, true);
  assert.equal(result.httpStatus, 202);
  assert.equal(result.evidence.assertion, 'contains');
});
void test('secret-bearing monitor headers are rejected', () => {
  assert.throws(() => safeMonitorHeaders({ Authorization: 'Bearer secret' }));
  assert.throws(() => safeMonitorHeaders({ Cookie: 'session=secret' }));
  assert.deepEqual(safeMonitorHeaders({ 'x-environment': 'production' }), {
    'x-environment': 'production',
  });
});
