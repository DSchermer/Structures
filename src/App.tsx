import { useEffect, useMemo, useState } from 'react';

// ---------------------- types ----------------------
type Row = {
  id: string;
  spec_id: string;
  spec_number: string;
  part_number: string;
  top_level_part_number: string;
  is_variant: boolean;
  parent_part_number: string | null;
  is_subassembly: boolean;
  current_construction_revision_number: number;
  current_price_revision_number: number;
  line_item_count: number;
  sell_price: number | null;
  subassembly_cost: number | null;
  spec_tags: string[];
  general_tags: string[];
  variant_tags: string[];
  is_archived: boolean;
  is_locked: boolean;
  is_below_target: boolean;
  checkout_holder_name: string | null;
  checkout_acquired_at: string | null;
};
type SearchResp = { rows: Row[] };
type TagsResp   = { spec: string[]; general: string[]; variant: string[] };
type User = { id: string; username: string; display_name: string; initials: string; role: string; is_admin: number };
type UsersResp = { users: User[] };

type ArchivedFilter = 'hide' | 'show' | 'only';
type SubFilter      = 'show' | 'hide' | 'only';

// ---------------------- current user (localStorage) ----------------------
const CURRENT_USER_KEY = 'sv2-current-user-id';
function loadCurrentUserId(): string | null {
  try { return localStorage.getItem(CURRENT_USER_KEY); }
  catch { return null; }
}
function saveCurrentUserId(id: string) {
  try { localStorage.setItem(CURRENT_USER_KEY, id); } catch {}
}

// ---------------------- app shell ----------------------
export default function App() {
  const [rows, setRows]   = useState<Row[] | 'loading' | 'error'>('loading');
  const [tags, setTags]   = useState<TagsResp | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(loadCurrentUserId());

  useEffect(() => {
    fetch('/api/search').then((r) => r.json() as Promise<SearchResp>).then((d) => setRows(d.rows)).catch(() => setRows('error'));
    fetch('/api/tags').then((r) => r.json() as Promise<TagsResp>).then(setTags).catch(() => {});
    fetch('/api/users').then((r) => r.json() as Promise<UsersResp>).then((d) => {
      setUsers(d.users);
      if (!currentUserId && d.users.length) {
        const priya = d.users.find((u) => u.username === 'praman') ?? d.users[0];
        setCurrentUserId(priya.id);
        saveCurrentUserId(priya.id);
      }
    }).catch(() => {});
  }, []);

  const currentUser = users.find((u) => u.id === currentUserId) ?? null;

  return (
    <div className="min-h-full flex flex-col bg-ink-50">
      <Header
        users={users}
        currentUser={currentUser}
        onPick={(u) => { setCurrentUserId(u.id); saveCurrentUserId(u.id); }}
      />
      <main className="flex-1">
        <SearchPage rows={rows} tags={tags} />
      </main>
      <footer className="border-t border-ink-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-3 text-xs text-ink-400 font-mono">
          Cloudflare Workers + Assets · D1
        </div>
      </footer>
    </div>
  );
}

// ---------------------- header ----------------------
function Header({ users, currentUser, onPick }: { users: User[]; currentUser: User | null; onPick: (u: User) => void }) {
  return (
    <header className="border-b border-ink-200 bg-white">
      <div className="mx-auto max-w-7xl px-6 py-3 flex items-center gap-3">
        <span className="text-sm font-mono text-ink-500">structurev2</span>
        <span className="text-xs uppercase tracking-wider text-ink-400">prototype</span>
        <span className="ml-auto">
          <UserSwitcher users={users} current={currentUser} onPick={onPick} />
        </span>
      </div>
    </header>
  );
}

function UserSwitcher({ users, current, onPick }: { users: User[]; current: User | null; onPick: (u: User) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-ink-500">
      <span>Acting as</span>
      <select
        className="rounded border border-ink-200 bg-white px-2 py-1 text-xs text-ink-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        value={current?.id ?? ''}
        onChange={(e) => {
          const u = users.find((x) => x.id === e.target.value);
          if (u) onPick(u);
        }}
      >
        {!current && <option value="">—</option>}
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.display_name} ({u.role === 'order_management' ? 'OM' : u.is_admin ? 'admin' : 'engineer'})
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------- search page ----------------------
function SearchPage({ rows, tags }: { rows: Row[] | 'loading' | 'error'; tags: TagsResp | null }) {
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
      // archived facet
      if (archived === 'hide' && r.is_archived) return false;
      if (archived === 'only' && !r.is_archived) return false;
      // sub-assembly facet
      if (subassembly === 'hide' && r.is_subassembly) return false;
      if (subassembly === 'only' && !r.is_subassembly) return false;
      // tag facets — AND within each facet
      for (const t of selectedSpecTags)    if (!r.spec_tags.includes(t)) return false;
      for (const t of selectedGeneralTags) if (!r.general_tags.includes(t)) return false;
      for (const t of selectedVariantTags) if (!r.variant_tags.includes(t)) return false;
      // text search — match against any visible field or tag name
      if (qLower) {
        const haystack = [
          r.spec_number, r.part_number, r.top_level_part_number,
          r.parent_part_number ?? '',
          ...r.spec_tags, ...r.general_tags, ...r.variant_tags,
          r.checkout_holder_name ?? '',
        ].join(' ').toLowerCase();
        if (!haystack.includes(qLower)) return false;
      }
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
             rows === 'error'   ? 'Couldn\'t reach /api/search' :
             `${filtered.length} of ${totalRows} structures`}
          </span>
          {(q || selectedSpecTags.size || selectedGeneralTags.size || selectedVariantTags.size || archived !== 'hide' || subassembly !== 'show') && (
            <button
              className="text-indigo-600 hover:text-indigo-800 hover:underline"
              onClick={() => {
                setQ(''); setSelectedSpecTags(new Set()); setSelectedGeneralTags(new Set()); setSelectedVariantTags(new Set());
                setArchived('hide'); setSubassembly('show');
              }}
            >
              clear filters
            </button>
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

function toggle(name: string, current: Set<string>, set: (s: Set<string>) => void) {
  const next = new Set(current);
  if (next.has(name)) next.delete(name); else next.add(name);
  set(next);
}

// ---------------------- filter panel ----------------------
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
              className={
                'rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition ' +
                tagStyle(kind, active)
              }
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

function tagStyle(kind: 'spec' | 'general' | 'variant' | 'system', active: boolean): string {
  const base: Record<typeof kind, string> = {
    spec:    active ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-indigo-50 text-indigo-800 ring-indigo-200 hover:bg-indigo-100',
    general: active ? 'bg-ink-700 text-white ring-ink-700'       : 'bg-ink-100 text-ink-700 ring-ink-200 hover:bg-ink-200',
    variant: active ? 'bg-amber-600 text-white ring-amber-600'   : 'bg-amber-50 text-amber-900 ring-amber-200 hover:bg-amber-100',
    system:  active ? 'bg-rose-600 text-white ring-rose-600'     : 'bg-rose-50 text-rose-800 ring-rose-200',
  };
  return base[kind];
}

// ---------------------- result row ----------------------
function ResultRow({ row }: { row: Row }) {
  const archived = row.is_archived;
  return (
    <a
      href={`/structures/${row.id}`}
      className={
        'block rounded-md border bg-white px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition ' +
        (archived ? 'border-ink-200 opacity-60' : 'border-ink-200')
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
          CR {row.current_construction_revision_number} · PR {row.current_price_revision_number}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {row.variant_tags.map((t) => <Chip key={`v-${t}`} kind="variant" name={t} />)}
        {row.general_tags.map((t) => <Chip key={`g-${t}`} kind="general" name={t} />)}
        {row.is_archived     && <StatusBadge tone="rose">ARCHIVED</StatusBadge>}
        {row.is_locked       && <StatusBadge tone="rose">LOCKED</StatusBadge>}
        {row.is_below_target && <StatusBadge tone="amber">BELOW TARGET</StatusBadge>}
        {row.checkout_holder_name && (
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

function Chip({ kind, name }: { kind: 'spec' | 'general' | 'variant' | 'system'; name: string }) {
  return (
    <span className={'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' + tagStyle(kind, false)}>
      {name}
    </span>
  );
}

function StatusBadge({ tone, children }: { tone: 'rose' | 'amber' | 'slate'; children: React.ReactNode }) {
  const cls: Record<typeof tone, string> = {
    rose:  'bg-rose-100 text-rose-800 ring-rose-300',
    amber: 'bg-amber-100 text-amber-900 ring-amber-300',
    slate: 'bg-ink-100 text-ink-700 ring-ink-300',
  };
  return (
    <span className={'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ' + cls[tone]}>
      {children}
    </span>
  );
}

// ---------------------- helpers ----------------------
const _usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
function usd(n: number): string { return _usd.format(n); }

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (isNaN(t)) return iso;
  const diffMs = Date.now() - t;
  const mins = Math.round(diffMs / 60000);
  if (mins < 60)      return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24)     return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30)      return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}
