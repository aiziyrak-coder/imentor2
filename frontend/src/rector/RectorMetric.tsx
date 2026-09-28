import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { HttpError } from '../api/httpClient';
import {
  fetchMetricDetail,
  type MetricDetail,
  type MetricRow,
  type ReportFilters,
} from './rectorApi';
import { ErrorBox, SortableTable, pctTone } from './RectorUi';

/**
 * Raqamning ortidagi ro'yxat.
 *
 * "653 o'qituvchi" degan son o'zicha hech narsani isbotlamaydi va uni
 * tekshirib ham bo'lmaydi. Shu sababli har bir ko'rsatkich bosiladi va
 * uchta savolga javob beradi: bu nima, qanday hisoblangan, ortida kim
 * yoki nima turibdi. Ro'yxat raqam bilan bitta manbadan olinadi.
 */

// CSV uchun eng katta hajm. Backend ham aynan shu chegarani qabul qiladi.
const CSV_LIMIT = 2000;

type OpenMetric = (metric: string) => void;

const MetricContext = createContext<OpenMetric>(() => {});

/** Bo'limlar shu orqali ko'rsatkich oynasini ochadi. */
export function useOpenMetric(): OpenMetric {
  return useContext(MetricContext);
}

export function MetricProvider({
  filters,
  onUnauthorized,
  children,
}: {
  filters: ReportFilters;
  onUnauthorized: () => void;
  children: ReactNode;
}) {
  const [metric, setMetric] = useState('');
  const open = useCallback<OpenMetric>((m) => setMetric(m), []);

  return (
    <MetricContext.Provider value={open}>
      {children}
      {metric && (
        <MetricDialog
          metric={metric}
          filters={filters}
          onClose={() => setMetric('')}
          onUnauthorized={onUnauthorized}
        />
      )}
    </MetricContext.Provider>
  );
}

function cellText(value: string | number | null): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

/** Ro'yxatni Excel ochadigan CSV qilib beradi — rektor tekshirib ko'rsin. */
function downloadCsv(data: MetricDetail): void {
  const head = data.columns.map((c) => c.label).join(';');
  const body = data.rows
    .map((row) =>
      data.columns
        .map((c) => {
          const raw = cellText(row[c.key]);
          return raw.includes(';') || raw.includes('"')
            ? `"${raw.replace(/"/g, '""')}"`
            : raw;
        })
        .join(';'),
    )
    .join('\n');
  // BOM — Excel faylni UTF-8 deb tanishi uchun (aks holda o‘/g‘ buziladi).
  const blob = new Blob([`﻿${head}\n${body}`], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `${data.metric}-${data.from}_${data.to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

function MetricDialog({
  metric,
  filters,
  onClose,
  onUnauthorized,
}: {
  metric: string;
  filters: ReportFilters;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [data, setData] = useState<MetricDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const key = `${metric}|${filters.from}|${filters.to}|${filters.department || ''}`;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData(null);
    fetchMetricDetail(metric, filters)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError('');
      })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
          onUnauthorized();
          return;
        }
        const detail = e instanceof HttpError ? (e.body as { detail?: string } | null)?.detail : '';
        setError(detail || 'Tafsilotni yuklab bo‘lmadi.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Escape bilan yopiladi va oyna ochiq turganda orqa fon siljimaydi.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const [csvBusy, setCsvBusy] = useState(false);

  /**
   * Ekranda birinchi 500 qator ko'rinadi, CSV esa TO'LIQ bo'lishi kerak —
   * aks holda "to'liqini CSV orqali oling" degan yozuv yolg'on bo'lardi.
   */
  const exportCsv = async () => {
    if (!data) return;
    setCsvBusy(true);
    try {
      const full =
        data.total > data.rows.length
          ? await fetchMetricDetail(metric, filters, CSV_LIMIT)
          : data;
      downloadCsv(full);
    } catch {
      // To'lig'ini olib bo'lmasa, hech bo'lmasa ko'rinib turgani ketsin.
      downloadCsv(data);
    } finally {
      setCsvBusy(false);
    }
  };

  const columns = useMemo(() => {
    if (!data) return [];
    return data.columns.map((c) => ({
      key: c.key,
      label: c.label,
      align: c.align,
      value: (row: MetricRow) => row[c.key],
      render: (row: MetricRow) => {
        const raw = row[c.key];
        if (c.key === 'percent') {
          if (raw === null || raw === undefined || raw === '') {
            return <span className="text-slate-300">—</span>;
          }
          return (
            <span
              className={`rounded px-1.5 py-0.5 text-[12px] font-semibold ${pctTone(Number(raw))}`}
            >
              {raw}%
            </span>
          );
        }
        return cellText(raw);
      },
    }));
  }, [data]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl bg-slate-50 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-slate-900">{data?.title || 'Yuklanmoqda…'}</p>
            <p className="text-[11.5px] text-slate-500">
              {filters.from} — {filters.to}
              {filters.department ? ` · ${filters.department}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {data && data.rows.length > 0 && (
              <button
                type="button"
                onClick={() => void exportCsv()}
                disabled={csvBusy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {csvBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                <span className="hidden sm:inline">CSV</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Yopish"
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading && (
            <div className="flex justify-center py-16 text-slate-400">
              <Loader2 size={22} className="animate-spin" />
            </div>
          )}
          {error && <ErrorBox text={error} />}

          {data && !loading && (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Ko‘rsatkich
                  </p>
                  <p className="text-[26px] font-bold tabular-nums text-slate-900">{data.value}</p>
                </div>
                <div className="space-y-1.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] leading-relaxed">
                  <p className="text-slate-800">{data.explain}</p>
                  <p className="text-slate-500">
                    <span className="font-semibold text-slate-600">Qanday hisoblangan: </span>
                    {data.method}
                  </p>
                  <p className="text-[11.5px] text-slate-400">Manba: {data.source}</p>
                </div>
              </div>

              {data.rows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-12 text-center text-[13px] text-slate-500">
                  Bu oraliqda bitta ham yozuv yo‘q — raqam ham shuning uchun nol.
                </div>
              ) : (
                <>
                  <p className="px-1 text-[12.5px] text-slate-500">
                    {data.total <= data.shown
                      ? `${data.total} ta yozuv — raqam aynan shulardan iborat.`
                      : data.total > CSV_LIMIT
                        ? `${data.total} yozuvdan birinchi ${data.shown} tasi ko‘rsatilgan; CSV eng ko‘pi ${CSV_LIMIT} tasini beradi.`
                        : `${data.total} yozuvdan birinchi ${data.shown} tasi ko‘rsatilgan — to‘liq ro‘yxatni CSV tugmasi beradi.`}
                  </p>
                  <SortableTable<MetricRow>
                    rows={data.rows}
                    columns={columns}
                    rowKey={(row) =>
                      String(row[data.columns[0]?.key ?? ''] ?? '') +
                      String(row[data.columns[1]?.key ?? ''] ?? '') +
                      String(data.rows.indexOf(row))
                    }
                    initialSort={{ key: data.columns[0]?.key || '', dir: 'asc' }}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
