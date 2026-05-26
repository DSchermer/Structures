import { useMemo, useState } from 'react';
import type { Row, TagsResp } from '../types';
import { Chip, StatusBadge, tagStyle, usd, relativeTime } from '../components/shared';

type ArchivedFilter = 'hide' | 'show' | 'only';
type SubFilter      = 'show' | 'hide' | 'only';

export default function SearchPage({ rows, tags }: { rows: Row[] | 'loading' | 'error'; tags: TagsResp | null }) {
  const [q, setQ] = useState('');
  const [selectedSpecTags,    setSelectedSpecTags]    = useState<Set<string>>(new Set());
  const [selectedGeneralTags, setSelectedGeneralTags] = useState<Set<string>>(new Set());
  const [selectedVariantTags, setSelectedVariantTags] = useState<Set<string>>(new Set());
  const [archived,    setArchived]    = useState<ArchivedFilter>('hide');
  const [subassembly, setSubassembly] = useState<SubFilter>('show');

  const filtered = useMemo(() => {
    if (rows === 'loading' || rows === 'error') return [];
    const qLower = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (archived === 'hide' && r.is_archived) return false;
      if (archived === 'only' && !r.is_archived) return false;
      if (subassembly === 'hide' && r.is_subassembly) return false;
      if (subassembly === 'only' && !r.is_subassembly) return false;
      for (const t of selectedSpecTags)    if (!r.spec_tags.includes(t)) return false;
      for (const t of selectedGeneralTags) if (!r.general_tags.includes(t)) return false;
      for (const t of selectedVariantTags) if (!r.variant_tags.includes(t)) return false;
      if (qLower && !matchesPrefix(r, qLower)) return false;
      return true;
    });
  }, [rows, q, selectedSpecTags, selectedGeneralTags, selectedVariantTags, archived, subassembly]);

  const totalRows = rows === 'loading' || rows === 'error' ? 0 : rows.length;

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <div className="rounded-lg bg-white border border-ink-200 shadow-sm p-4">
        <input
          autoFocus
          type="search"
          placeholder="Search specs, parts, tags…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full text-base px-3 py-2 rounded-md border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="mt-2 text-xs text-ink-500 flex items-baseline gap-3">
          <span>
            {rows === 'loading' ? 'Loading…' :
             rows === 'error'   ? "Couldn't reach /api/search" :
             `${filtered.length} of ${totalRows} structures`}
          </span>
          {(q || selectedSpecTags.size || selectedGeneralTags.size || selectedVariantTags.size || archived !== 'hide' || subassembly !== 'show') && (
            <button
              className="text-indigo-600 hover:text-indigo-800 hover:underline"
              onClick={() => {
                setQ(''); setSelectedSpecTags(new Set()); setSelectedGeneralTags(new Set()); setSelectedVariantTags(new Set());
                setArchived('hide'); setSubassembly('show');
              }}
            >clear filters</button>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-6">
        <aside className="space-y-5">
          <FilterPanel
            tags={tags}
            selectedSpec={selectedSpecTags}    onToggleSpec={(name) => toggle(name, selectedSpecTags, setSelectedSpecTags)}
            selectedGeneral={selectedGeneralTags} onToggleGeneral={(name) => toggle(name, selectedGeneralTags, setSelectedGeneralTags)}
            selectedVariant={selectedVariantTags} onToggleVariant={(name) => toggle(name, selectedVariantTags, setSelectedVariantTags)}
            archived={archived} setArchived={setArchived}
            subassembly={subassembly} setSubassembly={setSubassembly}
          />
        </aside>
        <section className="space-y-2">
          {rows === 'loading' && <p className="text-ink-500">Loading…</p>}
          {rows === 'error'   && <p className="text-rose-700">Couldn't reach <code>/api/search</code>.</p>}
          {Array.isArray(rows) && filtered.length === 0 && (
            <p className="text-ink-500 italic">No structures match these filters.</p>
          )}
          {filtered.map((r) => <ResultRow key={r.id} row={r} />)}
        </section>
      </div>
    </div>
  );
}

function matchesPrefix(r: Row, qLower: string): boolean {
  if (r.spec_number.toLowerCase().startsWith(qLower)) return true;
  if (r.part_number.toLowerCase().startsWith(qLower)) return true;
  if (r.top_level_part_number.toLowerCase().startsWith(qLower)) return true;
  if (r.parent_part_number && r.parent_part_number.toLowerCase().startsWith(qLower)) return true;
  for (const t of r.spec_tags)    if (t.toLowerCase().startsWith(qLower)) return true;
  for (const t of r.general_tags) if (t.toLowerCase().startsWith(qLower)) return true;
  for (const t of r.variant_tags) if (t.toLowerCase().startsWith(qLower)) return true;
  if (r.checkout_holder_name) {
    for (const w of r.checkout_holder_name.toLowerCase().split(/\s+/)) {
      if (w.startsWith(qLower)) return true;
    }
  }
  return false;
}

function toggle(name: string, current: Set<string>, set: (s: Set<string>) => void) {
  const next = new Set(current);
  if (next.has(name)) next.delete(name); else next.add(name);
  set(next);
}

function FilterPanel(props: {
  tags: TagsResp | null;
  selectedSpec: Set<string>;    onToggleSpec: (name: string) => void;
  selectedGeneral: Set<string>; onToggleGeneral: (name: string) => void;
  selectedVariant: Set<string>; onToggleVariant: (name: string) => void;
  archived: ArchivedFilter; setArchived: (v: ArchivedFilter) => void;
  subassembly: SubFilter;   setSubassembly: (v: SubFilter) => void;
}) {
  return (
    <div className="space-y-5 text-sm">
      <RadioGroup
        label="Archived"
        value={props.archived}
        options={[
          { value: 'hide', label: 'Hide archived (default)' },
          { value: 'show', label: 'Show archived too' },
          { value: 'only', label: 'Only archived' },
        ]}
        onChange={(v) => props.setArchived(v as ArchivedFilter)}
      />
      <RadioGroup
        label="Sub-assemblies"
        value={props.subassembly}
        options={[
          { value: 'show', label: 'Show sub-assemblies (default)' },
          { value: 'hide', label: 'Hide sub-assemblies' },
          { value: 'only', label: 'Only sub-assemblies' },
        ]}
        onChange={(v) => props.setSubassembly(v as SubFilter)}
      />
      <ChipFacet label="Spec tags"    kind="spec"    names={props.tags?.spec    ?? []} selected={props.selectedSpec}    onToggle={props.onToggleSpec} />
      <ChipFacet label="General tags" kind="general" names={props.tags?.general ?? []} selected={props.selectedGeneral} onToggle={props.onToggleGeneral} />
      <ChipFacet label="Variant tags" kind="variant" names={props.tags?.variant ?? []} selected={props.selectedVariant} onToggle={props.onToggleVariant} />
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
          <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              className="text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-ink-700">{opt.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ChipFacet({ label, kind, names, selected, onToggle }: {
  label: string; kind: 'spec' | 'general' | 'variant'; names: string[]; selected: Set<string>; onToggle: (name: string) => void;
}) {
  if (names.length === 0) return null;
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
              className={'rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition ' + tagStyle(kind, active)}
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

function ResultRow({ row }: { row: Row }) {
  const archived = row.is_archived;
  const href = row.is_uncommitted_draft ? `/drafts/${row.id}` : `/structures/${row.id}`;
  return (
    <a
      href={href}
      className={
        'block rounded-md border bg-white px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition ' +
        (archived ? 'border-ink-200 opacity-60' :
         row.is_uncommitted_draft ? 'border-indigo-300 bg-indigo-50/40' :
         'border-ink-200')
      }
    >
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className={'font-mono text-base font-medium text-ink-900 ' + (archived ? 'line-through' : '')}>
          {row.top_level_part_number}
        </span>
        <span className="text-xs text-ink-500">
          {row.is_subassembly ? 'sub-assembly' :
           row.is_variant ? `variant of ${row.spec_number}${row.parent_part_number}` :
           'base part'}
        </span>
        <span className="ml-auto text-xs font-mono text-ink-500">
          {row.is_uncommitted_draft ? 'never checked in' : `Rev ${row.current_construction_revision_number}`}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {row.is_uncommitted_draft && <StatusBadge tone="amber">YOUR DRAFT — resume editing</StatusBadge>}
        {row.variant_tags.map((t) => <Chip key={`v-${t}`} kind="variant" name={t} />)}
        {row.general_tags.map((t) => <Chip key={`g-${t}`} kind="general" name={t} />)}
        {row.is_archived     && <StatusBadge tone="rose">ARCHIVED</StatusBadge>}
        {row.is_locked       && <StatusBadge tone="rose">LOCKED</StatusBadge>}
        {row.is_below_target && <StatusBadge tone="amber">BELOW TARGET</StatusBadge>}
        {!row.is_uncommitted_draft && row.checkout_holder_name && (
          <StatusBadge tone="slate">
            checked out by {row.checkout_holder_name}
            {row.checkout_acquired_at ? ` · ${relativeTime(row.checkout_acquired_at)}` : ''}
          </StatusBadge>
        )}
      </div>
      <div className="mt-2 text-xs text-ink-500 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span>{row.line_item_count} line{row.line_item_count === 1 ? '' : 's'}</span>
        {row.sell_price !== null && (
          <span>sell · <span className="font-mono text-ink-700">{usd(row.sell_price)}</span></span>
        )}
        {row.subassembly_cost !== null && (
          <span>cost · <span className="font-mono text-ink-700">{usd(row.subassembly_cost)}</span></span>
        )}
        <span className="text-ink-400">{row.spec_tags.join(' · ')}</span>
      </div>
    </a>
  );
}
