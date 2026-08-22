import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  RefreshCw,
  Loader2,
  ArrowLeft,
  Search,
  GraduationCap,
  Users,
  UserSearch,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  X,
  Download,
  Trophy,
  Percent,
  BookOpen,
  Radio,
  Lock,
} from 'lucide-react';
import {
  fetchAdminLiveTestStats,
  fetchAdminLiveTestSessions,
  fetchAdminLiveTestSubmissions,
  fetchStudentLiveTestReport,
  type AdminLiveTestStatRow,
  type AdminLiveTestSessionRow,
  type AdminLiveTestSubmissionRow,
  type StudentLiveTestReport,
  type StudentReportSubjectRow,
} from '../../utils/liveTestApi';
import { useUiText } from '../../i18n/useUiText';
import type { UiTextKey } from '../../i18n/translations';

function formatWhen(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
}

// ---- Baho bandlari: 5 ballik tizimga mos foiz oraliqlari. ----
type GradeBand = 'excellent' | 'good' | 'satisfactory' | 'fail';

const PASS_PCT = 60;

function gradeBand(pct: number): GradeBand {
  if (pct >= 86) return 'excellent';
  if (pct >= 71) return 'good';
  if (pct >= PASS_PCT) return 'satisfactory';
  return 'fail';
}

const BAND_STYLE: Record<GradeBand, { chip: string; bar: string; dot: string }> = {
  excellent: { chip: 'bg-emerald-50 text-emerald-700', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  good: { chip: 'bg-sky-50 text-sky-700', bar: 'bg-sky-500', dot: 'bg-sky-500' },
  satisfactory: { chip: 'bg-amber-50 text-amber-700', bar: 'bg-amber-500', dot: 'bg-amber-500' },
  fail: { chip: 'bg-rose-50 text-rose-700', bar: 'bg-rose-500', dot: 'bg-rose-500' },
};

const BAND_KEY: Record<GradeBand, UiTextKey> = {
  excellent: 'admin.gradeExcellent',
  good: 'admin.gradeGood',
  satisfactory: 'admin.gradeSatisfactory',
  fail: 'admin.gradeFail',
};

const BAND_ORDER: GradeBand[] = ['excellent', 'good', 'satisfactory', 'fail'];

function StatTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="ios-glass rounded-2xl border border-white/60 px-4 py-3 min-w-0">
      <p className="text-[11px] font-semibold text-black/45 flex items-center gap-1.5 truncate">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-[22px] font-bold text-black/90 tabular-nums leading-none">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-black/40 truncate">{hint}</p>}
    </div>
  );
}

/** Ball ustuni — ko'p qatorni ko'z bilan tez solishtirish uchun. */
function ScoreBar({ pct }: { pct: number }) {
  const band = gradeBand(pct);
  return (
    <div className="h-1.5 w-16 rounded-full bg-black/10 overflow-hidden shrink-0" aria-hidden="true">
      <div className={`h-full rounded-full ${BAND_STYLE[band].bar}`} style={{ width: `${Math.max(2, pct)}%` }} />
    </div>
  );
}

function GradeDistribution({
  dist,
  total,
  t,
}: {
  dist: Record<GradeBand, number>;
  total: number;
  t: (k: UiTextKey) => string;
}) {
  if (total <= 0) return null;
  return (
    <div className="ios-glass rounded-2xl border border-white/60 p-4">
      <p className="text-[11px] font-semibold text-black/45 mb-2.5">{t('admin.resultsDistribution')}</p>
      <div
        className="flex h-2.5 rounded-full overflow-hidden bg-black/5"
        role="img"
        aria-label={t('admin.resultsDistribution')}
      >
        {BAND_ORDER.map((band) =>
          dist[band] > 0 ? (
            <div
              key={band}
              className={BAND_STYLE[band].bar}
              style={{ width: `${(dist[band] / total) * 100}%` }}
              title={`${t(BAND_KEY[band])}: ${dist[band]}`}
            />
          ) : null,
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {BAND_ORDER.map((band) => (
          <span key={band} className="inline-flex items-center gap-1.5 text-[11.5px] text-black/60">
            <span className={`w-2 h-2 rounded-full ${BAND_STYLE[band].dot}`} />
            {t(BAND_KEY[band])}
            <b className="text-black/80 tabular-nums">{dist[band]}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Excel Cyrillic/lotin harflarni to'g'ri ochishi uchun BOM bilan yoziladi. */
function downloadCsv(filename: string, rows: string[][]): void {
  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function StudentSubjectCard({ subject }: { subject: StudentReportSubjectRow }) {
  const { t } = useUiText();
  const [open, setOpen] = useState(false);
  const label =
    subject.subjectName ||
    (subject.subjectCode === '__unassigned__' ? t('admin.liveTestUnassignedSubject') : subject.subjectCode);
  const missed = subject.totalSessions - subject.takenSessions;

  return (
    <div className="ios-glass rounded-2xl border border-white/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left p-4 flex items-center gap-3 hover:bg-white/40 transition-colors"
      >
        {open ? (
          <ChevronDown size={16} className="text-black/40 shrink-0" />
        ) : (
          <ChevronRight size={16} className="text-black/40 shrink-0" />
        )}
        <GraduationCap size={16} className="text-indigo-600 shrink-0" />
        <span className="font-bold text-black/90 truncate flex-1">{label}</span>
        <span className="shrink-0 text-[12px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
          {t('admin.studentReportSolved')} {subject.takenSessions}
        </span>
        {missed > 0 && (
          <span className="shrink-0 text-[12px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">
            {t('admin.studentReportMissed')} {missed}
          </span>
        )}
        {subject.avgScorePct != null && (
          <span
            className={`shrink-0 text-[12px] font-bold px-2 py-0.5 rounded-full ${
              BAND_STYLE[gradeBand(subject.avgScorePct)].chip
            }`}
          >
            {t('admin.liveTestAvgScore')} {subject.avgScorePct}%
          </span>
        )}
      </button>

      {open && (
        <ul className="border-t border-black/5 divide-y divide-black/5">
          {subject.sessions.map((row) => {
            const pct = row.taken && row.total > 0 ? Math.round(((row.score ?? 0) / row.total) * 100) : null;
            const wrong = row.taken ? Math.max(0, row.total - (row.score ?? 0)) : 0;
            return (
              <li
                key={row.sessionKey}
                className={`flex items-center gap-3 px-4 py-3 ${row.taken ? '' : 'bg-rose-50/40'}`}
              >
                {row.taken ? (
                  <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                ) : (
                  <XCircle size={15} className="text-rose-500 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-black/85 truncate">{row.topic || '—'}</p>
                  <p className="text-[11px] text-black/40">{formatWhen(row.createdAtMs)}</p>
                </div>
                {pct !== null && <ScoreBar pct={pct} />}
                {row.taken ? (
                  <span
                    className={`shrink-0 text-[12px] font-bold px-2 py-0.5 rounded-full tabular-nums ${
                      pct !== null ? BAND_STYLE[gradeBand(pct)].chip : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {row.score ?? 0}/{row.total}
                    {pct !== null ? ` · ${pct}%` : ''}
                  </span>
                ) : (
                  <span className="shrink-0 text-[12px] font-semibold text-rose-600">
                    {t('admin.studentReportMissed')}
                  </span>
                )}
                {row.taken && wrong > 0 && (
                  <span className="shrink-0 text-[11px] text-black/40 tabular-nums">−{wrong}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type Level = 'subjects' | 'sessions' | 'submissions';
type SortKey = 'scoreDesc' | 'scoreAsc' | 'name' | 'time';

const SORT_OPTIONS: Array<{ key: SortKey; labelKey: UiTextKey }> = [
  { key: 'scoreDesc', labelKey: 'admin.sortScoreDesc' },
  { key: 'scoreAsc', labelKey: 'admin.sortScoreAsc' },
  { key: 'name', labelKey: 'admin.sortName' },
  { key: 'time', labelKey: 'admin.sortTime' },
];

export default function AdminLiveTestResultsPage() {
  const { t } = useUiText();
  const [level, setLevel] = useState<Level>('subjects');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [subjects, setSubjects] = useState<AdminLiveTestStatRow[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<AdminLiveTestStatRow | null>(null);

  const [sessions, setSessions] = useState<AdminLiveTestSessionRow[]>([]);
  const [selectedSession, setSelectedSession] = useState<AdminLiveTestSessionRow | null>(null);

  const [submissions, setSubmissions] = useState<AdminLiveTestSubmissionRow[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('scoreDesc');

  // Talaba ID bo'yicha qidiruv — fanlar ro'yxati o'rniga bitta talaba hisoboti.
  const [studentIdQuery, setStudentIdQuery] = useState('');
  const [report, setReport] = useState<StudentLiveTestReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const loadSubjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSubjects(await fetchAdminLiveTestStats());
    } catch {
      setError(t('admin.error.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadSessions = useCallback(
    async (subjectCode: string) => {
      setLoading(true);
      setError(null);
      try {
        setSessions(await fetchAdminLiveTestSessions(subjectCode));
      } catch {
        setError(t('admin.error.loadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  const loadSubmissions = useCallback(
    async (sessionKey: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchAdminLiveTestSubmissions({ sessionKey, pageSize: 200 });
        setSubmissions(res.results);
      } catch {
        setError(t('admin.error.loadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  const searchStudent = useCallback(async () => {
    const id = studentIdQuery.trim();
    if (!id) return;
    setReportLoading(true);
    setError(null);
    try {
      setReport(await fetchStudentLiveTestReport(id));
    } catch {
      setReport(null);
      setError(t('admin.error.loadFailed'));
    } finally {
      setReportLoading(false);
    }
  }, [studentIdQuery, t]);

  const clearStudent = () => {
    setStudentIdQuery('');
    setReport(null);
    setError(null);
  };

  const openSubject = (s: AdminLiveTestStatRow) => {
    setSelectedSubject(s);
    setLevel('sessions');
    void loadSessions(s.subjectCode);
  };

  const openSession = (s: AdminLiveTestSessionRow) => {
    setSelectedSession(s);
    setStudentSearch('');
    setSortKey('scoreDesc');
    setLevel('submissions');
    void loadSubmissions(s.sessionKey);
  };

  const backToSubjects = () => {
    setLevel('subjects');
    setSelectedSubject(null);
    setSessions([]);
  };

  const backToSessions = () => {
    setLevel('sessions');
    setSelectedSession(null);
    setSubmissions([]);
  };

  const refresh = () => {
    if (report) void searchStudent();
    else if (level === 'subjects') void loadSubjects();
    else if (level === 'sessions' && selectedSubject) void loadSessions(selectedSubject.subjectCode);
    else if (level === 'submissions' && selectedSession) void loadSubmissions(selectedSession.sessionKey);
  };

  const subjectLabel = (row: AdminLiveTestStatRow) =>
    row.subjectName || (row.subjectCode === '__unassigned__' ? t('admin.liveTestUnassignedSubject') : row.subjectCode);

  /** Fanlar darajasidagi umumiy ko'rsatkich. Talabalar soni fanlar bo'yicha
   *  qo'shilmaydi — bitta talaba bir necha fanda uchraydi, yig'indi noto'g'ri
   *  bo'lardi; shuning uchun faqat fan va topshiriq soni ko'rsatiladi. */
  const subjectsOverview = useMemo(() => {
    if (subjects.length === 0) return null;
    const totalSubmissions = subjects.reduce((n, s) => n + s.submissionCount, 0);
    const scored = subjects.filter((s) => s.avgScorePct != null);
    const avg = scored.length
      ? Math.round(scored.reduce((n, s) => n + (s.avgScorePct as number), 0) / scored.length)
      : null;
    return { subjectCount: subjects.length, totalSubmissions, avg };
  }, [subjects]);

  /** Bitta sessiya bo'yicha statistika — ballar mavjud topshiriqlardan. */
  const sessionOverview = useMemo(() => {
    const scored = submissions.filter((s) => s.total > 0);
    if (scored.length === 0) return null;
    const pcts = scored.map((s) => Math.round((s.score / s.total) * 100));
    const dist: Record<GradeBand, number> = { excellent: 0, good: 0, satisfactory: 0, fail: 0 };
    pcts.forEach((p) => {
      dist[gradeBand(p)] += 1;
    });
    const passed = pcts.filter((p) => p >= PASS_PCT).length;
    return {
      count: scored.length,
      avg: Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length),
      top: Math.max(...pcts),
      passRate: Math.round((passed / pcts.length) * 100),
      passed,
      dist,
    };
  }, [submissions]);

  const filteredSubmissions = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    const base = q
      ? submissions.filter(
          (s) =>
            s.studentId.toLowerCase().includes(q) ||
            `${s.firstName} ${s.lastName}`.toLowerCase().includes(q),
        )
      : submissions;

    const pctOf = (s: AdminLiveTestSubmissionRow) => (s.total > 0 ? s.score / s.total : -1);
    const sorted = [...base];
    if (sortKey === 'scoreDesc') sorted.sort((a, b) => pctOf(b) - pctOf(a));
    else if (sortKey === 'scoreAsc') sorted.sort((a, b) => pctOf(a) - pctOf(b));
    else if (sortKey === 'name')
      sorted.sort((a, b) =>
        `${a.firstName} ${a.lastName}`.trim().localeCompare(`${b.firstName} ${b.lastName}`.trim()),
      );
    else sorted.sort((a, b) => b.submittedAt - a.submittedAt);
    return sorted;
  }, [submissions, studentSearch, sortKey]);

  const exportSubmissions = () => {
    const rows: string[][] = [
      ['#', 'ID', t('admin.sortName'), t('admin.resultsAverage'), '%', t('admin.sortTime')],
      ...filteredSubmissions.map((row, i) => {
        const pct = row.total > 0 ? Math.round((row.score / row.total) * 100) : null;
        return [
          String(i + 1),
          row.studentId || '',
          `${row.firstName} ${row.lastName}`.trim(),
          `${row.score}/${row.total}`,
          pct === null ? '' : String(pct),
          formatWhen(row.submittedAt),
        ];
      }),
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    const topic = (selectedSession?.topic || 'natijalar').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
    downloadCsv(`${topic}_${stamp}.csv`, rows);
  };

  const headerTitle =
    level === 'subjects'
      ? t('admin.liveTestResultsTab')
      : level === 'sessions'
        ? (selectedSubject ? subjectLabel(selectedSubject) : '')
        : selectedSession?.topic || '';

  const headerSubtitle =
    level === 'subjects'
      ? t('admin.liveTestResultsSubtitle')
      : level === 'sessions'
        ? t('admin.liveTestSessionsSubtitle')
        : formatWhen(selectedSession?.createdAtMs ?? 0);

  return (
    <div className="w-full space-y-6 pb-16 px-3 sm:px-5 lg:px-6 py-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-violet-600 text-white flex items-center justify-center shrink-0">
            <ClipboardList size={24} />
          </div>
          <div className="min-w-0">
            {level !== 'subjects' && (
              <button
                type="button"
                onClick={level === 'sessions' ? backToSubjects : backToSessions}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 hover:text-indigo-700 mb-0.5"
              >
                <ArrowLeft size={13} />
                {level === 'sessions'
                  ? t('admin.liveTestResultsTab')
                  : (selectedSubject ? subjectLabel(selectedSubject) : t('admin.backToSessions'))}
              </button>
            )}
            <h1 className="text-xl font-bold text-black/90 truncate">{headerTitle}</h1>
            <p className="text-[12px] text-black/50 truncate">{headerSubtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {level === 'submissions' && filteredSubmissions.length > 0 && (
            <button
              type="button"
              onClick={exportSubmissions}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-black/10 bg-white text-[13px] font-semibold hover:border-violet-300 transition-colors"
            >
              <Download size={16} /> {t('admin.resultsExportCsv')}
            </button>
          )}
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-black/10 bg-white text-[13px] font-semibold"
          >
            <RefreshCw size={16} /> {t('admin.refresh')}
          </button>
        </div>
      </div>

      {/* Talaba ID bo'yicha qidiruv — fanlar darajasida doim ko'rinadi. */}
      {level === 'subjects' && (
        <div className="ios-glass rounded-2xl border border-white/60 p-4 space-y-2">
          <p className="text-[12px] font-semibold text-black/60 flex items-center gap-1.5">
            <UserSearch size={14} className="text-violet-600" />
            {t('admin.studentReportSearchTitle')}
          </p>
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={studentIdQuery}
                onChange={(e) => setStudentIdQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void searchStudent();
                }}
                placeholder={t('admin.studentReportSearchPlaceholder')}
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 bg-white text-[13px]"
              />
            </div>
            <button
              type="button"
              onClick={() => void searchStudent()}
              disabled={!studentIdQuery.trim() || reportLoading}
              className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-violet-600 text-white text-[13px] font-semibold disabled:opacity-40"
            >
              {reportLoading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              {t('admin.studentReportSearchAction')}
            </button>
            {report && (
              <button
                type="button"
                onClick={clearStudent}
                className="inline-flex items-center gap-1.5 px-3 h-10 rounded-xl border border-black/10 bg-white text-[13px] font-semibold text-black/60"
              >
                <X size={15} />
                {t('admin.studentReportClear')}
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-[13px] text-rose-600 font-medium">{error}</p>}

      {reportLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-violet-600" size={40} />
        </div>
      ) : report ? (
        !report.found ? (
          <div className="ios-glass rounded-2xl border p-10 text-center text-black/45 text-[14px]">
            {t('admin.studentReportNotFound', { id: report.studentId })}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="ios-glass rounded-2xl border border-white/60 p-4 flex items-center gap-3 flex-wrap">
              <div className="w-10 h-10 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
                <UserSearch size={20} />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-black/90 truncate">
                  {`${report.firstName} ${report.lastName}`.trim() || report.studentId}
                </p>
                <p className="text-[12px] text-black/45">ID: {report.studentId}</p>
              </div>
              <div className="ml-auto flex items-center gap-2 text-[12px] flex-wrap">
                <span className="font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full tabular-nums">
                  {t('admin.studentReportSolved')}{' '}
                  {report.subjects.reduce((n, x) => n + x.takenSessions, 0)}
                </span>
                <span className="font-semibold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-full tabular-nums">
                  {t('admin.studentReportMissed')}{' '}
                  {report.subjects.reduce((n, x) => n + (x.totalSessions - x.takenSessions), 0)}
                </span>
              </div>
            </div>
            {report.subjects.map((sub) => (
              <StudentSubjectCard key={sub.subjectCode} subject={sub} />
            ))}
          </div>
        )
      ) : loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-indigo-600" size={40} />
        </div>
      ) : level === 'subjects' ? (
        subjects.length === 0 ? (
          <div className="ios-glass rounded-2xl border p-10 text-center text-black/45 text-[14px]">
            {t('admin.noResults')}
          </div>
        ) : (
          <div className="space-y-4">
            {subjectsOverview && (
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
                <StatTile
                  icon={<BookOpen size={13} />}
                  label={t('admin.resultsSubjectsCount')}
                  value={String(subjectsOverview.subjectCount)}
                />
                <StatTile
                  icon={<ClipboardList size={13} />}
                  label={t('admin.resultsSubmissions')}
                  value={String(subjectsOverview.totalSubmissions)}
                />
                <StatTile
                  icon={<Percent size={13} />}
                  label={t('admin.resultsAverage')}
                  value={subjectsOverview.avg == null ? '—' : `${subjectsOverview.avg}%`}
                />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {subjects.map((s) => (
                <button
                  key={s.subjectCode}
                  type="button"
                  onClick={() => openSubject(s)}
                  className="text-left ios-glass rounded-2xl border border-white/60 p-4 hover:border-indigo-300 hover:shadow-md transition-all"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <GraduationCap size={16} className="text-indigo-600 shrink-0" />
                    <span className="font-bold text-black/90 truncate">{subjectLabel(s)}</span>
                  </div>
                  {s.department && <p className="text-[11px] text-black/40 mb-2">{s.department}</p>}
                  <div className="flex items-center gap-3 text-[12px] text-black/60">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <ClipboardList size={12} /> {s.submissionCount} {t('admin.liveTestResultsCount')}
                    </span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Users size={12} /> {s.studentCount} {t('admin.dashboardLiveTestStudents')}
                    </span>
                  </div>
                  {s.avgScorePct != null && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <ScoreBar pct={s.avgScorePct} />
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums ${
                          BAND_STYLE[gradeBand(s.avgScorePct)].chip
                        }`}
                      >
                        {t('admin.liveTestAvgScore')} {s.avgScorePct}%
                      </span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )
      ) : level === 'sessions' ? (
        sessions.length === 0 ? (
          <div className="ios-glass rounded-2xl border p-10 text-center text-black/45 text-[14px]">
            {t('admin.noResults')}
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((sess) => (
              <button
                key={sess.sessionKey}
                type="button"
                onClick={() => openSession(sess)}
                className="w-full text-left ios-glass rounded-2xl border border-white/60 p-4 flex items-center justify-between gap-3 hover:border-indigo-300 hover:shadow-md transition-all"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="font-semibold text-black/90 truncate">{sess.topic || '—'}</p>
                    <span
                      className={`shrink-0 inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${
                        sess.isClosed ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {sess.isClosed ? <Lock size={10} /> : <Radio size={10} />}
                      {sess.isClosed ? t('admin.sessionClosed') : t('admin.sessionOpen')}
                    </span>
                  </div>
                  <p className="text-[12px] text-black/45 mt-1">{formatWhen(sess.createdAtMs)}</p>
                </div>
                <span className="shrink-0 text-[12px] font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full tabular-nums">
                  {sess.submissionCount} {t('admin.dashboardLiveTestStudents')}
                </span>
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-4">
          {sessionOverview && (
            <>
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                <StatTile
                  icon={<Users size={13} />}
                  label={t('admin.dashboardLiveTestStudents')}
                  value={String(sessionOverview.count)}
                />
                <StatTile
                  icon={<Percent size={13} />}
                  label={t('admin.resultsAverage')}
                  value={`${sessionOverview.avg}%`}
                />
                <StatTile
                  icon={<CheckCircle2 size={13} />}
                  label={t('admin.resultsPassRate')}
                  value={`${sessionOverview.passRate}%`}
                  hint={`${sessionOverview.passed}/${sessionOverview.count}`}
                />
                <StatTile
                  icon={<Trophy size={13} />}
                  label={t('admin.resultsTopScore')}
                  value={`${sessionOverview.top}%`}
                />
              </div>
              <GradeDistribution dist={sessionOverview.dist} total={sessionOverview.count} t={t} />
            </>
          )}

          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder={t('admin.liveTestSearchStudent')}
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 bg-white text-[13px]"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-[12px] text-black/50">
              {t('admin.resultsSortBy')}
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-[13px] font-medium text-black/80"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {t(o.labelKey)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {filteredSubmissions.length === 0 ? (
            <div className="ios-glass rounded-2xl border p-10 text-center text-black/45 text-[14px]">
              {t('admin.noResults')}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredSubmissions.map((row, i) => {
                const pct = row.total > 0 ? Math.round((row.score / row.total) * 100) : null;
                return (
                  <div
                    key={row.id}
                    className="ios-glass rounded-2xl border border-white/60 p-4 flex items-center gap-3"
                  >
                    <span className="shrink-0 w-7 text-[12px] font-bold text-black/30 tabular-nums text-right">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-black/90 truncate">
                        {`${row.firstName} ${row.lastName}`.trim() || row.studentId || '—'}
                      </p>
                      <p className="text-[12px] text-black/45 mt-0.5 truncate">
                        {row.studentId ? `ID: ${row.studentId} · ` : ''}
                        {formatWhen(row.submittedAt)}
                      </p>
                    </div>
                    {pct !== null && <ScoreBar pct={pct} />}
                    {row.total > 0 ? (
                      <span
                        className={`shrink-0 text-sm font-bold px-2.5 py-1 rounded-full tabular-nums ${
                          pct !== null ? BAND_STYLE[gradeBand(pct)].chip : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {row.score}/{row.total}
                        {pct !== null ? ` · ${pct}%` : ''}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[12px] text-black/35">{t('admin.resultsNoScore')}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
