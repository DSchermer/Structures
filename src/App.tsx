import { useEffect, useState } from 'react';

type Part = {
  id: string;
  part_number: string;
  is_variant: boolean;
  current_construction_revision_number: number;
  current_price_revision_number: number;
  line_item_count: number;
  sell_price: number | null;
  general_tags: string[];
  variant_tags: string[];
  system_tags: string[];
};
type Spec = {
  id: string;
  spec_number: string;
  customer_revision: string;
  spec_revision_count: number;
  spec_tags: string[];
  parts: Part[];
};
type Catalog = { specs: Spec[] };
type HealthOk = { ok: true; d1_rows: number; checked_at: string };
type HealthErr = { ok: false; error: string };

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | 'loading' | 'error'>('loading');
  const [health, setHealth]   = useState<HealthOk | HealthErr | 'loading' | 'network-error'>('loading');

  useEffect(() => {
    fetch('/api/specs')
      .then((r) => r.json() as Promise<Catalog>)
      .then(setCatalog)
      .catch(() => setCatalog('error'));
    fetch('/api/health')
      .then((r) => r.json() as Promise<HealthOk | HealthErr>)
      .then(setHealth)
      .catch(() => setHealth('network-error'));
  }, []);

  return (
    <div className="min-h-full flex flex-col">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="text-2xl font-semibold text-ink-900">Catalog</h1>
              <p className="mt-2 text-ink-600 leading-relaxed max-w-2xl">
                Phase 1 sanity-check sample — 3 specs across ball, gate, and check valve
                families. Confirm the naming conventions, materials, suppliers, and
                pricing read right before Phase 2 scales to the full 18–22 spec catalog.
              </p>
            </div>
            <HealthPill health={health} />
          </div>

          <div className="mt-8 space-y-6">
            <CatalogView catalog={catalog} />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="border-b border-ink-200 bg-white">
      <div className="mx-auto max-w-5xl px-6 py-3 flex items-baseline gap-3">
        <span className="text-sm font-mono text-ink-500">structurev2</span>
        <span className="text-xs uppercase tracking-wider text-ink-400">prototype</span>
        <span className="ml-auto text-xs text-ink-400 font-mono">phase 1 — sanity sample</span>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-ink-200 bg-white">
      <div className="mx-auto max-w-5xl px-6 py-3 text-xs text-ink-400 font-mono">
        Cloudflare Workers + Assets · D1
      </div>
    </footer>
  );
}

function CatalogView({ catalog }: { catalog: Catalog | 'loading' | 'error' }) {
  if (catalog === 'loading') return <p className="text-ink-500">Loading catalog…</p>;
  if (catalog === 'error') {
    return (
      <p className="text-rose-700">
        Couldn't reach <code>/api/specs</code>. Confirm the Worker deployment is current
        and the D1 binding is attached.
      </p>
    );
  }
  if (catalog.specs.length === 0) {
    return (
      <p className="text-ink-500">
        No specs in the database. Did the Phase 1 seed (sql/0003_seed_sample.sql) run?
      </p>
    );
  }
  return (
    <>
      {catalog.specs.map((spec) => (
        <SpecCard key={spec.id} spec={spec} />
      ))}
    </>
  );
}

function SpecCard({ spec }: { spec: Spec }) {
  return (
    <section className="rounded-lg border border-ink-200 bg-white shadow-sm overflow-hidden">
      <header className="px-5 py-4 border-b border-ink-200 flex items-baseline gap-4 flex-wrap">
        <h2 className="text-lg font-mono font-semibold text-ink-900">{spec.spec_number}</h2>
        <span className="text-sm text-ink-600">
          Customer <span className="font-mono">{spec.customer_revision}</span>
          <span className="text-ink-400">
            {' · '}
            {spec.spec_revision_count} revision{spec.spec_revision_count === 1 ? '' : 's'} on file
          </span>
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {spec.spec_tags.map((t) => (
            <Tag key={t} name={t} kind="spec" />
          ))}
        </div>
      </header>

      <table className="w-full text-sm">
        <thead className="bg-ink-50 text-ink-500 text-xs uppercase tracking-wide">
          <tr>
            <th className="px-5 py-2 text-left font-medium">Part</th>
            <th className="px-5 py-2 text-left font-medium">Tags</th>
            <th className="px-5 py-2 text-right font-medium">CR / PR</th>
            <th className="px-5 py-2 text-right font-medium">Lines</th>
            <th className="px-5 py-2 text-right font-medium">Sell (2026)</th>
          </tr>
        </thead>
        <tbody>
          {spec.parts.map((p) => (
            <PartRow key={p.id} spec={spec} part={p} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PartRow({ spec, part }: { spec: Spec; part: Part }) {
  return (
    <tr className="border-t border-ink-100 hover:bg-ink-50/60">
      <td className="px-5 py-3 align-top">
        <a
          href={`/structures/${part.id}`}
          className="font-mono text-ink-900 hover:text-indigo-700 hover:underline"
        >
          {spec.spec_number}
          <span className="text-ink-400">·</span>
          {part.part_number}
        </a>
        <div className="text-xs text-ink-500 mt-0.5">
          {part.is_variant ? 'variant' : 'base part'}
        </div>
      </td>
      <td className="px-5 py-3 align-top">
        <div className="flex flex-wrap gap-1.5">
          {part.variant_tags.map((t) => <Tag key={`v-${t}`} name={t} kind="variant" />)}
          {part.general_tags.map((t) => <Tag key={`g-${t}`} name={t} kind="general" />)}
          {part.system_tags.map((t)  => <Tag key={`s-${t}`} name={t} kind="system" />)}
        </div>
      </td>
      <td className="px-5 py-3 align-top text-right font-mono text-ink-700">
        {part.current_construction_revision_number}
        <span className="text-ink-300"> / </span>
        {part.current_price_revision_number}
      </td>
      <td className="px-5 py-3 align-top text-right font-mono text-ink-700">
        {part.line_item_count}
      </td>
      <td className="px-5 py-3 align-top text-right font-mono text-ink-900 tabular-nums">
        {part.sell_price === null ? '—' : usd(part.sell_price)}
      </td>
    </tr>
  );
}

type TagKind = 'spec' | 'general' | 'variant' | 'system';
function Tag({ name, kind }: { name: string; kind: TagKind }) {
  const styles: Record<TagKind, string> = {
    spec:    'bg-indigo-50 text-indigo-800 ring-indigo-200',
    general: 'bg-ink-100 text-ink-700 ring-ink-200',
    variant: 'bg-amber-50 text-amber-900 ring-amber-200',
    system:  'bg-rose-50 text-rose-800 ring-rose-200',
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[kind]}`}
      title={`${kind} tag`}
    >
      {name}
    </span>
  );
}

function HealthPill({ health }: { health: HealthOk | HealthErr | 'loading' | 'network-error' }) {
  if (health === 'loading' || health === 'network-error' || !health.ok) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-800 ring-1 ring-inset ring-rose-200">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
        D1 unreachable
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200"
      title={`Last checked ${health.checked_at}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      D1 healthy · {health.d1_rows} rows
    </span>
  );
}

const _usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
function usd(n: number): string {
  return _usd.format(n);
}
