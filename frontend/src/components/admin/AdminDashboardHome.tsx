import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  BriefcaseMedical,
  ClipboardList,
  RefreshCw,
  LogIn,
  BookOpen,
  Building2,
  GraduationCap,
  Clock,
  Sparkles,
  TrendingUp,
  Layers,
} from 'lucide-react';
import { motion } from 'motion/react';
import { fetchAdminCatalogStats, type CatalogStats } from '../../utils/contentCatalogApi';
import { fetchStaffDirectory } from '../../utils/staffDirectoryApi';
import { fetchAcademicCatalog } from '../../utils/academicCatalogApi';
import { fetchAdminLiveTestStats, type AdminLiveTestStatRow } from '../../utils/liveTestApi';
import { useUiText } from '../../i18n/useUiText';
import {
  DonutChart,
  HorizontalBarChart,
  KpiCard,
  TrendBars,
} from './AdminDashboardCharts';

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function formatRelativeTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return locale.startsWith('ru') ? 'hozir' : locale.startsWith('en') ? 'now' : 'hozir';
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d`;
}

function CatalogHeroStat({
  value,
  label,
  icon: Icon,
  className,
}: {
  value: number;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  className: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${className}`}>
      <div className="flex items-center gap-2 mb-2 opacity-80">
        <Icon size={18} />
        <span className="text-[11px] sm:text-[12px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-3xl sm:text-4xl font-bold tabular-nums leading-none">{value.toLocaleString()}</p>
    </div>
  );
}

/**
 * Administrator bosh sahifasi — server statistikasi, chartlar va katalog ko‘rsatkichlari.
 */
export default function AdminDashboardHome() {
  const { t, language } = useUiText();
  const [loading, setLoading] = useState(true);
  const [staffCount, setStaffCount] = useState(0);
  const [teacherCount, setTeacherCount] = useState(0);
  const [todayLogins, setTodayLogins] = useState(0);
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [catalogStats, setCatalogStats] = useState<SyllabusCatalogStats | null>(null);
  const [liveTestStats, setLiveTestStats] = useState<AdminLiveTestStatRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [staff, catalogContentStats, syllabusStats, testStats, academicCatalog] = await Promise.all([
        fetchStaffDirectory().catch(() => []),
        fetchAdminCatalogStats().catch(() => null),
        fetchAdminSyllabusCatalogStats().catch(() => null),
        fetchAdminLiveTestStats().catch(() => []),
        fetchAcademicCatalog().catch(() => null),
      ]);
      setStaffCount(staff.length);
      setTeacherCount(staff.filter((s) => String(s.role || '') === 'hodim').length);
      setTodayLogins(staff.filter((s) => isToday(s.last_login)).length);
      setStats(catalogContentStats);
      const apiKafedra = (academicCatalog?.kafedralar || []).filter((k) => (k.name || '').trim()).length;
      if (syllabusStats) {
        setCatalogStats({
          ...syllabusStats,
          departments_count: apiKafedra || syllabusStats.departments_count,
        });
      } else if (apiKafedra) {
        setCatalogStats({
          departments_count: apiKafedra,
          subjects_count: 0,
          subjects_total: 0,
          variants_count: 0,
          topics_count: 0,
          by_department: [],
        });
      } else {
        setCatalogStats(syllabusStats);
      }
      setLiveTestStats(testStats);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = stats?.totals;

  const deptBars = useMemo(
    () =>
      (catalogStats?.by_department ?? []).map((row) => ({
        key: row.code || row.name,
        label: row.name,
        value: row.subjects_count,
        sublabel: `${row.subjects_count} ${t('admin.dashboardFan').toLowerCase()}`,
      })),
    [catalogStats?.by_department, t],
  );

  const subjectBars = useMemo(
    () =>
      (stats?.by_subject ?? []).map((row) => ({
        key: row.subject_code || row.subject_name,
        label: row.subject_name || row.subject_code || '—',
        value: row.total_count,
        sublabel: `${row.test_count} ${t('admin.statsTestsShort')} · ${row.case_count} keys`,
      })),
    [stats?.by_subject, t],
  );

  const authorBars = useMemo(
    () =>
      (stats?.by_author ?? []).map((row) => ({
        key: row.owner_key,
        label: row.author_display_name || row.owner_key,
        value: row.total_count,
        sublabel: `${row.questions_total} ${t('admin.statsQuestions').toLowerCase()}`,
      })),
    [stats?.by_author, t],
  );

  const liveTestBars = useMemo(
    () =>
      liveTestStats.map((row) => ({
        key: row.subjectCode,
        label: row.subjectName || row.subjectCode,
        value: row.submissionCount,
        sublabel:
          `${row.studentCount} ${t('admin.dashboardLiveTestStudents').toLowerCase()}` +
          (row.avgScorePct != null ? ` · ${row.avgScorePct}%` : ''),
      })),
    [liveTestStats, t],
  );

  const locale = language === 'ru' ? 'ru-RU' : language === 'en' ? 'en-US' : 'uz-UZ';

  return (
    <div className="w-full space-y-6 pb-16 px-3 sm:px-5 lg:px-6 py-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 text-white flex items-center justify-center shadow-lg shadow-slate-900/20">
            <LayoutDashboard size={30} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-black/90 tracking-tight">{t('admin.dashboardTitle')}</h1>
            <p className="text-[13px] text-black/50 font-medium">{t('admin.dashboardSubtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-black/10 bg-white/90 text-[13px] font-semibold text-black/70 shadow-sm disabled:opacity-50 hover:bg-white transition-colors"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> {t('admin.refresh')}
        </button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.03 }}
        className="ios-glass rounded-2xl border border-white/70 p-4 sm:p-5 shadow-sm space-y-3"
      >
        <div className="flex items-center gap-2">
          <Building2 size={18} className="text-sky-700" />
          <h2 className="font-bold text-[15px] text-slate-900">{t('admin.dashboardHierarchyTitle')}</h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <CatalogHeroStat
            value={catalogStats?.departments_count ?? 0}
            label={t('admin.dashboardKafedra')}
            icon={Building2}
            className="bg-gradient-to-br from-sky-50 to-sky-100 border-sky-200 text-sky-950"
          />
          <CatalogHeroStat
            value={catalogStats?.subjects_count ?? 0}
            label={t('admin.dashboardFan')}
            icon={GraduationCap}
            className="bg-gradient-to-br from-indigo-50 to-indigo-100 border-indigo-200 text-indigo-950"
          />
          <CatalogHeroStat
            value={catalogStats?.variants_count ?? 0}
            label={t('admin.dashboardYonalish')}
            icon={Layers}
            className="bg-gradient-to-br from-violet-50 to-violet-100 border-violet-200 text-violet-950"
          />
          <CatalogHeroStat
            value={catalogStats?.topics_count ?? 0}
            label={t('admin.dashboardMavzu')}
            icon={BookOpen}
            className="bg-gradient-to-br from-fuchsia-50 to-fuchsia-100 border-fuchsia-200 text-fuchsia-950"
          />
        </div>
        {loading && !catalogStats ? (
          <p className="text-[12px] text-slate-400 text-center">{t('admin.dashboardLoading')}</p>
        ) : null}
      </motion.div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={t('admin.registeredUsers')}
          value={staffCount}
          hint={`${teacherCount} ${t('admin.hodimRole')} · ${todayLogins} ${t('admin.todayLogins').toLowerCase()}`}
          icon={Users}
          gradient="bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900 border-slate-200/80"
          delay={0}
        />
        <KpiCard
          label={t('admin.testRecords')}
          value={totals?.test_count ?? 0}
          hint={`${totals?.questions_total ?? 0} ${t('admin.statsQuestions').toLowerCase()}`}
          icon={ClipboardList}
          gradient="bg-gradient-to-br from-blue-50 to-indigo-100 text-blue-950 border-blue-200/80"
          delay={50}
        />
        <KpiCard
          label={t('admin.caseRecords')}
          value={totals?.case_count ?? 0}
          icon={BriefcaseMedical}
          gradient="bg-gradient-to-br from-emerald-50 to-teal-100 text-emerald-950 border-emerald-200/80"
          delay={100}
        />
        <KpiCard
          label={t('admin.todayLogins')}
          value={todayLogins}
          icon={LogIn}
          gradient="bg-gradient-to-br from-amber-50 to-orange-100 text-amber-950 border-amber-200/80"
          delay={150}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="ios-glass rounded-2xl border border-white/70 p-5 shadow-sm lg:col-span-1"
        >
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={18} className="text-indigo-600" />
            <h2 className="font-bold text-[15px] text-slate-900">{t('admin.dashboardContentMix')}</h2>
          </div>
          {totals ? (
            <DonutChart
              segments={[
                { key: 'test', label: t('admin.testRecords'), value: totals.test_count, color: '#4f46e5' },
                { key: 'case', label: t('admin.caseRecords'), value: totals.case_count, color: '#059669' },
              ]}
              centerValue={totals.total_count}
              centerLabel={t('admin.dashboardTotalContent')}
            />
          ) : (
            <p className="text-[13px] text-slate-400 py-8 text-center">{t('admin.dashboardLoading')}</p>
          )}
          {totals ? (
            <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-emerald-50/80 px-3 py-2">
                <p className="text-[10px] font-bold uppercase text-emerald-700/70">{t('admin.dashboardPublished')}</p>
                <p className="text-lg font-bold text-emerald-900 tabular-nums">{totals.published_count}</p>
              </div>
              <div className="rounded-xl bg-amber-50/80 px-3 py-2">
                <p className="text-[10px] font-bold uppercase text-amber-800/70">{t('admin.statsPendingPublish')}</p>
                <p className="text-lg font-bold text-amber-900 tabular-nums">{totals.pending_publish_count}</p>
              </div>
            </div>
          ) : null}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="ios-glass rounded-2xl border border-white/70 p-5 shadow-sm lg:col-span-1"
        >
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={18} className="text-violet-600" />
            <h2 className="font-bold text-[15px] text-slate-900">{t('admin.dashboardActivityTrend')}</h2>
          </div>
          {totals ? (
            <TrendBars
              items={[
                { key: '7d', label: t('admin.statsLast7d'), value: totals.created_last_7d, color: '#7c3aed' },
                { key: '30d', label: t('admin.statsLast30d'), value: totals.created_last_30d, color: '#6366f1' },
                { key: 'all', label: t('admin.dashboardTotalContent'), value: totals.total_count, color: '#312e81' },
              ]}
            />
          ) : null}
          {totals ? (
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-slate-100 bg-white/70 px-2 py-2">
                <p className="text-[10px] font-bold uppercase text-slate-400">{t('admin.statsAuthors')}</p>
                <p className="text-base font-bold text-slate-900 tabular-nums">{totals.authors_distinct}</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-white/70 px-2 py-2">
                <p className="text-[10px] font-bold uppercase text-slate-400">{t('admin.statsVariants')}</p>
                <p className="text-base font-bold text-slate-900 tabular-nums">{totals.variants_distinct}</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-white/70 px-2 py-2">
                <p className="text-[10px] font-bold uppercase text-slate-400">{t('admin.statsTopics')}</p>
                <p className="text-base font-bold text-slate-900 tabular-nums">{totals.topics_distinct}</p>
              </div>
            </div>
          ) : null}
        </motion.div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="ios-glass rounded-2xl border border-white/70 p-5 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-4">
            <GraduationCap size={18} className="text-indigo-600" />
            <h2 className="font-bold text-[15px] text-slate-900">{t('admin.dashboardTopSubjects')}</h2>
          </div>
          <HorizontalBarChart items={subjectBars} maxItems={8} barColor="#4f46e5" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="ios-glass rounded-2xl border border-white/70 p-5 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-4">
            <Users size={18} className="text-emerald-600" />
            <h2 className="font-bold text-[15px] text-slate-900">{t('admin.dashboardTopAuthors')}</h2>
          </div>
          <HorizontalBarChart items={authorBars} maxItems={8} barColor="#059669" />
        </motion.div>
      </div>

      {deptBars.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="ios-glass rounded-2xl border border-white/70 p-5 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={18} className="text-sky-600" />
            <h2 className="font-bold text-[15px] text-slate-900">{t('admin.dashboardByDepartment')}</h2>
          </div>
          <HorizontalBarChart items={deptBars} maxItems={10} barColor="#0284c7" />
        </motion.div>
      ) : null}

      {liveTestBars.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32 }}
          className="ios-glass rounded-2xl border border-white/70 p-5 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList size={18} className="text-violet-600" />
            <h2 className="font-bold text-[15px] text-slate-900">{t('admin.dashboardLiveTestTitle')}</h2>
          </div>
          <HorizontalBarChart items={liveTestBars} maxItems={10} barColor="#7c3aed" />
        </motion.div>
      ) : null}

      {stats?.recent && stats.recent.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="ios-glass rounded-2xl border border-white/70 p-5 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-4">
            <Clock size={18} className="text-slate-600" />
            <h2 className="font-bold text-[15px] text-slate-900">{t('admin.dashboardRecentActivity')}</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {stats.recent.slice(0, 10).map((item) => (
              <div key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    item.kind === 'test' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {item.kind === 'test' ? <ClipboardList size={16} /> : <BriefcaseMedical size={16} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-slate-900 truncate">{item.topic}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {item.subject_name || '—'}
                    {item.variant_label ? ` · ${item.variant_label}` : ''}
                    {' · '}
                    {item.author_display_name}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px] font-semibold text-slate-500">{formatRelativeTime(item.created_at, locale)}</p>
                  {!item.is_published ? (
                    <span className="inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                      {t('admin.statsPendingBadge')}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      ) : null}

      <p className="text-[12px] text-black/45 text-center max-w-xl mx-auto pt-2">
        {t('admin.dashboardNote', { hodim: t('admin.hodimRole') })}
      </p>
    </div>
  );
}
