import { useEffect, useMemo, useRef, useState } from 'react';
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
  spec_tags: string[];
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
  function updateLine(id: string, patch: Partial<DraftLine>) {
    setDraft((prev) => {
      if (typeof prev !== 'object') return prev;
      const lines = prev.lines.map((l) => l.id === id ? { ...l, ...patch } : l);
      return { ...prev, lines };
    });
  }
  function addLine(commissioned = false) {
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
        is_commissioned: commissioned,
        commission_cap_pct: commissioned ? 0.05 : null,
        sub_assembly_structure_id: null,
        sub_assembly_part_number: null,
      };
      return { ...prev, lines: [...prev.lines, newLine] };
    });
  }
  function removeLine(id: string) {
    setDraft((prev) => {
      if (typeof prev !== 'object') return prev;
      const lines = prev.lines.filter((l) => l.id !== id).map((l, i) => ({ ...l, sort_order: i + 1 }));
      return { ...prev, lines };
    });
  }
  function toggleCommissioned(id: string) {
    setDraft((prev) => {
      if (typeof prev !== 'object') return prev;
      const lines = prev.lines.map((l) => l.id === id
        ? { ...l, is_commissioned: !l.is_commissioned, commission_cap_pct: !l.is_commissioned ? (l.commission_cap_pct ?? 0.05) : null }
        : l);
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
            Will commit as Rev {draft.live_current_construction_revision_number + 1}
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

      <div className="mt-6 space-y-6">
          {/* Header fields */}
          <Section title="Structure fields">
            <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm items-end">
              <Field label="Part number" hint={`Live preview: ${topLevel || '—'}`}>
                <input
                  className="w-48 font-mono text-sm px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={draft.part_number ?? ''}
                  onChange={(e) => update('part_number', e.target.value)}
                  maxLength={25}
                />
              </Field>
              <Field label="Build hours" hint="step 0.5">
                <HoursInput
                  value={draft.build_hours ?? null}
                  onChange={(v) => update('build_hours', v as any)}
                />
              </Field>
              <Field label="Target margin" hint="0 – 99 percentage points">
                <PercentInput
                  value={draft.target_assembly_margin_pct ?? null}
                  onChange={(v) => update('target_assembly_margin_pct', v as any)}
                  min={0} max={99}
                />
              </Field>
            </div>
          </Section>

          {/* BOM editor — two sub-tables, same columns, different labels */}
          {(() => {
            const standard     = draft.lines.filter((l) => !l.is_commissioned).sort((a, b) => a.sort_order - b.sort_order);
            const commissioned = draft.lines.filter((l) =>  l.is_commissioned).sort((a, b) => a.sort_order - b.sort_order);
            return (
              <Section title={`Bill of materials (${draft.lines.length} line${draft.lines.length === 1 ? '' : 's'})`} action={
                <div className="flex items-baseline gap-3">
                  <span className="text-xs text-ink-500">Rolled-up cost</span>
                  <span className="font-mono text-sm font-semibold text-ink-900">{usd(bs.total_cost, true)}</span>
                </div>
              }>
                <div className="space-y-6">
                  <BomSubTable
                    label="Standard line items"
                    lines={standard}
                    isCommissionedTable={false}
                    components={components}
                    loadPps={loadPps}
                    onUpdate={updateLine}
                    onRemove={removeLine}
                    onToggleCommissioned={toggleCommissioned}
                    onAdd={() => addLine(false)}
                  />
                  <BomSubTable
                    label="Commissioned line items"
                    sublabel="Each commissioned line earns at most its cap; the back-solve loads the remaining margin onto the standard lines."
                    lines={commissioned}
                    isCommissionedTable
                    components={components}
                    loadPps={loadPps}
                    onUpdate={updateLine}
                    onRemove={removeLine}
                    onToggleCommissioned={toggleCommissioned}
                    onAdd={() => addLine(true)}
                  />
                </div>
              </Section>
            );
          })()}

          {/* Tags — grouped by kind, only applied shown by default */}
          <Section title="Tags">
            <TagsPanel
              draft={draft}
              tags={tags}
              onToggleVariant={(id, name) => toggleTag(id, name, 'variant')}
              onToggleGeneral={(id, name) => toggleTag(id, name, 'general')}
            />
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

// HoursInput — number input that snaps to 0.5 increments, formats blur
// value as one-decimal (so 7 → 7.0), selects all on focus to avoid the
// leading-zero quirk when the field starts at 0 or empty.
function HoursInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState<string>(value !== null && value !== undefined ? value.toFixed(1) : '');
  useEffect(() => {
    setText(value !== null && value !== undefined ? value.toFixed(1) : '');
  }, [value]);
  return (
    <input
      type="number" step="0.5" min="0.5"
      className="w-24 text-right font-mono text-sm px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      value={text}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value === '') { onChange(null); return; }
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => {
        if (value === null || value === undefined) return;
        // Snap to nearest 0.5, format with one decimal.
        const snapped = Math.max(0.5, Math.round(value * 2) / 2);
        setText(snapped.toFixed(1));
        if (snapped !== value) onChange(snapped);
      }}
    />
  );
}

// PercentInput — UI value is integer 0-99 (percentage points), stored as
// decimal 0.00 – 0.99 on the model. Clamps at the boundaries.
function PercentInput({ value, onChange, min = 0, max = 99, compact = false, placeholder }: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  compact?: boolean;
  placeholder?: string;
}) {
  const display = value === null || value === undefined ? '' : String(Math.round(value * 100));
  return (
    <span className={'inline-flex items-center gap-0.5 rounded border ' + (compact ? 'border-amber-300 bg-white' : 'border-ink-200')}>
      <input
        type="number" step="1" min={min} max={max}
        placeholder={placeholder}
        className={'text-right font-mono bg-transparent focus:outline-none ' +
          (compact
            ? 'w-10 text-xs px-1 py-1'
            : 'w-16 text-sm px-2 py-1.5')}
        value={display}
        onChange={(e) => {
          if (e.target.value === '') { onChange(null); return; }
          const raw = Number(e.target.value);
          if (!Number.isFinite(raw)) return;
          const clamped = Math.min(max, Math.max(min, raw));
          onChange(clamped / 100);
        }}
      />
      <span className={'text-ink-400 pr-1.5 ' + (compact ? 'text-[10px]' : 'text-xs')}>%</span>
    </span>
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

// ---------- BOM sub-tables ----------

function BomSubTable({ label, sublabel, lines, isCommissionedTable, components, loadPps, onUpdate, onRemove, onToggleCommissioned, onAdd }: {
  label: string;
  sublabel?: string;
  lines: DraftLine[];
  isCommissionedTable: boolean;
  components: string[];
  loadPps: (c: string) => Promise<PpRow[]>;
  onUpdate: (id: string, patch: Partial<DraftLine>) => void;
  onRemove: (id: string) => void;
  onToggleCommissioned: (id: string) => void;
  onAdd: () => void;
}) {
  const subtotal = lines.reduce((s, l) => s + (l.unit_price ?? 0) * (l.quantity ?? 0), 0);
  return (
    <div>
      <div className="flex items-baseline gap-3 mb-1.5">
        <h3 className={'text-xs uppercase tracking-wide font-semibold ' + (isCommissionedTable ? 'text-amber-800' : 'text-ink-600')}>{label}</h3>
        <span className="text-xs text-ink-500">{lines.length} line{lines.length === 1 ? '' : 's'} · subtotal <span className="font-mono">{usd(subtotal, true)}</span></span>
        <button onClick={onAdd} className="ml-auto rounded-md border border-indigo-300 text-indigo-700 px-2 py-0.5 text-xs font-medium hover:bg-indigo-50">+ Add line</button>
      </div>
      {sublabel && <p className="text-xs text-ink-500 mb-1.5">{sublabel}</p>}
      <div className="overflow-x-auto rounded-md border border-ink-200">
        <table className="w-full text-xs">
          <thead className={'text-ink-500 uppercase tracking-wide text-[10px] ' + (isCommissionedTable ? 'bg-amber-50' : 'bg-ink-50')}>
            <tr>
              <th className="px-2 py-1.5 text-left w-8">#</th>
              <th className="px-2 py-1.5 text-left">Component</th>
              <th className="px-2 py-1.5 text-left">Description</th>
              <th className="px-2 py-1.5 text-right w-12">Qty</th>
              <th className="px-2 py-1.5 text-left">Unit price</th>
              <th className="px-2 py-1.5 text-right w-20">Ext.</th>
              <th className="px-2 py-1.5 text-left">Supplier</th>
              <th className="px-2 py-1.5 text-left">Product code</th>
              <th className="px-2 py-1.5 text-right w-12">Lead</th>
              <th className="px-2 py-1.5 text-right w-16">Cap</th>
              <th className="px-2 py-1.5 text-center w-8" title={isCommissionedTable ? 'Uncheck to move back to standard.' : 'Check to move to commissioned.'}>Comm.</th>
              <th className="px-1 py-1.5 text-center w-8"></th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr><td colSpan={12} className="px-2 py-3 text-center text-ink-500 italic">No lines. Click "+ Add line" to create one.</td></tr>
            ) : lines.map((line) => (
              <BomTableRow
                key={line.id}
                line={line}
                isCommissionedTable={isCommissionedTable}
                components={components}
                loadPps={loadPps}
                onChange={(patch) => onUpdate(line.id, patch)}
                onRemove={() => onRemove(line.id)}
                onToggleCommissioned={() => onToggleCommissioned(line.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BomTableRow({ line, isCommissionedTable, components, loadPps, onChange, onRemove, onToggleCommissioned }: {
  line: DraftLine;
  isCommissionedTable: boolean;
  components: string[];
  loadPps: (c: string) => Promise<PpRow[]>;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
  onToggleCommissioned: () => void;
}) {
  const [pps, setPps] = useState<PpRow[] | null>(null);
  useEffect(() => {
    if (!line.component_part_number) { setPps(null); return; }
    let cancelled = false;
    loadPps(line.component_part_number).then((rows) => {
      if (cancelled) return;
      setPps(rows);
      // Auto-pick a PP only if neither chosen_pp nor override is set.
      if (!line.chosen_price_point_id && line.price_override === null && rows.length > 0) {
        const pick = rows.find((p) => !p.is_superseded) ?? rows[0];
        onChange({ chosen_price_point_id: pick.id, unit_price: pick.price, price_override: null });
      }
    });
    return () => { cancelled = true; };
  }, [line.component_part_number]);

  const [focused, setFocused] = useState(false);
  // Remember the PP id (and unit price) the engineer was using before they
  // flipped the override toggle on. Restored when they flip it back off.
  const savedPp = useRef<{ id: string; price: number } | null>(null);
  const matches = useMemo(() => {
    const q = (line.component_part_number ?? '').toLowerCase();
    if (!q) return [];
    return components.filter((c) => c.toLowerCase().startsWith(q) && c !== line.component_part_number).slice(0, 6);
  }, [components, line.component_part_number]);

  const ext = (line.unit_price ?? 0) * (line.quantity ?? 0);

  return (
    <tr className="border-t border-ink-100 align-top hover:bg-ink-50/40">
      <td className="px-2 py-1 font-mono text-ink-400">{line.sort_order}</td>
      <td className="px-2 py-1 relative min-w-[140px]">
        <input
          className="w-full font-mono text-xs px-1.5 py-1 rounded border border-transparent hover:border-ink-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-transparent"
          placeholder="Part number"
          value={line.component_part_number}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onChange={(e) => onChange({ component_part_number: e.target.value, chosen_price_point_id: null, unit_price: null })}
        />
        {focused && matches.length > 0 && (
          <div className="absolute z-20 left-2 right-2 mt-0.5 bg-white border border-ink-200 rounded-md shadow-md max-h-48 overflow-y-auto">
            {matches.map((m) => (
              <button
                key={m}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange({ component_part_number: m, chosen_price_point_id: null, unit_price: null }); setFocused(false); }}
                className="block w-full text-left px-2 py-1 font-mono text-xs hover:bg-indigo-50"
              >{m}</button>
            ))}
          </div>
        )}
      </td>
      <td className="px-2 py-1 min-w-[180px]">
        <input
          className="w-full text-xs px-1.5 py-1 rounded border border-transparent hover:border-ink-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-transparent"
          placeholder="Description"
          value={line.part_description}
          onChange={(e) => onChange({ part_description: e.target.value })}
        />
      </td>
      <td className="px-2 py-1">
        <input
          type="number" step="1" min="1"
          className="w-12 text-right font-mono text-xs px-1 py-1 rounded border border-transparent hover:border-ink-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-transparent"
          value={line.quantity}
          onChange={(e) => onChange({ quantity: Number(e.target.value) })}
        />
      </td>
      <td className="px-2 py-1 min-w-[260px]">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            {line.price_override !== null ? (
              <span className="inline-flex items-center gap-0.5 rounded border border-amber-300 bg-white">
                <span className="text-ink-400 text-xs pl-1.5">$</span>
                <input
                  type="number" step="0.01" min="0"
                  className="w-24 text-right font-mono text-xs px-1 py-1 bg-transparent focus:outline-none"
                  placeholder="0.00"
                  value={line.price_override ?? ''}
                  onChange={(e) => {
                    const v = e.target.value === '' ? 0 : Number(e.target.value);
                    onChange({ price_override: v, unit_price: v });
                  }}
                />
                <span className="text-amber-700 text-[10px] pr-1.5 uppercase tracking-wide">override</span>
              </span>
            ) : (
              <select
                className="w-full text-xs px-1.5 py-1 rounded border border-transparent hover:border-ink-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-transparent"
                value={line.chosen_price_point_id ?? ''}
                onChange={(e) => {
                  const id = e.target.value || null;
                  const pp = pps?.find((p) => p.id === id);
                  savedPp.current = pp ? { id: pp.id, price: pp.price } : null;
                  onChange({ chosen_price_point_id: id, unit_price: pp?.price ?? null, price_override: null });
                }}
              >
                <option value="">— pick price —</option>
                {(pps ?? []).sort((a, b) => Number(a.is_superseded) - Number(b.is_superseded)).map((p) => (
                  <option key={p.id} value={p.id}>
                    {usd(p.price, true)} · {p.tags.join(', ') || '—'} · {p.quote_number ?? '—'}{p.is_superseded ? ' (superseded)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
          <label className="inline-flex items-center gap-1 text-[10px] text-ink-500 cursor-pointer shrink-0" title={line.price_override !== null ? 'Uncheck to revert to the previously selected PRICE_POINT.' : 'Check to enter a one-off override price.'}>
            <input
              type="checkbox"
              checked={line.price_override !== null}
              onChange={(e) => {
                if (e.target.checked) {
                  // Save the current PP so we can revert later.
                  if (line.chosen_price_point_id) {
                    savedPp.current = { id: line.chosen_price_point_id, price: line.unit_price ?? 0 };
                  }
                  const seed = line.unit_price ?? 0;
                  onChange({ price_override: seed, unit_price: seed, chosen_price_point_id: null });
                } else {
                  // Revert to the saved PP if we have one; otherwise let auto-pick re-select.
                  if (savedPp.current) {
                    onChange({ chosen_price_point_id: savedPp.current.id, unit_price: savedPp.current.price, price_override: null });
                  } else {
                    onChange({ chosen_price_point_id: null, unit_price: null, price_override: null });
                  }
                }
              }}
            />
            ovr
          </label>
        </div>
      </td>
      <td className="px-2 py-1 text-right font-mono text-ink-900">{line.unit_price !== null ? usd(ext, true) : '—'}</td>
      <td className="px-2 py-1 min-w-[120px]">
        <input
          className="w-full text-xs px-1.5 py-1 rounded border border-transparent hover:border-ink-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-transparent"
          placeholder="Supplier"
          value={line.supplier}
          onChange={(e) => onChange({ supplier: e.target.value })}
        />
      </td>
      <td className="px-2 py-1 min-w-[120px]">
        <input
          className="w-full text-xs px-1.5 py-1 rounded border border-transparent hover:border-ink-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-transparent font-mono"
          placeholder="Product code"
          value={line.product_code}
          onChange={(e) => onChange({ product_code: e.target.value })}
        />
      </td>
      <td className="px-2 py-1">
        <input
          type="number" step="1" min="0"
          className="w-12 text-right font-mono text-xs px-1 py-1 rounded border border-transparent hover:border-ink-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-transparent"
          value={line.lead_time_days}
          onChange={(e) => onChange({ lead_time_days: Number(e.target.value) })}
        />
      </td>
      <td className="px-2 py-1">
        {line.is_commissioned ? (
          <PercentInput
            value={line.commission_cap_pct ?? null}
            onChange={(v) => onChange({ commission_cap_pct: v })}
            min={1} max={99}
            compact
            placeholder="5"
          />
        ) : (
          <span className="text-ink-300 text-xs">—</span>
        )}
      </td>
      <td className="px-2 py-1 text-center">
        <input
          type="checkbox"
          checked={line.is_commissioned}
          onChange={onToggleCommissioned}
          title={line.is_commissioned ? 'Uncheck to move back to standard line items.' : 'Check to move to commissioned line items.'}
        />
      </td>
      <td className="px-1 py-1 text-center">
        <button onClick={onRemove} className="text-rose-600 hover:text-rose-800 text-base leading-none" title="Remove line">×</button>
      </td>
    </tr>
  );
}

// ---------- Tag panel ----------

function TagsPanel({ draft, tags, onToggleVariant, onToggleGeneral }: {
  draft: Draft;
  tags: TagsResp | null;
  onToggleVariant: (id: string, name: string) => void;
  onToggleGeneral: (id: string, name: string) => void;
}) {
  const [tagIds, setTagIds] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    fetch('/api/tag-ids').then((r) => r.json()).then((d: { tags: Array<{ id: string; name: string; kind: string }> }) => {
      const map = new Map<string, string>();
      for (const t of d.tags) map.set(`${t.kind}:${t.name}`, t.id);
      setTagIds(map);
    }).catch(() => {});
  }, []);

  const appliedGeneral = draft.tags.filter((t) => t.kind === 'general');
  const appliedVariant = draft.tags.filter((t) => t.kind === 'variant');
  const isVariant = draft.parent_structure_id !== null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {/* Spec tags — read-only context */}
      <TagGroup
        label="Spec tags"
        hint="Inherited from the parent spec. Edit on the spec itself, not here."
        kind="spec"
        applied={draft.spec_tags.map((name) => ({ id: name, name }))}
        available={[]}
        canEdit={false}
        onToggle={() => {}}
      />

      {/* General tags */}
      <TagGroup
        label="General tags"
        hint="Apply to this individual structure."
        kind="general"
        applied={appliedGeneral.map((t) => ({ id: t.id, name: t.name }))}
        available={(tags?.general ?? [])
          .filter((n) => !appliedGeneral.some((a) => a.name === n))
          .map((n) => ({ id: tagIds.get(`general:${n}`) ?? '', name: n }))
          .filter((t) => t.id)}
        canEdit
        onToggle={onToggleGeneral}
      />

      {/* Variant tags — only for variants */}
      {isVariant && (
        <TagGroup
          label="Variant tags"
          hint="At least one required for a variant to check in."
          kind="variant"
          applied={appliedVariant.map((t) => ({ id: t.id, name: t.name }))}
          available={(tags?.variant ?? [])
            .filter((n) => !appliedVariant.some((a) => a.name === n))
            .map((n) => ({ id: tagIds.get(`variant:${n}`) ?? '', name: n }))
            .filter((t) => t.id)}
          canEdit
          onToggle={onToggleVariant}
        />
      )}
    </div>
  );
}

function TagGroup({ label, hint, kind, applied, available, canEdit, onToggle }: {
  label: string;
  hint: string;
  kind: 'spec' | 'general' | 'variant';
  applied: Array<{ id: string; name: string }>;
  available: Array<{ id: string; name: string }>;
  canEdit: boolean;
  onToggle: (id: string, name: string) => void;
}) {
  const [showAvailable, setShowAvailable] = useState(false);
  return (
    <div>
      <div className="mb-1.5">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-ink-600">{label}</h3>
        <p className="text-[10px] text-ink-500 mt-0.5">{hint}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {applied.length === 0 && <span className="text-xs text-ink-400 italic">none applied</span>}
        {applied.map((t) => (
          canEdit ? (
            <button
              key={t.id}
              type="button"
              onClick={() => onToggle(t.id, t.name)}
              className={'group inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition ' + tagStyle(kind, true)}
              title="Click to remove"
            >
              {t.name}
              <span className="opacity-0 group-hover:opacity-100 text-[10px]">×</span>
            </button>
          ) : (
            <span
              key={t.id}
              className={'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' + tagStyle(kind, false)}
            >
              {t.name}
            </span>
          )
        ))}
      </div>
      {canEdit && available.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowAvailable((v) => !v)}
            className="text-[11px] text-indigo-600 hover:text-indigo-800 hover:underline"
          >
            {showAvailable ? `− Hide available (${available.length})` : `+ Show ${available.length} available tag${available.length === 1 ? '' : 's'}`}
          </button>
          {showAvailable && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {available.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onToggle(t.id, t.name)}
                  className={'rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition ' + tagStyle(kind, false)}
                  title="Click to apply"
                >
                  + {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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
  const [notes, setNotes] = useState('');
  const [sellTagName, setSellTagName] = useState('sell-2026');
  const [recipient, setRecipient] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const omUsers = users.filter((u) => u.role === 'order_management');

  // Determine whether this is a build change (Rev bumps) or pricing-only.
  // We can't detect this perfectly without re-querying the server, but we
  // can heuristically: if it's a brand-new structure (CR=0) it always bumps.
  // Otherwise the server's check-in cascade authoritatively decides.
  const isBrandNew = draft.live_current_construction_revision_number === 0;
  const nextRev = draft.live_current_construction_revision_number + 1;

  async function submit() {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/drafts/${draft.structure_id}/checkin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          current_user_id: currentUser.id,
          cr_notes: notes || null,
          pr_notes: null,
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
      title={isBrandNew ? `Check in as Rev ${nextRev}` : `Check in — Rev ${draft.live_current_construction_revision_number} → Rev ${nextRev}`}
      footer={
        <>
          <button onClick={onClose} disabled={submitting} className="rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-50">Cancel</button>
          <button onClick={submit} disabled={submitting} className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">{submitting ? 'Committing…' : 'Submit'}</button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-3 gap-4 rounded-md bg-indigo-50/60 border border-indigo-100 px-4 py-3">
          <Stat label="Baseline sell" value={<span className="font-mono font-semibold text-ink-900">{usd(backsolved.baseline_sell_price)}</span>} />
          <Stat label="Achieved margin" value={
            <span className={'font-mono ' + (backsolved.is_below_target ? 'text-rose-700' : 'text-emerald-700')}>
              {pct(backsolved.achieved_margin_pct)}{backsolved.is_below_target && ' (below)'}
            </span>
          } />
          <Stat label="Lines" value={<span className="font-mono">{draft.lines.length}</span>} />
        </div>

        <Field label="Revision note (optional, surfaced to OM)">
          <textarea className="w-full text-sm px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder='e.g. "New variant for North Slope project — arctic body + low-temp packing."' />
        </Field>
        <Field label="Sell-price tag" hint="Defaults to the current sell year.">
          <input className="w-40 text-sm font-mono px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500" value={sellTagName} onChange={(e) => setSellTagName(e.target.value)} />
        </Field>
        <Field label="Send to OM (optional)" hint="If the build changed and you pick a recipient, they get an inbox item. Pure pricing updates never go to OM regardless.">
          <select className="w-72 text-sm px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
            <option value="">— don't send to OM —</option>
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
