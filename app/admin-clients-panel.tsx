'use client';

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
      <section className="border border-[#383838] bg-[#161616] p-8 text-sm text-[#adadad]">
        Loading client accounts…
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="border border-[#a53d3d] bg-[#200d0f] p-5 text-sm text-[#ff8585]">
        {error}
      </section>
    );
  }

  return (
    <section className="border border-[#383838] bg-[#121212]">
      <header className="border-b border-[#383838] p-5 lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-[#adadad]">
              <Shield size={16} /> Platform administration
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Client accounts
            </h2>
            <p className="mt-1 text-sm text-[#adadad]">
              Registered CrashLens accounts and their database activity.
            </p>
          </div>
          <button
            className="flex h-10 items-center gap-2 border border-[#525252] px-4 text-sm text-[#e5e5e5] hover:border-white"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
        <div className="mt-6 grid gap-px border border-[#383838] bg-[#383838] sm:grid-cols-3">
          <Summary label="Total accounts" value={data?.totals.total ?? 0} />
          <Summary label="Verified emails" value={data?.totals.verified ?? 0} />
          <Summary
            label="Created in 30 days"
            value={data?.totals.new30Days ?? 0}
          />
        </div>
      </header>

      <div className="border-b border-[#383838] p-4">
        <label className="flex max-w-md items-center gap-3 border border-[#525252] bg-[#0d0d0d] px-3 focus-within:border-white">
          <Search size={16} className="text-[#8f8f8f]" />
          <input
            aria-label="Search client accounts"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#737373]"
            placeholder="Search name, email, or workspace"
          />
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-[#383838] bg-[#0d0d0d] text-xs text-[#999999]">
            <tr>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Workspace</th>
              <th className="px-4 py-3 font-medium">Activity</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr
                key={client.id}
                className="border-b border-[#303030] hover:bg-[#191919]"
              >
                <td
                  className="px-4 py-4"
                  aria-label={`Client ${client.name || client.email}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center border border-[#525252] bg-[#1a1a1a] text-xs font-semibold text-white">
                      {(client.name || client.email).slice(0, 2).toUpperCase()}
                    </span>
                    <span>
                      <strong className="block font-medium text-white">
                        {client.name}
                      </strong>
                      <span className="mt-0.5 block text-xs text-[#999999]">
                        {client.email}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <span className="inline-flex items-center gap-1.5 border border-[#525252] px-2 py-1 text-xs text-[#d6d6d6]">
                    {client.verified ? (
                      <Check size={12} />
                    ) : (
                      <UserRound size={12} />
                    )}
                    {client.verified ? 'Email verified' : 'Unverified'}
                  </span>
                  <span className="mt-2 block text-xs text-[#8f8f8f]">
                    {Number(client.active_sessions)} active session
                    {Number(client.active_sessions) === 1 ? '' : 's'}
                  </span>
                </td>
                <td className="px-4 py-4 text-[#d6d6d6]">
                  {client.workspace_name ?? 'Workspace not created'}
                </td>
                <td className="px-4 py-4 text-[#d6d6d6]">
                  <span className="block">
                    {Number(client.incident_count)} incidents
                  </span>
                  <span className="mt-1 block text-xs text-[#8f8f8f]">
                    {Number(client.ingestion_count)} log uploads
                  </span>
                </td>
                <td className="px-4 py-4 text-[#e5e5e5]">
                  <time dateTime={asUtc(client.created_at).toISOString()}>
                    {createdDate(client.created_at)}
                  </time>
                  <span className="mt-1 block text-xs text-[#8f8f8f]">
                    {asUtc(client.created_at)
                      .toISOString()
                      .replace('T', ' ')
                      .replace('.000Z', ' UTC')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!clients.length && (
          <p className="p-10 text-center text-sm text-[#8f8f8f]">
            {query
              ? 'No accounts match this search.'
              : 'No client accounts have been created.'}
          </p>
        )}
      </div>
      <footer className="flex flex-wrap justify-between gap-2 p-4 text-xs text-[#737373]">
        <span>
          Showing {clients.length} of {data?.totals.total ?? 0} accounts
        </span>
        {data?.generatedAt && (
          <span>Updated {new Date(data.generatedAt).toLocaleString()}</span>
        )}
      </footer>
    </section>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-[#161616] p-4">
      <p className="text-xs text-[#8f8f8f]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}
