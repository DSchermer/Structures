// Shared UI helpers — tag chips, status badges, formatters.

import { ReactNode } from 'react';

export type TagKind = 'spec' | 'general' | 'variant' | 'system';

export function tagStyle(kind: TagKind, active = false): string {
  const base: Record<TagKind, string> = {
    spec:    active ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-indigo-50 text-indigo-800 ring-indigo-200 hover:bg-indigo-100',
    general: active ? 'bg-ink-700 text-white ring-ink-700'       : 'bg-ink-100 text-ink-700 ring-ink-200 hover:bg-ink-200',
    variant: active ? 'bg-amber-600 text-white ring-amber-600'   : 'bg-amber-50 text-amber-900 ring-amber-200 hover:bg-amber-100',
    system:  active ? 'bg-rose-600 text-white ring-rose-600'     : 'bg-rose-50 text-rose-800 ring-rose-200',
  };
  return base[kind];
}

export function Chip({ kind, name }: { kind: TagKind; name: string }) {
  return (
    <span
      className={'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' + tagStyle(kind, false)}
      title={`${kind} tag`}
    >
      {name}
    </span>
  );
}

export function StatusBadge({ tone, children }: { tone: 'rose' | 'amber' | 'slate' | 'emerald'; children: ReactNode }) {
  const cls: Record<'rose' | 'amber' | 'slate' | 'emerald', string> = {
    rose:    'bg-rose-100 text-rose-800 ring-rose-300',
    amber:   'bg-amber-100 text-amber-900 ring-amber-300',
    slate:   'bg-ink-100 text-ink-700 ring-ink-300',
    emerald: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  };
  return (
    <span className={'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ' + cls[tone]}>
      {children}
    </span>
  );
}

const _usd = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD',
  minimumFractionDigits: 0, maximumFractionDigits: 0,
});
const _usdCents = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD',
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function usd(n: number, cents = false): string {
  return cents ? _usdCents.format(n) : _usd.format(n);
}

export function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (isNaN(t)) return iso;
  const diffMs = Date.now() - t;
  const mins = Math.round(diffMs / 60000);
  if (mins < 60)  return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30)  return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(months / 12);
  return `${years}y ago`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return '';
  return `${(n * 100).toFixed(digits)}%`;
}
