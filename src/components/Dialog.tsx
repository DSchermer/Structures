import { ReactNode, useEffect } from 'react';

export function Dialog({ open, onClose, title, children, footer, wide = false }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-20 px-4 overflow-y-auto" onClick={onClose}>
      <div
        className={(wide ? 'max-w-3xl' : 'max-w-lg') + ' w-full bg-white rounded-lg shadow-xl border border-ink-200 overflow-hidden'}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-ink-200 flex items-center">
          <h2 className="text-sm font-semibold text-ink-700 uppercase tracking-wide">{title}</h2>
          <button onClick={onClose} className="ml-auto text-ink-400 hover:text-ink-700 text-sm">✕</button>
        </header>
        <div className="p-5">{children}</div>
        {footer && <footer className="px-5 py-3 border-t border-ink-200 bg-ink-50 flex items-center justify-end gap-2">{footer}</footer>}
      </div>
    </div>
  );
}
