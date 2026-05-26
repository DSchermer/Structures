import { useEffect, useMemo, useState } from 'react';
import type { User } from '../types';
import { Chip, StatusBadge, usd, formatDate } from '../components/shared';

type Scope = 'component_cost' | 'subassembly_cost' | 'structure_sell';
type PpTag = { name: string; kind: string };
type Pp = {
  id: string;
  scope: Scope;
  price: number;
  quote_number: string | null;
  set_at: string;
  set_by: string | null;
  component_part_number: string | null;
  structure: { id: string; top_level_part_number: string } | null;
  tags: PpTag[];
  is_superseded: boolean;
};

type ScopeFilter      = 'all' | Scope;
type SupersededFilter = 'hide' | 'show' | 'only';

export default function PricesPage({ currentUser }: { currentUser: User | null }) {
  const [pps, setPps] = useState<Pp[] | 'loading' | 'error'>('loading');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [superseded, setSuperseded] = useState<SupersededFilter>('hide');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/price-points')
      .then((r) => r.json() as Promise<{ price_points: Pp[] }>)
      .then((d) => setPps(d.price_points))
      .catch(() => setPps('error'));
  }, []);

  // Tag chips that exist in the library, grouped by kind
  const availableTagsByKind = useMemo(() => {
    if (typeof pps === 'string') return new Map<string, Set<string>>();
    const m = new Map<string, Set<string>>();
    for (const p of pps) {
      for (const t of p.tags) {
        if (!m.has(t.kind)) m.set(t.kind, new Set());
        m.get(t.kind)!.add(t.name);
      }
    }
    return m;
  }, [pps]);

  const filtered = useMemo(() => {
    if (typeof pps === 'string') return [];
    const qLower = q.trim().toLowerCase();
    return pps.filter((p) => {
      if (scope !== 'all' && p.scope !== scope) return false;
      if (superseded === 'hide' && p.is_superseded) return false;
      if (superseded === 'only' && !p.is_superseded) return false;
      for (const t of selectedTags) if (!p.tags.some((pt) => pt.name === t)) return false;
      if (qLower) {
        const hay: string[] = [];
        if (p.component_part_number) hay.push(p.component_part_number.toLowerCase());
        if (p.structure) hay.push(p.structure.top_level_part_number.toLowerCase());
        for (const t of p.tags) hay.push(t.name.toLowerCase());
        const matched = hay.some((s) => s.startsWith(qLower));
        if (!matched) return false;
      }
      return true;
    });
  }, [pps, q, scope, superseded, selectedTags]);

  const total      = typeof pps === 'string' ? 0 : pps.length;
  const counts = useMemo(() => {
    if (typeof pps === 'string') return { component: 0, subassembly: 0, sell: 0, superseded: 0 };
    return {
      component:   pps.filter((p) => p.scope === 'component_cost').length,
      subassembly: pps.filter((p) => p.scope === 'subassembly_cost').length,
      sell:        pps.filter((p) => p.scope === 'structure_sell').length,
      superseded:  pps.filter((p) => p.is_superseded).length,
    };
  }, [pps]);

  function toggleTag(name: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  async function toggleSuperseded(id: string) {
    if (!currentUser) { alert('Pick a user first.'); return; }
    const r = await fetch(`/api/price-points/${id}/toggle-superseded`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ current_user_id: currentUser.id }),
    });
    const j = await r.json() as any;
    if (!r.ok) { alert(j.error ?? 'Update failed'); return; }
    setPps((prev) => typeof prev === 'string' ? prev : prev.map((p) => p.id === id ? { ...p, is_superseded: j.is_superseded } : p));
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <div className="rounded-lg bg-white border border-ink-200 shadow-sm p-4">
        <input
          autoFocus
          type="search"
          placeholder="Search by component, structure, or tag…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full text-base px-3 py-2 rounded-md border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="mt-2 text-xs text-ink-500 flex items-baseline gap-4 flex-wrap">
          <span>{typeof pps === 'string' ? 'Loading…' : `${filtered.length} of ${total} price points`}</span>
          <span className="text-ink-400">·</span>
          <span><span className="font-mono">{counts.component}</span> component cost</span>
          <span><span className="font-mono">{counts.subassembly}</span> sub-asm cost</span>
          <span><span className="font-mono">{counts.sell}</span> structure sell</span>
          <span><span className="font-mono">{counts.superseded}</span> superseded</span>
          {(q || scope !== 'all' || superseded !== 'hide' || selectedTags.size > 0) && (
            <button
              className="ml-auto text-indigo-600 hover:text-indigo-800 hover:underline"
              onClick={() => { setQ(''); setScope('all'); setSuperseded('hide'); setSelectedTags(new Set()); }}
            >clear filters</button>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-6">
        <aside className="space-y-5">
          <RadioGroup
            label="Scope"
            value={scope}
            options={[
              { value: 'all',              label: 'All' },
              { value: 'component_cost',   label: 'Component cost' },
              { value: 'subassembly_cost', label: 'Sub-assembly cost' },
              { value: 'structure_sell',   label: 'Structure sell' },
            ]}
            onChange={(v) => setScope(v as ScopeFilter)}
          />
          <RadioGroup
            label="Superseded"
            value={superseded}
            options={[
              { value: 'hide', label: 'Hide superseded (default)' },
              { value: 'show', label: 'Show superseded too' },
              { value: 'only', label: 'Only superseded' },
            ]}
            onChange={(v) => setSuperseded(v as SupersededFilter)}
          />
          {Array.from(availableTagsByKind.entries()).map(([kind, names]) => (
            <ChipFacet
              key={kind}
              label={`${kind.charAt(0).toUpperCase() + kind.slice(1)} tags`}
              names={Array.from(names).sort()}
              selected={selectedTags}
              onToggle={toggleTag}
              kind={kind === 'cost' || kind === 'sell' ? 'spec' : 'general'}
            />
          ))}
        </aside>

        <section>
          {pps === 'loading' && <p className="text-ink-500">Loading…</p>}
          {pps === 'error'   && <p className="text-rose-700">Couldn't reach <code>/api/price-points</code>.</p>}
          {Array.isArray(pps) && filtered.length === 0 && (
            <p className="text-ink-500 italic">No price points match these filters.</p>
          )}
          {filtered.length > 0 && (
            <div className="rounded-lg border border-ink-200 bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-ink-50 text-ink-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Scope</th>
                    <th className="px-3 py-2 text-left font-medium">Component / Structure</th>
                    <th className="px-3 py-2 text-right font-medium">Price</th>
                    <th className="px-3 py-2 text-left font-medium">Tags</th>
                    <th className="px-3 py-2 text-left font-medium">Quote</th>
                    <th className="px-3 py-2 text-left font-medium">Set by</th>
                    <th className="px-3 py-2 text-left font-medium">Set at</th>
                    <th className="px-3 py-2 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => <PpRow key={p.id} p={p} onToggleSuperseded={() => toggleSuperseded(p.id)} canEdit={!!currentUser} />)}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function RadioGroup({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-xs uppercase tracking-wide text-ink-500 mb-1.5">{label}</legend>
      <div className="space-y-1">
        {options.map((opt) => (
          <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="radio" checked={value === opt.value} onChange={() => onChange(opt.value)} className="text-indigo-600 focus:ring-indigo-500" />
            <span className="text-ink-700">{opt.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ChipFacet({ label, names, selected, onToggle, kind }: {
  label: string;
  names: string[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  kind: 'spec' | 'general' | 'variant';
}) {
  if (names.length === 0) return null;
  const styles: Record<typeof kind, { on: string; off: string }> = {
    spec:    { on: 'bg-indigo-600 text-white ring-indigo-600', off: 'bg-indigo-50 text-indigo-800 ring-indigo-200 hover:bg-indigo-100' },
    general: { on: 'bg-ink-700 text-white ring-ink-700',       off: 'bg-ink-100 text-ink-700 ring-ink-200 hover:bg-ink-200' },
    variant: { on: 'bg-amber-600 text-white ring-amber-600',   off: 'bg-amber-50 text-amber-900 ring-amber-200 hover:bg-amber-100' },
  };
  return (
    <fieldset>
      <legend className="text-xs uppercase tracking-wide text-ink-500 mb-1.5">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {names.map((name) => {
          const active = selected.has(name);
          return (
            <button
              key={name}
              onClick={() => onToggle(name)}
              className={'rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition ' + (active ? styles[kind].on : styles[kind].off)}
              type="button"
            >
              {name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function PpRow({ p, onToggleSuperseded, canEdit }: { p: Pp; onToggleSuperseded: () => void; canEdit: boolean }) {
  const href = p.structure ? `/structures/${p.structure.id}` : null;
  const clickable = href !== null;
  const onRowClick = clickable
    ? (e: React.MouseEvent) => {
        // ⌘/Ctrl-click → new tab; otherwise navigate in place
        if (e.metaKey || e.ctrlKey) window.open(href!, '_blank');
        else window.location.href = href!;
      }
    : undefined;
  const onButtonClick = (e: React.MouseEvent) => { e.stopPropagation(); onToggleSuperseded(); };
  return (
    <tr
      className={
        'border-t border-ink-100 align-top ' +
        (p.is_superseded ? 'opacity-60 ' : '') +
        (clickable ? 'hover:bg-indigo-50/40 cursor-pointer ' : '')
      }
      onClick={onRowClick}
    >
      <td className="px-3 py-2">
        <ScopeBadge scope={p.scope} />
      </td>
      <td className="px-3 py-2">
        {p.component_part_number && <div className="font-mono text-ink-900">{p.component_part_number}</div>}
        {p.structure && (
          <span className="font-mono text-indigo-700">
            {p.structure.top_level_part_number}
          </span>
        )}
      </td>
      <td className={'px-3 py-2 text-right font-mono text-ink-900 ' + (p.is_superseded ? 'line-through' : '')}>{usd(p.price, true)}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {p.tags.map((t, i) => (
            <Chip key={i} kind={t.kind === 'sell' ? 'spec' : t.kind === 'cost' ? 'general' : 'variant'} name={t.name} />
          ))}
          {p.is_superseded && <StatusBadge tone="rose">SUPERSEDED</StatusBadge>}
        </div>
      </td>
      <td className="px-3 py-2 text-ink-700 font-mono text-xs">{p.quote_number ?? '—'}</td>
      <td className="px-3 py-2 text-ink-700 text-xs">{p.set_by ?? '—'}</td>
      <td className="px-3 py-2 text-ink-500 text-xs font-mono">{formatDate(p.set_at)}</td>
      <td className="px-3 py-2 text-right">
        {canEdit && (
          <button
            onClick={onButtonClick}
            className={'text-xs px-2 py-1 rounded border ' + (p.is_superseded
              ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
              : 'border-rose-300 text-rose-700 hover:bg-rose-50')}
            title={p.is_superseded ? 'Removes the superseded marker' : 'Marks this price as no-longer-current; LINE_ITEMs already pointing at it are unaffected.'}
          >
            {p.is_superseded ? 'Un-supersede' : 'Mark superseded'}
          </button>
        )}
      </td>
    </tr>
  );
}

function ScopeBadge({ scope }: { scope: Scope }) {
  const map: Record<Scope, { label: string; cls: string }> = {
    component_cost:   { label: 'component cost',   cls: 'bg-slate-100 text-slate-700 ring-slate-300' },
    subassembly_cost: { label: 'sub-asm cost',     cls: 'bg-amber-100 text-amber-800 ring-amber-300' },
    structure_sell:   { label: 'structure sell',   cls: 'bg-emerald-100 text-emerald-800 ring-emerald-300' },
  };
  const m = map[scope];
  return <span className={'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ' + m.cls}>{m.label}</span>;
}
