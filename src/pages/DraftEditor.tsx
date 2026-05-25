import { useEffect, useMemo, useState } from 'react';
import { Chip, StatusBadge, tagStyle, usd, pct } from '../components/shared';
import { Dialog } from '../components/Dialog';
import { backsolve, type LineForBacksolve } from '../lib/backsolve';
import type { User, TagsResp } from '../types';

type DraftLine = {
  id: string;
  sort_order: number;
  component_part_number: string;
  part_description: string;
  quantity: number;
  chosen_price_point_id: string | null;
  unit_price: number | null;
  price_override: number | null;
  supplier: string;
  lead_time_days: number;
  product_code: string;
  is_commissioned: boolean;
  commission_cap_pct: number | null;
  sub_assembly_structure_id: string | null;
  sub_assembly_part_number: string | null;
};
type DraftTag = { id: string; name: string; kind: string };

type Draft = {
  structure_id: string;
  editor_user_id: string;
  editor_name: string | null;
  spec_id: string;
  spec_number: string;
  spec_revision_id: string;
  part_number: string;
  parent_structure_id: string | null;
  parent_part_number: string | null;
  build_hours: number | null;
  target_assembly_margin_pct: number | null;
  build_instr_1: string | null; build_instr_2: string | null; build_instr_3: string | null; build_instr_4: string | null; build_instr_5: string | null;
  work_instr_1:  string | null; work_instr_2:  string | null; work_instr_3:  string | null; work_instr_4:  string | null; work_instr_5:  string | null;
  live_current_construction_revision_number: number;
  live_current_price_revision_number: number;
  live_top_level_part_number: string;
  lines: DraftLine[];
  tags: DraftTag[];
};

type PpRow = { id: string; price: number; quote_number: string | null; set_at: string; set_by: string; tags: string[]; is_superseded: boolean };

export default function DraftEditor({ id, currentUser, tags }: { id: string; currentUser: User | null; tags: TagsResp | null }) {
  const [draft, setDraft] = useState<Draft | 'loading' | 'error' | 'notfound'>('loading');
  const [components, setComponents] = useState<string[]>([]);
  const [ppCache, setPpCache] = useState<Map<string, PpRow[]>>(new Map());
  const [saving, setSaving] = useState(false);
  const [showCheckin, setShowCheckin] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/drafts/${id}`);
        if (r.status === 404) { setDraft('notfound'); return; }
        setDraft(await r.json() as Draft);
      } catch { setDraft('error'); }
    })();
    fetch('/api/components').then((r) => r.json()).then((d: { components: string[] }) => setComponents(d.components)).catch(() => {});
    fetch('/api/users').then((r) => r.json()).then((d: { users: User[] }) => setUsers(d.users)).catch(() => {});
  }, [id]);

  async function loadPps(component: string): Promise<PpRow[]> {
    const cached = ppCache.get(component);
    if (cached) return cached;
    const r = await fetch(`/api/price-points?component=${encodeURIComponent(component)}`);
    const d = await r.json() as { price_points: PpRow[] };
    const points = d.price_points ?? [];
    const next = new Map(ppCache);
    next.set(component, points);
    setPpCache(next);
    return points;
  }

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => {
      if (typeof prev !== 'object') return prev;
      return { ...prev, [key]: value };
    });
  }
  function updateLine(idx: number, patch: Partial<DraftLine>) {
    setDraft((prev) => {
      if (typeof prev !== 'object') return prev;
      const lines = prev.lines.map((l, i) => i === idx ? { ...l, ...patch } : l);
      return { ...prev, lines };
    });
  }
  function addLine() {
    setDraft((prev) => {
      if (typeof prev !== 'object') return prev;
      const nextSort = prev.lines.length === 0 ? 1 : Math.max(...prev.lines.map((l) => l.sort_order)) + 1;
      const newLine: DraftLine = {
        id: crypto.randomUUID(),
        sort_order: nextSort,
        component_part_number: '',
        part_description: '',
        quantity: 1,
        chosen_price_point_id: null,
        unit_price: null,
        price_override: null,
        supplier: '',
        lead_time_days: 14,
        product_code: '',
        is_commissioned: false,
        commission_cap_pct: null,
        sub_assembly_structure_id: null,
        sub_assembly_part_number: null,
      };
      return { ...prev, lines: [...prev.lines, newLine] };
    });
  }
  function removeLine(idx: number) {
    setDraft((prev) => {
      if (typeof prev !== 'object') return prev;
      const lines = prev.lines.filter((_, i) => i !== idx).map((l, i) => ({ ...l, sort_order: i + 1 }));
      return { ...prev, lines };
    });
  }
  function toggleTag(tagId: string, tagName: string, kind: 'general' | 'variant') {
    setDraft((prev) => {
      if (typeof prev !== 'object') return prev;
      const has = prev.tags.some((t) => t.id === tagId);
      const tags = has ? prev.tags.filter((t) => t.id !== tagId) : [...prev.tags, { id: tagId, name: tagName, kind }];
      return { ...prev, tags };
    });
  }

  async function save(): Promise<boolean> {
    if (typeof draft !== 'object' || !currentUser) return false;
    setSaving(true);
    try {
      const r = await fetch(`/api/drafts/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          current_user_id: currentUser.id,
          part_number: draft.part_number,
          build_hours: draft.build_hours ?? 0,
          target_assembly_margin_pct: draft.target_assembly_margin_pct ?? 0,
          build_instr_1: draft.build_instr_1, build_instr_2: draft.build_instr_2, build_instr_3: draft.build_instr_3, build_instr_4: draft.build_instr_4, build_instr_5: draft.build_instr_5,
          work_instr_1:  draft.work_instr_1,  work_instr_2:  draft.work_instr_2,  work_instr_3:  draft.work_instr_3,  work_instr_4:  draft.work_instr_4,  work_instr_5:  draft.work_instr_5,
          lines: draft.lines.map((l) => ({
            id: l.id, sort_order: l.sort_order,
            component_part_number: l.component_part_number, part_description: l.part_description,
            quantity: l.quantity, chosen_price_point_id: l.chosen_price_point_id,
            price_override: l.price_override, supplier: l.supplier, lead_time_days: l.lead_time_days,
            product_code: l.product_code,
            is_commissioned: l.is_commissioned, commission_cap_pct: l.commission_cap_pct,
            sub_assembly_structure_id: l.sub_assembly_structure_id,
          })),
          tag_ids: draft.tags.map((t) => t.id),
        }),
      });
      const j = await r.json() as any;
      if (!r.ok) { alert(j.error ?? 'Save failed'); return false; }
      return true;
    } finally {
      setSaving(false);
    }
  }

  if (draft === 'loading')  return <Frame><p className="text-ink-500">Loading…</p></Frame>;
  if (draft === 'notfound') return <Frame><p className="text-rose-700">No draft for this structure ID.</p></Frame>;
  if (draft === 'error')    return <Frame><p className="text-rose-700">Couldn't load the draft.</p></Frame>;

  const youHoldLock = currentUser?.id === draft.editor_user_id;
  if (!youHoldLock) {
    return <Frame><div className="rounded-lg bg-white border border-ink-200 p-6">
      <p className="text-ink-700">This draft is checked out by <strong>{draft.editor_name}</strong>. Only the lock holder can edit. Switch the user dropdown to act as them, or <a href={`/structures/${id}`} className="text-indigo-700 hover:underline">view the live structure</a>.</p>
    </div></Frame>;
  }

  const topLevel = draft.spec_number + (draft.part_number || '');
  const bs = backsolve(
    draft.lines.map((l) => ({ unit_price: l.unit_price ?? l.price_override ?? 0, quantity: l.quantity, is_commissioned: l.is_commissioned, commission_cap_pct: l.commission_cap_pct } as LineForBacksolve)),
    draft.target_assembly_margin_pct ?? 0,
  );

  return (
    <Frame>
      <div className="rounded-lg bg-white border border-indigo-200 shadow-sm p-5">
        <div className="flex items-baseline gap-3 flex-wrap">
          <a href={`/structures/${id}`} className="text-xs text-ink-500 hover:text-indigo-700">← back to detail</a>
        </div>
        <div className="mt-2 flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl font-mono font-semibold text-ink-900">{topLevel || draft.part_number || '<new>'}</h1>
          <StatusBadge tone="amber">DRAFT</StatusBadge>
          <span className="text-sm text-ink-600">
            {draft.parent_structure_id ? <>variant of <span className="font-mono">{draft.spec_number}{draft.parent_part_number}</span></> :
             draft.live_current_construction_revision_number === 0 ? 'new base part' : 'revising live structure'}
          </span>
          <span className="text-sm font-mono text-ink-500">
            Will commit as CR {draft.live_current_construction_revision_number + 1} · PR {draft.live_current_price_revision_number + 1}
          </span>
        </div>

        {/* Live back-solve readout */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm rounded-md bg-indigo-50/60 border border-indigo-100 px-4 py-3">
          <Stat label="Total cost"     value={<span className="font-mono">{usd(bs.total_cost, true)}</span>} />
          <Stat label="Baseline sell"  value={<span className="font-mono font-semibold text-ink-900">{usd(bs.baseline_sell_price)}</span>} />
          <Stat label="Achieved margin" value={
            <span className={'font-mono ' + (bs.is_below_target ? 'text-rose-700' : 'text-emerald-700')}>
              {pct(bs.achieved_margin_pct)}
              {bs.is_below_target && ' (below target)'}
            </span>
          } />
          <Stat label="Target margin"  value={<span className="font-mono">{pct(draft.target_assembly_margin_pct ?? 0)}</span>} />
        </div>

        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <button
            onClick={async () => { if (await save()) setShowCheckin(true); }}
            disabled={saving}
            className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >Check in…</button>
          <button onClick={() => save()} disabled={saving} className="rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-50 disabled:opacity-50">{saving ? 'Saving…' : 'Save draft'}</button>
          <button onClick={() => setShowDiscard(true)} className="rounded-md border border-rose-300 text-rose-700 px-3 py-1.5 text-sm hover:bg-rose-50">Discard…</button>
          <span className="ml-auto text-xs text-ink-500">Holder: {draft.editor_name}</span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
        <div className="space-y-6 min-w-0">
          {/* Header fields */}
          <Section title="Structure fields">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <Field label="Part number" hint={`Live preview: ${topLevel || '—'}`}>
                <input
                  className="w-full font-mono px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={draft.part_number ?? ''}
                  onChange={(e) => update('part_number', e.target.value)}
                  maxLength={25}
                />
              </Field>
              <Field label="Build hours" hint="> 0">
                <input
                  type="number" step="0.5" min="0.1"
                  className="w-full font-mono px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={draft.build_hours ?? ''}
                  onChange={(e) => update('build_hours', Number(e.target.value))}
                />
              </Field>
              <Field label="Target margin" hint="0.00 – 0.99 (e.g. 0.35 = 35%)">
                <input
                  type="number" step="0.01" min="0" max="0.99"
                  className="w-full font-mono px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={draft.target_assembly_margin_pct ?? ''}
                  onChange={(e) => update('target_assembly_margin_pct', Number(e.target.value))}
                />
              </Field>
            </div>
          </Section>

          {/* BOM editor */}
          <Section title={`Bill of materials (${draft.lines.length} line${draft.lines.length === 1 ? '' : 's'})`} action={
            <button onClick={addLine} className="rounded-md bg-indigo-600 text-white px-2 py-1 text-xs font-medium hover:bg-indigo-700">+ Add line</button>
          }>
            {draft.lines.length === 0 ? (
              <p className="text-ink-500 italic">No lines yet. Click "+ Add line" to start.</p>
            ) : (
              <div className="space-y-2">
                {draft.lines.map((line, i) => (
                  <BomLineEditor
                    key={line.id}
                    line={line}
                    components={components}
                    loadPps={loadPps}
                    onChange={(p) => updateLine(i, p)}
                    onRemove={() => removeLine(i)}
                  />
                ))}
              </div>
            )}
          </Section>

          {/* Instructions */}
          <Section title="Instructions">
            <InstructionsEditor
              build={[draft.build_instr_1, draft.build_instr_2, draft.build_instr_3, draft.build_instr_4, draft.build_instr_5]}
              work={[draft.work_instr_1, draft.work_instr_2, draft.work_instr_3, draft.work_instr_4, draft.work_instr_5]}
              onChangeBuild={(idx, v) => update(`build_instr_${idx + 1}` as keyof Draft, v as any)}
              onChangeWork={(idx, v) => update(`work_instr_${idx + 1}` as keyof Draft, v as any)}
            />
          </Section>
        </div>

        <aside className="space-y-6">
          {/* Variant tag editor (only for variants) */}
          {draft.parent_structure_id && (
            <Section title="Variant tags" hint="At least one required.">
              <TagPicker
                kind="variant"
                names={tags?.variant ?? []}
                selected={new Set(draft.tags.filter((t) => t.kind === 'variant').map((t) => t.id))}
                allTags={tags}
                onToggle={(id, name) => toggleTag(id, name, 'variant')}
              />
            </Section>
          )}
          <Section title="General tags">
            <TagPicker
              kind="general"
              names={tags?.general ?? []}
              selected={new Set(draft.tags.filter((t) => t.kind === 'general').map((t) => t.id))}
              allTags={tags}
              onToggle={(id, name) => toggleTag(id, name, 'general')}
            />
          </Section>
        </aside>
      </div>

      {showCheckin && currentUser && (
        <CheckinDialog
          draft={draft}
          backsolved={bs}
          users={users}
          currentUser={currentUser}
          onClose={() => setShowCheckin(false)}
        />
      )}
      {showDiscard && currentUser && (
        <DiscardDialog
          structureId={id}
          currentUser={currentUser}
          isUncommitted={draft.live_current_construction_revision_number === 0}
          onClose={() => setShowDiscard(false)}
        />
      )}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs uppercase tracking-wide text-ink-500 mb-1">{label}</div>
      {children}
      {hint && <div className="text-[10px] text-ink-400 mt-1">{hint}</div>}
    </label>
  );
}

function Section({ title, children, action, hint }: { title: string; children: React.ReactNode; action?: React.ReactNode; hint?: string }) {
  return (
    <section className="rounded-lg bg-white border border-ink-200 shadow-sm overflow-hidden">
      <header className="px-5 py-3 border-b border-ink-200 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-ink-700 uppercase tracking-wide">{title}</h2>
        {hint && <span className="text-xs text-ink-500">{hint}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

// ---------- BOM line editor ----------

function BomLineEditor({ line, components, loadPps, onChange, onRemove }: {
  line: DraftLine;
  components: string[];
  loadPps: (component: string) => Promise<PpRow[]>;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const [pps, setPps] = useState<PpRow[] | null>(null);
  useEffect(() => {
    if (line.component_part_number) loadPps(line.component_part_number).then(setPps);
    else setPps(null);
  }, [line.component_part_number]);

  const matches = useMemo(() => {
    const q = (line.component_part_number ?? '').toLowerCase();
    if (!q) return [];
    return components.filter((c) => c.toLowerCase().startsWith(q) && c !== line.component_part_number).slice(0, 6);
  }, [components, line.component_part_number]);

  return (
    <div className="rounded-md border border-ink-200 p-3">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-xs text-ink-500 font-mono w-6">#{line.sort_order}</span>
        <span className="text-xs text-ink-500">
          {line.unit_price !== null && line.quantity > 0 ? `ext. ${usd((line.unit_price ?? 0) * line.quantity, true)}` : ''}
        </span>
        <button onClick={onRemove} className="ml-auto text-xs text-rose-600 hover:text-rose-800">remove</button>
      </div>
      <div className="grid grid-cols-12 gap-2 text-sm">
        <div className="col-span-12 md:col-span-4 relative">
          <input
            className="w-full font-mono text-xs px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Component part number"
            value={line.component_part_number}
            onChange={(e) => onChange({ component_part_number: e.target.value, chosen_price_point_id: null, unit_price: null })}
          />
          {matches.length > 0 && (
            <div className="absolute z-10 mt-0.5 w-full bg-white border border-ink-200 rounded-md shadow-md max-h-48 overflow-y-auto">
              {matches.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChange({ component_part_number: m, chosen_price_point_id: null, unit_price: null })}
                  className="block w-full text-left px-2 py-1 font-mono text-xs hover:bg-indigo-50"
                >{m}</button>
              ))}
            </div>
          )}
        </div>
        <div className="col-span-12 md:col-span-4">
          <input
            className="w-full text-xs px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Description"
            value={line.part_description}
            onChange={(e) => onChange({ part_description: e.target.value })}
          />
        </div>
        <div className="col-span-3 md:col-span-1">
          <input
            type="number" step="1" min="1"
            className="w-full font-mono text-xs px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={line.quantity}
            onChange={(e) => onChange({ quantity: Number(e.target.value) })}
          />
        </div>
        <div className="col-span-9 md:col-span-3">
          <select
            className="w-full text-xs px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={line.chosen_price_point_id ?? ''}
            onChange={(e) => {
              const id = e.target.value || null;
              const pp = pps?.find((p) => p.id === id);
              onChange({ chosen_price_point_id: id, unit_price: pp?.price ?? null, price_override: null });
            }}
          >
            <option value="">— pick price —</option>
            {(pps ?? []).sort((a, b) => Number(a.is_superseded) - Number(b.is_superseded)).map((p) => (
              <option key={p.id} value={p.id}>
                {usd(p.price, true)} · {p.tags.join(', ')} · {p.quote_number ?? '—'} {p.is_superseded ? '(superseded)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="col-span-4 md:col-span-3">
          <input
            className="w-full text-xs px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Supplier"
            value={line.supplier}
            onChange={(e) => onChange({ supplier: e.target.value })}
          />
        </div>
        <div className="col-span-4 md:col-span-2">
          <input
            className="w-full text-xs px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Product code"
            value={line.product_code}
            onChange={(e) => onChange({ product_code: e.target.value })}
          />
        </div>
        <div className="col-span-4 md:col-span-2">
          <input
            type="number" step="1" min="0"
            className="w-full text-xs px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Lead (d)"
            value={line.lead_time_days}
            onChange={(e) => onChange({ lead_time_days: Number(e.target.value) })}
          />
        </div>
        <div className="col-span-6 md:col-span-2">
          <label className="flex items-center gap-1.5 text-xs text-ink-700 cursor-pointer">
            <input
              type="checkbox"
              checked={line.is_commissioned}
              onChange={(e) => onChange({ is_commissioned: e.target.checked, commission_cap_pct: e.target.checked ? (line.commission_cap_pct ?? 0.05) : null })}
            />
            commissioned
          </label>
        </div>
        <div className="col-span-6 md:col-span-3">
          {line.is_commissioned && (
            <input
              type="number" step="0.01" min="0.01" max="0.99"
              className="w-full font-mono text-xs px-2 py-1.5 rounded border border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
              placeholder="cap (0.00 – 0.99)"
              value={line.commission_cap_pct ?? ''}
              onChange={(e) => onChange({ commission_cap_pct: Number(e.target.value) })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Tag picker ----------

function TagPicker({ kind, names, selected, allTags, onToggle }: {
  kind: 'general' | 'variant';
  names: string[];
  selected: Set<string>;
  allTags: TagsResp | null;
  onToggle: (id: string, name: string) => void;
}) {
  // We need tag IDs not just names for the API. Tags from /api/tags currently
  // returns just names. For Phase 4 prototype, look up tag IDs from a small lookup endpoint... actually
  // we'll fetch each tag's id by name via a single /api/tags-detailed if needed.
  // Quick fix: encode the tag id as the lowercase name (since the worker tolerates
  // ID lookups). Instead, we'll re-fetch tags WITH ids:
  const [tagIds, setTagIds] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    fetch(`/api/structures/_dummy`).catch(() => {}); // no-op
    // Fetch tag IDs (we don't have a dedicated endpoint — workaround:
    // grab them from a structure detail that has variant/general tags).
    // Simpler: hit /api/tags?with_ids=1 — but worker doesn't support that yet.
    // For prototype: encode tag ID = name_lower-based UUID lookup via search.
    // ACTUAL FIX: small lookup endpoint /api/tag-ids returning {name+kind → id}.
    // For now we look them up via a /api/tag-ids call.
    fetch('/api/tag-ids').then((r) => r.json()).then((d: { tags: Array<{ id: string; name: string; kind: string }> }) => {
      const map = new Map<string, string>();
      for (const t of d.tags) map.set(`${t.kind}:${t.name}`, t.id);
      setTagIds(map);
    }).catch(() => {});
  }, [allTags]);

  return (
    <div className="flex flex-wrap gap-1.5">
      {names.length === 0 && <p className="text-xs text-ink-500 italic">No tags of this kind yet.</p>}
      {names.map((name) => {
        const id = tagIds.get(`${kind}:${name}`);
        if (!id) return null;
        const active = selected.has(id);
        return (
          <button
            key={name}
            type="button"
            onClick={() => onToggle(id, name)}
            className={'rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition ' + tagStyle(kind, active)}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Instructions ----------

function InstructionsEditor({ build, work, onChangeBuild, onChangeWork }: {
  build: (string | null)[];
  work:  (string | null)[];
  onChangeBuild: (idx: number, v: string | null) => void;
  onChangeWork:  (idx: number, v: string | null) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <h3 className="text-xs uppercase tracking-wide text-ink-500 mb-2">Build</h3>
        {build.map((b, i) => (
          <input
            key={i}
            className="w-full text-sm px-2 py-1.5 mb-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder={`Build instruction ${i + 1}`}
            value={b ?? ''}
            onChange={(e) => onChangeBuild(i, e.target.value || null)}
          />
        ))}
      </div>
      <div>
        <h3 className="text-xs uppercase tracking-wide text-ink-500 mb-2">Work</h3>
        {work.map((b, i) => (
          <input
            key={i}
            className="w-full text-sm px-2 py-1.5 mb-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder={`Work instruction ${i + 1}`}
            value={b ?? ''}
            onChange={(e) => onChangeWork(i, e.target.value || null)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------- Check-in dialog ----------

function CheckinDialog({ draft, backsolved, users, currentUser, onClose }: {
  draft: Draft;
  backsolved: ReturnType<typeof backsolve>;
  users: User[];
  currentUser: User;
  onClose: () => void;
}) {
  const [crNotes, setCrNotes] = useState('');
  const [prNotes, setPrNotes] = useState('');
  const [sellTagName, setSellTagName] = useState('sell-2026');
  const [recipient, setRecipient] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const omUsers = users.filter((u) => u.role === 'order_management');

  async function submit() {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/drafts/${draft.structure_id}/checkin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          current_user_id: currentUser.id,
          cr_notes: crNotes || null,
          pr_notes: prNotes || null,
          sell_tag_names: [sellTagName],
          assigned_to_user_id: recipient || null,
          assignment_note: null,
        }),
      });
      const j = await r.json() as any;
      if (!r.ok) { alert(j.error ?? 'Check-in failed'); return; }
      window.location.href = `/structures/${draft.structure_id}`;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title="Check in"
      footer={
        <>
          <button onClick={onClose} disabled={submitting} className="rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-50">Cancel</button>
          <button onClick={submit} disabled={submitting} className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">{submitting ? 'Committing…' : 'Submit'}</button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 rounded-md bg-indigo-50/60 border border-indigo-100 px-4 py-3">
          <Stat label="Baseline sell"  value={<span className="font-mono font-semibold text-ink-900">{usd(backsolved.baseline_sell_price)}</span>} />
          <Stat label="Achieved margin" value={
            <span className={'font-mono ' + (backsolved.is_below_target ? 'text-rose-700' : 'text-emerald-700')}>
              {pct(backsolved.achieved_margin_pct)}{backsolved.is_below_target && ' (below)'}
            </span>
          } />
          <Stat label="Will commit"    value={<span className="font-mono text-ink-900">CR {draft.live_current_construction_revision_number + 1} · PR {draft.live_current_price_revision_number + 1}</span>} />
          <Stat label="Lines" value={<span className="font-mono">{draft.lines.length}</span>} />
        </div>

        <Field label="CR note (optional, surfaced to OM)">
          <textarea className="w-full text-sm px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500" rows={2} value={crNotes} onChange={(e) => setCrNotes(e.target.value)} />
        </Field>
        <Field label="PR note (optional, internal)">
          <textarea className="w-full text-sm px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500" rows={2} value={prNotes} onChange={(e) => setPrNotes(e.target.value)} />
        </Field>
        <Field label="Sell tag for the new structure_sell PRICE_POINT" hint="Defaulted to sell-2026.">
          <input className="w-full text-sm font-mono px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500" value={sellTagName} onChange={(e) => setSellTagName(e.target.value)} />
        </Field>
        <Field label="OM recipient (optional, CR commits only)" hint="Leave empty to commit without sending to OM.">
          <select className="w-full text-sm px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
            <option value="">— don't assign —</option>
            {omUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.display_name}</option>
            ))}
          </select>
        </Field>
      </div>
    </Dialog>
  );
}

// ---------- Discard dialog ----------

function DiscardDialog({ structureId, currentUser, isUncommitted, onClose }: { structureId: string; currentUser: User; isUncommitted: boolean; onClose: () => void }) {
  const [running, setRunning] = useState(false);
  async function go() {
    setRunning(true);
    try {
      const r = await fetch(`/api/drafts/${structureId}/discard`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current_user_id: currentUser.id }),
      });
      const j = await r.json() as any;
      if (!r.ok) { alert(j.error ?? 'Discard failed'); return; }
      window.location.href = isUncommitted ? '/' : `/structures/${structureId}`;
    } finally { setRunning(false); }
  }
  return (
    <Dialog
      open onClose={onClose}
      title="Discard draft?"
      footer={
        <>
          <button onClick={onClose} disabled={running} className="rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-50">Keep editing</button>
          <button onClick={go} disabled={running} className="rounded-md bg-rose-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-rose-700 disabled:opacity-50">{running ? 'Discarding…' : 'Discard'}</button>
        </>
      }
    >
      <p className="text-sm text-ink-700">
        {isUncommitted ? (
          <>This draft has never been checked in. Discarding will delete the placeholder structure entirely (T6).</>
        ) : (
          <>The live structure stays at its last committed CR / PR. Only the draft work is dropped (T5).</>
        )}
      </p>
    </Dialog>
  );
}
