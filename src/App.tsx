import { useEffect, useState } from 'react';
import SearchPage from './pages/SearchPage';
import StructureDetailPage from './pages/StructureDetail';
import DraftEditor from './pages/DraftEditor';
import InboxPage from './pages/Inbox';
import AssignmentView from './pages/AssignmentView';
import PricesPage from './pages/PricesPage';
import type { Row, SearchResp, TagsResp, User, UsersResp } from './types';

// ---------------- current user (localStorage) ----------------
const CURRENT_USER_KEY = 'sv2-current-user-id';
function loadCurrentUserId(): string | null {
  try { return localStorage.getItem(CURRENT_USER_KEY); }
  catch { return null; }
}
function saveCurrentUserId(id: string) {
  try { localStorage.setItem(CURRENT_USER_KEY, id); } catch {}
}

// ---------------- theme ----------------
type Theme = 'light' | 'dark' | 'corporate';
const THEME_KEY = 'sv2-theme';
function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'dark' || v === 'corporate' || v === 'light') return v;
  } catch {}
  return 'light';
}
function saveTheme(t: Theme) {
  try { localStorage.setItem(THEME_KEY, t); } catch {}
}

// ---------------- micro-router (single client-rendered pathname) ----------------
function usePathname(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

export default function App() {
  const path = usePathname();
  const [rows, setRows] = useState<Row[] | 'loading' | 'error'>('loading');
  const [tags, setTags] = useState<TagsResp | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(loadCurrentUserId());
  const [theme, setTheme] = useState<Theme>(loadTheme());

  // Apply theme to <html data-theme=...> on every change
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
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

  // Search results depend on current user (their own CR-0 drafts surface).
  useEffect(() => {
    if (!currentUserId) return;
    setRows('loading');
    fetch(`/api/search?user_id=${currentUserId}`)
      .then((r) => r.json() as Promise<SearchResp>)
      .then((d) => setRows(d.rows))
      .catch(() => setRows('error'));
  }, [currentUserId]);

  const currentUser = users.find((u) => u.id === currentUserId) ?? null;

  // Route dispatch
  let body: React.ReactNode;
  const structMatch = path.match(/^\/structures\/([0-9a-fA-F-]+)$/);
  const draftMatch  = path.match(/^\/drafts\/([0-9a-fA-F-]+)$/);
  const assignMatch = path.match(/^\/assignments\/([0-9a-fA-F-]+)$/);
  if (draftMatch) {
    body = <DraftEditor id={draftMatch[1]} currentUser={currentUser} tags={tags} />;
  } else if (structMatch) {
    body = <StructureDetailPage id={structMatch[1]} currentUser={currentUser} />;
  } else if (assignMatch) {
    body = <AssignmentView id={assignMatch[1]} currentUser={currentUser} />;
  } else if (path === '/inbox') {
    body = <InboxPage currentUser={currentUser} />;
  } else if (path === '/prices') {
    body = <PricesPage currentUser={currentUser} />;
  } else if (path === '/') {
    body = <SearchPage rows={rows} tags={tags} />;
  } else {
    body = <NotFound path={path} />;
  }

  return (
    <div className="min-h-full flex flex-col bg-ink-50 transition-colors">
      <Header
        users={users}
        currentUser={currentUser}
        onPick={(u) => { setCurrentUserId(u.id); saveCurrentUserId(u.id); }}
        theme={theme}
        setTheme={setTheme}
      />
      <main className="flex-1">{body}</main>
      <footer className="border-t border-ink-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-3 text-xs text-ink-400 font-mono">
          Cloudflare Workers + Assets · D1
        </div>
      </footer>
    </div>
  );
}

function Header({ users, currentUser, onPick, theme, setTheme }: {
  users: User[]; currentUser: User | null; onPick: (u: User) => void;
  theme: Theme; setTheme: (t: Theme) => void;
}) {
  return (
    <header className="border-b border-ink-200 bg-white">
      <div className="mx-auto max-w-7xl px-6 py-3 flex items-center gap-4">
        <a href="/" className="text-sm font-mono text-ink-500 hover:text-indigo-700">structurev2</a>
        <span className="text-xs uppercase tracking-wider text-ink-400">prototype</span>
        <a
          href="/prices"
          className="text-xs px-2 py-1 rounded hover:bg-ink-100 text-ink-500"
        >
          Prices
        </a>
        <a
          href="/inbox"
          className={'text-xs px-2 py-1 rounded hover:bg-ink-100 ' + (currentUser?.role === 'order_management' ? 'text-indigo-700 font-medium' : 'text-ink-500')}
        >
          Inbox
        </a>
        <span className="ml-auto flex items-center gap-3">
          <ThemeSwitcher theme={theme} setTheme={setTheme} />
          <UserSwitcher users={users} current={currentUser} onPick={onPick} />
        </span>
      </div>
    </header>
  );
}

function ThemeSwitcher({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const opts: { value: Theme; label: string }[] = [
    { value: 'light',     label: 'Light' },
    { value: 'dark',      label: 'Dark' },
    { value: 'corporate', label: 'Corp' },
  ];
  return (
    <div className="inline-flex rounded-md border border-ink-200 bg-white overflow-hidden text-xs">
      {opts.map((o, i) => (
        <button
          key={o.value}
          onClick={() => setTheme(o.value)}
          className={
            (i > 0 ? 'border-l border-ink-200 ' : '') +
            'px-2 py-1 ' +
            (theme === o.value ? 'bg-indigo-600 text-white font-medium' : 'text-ink-600 hover:bg-ink-100')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
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

function NotFound({ path }: { path: string }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="rounded-lg bg-white border border-ink-200 shadow-sm p-8 text-center">
        <p className="text-ink-700">No page at <code className="font-mono">{path}</code>.</p>
        <a href="/" className="mt-3 inline-block text-indigo-700 hover:underline">← back to search</a>
      </div>
    </div>
  );
}
