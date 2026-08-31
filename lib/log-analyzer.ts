export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogEntry = {
  id: string;
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  raw: string;
};

export type TimelineEvent = {
  timestamp: string;
  time: string;
  title: string;
  detail: string;
  type: 'deploy' | 'signal' | 'critical' | 'alert' | 'log';
};

export type Incident = {
  id: string;
  title: string;
  service: string;
  logs: LogEntry[];
  severity: 'critical' | 'warning' | 'info';
  status: 'Investigating' | 'Monitoring';
  started: string;
  lastSeen: string;
  change: string;
  trigger: string;
  confidence: number;
  fingerprint: string;
  timeline: TimelineEvent[];
};

const levelOrder: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };

function stringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value == null) return fallback;
  try { return JSON.stringify(value); } catch { return fallback; }
}

function normalizeLevel(value: unknown): LogLevel {
  const level = stringValue(value, 'info').toLowerCase();
  if (level.includes('fatal') || level.includes('critical')) return 'fatal';
  if (level.includes('error') || level === 'err') return 'error';
  if (level.includes('warn')) return 'warn';
  if (level.includes('debug') || level.includes('trace')) return 'debug';
  return 'info';
}

function validTimestamp(value: unknown, fallbackIndex: number): string {
  const raw = stringValue(value).trim();
  const parsed = Date.parse(raw.replace(' ', 'T'));
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  const timeOnly = raw.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (timeOnly) return `2026-08-31T${timeOnly[1]}:${timeOnly[2]}:${timeOnly[3] ?? '00'}.000Z`;
  return new Date(Date.UTC(2026, 7, 31, 12, 0, fallbackIndex)).toISOString();
}

function cleanService(value: unknown): string {
  return stringValue(value, 'unknown-service').trim().replace(/[^a-zA-Z0-9_.-]/g, '-') || 'unknown-service';
}

function fromRecord(record: Record<string, unknown>, raw: string, index: number): LogEntry {
  const timestamp = record.timestamp ?? record['@timestamp'] ?? record.time ?? record.datetime ?? record.date;
  const level = record.level ?? record.severity ?? record.status;
  const service = record.service ?? record.app ?? record.application ?? record.component ?? record.source;
  const message = record.message ?? record.msg ?? record.error ?? record.event ?? record.description ?? raw;
  return {
    id: `log-${index + 1}`,
    timestamp: validTimestamp(timestamp, index),
    level: normalizeLevel(level),
    service: cleanService(service),
    message: stringValue(message).trim(),
    raw,
  };
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"' && quoted && content[index + 1] === '"') { field += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(field.trim()); field = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && content[index + 1] === '\n') index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; field = '';
    } else field += character;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseTextLine(line: string, index: number): LogEntry {
  const timestamp = line.match(/\d{4}-\d{2}-\d{2}[T ][0-9:.+-]+|\b\d{2}:\d{2}:\d{2}\b/)?.[0];
  const level = line.match(/\b(DEBUG|INFO|WARN(?:ING)?|ERROR|ERR|FATAL|CRITICAL)\b/i)?.[0];
  const explicitService = line.match(/(?:service|app|component)=([\w.-]+)/i)?.[1];
  const bracketService = line.match(/\[([\w.-]+(?:service|api|worker|db|gateway))\]/i)?.[1];
  const tokenService = line.match(/\b([\w.-]+-(?:service|api|worker|gateway))\b/i)?.[1];
  const message = line
    .replace(timestamp ?? '', '')
    .replace(level ?? '', '')
    .replace(/(?:service|app|component)=[\w.-]+/i, '')
    .replace(/^\s*[-|:[\]]+|\s+/g, ' ')
    .trim();
  return fromRecord({ timestamp, level, service: explicitService ?? bracketService ?? tokenService, message }, line, index);
}

export function parseLogContent(content: string, filename: string): LogEntry[] {
  const extension = filename.toLowerCase().split('.').pop();
  if (!content.trim()) throw new Error('The selected file is empty.');

  let entries: LogEntry[] = [];
  if (extension === 'csv') {
    const rows = parseCsvRows(content);
    if (rows.length < 2) throw new Error('CSV files need a header row and at least one log row.');
    const headers = rows[0].map((header) => header.trim().toLowerCase());
    entries = rows.slice(1).map((row, index) => {
      const record = Object.fromEntries(headers.map((header, column) => [header, row[column] ?? '']));
      return fromRecord(record, row.join(','), index);
    });
  } else if (extension === 'jsonl' || extension === 'ndjson') {
    entries = content.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try { return fromRecord(JSON.parse(line), line, index); }
      catch { throw new Error(`Invalid JSON on line ${index + 1}. Each JSONL line must be one JSON object.`); }
    });
  } else if (extension === 'txt' || extension === 'log') {
    entries = content.split(/\r?\n/).filter((line) => line.trim()).map(parseTextLine);
  } else {
    throw new Error('Unsupported file type. Use .txt, .log, .csv, .jsonl, or .ndjson.');
  }

  return entries.filter((entry) => entry.message).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function categoryFor(message: string): string {
  const text = message.toLowerCase();
  if (/payment.*fail|checkout.*fail|transaction.*declin/.test(text)) return 'payment-failure';
  if (/nullpointer|null pointer|cannot read propert|undefined is not/.test(text)) return 'null-pointer';
  if (/connection refused|econnrefused/.test(text)) return 'connection-refused';
  if (/timed? ?out|timeout|etimedout/.test(text)) return 'timeout';
  if (/database|db |sql|connection pool/.test(text)) return 'database';
  if (/unauthori[sz]ed|invalid token|authentication/.test(text)) return 'authentication';
  if (/memory|heap|outofmemory|oom/.test(text)) return 'memory';
  if (/rate.?limit|too many requests|429/.test(text)) return 'rate-limit';
  if (/deploy|release|version/.test(text)) return 'deployment';
  if (/latency|slow|p95|p99/.test(text)) return 'latency';
  return text.replace(/\b[0-9a-f]{8,}\b/gi, '<id>').replace(/\b\d+(?:\.\d+)?\b/g, '<n>').replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6).join('-') || 'unknown-error';
}

function titleFor(category: string): string {
  const titles: Record<string, string> = {
    'payment-failure': 'Checkout and payment failures', 'null-pointer': 'Null pointer exceptions',
    'connection-refused': 'Connection refused errors', timeout: 'Request timeout spike', database: 'Database connection failures',
    authentication: 'Authentication failures', memory: 'Memory pressure failures', 'rate-limit': 'Rate limit errors',
    deployment: 'Deployment errors', latency: 'Elevated service latency',
  };
  return titles[category] ?? category.split('-').filter((word) => word !== '<n>' && word !== '<id>').slice(0, 5).map((word) => word[0]?.toUpperCase() + word.slice(1)).join(' ');
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
}

function timelineTitle(entry: LogEntry): { title: string; type: TimelineEvent['type'] } {
  const text = entry.message.toLowerCase();
  if (/deploy|release|version/.test(text)) return { title: 'Deployment completed', type: 'deploy' };
  if (/alert|pager|slo/.test(text)) return { title: 'Alert triggered', type: 'alert' };
  if (entry.level === 'fatal' || entry.level === 'error') return { title: entry.message.slice(0, 62), type: 'critical' };
  if (/latency|connections|cpu|memory|increased|spike/.test(text)) return { title: entry.message.slice(0, 62), type: 'signal' };
  return { title: entry.message.slice(0, 62), type: 'log' };
}

export function analyzeLogs(entries: LogEntry[]): Incident[] {
  const candidates = entries.filter((entry) => levelOrder[entry.level] >= 2 || /fail|error|exception|timeout|refused|latency|alert/i.test(entry.message));
  const groups = new Map<string, LogEntry[]>();
  candidates.forEach((entry) => {
    const category = categoryFor(entry.message);
    if (category === 'deployment') return;
    const key = `${entry.service}|${category}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  });

  return [...groups.entries()].map(([key, logs], index) => {
    const [service, category] = key.split('|');
    const startMs = Date.parse(logs[0].timestamp);
    const nearby = entries.filter((entry) => {
      const delta = Date.parse(entry.timestamp) - startMs;
      return delta >= -30 * 60_000 && delta <= 15 * 60_000 && (entry.service === service || /alert|deploy|latency|database|connection/i.test(entry.message));
    });
    const triggerLog = [...nearby].reverse().find((entry) => Date.parse(entry.timestamp) <= startMs && /deploy|release|config|migration|failover|connection|memory/i.test(entry.message));
    const trigger = triggerLog ? triggerLog.message.slice(0, 54) : 'No correlated change found';
    const maximumLevel = logs.reduce((max, entry) => levelOrder[entry.level] > levelOrder[max] ? entry.level : max, logs[0].level);
    const severity = levelOrder[maximumLevel] >= 3 ? 'critical' : maximumLevel === 'warn' ? 'warning' : 'info';
    const uniqueTimeline = nearby.filter((entry, entryIndex, all) => entryIndex === 0 || categoryFor(entry.message) !== categoryFor(all[entryIndex - 1].message)).slice(-7);
    const timeline = uniqueTimeline.map((entry) => {
      const event = timelineTitle(entry);
      return { timestamp: entry.timestamp, time: formatTime(entry.timestamp), title: event.title, detail: `${entry.service} · ${entry.level.toUpperCase()}`, type: event.type };
    });
    const fingerprint = `${service}:${category}`;
    const confidence = triggerLog ? Math.min(96, 72 + Math.round(Math.log2(logs.length + 1) * 5)) : Math.min(74, 48 + logs.length * 3);
    return {
      id: String(100 + index), title: titleFor(category), service, logs, severity,
      status: severity === 'critical' ? 'Investigating' : 'Monitoring',
      started: logs[0].timestamp, lastSeen: logs[logs.length - 1].timestamp,
      change: logs.length > 1 ? `+${Math.min(999, 38 + logs.length * 41)}%` : '+1 event',
      trigger, confidence, fingerprint, timeline,
    } satisfies Incident;
  }).sort((a, b) => {
    const severityDelta = ({ critical: 3, warning: 2, info: 1 }[b.severity] - { critical: 3, warning: 2, info: 1 }[a.severity]);
    return severityDelta || b.logs.length - a.logs.length;
  }).map((incident, index) => ({ ...incident, id: String(42 - index) }));
}

export function buildReport(incident: Incident, filename: string): string {
  return [
    `CRASHLENS INCIDENT #${incident.id}`,
    '='.repeat(46),
    `Dataset: ${filename}`,
    `Title: ${incident.title}`,
    `Severity: ${incident.severity.toUpperCase()}`,
    `Service: ${incident.service}`,
    `Related logs: ${incident.logs.length}`,
    `Started: ${incident.started}`,
    `Last seen: ${incident.lastSeen}`,
    `Likely trigger: ${incident.trigger}`,
    `Confidence: ${incident.confidence}%`,
    `Fingerprint: ${incident.fingerprint}`,
    '', 'TIMELINE', '-'.repeat(46),
    ...incident.timeline.map((event) => `${event.time}  ${event.title}  [${event.detail}]`),
    '', 'RELATED LOGS', '-'.repeat(46),
    ...incident.logs.map((log) => `${log.timestamp} ${log.level.toUpperCase()} ${log.service} ${log.message}`),
  ].join('\n');
}

export const SAMPLE_JSONL = [
  '{"timestamp":"2026-08-31T14:26:00Z","level":"info","service":"payment-service","message":"Deployment #318 completed version=4.12.0"}',
  '{"timestamp":"2026-08-31T14:29:00Z","level":"warn","service":"payment-service","message":"Database connections increased from 42 to 118"}',
  '{"timestamp":"2026-08-31T14:31:00Z","level":"warn","service":"checkout-api","message":"API latency p95 increased to 1.8s"}',
  '{"timestamp":"2026-08-31T14:32:00Z","level":"error","service":"payment-service","message":"Payment failed: database connection timeout order_id=84721"}',
  '{"timestamp":"2026-08-31T14:32:04Z","level":"error","service":"payment-service","message":"Payment failed: database connection timeout order_id=84722"}',
  '{"timestamp":"2026-08-31T14:32:08Z","level":"error","service":"payment-service","message":"Payment failed: database connection timeout order_id=84723"}',
  '{"timestamp":"2026-08-31T14:32:12Z","level":"error","service":"checkout-api","message":"Checkout failed because payment request timed out"}',
  '{"timestamp":"2026-08-31T14:32:16Z","level":"error","service":"checkout-api","message":"Checkout failed because payment request timed out"}',
  '{"timestamp":"2026-08-31T14:34:00Z","level":"fatal","service":"checkout-api","message":"SLO alert triggered: checkout error rate reached 12.4%"}',
  '{"timestamp":"2026-08-31T14:35:00Z","level":"info","service":"identity-api","message":"Token validation completed"}',
  '{"timestamp":"2026-08-31T14:36:00Z","level":"warn","service":"media-worker","message":"Memory usage increased above 86 percent"}',
  '{"timestamp":"2026-08-31T14:36:30Z","level":"error","service":"media-worker","message":"OutOfMemoryError while processing image job 9912"}',
  '{"timestamp":"2026-08-31T14:36:34Z","level":"error","service":"media-worker","message":"OutOfMemoryError while processing image job 9913"}',
  '{"timestamp":"2026-08-31T14:37:00Z","level":"warn","service":"identity-api","message":"Redis failover started on cache-primary"}',
  '{"timestamp":"2026-08-31T14:39:00Z","level":"error","service":"identity-api","message":"Authentication failed: token lookup timed out user_id=441"}',
  '{"timestamp":"2026-08-31T14:39:05Z","level":"error","service":"identity-api","message":"Authentication failed: token lookup timed out user_id=442"}',
  '{"timestamp":"2026-08-31T14:40:00Z","level":"warn","service":"gateway","message":"Rate limit reached for checkout route"}',
  '{"timestamp":"2026-08-31T14:41:00Z","level":"info","service":"payment-service","message":"Rollback to version 4.11.3 started"}'
].join('\n');
