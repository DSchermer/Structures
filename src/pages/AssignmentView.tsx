import { useEffect, useState } from 'react';
import type { StructureDetail, User, LineItemDetail } from '../types';
import { Chip, StatusBadge, usd, formatDate, formatDateTime, pct } from '../components/shared';

type LineSummary = { sort_order: number; component: string; description: string; quantity: number; supplier: string; product_code: string };
type FieldDiff   = { field: string; old: unknown; new: unknown };
type TagDiff     = { name: string; kind: string };
type RichChangeSet = {
  line_items?: { added?: LineSummary[]; removed?: LineSummary[]; modified?: Array<{ sort_order: number; component: string; fields: FieldDiff[] }> };
  structure_fields?: FieldDiff[];
  tags?: { added?: TagDiff[]; removed?: TagDiff[] };
};
// Older commits used { added: N, removed: N, modified: N } counts.
type LegacyChangeSet = { line_items?: { added?: number; removed?: number; modified?: number }; tags?: { added?: number }; structure_fields?: any };
type AnyChangeSet = RichChangeSet | LegacyChangeSet | null;

type AssignmentResp = {
  assignment: {
    id: string;
    assigned_by_name: string;
    recipient_name: string;
    assigned_to_user_id: string;
    assigned_at: string;
    acknowledged: boolean;
    acknowledged_at: string | null;
    note: string | null;
  };
  cr: {
    id: string;
    revision_number: number;
    committed_at: string;
    notes: string | null;
    change_set: AnyChangeSet;
  };
  structure: {
    id: string;
    top_level_part_number: string;
    spec_number: string;
    part_number: string;
    spec_customer_revision: string;
    is_archived: boolean;
    is_below_target: boolean;
  };
  detail: StructureDetail;
};

export default function AssignmentView({ id, currentUser }: { id: string; currentUser: User | null }) {
  const [data, setData] = useState<AssignmentResp | 'loading' | 'error' | 'notfound'>('loading');
  const [acking, setAcking] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/assignments/${id}`);
        if (r.status === 404) { setData('notfound'); return; }
        setData(await r.json() as AssignmentResp);
      } catch { setData('error'); }
    })();
  }, [id]);

  async function acknowledge() {
    if (typeof data !== 'object' || !currentUser) return;
    setAcking(true);
    try {
      const r = await fetch(`/api/assignments/${id}/acknowledge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current_user_id: currentUser.id }),
      });
      const j = await r.json() as any;
      if (!r.ok) { alert(j.error ?? 'Acknowledge failed'); return; }
      // Re-fetch to update state
      const r2 = await fetch(`/api/assignments/${id}`);
      setData(await r2.json() as AssignmentResp);
    } finally { setAcking(false); }
  }

  if (data === 'loading')  return <Frame><p className="text-ink-500">Loading…</p></Frame>;
  if (data === 'notfound') return <Frame><p className="text-rose-700">No assignment with that ID.</p></Frame>;
  if (data === 'error')    return <Frame><p className="text-rose-700">Couldn't load the assignment.</p></Frame>;

  const { assignment, cr, structure, detail } = data;
  const isRecipient = currentUser?.id === assignment.assigned_to_user_id;
  const cs = cr.change_set ?? {};
  const totalCost = detail.line_items.reduce((s, li) => s + (li.unit_price ?? 0) * li.quantity, 0);

  return (
    <Frame>
      <div className="mb-4">
        <a href="/inbox" className="text-xs text-ink-500 hover:text-indigo-700">← inbox</a>
      </div>

      <div className="rounded-lg bg-white border border-ink-200 shadow-sm p-5">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold text-ink-900">
            Rev <span className="font-mono">{cr.revision_number}</span> of <span className="font-mono">{structure.top_level_part_number}</span>
          </h1>
          {assignment.acknowledged && <StatusBadge tone="emerald">ENTERED INTO ERP</StatusBadge>}
          {structure.is_archived     && <StatusBadge tone="rose">ARCHIVED</StatusBadge>}
          {structure.is_below_target && <StatusBadge tone="amber">BELOW TARGET</StatusBadge>}
        </div>
        <div className="mt-2 text-sm text-ink-600">
          Assigned by <strong className="text-ink-800">{assignment.assigned_by_name}</strong> to <strong className="text-ink-800">{assignment.recipient_name}</strong> on {formatDate(assignment.assigned_at)}
        </div>
        {(assignment.note || cr.notes) && (
          <div className="mt-3 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-ink-800">
            <div className="text-[10px] uppercase tracking-wide text-amber-700 mb-1">Engineer's note</div>
            {assignment.note ?? cr.notes}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Stat label="Spec"           value={<span className="font-mono">{structure.spec_number} · {structure.spec_customer_revision}</span>} />
          <Stat label="Lines"          value={<span className="font-mono">{detail.line_items.length}</span>} />
          <Stat label="Rolled-up cost" value={<span className="font-mono">{usd(totalCost, true)}</span>} />
          <Stat label="Committed"      value={<span className="text-ink-700">{formatDateTime(cr.committed_at)}</span>} />
        </div>

        {/* "What changed" summary */}
        <div className="mt-5 rounded-md bg-ink-50 border border-ink-200 px-4 py-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-ink-500 mb-1">What changed in this revision</div>
          <ChangeSetSummary cs={cs} />
        </div>

        <div className="mt-5 flex items-center gap-2 flex-wrap">
          {!assignment.acknowledged && (
            isRecipient ? (
              <button
                onClick={acknowledge}
                disabled={acking}
                className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {acking ? 'Marking…' : 'Mark as entered into ERP'}
              </button>
            ) : (
              <span className="text-xs text-ink-500 italic">
                Only {assignment.recipient_name} can mark this as entered.
              </span>
            )
          )}
          {assignment.acknowledged && (
            <span className="text-sm text-emerald-700">
              Marked entered on {formatDate(assignment.acknowledged_at)} by {assignment.recipient_name}.
            </span>
          )}
          <a href={`/structures/${structure.id}`} className="ml-auto text-xs text-ink-500 hover:text-indigo-700">view full structure detail →</a>
        </div>
      </div>

      <section className="mt-6 rounded-lg bg-white border border-ink-200 shadow-sm overflow-hidden">
        <header className="px-5 py-3 border-b border-ink-200">
          <h2 className="text-sm font-semibold text-ink-700 uppercase tracking-wide">Current structure as committed</h2>
        </header>
        <div className="p-5">
          <BomList lines={detail.line_items} />
          {detail.build_instructions.length + detail.work_instructions.length > 0 && (
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-xs uppercase tracking-wide text-ink-500 mb-2">Build instructions</h3>
                {detail.build_instructions.length === 0 ? <p className="text-ink-500 italic text-sm">None.</p> : (
                  <ol className="list-decimal list-inside space-y-1.5 text-sm text-ink-700">
                    {detail.build_instructions.map((b, i) => <li key={i}>{b}</li>)}
                  </ol>
                )}
              </div>
              <div>
                <h3 className="text-xs uppercase tracking-wide text-ink-500 mb-2">Work instructions</h3>
                {detail.work_instructions.length === 0 ? <p className="text-ink-500 italic text-sm">None.</p> : (
                  <ol className="list-decimal list-inside space-y-1.5 text-sm text-ink-700">
                    {detail.work_instructions.map((b, i) => <li key={i}>{b}</li>)}
                  </ol>
                )}
              </div>
            </div>
          )}
          <div className="mt-6">
            <div className="text-xs uppercase tracking-wide text-ink-500 mb-1.5">Tags</div>
            <div className="flex flex-wrap gap-1.5">
              {detail.spec_tags.map((t) => <Chip key={`s-${t}`} kind="spec" name={t} />)}
              {detail.variant_tags.map((t) => <Chip key={`v-${t.name}`} kind="variant" name={t.name} />)}
              {detail.general_tags.map((t) => <Chip key={`g-${t.name}`} kind="general" name={t.name} />)}
            </div>
          </div>
        </div>
      </section>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-5xl px-6 py-6">{children}</div>;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}

function ChangeSetSummary({ cs }: { cs: AnyChangeSet }) {
  if (!cs) return <p className="text-ink-500 italic">No change_set recorded for this revision.</p>;

  // Legacy format (count-only)
  const li = (cs as any).line_items ?? {};
  const isLegacy = typeof li.added === 'number' || typeof li.removed === 'number' || typeof li.modified === 'number';

  if (isLegacy) {
    const parts: { tone: 'emerald' | 'amber' | 'rose' | 'slate'; label: string }[] = [];
    if (li.added)    parts.push({ tone: 'emerald', label: `${li.added} line${li.added === 1 ? '' : 's'} added` });
    if (li.modified) parts.push({ tone: 'amber',   label: `${li.modified} line${li.modified === 1 ? '' : 's'} modified` });
    if (li.removed)  parts.push({ tone: 'rose',    label: `${li.removed} line${li.removed === 1 ? '' : 's'} removed` });
    const tagsAdded = (cs as any).tags?.added;
    if (typeof tagsAdded === 'number' && tagsAdded > 0) parts.push({ tone: 'slate', label: `${tagsAdded} tag${tagsAdded === 1 ? '' : 's'} added` });
    if ((cs as any).structure_fields?.part_number_changed) parts.push({ tone: 'amber', label: 'part number changed' });
    if ((cs as any).structure_fields?.build_hours_changed) parts.push({ tone: 'amber', label: 'build hours changed' });
    if (parts.length === 0) return <p className="text-ink-500 italic">No itemized changes recorded.</p>;
    return (
      <div className="flex flex-wrap gap-1.5">
        {parts.map((p, i) => <StatusBadge key={i} tone={p.tone}>{p.label}</StatusBadge>)}
        <p className="text-[10px] text-ink-400 mt-1 basis-full">(committed before the rich diff format — only counts available)</p>
      </div>
    );
  }

  // Rich format
  const rich = cs as RichChangeSet;
  const lineAdded    = rich.line_items?.added    ?? [];
  const lineRemoved  = rich.line_items?.removed  ?? [];
  const lineModified = rich.line_items?.modified ?? [];
  const structFields = rich.structure_fields     ?? [];
  const tagsAdded    = rich.tags?.added          ?? [];
  const tagsRemoved  = rich.tags?.removed        ?? [];

  const isEmpty = lineAdded.length + lineRemoved.length + lineModified.length + structFields.length + tagsAdded.length + tagsRemoved.length === 0;
  if (isEmpty) return <p className="text-ink-500 italic">No itemized changes.</p>;

  return (
    <div className="space-y-3 text-sm">
      {/* summary chip row */}
      <div className="flex flex-wrap gap-1.5">
        {lineAdded.length    > 0 && <StatusBadge tone="emerald">{lineAdded.length} added</StatusBadge>}
        {lineModified.length > 0 && <StatusBadge tone="amber">{lineModified.length} modified</StatusBadge>}
        {lineRemoved.length  > 0 && <StatusBadge tone="rose">{lineRemoved.length} removed</StatusBadge>}
        {tagsAdded.length    > 0 && <StatusBadge tone="emerald">+{tagsAdded.length} tag{tagsAdded.length === 1 ? '' : 's'}</StatusBadge>}
        {tagsRemoved.length  > 0 && <StatusBadge tone="rose">−{tagsRemoved.length} tag{tagsRemoved.length === 1 ? '' : 's'}</StatusBadge>}
        {structFields.length > 0 && <StatusBadge tone="amber">{structFields.length} structure field{structFields.length === 1 ? '' : 's'} changed</StatusBadge>}
      </div>

      {lineAdded.length > 0 && (
        <DiffBlock tone="emerald" label="Lines added">
          {lineAdded.map((l) => <LineLine key={`a-${l.sort_order}`} l={l} />)}
        </DiffBlock>
      )}
      {lineRemoved.length > 0 && (
        <DiffBlock tone="rose" label="Lines removed">
          {lineRemoved.map((l) => <LineLine key={`r-${l.sort_order}`} l={l} strikethrough />)}
        </DiffBlock>
      )}
      {lineModified.length > 0 && (
        <DiffBlock tone="amber" label="Lines modified">
          {lineModified.map((l) => (
            <div key={`m-${l.sort_order}`} className="border-t border-amber-100 first:border-t-0 py-1.5 first:pt-0 last:pb-0">
              <div className="font-mono text-xs text-ink-900">
                <span className="text-ink-400">#{l.sort_order}</span> · {l.component}
              </div>
              <ul className="mt-0.5 ml-3 space-y-0.5">
                {l.fields.map((f, i) => <li key={i} className="text-[11px] text-ink-700">{prettyField(f.field)}: <FieldChange old={f.old} next={f.new} /></li>)}
              </ul>
            </div>
          ))}
        </DiffBlock>
      )}
      {structFields.length > 0 && (
        <DiffBlock tone="amber" label="Structure fields changed">
          <ul className="space-y-0.5">
            {structFields.map((f, i) => <li key={i} className="text-[12px] text-ink-700">{prettyField(f.field)}: <FieldChange old={f.old} next={f.new} /></li>)}
          </ul>
        </DiffBlock>
      )}
      {(tagsAdded.length > 0 || tagsRemoved.length > 0) && (
        <DiffBlock tone="slate" label="Tags">
          <div className="flex flex-wrap gap-1.5">
            {tagsAdded.map((t, i) => (
              <span key={`ta-${i}`} className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset bg-emerald-50 text-emerald-800 ring-emerald-200">
                + {t.name} <span className="ml-1 text-[10px] text-emerald-600">{t.kind}</span>
              </span>
            ))}
            {tagsRemoved.map((t, i) => (
              <span key={`tr-${i}`} className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset bg-rose-50 text-rose-800 ring-rose-200 line-through">
                − {t.name} <span className="ml-1 text-[10px] text-rose-600 no-underline">{t.kind}</span>
              </span>
            ))}
          </div>
        </DiffBlock>
      )}
    </div>
  );
}

function DiffBlock({ tone, label, children }: { tone: 'emerald' | 'rose' | 'amber' | 'slate'; label: string; children: React.ReactNode }) {
  const cls: Record<typeof tone, string> = {
    emerald: 'border-emerald-200 bg-emerald-50/60',
    rose:    'border-rose-200 bg-rose-50/60',
    amber:   'border-amber-200 bg-amber-50/60',
    slate:   'border-ink-200 bg-ink-50',
  };
  const headCls: Record<typeof tone, string> = {
    emerald: 'text-emerald-800',
    rose:    'text-rose-800',
    amber:   'text-amber-800',
    slate:   'text-ink-700',
  };
  return (
    <div className={'rounded-md border px-3 py-2 ' + cls[tone]}>
      <h3 className={'text-[10px] uppercase tracking-wide font-semibold mb-1 ' + headCls[tone]}>{label}</h3>
      <div>{children}</div>
    </div>
  );
}

function LineLine({ l, strikethrough = false }: { l: LineSummary; strikethrough?: boolean }) {
  return (
    <div className={'text-xs ' + (strikethrough ? 'line-through opacity-70' : '')}>
      <span className="text-ink-400 font-mono">#{l.sort_order}</span>
      <span className="font-mono text-ink-900 ml-2">{l.component}</span>
      <span className="text-ink-500 ml-2">qty {l.quantity} · {l.supplier}</span>
      {l.description && <span className="text-ink-500 ml-2 italic">"{l.description}"</span>}
    </div>
  );
}

function FieldChange({ old, next }: { old: unknown; next: unknown }) {
  return (
    <>
      <span className="font-mono text-ink-500 line-through">{formatVal(old)}</span>
      <span className="mx-1.5 text-ink-400">→</span>
      <span className="font-mono text-ink-900">{formatVal(next)}</span>
    </>
  );
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v.length === 0 ? '∅' : v;
  return String(v);
}

function prettyField(f: string): string {
  return f
    .replace(/_/g, ' ')
    .replace('part number',  'part number')
    .replace('build hours',  'build hours')
    .replace('build instr ', 'build instr ')
    .replace('work instr ',  'work instr ');
}

function BomList({ lines }: { lines: LineItemDetail[] }) {
  if (lines.length === 0) return <p className="text-ink-500 italic">No line items.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="bg-ink-50 text-ink-500 text-xs uppercase tracking-wide">
        <tr>
          <th className="px-3 py-2 text-left font-medium">#</th>
          <th className="px-3 py-2 text-left font-medium">Component</th>
          <th className="px-3 py-2 text-right font-medium">Qty</th>
          <th className="px-3 py-2 text-left font-medium">Supplier</th>
          <th className="px-3 py-2 text-left font-medium">Product code</th>
          <th className="px-3 py-2 text-right font-medium">Lead</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((li) => (
          <tr key={li.id} className="border-t border-ink-100 align-top">
            <td className="px-3 py-2 text-xs text-ink-400 font-mono">{li.sort_order}</td>
            <td className="px-3 py-2">
              <div className="font-mono text-ink-900">{li.component_part_number}</div>
              <div className="text-xs text-ink-500">{li.part_description}</div>
              {li.is_commissioned && (
                <div className="text-[10px] text-amber-700">commissioned · cap {pct(li.commission_cap_pct)}</div>
              )}
            </td>
            <td className="px-3 py-2 text-right font-mono">{li.quantity}</td>
            <td className="px-3 py-2 text-ink-700">{li.supplier}</td>
            <td className="px-3 py-2 text-ink-700 font-mono text-xs">{li.product_code}</td>
            <td className="px-3 py-2 text-right text-ink-700">{li.lead_time_days}d</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
