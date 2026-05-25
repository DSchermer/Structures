import { useEffect, useState } from 'react';
import type { User } from '../types';
import { StatusBadge, formatDate, relativeTime } from '../components/shared';

type InboxItem = {
  id: string;
  structure_id: string;
  construction_revision_id: string;
  cr_number: number;
  cr_notes: string | null;
  top_level_part_number: string;
  spec_number: string;
  part_number: string;
  assigned_by_name: string;
  assigned_at: string;
  acknowledged_at: string | null;
  note: string | null;
  is_archived: boolean;
  is_below_target: boolean;
  pending_count_for_structure: number;
};

export default function InboxPage({ currentUser }: { currentUser: User | null }) {
  const [tab, setTab] = useState<'open' | 'completed'>('open');
  const [items, setItems] = useState<InboxItem[] | 'loading' | 'error'>('loading');

  useEffect(() => {
    if (!currentUser) { setItems([]); return; }
    setItems('loading');
    fetch(`/api/inbox?user_id=${currentUser.id}&tab=${tab}`)
      .then((r) => r.json() as Promise<{ assignments: InboxItem[] }>)
      .then((d) => setItems(d.assignments))
      .catch(() => setItems('error'));
  }, [currentUser?.id, tab]);

  if (!currentUser) {
    return (
      <Frame>
        <p className="text-ink-700">Pick an OM user from the dropdown to see their inbox.</p>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="rounded-lg bg-white border border-ink-200 shadow-sm overflow-hidden">
        <header className="px-5 py-4 border-b border-ink-200">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-xl font-semibold text-ink-900">Inbox</h1>
            <span className="text-sm text-ink-500">for {currentUser.display_name}</span>
            {currentUser.role !== 'order_management' && (
              <StatusBadge tone="amber">not an OM user</StatusBadge>
            )}
          </div>
          <nav className="mt-3 flex gap-4 text-sm border-b border-ink-200 -mb-4">
            <button
              onClick={() => setTab('open')}
              className={'pb-2 -mb-px border-b-2 ' + (tab === 'open' ? 'border-indigo-600 text-indigo-700 font-medium' : 'border-transparent text-ink-500 hover:text-ink-700')}
            >Open</button>
            <button
              onClick={() => setTab('completed')}
              className={'pb-2 -mb-px border-b-2 ' + (tab === 'completed' ? 'border-indigo-600 text-indigo-700 font-medium' : 'border-transparent text-ink-500 hover:text-ink-700')}
            >Completed</button>
          </nav>
        </header>
        <div className="p-5">
          {items === 'loading' && <p className="text-ink-500">Loading…</p>}
          {items === 'error'   && <p className="text-rose-700">Couldn't reach <code>/api/inbox</code>.</p>}
          {Array.isArray(items) && items.length === 0 && (
            <p className="text-ink-500 italic">No items in this tab.</p>
          )}
          {Array.isArray(items) && items.length > 0 && (
            <ul className="space-y-2">
              {items.map((it) => <InboxRow key={it.id} item={it} />)}
            </ul>
          )}
        </div>
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-5xl px-6 py-6">{children}</div>;
}

function InboxRow({ item }: { item: InboxItem }) {
  return (
    <li>
      <a
        href={`/assignments/${item.id}`}
        className="block rounded-md border border-ink-200 bg-white px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition"
      >
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="font-mono text-base font-medium text-ink-900">
            Rev {item.cr_number} of {item.top_level_part_number}
          </span>
          {item.is_archived     && <StatusBadge tone="rose">ARCHIVED</StatusBadge>}
          {item.is_below_target && <StatusBadge tone="amber">BELOW TARGET</StatusBadge>}
          {item.pending_count_for_structure > 1 && (
            <StatusBadge tone="slate">{item.pending_count_for_structure} revs pending on this structure</StatusBadge>
          )}
          <span className="ml-auto text-xs text-ink-500">
            {item.acknowledged_at ? <>entered {relativeTime(item.acknowledged_at)}</> : <>{relativeTime(item.assigned_at)}</>}
          </span>
        </div>
        <div className="mt-1 text-sm text-ink-600">
          Assigned by <span className="text-ink-800">{item.assigned_by_name}</span> · {formatDate(item.assigned_at)}
        </div>
        {(item.note || item.cr_notes) && (
          <div className="mt-2 text-sm text-ink-700 italic">"{item.note ?? item.cr_notes}"</div>
        )}
      </a>
    </li>
  );
}
