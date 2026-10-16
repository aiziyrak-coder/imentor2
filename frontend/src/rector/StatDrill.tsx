import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Download, ListChecks, Search, X } from 'lucide-react';
import { fetchControlPeople, type ControlPeople, type ReportFilters } from './rectorApi';
import { Spinner } from './RectorUi';
import type { Person } from './PersonPanel';
import { Avatar } from './RectorViz';
import { downloadCsv, safeFileName } from './csv';
import './rector.css';

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
      <button type="button" className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]" onClick={onClose} aria-label="Yopish" />
      <div className="relative flex max-h-[84vh] w-full max-w-[600px] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="rx-header flex items-center gap-3 px-5 py-4 text-white">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-sky-500 shadow-lg shadow-indigo-500/30">
            <ListChecks size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[16px] font-extrabold tracking-tight">{target.label || data?.title || '…'}</h2>
            <p className="text-[12px] text-indigo-100/75 rx-num">
              {data ? `${data.total} ta` : 'yuklanmoqda…'}
              {data && data.total > data.people.length && ` · ${data.people.length} tasi ko‘rsatilmoqda`}
            </p>
          </div>
          {data && data.people.length > 0 && (
            <button
              type="button"
              onClick={() =>
                downloadCsv(
                  safeFileName(`${target.label || data.title || 'royxat'}_${filters.from}_${filters.to}`),
                  ['F.I.Sh.', 'Tafsilot', 'Qiymat', 'Birlik', 'Izoh'],
                  rows.map((p) => [p.name, p.subtitle, p.value, p.value_label, p.note]),
                )
              }
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-[12px] font-bold ring-1 ring-white/15 transition hover:bg-emerald-500/80"
              title="Ro‘yxatni Excel uchun yuklab olish"
            >
              <Download size={14} /> Excel
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl bg-white/10 p-2 text-indigo-100 ring-1 ring-white/15 transition hover:bg-white/20 hover:text-white"
            aria-label="Yopish"
          >
            <X size={18} />
          </button>
        </header>

        {data && data.people.length > 0 && (
          <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Familiya yoki kafedra bo‘yicha qidirish"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-2 text-[13px] outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
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
                      className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-indigo-50/40 disabled:cursor-default disabled:hover:bg-transparent"
                      title={openable ? 'Batafsil hisobotini ochish' : ''}
                    >
                      <Avatar name={p.name} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-slate-900">{p.name}</span>
                        <span className="block truncate text-[11.5px] text-slate-500">
                          {p.subtitle || '—'}
                          {p.note && <span className="ml-1.5 text-amber-700">· {p.note}</span>}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-right text-[12px] tabular-nums text-slate-600">
                        <b className="text-slate-900">{p.value}</b> {p.value_label}
                      </span>
                      <ChevronRight
                        size={15}
                        className={`shrink-0 transition group-hover:translate-x-0.5 ${openable && !p.key.startsWith('name:') ? 'text-slate-300' : 'text-transparent'}`}
                      />
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
