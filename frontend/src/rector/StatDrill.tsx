import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';
import { fetchControlPeople, type ControlPeople, type ReportFilters } from './rectorApi';
import { Spinner } from './RectorUi';
import type { Person } from './PersonPanel';

/**
 * Raqam ortidagi odamlar (2026-09-28).
 *
 * Rektor sahifadagi istalgan raqamni bosadi — shu oynacha ochiladi va o'sha
 * raqam AYNAN kimlardan yig'ilganini ko'rsatadi. Ro'yxat familiya bo'yicha
 * qidiriladi; ismga bosilsa odamning o'z batafsil hisoboti ochiladi.
 *
 * Ro'yxat serverda hisobotning o'zi bilan bir manbadan quriladi, shuning
 * uchun oynadagi son sahifadagi raqamga har doim teng bo'ladi.
 */

export type DrillTarget = { metric: string; label?: string };

/** Familiya odatda birinchi so'z — qidiruv shuni ham, to'liq ismni ham qamraydi. */
function matches(name: string, subtitle: string, needle: string): boolean {
  if (!needle) return true;
  return `${name} ${subtitle}`.toLowerCase().includes(needle);
}

export default function StatDrill({
  target,
  filters,
  onOpenPerson,
  onClose,
}: {
  target: DrillTarget;
  filters: ReportFilters;
  onOpenPerson: (p: Person) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<ControlPeople | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    fetchControlPeople(filters, target.metric)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError('Ro‘yxatni yuklab bo‘lmadi.'));
    return () => {
      alive = false;
    };
  }, [target.metric, filters.from, filters.to, filters.department]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const needle = q.trim().toLowerCase();
  const rows = useMemo(
    () => (data?.people || []).filter((p) => matches(p.name, p.subtitle, needle)),
    [data, needle],
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-label="Yopish" />
      <div className="relative flex max-h-[80vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-bold text-slate-900">{target.label || data?.title || '…'}</h2>
            <p className="text-[12px] text-slate-500">
              {data ? `${data.total} ta` : 'yuklanmoqda…'}
              {data && data.total > data.people.length && ` · ${data.people.length} tasi ko‘rsatilmoqda`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Yopish"
          >
            <X size={18} />
          </button>
        </header>

        {data && data.people.length > 0 && (
          <div className="border-b border-slate-100 px-4 py-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Familiya yoki kafedra bo‘yicha qidirish"
                className="h-9 w-full rounded-lg border border-slate-200 pl-8 pr-2 text-[13px] outline-none focus:border-sky-400"
              />
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <p className="px-4 py-6 text-center text-[13px] text-rose-700">{error}</p>
          ) : !data ? (
            <div className="py-8">
              <Spinner />
            </div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-slate-400">
              {data.people.length === 0 ? 'Bu ko‘rsatkichda hech kim yo‘q.' : 'Topilmadi.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((p) => {
                const openable = p.kind === 'teacher' || p.kind === 'student';
                return (
                  <li key={`${p.kind}:${p.key}`}>
                    <button
                      type="button"
                      disabled={!openable || p.key.startsWith('name:')}
                      onClick={() =>
                        openable && onOpenPerson({ kind: p.kind as 'teacher' | 'student', key: p.key, name: p.name })
                      }
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
                      title={openable ? 'Batafsil hisobotini ochish' : ''}
                    >
                      <ChevronRight
                        size={14}
                        className={`shrink-0 ${openable && !p.key.startsWith('name:') ? 'text-slate-400' : 'text-transparent'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-slate-900">{p.name}</span>
                        <span className="block truncate text-[11.5px] text-slate-500">
                          {p.subtitle || '—'}
                          {p.note && <span className="ml-1.5 text-amber-700">· {p.note}</span>}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-[12.5px] tabular-nums text-slate-600">
                        <b className="text-slate-800">{p.value}</b> {p.value_label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
