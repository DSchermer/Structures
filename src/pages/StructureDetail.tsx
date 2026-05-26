import { useEffect, useState } from 'react';
import type { StructureDetail, LineItemDetail, PricePointDetail, RevisionDetail, User } from '../types';
import { Chip, StatusBadge, usd, relativeTime, formatDate, pct } from '../components/shared';
import { Dialog } from '../components/Dialog';

export default function StructureDetailPage({ id, currentUser }: { id: string; currentUser: User | null }) {
  const [data, setData] = useState<StructureDetail | 'loading' | 'error' | 'notfound'>('loading');
  const [showNewVariant, setShowNewVariant] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/structures/${id}`);
        if (r.status === 404) { setData('notfound'); return; }
        const json = (await r.json()) as StructureDetail;
        setData(json);
      } catch {
        setData('error');
      }
    })();
  }, [id]);

  if (data === 'loading')  return <Frame><p className="text-ink-500">Loading…</p></Frame>;
  if (data === 'notfound') return <Frame><NotFound id={id} /></Frame>;
  if (data === 'error')    return <Frame><p className="text-rose-700">Couldn't reach <code>/api/structures/{id}</code>.</p></Frame>;

  async function checkOut() {
    if (!currentUser) { alert('Pick a user from the top-bar dropdown first.'); return; }
    setCheckingOut(true);
    try {
      const r = await fetch(`/api/structures/${id}/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current_user_id: currentUser.id }),
      });
      const j = await r.json() as any;
      if (!r.ok) { alert(j.error ?? 'Checkout failed'); return; }
      window.location.href = `/drafts/${id}`;
    } finally { setCheckingOut(false); }
  }

  return (
    <Frame>
      <DetailHeader
        d={data}
        currentUser={currentUser}
        checkingOut={checkingOut}
        onCheckOut={checkOut}
        onNewVariant={() => setShowNewVariant(true)}
      />
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
        <div className="space-y-6 min-w-0">
          <BomSection lines={data.line_items} />
          <PricesSection points={data.price_points} subassembly={data.is_subassembly} />
          <RevisionsSection crs={data.construction_revisions} prs={data.price_revisions} />
          <InstructionsSection build={data.build_instructions} work={data.work_instructions} />
        </div>
        <aside className="space-y-6">
          {(data.parent || data.siblings.length > 1) && <SiblingsSidebar d={data} />}
          <MetaSidebar d={data} />
        </aside>
      </div>
      {showNewVariant && currentUser && (
        <NewVariantDialog base={data} currentUser={currentUser} onClose={() => setShowNewVariant(false)} />
      )}
    </Frame>
  );
}

function NewVariantDialog({ base, currentUser, onClose }: { base: StructureDetail; currentUser: User; onClose: () => void }) {
  const [partNumber, setPartNumber] = useState(base.part_number + '-');
  const [creating, setCreating] = useState(false);

  async function create() {
    setCreating(true);
    try {
      const r = await fetch('/api/structures', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          spec_id: base.spec_id,
          parent_structure_id: base.id,
          part_number: partNumber.trim(),
          base_from_structure_id: base.id,
          current_user_id: currentUser.id,
        }),
      });
      const j = await r.json() as any;
      if (!r.ok) { alert(j.error ?? 'Create failed'); return; }
      window.location.href = `/drafts/${j.id}`;
    } finally { setCreating(false); }
  }

  return (
    <Dialog
      open onClose={onClose}
      title={`New variant of ${base.top_level_part_number}`}
      footer={
        <>
          <button onClick={onClose} disabled={creating} className="rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-50">Cancel</button>
          <button onClick={create} disabled={creating || !partNumber.trim()} className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">{creating ? 'Creating…' : 'Create variant'}</button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-ink-700">
          The new variant starts as a copy of {base.spec_number}{base.part_number}'s BOM, instructions, and general tags. You'll land in the draft editor to make your changes and add the variant tag.
        </p>
        <label className="block">
          <div className="text-xs uppercase tracking-wide text-ink-500 mb-1">New part number</div>
          <input
            autoFocus
            className="w-full font-mono text-sm px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={partNumber}
            onChange={(e) => setPartNumber(e.target.value)}
            maxLength={25}
          />
          <div className="text-xs text-ink-500 mt-1">
            Live preview: <span className="font-mono text-ink-700">{base.spec_number}{partNumber.trim() || '—'}</span>
          </div>
        </label>
      </div>
    </Dialog>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>;
}

function NotFound({ id }: { id: string }) {
  return (
    <div className="rounded-lg bg-white border border-ink-200 shadow-sm p-8 text-center">
      <p className="text-ink-700">No structure found with ID <code className="font-mono">{id}</code>.</p>
      <a href="/" className="mt-3 inline-block text-indigo-700 hover:underline">← back to search</a>
    </div>
  );
}

// ---------------- header ----------------

function DetailHeader({ d, currentUser, checkingOut, onCheckOut, onNewVariant }: {
  d: StructureDetail;
  currentUser: User | null;
  checkingOut: boolean;
  onCheckOut: () => void;
  onNewVariant: () => void;
}) {
  return (
    <div className="rounded-lg bg-white border border-ink-200 shadow-sm p-5">
      <div className="flex items-start gap-4 flex-wrap">
        <a href="/" className="text-xs text-ink-500 hover:text-indigo-700">← search</a>
      </div>
      <div className="mt-2 flex items-baseline gap-3 flex-wrap">
        <h1 className={'text-2xl font-mono font-semibold text-ink-900 ' + (d.is_archived ? 'line-through opacity-70' : '')}>
          {d.top_level_part_number}
        </h1>
        <span className="text-sm text-ink-600">
          {d.is_subassembly ? 'sub-assembly' :
           d.is_variant && d.parent ? <>variant of <a href="#" className="font-mono hover:underline">{d.spec_number}{d.parent.part_number}</a></> :
           'base part'}
        </span>
        <span className="text-sm font-mono text-ink-500">
          Rev {d.current_construction_revision_number}
        </span>
        {(() => {
          const latestSell = d.price_points.find((p) => p.scope === 'structure_sell' || p.scope === 'subassembly_cost');
          return latestSell ? (
            <span className="text-xs text-ink-400">last priced {formatDate(latestSell.set_at)}</span>
          ) : null;
        })()}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {d.spec_tags.map((t) => <Chip key={`s-${t}`} kind="spec" name={t} />)}
        {d.variant_tags.map((t) => <Chip key={`v-${t.name}`} kind="variant" name={t.name} />)}
        {d.general_tags.map((t) => <Chip key={`g-${t.name}`} kind="general" name={t.name} />)}
        {d.is_archived     && <StatusBadge tone="rose">ARCHIVED</StatusBadge>}
        {d.is_locked       && <StatusBadge tone="rose">LOCKED</StatusBadge>}
        {d.is_below_target && <StatusBadge tone="amber">BELOW TARGET</StatusBadge>}
        {d.lock && (
          <StatusBadge tone="slate">
            checked out by {d.lock.holder_name} · {relativeTime(d.lock.acquired_at)}
          </StatusBadge>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <Stat label="Spec" value={
          <span className="font-mono">
            {d.spec_number}
            {d.pinned_customer_revision !== d.spec_current_customer_revision && (
              <span className="ml-1 text-amber-700 text-xs" title="A newer customer rev exists for this spec.">
                ({d.pinned_customer_revision} · newer: {d.spec_current_customer_revision})
              </span>
            )}
            {d.pinned_customer_revision === d.spec_current_customer_revision && (
              <span className="ml-1 text-ink-400 text-xs">{d.pinned_customer_revision}</span>
            )}
          </span>
        } />
        <Stat label="Build hours" value={<span className="font-mono">{d.build_hours ?? '—'}</span>} />
        <Stat label="Target margin" value={<span className="font-mono">{pct(d.target_assembly_margin_pct)}</span>} />
        <Stat label="Created"     value={<span className="text-ink-700">{d.created_by_name ?? '—'} · {formatDate(d.created_at)}</span>} />
      </div>

      <div className="mt-5 flex items-center gap-2 flex-wrap">
        {d.lock ? (
          d.lock.holder_user_id === currentUser?.id ? (
            <a href={`/drafts/${d.id}`} className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700">Resume draft →</a>
          ) : (
            <span className="text-xs text-ink-500 italic">Checked out by {d.lock.holder_name}. Reach out to coordinate.</span>
          )
        ) : d.is_archived ? (
          <span className="text-xs text-ink-500 italic">Unarchive first to edit.</span>
        ) : d.is_locked ? (
          <span className="text-xs text-ink-500 italic">Unlock first to edit.</span>
        ) : (
          <button
            onClick={onCheckOut}
            disabled={checkingOut || !currentUser}
            className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >{checkingOut ? 'Checking out…' : 'Check out'}</button>
        )}
        {!d.is_variant && !d.is_subassembly && currentUser && (
          <button
            onClick={onNewVariant}
            className="rounded-md border border-indigo-300 text-indigo-700 px-3 py-1.5 text-sm font-medium hover:bg-indigo-50"
          >+ New variant of this base</button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}

// ---------------- BOM ----------------

function BomSection({ lines }: { lines: LineItemDetail[] }) {
  if (lines.length === 0) {
    return (
      <Section title="Bill of materials">
        <p className="text-ink-500 italic">No line items.</p>
      </Section>
    );
  }
  const total = lines.reduce((s, li) => s + (li.unit_price ?? 0) * li.quantity, 0);
  return (
    <Section title="Bill of materials">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-ink-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Part / Description</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Unit</th>
              <th className="px-3 py-2 text-right font-medium">Ext.</th>
              <th className="px-3 py-2 text-left font-medium">Supplier</th>
              <th className="px-3 py-2 text-right font-medium">Lead</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((li) => <BomRow key={li.id} li={li} />)}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink-200 bg-ink-50">
              <td className="px-3 py-2 text-xs text-ink-500" colSpan={4}>Total rolled-up cost</td>
              <td className="px-3 py-2 text-right font-mono text-ink-900 text-sm">{usd(total, true)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </Section>
  );
}

function BomRow({ li }: { li: LineItemDetail }) {
  const ext = (li.unit_price ?? 0) * li.quantity;
  return (
    <tr className="border-t border-ink-100 align-top">
      <td className="px-3 py-2 text-xs text-ink-400 font-mono">{li.sort_order}</td>
      <td className="px-3 py-2">
        <div className="font-mono text-sm text-ink-900">
          {li.sub_assembly ? (
            <a href={`/structures/${li.sub_assembly.id}`} className="text-indigo-700 hover:underline">
              {li.component_part_number}
            </a>
          ) : (
            li.component_part_number
          )}
          {li.sub_assembly && <span className="ml-2 text-[10px] text-ink-500 uppercase tracking-wide">sub-asm</span>}
        </div>
        <div className="text-xs text-ink-500 mt-0.5">{li.part_description}</div>
        {li.is_commissioned && (
          <div className="text-[10px] text-amber-700 mt-0.5">
            commissioned · cap {pct(li.commission_cap_pct)}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono">{li.quantity}</td>
      <td className="px-3 py-2 text-right font-mono text-ink-700">{li.unit_price !== null ? usd(li.unit_price, true) : '—'}</td>
      <td className="px-3 py-2 text-right font-mono text-ink-900">{usd(ext, true)}</td>
      <td className="px-3 py-2 text-ink-700">{li.supplier}</td>
      <td className="px-3 py-2 text-right text-ink-700">{li.lead_time_days}d</td>
    </tr>
  );
}

// ---------------- prices ----------------

function PricesSection({ points, subassembly }: { points: PricePointDetail[]; subassembly: boolean }) {
  const sells = points.filter((p) => p.scope === 'structure_sell');
  const subs  = points.filter((p) => p.scope === 'subassembly_cost');
  const relevant = subassembly ? subs : sells;
  return (
    <Section title={subassembly ? 'Sub-assembly cost' : 'Sell prices'}>
      {relevant.length === 0 ? (
        <p className="text-ink-500 italic">No prices yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-ink-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Tags</th>
              <th className="px-3 py-2 text-right font-medium">Price</th>
              <th className="px-3 py-2 text-left font-medium">Set by</th>
              <th className="px-3 py-2 text-left font-medium">Set at</th>
              <th className="px-3 py-2 text-left font-medium">Basis</th>
            </tr>
          </thead>
          <tbody>
            {relevant.sort((a, b) => Number(a.is_superseded) - Number(b.is_superseded)).map((p) => (
              <tr key={p.id} className={'border-t border-ink-100 ' + (p.is_superseded ? 'opacity-50' : '')}>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    {p.tags.map((t) => (
                      <Chip key={t} kind={subassembly ? 'general' : 'spec'} name={t} />
                    ))}
                    {p.is_superseded && <StatusBadge tone="rose">SUPERSEDED</StatusBadge>}
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-ink-900">{usd(p.price)}</td>
                <td className="px-3 py-2 text-ink-700">{p.set_by ?? '—'}</td>
                <td className="px-3 py-2 text-ink-500 text-xs font-mono">{formatDate(p.set_at)}</td>
                <td className="px-3 py-2 text-xs text-ink-500 font-mono">
                  {p.derived_from_cr ? <>CR-pinned</> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

// ---------------- revisions ----------------

function RevisionsSection({ crs, prs: _prs }: { crs: RevisionDetail[]; prs: RevisionDetail[] }) {
  // Pricing history is implicit in the sell-PP list (already rendered above);
  // we only surface the build-revision (CR) timeline here.
  return (
    <Section title="Revision history">
      <RevList revs={crs} prefix="Rev" />
    </Section>
  );
}

function RevList({ revs, prefix }: { revs: RevisionDetail[]; prefix: string }) {
  if (revs.length === 0) return <p className="text-ink-500 italic text-sm">None.</p>;
  return (
    <ol className="space-y-2">
      {revs.map((r) => (
        <li key={r.id} className="rounded border border-ink-100 px-3 py-2">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-sm font-medium text-ink-900">{prefix} {r.revision_number}</span>
            <span className="text-xs text-ink-500">{r.author ?? 'unknown'} · {formatDate(r.committed_at)}</span>
          </div>
          {r.notes && <p className="mt-1 text-sm text-ink-700">{r.notes}</p>}
          <ChangeSetSummary change_set={r.change_set} />
        </li>
      ))}
    </ol>
  );
}

function ChangeSetSummary({ change_set }: { change_set: unknown }) {
  if (!change_set || typeof change_set !== 'object') return null;
  const cs = change_set as Record<string, any>;
  const parts: string[] = [];
  if (cs.line_items) {
    if (cs.line_items.added) parts.push(`+${cs.line_items.added} lines`);
    if (cs.line_items.priced) parts.push(`${cs.line_items.priced} priced`);
    if (cs.line_items.commissioned) parts.push(`${cs.line_items.commissioned} commissioned`);
    if (cs.line_items.modified) parts.push(`${cs.line_items.modified.length ?? 1} line modified`);
  }
  if (cs.tags?.added?.length) parts.push(`+tags: ${cs.tags.added.join(', ')}`);
  if (cs.structure_fields?.target_assembly_margin_pct) parts.push(`target margin ${cs.structure_fields.target_assembly_margin_pct}`);
  if (parts.length === 0) return null;
  return <p className="mt-1 text-xs text-ink-500 font-mono">{parts.join(' · ')}</p>;
}

// ---------------- instructions ----------------

function InstructionsSection({ build, work }: { build: string[]; work: string[] }) {
  if (!build.length && !work.length) return null;
  return (
    <Section title="Instructions">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-xs uppercase tracking-wide text-ink-500 mb-2">Build</h3>
          {build.length === 0 ? <p className="text-ink-500 italic text-sm">None.</p> : (
            <ol className="list-decimal list-inside space-y-1.5 text-sm text-ink-700">
              {build.map((b, i) => <li key={i}>{b}</li>)}
            </ol>
          )}
        </div>
        <div>
          <h3 className="text-xs uppercase tracking-wide text-ink-500 mb-2">Work</h3>
          {work.length === 0 ? <p className="text-ink-500 italic text-sm">None.</p> : (
            <ol className="list-decimal list-inside space-y-1.5 text-sm text-ink-700">
              {work.map((b, i) => <li key={i}>{b}</li>)}
            </ol>
          )}
        </div>
      </div>
    </Section>
  );
}

// ---------------- siblings sidebar ----------------

function SiblingsSidebar({ d }: { d: StructureDetail }) {
  return (
    <Section title={d.is_variant ? `Variants of ${d.spec_number}${d.parent?.part_number ?? ''}` : `Variants of ${d.top_level_part_number}`}>
      {d.parent && (
        <a href={`/structures/${d.parent.id}`} className="block mb-2 text-xs text-ink-500 hover:text-indigo-700">
          ↑ base part {d.spec_number}{d.parent.part_number}
        </a>
      )}
      <ul className="space-y-2">
        {d.siblings.map((s) => (
          <li key={s.id}>
            <a
              href={`/structures/${s.id}`}
              className={'block rounded border px-2 py-1.5 text-sm ' + (s.is_current ? 'border-indigo-300 bg-indigo-50' : 'border-ink-100 hover:border-indigo-200')}
            >
              <div className="font-mono text-ink-900">{s.top_level_part_number}</div>
              {s.variant_tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {s.variant_tags.map((t) => <Chip key={t} kind="variant" name={t} />)}
                </div>
              )}
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------- meta sidebar ----------------

function MetaSidebar({ d }: { d: StructureDetail }) {
  return (
    <Section title="Spec revisions">
      <ul className="space-y-1.5 text-sm">
        {d.spec_revisions.map((sr) => (
          <li key={sr.id} className="flex items-baseline gap-2">
            <span className={'font-mono ' + (sr.customer_revision === d.pinned_customer_revision ? 'text-indigo-700 font-semibold' : 'text-ink-700')}>
              {sr.customer_revision}
            </span>
            <span className="text-xs text-ink-500">{formatDate(sr.recorded_at)}</span>
            {sr.customer_revision === d.pinned_customer_revision && <StatusBadge tone="emerald">PINNED</StatusBadge>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------- generic section card ----------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-white border border-ink-200 shadow-sm overflow-hidden">
      <header className="px-5 py-3 border-b border-ink-200">
        <h2 className="text-sm font-semibold text-ink-700 uppercase tracking-wide">{title}</h2>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
