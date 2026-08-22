import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useUiText } from '../../i18n/useUiText';

const PAGE_SIZES = [15, 25, 50, 100] as const;

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
};

export default function ReportTablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: Props) {
  const { t } = useUiText();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  const pages: number[] = [];
  const win = 2;
  let start = Math.max(1, safePage - win);
  let end = Math.min(totalPages, safePage + win);
  if (safePage <= win) end = Math.min(totalPages, 1 + win * 2);
  if (safePage > totalPages - win) start = Math.max(1, totalPages - win * 2);
  for (let p = start; p <= end; p += 1) pages.push(p);

  if (total === 0) return null;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-3 py-3 border-t border-black/5 bg-black/[0.02]">
      <p className="text-[12px] text-black/50 tabular-nums">
        {t('admin.superAi.pageRange', { from, to, total })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-black/45 flex items-center gap-1.5">
          {t('admin.superAi.pageSize')}
          <select
            value={pageSize}
            onChange={(e) => {
              onPageSizeChange(Number(e.target.value));
              onPageChange(1);
            }}
            className="rounded-lg border border-black/10 bg-white px-2 py-1 text-[12px] font-semibold"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-40 hover:bg-black/5"
        >
          <ChevronLeft size={14} />
          {t('admin.superAi.prevPage')}
        </button>
        <div className="flex items-center gap-0.5">
          {start > 1 && (
            <>
              <button
                type="button"
                onClick={() => onPageChange(1)}
                className="min-w-[2rem] rounded-lg px-2 py-1.5 text-[12px] font-semibold hover:bg-black/5"
              >
                1
              </button>
              {start > 2 && <span className="px-1 text-black/30">…</span>}
            </>
          )}
          {pages.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              className={`min-w-[2rem] rounded-lg px-2 py-1.5 text-[12px] font-bold ${
                p === safePage ? 'bg-violet-600 text-white' : 'hover:bg-black/5 text-black/70'
              }`}
            >
              {p}
            </button>
          ))}
          {end < totalPages && (
            <>
              {end < totalPages - 1 && <span className="px-1 text-black/30">…</span>}
              <button
                type="button"
                onClick={() => onPageChange(totalPages)}
                className="min-w-[2rem] rounded-lg px-2 py-1.5 text-[12px] font-semibold hover:bg-black/5"
              >
                {totalPages}
              </button>
            </>
          )}
        </div>
        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-40 hover:bg-black/5"
        >
          {t('admin.superAi.nextPage')}
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
