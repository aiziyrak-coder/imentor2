import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, ChevronRight, Layers, ListX, TrendingUp } from 'lucide-react';
import { HttpError } from '../api/httpClient';
import {
  fetchDepartments,
  fetchGaps,
  fetchTrend,
  type DepartmentRow,
  type DepartmentsResponse,
  type GapsResponse,
  type ReportFilters,
  type TrendBucket,
  type TrendResponse,
} from './rectorApi';
import {
  Empty,
  ErrorBox,
  SortableTable,
  Spinner,
  StatusChip,
  StatusDot,
  fmtMinutes,
  statusOf,
  statusOfLow,
  type Status,
} from './RectorUi';
import { MetricStat as Stat } from './RectorSections';

/**
 * Rektor hisobotining ikkinchi yarmi — "NIMA YETISHMAYAPTI".
 *
 * Birinchi yarim (RectorSections) kim nima qilganini ko'rsatadi. Bu yerda
 * boshqa savolga javob bor: qaysi kafedrada sillabus yo'q, qaysi fanda
 * mavzu yo'q, qaysi mavzuda video yoki tarqatma yo'q — va bularning
 * har biri ALOHIDA ko'rinadi, rektor birma-bir ochib yurmasin.
 */

type SectionProps = { filters: ReportFilters; onUnauthorized: () => void };

/**
 * Sodda yuklovchi. `useReport` dan farqi — kalit tashqaridan beriladi,
 * shuning uchun bo'lim ichidagi holat (masalan davr kesimi) ham so'rovni
 * yangilay oladi.
 */
export function useAsync<T>(
  load: () => Promise<T>,
  deps: unknown[],
  onUnauthorized: () => void,
): { data: T | null; loading: boolean; error: string } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    run()
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
        setError(detail || 'Ma’lumotni yuklab bo‘lmadi. Birozdan keyin qayta urinib ko‘ring.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [run, onUnauthorized]);

  return { data, loading, error };
}

/* ==================== 5. Kafedralar ==================== */

/** Qatorni tanlangan kamchilik bo'yicha filtrlash. */
function matchesGap(row: DepartmentRow, gap: string): boolean {
  if (!gap) return true;
  if (gap === 'no_syllabus') return !row.has_syllabus;
  if (gap === 'no_topics') return row.syllabuses_without_topics > 0;
  // Material turi: mavzu bor, lekin shu turdan bitta ham yo'q.
  return row.topics > 0 && (row.coverage[gap] || 0) === 0;
}

/**
 * Arxivdagi, sillabusi ham, o'qituvchisi ham yo'q kafedra — bu eski
 * yozuv, kamchilik emas. Bazada shundaylari 40 dan ortiq; ular ro'yxatni
 * ko'mib tashlab, haqiqiy kamchilikni ko'rinmas qilib qo'yardi.
 */
export function isDormant(row: DepartmentRow): boolean {
  return !row.is_active && !row.syllabuses && !row.teachers;
}

/**
 * Kafedra holati bitta rangda: sillabusi yo'q bo'lsa qizil, mavzusi
 * kiritilmagan bo'lsa "ma'lumot yo'q", qolganida tayyorlik foiziga qarab.
 */
function departmentStatus(row: DepartmentRow): Status {
  if (!row.has_syllabus) return 'bad';
  if (!row.topics) return 'none';
  return statusOf(row.ready_percent, 70, 30);
}

export function DepartmentsSection({ filters, onUnauthorized }: SectionProps) {
  const [gap, setGap] = useState('');
  const [showDormant, setShowDormant] = useState(false);
  const { from, to, refreshKey, department, q } = filters;

  const { data, loading, error } = useAsync<DepartmentsResponse>(
    () => fetchDepartments({ from, to }),
    [from, to, refreshKey],
    onUnauthorized,
  );
  const [openKey, setOpenKey] = useState('');

  const base = useMemo(
    () => (data?.results || []).filter((r) => showDormant || !isDormant(r)),
    [data, showDormant],
  );

  const rows = useMemo(() => {
    const needle = (q || '').trim().toLowerCase();
    return base.filter((r) => {
      if (department && r.name !== department) return false;
      if (needle && !`${r.name} ${r.code}`.toLowerCase().includes(needle)) return false;
      return matchesGap(r, gap);
    });
  }, [base, department, q, gap]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox text={error} />;
  if (!data) return null;

  const all = rows;
  const hidden = data.results.filter(isDormant).length;
  const chips = [
    { key: '', label: 'Hammasi' },
    { key: 'no_syllabus', label: 'Sillabus yo‘q' },
    { key: 'no_topics', label: 'Mavzu yo‘q' },
    ...data.kinds.map((k) => ({ key: k.key, label: `${k.label} yo‘q` })),
  ];

  const totalTopics = all.reduce((n, r) => n + r.topics, 0);
  const coveredTopics = all.reduce((n, r) => n + r.topics_covered, 0);

  const kindColumns = data.kinds.map((k) => ({
    key: k.key,
    label: k.label,
    align: 'right' as const,
    // Mavzusi yo'q kafedrada foiz yo'q — nol emas, umuman yo'q.
    value: (r: DepartmentRow) => (r.topics ? (r.coverage_percent[k.key] ?? 0) : null),
    render: (r: DepartmentRow) => {
      if (!r.topics) return <span className="text-slate-300">—</span>;
      const pct = r.coverage_percent[k.key] ?? 0;
      return (
        <StatusChip
          status={statusOf(pct, 70, 30)}
          title={`${r.coverage[k.key] || 0} / ${r.topics} mavzuda bor`}
        >
          {pct}%
        </StatusChip>
      );
    },
  }));

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Kafedra"
          value={all.length}
          hint={hidden && !showDormant ? `${hidden} ta arxiv yashirilgan` : undefined}
        />
        <Stat
          label="Sillabusi yo‘q"
          value={all.filter((r) => !r.has_syllabus).length}
          status={statusOfLow(all.filter((r) => !r.has_syllabus).length, 0, 3)}
        />
        <Stat
          label="Mavzu"
          value={totalTopics}
          hint={`${coveredTopics} tasida material bor`}
          status={statusOf(totalTopics ? (coveredTopics * 100) / totalTopics : null, 70, 30)}
        />
        <Stat
          label="Umumiy tayyorlik"
          value={totalTopics ? `${Math.round((coveredTopics * 100) / totalTopics)}%` : '—'}
          status={statusOf(totalTopics ? (coveredTopics * 100) / totalTopics : null, 70, 30)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Kamchilik bo‘yicha
        </span>
        {chips.map((c) => {
          const count = c.key ? all.filter((r) => matchesGap(r, c.key)).length : all.length;
          const active = gap === c.key;
          return (
            <button
              key={c.key || 'all'}
              type="button"
              onClick={() => setGap(c.key)}
              className={`rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold transition ${
                active
                  ? 'bg-slate-900 text-white'
                  : count
                    ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                    : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
              }`}
            >
              {c.label}
              <span className="ml-1 tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
        {hidden > 0 && (
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[12.5px] font-medium text-slate-600">
            <input
              type="checkbox"
              checked={showDormant}
              onChange={(e) => setShowDormant(e.target.checked)}
            />
            Arxiv kafedralar ({hidden})
          </label>
        )}
      </div>

      {!rows.length ? (
        <Empty
          text={
            gap
              ? 'Bu kamchilik bo‘yicha kafedra topilmadi — hammasi joyida.'
              : 'Kafedra topilmadi.'
          }
        />
      ) : (
        <SortableTable
          rows={rows}
          rowKey={(r) => String(r.id)}
          onRowClick={(r) => setOpenKey((k) => (k === String(r.id) ? '' : String(r.id)))}
          expandedKey={openKey}
          renderExpanded={(r) => <DepartmentDetail row={r} kinds={data.kinds} />}
          initialSort={{ key: 'ready', dir: 'asc' }}
          columns={[
            {
              key: 'name',
              label: 'Kafedra',
              value: (r) => r.name,
              render: (r) => (
                <span className="flex items-center gap-1.5">
                  <ChevronRight
                    size={13}
                    className={`shrink-0 text-slate-300 transition ${
                      openKey === String(r.id) ? 'rotate-90' : ''
                    }`}
                  />
                  <StatusDot
                    status={departmentStatus(r)}
                    title={
                      r.has_syllabus
                        ? `Tayyorlik ${r.ready_percent}%`
                        : 'Sillabus umuman kiritilmagan'
                    }
                  />
                  <span>
                    <span className="block font-medium text-slate-900">{r.name}</span>
                    <span className="block text-[11px] text-slate-400">
                      {r.teachers} o‘qituvchi · {r.teachers_active} tasi shu oraliqda ishlagan
                    </span>
                  </span>
                </span>
              ),
            },
            {
              key: 'syllabuses',
              label: 'Sillabus',
              align: 'right',
              value: (r) => r.syllabuses,
              render: (r) =>
                r.syllabuses ? (
                  <span>
                    {r.syllabuses}
                    {r.syllabuses_without_topics > 0 && (
                      <span
                        className="ml-1 rounded bg-amber-50 px-1 py-0.5 text-[10.5px] font-semibold text-amber-700"
                        title="mavzusi kiritilmagan sillabuslar"
                      >
                        {r.syllabuses_without_topics} bo‘sh
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">
                    yo‘q
                  </span>
                ),
            },
            { key: 'topics', label: 'Mavzu', align: 'right', value: (r) => r.topics },
            {
              key: 'ready',
              label: 'Tayyor',
              align: 'right',
              value: (r) => (r.topics ? r.ready_percent : null),
              render: (r) =>
                r.topics ? (
                  <StatusChip
                    status={statusOf(r.ready_percent, 70, 30)}
                    title={`${r.topics_covered} mavzuda material bor, ${r.topics_empty} tasida yo‘q`}
                  >
                    {r.ready_percent}%
                  </StatusChip>
                ) : (
                  <span className="text-slate-300">—</span>
                ),
            },
            ...kindColumns,
          ]}
        />
      )}
    </div>
  );
}

function DepartmentDetail({
  row,
  kinds,
}: {
  row: DepartmentRow;
  kinds: Array<{ key: string; label: string }>;
}) {
  const missing = kinds.filter((k) => row.topics > 0 && (row.coverage[k.key] || 0) === 0);

  return (
    <div className="space-y-3">
      {!row.has_syllabus && (
        <p className="rounded-lg bg-rose-50 px-2.5 py-2 text-[12.5px] text-rose-800">
          Bu kafedraga birorta ham sillabus biriktirilmagan.
        </p>
      )}

      {missing.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[12px] font-semibold text-slate-600">
            Butun kafedra bo‘yicha umuman yo‘q
          </p>
          <div className="flex flex-wrap gap-1.5">
            {missing.map((k) => (
              <span
                key={k.key}
                className="rounded-lg bg-rose-50 px-2 py-1 text-[11.5px] font-semibold text-rose-700"
              >
                {k.label}
              </span>
            ))}
          </div>
        </div>
      ) : (
        row.topics > 0 && (
          <p className="flex items-center gap-1.5 text-[12.5px] text-emerald-700">
            <CheckCircle2 size={14} /> Har bir material turidan kamida bitta mavzuda bor.
          </p>
        )
      )}

      {row.empty_syllabuses.length > 0 && (
        <div>
          <p className="mb-1.5 text-[12px] font-semibold text-slate-600">
            Mavzusi kiritilmagan fanlar ({row.syllabuses_without_topics})
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {row.empty_syllabuses.map((s) => (
              <li
                key={s.id}
                className="rounded-lg bg-white px-2 py-1 text-[11.5px] text-slate-700 ring-1 ring-slate-200"
              >
                {s.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {row.topics > 0 && (
        <p className="text-[12px] text-slate-500">
          {row.topics} mavzudan {row.topics_covered} tasida material bor,{' '}
          <strong className="text-slate-700">{row.topics_empty}</strong> tasi butunlay bo‘sh.
        </p>
      )}
    </div>
  );
}

/* ==================== 6. Kamchiliklar ==================== */

type GapTab = 'departments' | 'topics' | 'materials' | 'kinds';

export function GapsSection({ filters, onUnauthorized }: SectionProps) {
  const { refreshKey } = filters;
  const { data, loading, error } = useAsync<GapsResponse>(
    () => fetchGaps(120),
    [refreshKey],
    onUnauthorized,
  );
  const [tab, setTab] = useState<GapTab>('departments');

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox text={error} />;
  if (!data) return null;

  const t = data.totals;
  const tabs: Array<{ id: GapTab; label: string; count: number; icon: typeof Building2 }> = [
    {
      id: 'departments',
      label: 'Sillabusi yo‘q kafedralar',
      count: t.departments_without_syllabus,
      icon: Building2,
    },
    {
      id: 'topics',
      label: 'Mavzusi yo‘q fanlar',
      count: t.syllabuses_without_topics,
      icon: ListX,
    },
    {
      id: 'materials',
      label: 'Materialsiz mavzular',
      count: t.topics_without_material,
      icon: Layers,
    },
    {
      id: 'kinds',
      label: 'Turi yetishmayotgan fanlar',
      count: t.syllabuses_missing_kinds,
      icon: Layers,
    },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Kafedra"
          value={t.departments}
          hint={`${t.departments_without_syllabus} tasida sillabus yo‘q`}
          status={statusOfLow(t.departments_without_syllabus, 0, 3)}
        />
        <Stat
          label="Fan (sillabus)"
          value={t.syllabuses}
          hint={`${t.syllabuses_without_topics} tasida mavzu yo‘q`}
          status={statusOfLow(t.syllabuses_without_topics, 0, 5)}
        />
        <Stat
          label="Materialsiz mavzu"
          value={t.topics_without_material}
          status={statusOfLow(t.topics_without_material, 0, 200)}
        />
        <Stat
          label="Turi yetishmaydi"
          value={t.syllabuses_missing_kinds}
          status={statusOfLow(t.syllabuses_missing_kinds, 0, 50)}
          hint="fanda shu turdan bitta ham yo‘q"
        />
      </div>

      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2">
        {tabs.map((x) => {
          const Icon = x.icon;
          const active = tab === x.id;
          return (
            <button
              key={x.id}
              type="button"
              onClick={() => setTab(x.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold transition ${
                active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon size={13} />
              {x.label}
              <span className="tabular-nums opacity-70">{x.count}</span>
            </button>
          );
        })}
      </div>

      {tab === 'departments' &&
        (data.departments_without_syllabus.length ? (
          <SortableTable
            rows={data.departments_without_syllabus}
            rowKey={(r) => String(r.id)}
            initialSort={{ key: 'name', dir: 'asc' }}
            columns={[
              { key: 'name', label: 'Kafedra', value: (r) => r.name },
              {
                key: 'state',
                label: 'Holati',
                value: (r) => (r.is_active ? 1 : 0),
                render: (r) =>
                  r.is_active ? (
                    <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11.5px] font-semibold text-rose-700">
                      faol — sillabus kiritilmagan
                    </span>
                  ) : (
                    <span className="text-[12px] text-slate-400">arxiv</span>
                  ),
              },
            ]}
          />
        ) : (
          <Empty text="Har bir kafedrada kamida bitta sillabus bor." />
        ))}

      {tab === 'topics' &&
        (data.syllabuses_without_topics.length ? (
          <SortableTable
            rows={data.syllabuses_without_topics}
            rowKey={(r) => String(r.id)}
            initialSort={{ key: 'department', dir: 'asc' }}
            columns={[
              { key: 'name', label: 'Fan', value: (r) => r.name },
              {
                key: 'department',
                label: 'Kafedra',
                value: (r) => r.department,
                render: (r) => (
                  <span className="text-slate-500">{r.department || 'biriktirilmagan'}</span>
                ),
              },
            ]}
          />
        ) : (
          <Empty text="Barcha fanlarda mavzular kiritilgan." />
        ))}

      {tab === 'materials' &&
        (data.topics_without_material.length ? (
          <>
            <p className="px-1 text-[12.5px] text-slate-500">
              Eng muhim {data.topics_without_material.length} tasi ko‘rsatilgan (jami{' '}
              {t.topics_without_material}).
            </p>
            <SortableTable
              rows={data.topics_without_material}
              rowKey={(r) => `${r.syllabus_id}-${r.topic_code}`}
              initialSort={{ key: 'department', dir: 'asc' }}
              columns={[
                {
                  key: 'topic',
                  label: 'Mavzu',
                  value: (r) => r.topic_title || r.topic_code,
                  render: (r) => (
                    <span>
                      <span className="block text-slate-800">{r.topic_title || '—'}</span>
                      <span className="block font-mono text-[11px] text-slate-400">
                        {r.topic_code}
                      </span>
                    </span>
                  ),
                },
                { key: 'subject', label: 'Fan', value: (r) => r.subject_name },
                {
                  key: 'department',
                  label: 'Kafedra',
                  value: (r) => r.department,
                  render: (r) => (
                    <span className="text-slate-500">{r.department || 'biriktirilmagan'}</span>
                  ),
                },
              ]}
            />
          </>
        ) : (
          <Empty text="Har bir mavzuda kamida bitta material bor." />
        ))}

      {tab === 'kinds' &&
        (data.syllabuses_missing_kinds.length ? (
          <SortableTable
            rows={data.syllabuses_missing_kinds}
            rowKey={(r) => String(r.syllabus_id)}
            initialSort={{ key: 'missing', dir: 'desc' }}
            columns={[
              { key: 'subject', label: 'Fan', value: (r) => r.subject_name },
              {
                key: 'department',
                label: 'Kafedra',
                value: (r) => r.department,
                render: (r) => (
                  <span className="text-slate-500">{r.department || 'biriktirilmagan'}</span>
                ),
              },
              { key: 'topics', label: 'Mavzu', align: 'right', value: (r) => r.topics },
              {
                key: 'empty',
                label: 'Bo‘sh mavzu',
                align: 'right',
                value: (r) => r.empty_topics,
              },
              {
                key: 'missing',
                label: 'Umuman yo‘q',
                value: (r) => r.missing_kinds.length,
                render: (r) => (
                  <span className="flex flex-wrap gap-1">
                    {r.missing_kinds.map((k) => (
                      <span
                        key={k}
                        className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700"
                      >
                        {k}
                      </span>
                    ))}
                  </span>
                ),
              },
            ]}
          />
        ) : (
          <Empty text="Har bir fanda material turlarining hammasi bor." />
        ))}
    </div>
  );
}

/* ==================== 7. Dinamika ==================== */

const BUCKETS: Array<{ key: TrendBucket; label: string }> = [
  { key: 'day', label: 'Kunlik' },
  { key: 'week', label: 'Haftalik' },
  { key: 'month', label: 'Oylik' },
  { key: 'quarter', label: 'Choraklik' },
];

function periodLabel(period: string, bucket: TrendBucket): string {
  const [y, m, d] = (period || '').split('-');
  if (!y) return '—';
  if (bucket === 'day') return `${d}.${m}`;
  if (bucket === 'week') return `${d}.${m} — hafta`;
  if (bucket === 'month') return `${m}.${y}`;
  return `${Math.floor((Number(m) - 1) / 3) + 1}-chorak ${y}`;
}

export function TrendSection({ filters, onUnauthorized }: SectionProps) {
  const [bucket, setBucket] = useState<TrendBucket>('day');
  const { from, to, refreshKey } = filters;

  const { data, loading, error } = useAsync<TrendResponse>(
    () => fetchTrend({ from, to }, bucket),
    [from, to, bucket, refreshKey],
    onUnauthorized,
  );

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox text={error} />;
  if (!data) return null;

  const rows = data.rows;
  const maxMinutes = Math.max(1, ...rows.map((r) => r.minutes));
  const totalMinutes = rows.reduce((n, r) => n + r.minutes, 0);
  const totalLessons = rows.reduce((n, r) => n + r.lessons, 0);
  const totalCreated = rows.reduce((n, r) => n + r.created, 0);
  const totalAttempts = rows.reduce((n, r) => n + r.attempts, 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2">
        <TrendingUp size={15} className="mr-0.5 shrink-0 text-slate-400" />
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => setBucket(b.key)}
            className={`rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold transition ${
              bucket === b.key
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {b.label}
          </button>
        ))}
        <span className="ml-1 text-[11.5px] text-slate-400">
          Sana oralig‘i yuqoridagi filtrdan olinadi
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Jami vaqt" value={fmtMinutes(totalMinutes)} />
        <Stat label="Dars" value={totalLessons} tone="sky" />
        <Stat label="Yaratilgan material" value={totalCreated} tone="emerald" />
        <Stat label="Test topshirish" value={totalAttempts} />
      </div>

      {!rows.length ? (
        <Empty text="Bu oraliqda harakat qayd etilmagan." />
      ) : (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-3.5">
            <p className="mb-3 text-[12.5px] font-semibold text-slate-600">
              iMentorda o‘tkazilgan vaqt ({data.bucket_label} kesimida)
            </p>
            <div className="flex h-32 items-end gap-1 overflow-x-auto">
              {rows.map((r) => (
                <div key={r.period} className="flex min-w-[26px] flex-1 flex-col items-center gap-1">
                  <div className="flex h-24 w-full items-end justify-center">
                    <div
                      className="w-2/3 rounded-t bg-slate-800"
                      style={{ height: `${(r.minutes / maxMinutes) * 100}%` }}
                      title={`${periodLabel(r.period, data.bucket)}: ${fmtMinutes(r.minutes)}, ${r.people} kishi`}
                    />
                  </div>
                  <span className="whitespace-nowrap text-[9.5px] text-slate-400">
                    {periodLabel(r.period, data.bucket)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <SortableTable
            rows={rows}
            rowKey={(r) => r.period}
            initialSort={{ key: 'period', dir: 'desc' }}
            columns={[
              {
                key: 'period',
                label: data.bucket_label,
                value: (r) => r.period,
                render: (r) => (
                  <span className="font-medium text-slate-900">
                    {periodLabel(r.period, data.bucket)}
                  </span>
                ),
              },
              {
                key: 'minutes',
                label: 'Vaqt',
                align: 'right',
                value: (r) => r.minutes,
                render: (r) => fmtMinutes(r.minutes),
              },
              { key: 'people', label: 'Foydalangan', align: 'right', value: (r) => r.people },
              { key: 'lessons', label: 'Dars', align: 'right', value: (r) => r.lessons },
              { key: 'created', label: 'Material', align: 'right', value: (r) => r.created },
              { key: 'attempts', label: 'Test', align: 'right', value: (r) => r.attempts },
              {
                key: 'avg',
                label: 'O‘rtacha ball',
                align: 'right',
                value: (r) => r.avg_percent,
                render: (r) =>
                  r.avg_percent === null ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    <StatusChip status={statusOf(r.avg_percent, 71, 56)}>
                      {r.avg_percent}%
                    </StatusChip>
                  ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
