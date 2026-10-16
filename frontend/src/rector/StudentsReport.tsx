/**
 * Rektor hisoboti: TALABALAR sahifasi (2026-10-15).
 *
 * O'qituvchilar bo'yicha hisobot alohida, talabalar bo'yicha alohida.
 * Yuqorida aqlli filtr (fakultet, kurs, guruh, fan, qidiruv), pastda
 * talabalar ro'yxati. Talaba tanlansa — uning har bir testi: qaysi kuni,
 * qaysi darsda, qaysi mavzuda, qaysi o'qituvchi o'tgan. Testni ochganda
 * savollarning o'zi va talaba belgilagan javoblar ko'rinadi.
 *
 * Rahbariyat tahlili (rektor: "rektor va boshqarma ko'rishi kerak bo'lgan
 * narsalarni qo'shing", 2026-10-15): qamrov va o'tgan davr bilan
 * solishtirish, 5 ballik baholar taqsimoti, kunlik faollik, kurs va
 * fakultet kesimi, orqada qolgan guruhlar, xavf ostidagi talabalar, test
 * halolligi va o'qituvchilar kesimida natija.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  BookOpenCheck,
  Building2,
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  EyeOff,
  Gauge,
  GraduationCap,
  Hash,
  Layers,
  ListChecks,
  MapPin,
  MonitorCheck,
  Percent,
  Search,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
  UserRound,
  UserX,
  Users,
  X,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  fetchAttemptDetail,
  fetchStudentAttempts,
  fetchStudentFilters,
  fetchStudents,
  fetchStudentsOverview,
  fetchStudentsTrend,
  type AttemptDetail,
  type StudentAttempts,
  type StudentFilters,
  type StudentScope,
  type StudentsOverview,
  type StudentsReport as Report,
  type StudentsTrend,
} from './studentsApi';
import type { ReportFilters } from './rectorApi';
import { useOpenTeacher } from './TeacherProfileContext';
import {
  Avatar,
  Columns,
  CountUp,
  Delta,
  EmptyNote,
  GradeBadge,
  Insights,
  KpiCard,
  Legend,
  Meter,
  Panel,
  Pill,
  Ring,
  Segmented,
  Skeleton,
  StackBar,
  TONE,
  TrendChart,
  toneOf,
  uzDay,
  type Insight,
  type Tone,
} from './RectorViz';

/** "14-okt" ko'rinishidagi qisqa sana — jadval tor bo'lib qolmasin. */
function lastSeen(iso: string | null): string {
  return uzDay(iso);
}

function dayLabel(iso: string): string {
  return uzDay(iso);
}

function weekday(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan'][d.getDay()] || '';
}

/** Foizdan 5 ballik baho — serverdagi qoida bilan bir xil. */
function gradeOf(percent: number | null | undefined): number | null {
  if (percent === null || percent === undefined) return null;
  if (percent >= 86) return 5;
  if (percent >= 71) return 4;
  if (percent >= 55) return 3;
  return 2;
}

const GRADE_TONE: Record<number, Tone> = { 5: 'emerald', 4: 'sky', 3: 'amber', 2: 'rose' };

/** Test topshirganlar ro'yxati Excel'da ochiladigan CSV bo'lib yuklanadi. */
function downloadCsv(rows: Report['students'], name: string) {
  const head = ['F.I.Sh.', 'ID', 'Guruh', 'Kurs', 'Fakultet', 'Yo‘nalish', 'Testlar', 'O‘rtacha %', 'Baho', 'Oxirgi test'];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.join(';')].concat(
    rows.map((r) =>
      [
        r.full_name,
        r.student_id,
        r.group_name,
        r.course ?? '',
        r.faculty,
        r.direction,
        r.attempts,
        r.percent ?? '',
        r.grade ?? gradeOf(r.percent) ?? '',
        r.last_at ? r.last_at.slice(0, 10) : '',
      ]
        .map(esc)
        .join(';'),
    ),
  );
  // BOM — Excel o'zbekcha harflarni to'g'ri ochishi uchun.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Status = 'all' | 'took' | 'never';
const PAGE = 100;

export default function StudentsReport({
  filters,
  onUnauthorized,
  departments = [],
}: {
  filters: ReportFilters;
  onUnauthorized: () => void;
  /** Kafedralar — ustozlar tomonidagi ro'yxatning o'zi (bir xil nomlar). */
  departments?: string[];
}) {
  const [lists, setLists] = useState<StudentFilters | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [overview, setOverview] = useState<StudentsOverview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [overviewBusy, setOverviewBusy] = useState(false);

  const [faculty, setFaculty] = useState('');
  const [group, setGroup] = useState('');
  const [course, setCourse] = useState<number | ''>('');
  const [subject, setSubject] = useState('');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  // Asosiy doira — monitorli xonada dars o'tgan o'qituvchilarning talabalari
  // (rektor talabi, 2026-10-15). "Barcha talabalar" — qiyoslash uchun.
  const [scope, setScope] = useState<StudentScope>('monitor');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [limit, setLimit] = useState(PAGE);

  const [trend, setTrend] = useState<StudentsTrend | null>(null);
  const [trendBusy, setTrendBusy] = useState(false);
  const [student, setStudent] = useState<StudentAttempts | null>(null);
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);

  // Qidiruv har harfda so'rov yubormasin.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    fetchStudentFilters()
      .then(setLists)
      .catch((e) => (/401|403/.test(String(e)) ? onUnauthorized() : setError(String(e))));
  }, [onUnauthorized]);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError('');
    fetchStudents({
      from: filters.from,
      to: filters.to,
      faculty,
      group,
      course: course === '' ? null : course,
      subject_code: subject,
      q: query,
      scope,
      department,
    })
      .then((d) => {
        if (!alive) return;
        setReport(d);
        setLimit(PAGE);
      })
      .catch((e) => {
        if (/401|403/.test(String(e))) onUnauthorized();
        else if (alive) setError(String(e));
      })
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [filters.from, filters.to, filters.refreshKey, faculty, group, course, subject, query, scope, department, onUnauthorized]);

  useEffect(() => {
    let alive = true;
    setOverviewBusy(true);
    fetchStudentsOverview({
      from: filters.from,
      to: filters.to,
      faculty,
      group,
      course: course === '' ? null : course,
      subject_code: subject,
      scope,
      department,
    })
      .then((d) => alive && setOverview(d))
      .catch((e) => {
        if (/401|403/.test(String(e))) onUnauthorized();
        // Tahlil kelmasa ro'yxat baribir ishlaydi — sahifa bo'sh qolmaydi.
        else if (alive) setOverview(null);
      })
      .finally(() => alive && setOverviewBusy(false));
    return () => {
      alive = false;
    };
  }, [filters.from, filters.to, filters.refreshKey, faculty, group, course, subject, scope, department, onUnauthorized]);

  // Haftalik dinamika — har daqiqalik yangilanishga bog'lanmaydi.
  useEffect(() => {
    let alive = true;
    setTrendBusy(true);
    fetchStudentsTrend({
      to: filters.to,
      faculty,
      group,
      course: course === '' ? null : course,
      subject_code: subject,
      scope,
      department,
    })
      .then((d) => alive && setTrend(d))
      .catch((e) => {
        if (/401|403/.test(String(e))) onUnauthorized();
        else if (alive) setTrend(null);
      })
      .finally(() => alive && setTrendBusy(false));
    return () => {
      alive = false;
    };
  }, [filters.to, faculty, group, course, subject, scope, department, onUnauthorized]);

  const groupsForFaculty = useMemo(() => {
    if (!lists) return [];
    if (!faculty) return lists.groups;
    return lists.groups_by_faculty[faculty] || [];
  }, [lists, faculty]);

  const openStudent = (key: string) => {
    setAttempt(null);
    fetchStudentAttempts(key, { from: filters.from, to: filters.to, scope, department })
      .then((d) => {
        setStudent(d);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      })
      .catch((e) => setError(String(e)));
  };

  const pickGroup = (g: string) => {
    setFaculty('');
    setGroup(g);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (attempt) {
    return <AttemptView detail={attempt} onBack={() => setAttempt(null)} />;
  }
  if (student) {
    return (
      <StudentView
        data={student}
        onBack={() => setStudent(null)}
        onOpen={(id) => fetchAttemptDetail(id).then(setAttempt).catch((e) => setError(String(e)))}
      />
    );
  }

  const roster = (report?.students || []).filter((s) =>
    status === 'all' ? true : status === 'took' ? s.attempts > 0 : s.attempts === 0,
  );
  const anyFilter = faculty || group || course !== '' || subject || search || department;

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------- aqlli filtr */}
      <section className="rx-card rx-rise p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className={`flex h-8 w-8 items-center justify-center rounded-xl shadow-md ${TONE.violet.chip}`}>
            <Layers size={15} />
          </span>
          <p className="text-[13.5px] font-bold text-slate-900">Kimni ko‘ramiz?</p>
          <Segmented<StudentScope>
            size="sm"
            value={scope}
            onChange={setScope}
            options={[
              ['monitor', <span key="m" className="inline-flex items-center gap-1.5"><MonitorCheck size={13} /> Monitorli darslar talabalari</span>],
              ['all', <span key="a" className="inline-flex items-center gap-1.5"><Users size={13} /> Barcha talabalar</span>],
            ]}
          />
          {anyFilter && (
            <button
              type="button"
              onClick={() => { setFaculty(''); setGroup(''); setCourse(''); setSubject(''); setSearch(''); setDepartment(''); }}
              className="ml-auto inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-[12.5px] font-semibold text-indigo-600 hover:bg-indigo-50"
            >
              <X size={13} /> Filtrlarni tozalash
            </button>
          )}
        </div>
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-indigo-50/60 px-3 py-2 text-[12px] leading-relaxed text-indigo-900 ring-1 ring-indigo-100">
          <MonitorCheck size={14} className="mt-0.5 shrink-0 text-indigo-500" />
          {scope === 'monitor' ? (
            <span>
              Faqat shu davrda <b>monitorli xonada</b> darsi bo‘lgan guruhlar talabalari va o‘sha guruhga monitorli
              xonada dars o‘tgan o‘qituvchi o‘tkazgan testlar hisobga olinadi. Hisobotdan chiqarilgan kafedralar kirmaydi.
            </span>
          ) : (
            <span>Butun kontingent va barcha testlar — qiyoslash uchun.{department ? ' Kafedra tanlangan: shu kafedra dars o‘tgan guruhlar.' : ''}</span>
          )}
        </p>
        <div className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-3 ${departments.length ? 'xl:grid-cols-6' : 'xl:grid-cols-5'}`}>
          {departments.length > 0 && (
            <Select icon={Building2} label="Kafedra" value={department} onChange={setDepartment} options={departments} />
          )}
          <Select icon={Layers} label="Fakultet" value={faculty} onChange={(v) => { setFaculty(v); setGroup(''); }}
                  options={lists?.faculties || []} />
          <Select icon={Users} label="Guruh" value={group} onChange={setGroup} options={groupsForFaculty} />
          <Select icon={GraduationCap} label="Kurs" value={course === '' ? '' : String(course)}
                  onChange={(v) => setCourse(v === '' ? '' : Number(v))}
                  options={(lists?.courses || []).map((c) => String(c))} suffix="-kurs" />
          <Select icon={BookOpen} label="Fan" value={subject} onChange={setSubject}
                  options={(lists?.subjects || []).map((s) => s.code)}
                  labels={Object.fromEntries((lists?.subjects || []).map((s) => [s.code, s.name]))} />
          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <UserRound size={12} /> Talaba
            </span>
            <span className="relative block">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ism yoki ID"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-2 text-[13.5px] outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              />
            </span>
          </label>
        </div>
      </section>

      {error && (
        <p className="rounded-2xl bg-rose-50 px-4 py-3 text-[13px] text-rose-800 ring-1 ring-rose-200">{error}</p>
      )}

      {/* ------------------------------------------- asosiy ko'rsatkichlar */}
      <Hero report={report} overview={overview} loading={overviewBusy && !overview} scope={scope} />

      {overview ? (
        <Analysis
          overview={overview}
          trend={trend}
          trendBusy={trendBusy}
          scope={scope}
          onGroup={pickGroup}
          onStudent={openStudent}
          onDepartment={(d) => {
            setDepartment(d);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onNever={() => {
            setStatus('never');
            document.getElementById('rx-roster')?.scrollIntoView({ behavior: 'smooth' });
          }}
          departmentsKnown={departments}
        />
      ) : overviewBusy ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-[260px]" />
          <Skeleton className="h-[260px]" />
        </div>
      ) : null}

      {/* ---------------------------------------------- talabalar ro'yxati */}
      <Panel
        id="rx-roster"
        icon={Users}
        tone="indigo"
        title="Talabalar ro‘yxati"
        hint={
          report ? (
            <span className="rx-num">
              {roster.length.toLocaleString('ru-RU')} talaba — bosilsa har bir testi kuni, darsi va o‘qituvchisi bilan ochiladi
            </span>
          ) : undefined
        }
        actions={
          <>
            <Segmented<Status>
              size="sm"
              value={status}
              onChange={(v) => { setStatus(v); setLimit(PAGE); }}
              options={[
                ['all', 'Hammasi'],
                ['took', 'Topshirgan'],
                ['never', 'Topshirmagan'],
              ]}
            />
            <button
              type="button"
              disabled={!roster.length}
              onClick={() => downloadCsv(roster, `talabalar_${filters.from}_${filters.to}.csv`)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-[12px] font-bold text-white shadow-md shadow-emerald-500/25 transition hover:brightness-110 disabled:opacity-40"
              title="Ro‘yxatni Excel uchun yuklab olish"
            >
              <Download size={14} /> Excel
            </button>
          </>
        }
      >
        {busy && !report && (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
          </div>
        )}
        {report && roster.length === 0 && !busy && (
          <EmptyNote icon={Search}>Bu filtr bo‘yicha talaba topilmadi.</EmptyNote>
        )}
        {report && roster.length > 0 && (
          <div className="rx-scroll max-h-[720px] overflow-auto">
            <table className="rx-table text-[13px]" aria-label="Talabalar jadvali">
              {/* Ro'yxat talabani TOPISH uchun: test soni, fan, natija va
                  vaqt bu yerdan olindi (rektor, 2026-10-15) — ular talaba
                  ochilganda, har mavzu bo'yicha alohida chiqadi. */}
              <thead>
                <tr>
                  <th className="pl-4 sm:pl-5"><Th icon={UserRound}>Talaba</Th></th>
                  <th><Th icon={Users}>Guruh</Th></th>
                  <th><Th icon={GraduationCap}>Kurs</Th></th>
                  <th><Th icon={Layers}>Fakultet</Th></th>
                  <th><Th icon={Activity}>Holati</Th></th>
                </tr>
              </thead>
              <tbody>
                {roster.slice(0, limit).map((s) => (
                  <tr key={s.student_key} onClick={() => openStudent(s.student_key)} className="cursor-pointer">
                    <td className="pl-4 sm:pl-5">
                      <span className="flex items-center gap-3">
                        <Avatar name={s.full_name} size={34} />
                        <span className="min-w-0">
                          <span className="block font-semibold text-slate-900">{s.full_name}</span>
                          <span className="flex items-center gap-1 text-[11.5px] text-slate-400"><Hash size={10} />{s.student_id}</span>
                        </span>
                      </span>
                    </td>
                    <td className="font-medium text-slate-700">{s.group_name || '—'}</td>
                    <td className="text-slate-700">{s.course ? `${s.course}-kurs` : '—'}</td>
                    <td>
                      <span className="block text-slate-700">{s.faculty || '—'}</span>
                      {s.direction && <span className="block text-[11.5px] text-slate-400">{s.direction}</span>}
                    </td>
                    <td>
                      {s.attempts ? (
                        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-600">
                          <CheckCircle2 size={14} className="text-emerald-500" />
                          oxirgi test: {lastSeen(s.last_at)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-[12px] font-semibold text-rose-700 ring-1 ring-rose-200">
                          <XCircle size={13} />
                          test topshirmagan
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {report && roster.length > limit && (
          <button
            type="button"
            onClick={() => setLimit((n) => n + PAGE * 3)}
            className="w-full border-t border-slate-100 py-3 text-[12.5px] font-bold text-indigo-600 transition hover:bg-indigo-50/50"
          >
            Yana ko‘rsatish ({(roster.length - limit).toLocaleString('ru-RU')} ta qoldi)
          </button>
        )}
      </Panel>
    </div>
  );
}

/* ================================================================== hero */

function HeroTile({
  label,
  children,
  hint,
  icon: Icon,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="rx-glass rounded-2xl px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-indigo-100/80">
        {Icon && (
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/10 text-indigo-100">
            <Icon size={12} />
          </span>
        )}
        {label}
      </p>
      <div className="mt-0.5">{children}</div>
      {hint && <div className="mt-0.5 text-[10.5px] text-indigo-200/60">{hint}</div>}
    </div>
  );
}

function Hero({
  report,
  overview,
  loading,
  scope,
}: {
  report: Report | null;
  overview: StudentsOverview | null;
  loading: boolean;
  scope: StudentScope;
}) {
  if (!report && !overview) {
    return loading ? <Skeleton className="h-[230px]" /> : null;
  }
  const h = overview?.headline;
  const base = report?.headline;
  const students = h?.students ?? base?.students ?? 0;
  const took = h?.took ?? base?.took_test ?? 0;
  const never = h?.never ?? base?.never ?? 0;
  const percent = h?.percent ?? base?.percent ?? null;
  const attempts = h?.attempts ?? base?.attempts ?? 0;
  // Darsi bo'lgan guruhlar bo'yicha qamrov adolatliroq: amaliyotdagi va
  // darsi yo'q guruhlar "test topshirmagan" deb hisoblanmaydi.
  // Monitorli darslar doirasida hamma guruhning darsi bor — bu jumla kerak emas.
  const fair = scope === 'all' && h?.in_class && h.in_class.students ? h.in_class : null;
  const area = overview?.scope;
  const coverage = fair ? fair.coverage : students ? Math.round((100 * took) / students) : 0;
  const prev = overview?.previous;

  return (
    <section className="rx-hero rx-rise p-5 sm:p-7">
      <div className="grid items-center gap-6 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,420px)]">
        <div className="mx-auto lg:mx-0">
          <Ring value={coverage} size={176} stroke={16} tone={toneOf(coverage, 70, 40)} track="rgba(255,255,255,0.12)">
            <p className="text-[44px] font-extrabold leading-none text-white rx-num">
              <CountUp value={coverage} suffix="%" />
            </p>
            <span className="mt-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-indigo-200/80">qamrov</span>
          </Ring>
        </div>

        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.16em] text-indigo-200/90">
            <GraduationCap size={15} className="shrink-0" />
            Talabalar testlarda qatnashishi
          </p>
          <p className="mt-2 text-[19px] font-bold leading-snug text-white sm:text-[21px]">
            {scope === 'monitor' && area && area.teachers !== null ? (
              <>
                Monitorli xonada dars o‘tgan <span className="rx-num">{area.teachers}</span> o‘qituvchining{' '}
                <span className="rx-num">{area.groups}</span> guruhidagi{' '}
                <span className="rx-num">{students.toLocaleString('ru-RU')}</span> talabadan{' '}
                <b className="text-emerald-300 rx-num">{took.toLocaleString('ru-RU')}</b> tasi ularning testini topshirgan
              </>
            ) : fair ? (
              <>
                Darsi bo‘lgan guruhlardagi <span className="rx-num">{fair.students.toLocaleString('ru-RU')}</span> talabadan{' '}
                <b className="text-emerald-300 rx-num">{fair.took.toLocaleString('ru-RU')}</b> tasi test topshirgan
              </>
            ) : (
              <>
                <span className="rx-num">{students.toLocaleString('ru-RU')}</span> talabadan{' '}
                <b className="text-emerald-300 rx-num">{took.toLocaleString('ru-RU')}</b> tasi test topshirgan
              </>
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-indigo-100/80">
            {prev && (
              <span className="inline-flex items-center gap-1.5">
                <Delta now={h?.coverage} before={prev.coverage} unit="%" dark /> qamrov o‘tgan shunday davrga nisbatan
              </span>
            )}
          </div>
          {fair && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-indigo-200/60">
              Butun kontingent bo‘yicha: {students.toLocaleString('ru-RU')} talabadan {took.toLocaleString('ru-RU')} tasi ({h?.coverage}%).
              Shu davrda HEMIS jadvalida darsi bo‘lmagan guruhlar (amaliyot, magistratura) qamrovga kiritilmadi.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <HeroTile
            icon={Gauge}
            label="O‘rtacha natija"
            hint={prev?.percent !== undefined && prev?.percent !== null ? <Delta now={percent} before={prev.percent} unit="%" dark /> : undefined}
          >
            <p className="flex items-center gap-2 text-[26px] font-extrabold text-white rx-num">
              {percent === null ? '—' : <CountUp value={percent} suffix="%" />}
              <GradeBadge grade={h?.grade ?? gradeOf(percent)} size={24} />
            </p>
          </HeroTile>
          <HeroTile icon={ListChecks} label="Urinishlar" hint={h ? <span className="rx-num">{h.tests.toLocaleString('ru-RU')} ta test sessiyasi</span> : undefined}>
            <p className="text-[26px] font-extrabold text-white rx-num">
              <CountUp value={attempts} />
            </p>
          </HeroTile>
          <HeroTile icon={UserX} label="Umuman topshirmagan">
            <p className={`text-[26px] font-extrabold rx-num ${never ? 'text-rose-300' : 'text-emerald-300'}`}>
              <CountUp value={never} />
            </p>
          </HeroTile>
          <HeroTile
            icon={TrendingDown}
            label="Xavf ostida"
            hint={overview ? `${overview.rules.risk_attempts}+ test, o‘rtacha ${overview.rules.risk_percent}% dan past` : undefined}
          >
            <p className={`text-[26px] font-extrabold rx-num ${h?.at_risk ? 'text-amber-300' : 'text-emerald-300'}`}>
              {h ? <CountUp value={h.at_risk} /> : '—'}
            </p>
          </HeroTile>
        </div>
      </div>
    </section>
  );
}

/* ============================================================== tahlil */

/** Ma'lumoti bor haftalar — boshidagi bo'sh haftalar tashlanadi. */
function filledStudentWeeks(trend: StudentsTrend | null) {
  const weeks = trend?.weeks || [];
  // Deyarli bo'sh boshlang'ich haftalar (tizim endi ishga tushgan) tashlanadi.
  const first = weeks.findIndex((w) => w.attempts >= 20);
  return first < 0 ? [] : weeks.slice(first);
}

/** Talabalar tomonining xulosalari — tahlil ma'lumotining o'zidan. */
export function studentInsights(
  o: StudentsOverview,
  trend: StudentsTrend | null,
  scope: StudentScope,
  act: {
    onGroup: (g: string) => void;
    onDepartment: (d: string) => void;
    onNever: () => void;
    jump: (id: string) => void;
    canPickDepartment: (d: string) => boolean;
  },
): Insight[] {
  const h = o.headline;
  const out: Insight[] = [];
  if (h.never) {
    out.push({
      key: 'never', tone: 'rose', icon: UserX, action: 'Ro‘yxat', onClick: act.onNever,
      text: (
        <>
          <b className="rx-num">{h.never.toLocaleString('ru-RU')}</b> talaba{' '}
          {scope === 'monitor' ? 'monitorli darslarda birorta ham test topshirmagan' : 'shu davrda birorta ham test topshirmagan'}
        </>
      ),
    });
  }
  const weeks = filledStudentWeeks(trend);
  if (weeks.length > 1) {
    const last = weeks[weeks.length - 1];
    const prev = weeks[weeks.length - 2];
    if (last.coverage !== null && prev.coverage !== null) {
      const diff = last.coverage - prev.coverage;
      out.push({
        key: 'trend', tone: diff >= 0 ? 'emerald' : 'rose', icon: diff >= 0 ? TrendingUp : TrendingDown,
        text: (
          <>
            Bu hafta qamrov <b className="rx-num">{last.coverage}%</b> — o‘tgan haftadan{' '}
            <b className="rx-num">{diff >= 0 ? `+${diff}` : diff}</b> foiz punkt
          </>
        ),
      });
    }
  }
  const chairs = (o.by_department || []).filter((d) => d.students >= 20);
  if (chairs.length > 1) {
    const worst = chairs[0];
    out.push({
      key: 'chair', tone: 'rose', icon: Building2, action: act.canPickDepartment(worst.department) ? 'Saralash' : undefined,
      onClick: act.canPickDepartment(worst.department) ? () => act.onDepartment(worst.department) : undefined,
      text: (
        <>
          Eng past kafedra: <b>{worst.department}</b> — talabalarining <b className="rx-num">{worst.coverage}%</b> i test topshirgan
        </>
      ),
    });
  }
  const weakGroup = o.groups.find((g) => g.lessons > 0 && g.students >= 5);
  if (weakGroup) {
    out.push({
      key: 'group', tone: 'amber', icon: Users, action: 'Saralash', onClick: () => act.onGroup(weakGroup.group),
      text: (
        <>
          Eng orqadagi guruh: <b>{weakGroup.group}</b> — <b className="rx-num">{weakGroup.took}/{weakGroup.students}</b> talaba test topshirgan
        </>
      ),
    });
  }
  if (h.at_risk) {
    out.push({
      key: 'risk', tone: 'orange', icon: TrendingDown, action: 'Ko‘rish', onClick: () => act.jump('rx-risk'),
      text: (
        <>
          <b className="rx-num">{h.at_risk}</b> talaba xavf ostida — {o.rules.risk_attempts}+ test, o‘rtacha {o.rules.risk_percent}% dan past
        </>
      ),
    });
  }
  const i = o.integrity;
  if (i.copy.students || i.fast.attempts) {
    out.push({
      key: 'integrity', tone: 'violet', icon: ShieldAlert, action: 'Ko‘rish', onClick: () => act.jump('rx-integrity'),
      text: (
        <>
          Halollik: <b className="rx-num">{i.copy.students}</b> talabada bir xil noyob javoblar,{' '}
          <b className="rx-num">{i.fast.attempts.toLocaleString('ru-RU')}</b> ta juda tez yechilgan test
        </>
      ),
    });
  }
  const courses = o.by_course.filter((c) => c.students >= 20);
  if (courses.length > 1) {
    const low = courses.reduce((a, c) => (c.coverage < a.coverage ? c : a));
    out.push({
      key: 'course', tone: 'sky', icon: GraduationCap,
      text: (
        <>
          Eng past qamrovli kurs: <b>{low.course}-kurs</b> — <b className="rx-num">{low.coverage}%</b>
        </>
      ),
    });
  }
  return out.slice(0, 6);
}

/** Haftalar bo'yicha qamrov va natija. */
function StudentTrend({ trend, busy }: { trend: StudentsTrend | null; busy: boolean }) {
  const weeks = filledStudentWeeks(trend);
  if (!weeks.length) {
    return busy ? <Skeleton className="h-[260px]" /> : null;
  }
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null;
  return (
    <Panel
      icon={TrendingUp}
      tone="violet"
      title="Haftalar bo‘yicha dinamika"
      hint={
        <>
          Har hafta o‘z darslari bo‘yicha: qancha talaba test topshirgan va o‘rtacha natija.{' '}
          {first.coverage !== null && last.coverage !== null && weeks.length > 1 && (
            <>
              {uzDay(first.week_start)} haftasidan beri qamrov:{' '}
              <b className="text-slate-800 rx-num">
                {first.coverage}% → {last.coverage}%
              </b>
            </>
          )}
        </>
      }
      actions={
        prev && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500">
            o‘tgan haftaga nisbatan <Delta now={last.coverage} before={prev.coverage} unit="%" />
          </span>
        )
      }
      bodyClassName="px-3 pb-4 pt-3 sm:px-5"
    >
      <div className="mb-2 px-1">
        <Legend
          items={[
            { label: 'Qamrov', tone: 'indigo', value: last.coverage === null ? '—' : `${last.coverage}%` },
            { label: 'O‘rtacha natija', tone: 'emerald', value: last.percent === null ? '—' : `${last.percent}%` },
          ]}
        />
      </div>
      <TrendChart
        labels={weeks.map((w) => uzDay(w.week_start))}
        series={[
          { key: 'coverage', label: 'Qamrov', tone: 'indigo', values: weeks.map((w) => w.coverage) },
          { key: 'percent', label: 'O‘rtacha natija', tone: 'emerald', values: weeks.map((w) => w.percent) },
        ]}
      />
      <p className="mt-1 px-1 text-[11.5px] text-slate-400 rx-num">
        Test topshirgan talabalar: {weeks.map((w) => w.took.toLocaleString('ru-RU')).join(' · ')}
      </p>
    </Panel>
  );
}

function Analysis({
  overview: o,
  trend,
  trendBusy,
  scope,
  onGroup,
  onStudent,
  onDepartment,
  onNever,
  departmentsKnown,
}: {
  overview: StudentsOverview;
  trend: StudentsTrend | null;
  trendBusy: boolean;
  scope: StudentScope;
  onGroup: (group: string) => void;
  onStudent: (key: string) => void;
  onDepartment: (department: string) => void;
  onNever: () => void;
  departmentsKnown: string[];
}) {
  const canPick = (d: string) => departmentsKnown.includes(d);
  const insights = studentInsights(o, trend, scope, {
    onGroup,
    onDepartment,
    onNever,
    jump: (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }),
    canPickDepartment: canPick,
  });
  return (
    <>
      <Insights items={insights} />
      <StudentTrend trend={trend} busy={trendBusy} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <Grades overview={o} />
        <Daily overview={o} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Breakdown
          icon={GraduationCap}
          tone="sky"
          title="Kurslar kesimi"
          hint="Qamrov — test topshirgan talabalar ulushi; natija — o‘rtacha foiz"
          rows={o.by_course.map((c) => ({ key: String(c.course), label: `${c.course}-kurs`, ...c }))}
        />
        <Breakdown
          icon={Layers}
          tone="violet"
          title="Fakultetlar kesimi"
          hint="Eng past qamrovdan"
          rows={o.by_faculty.map((f) => ({ key: f.faculty, label: f.faculty, ...f }))}
        />
      </div>
      {(o.by_department || []).length > 0 && (
        <Breakdown
          icon={Building2}
          tone="indigo"
          title="Kafedralar kesimi"
          hint="Kafedra dars o‘tgan guruhlar talabalari va shu kafedra o‘qituvchilarining testlari — eng past qamrovdan. Bosilsa sahifa shu kafedra bo‘yicha filtrlanadi."
          rows={(o.by_department || []).map((d) => ({
            key: d.department,
            label: d.department,
            sub: `${d.groups} guruh · ${d.teachers} o‘qituvchi`,
            ...d,
          }))}
          onPick={(key) => canPick(key) && onDepartment(key)}
          columns
        />
      )}
      <Groups overview={o} onGroup={onGroup} />
      <div className="grid gap-5 xl:grid-cols-2">
        <AtRisk overview={o} onStudent={onStudent} />
        <Integrity overview={o} onStudent={onStudent} />
      </div>
      <Teachers overview={o} />
    </>
  );
}

function Grades({ overview: o }: { overview: StudentsOverview }) {
  const total = o.distribution.reduce((s, d) => s + d.students, 0);
  return (
    <Panel
      icon={Target}
      tone="emerald"
      title="Baholar taqsimoti"
      hint="Har talabaning davrdagi o‘rtacha natijasi 5 ballik tizimda"
      bodyClassName="p-4 sm:p-5"
    >
      {total === 0 ? (
        <EmptyNote icon={Target}>Bu davrda test topshirgan talaba yo‘q.</EmptyNote>
      ) : (
        <>
          <StackBar
            height={16}
            parts={o.distribution.map((d) => ({
              key: String(d.grade),
              value: d.students,
              tone: GRADE_TONE[d.grade] || 'slate',
              title: `${d.grade} — ${d.label}: ${d.students}`,
            }))}
          />
          <ul className="mt-4 space-y-2.5">
            {o.distribution.map((d, i) => {
              const share = total ? Math.round((100 * d.students) / total) : 0;
              return (
                <li key={d.grade} className="flex items-center gap-3">
                  <GradeBadge grade={d.grade} size={30} />
                  <span className="w-[92px] shrink-0">
                    <span className="block text-[13px] font-bold text-slate-800">{d.label}</span>
                    <span className="block text-[11px] text-slate-400">
                      {d.grade === 5 ? `${d.from}–100%` : d.grade === 2 ? `${o.distribution[i - 1]?.from ?? 55}% dan past` : `${d.from}–${(o.distribution[i - 1]?.from ?? 101) - 1}%`}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <Meter value={share} tone={GRADE_TONE[d.grade]} height={10} delay={i * 80} />
                  </span>
                  <span className="w-[86px] shrink-0 text-right">
                    <b className="block text-[15px] text-slate-900 rx-num">{d.students.toLocaleString('ru-RU')}</b>
                    <span className={`text-[11px] font-semibold rx-num ${TONE[GRADE_TONE[d.grade]].text}`}>{share}%</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}

function Daily({ overview: o }: { overview: StudentsOverview }) {
  const [mode, setMode] = useState<'attempts' | 'students' | 'percent'>('attempts');
  const days = o.daily;
  if (days.length < 2) {
    const d = days[0];
    return (
      <Panel icon={Activity} tone="sky" title="Kunlik faollik" bodyClassName="p-5">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-[26px] font-extrabold text-slate-900 rx-num">{(d?.attempts ?? 0).toLocaleString('ru-RU')}</p>
            <p className="text-[11.5px] text-slate-500">urinish</p>
          </div>
          <div>
            <p className="text-[26px] font-extrabold text-slate-900 rx-num">{(d?.students ?? 0).toLocaleString('ru-RU')}</p>
            <p className="text-[11.5px] text-slate-500">talaba</p>
          </div>
          <div>
            <p className={`text-[26px] font-extrabold rx-num ${TONE[toneOf(d?.percent ?? null, 71, 55)].text}`}>
              {d?.percent === null || d?.percent === undefined ? '—' : `${d.percent}%`}
            </p>
            <p className="text-[11.5px] text-slate-500">o‘rtacha</p>
          </div>
        </div>
      </Panel>
    );
  }
  return (
    <Panel
      icon={Activity}
      tone="sky"
      title="Kunlik faollik"
      hint="Har kuni nechta test topshirilgan, nechta talaba qatnashgan va o‘rtacha natija"
      actions={
        <Segmented<typeof mode>
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            ['attempts', 'Urinish'],
            ['students', 'Talaba'],
            ['percent', 'Natija'],
          ]}
        />
      }
      bodyClassName="px-4 pb-4 pt-5 sm:px-5"
    >
      <Columns
        height={170}
        items={days.map((d) => {
          const value = mode === 'percent' ? d.percent ?? 0 : mode === 'students' ? d.students : d.attempts;
          return {
            key: d.date,
            label: days.length > 10 ? dayLabel(d.date).split('-')[0] : weekday(d.date),
            sub: days.length > 10 ? undefined : dayLabel(d.date),
            value,
            caption: mode === 'percent' ? (d.percent === null ? '—' : `${d.percent}%`) : value.toLocaleString('ru-RU'),
            title: `${d.date}: ${d.attempts} urinish, ${d.students} talaba, o‘rtacha ${d.percent ?? '—'}%`,
            tone: mode === 'percent' ? toneOf(d.percent, 71, 55) : 'indigo',
            muted: !d.attempts,
          };
        })}
      />
    </Panel>
  );
}

function Breakdown({
  icon,
  tone,
  title,
  hint,
  rows,
  onPick,
  columns = false,
}: {
  icon: typeof Users;
  tone: Tone;
  title: string;
  hint: string;
  rows: Array<{ key: string; label: string; sub?: string; students: number; took: number; coverage: number; percent: number | null }>;
  onPick?: (key: string) => void;
  /** Keng ekranda ikki ustun — kafedralar ko'p bo'lganda. */
  columns?: boolean;
}) {
  return (
    <Panel icon={icon} tone={tone} title={title} hint={hint}>
      {rows.length === 0 ? (
        <EmptyNote icon={icon}>Ma’lumot yo‘q.</EmptyNote>
      ) : (
        <ul className={columns ? 'grid xl:grid-cols-2' : 'divide-y divide-slate-100'}>
          {rows.map((r, i) => (
            <li
              key={r.key}
              onClick={onPick ? () => onPick(r.key) : undefined}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:px-5 ${
                columns ? 'border-b border-slate-100 xl:odd:border-r' : ''
              } ${onPick ? 'cursor-pointer transition hover:bg-indigo-50/40' : ''}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-bold text-slate-800" title={r.label}>{r.label}</span>
                <span className="text-[11.5px] text-slate-400 rx-num">
                  {r.took.toLocaleString('ru-RU')} / {r.students.toLocaleString('ru-RU')} talaba
                  {r.sub ? ` · ${r.sub}` : ''}
                </span>
              </span>
              <span className="sm:order-none">
                <span className="mb-0.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400"><Percent size={10} />qamrov</span>
                <Meter value={r.coverage} tone={toneOf(r.coverage, 70, 40)} delay={i * 50} label={`${r.coverage}%`} />
              </span>
              <span className="col-span-2 sm:col-span-1">
                <span className="mb-0.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400"><Gauge size={10} />natija</span>
                <Meter value={r.percent} tone={toneOf(r.percent, 71, 55)} delay={i * 50 + 100} label={r.percent === null ? '—' : `${r.percent}%`} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Groups({ overview: o, onGroup }: { overview: StudentsOverview; onGroup: (g: string) => void }) {
  const [view, setView] = useState<'weak' | 'strong' | 'idle'>('weak');
  const [limit, setLimit] = useState(12);
  const withLessons = o.groups.filter((g) => g.lessons > 0);
  const idle = o.groups.filter((g) => g.lessons === 0);
  const rows =
    view === 'weak'
      ? withLessons
      : view === 'strong'
        ? [...withLessons].filter((g) => g.took > 0).sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0) || b.coverage - a.coverage)
        : idle;
  const zero = withLessons.filter((g) => g.took === 0).length;
  return (
    <Panel
      icon={AlertTriangle}
      tone="amber"
      title="Guruhlar reytingi"
      hint={
        <>
          Darsi bo‘lgan {withLessons.length} guruhdan <b className="text-rose-600 rx-num">{zero}</b> tasida birorta ham test
          topshirilmagan. Guruh bosilsa — sahifa shu guruh bo‘yicha filtrlanadi.
        </>
      }
      actions={
        <Segmented<typeof view>
          size="sm"
          value={view}
          onChange={(v) => { setView(v); setLimit(12); }}
          options={[
            ['weak', 'Orqada qolganlar'],
            ['strong', 'Eng yaxshilar'],
            ['idle', `Darsi yo‘q (${idle.length})`],
          ]}
        />
      }
    >
      {rows.length === 0 ? (
        <EmptyNote icon={Users}>Bu ko‘rinishda guruh yo‘q.</EmptyNote>
      ) : (
        <div className="rx-scroll overflow-x-auto">
          <table className="rx-table text-[13px]">
            <thead>
              <tr>
                <th className="pl-4 sm:pl-5"><Th icon={Users}>Guruh</Th></th>
                <th><Th icon={Layers}>Fakultet</Th></th>
                <th className="text-right"><Th icon={UserRound} right>Talaba</Th></th>
                <th className="min-w-[150px]"><Th icon={Percent}>Qamrov</Th></th>
                <th className="min-w-[150px]"><Th icon={Gauge}>O‘rtacha natija</Th></th>
                <th className="text-right"><Th icon={CalendarCheck} right>Darslar</Th></th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((g, i) => (
                <tr key={g.group} onClick={() => onGroup(g.group)} className="cursor-pointer">
                  <td className="pl-4 sm:pl-5">
                    <span className="flex items-center gap-2.5">
                      <span className="flex h-8 min-w-[2rem] items-center justify-center rounded-lg bg-slate-100 px-1.5 text-[11px] font-extrabold text-slate-500 rx-num">
                        {i + 1}
                      </span>
                      <span>
                        <span className="block font-bold text-slate-900">{g.group}</span>
                        <span className="block text-[11px] text-slate-400">{g.course ? `${g.course}-kurs` : ''}</span>
                      </span>
                    </span>
                  </td>
                  <td className="max-w-[16rem] truncate text-slate-600" title={g.faculty}>{g.faculty || '—'}</td>
                  <td className="text-right font-semibold text-slate-700 rx-num">
                    {g.took}/{g.students}
                  </td>
                  <td>
                    <Meter value={g.coverage} tone={toneOf(g.coverage, 70, 40)} label={`${g.coverage}%`} />
                  </td>
                  <td>
                    {g.percent === null ? (
                      <span className="text-[12px] text-slate-400">test yo‘q</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1">
                          <Meter value={g.percent} tone={toneOf(g.percent, 71, 55)} label={`${g.percent}%`} />
                        </span>
                        <GradeBadge grade={gradeOf(g.percent)} size={22} />
                      </span>
                    )}
                  </td>
                  <td className="text-right">
                    {g.lessons ? (
                      <span className="text-slate-600 rx-num">{g.lessons}</span>
                    ) : (
                      <Pill tone="slate">darsi yo‘q</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + 24)}
          className="w-full border-t border-slate-100 py-3 text-[12.5px] font-bold text-indigo-600 transition hover:bg-indigo-50/50"
        >
          Yana ko‘rsatish ({rows.length - limit} ta qoldi)
        </button>
      )}
    </Panel>
  );
}

function AtRisk({ overview: o, onStudent }: { overview: StudentsOverview; onStudent: (key: string) => void }) {
  return (
    <Panel
      id="rx-risk"
      icon={TrendingDown}
      tone="rose"
      title={`Xavf ostidagi talabalar — ${o.headline.at_risk}`}
      hint={`Kamida ${o.rules.risk_attempts} ta test topshirgan va o‘rtacha natijasi ${o.rules.risk_percent}% dan past (5 ballik tizimda «qoniqarsiz»)`}
    >
      {o.at_risk.length === 0 ? (
        <EmptyNote icon={Check}>Bu davrda doimiy past natija ko‘rsatgan talaba yo‘q.</EmptyNote>
      ) : (
        <ul className="rx-scroll grid max-h-[460px] overflow-y-auto sm:grid-cols-2">
          {o.at_risk.map((s) => (
            <li key={s.student_key} className="border-b border-slate-100 sm:odd:border-r">
              <button
                type="button"
                onClick={() => onStudent(s.student_key)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-rose-50/40"
              >
                <Avatar name={s.full_name} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-900">{s.full_name}</span>
                  <span className="block truncate text-[11.5px] text-slate-400">
                    {s.group_name}
                    {s.course ? ` · ${s.course}-kurs` : ''} · {s.attempts} test
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <b className="block text-[16px] text-rose-600 rx-num">{s.percent}%</b>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {o.headline.at_risk > o.at_risk.length && (
        <p className="border-t border-slate-100 px-5 py-2 text-[11.5px] text-slate-400">
          Eng past {o.at_risk.length} tasi ko‘rsatildi. Qolganini guruh yoki kurs bo‘yicha filtrlab ko‘ring.
        </p>
      )}
    </Panel>
  );
}

function Integrity({ overview: o, onStudent }: { overview: StudentsOverview; onStudent: (key: string) => void }) {
  const i = o.integrity;
  const share = (n: number) => (i.attempts ? Math.round((100 * n) / i.attempts) : 0);
  const tiles: Array<{ icon: typeof Zap; tone: Tone; label: string; value: number; sub: string }> = [
    {
      icon: Zap, tone: 'amber', label: 'Juda tez yechilgan', value: i.fast.attempts,
      sub: `savoliga ${i.fast.seconds_per_question} soniyadan kam · ${share(i.fast.attempts)}% urinish`,
    },
    {
      icon: EyeOff, tone: 'orange', label: 'Sahifadan chiqib ketgan', value: i.away.attempts,
      sub: `test vaqtida ${i.away.seconds}+ soniya boshqa oynada · ${share(i.away.attempts)}%`,
    },
    {
      icon: Copy, tone: 'rose', label: 'Bir xil noyob javoblar', value: i.copy.students,
      sub: `${i.copy.groups} holat — boshqa hech kim tanlamagan javoblar mos kelgan`,
    },
  ];
  return (
    <Panel
      id="rx-integrity"
      icon={ShieldAlert}
      tone="orange"
      title="Test halolligi"
      hint="Natijaga ishonsa bo‘ladimi: bu ayblov emas, tekshirish uchun belgi"
    >
      <div className="grid gap-2.5 p-4 sm:grid-cols-3 sm:p-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-100">
            <span className={`flex h-8 w-8 items-center justify-center rounded-xl shadow-md ${TONE[t.tone].chip}`}>
              <t.icon size={15} />
            </span>
            <p className="mt-2 text-[11.5px] font-semibold text-slate-500">{t.label}</p>
            <p className={`text-[24px] font-extrabold leading-tight rx-num ${t.value ? TONE[t.tone].text : 'text-emerald-600'}`}>
              {t.value.toLocaleString('ru-RU')}
            </p>
            <p className="text-[10.5px] leading-snug text-slate-400">{t.sub}</p>
          </div>
        ))}
      </div>
      {i.copy.items.length > 0 && (
        <div className="border-t border-slate-100">
          <p className="px-5 pt-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Bir xil javob bergan talabalar
          </p>
          <ul className="rx-scroll max-h-[300px] divide-y divide-slate-100 overflow-y-auto">
            {i.copy.items.map((c, idx) => (
              <li key={`${c.date}-${idx}`} className="px-5 py-2.5">
                <p className="text-[12px] text-slate-600">
                  <b className="text-slate-800">{dayLabel(c.date)}</b> · {c.topic || 'mavzusiz'}
                  {c.teacher_name && <span className="text-slate-400"> · {c.teacher_name}</span>}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {c.students.map((s) => (
                    <button
                      key={s.student_key}
                      type="button"
                      onClick={() => onStudent(s.student_key)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 py-0.5 pl-0.5 pr-2.5 text-[11.5px] font-semibold text-rose-800 ring-1 ring-rose-200 transition hover:bg-rose-100"
                    >
                      <Avatar name={s.full_name} size={20} />
                      {s.full_name}
                      {s.percent !== null && <span className="font-normal text-rose-500 rx-num">{s.percent}%</span>}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function Teachers({ overview: o }: { overview: StudentsOverview }) {
  const openTeacher = useOpenTeacher();
  const [sort, setSort] = useState<'tests' | 'low' | 'part' | 'flag'>('tests');
  const [limit, setLimit] = useState(15);
  const rows = [...o.teachers].sort((a, b) => {
    if (sort === 'low') return (a.percent ?? 101) - (b.percent ?? 101);
    if (sort === 'part') return (a.participation ?? 101) - (b.participation ?? 101);
    if (sort === 'flag') return b.flagged_percent - a.flagged_percent;
    return b.tests - a.tests;
  });
  return (
    <Panel
      icon={BookOpenCheck}
      tone="indigo"
      title="O‘qituvchilar kesimida talabalar natijasi"
      hint={
        <>
          Kimning darsida test o‘tkazilgan, nechta talaba qatnashgan va qanday natija. <b>Ishtirok</b> — test
          o‘tkazilgan guruh talabalarining necha foizi topshirgani.
        </>
      }
      actions={
        <Segmented<typeof sort>
          size="sm"
          value={sort}
          onChange={(v) => { setSort(v); setLimit(15); }}
          options={[
            ['tests', 'Ko‘p test'],
            ['low', 'Past natija'],
            ['part', 'Past ishtirok'],
            ['flag', 'Shubhali'],
          ]}
        />
      }
    >
      {rows.length === 0 ? (
        <EmptyNote icon={UserX}>Bu davrda test o‘tkazgan o‘qituvchi yo‘q.</EmptyNote>
      ) : (
        <div className="rx-scroll overflow-x-auto">
          <table className="rx-table text-[13px]">
            <thead>
              <tr>
                <th className="pl-4 sm:pl-5"><Th icon={UserRound}>O‘qituvchi</Th></th>
                <th className="text-right"><Th icon={ListChecks} right>Testlar</Th></th>
                <th className="text-right"><Th icon={Users} right>Talabalar</Th></th>
                <th className="min-w-[150px]"><Th icon={Gauge}>O‘rtacha natija</Th></th>
                <th className="min-w-[150px]"><Th icon={Percent}>Ishtirok</Th></th>
                <th className="text-right"><Th icon={ShieldAlert} right>Shubhali</Th></th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((t) => (
                <tr
                  key={t.teacher_key}
                  className={openTeacher ? 'cursor-pointer' : ''}
                  onClick={() => openTeacher?.({ key: t.teacher_key, name: t.teacher_name })}
                >
                  <td className="pl-4 sm:pl-5">
                    <span className="flex items-center gap-3">
                      <Avatar name={t.teacher_name} size={34} />
                      <span className="min-w-0">
                        <span className="block font-semibold text-slate-900">{t.teacher_name}</span>
                        <span className="flex max-w-[18rem] items-center gap-1 truncate text-[11.5px] text-slate-400"><Building2 size={11} className="shrink-0" />{t.department || '—'}</span>
                      </span>
                    </span>
                  </td>
                  <td className="text-right font-bold text-slate-800 rx-num">{t.tests}</td>
                  <td className="text-right text-slate-600 rx-num">{t.students}</td>
                  <td>
                    <Meter value={t.percent} tone={toneOf(t.percent, 71, 55)} label={t.percent === null ? '—' : `${t.percent}%`} />
                  </td>
                  <td>
                    {t.participation === null ? (
                      <span className="text-[12px] text-slate-400">—</span>
                    ) : (
                      <Meter value={t.participation} tone={toneOf(t.participation, 75, 50)} label={`${t.participation}%`} />
                    )}
                    {t.low_participation > 0 && (
                      <span className="mt-0.5 block text-[10.5px] text-rose-500">
                        {t.low_participation} testda yarmidan kami qatnashgan
                      </span>
                    )}
                  </td>
                  <td className="text-right">
                    <span className={`font-bold rx-num ${t.flagged_percent >= 30 ? 'text-rose-600' : t.flagged_percent >= 15 ? 'text-amber-600' : 'text-slate-500'}`}>
                      {t.flagged_percent}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + 30)}
          className="w-full border-t border-slate-100 py-3 text-[12.5px] font-bold text-indigo-600 transition hover:bg-indigo-50/50"
        >
          Yana ko‘rsatish ({rows.length - limit} ta qoldi)
        </button>
      )}
    </Panel>
  );
}

/* ============================================================ yordamchilar */

/** Jadval sarlavhasi ikonka bilan. Matn o'zgarmaydi — faqat bezak. */
function Th({ icon: Icon, children, right = false }: { icon: LucideIcon; children: React.ReactNode; right?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${right ? 'justify-end' : ''}`}>
      <Icon size={12} aria-hidden className="shrink-0 opacity-70" />
      {children}
    </span>
  );
}

function Select({
  label, value, onChange, options, labels, suffix = '', icon: Icon,
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  labels?: Record<string, string>;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
        {Icon && <Icon size={12} />}
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-xl border px-2.5 py-2.5 text-[13.5px] outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 ${
          value ? 'border-indigo-300 bg-indigo-50/60 font-semibold text-indigo-900' : 'border-slate-200 bg-slate-50 text-slate-700'
        }`}
      >
        <option value="">Hammasi</option>
        {options.map((o) => (
          <option key={o} value={o}>{(labels?.[o] || o) + suffix}</option>
        ))}
      </select>
    </label>
  );
}

const BACK_BUTTON =
  'inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-900 hover:ring-slate-300';

/** Bitta talaba: har bir testi — kuni, darsi, mavzusi, o'qituvchisi. */
function StudentView({
  data, onBack, onOpen,
}: {
  data: StudentAttempts;
  onBack: () => void;
  onOpen: (attemptId: number) => void;
}) {
  const s = data.student;
  const list = data.attempts;
  const score = list.reduce((n, a) => n + a.score, 0);
  const total = list.reduce((n, a) => n + a.total, 0);
  const percent = total ? Math.round((100 * score) / total) : null;
  const minutes = Math.round(list.reduce((n, a) => n + a.minutes, 0));
  const fast = list.filter((a) => a.too_fast).length;
  const subjects = new Set(list.map((a) => a.subject_code)).size;
  // Vaqt bo'yicha: eskisidan yangisiga — natija o'sayaptimi, tushyaptimi.
  const timeline = [...list].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className={BACK_BUTTON}>
        <ArrowLeft size={15} /> Talabalar ro‘yxati
      </button>

      <section className="rx-hero rx-rise p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-5">
          <Avatar name={s.full_name} size={64} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[22px] font-extrabold tracking-tight text-white">{s.full_name}</h2>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-indigo-100/80">
              {s.group_name && <span className="inline-flex items-center gap-1"><Users size={13} />{s.group_name}</span>}
              {s.course ? <span className="inline-flex items-center gap-1"><GraduationCap size={13} />{s.course}-kurs</span> : null}
              {s.faculty && <span className="inline-flex items-center gap-1"><Layers size={13} />{s.faculty}</span>}
              {s.direction && <span className="inline-flex items-center gap-1"><BookOpen size={13} />{s.direction}</span>}
            </p>
            <p className="mt-1 inline-flex items-center gap-1 text-[12px] text-indigo-200/60"><Hash size={11} />ID: {s.student_id}</p>
          </div>
          {percent !== null && (
            <Ring value={percent} size={112} stroke={11} tone={toneOf(percent, 71, 55)} track="rgba(255,255,255,0.12)">
              <p className="text-[26px] font-extrabold leading-none text-white rx-num">{percent}%</p>
              <span className="mt-1 text-[9.5px] font-bold uppercase tracking-[0.16em] text-indigo-200/80">o‘rtacha</span>
            </Ring>
          )}
        </div>
      </section>

      {list.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard icon={BookOpenCheck} tone="indigo" label="Testlar" value={list.length} sub={`${subjects} ta fan bo‘yicha`} />
          <KpiCard
            icon={Target}
            tone={GRADE_TONE[gradeOf(percent) || 2]}
            label="Baho"
            value={<span className="flex items-center gap-2"><GradeBadge grade={gradeOf(percent)} size={30} /></span>}
            sub="5 ballik tizimda"
            delay={60}
          />
          <KpiCard icon={Clock3} tone="sky" label="Sarflangan vaqt" value={`${minutes} daq`} sub="testlar ustida" delay={120} />
          <KpiCard
            icon={Zap}
            tone={fast ? 'amber' : 'emerald'}
            label="Juda tez yechilgan"
            value={fast}
            sub="savoliga 8 soniyadan kam"
            delay={180}
          />
        </div>
      )}

      {timeline.length > 1 && (
        <Panel icon={Activity} tone="violet" title="Natija dinamikasi" hint="Har bir test natijasi vaqt bo‘yicha" bodyClassName="px-4 pb-4 pt-5 sm:px-5">
          <Columns
            height={120}
            items={timeline.map((a) => ({
              key: String(a.id),
              label: dayLabel(a.date),
              value: a.percent ?? 0,
              caption: a.percent === null ? '—' : `${a.percent}%`,
              title: `${a.topic || a.subject_name}: ${a.score}/${a.total}`,
              tone: toneOf(a.percent, 71, 55),
            }))}
            onPick={(key) => onOpen(Number(key))}
          />
        </Panel>
      )}

      {list.length === 0 ? (
        <section className="rx-card">
          <EmptyNote icon={CalendarDays}>Bu oraliqda test topshirmagan.</EmptyNote>
        </section>
      ) : (
        <ul className="space-y-2.5">
          {list.map((a, idx) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onOpen(a.id)}
                className="rx-card rx-lift rx-rise flex w-full flex-wrap items-center gap-4 p-4 text-left"
                style={{ ['--rx-delay' as string]: `${Math.min(idx, 10) * 40}ms` } as React.CSSProperties}
              >
                <Ring value={a.percent} size={58} stroke={6} tone={toneOf(a.percent, 71, 55)}>
                  <span className={`text-[13px] font-extrabold rx-num ${TONE[toneOf(a.percent, 71, 55)].text}`}>
                    {a.percent === null ? '—' : `${a.percent}%`}
                  </span>
                </Ring>
                <div className="min-w-[14rem] flex-1">
                  <p className="text-[14.5px] font-bold text-slate-900">{a.topic || a.subject_name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-slate-600">
                    <span className="inline-flex items-center gap-1"><CalendarDays size={12} className="text-slate-400" />{a.date}</span>
                    {a.lesson?.para && <span className="inline-flex items-center gap-1"><Clock3 size={12} className="text-slate-400" />{a.lesson.para}</span>}
                    {a.lesson?.auditorium && <span className="inline-flex items-center gap-1"><MapPin size={12} className="text-slate-400" />{a.lesson.auditorium}</span>}
                    {a.subject_name && <span className="inline-flex items-center gap-1"><BookOpen size={12} className="text-slate-400" />{a.subject_name}</span>}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px] text-slate-500">
                    <UserRound size={12} className="text-slate-400" />
                    O‘qituvchi: <b className="font-semibold text-slate-700">{a.teacher_name || '—'}</b>
                    {a.variant ? ` · variant ${a.variant}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-right">
                  <div>
                    <p className="text-[15px] font-bold text-slate-800 rx-num">
                      {a.score}/{a.total}
                    </p>
                    <p className="text-[12px] text-slate-500 rx-num">{a.minutes} daq</p>
                    {a.too_fast && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-amber-700">
                        <AlertTriangle size={12} /> juda tez
                      </p>
                    )}
                  </div>
                  <ChevronRight size={18} className="text-slate-300" />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Test vaqtida sahifa necha marta va jami necha soniya yashirin turgan. */
function awayFrom(events: AttemptDetail['events']): { times: number; seconds: number } {
  let times = 0;
  let seconds = 0;
  let hiddenAt: number | null = null;
  for (const e of events) {
    const at = e.at ? Date.parse(e.at) : NaN;
    if (e.type === 'visibility_hidden') {
      times += 1;
      hiddenAt = Number.isNaN(at) ? null : at;
    } else if (e.type === 'visibility_visible' && hiddenAt !== null && !Number.isNaN(at)) {
      seconds += Math.max(0, (at - hiddenAt) / 1000);
      hiddenAt = null;
    }
  }
  return { times, seconds: Math.round(seconds) };
}

/** Bitta test: savollar va talaba belgilagan javoblar. */
function AttemptView({ detail, onBack }: { detail: AttemptDetail; onBack: () => void }) {
  const right = detail.questions.filter((q) => q.is_correct).length;
  const skipped = detail.questions.filter((q) => q.skipped).length;
  const wrong = detail.questions.length - right - skipped;
  // Ilgari bu yerda HAMMA qaydlar soni "sahifadan chiqish" deb yozilardi —
  // javob belgilash ham qayd. Endi faqat sahifa yashiringan holatlar.
  const away = awayFrom(detail.events);
  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className={BACK_BUTTON}>
        <ArrowLeft size={15} /> Talabaning testlari
      </button>

      <section className="rx-hero rx-rise p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-5">
          <Ring value={detail.percent} size={120} stroke={12} tone={toneOf(detail.percent, 71, 55)} track="rgba(255,255,255,0.12)">
            <p className="text-[28px] font-extrabold leading-none text-white rx-num">
              {detail.percent === null ? '—' : `${detail.percent}%`}
            </p>
            <span className="mt-1 text-[11px] text-indigo-200/80 rx-num">
              {detail.score}/{detail.total}
            </span>
          </Ring>
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-extrabold leading-snug text-white">{detail.topic || detail.subject_code}</h2>
            <p className="mt-1 text-[13px] text-indigo-100/80">
              {detail.student.full_name}
              {detail.student.group_name ? ` · ${detail.student.group_name}` : ''}
              {` · ${detail.date}`}
              {detail.lesson?.para ? ` · ${detail.lesson.para}` : ''}
              {detail.lesson?.auditorium ? ` · ${detail.lesson.auditorium}` : ''}
            </p>
            <p className="mt-0.5 text-[12.5px] text-indigo-200/70">
              O‘qituvchi: {detail.teacher_name || '—'} · {detail.minutes} daqiqa
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rx-glass inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-emerald-200">
                <Check size={12} /> {right} to‘g‘ri
              </span>
              <span className="rx-glass inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-rose-200">
                <X size={12} /> {wrong} noto‘g‘ri
              </span>
              {skipped > 0 && (
                <span className="rx-glass inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-slate-200">
                  {skipped} javobsiz
                </span>
              )}
              {detail.too_fast && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2.5 py-1 text-[11.5px] font-semibold text-amber-200 ring-1 ring-amber-300/30">
                  <AlertTriangle size={12} /> Juda tez topshirilgan
                </span>
              )}
              {away.times > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-400/20 px-2.5 py-1 text-[11.5px] font-semibold text-orange-200 ring-1 ring-orange-300/30">
                  <EyeOff size={12} /> {away.times} marta sahifadan chiqqan
                  {away.seconds > 0 ? ` · ${away.seconds} soniya` : ''}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      <ol className="space-y-3">
        {detail.questions.map((q) => (
          <li
            key={q.index}
            className={`rx-card relative overflow-hidden p-4 sm:p-5`}
          >
            <span
              aria-hidden
              className={`absolute inset-y-0 left-0 w-1.5 ${q.skipped ? 'bg-slate-300' : q.is_correct ? 'bg-emerald-500' : 'bg-rose-500'}`}
            />
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[12px] font-extrabold text-slate-500">
                {q.index + 1}
              </span>
              <p className="flex-1 text-[14px] leading-[1.65] text-slate-900">{q.question}</p>
              {q.skipped ? (
                <Chip tone="slate">javobsiz</Chip>
              ) : q.is_correct ? (
                <Chip tone="emerald"><Check size={12} /> to‘g‘ri</Chip>
              ) : (
                <Chip tone="rose"><X size={12} /> xato</Chip>
              )}
            </div>
            <ul className="mt-3 space-y-1.5 pl-10">
              {q.options.map((option, i) => {
                const chosen = q.selected_index === i;
                const isRight = q.correct_index === i;
                const tone = isRight
                  ? 'bg-emerald-50 ring-emerald-200 text-emerald-900'
                  : chosen
                    ? 'bg-rose-50 ring-rose-200 text-rose-900'
                    : 'bg-slate-50 ring-slate-100 text-slate-700';
                return (
                  <li key={i} className={`flex items-start gap-2.5 rounded-xl px-3 py-2 text-[13px] ring-1 ${tone}`}>
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-extrabold ${
                        isRight ? 'bg-emerald-500 text-white' : chosen ? 'bg-rose-500 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200'
                      }`}
                    >
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span className="flex-1">{option}</span>
                    {chosen && <span className="text-[11.5px] font-bold">talaba tanladi</span>}
                    {isRight && !chosen && <span className="text-[11.5px] font-bold">to‘g‘ri javob</span>}
                  </li>
                );
              })}
            </ul>
            {q.explanation && (
              <p className="ml-10 mt-2.5 rounded-xl bg-indigo-50/60 px-3 py-2 text-[12.5px] leading-[1.6] text-slate-700 ring-1 ring-indigo-100">
                {q.explanation}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

const CHIP_TONE: Record<'slate' | 'emerald' | 'rose' | 'amber', string> = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  rose: 'bg-rose-50 text-rose-800 ring-rose-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
};

function Chip({
  children,
  tone = 'slate',
}: {
  children: React.ReactNode;
  tone?: keyof typeof CHIP_TONE;
}) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-0.5 text-[11.5px] font-semibold ring-1 ${CHIP_TONE[tone]}`}>
      {children}
    </span>
  );
}
