import { useEffect, useState } from 'react';

type HealthOk = { ok: true; d1_rows: number; checked_at: string };
type HealthErr = { ok: false; error: string };
type Health = HealthOk | HealthErr;

export default function App() {
  const [health, setHealth] = useState<Health | 'loading' | 'network-error'>('loading');

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth('network-error'));
  }, []);

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-3 flex items-baseline gap-3">
          <span className="text-sm font-mono text-ink-500">structurev2</span>
          <span className="text-xs uppercase tracking-wider text-ink-400">prototype</span>
          <span className="ml-auto text-xs text-ink-400">Phase 0 — skeleton</span>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h1 className="text-3xl font-semibold text-ink-900">
            StructureV2 prototype — coming online
          </h1>
          <p className="mt-3 text-ink-600 leading-relaxed">
            This page exists to verify that the Cloudflare Pages deployment, the
            Pages Function runtime, and the D1 binding are all wired up. Real screens
            land in Phase 1 onward.
          </p>

          <section className="mt-10 rounded-lg border border-ink-200 bg-white shadow-sm">
            <div className="px-5 py-3 border-b border-ink-200 flex items-center justify-between">
              <span className="text-sm font-medium text-ink-700">D1 health check</span>
              <code className="text-xs text-ink-500">GET /api/health</code>
            </div>
            <div className="px-5 py-5">
              <HealthView health={health} />
            </div>
          </section>

          <p className="mt-8 text-sm text-ink-500">
            If the row count below is <span className="font-mono text-ink-700">6</span>,
            the schema and lookup seed are in place and Phase 1 can begin.
          </p>
        </div>
      </main>

      <footer className="border-t border-ink-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-3 text-xs text-ink-400 font-mono">
          Cloudflare Pages · D1 · Pages Functions
        </div>
      </footer>
    </div>
  );
}

function HealthView({ health }: { health: Health | 'loading' | 'network-error' }) {
  if (health === 'loading') {
    return <p className="text-ink-500">Checking…</p>;
  }
  if (health === 'network-error') {
    return (
      <p className="text-rose-700">
        Network error — the Pages Function did not respond. Check that the D1 binding
        named <code className="font-mono">DB</code> is configured on the Pages project.
      </p>
    );
  }
  if (!health.ok) {
    return (
      <div>
        <p className="text-rose-700 font-medium">Function reachable, but D1 query failed.</p>
        <pre className="mt-2 text-xs bg-ink-100 text-ink-800 rounded p-3 overflow-auto">
          {health.error}
        </pre>
      </div>
    );
  }
  return (
    <div className="flex items-baseline gap-6">
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-400">D1 rows</div>
        <div className="mt-1 text-3xl font-semibold text-ink-900 font-mono">
          {health.d1_rows}
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-400">Checked at</div>
        <div className="mt-1 text-sm text-ink-700 font-mono">{health.checked_at}</div>
      </div>
      <div className="ml-auto">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          healthy
        </span>
      </div>
    </div>
  );
}
