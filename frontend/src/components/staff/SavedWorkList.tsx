import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Trash2, User } from 'lucide-react';
import type { PreparedContentSummary } from '../../utils/preparedContentStore';
import { useUiText } from '../../i18n/useUiText';
import { localizedTitleFromCache, subscribeSyllabusRows } from '../../utils/syllabusRowCache';

const PAGE_SIZE = 20;

/**
 * Baza ro'yxati — to'rt bo'lim (Ma'ruza, Taqdimot, Keys, Test) uchun yagona
 * ko'rinish: har yozuv BITTA QATOR bo'lib, to'liq nomi, muallifi va sanasi
 * bilan chiqadi. Qator bosilganda material shu sahifaning o'zida ochiladi.
 *
 * Ro'yxat uzun bo'lsa sahifalanadi (20 tadan) — ilgari barcha versiyalar
 * bir vaqtda kichik "chip" tugmalar sifatida chiqib, nomi ham, muallifi ham
 * ko'rinmasdi.
 */
export default function SavedWorkList({
  items,
  activeId,
  onSelect,
  onDelete,
  emptyText,
}: {
  items: PreparedContentSummary[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  emptyText?: string;
}) {
  const { t, locale, language } = useUiText();
  const [page, setPage] = useState(0);
  // Sillabus keshi kechroq to'lsa, ro'yxat qayta chizilsin.
  const [cacheTick, setCacheTick] = useState(0);
  useEffect(() => subscribeSyllabusRows(() => setCacheTick((n) => n + 1)), []);

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = useMemo(
    () => items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    // `cacheTick` — sillabus keshi to'lganda sarlavhalar tarjimasi yangilansin.
    [items, safePage, cacheTick],
  );

  if (!items.length) {
    return (
      <div className="rounded-xl border border-black/10 bg-white/60 p-8 text-center text-[14px] text-black/45">
        {emptyText || t('toolbar.saved')}
      </div>
    );
  }

  const formatWhen = (ms: number) => {
    try {
      return new Date(ms).toLocaleString(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  return (
    <div className="space-y-3">
      <div className="divide-y divide-black/5 rounded-xl border border-black/10 bg-white/70 overflow-hidden">
        {visible.map((item) => {
          const active = activeId === item.id;
          return (
            <div
              key={item.id}
              className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                active ? 'bg-blue-50' : 'hover:bg-black/[0.03]'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                className="min-w-0 flex-1 text-left"
              >
                <p
                  className={`text-[14px] font-semibold leading-snug ${
                    active ? 'text-blue-800' : 'text-black/85'
                  }`}
                >
                  {localizedTitleFromCache(item.topic, language)}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-black/50">
                  <span className="inline-flex items-center gap-1">
                    <User size={12} />
                    {item.author?.trim() || '—'}
                  </span>
                  <span>{formatWhen(item.createdAt)}</span>
                </p>
              </button>

              {onDelete && item.canDelete !== false && (
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  className="shrink-0 rounded-lg border border-transparent p-2 text-rose-600 hover:border-rose-200 hover:bg-rose-50"
                  aria-label={t('toolbar.deleteVersion')}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="rounded-lg border border-black/10 bg-white p-2 text-black/60 disabled:opacity-30 hover:border-black/20"
            aria-label={t('common.previous')}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-[13px] font-semibold tabular-nums text-black/60">
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            className="rounded-lg border border-black/10 bg-white p-2 text-black/60 disabled:opacity-30 hover:border-black/20"
            aria-label={t('common.next')}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
