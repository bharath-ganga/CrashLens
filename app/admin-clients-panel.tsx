'use client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, RefreshCw, Search, Shield, UserRound } from 'lucide-react';

type Client = {
  id: string;
  name: string;
  email: string;
  verified: number;
  created_at: string;
  active_sessions: number;
  workspace_name: string | null;
  ingestion_count: number;
  incident_count: number;
  last_activity: string | null;
};

type ClientData = {
  clients: Client[];
  totals: { total: number; verified: number; new30Days: number };
  generatedAt: string;
  error?: string;
};

function asUtc(value: string) {
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

function createdDate(value: string) {
  return asUtc(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}

export default function AdminClientsPanel() {
  const [data, setData] = useState<ClientData | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/clients', { cache: 'no-store' });
      const result = (await response.json()) as ClientData;
      if (!response.ok)
        throw new Error(result.error ?? 'Could not load clients');
      setData(result);
      setError('');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not load clients',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const clients = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return data?.clients ?? [];
    return (data?.clients ?? []).filter((client) =>
      `${client.name} ${client.email} ${client.workspace_name ?? ''}`
        .toLowerCase()
        .includes(term),
    );
  }, [data, query]);

  if (loading && !data) {
    return (
      <Card className="block py-0 border border-border bg-background p-8 text-sm text-muted-foreground">
        Loading client accounts…
      </Card>
    );
  }

  if (error && !data) {
    return (
      <section className="border border-destructive bg-destructive/10 p-5 text-sm text-destructive">
        {error}
      </section>
    );
  }

  return (
    <Card className="block py-0 border border-border bg-background">
      <header className="border-b border-border p-5 lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Shield size={16} /> Platform administration
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">
              Client accounts
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Registered CrashLens accounts and their database activity.
            </p>
          </div>
          <Button
            variant="ghost"
            type="button"
            className="flex h-10 items-center gap-2 border border-border px-4 text-sm text-foreground hover:border-foreground"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>
        <div className="mt-6 grid gap-px border border-border bg-muted sm:grid-cols-3">
          <Summary label="Total accounts" value={data?.totals.total ?? 0} />
          <Summary label="Verified emails" value={data?.totals.verified ?? 0} />
          <Summary
            label="Created in 30 days"
            value={data?.totals.new30Days ?? 0}
          />
        </div>
      </header>

      <div className="border-b border-border p-4">
        <Label className="flex max-w-md items-center gap-3 border border-border bg-muted px-3 focus-within:border-foreground">
          <Search size={16} className="text-muted-foreground" />
          <Input
            aria-label="Search client accounts"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Search name, email, or workspace"
          />
        </Label>
      </div>

      <div className="overflow-x-auto">
        <Table className="w-full min-w-[980px] text-left text-sm">
          <TableHeader className="border-b border-border bg-muted text-xs text-muted-foreground">
            <TableRow>
              <TableHead className="px-4 py-3 font-medium">Client</TableHead>
              <TableHead className="px-4 py-3 font-medium">Status</TableHead>
              <TableHead className="px-4 py-3 font-medium">Workspace</TableHead>
              <TableHead className="px-4 py-3 font-medium">Activity</TableHead>
              <TableHead className="px-4 py-3 font-medium">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <TableRow
                key={client.id}
                className="border-b border-border hover:bg-muted"
              >
                <TableCell
                  className="px-4 py-4"
                  aria-label={`Client ${client.name || client.email}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center border border-border bg-muted text-xs font-semibold text-foreground">
                      {(client.name || client.email).slice(0, 2).toUpperCase()}
                    </span>
                    <span>
                      <strong className="block font-medium text-foreground">
                        {client.name}
                      </strong>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {client.email}
                      </span>
                    </span>
                  </div>
                </TableCell>
                <TableCell className="px-4 py-4">
                  <span className="inline-flex items-center gap-1.5 border border-border px-2 py-1 text-xs text-foreground">
                    {client.verified ? (
                      <Check size={12} />
                    ) : (
                      <UserRound size={12} />
                    )}
                    {client.verified ? 'Email verified' : 'Unverified'}
                  </span>
                  <span className="mt-2 block text-xs text-muted-foreground">
                    {Number(client.active_sessions)} active session
                    {Number(client.active_sessions) === 1 ? '' : 's'}
                  </span>
                </TableCell>
                <TableCell className="px-4 py-4 text-foreground">
                  {client.workspace_name ?? 'Workspace not created'}
                </TableCell>
                <TableCell className="px-4 py-4 text-foreground">
                  <span className="block">
                    {Number(client.incident_count)} incidents
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {Number(client.ingestion_count)} log uploads
                  </span>
                </TableCell>
                <TableCell className="px-4 py-4 text-foreground">
                  <time dateTime={asUtc(client.created_at).toISOString()}>
                    {createdDate(client.created_at)}
                  </time>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {asUtc(client.created_at)
                      .toISOString()
                      .replace('T', ' ')
                      .replace('.000Z', ' UTC')}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!clients.length && (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {query
              ? 'No accounts match this search.'
              : 'No client accounts have been created.'}
          </p>
        )}
      </div>
      <footer className="flex flex-wrap justify-between gap-2 p-4 text-xs text-muted-foreground">
        <span>
          Showing {clients.length} of {data?.totals.total ?? 0} accounts
        </span>
        {data?.generatedAt && (
          <span>Updated {new Date(data.generatedAt).toLocaleString()}</span>
        )}
      </footer>
    </Card>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-background p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
