// §5.4 creation flow — the decision tree an engineer walks to create something.
//
//   Does the spec exist?
//     No  -> New Spec        (POST /api/specs)
//     Yes -> New construction -> New Part Under Spec (POST /api/structures)
//         -> Variant          -> pick a source (base part OR another variant)
//                                (POST /api/structures, variant_source_structure_id)
//
// Every branch lands the engineer in the draft editor against a CR-0 structure
// that only they can see. Sibling-spawn resolves parent to the source's BASE
// server-side, so depth stays capped at 1 — see the worker.

import { useEffect, useMemo, useState } from 'react';
import { Dialog } from './Dialog';
import type { Row, User } from '../types';

type Spec = { id: string; spec_number: string; customer_revision: string; structure_count: number };
type Step = 'specExists' | 'newSpec' | 'pickSpec' | 'kind' | 'newPart' | 'pickSource' | 'variantPart';

export function NewStructureDialog({ rows, currentUser, onClose }: {
  rows: Row[];
  currentUser: User;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('specExists');
  const [specs, setSpecs] = useState<Spec[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New Spec fields
  const [specNumber, setSpecNumber] = useState('');
  const [customerRev, setCustomerRev] = useState('');

  // Shared / existing-spec fields
  const [spec, setSpec] = useState<Spec | null>(null);
  const [specQuery, setSpecQuery] = useState('');
  const [source, setSource] = useState<Row | null>(null);
  const [partNumber, setPartNumber] = useState('');

  useEffect(() => {
    fetch('/api/specs')
      .then((r) => r.json() as Promise<{ specs: Spec[] }>)
      .then((d) => setSpecs(d.specs))
      .catch(() => setSpecs([]));
  }, []);

  const specMatches = useMemo(() => {
    const q = specQuery.trim().toLowerCase();
    const all = specs ?? [];
    return q ? all.filter((s) => s.spec_number.toLowerCase().includes(q)) : all;
  }, [specs, specQuery]);

  // Candidate variant sources: committed structures under the chosen spec.
  // A variant may be spawned from a base part or from another variant.
  const sourceCandidates = useMemo(
    () => (spec ? rows.filter((r) => r.spec_id === spec.id && !r.is_uncommitted_draft) : []),
    [rows, spec],
  );

  const preview = (spec?.spec_number ?? specNumber.trim()) + partNumber.trim();

  async function post(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json() as { id?: string; error?: string };
      if (!r.ok) { setError(j.error ?? 'Create failed'); return; }
      window.location.href = `/drafts/${j.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const createSpec = () => post('/api/specs', {
    spec_number: specNumber.trim(),
    customer_revision: customerRev.trim(),
    part_number: partNumber.trim(),
    current_user_id: currentUser.id,
  });

  const createPart = () => post('/api/structures', {
    spec_id: spec!.id,
    part_number: partNumber.trim(),
    current_user_id: currentUser.id,
  });

  const createVariant = () => post('/api/structures', {
    spec_id: spec!.id,
    part_number: partNumber.trim(),
    variant_source_structure_id: source!.id,
    current_user_id: currentUser.id,
  });

  const back = () => {
    setError(null);
    if (step === 'newSpec' || step === 'pickSpec') setStep('specExists');
    else if (step === 'kind') setStep('pickSpec');
    else if (step === 'newPart' || step === 'pickSource') setStep('kind');
    else if (step === 'variantPart') setStep('pickSource');
  };

  const titles: Record<Step, string> = {
    specExists:  'New — does the spec already exist?',
    newSpec:     'New spec',
    pickSpec:    'Which spec?',
    kind:        `New under ${spec?.spec_number ?? ''}`,
    newPart:     `New part under ${spec?.spec_number ?? ''}`,
    pickSource:  'Variant of which structure?',
    variantPart: `New variant of ${source?.top_level_part_number ?? ''}`,
  };

  const canSubmit =
    step === 'newSpec'     ? !!(specNumber.trim() && customerRev.trim() && partNumber.trim()) :
    step === 'newPart'     ? !!partNumber.trim() :
    step === 'variantPart' ? !!partNumber.trim() : false;

  const submit =
    step === 'newSpec'     ? createSpec :
    step === 'newPart'     ? createPart :
    step === 'variantPart' ? createVariant : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      title={titles[step]}
      footer={
        <>
          {step !== 'specExists' && (
            <button onClick={back} disabled={busy}
              className="mr-auto rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-50">← Back</button>
          )}
          <button onClick={onClose} disabled={busy}
            className="rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-50">Cancel</button>
          {submit && (
            <button onClick={submit} disabled={busy || !canSubmit}
              className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
              {busy ? 'Creating…' : 'Create & open draft'}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">{error}</p>
        )}

        {step === 'specExists' && (
          <>
            <p className="text-ink-600">
              Everything you create starts as a private draft — nobody else sees it until your first check-in.
            </p>
            <Choice
              label="No — this is a brand-new spec number"
              hint="Creates the spec, its first customer revision, and a first part under it."
              onClick={() => { setStep('newSpec'); setError(null); }}
            />
            <Choice
              label="Yes — the spec is already in the system"
              hint={specs ? `${specs.length} specs on file` : 'Loading…'}
              onClick={() => { setStep('pickSpec'); setError(null); }}
            />
          </>
        )}

        {step === 'newSpec' && (
          <>
            <Field label="Spec number" hint="Must not already exist.">
              <input autoFocus className={inputCls} value={specNumber}
                onChange={(e) => setSpecNumber(e.target.value)} placeholder="e.g. 512T0088" />
            </Field>
            <Field label="Customer revision" hint="The revision the customer has issued today.">
              <input className={inputCls} value={customerRev}
                onChange={(e) => setCustomerRev(e.target.value)} placeholder="e.g. Rev 1" />
            </Field>
            <Field label="First part number" hint="A spec needs at least one part; you'll fill in its BOM next.">
              <input className={inputCls} value={partNumber}
                onChange={(e) => setPartNumber(e.target.value)} placeholder="e.g. P001" />
            </Field>
            <PreviewLine value={preview} />
          </>
        )}

        {step === 'pickSpec' && (
          <>
            <input autoFocus className={inputCls} value={specQuery}
              onChange={(e) => setSpecQuery(e.target.value)} placeholder="Filter specs…" />
            <div className="max-h-64 overflow-y-auto rounded-md border border-ink-200 divide-y divide-ink-100">
              {specs === null && <p className="px-3 py-2 text-ink-500 italic">Loading…</p>}
              {specs !== null && specMatches.length === 0 && (
                <p className="px-3 py-2 text-ink-500 italic">No spec matches that.</p>
              )}
              {specMatches.map((s) => (
                <button key={s.id}
                  onClick={() => { setSpec(s); setStep('kind'); setError(null); }}
                  className="w-full text-left px-3 py-2 hover:bg-indigo-50 flex items-baseline gap-2">
                  <span className="font-mono text-ink-900">{s.spec_number}</span>
                  <span className="text-xs text-ink-500">{s.customer_revision}</span>
                  <span className="ml-auto text-xs text-ink-400">{s.structure_count} structures</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'kind' && (
          <>
            <Choice
              label="New construction — a brand-new part under this spec"
              hint="Starts from an empty BOM."
              onClick={() => { setPartNumber(''); setStep('newPart'); setError(null); }}
            />
            <Choice
              label="A variant of something that already exists"
              hint="Starts as a copy of the source's BOM, instructions, and tags."
              onClick={() => { setStep('pickSource'); setError(null); }}
              disabled={sourceCandidates.length === 0}
              disabledHint="No committed structures under this spec yet."
            />
          </>
        )}

        {step === 'newPart' && (
          <>
            <Field label="Part number" hint="Unique within this spec, 1–25 characters.">
              <input autoFocus className={inputCls} value={partNumber}
                onChange={(e) => setPartNumber(e.target.value)} placeholder="e.g. P006" />
            </Field>
            <PreviewLine value={preview} />
          </>
        )}

        {step === 'pickSource' && (
          <>
            <p className="text-ink-600">
              Pick the structure to copy. Choosing a variant creates a <strong>sibling</strong> of it under the
              same base part — never a variant of a variant.
            </p>
            <div className="max-h-64 overflow-y-auto rounded-md border border-ink-200 divide-y divide-ink-100">
              {sourceCandidates.map((r) => (
                <button key={r.id}
                  onClick={() => { setSource(r); setPartNumber(r.part_number + '-'); setStep('variantPart'); setError(null); }}
                  className="w-full text-left px-3 py-2 hover:bg-indigo-50">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-ink-900">{r.top_level_part_number}</span>
                    {r.is_variant
                      ? <span className="text-xs text-amber-700">variant of {r.parent_part_number}</span>
                      : <span className="text-xs text-ink-500">base part</span>}
                    <span className="ml-auto text-xs text-ink-400">Rev {r.current_construction_revision_number}</span>
                  </div>
                  {r.variant_tags.length > 0 && (
                    <div className="mt-0.5 text-xs text-ink-500">{r.variant_tags.join(' · ')}</div>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'variantPart' && source && (
          <>
            {source.is_variant && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                This creates a <strong>sibling</strong> of {source.top_level_part_number} under{' '}
                {source.parent_part_number}. It is born sharing {source.top_level_part_number}'s variant
                tags, so you'll need to add or remove at least one before check-in.
              </p>
            )}
            <Field label="New part number" hint="Unique within this spec, 1–25 characters.">
              <input autoFocus className={inputCls} value={partNumber}
                onChange={(e) => setPartNumber(e.target.value)} />
            </Field>
            <PreviewLine value={preview} />
          </>
        )}
      </div>
    </Dialog>
  );
}

const inputCls = 'w-full font-mono text-sm px-2 py-1.5 rounded border border-ink-200 focus:outline-none focus:ring-2 focus:ring-indigo-500';

function Choice({ label, hint, onClick, disabled, disabledHint }: {
  label: string; hint?: string; onClick: () => void; disabled?: boolean; disabledHint?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={'w-full text-left rounded-md border px-4 py-3 transition-colors ' +
        (disabled
          ? 'border-ink-200 bg-ink-50 opacity-60 cursor-not-allowed'
          : 'border-ink-200 hover:border-indigo-400 hover:bg-indigo-50')}
    >
      <div className="text-ink-900 font-medium">{label}</div>
      {(disabled ? disabledHint : hint) && (
        <div className="text-xs text-ink-500 mt-0.5">{disabled ? disabledHint : hint}</div>
      )}
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs uppercase tracking-wide text-ink-500 mb-1">{label}</div>
      {children}
      {hint && <div className="text-xs text-ink-400 mt-1">{hint}</div>}
    </label>
  );
}

function PreviewLine({ value }: { value: string }) {
  return (
    <p className="text-xs text-ink-500">
      Top-level part number:{' '}
      {value.trim()
        ? <code className="font-mono text-indigo-700">{value}</code>
        : <span className="italic">fill in the fields above</span>}
    </p>
  );
}
