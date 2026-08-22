import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  RefreshCw,
  Loader2,
  Download,
  Users,
  MapPin,
  Archive,
  Brain,
  Search,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  ClipboardList,
  UserX,
} from 'lucide-react';
import { useUiText } from '../../i18n/useUiText';
import {
  fetchTeacherReport,
  fetchReportSummary,
  fetchAiNarrative,
  fetchStudentTestArchive,
  searchStudentTestArchive,
  teacherReportCsvUrl,
  runDailyRollup,
  type ReportPeriod,
  type TeacherReportRow,
  type ReportSummary,
  type ReportFacets,
  type StudentArchiveSearchHit,
} from '../../utils/analyticsApi';
import { getBackendAccessToken } from '../../utils/backendAuth';
import { DonutChart, HorizontalBarChart, KpiCard } from './AdminDashboardCharts';
import SuperAiReportFilterBar from './SuperAiReportFilterBar';
import ReportTablePagination from './ReportTablePagination';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import {
  DEFAULT_TEACHER_FILTERS,
  filtersToApiParams,
  type TeacherFilterState,
} from '../../utils/superAiReportFilters';

const PERIODS: ReportPeriod[] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

type TabId = 'teachers' | 'location' | 'archive' | 'ai';

function tierClass(tier: string): string {
  if (tier === 'active') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (tier === 'sufficient') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (tier === 'low') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-rose-50 text-rose-700 border-rose-200';
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function AdminSuperAiReport() {
  const { t, language } = useUiText();
  const [period, setPeriod] = useState<ReportPeriod>('monthly');
  const [fromDate, setFromDate] = useState('');
  const [tab, setTab] = useState<TabId>('teachers');
  const [loading, setLoading] = useState(false);
  const [teachers, setTeachers] = useState<TeacherReportRow[]>([]);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [rangeLabel, setRangeLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [studentId, setStudentId] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archive, setArchive] = useState<Awaited<ReturnType<typeof fetchStudentTestArchive>> | null>(null);
  const [openAttemptId, setOpenAttemptId] = useState<number | null>(null);

  const [aiLoading, setAiLoading] = useState(false);
  const [narrative, setNarrative] = useState('');
  const [rollupLoading, setRollupLoading] = useState(false);

  const [filters, setFilters] = useState<TeacherFilterState>(DEFAULT_TEACHER_FILTERS);
  const debouncedFilters = useDebouncedValue(filters, 400);
  const [facets, setFacets] = useState<ReportFacets | null>(null);
  const [teacherTotal, setTeacherTotal] = useState(0);
  const [filteredTotal, setFilteredTotal] = useState(0);

  const [archiveQuery, setArchiveQuery] = useState('');
  const debouncedArchiveQuery = useDebouncedValue(archiveQuery, 350);
  const [archiveSuggestions, setArchiveSuggestions] = useState<StudentArchiveSearchHit[]>([]);
  const [archiveSuggestLoading, setArchiveSuggestLoading] = useState(false);

  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(25);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const anchor = fromDate.trim() || undefined;
      const filterParams = filtersToApiParams(debouncedFilters);
      const [teacherRes, summaryRes] = await Promise.all([
        fetchTeacherReport(period, anchor, filterParams),
        fetchReportSummary(period, anchor),
      ]);
      setTeachers(teacherRes.teachers);
      setFacets(teacherRes.facets);
      setTeacherTotal(teacherRes.total);
      setFilteredTotal(teacherRes.filtered_total);
      setSummary(summaryRes);
      setRangeLabel(`${teacherRes.from} — ${teacherRes.to}`);
    } catch (err) {
      console.error(err);
      setError(t('admin.superAi.loadError'));
    } finally {
      setLoading(false);
    }
  }, [period, fromDate, debouncedFilters, t]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    setTablePage(1);
  }, [debouncedFilters, tab, tablePageSize]);

  const tableTotalPages = Math.max(1, Math.ceil(teachers.length / tablePageSize));
  const safeTablePage = Math.min(Math.max(1, tablePage), tableTotalPages);

  const paginatedTeachers = useMemo(() => {
    const start = (safeTablePage - 1) * tablePageSize;
    return teachers.slice(start, start + tablePageSize);
  }, [teachers, safeTablePage, tablePageSize]);

  useEffect(() => {
    const q = debouncedArchiveQuery.trim();
    if (q.length < 2) {
      setArchiveSuggestions([]);
      return;
    }
    let cancelled = false;
    setArchiveSuggestLoading(true);
    void searchStudentTestArchive(q, academicYear.trim() || undefined)
      .then((res) => {
        if (!cancelled) setArchiveSuggestions(res.results);
      })
      .catch(() => {
        if (!cancelled) setArchiveSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setArchiveSuggestLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedArchiveQuery, academicYear]);

  const tierCounts = useMemo(() => {
    const base = { inactive: 0, low: 0, sufficient: 0, active: 0 };
    for (const row of teachers) {
      if (row.tier in base) base[row.tier as keyof typeof base] += 1;
    }
    return base;
  }, [teachers]);

  const tierDonut = useMemo(
    () => [
      { key: 'inactive', label: t('admin.superAi.tierInactive'), value: tierCounts.inactive, color: '#f43f5e' },
      { key: 'low', label: t('admin.superAi.tierLow'), value: tierCounts.low, color: '#f59e0b' },
      { key: 'sufficient', label: t('admin.superAi.tierSufficient'), value: tierCounts.sufficient, color: '#3b82f6' },
      { key: 'active', label: t('admin.superAi.tierActive'), value: tierCounts.active, color: '#10b981' },
    ],
    [tierCounts, t],
  );

  const locationBars = useMemo(() => {
    return [...teachers]
      .sort((a, b) => a.in_geofence_pct - b.in_geofence_pct)
      .slice(0, 12)
      .map((row) => ({
        key: row.owner_key,
        label: row.display_name || row.owner_key,
        value: row.in_geofence_pct,
        sublabel: `${row.in_geofence_pct}%`,
      }));
  }, [teachers]);

  const handleExportCsv = async () => {
    const token = await getBackendAccessToken();
    if (!token) return;
    const url = teacherReportCsvUrl(period, fromDate.trim() || undefined, filtersToApiParams(filters));
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `teacher-report-${period}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleSearchArchive = async () => {
    const sid = studentId.trim();
    if (!sid) return;
    setArchiveLoading(true);
    setError(null);
    try {
      const data = await fetchStudentTestArchive(sid, academicYear.trim() || undefined);
      setArchive(data);
      setOpenAttemptId(data.attempts[0]?.id ?? null);
    } catch (err) {
      console.error(err);
      setError(t('admin.superAi.archiveError'));
    } finally {
      setArchiveLoading(false);
    }
  };

  const handleAiNarrative = async () => {
    setAiLoading(true);
    setError(null);
    try {
      const res = await fetchAiNarrative(period, language);
      setNarrative(res.narrative);
      if (res.summary) setSummary(res.summary);
    } catch (err) {
      console.error(err);
      setError(t('admin.superAi.aiError'));
    } finally {
      setAiLoading(false);
    }
  };

  const handleRollup = async () => {
    setRollupLoading(true);
    try {
      await runDailyRollup(fromDate.trim() || undefined);
      await loadReport();
    } catch (err) {
      console.error(err);
      setError(t('admin.superAi.rollupError'));
    } finally {
      setRollupLoading(false);
    }
  };

  const tabs: { id: TabId; label: string; icon: typeof Users }[] = [
    { id: 'teachers', label: t('admin.superAi.tabTeachers'), icon: Users },
    { id: 'location', label: t('admin.superAi.tabLocation'), icon: MapPin },
    { id: 'archive', label: t('admin.superAi.tabArchive'), icon: Archive },
    { id: 'ai', label: t('admin.superAi.tabAi'), icon: Brain },
  ];

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={22} className="text-violet-600" />
            <h1 className="text-xl sm:text-2xl font-bold text-black/90">{t('admin.superAi.title')}</h1>
          </div>
          <p className="text-[13px] text-black/50">{t('admin.superAi.subtitle')}</p>
          {rangeLabel && <p className="text-[12px] text-black/40 mt-1">{rangeLabel}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as ReportPeriod)}
            className="text-[13px] rounded-xl border border-black/10 bg-white/80 px-3 py-2"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {t(`admin.superAi.period.${p}` as 'admin.superAi.period.daily')}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="text-[13px] rounded-xl border border-black/10 bg-white/80 px-3 py-2"
            title={t('admin.superAi.fromDate')}
          />
          <button
            type="button"
            onClick={() => void loadReport()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl bg-black/5 hover:bg-black/10 px-3 py-2 text-[13px] font-semibold"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {t('admin.superAi.refresh')}
          </button>
          <button
            type="button"
            onClick={() => void handleExportCsv()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 text-[13px] font-semibold"
          >
            <Download size={14} />
            CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-2 text-[13px] font-semibold print:hidden"
          >
            <Download size={14} />
            PDF
          </button>
          <button
            type="button"
            onClick={() => void handleRollup()}
            disabled={rollupLoading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-2 text-[13px] font-semibold"
          >
            {rollupLoading ? <Loader2 size={14} className="animate-spin" /> : null}
            {t('admin.superAi.runRollup')}
          </button>
        </div>
      </div>

      {(tab === 'teachers' || tab === 'location') && (
        <SuperAiReportFilterBar
          filters={filters}
          onChange={setFilters}
          facets={facets}
          total={teacherTotal}
          filteredTotal={filteredTotal}
          loading={loading}
        />
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800 flex items-center gap-2">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label={t('admin.superAi.kpiTeachers')}
            value={summary.teachers_total}
            icon={Users}
            gradient="bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900 border-slate-200/80"
          />
          <KpiCard
            label={t('admin.superAi.kpiAttempts')}
            value={summary.student_attempts}
            icon={ClipboardList}
            gradient="bg-gradient-to-br from-blue-50 to-indigo-100 text-blue-950 border-blue-200/80"
          />
          <KpiCard
            label={t('admin.superAi.kpiAvgScore')}
            value={`${summary.avg_score_pct}%`}
            icon={Sparkles}
            gradient="bg-gradient-to-br from-emerald-50 to-teal-100 text-emerald-950 border-emerald-200/80"
          />
          <KpiCard
            label={t('admin.superAi.kpiInactive')}
            value={summary.teachers_inactive}
            icon={UserX}
            gradient="bg-gradient-to-br from-rose-50 to-orange-100 text-rose-950 border-rose-200/80"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-black/5 pb-2">
        {tabs.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold transition-colors ${
                active ? 'bg-violet-600 text-white' : 'bg-black/5 text-black/70 hover:bg-black/10'
              }`}
            >
              <Icon size={15} />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === 'teachers' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="ios-glass rounded-2xl border border-white/60 p-4 lg:col-span-1">
            <h3 className="text-[13px] font-bold text-black/70 mb-3">{t('admin.superAi.tierChart')}</h3>
            <DonutChart segments={tierDonut} />
          </div>
          <div className="ios-glass rounded-2xl border border-white/60 overflow-hidden lg:col-span-2">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-black/5 bg-black/[0.02] text-left text-black/50">
                    <th className="px-3 py-2 font-semibold">{t('admin.superAi.colName')}</th>
                    <th className="px-3 py-2 font-semibold">{t('admin.superAi.colTier')}</th>
                    <th className="px-3 py-2 font-semibold">{t('admin.superAi.colMinutes')}</th>
                    <th className="px-3 py-2 font-semibold">{t('admin.superAi.colGeofence')}</th>
                    <th className="px-3 py-2 font-semibold">{t('admin.superAi.colContent')}</th>
                    <th className="px-3 py-2 font-semibold">{t('admin.superAi.colFlags')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-black/40">
                        <Loader2 size={20} className="animate-spin inline-block" />
                      </td>
                    </tr>
                  ) : teachers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-black/40">
                        {t('admin.superAi.noData')}
                      </td>
                    </tr>
                  ) : (
                    paginatedTeachers.map((row) => (
                      <tr key={row.owner_key} className="border-b border-black/5 hover:bg-white/40">
                        <td className="px-3 py-2.5">
                          <p className="font-semibold text-black/85">{row.display_name || row.owner_key}</p>
                          <p className="text-[11px] text-black/40">{row.department || '—'}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold ${tierClass(row.tier)}`}>
                            {t(`admin.superAi.tier.${row.tier}` as 'admin.superAi.tier.inactive')}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {row.active_minutes_period}
                          <span className="text-black/40 text-[11px]"> / {row.active_minutes_month} {t('admin.superAi.perMonth')}</span>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{row.in_geofence_pct}%</td>
                        <td className="px-3 py-2.5 text-[11px] text-black/60">
                          {row.cases_created}K · {row.tests_created}T · {row.live_sessions_count}J
                        </td>
                        <td className="px-3 py-2.5">
                          {row.flags.length === 0 ? (
                            <span className="text-black/30">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {row.flags.map((f) => (
                                <span key={f} className="rounded bg-amber-50 text-amber-800 px-1.5 py-0.5 text-[10px] font-semibold">
                                  {t(`admin.superAi.flag.${f}` as 'admin.superAi.flag.no_cases')}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <ReportTablePagination
              page={safeTablePage}
              pageSize={tablePageSize}
              total={teachers.length}
              onPageChange={setTablePage}
              onPageSizeChange={setTablePageSize}
            />
          </div>
        </div>
      )}

      {tab === 'location' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="ios-glass rounded-2xl border border-white/60 p-4">
            <h3 className="text-[13px] font-bold text-black/70 mb-3">{t('admin.superAi.geofenceChart')}</h3>
            <HorizontalBarChart items={locationBars} maxItems={12} />
          </div>
          <div className="ios-glass rounded-2xl border border-white/60 overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-black/5 bg-black/[0.02] text-left text-black/50">
                  <th className="px-3 py-2">{t('admin.superAi.colName')}</th>
                  <th className="px-3 py-2">{t('admin.superAi.colGeofence')}</th>
                  <th className="px-3 py-2">{t('admin.superAi.colAlerts')}</th>
                  <th className="px-3 py-2">{t('admin.superAi.colPings')}</th>
                </tr>
              </thead>
              <tbody>
                {paginatedTeachers.map((row) => (
                  <tr key={row.owner_key} className="border-b border-black/5">
                    <td className="px-3 py-2 font-semibold">{row.display_name || row.owner_key}</td>
                    <td className="px-3 py-2 tabular-nums">{row.in_geofence_pct}%</td>
                    <td className="px-3 py-2 tabular-nums">{row.alerts_count}</td>
                    <td className="px-3 py-2 tabular-nums">{row.pings_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ReportTablePagination
              page={safeTablePage}
              pageSize={tablePageSize}
              total={teachers.length}
              onPageChange={setTablePage}
              onPageSizeChange={setTablePageSize}
            />
          </div>
        </div>
      )}

      {tab === 'archive' && (
        <div className="space-y-4">
          <div className="ios-glass rounded-2xl border border-white/60 p-4 space-y-3">
            <label className="text-[11px] font-semibold text-black/50 block">{t('admin.superAi.archiveSmartSearch')}</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/35" />
              <input
                value={archiveQuery}
                onChange={(e) => {
                  setArchiveQuery(e.target.value);
                  setStudentId(e.target.value);
                }}
                placeholder={t('admin.superAi.archiveSmartPlaceholder')}
                className="w-full rounded-xl border border-black/10 pl-9 pr-3 py-2.5 text-[13px]"
              />
              {archiveSuggestLoading && (
                <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-black/30" />
              )}
              {archiveSuggestions.length > 0 && archiveQuery.trim().length >= 2 && (
                <ul className="absolute z-20 mt-1 w-full rounded-xl border border-black/10 bg-white shadow-lg max-h-56 overflow-y-auto">
                  {archiveSuggestions.map((hit) => (
                    <li key={hit.student_id}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2.5 hover:bg-violet-50 border-b border-black/5 last:border-0"
                        onClick={() => {
                          setStudentId(hit.student_id);
                          setArchiveQuery(`${hit.first_name} ${hit.last_name}`.trim() || hit.student_id);
                          setArchiveSuggestions([]);
                          void (async () => {
                            setArchiveLoading(true);
                            try {
                              const data = await fetchStudentTestArchive(
                                hit.student_id,
                                academicYear.trim() || undefined,
                              );
                              setArchive(data);
                              setOpenAttemptId(data.attempts[0]?.id ?? null);
                            } catch {
                              setError(t('admin.superAi.archiveError'));
                            } finally {
                              setArchiveLoading(false);
                            }
                          })();
                        }}
                      >
                        <p className="text-[13px] font-semibold text-black/85">
                          {hit.first_name} {hit.last_name}
                        </p>
                        <p className="text-[11px] text-black/45">
                          ID {hit.student_id} · {hit.attempts_count} {t('admin.superAi.attempts')}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="text-[11px] font-semibold text-black/50 block mb-1">{t('admin.studentReportSearchTitle')}</label>
              <input
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                placeholder={t('admin.studentReportSearchPlaceholder')}
                className="w-full rounded-xl border border-black/10 px-3 py-2 text-[13px]"
              />
            </div>
            <div className="min-w-[160px]">
              <label className="text-[11px] font-semibold text-black/50 block mb-1">{t('admin.superAi.academicYear')}</label>
              <input
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                placeholder="2025-2026"
                className="w-full rounded-xl border border-black/10 px-3 py-2 text-[13px]"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSearchArchive()}
              disabled={archiveLoading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 text-[13px] font-semibold"
            >
              {archiveLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {t('admin.studentReportSearchAction')}
            </button>
            </div>
          </div>

          {archive && !archive.found && (
            <p className="text-[13px] text-black/50">{t('admin.studentReportNotFound', { id: studentId })}</p>
          )}

          {archive?.found && (
            <div className="space-y-3">
              <p className="text-[13px] font-semibold text-black/70">
                {archive.first_name} {archive.last_name} · {archive.student_id} · {archive.attempts.length}{' '}
                {t('admin.superAi.attempts')}
              </p>
              {archive.attempts.map((attempt) => {
                const open = openAttemptId === attempt.id;
                return (
                  <div key={attempt.id} className="ios-glass rounded-2xl border border-white/60 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenAttemptId(open ? null : attempt.id)}
                      className="w-full text-left px-4 py-3 flex items-center gap-2 hover:bg-white/40"
                    >
                      {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <span className="font-semibold text-[13px] flex-1 truncate">{attempt.topic}</span>
                      <span className="text-[12px] text-black/50">{attempt.subject_code}</span>
                      <span className="text-[12px] font-bold text-emerald-700">
                        {attempt.score}/{attempt.total}
                      </span>
                      <span className="text-[11px] text-black/40">{formatWhen(attempt.submitted_at)}</span>
                    </button>
                    {open && (
                      <div className="border-t border-black/5 p-4 space-y-4">
                        <div>
                          <h4 className="text-[12px] font-bold text-black/60 mb-2">{t('admin.superAi.questions')}</h4>
                          <ul className="space-y-2">
                            {attempt.questions.map((q) => (
                              <li key={q.index} className="rounded-xl bg-white/50 border border-black/5 p-3 text-[12px]">
                                <p className="font-semibold text-black/80 mb-1">
                                  {q.index + 1}. {q.question}
                                </p>
                                <p className="text-black/50">
                                  {t('admin.superAi.selected')}:{' '}
                                  {q.selected_index != null && q.selected_index >= 0
                                    ? q.options[q.selected_index] ?? `#${q.selected_index}`
                                    : '—'}
                                  {' · '}
                                  {t('admin.superAi.correct')}:{' '}
                                  {q.correct_index != null && q.correct_index >= 0
                                    ? q.options[q.correct_index] ?? `#${q.correct_index}`
                                    : '—'}
                                </p>
                              </li>
                            ))}
                          </ul>
                        </div>
                        {attempt.timeline.length > 0 && (
                          <div>
                            <h4 className="text-[12px] font-bold text-black/60 mb-2">{t('admin.superAi.timeline')}</h4>
                            <ul className="space-y-1 max-h-64 overflow-y-auto text-[11px] font-mono text-black/60">
                              {attempt.timeline.map((ev, i) => (
                                <li key={i}>
                                  {formatWhen(ev.occurred_at)} · {ev.event_type}
                                  {ev.question_index != null ? ` · Q${ev.question_index + 1}` : ''}
                                  {ev.option_index != null ? ` · opt ${ev.option_index}` : ''}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'ai' && (
        <div className="ios-glass rounded-2xl border border-white/60 p-4 space-y-4">
          <p className="text-[13px] text-black/50">{t('admin.superAi.aiHint')}</p>
          <button
            type="button"
            onClick={() => void handleAiNarrative()}
            disabled={aiLoading}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 text-[13px] font-semibold"
          >
            {aiLoading ? <Loader2 size={16} className="animate-spin" /> : <Brain size={16} />}
            {t('admin.superAi.generateAi')}
          </button>
          {narrative && (
            <div className="rounded-xl bg-white/60 border border-black/5 p-4 text-[13px] text-black/80 whitespace-pre-wrap leading-relaxed">
              {narrative}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
