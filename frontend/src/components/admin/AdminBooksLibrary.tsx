import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookMarked, ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useUiText } from '../../i18n/useUiText';
import {
  deleteAdminSubjectBook,
  fetchAdminSubjectBookStats,
  fetchAdminSubjectBooks,
  type SubjectBookItem,
  type SubjectBookStats,
} from '../../utils/subjectBookApi';

function formatSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminBooksLibrary() {
  const { t } = useUiText();
  const [books, setBooks] = useState<SubjectBookItem[]>([]);
  const [stats, setStats] = useState<SubjectBookStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [removingId, setRemovingId] = useState<number | null>(null);
  // Protokollar (klinik protokol, SanPin, SSV buyrug'i) AI generatsiyasida majburiy manba —
  // darsliklardan alohida ko'rsatiladi (2026-09-24).
  const [kind, setKind] = useState<'book' | 'protocol'>('book');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, s] = await Promise.all([fetchAdminSubjectBooks(), fetchAdminSubjectBookStats()]);
      setBooks(rows);
      setStats(s);
    } catch {
      setError(t('admin.error.loadFailed'));
      setBooks([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const protocolCount = useMemo(() => books.filter((b) => b.kind === 'protocol').length, [books]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const ofKind = books.filter((b) => (b.kind || 'book') === kind);
    if (!q) return ofKind;
    return ofKind.filter((b) =>
      `${b.title} ${b.department_name} ${b.source_archive}`.toLowerCase().includes(q),
    );
  }, [books, search, kind]);

  const grouped = useMemo(() => {
    const map = new Map<string, { departmentName: string; rows: SubjectBookItem[] }>();
    for (const b of filtered) {
      const key = b.department_code || String(b.department);
      if (!map.has(key)) map.set(key, { departmentName: b.department_name, rows: [] });
      map.get(key)!.rows.push(b);
    }
    return [...map.entries()]
      .map(([code, v]) => ({ code, ...v }))
      .sort((a, b) => a.departmentName.localeCompare(b.departmentName));
  }, [filtered]);

  const toggle = (code: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const removeBook = async (id: number) => {
    if (!window.confirm(t('admin.deleteConfirm'))) return;
    setRemovingId(id);
    try {
      await deleteAdminSubjectBook(id);
      setBooks((prev) => prev.filter((b) => b.id !== id));
    } catch {
      setError(t('admin.error.deleteFailedGeneric'));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="p-3 sm:p-5 lg:p-6 h-full overflow-y-auto w-full space-y-6">
      <div className="ios-glass rounded-3xl border border-white/70 p-6 shadow-sm flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center">
            <BookMarked size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{t('admin.booksTitle')}</h2>
            <p className="text-[13px] text-slate-500 leading-relaxed">{t('admin.booksSubtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-[13px] font-semibold text-slate-700"
        >
          <RefreshCw size={16} /> {t('admin.refresh')}
        </button>
      </div>

      <div className="inline-flex rounded-xl bg-slate-100 p-1" role="tablist">
        {([
          ['book', t('admin.booksTabBooks'), books.length - protocolCount],
          ['protocol', t('admin.booksTabProtocols'), protocolCount],
        ] as const).map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={kind === key}
            onClick={() => setKind(key)}
            className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition ${
              kind === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {label} <span className="ml-1 text-slate-400">{n}</span>
          </button>
        ))}
      </div>

      {kind === 'protocol' && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
          {t('admin.booksProtocolsHint')}
        </p>
      )}

      {stats && kind === 'book' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="ios-glass rounded-2xl border border-white/70 p-4">
            <p className="text-[11px] font-semibold text-slate-400 uppercase">{t('admin.booksDepartmentsCovered')}</p>
            <p className="text-2xl font-bold text-slate-900">{stats.departments_count}</p>
          </div>
          <div className="ios-glass rounded-2xl border border-white/70 p-4">
            <p className="text-[11px] font-semibold text-slate-400 uppercase">{t('admin.booksTotalCount')}</p>
            <p className="text-2xl font-bold text-slate-900">{stats.books_count}</p>
          </div>
        </div>
      )}

      {!loading && books.length > 0 && (
        <div className="relative sm:max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.booksSearchPlaceholder')}
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 bg-white text-[13px]"
          />
        </div>
      )}

      {error && <p className="text-[13px] text-rose-600 font-medium">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-indigo-600" size={40} />
        </div>
      ) : books.length === 0 ? (
        <div className="ios-glass rounded-2xl border p-10 text-center text-slate-400 text-[14px]">
          {t('admin.booksEmpty')}
        </div>
      ) : grouped.length === 0 ? (
        <div className="ios-glass rounded-2xl border p-10 text-center text-slate-400 text-[14px]">
          {t('admin.noResults')}
        </div>
      ) : (
        <ul className="space-y-3">
          {grouped.map((g) => {
            const isOpen = expanded.has(g.code);
            const chunkTotal = g.rows.reduce((sum, r) => sum + (r.chunk_count || 0), 0);
            return (
              <li key={g.code} className="ios-glass rounded-2xl border border-white/70 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggle(g.code)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-slate-50/60 border-b border-slate-100 text-left"
                >
                  <span className="flex items-center gap-2 font-bold text-slate-900">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    {g.departmentName}
                  </span>
                  <span className="text-[12px] text-slate-400 shrink-0">
                    {t('admin.booksCountLabel', { count: g.rows.length })} · {chunkTotal} chunk
                  </span>
                </button>
                {isOpen && (
                  <ul className="divide-y divide-slate-50">
                    {g.rows.map((b) => (
                      <li key={b.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                          <BookMarked size={18} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold text-slate-800 truncate">{b.title}</p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {b.page_count} {t('admin.booksPagesSuffix')} · {b.chunk_count} chunk · {formatSize(b.file_size)}
                            {b.source_archive ? ` · ${b.source_archive}` : ''}
                          </p>
                        </div>
                        {b.file_url && (
                          <a
                            href={b.file_url}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg shrink-0"
                            title={t('admin.booksOpenFile')}
                          >
                            <ExternalLink size={15} />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => void removeBook(b.id)}
                          disabled={removingId === b.id}
                          className="p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg shrink-0 disabled:opacity-40"
                          title={t('admin.delete')}
                        >
                          {removingId === b.id ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <Trash2 size={15} />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
