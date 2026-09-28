import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, ClipboardList, Loader2, Radio, Search } from 'lucide-react';
import { HttpError } from '../api/httpClient';
import {
  fetchLessons,
  fetchOverview,
  fetchStudents,
  fetchTeacherDetail,
  fetchTeachers,
  type LessonRow,
  type Overview,
  type ReportFilters,
  type StudentRow,
  type TeacherDetail,
  type TeacherRow,
} from './rectorApi';
import {
  Empty,
  ErrorBox,
  SortableTable,
  Spinner,
  Stat,
  StatusChip,
  StatusDot,
  fmtDate,
  fmtMinutes,
  statusOf,
  statusOfLow,
  type Status,
} from './RectorUi';
import { useOpenMetric } from './RectorMetric';
import TeacherName from './TeacherName';
import StudentName from './StudentName';

/**
 * Rektor hisobotining bo'limlari.
 *
 * Har bo'lim o'zi yuklaydi va filtr o'zgarganda qayta so'raydi. Jadvallar
 * mijoz tomonida saralanadi: server allaqachon butun oraliqni bitta javobda
 * beradi, shuning uchun ustun bosilganda yangi so'rov kerak emas.
 */

type SectionProps = { filters: ReportFilters; onUnauthorized: () => void };

/**
 * Bo'lim nomlari — bazada texnik kalit (`syllabus`, `lectures`) bo'lib
 * turadi. Rektor hisobotida ular odam o'qiydigan nomga aylanadi.
 */
const PAGE_LABEL: Record<string, string> = {
  syllabus: 'Mening fanlarim',
  lectures: "Ma'ruza matni",
  presentation: 'Taqdimotlar',
  videos: 'Videolar',
  handouts: 'Tarqatma materiallar',
  cases: 'Keys yaratish',
  tests: 'Test yaratish',
  'content-catalog': 'Keys va testlar bazasi',
  'my-tests': 'Mening testlarim',
  translator: 'Tarjima',
  profile: 'Profil',
  'admin-dashboard': 'Boshqaruv paneli',
  'admin-activity': 'Faollik hisoboti',
  'admin-staff': 'Hodimlar',
  'admin-staff-location': 'Joylashuv (GPS)',
  'admin-syllabuses': 'Sillabuslar',
  'admin-online-edu': "Online ta'lim",
  'admin-videos': 'Videolar (admin)',
  'admin-handouts': 'Tarqatmalar (admin)',
  'admin-books': 'Kitoblar',
  'admin-cases': 'Keyslar (admin)',
  'admin-tests': 'Testlar (admin)',
  other: 'Boshqa',
};

export function pageLabel(key: string): string {
  return PAGE_LABEL[key] || key;
}

/**
 * Rektor "qaysi moduldan necha daqiqa" deb so'raydi — bu ustunlar shu
 * savolga javob. Qolgan bo'limlar (profil, tarjima va h.k.) "Boshqa"ga qo'shiladi.
 */
export const MODULES: Array<{ key: string; label: string; pages: string[] }> = [
  { key: 'syllabus', label: 'Fanlarim', pages: ['syllabus'] },
  { key: 'lectures', label: "Ma'ruza", pages: ['lectures'] },
  { key: 'presentation', label: 'Taqdimot', pages: ['presentation'] },
  { key: 'cases', label: 'Keys', pages: ['cases'] },
  { key: 'tests', label: 'Test', pages: ['tests', 'my-tests', 'content-catalog'] },
  { key: 'handouts', label: 'Tarqatma', pages: ['handouts'] },
  { key: 'videos', label: 'Video', pages: ['videos'] },
];

const MODULE_PAGES = new Set(MODULES.flatMap((m) => m.pages));

/** O'qituvchining modullar bo'yicha daqiqalari (+ `other`). */
export function moduleMinutes(pages: TeacherRow['pages']): Record<string, number> {
  const out: Record<string, number> = { other: 0 };
  for (const m of MODULES) out[m.key] = 0;
  for (const p of pages || []) {
    const mod = MODULES.find((m) => m.pages.includes(p.page));
    if (mod) out[mod.key] += p.minutes;
    else if (!MODULE_PAGES.has(p.page)) out.other += p.minutes;
  }
  return out;
}

function minutesCell(m: number) {
  return m ? <span className="tabular-nums">{m}</span> : <span className="text-slate-300">0</span>;
}

/* ==================== Umumiy yordamchilar ==================== */

function useReport<T>(
  load: (f: ReportFilters) => Promise<T>,
  filters: ReportFilters,
  onUnauthorized: () => void,
): { data: T | null; loading: boolean; error: string } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const key = JSON.stringify(filters);
  const run = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load(filters));
      setError('');
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
        onUnauthorized();
        return;
      }
      const detail = e instanceof HttpError ? (e.body as { detail?: string } | null)?.detail : '';
      setError(detail || 'Ma’lumotni yuklab bo‘lmadi. Birozdan keyin qayta urinib ko‘ring.');
    } finally {
      setLoading(false);
    }
    // filters JSON bo'yicha kuzatiladi — obyekt har render'da yangi bo'ladi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, onUnauthorized]);

  useEffect(() => {
    void run();
  }, [run]);

  return { data, loading, error };
}

/**
 * Qaysi karta qaysi ko'rsatkichni ochadi.
 *
 * Kalit — kartaning yorlig'i: shunda har bir `<Stat>` ga alohida
 * qo'shimcha yozish shart emas, va bir xil ma'nodagi karta hisobotning
 * qayerida turmasin, bir xil tafsilotni ochadi.
 */
const METRIC_BY_LABEL: Record<string, string> = {
  'O\u2018qituvchi': 'teachers_total',
  Faol: 'teachers_active',
  'Umuman kirmagan': 'teachers_inactive',
  'Jami vaqt': 'teachers_minutes',
  'O\u2018rtacha (faol)': 'teachers_avg_minutes',
  'Dars o\u2018tilgan': 'lessons_total',
  Dars: 'lessons_total',
  'Jami dars': 'lessons_total',
  'Vaziyatli masala': 'cases_created',
  Test: 'tests_created',
  Tarqatma: 'handouts_created',
  Video: 'videos_created',
  Taqdimot: 'presentations_created',
  'Test topshirgan': 'students_total',
  Talaba: 'students_total',
  Urinishlar: 'students_attempts',
  'O\u2018rtacha ball': 'students_avg',
  'Online darsda qatnashgan': 'online_attendance_students',
  'Darsda qatnashgan': 'online_attendance_students',
  'Qatnashuv soni': 'online_attendance_visits',
  'Darsda o\u2018tirgan vaqt': 'online_attendance_minutes',
  'Online test': 'online_tests',
  'Online o\u2018rtacha': 'online_tests',
  'Malaka tinglovchi': 'malaka_attempts',
  Qoniqarsiz: 'band_qoniqarsiz',
  'Test topshirish': 'students_attempts',
};

/** Yorlig'i tanish bo'lsa — karta bosiladi va tafsilotini ochadi. */
export function MetricStat(props: Parameters<typeof Stat>[0]) {
  const open = useOpenMetric();
  const metric = METRIC_BY_LABEL[props.label];
  return <Stat {...props} onClick={metric ? () => open(metric) : props.onClick} />;
}

/** Ulush foizda; butun nol bo'lsa — ma'lumot yo'q (bu nol degani emas). */
function share(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part * 100) / whole) : null;
}

/** Saralashda qizil birinchi chiqadi. */
const STATUS_ORDER: Record<Status, number> = { bad: 0, warn: 1, good: 2, none: 3 };

/* ==================== 1. Umumiy manzara ==================== */

export function OverviewSection({ filters, onUnauthorized }: SectionProps) {
  const { data, loading, error } = useReport<Overview>(fetchOverview, filters, onUnauthorized);
  const openMetric = useOpenMetric();

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox text={error} />;
  if (!data) return null;

  const t = data.teachers;
  const s = data.students;
  const o = data.online;
  const activePct = share(t.active, t.total);
  const inactivePct = share(t.inactive, t.total);
  const lessonsHeld = t.live_sessions + t.online_lessons;
  const maxDay = Math.max(1, ...data.days.map((d) => Math.max(d.tests, d.lessons)));
  const bandTone: Record<string, string> = {
    alo: 'bg-emerald-500',
    yaxshi: 'bg-emerald-300',
    qoniqarli: 'bg-amber-500',
    qoniqarsiz: 'bg-rose-500',
  };
  const bandTotal = s.bands.reduce((n, b) => n + b.count, 0);

  return (
    <div className="space-y-4">
      <section>
        <h2 className="mb-2 px-1 text-[13px] font-bold uppercase tracking-wide text-slate-500">
          O‘qituvchilar
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <MetricStat label="O‘qituvchi" value={t.total} hint="administratorlardan tashqari" />
          <MetricStat
            label="Faol"
            value={t.active}
            hint={`${activePct ?? 0}% — shu oraliqda ishlagan`}
            status={statusOf(activePct, 60, 30)}
          />
          <MetricStat
            label="Umuman kirmagan"
            value={t.inactive}
            hint={`${inactivePct ?? 0}% o‘qituvchi`}
            status={statusOfLow(inactivePct, 40, 70)}
          />
          <MetricStat label="Jami vaqt" value={fmtMinutes(t.minutes)} />
          <MetricStat label="O‘rtacha (faol)" value={fmtMinutes(t.avg_minutes)} />
          <MetricStat
            label="Dars o‘tilgan"
            value={lessonsHeld}
            status={lessonsHeld ? undefined : 'bad'}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 px-1 text-[13px] font-bold uppercase tracking-wide text-slate-500">
          Yaratilgan material
          <span className="ml-2 font-medium normal-case tracking-normal text-slate-400">
            — o‘qituvchilar qo‘shgani (administrator ommaviy yuklagani hisobga olinmagan)
          </span>
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {/* Bir oraliqda bitta ham qo'shilmagan material turi — muammo. */}
          <MetricStat label="Vaziyatli masala" value={t.cases_created} status={t.cases_created ? undefined : 'bad'} />
          <MetricStat label="Test" value={t.tests_created} status={t.tests_created ? undefined : 'bad'} />
          <MetricStat label="Tarqatma" value={t.handouts_created} status={t.handouts_created ? undefined : 'bad'} />
          <MetricStat label="Video" value={t.videos_created} status={t.videos_created ? undefined : 'bad'} />
          <MetricStat
            label="Taqdimot"
            value={t.presentations_created}
            status={t.presentations_created ? undefined : 'bad'}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 px-1 text-[13px] font-bold uppercase tracking-wide text-slate-500">
          Talabalar
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MetricStat label="Test topshirgan" value={s.total} />
          <MetricStat label="Urinishlar" value={s.attempts} />
          <MetricStat
            label="O‘rtacha ball"
            value={s.avg_percent === null ? '—' : `${s.avg_percent}%`}
            status={statusOf(s.avg_percent, 71, 56)}
          />
          <MetricStat label="Online darsda qatnashgan" value={o.attendance_students} />
        </div>

        {bandTotal > 0 && (
          <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-3.5">
            <p className="mb-2 text-[12.5px] font-semibold text-slate-600">Baholar taqsimoti</p>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
              {s.bands.map((b) => (
                <div
                  key={b.key}
                  className={bandTone[b.key] || 'bg-slate-300'}
                  style={{ width: `${(b.count / bandTotal) * 100}%` }}
                  title={`${b.label}: ${b.count}`}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {s.bands.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => openMetric(`band_${b.key}`)}
                  title="Bosing — shu bahoni olgan talabalar ro‘yxati"
                  className="flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-[12px] text-slate-600 hover:bg-slate-100">
                  <span className={`h-2.5 w-2.5 rounded-full ${bandTone[b.key] || 'bg-slate-300'}`} />
                  {b.label}: <strong className="tabular-nums">{b.count}</strong>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 px-1 text-[13px] font-bold uppercase tracking-wide text-slate-500">
          Online ta’lim va malaka oshirish
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <MetricStat label="Darsda qatnashgan" value={o.attendance_students} />
          <MetricStat label="Qatnashuv soni" value={o.attendance_visits} />
          <MetricStat label="Darsda o‘tirgan vaqt" value={fmtMinutes(o.attendance_minutes)} />
          <MetricStat label="Online test" value={o.online_tests_submitted} />
          <MetricStat
            label="Online o‘rtacha"
            value={o.online_avg_percent === null ? '—' : `${o.online_avg_percent}%`}
            status={statusOf(o.online_avg_percent, 71, 56)}
          />
          <MetricStat
            label="Malaka tinglovchi"
            value={o.malaka_listeners}
            hint={
              o.malaka_avg_percent === null
                ? `${o.malaka_attempts} urinish`
                : `o‘rtacha ${o.malaka_avg_percent}%`
            }
          />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-3.5">
        <p className="mb-3 text-[12.5px] font-semibold text-slate-600">
          Kunlik harakat — <span className="text-sky-600">darslar</span> va{' '}
          <span className="text-emerald-600">test topshirishlar</span>
        </p>
        <div className="flex h-32 items-end gap-1 overflow-x-auto">
          {data.days.map((d) => (
            <div key={d.date} className="flex min-w-[18px] flex-1 flex-col items-center gap-1">
              <div className="flex h-24 w-full items-end justify-center gap-0.5">
                <div
                  className="w-1/2 rounded-t bg-sky-400"
                  style={{ height: `${(d.lessons / maxDay) * 100}%` }}
                  title={`${d.date}: ${d.lessons} dars`}
                />
                <div
                  className="w-1/2 rounded-t bg-emerald-400"
                  style={{ height: `${(d.tests / maxDay) * 100}%` }}
                  title={`${d.date}: ${d.tests} test`}
                />
              </div>
              <span className="text-[9.5px] text-slate-400">{d.date.slice(8)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ==================== 2. O'qituvchilar ==================== */

function TeacherDetailPanel({ ownerKey, filters }: { ownerKey: string; filters: ReportFilters }) {
  const [data, setData] = useState<TeacherDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchTeacherDetail(ownerKey, filters)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [ownerKey, filters]);

  if (loading) {
    return (
      <div className="flex justify-center py-4 text-slate-400">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }
  if (!data) return <p className="text-[12.5px] text-slate-500">Tafsilot yuklanmadi.</p>;

  return (
    <div className="space-y-3">
      {data.pages.length > 0 && (
        <div>
          <p className="mb-1.5 text-[12px] font-semibold text-slate-600">Qaysi bo‘limda qancha vaqt</p>
          <div className="flex flex-wrap gap-1.5">
            {data.pages.map((p) => (
              <span
                key={p.page}
                className="rounded-lg bg-white px-2 py-1 text-[11.5px] text-slate-700 ring-1 ring-slate-200"
              >
                {pageLabel(p.page)} · <strong className="tabular-nums">{p.minutes} daq</strong>
                <span className="text-slate-400"> ({p.opens} marta)</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {data.lessons.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[12px] font-semibold text-slate-600">
            O‘tilgan darslar ({data.lessons.length})
          </p>
          <ul className="space-y-1">
            {data.lessons.slice(0, 12).map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-[12px] ring-1 ring-slate-200"
              >
                <span className="text-slate-400">{fmtDate(l.held_at)}</span>
                <span className="font-medium text-slate-800">{l.topic || l.subject_name || '—'}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-600">
                  {l.kind_label}
                </span>
                <span className="text-slate-500">{l.students} talaba</span>
                {l.avg_score !== null && (
                  <StatusChip status={statusOf(l.avg_score, 71, 56)}>{l.avg_score}%</StatusChip>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[12.5px] text-slate-500">Bu oraliqda dars o‘tilmagan.</p>
      )}
    </div>
  );
}

/**
 * O'qituvchi holati bitta rangda:
 *   qizil   — oraliqda umuman ishlamagan, garchi jadval bo'yicha darsi bo'lgan bo'lsa ham;
 *   sariq   — kirgan, lekin na dars o'tgan, na material qo'shgan;
 *   yashil  — dars o'tgan yoki material qo'shgan;
 *   kulrang — baholanmaydi: hisobi bog'lanmagan YOKI bu kunlarda jadval bo'yicha darsi yo'q
 *             (darsi yo'q kuni kirmagan o'qituvchi "ishlamagan" emas — 2026-09-22 shikoyati).
 */
export function teacherStatus(r: TeacherRow): Status {
  if (r.schedule_linked === false) return 'none';
  if (!r.is_active) return r.scheduled_lessons === 0 ? 'none' : 'bad';
  if (r.lessons_total > 0 || r.created_total > 0) return 'good';
  return 'warn';
}

export const TEACHER_STATUS_SHORT: Record<Status, string> = {
  bad: 'Ishlamagan',
  warn: 'Faqat kirgan',
  good: 'Ishlagan',
  none: 'Hisob biriktirilmagan',
};

export const TEACHER_STATUS_TEXT: Record<Status, string> = {
  bad: 'Oraliqda iMentorga umuman kirmagan',
  warn: 'Kirgan, lekin dars ham o‘tmagan, material ham qo‘shmagan',
  good: 'Dars o‘tgan yoki material qo‘shgan',
  none: 'Jadvalda bor, iMentor hisobi bilan bog‘lanmagan. Faollik baholanmaydi.',
};

/** Kulrang holatning sababi: darsi yo'q kuni kirmagan yoki hisobi bog'lanmagan. */
function isNoLesson(r: TeacherRow): boolean {
  return r.schedule_linked !== false && !r.is_active && r.scheduled_lessons === 0;
}

export function teacherStatusShort(r: TeacherRow): string {
  return isNoLesson(r) ? 'Darsi yo‘q' : TEACHER_STATUS_SHORT[teacherStatus(r)];
}

export function teacherStatusText(r: TeacherRow): string {
  return isNoLesson(r)
    ? 'Monitor jadvali bo‘yicha bu kunlarda darsi yo‘q — baholanmaydi'
    : TEACHER_STATUS_TEXT[teacherStatus(r)];
}

export function TeachersSection({ filters, onUnauthorized }: SectionProps) {
  const { data, loading, error } = useReport<{ count: number; results: TeacherRow[] }>(
    fetchTeachers,
    filters,
    onUnauthorized,
  );
  const [openKey, setOpenKey] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | ''>('');

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox text={error} />;
  const all = data?.results || [];
  if (!all.length) return <Empty text="Bu davr va kafedra uchun monitor jadvalida o‘qituvchi topilmadi." />;
  const rows = statusFilter ? all.filter((r) => teacherStatus(r) === statusFilter) : all;
  const count = (st: Status) => all.filter((r) => teacherStatus(r) === st).length;
  const totalMinutes = all.reduce((n, r) => n + r.minutes, 0);

  return (
    <div className="space-y-2">
      <p className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
        Faqat kafedralar topshirgan monitor jadvalidagi o‘qituvchilar. Ko‘rsatkichlar tanlangan davrdagi iMentor faolligini ko‘rsatadi; monitorning o‘zida foydalanish “Monitorlar” bo‘limida.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="O‘qituvchi" value={all.length} onClick={() => setStatusFilter('')} />
        <Stat
          label="Ishlagan"
          value={count('good')}
          hint="dars o‘tgan yoki material qo‘shgan"
          status="good"
          onClick={() => setStatusFilter('good')}
        />
        <Stat
          label="Faqat kirgan"
          value={count('warn')}
          hint="kirgan, lekin natija yo‘q"
          status="warn"
          onClick={() => setStatusFilter('warn')}
        />
        <Stat
          label="Ishlamagan"
          value={count('bad')}
          hint="umuman kirmagan"
          status="bad"
          onClick={() => setStatusFilter('bad')}
        />
        <Stat
          label="Baholanmaydi"
          value={count('none')}
          hint={`darsi yo‘q: ${all.filter(isNoLesson).length} · hisob biriktirilmagan: ${all.filter((r) => r.schedule_linked === false).length}`}
          onClick={() => setStatusFilter('none')}
        />
        <Stat label="Jami vaqt" value={fmtMinutes(totalMinutes)} hint={`${all.length ? Math.round(totalMinutes / Math.max(1, all.length - count('none'))) : 0} daq o‘rtacha`} />
      </div>
      <p className="px-1 text-[12.5px] text-slate-500">
        {statusFilter ? `${TEACHER_STATUS_SHORT[statusFilter]}: ` : ''}
        {rows.length} o‘qituvchi · familiya bo‘yicha · qatorni bosing — kunma-kun va darslar ochiladi
        {statusFilter && (
          <button type="button" onClick={() => setStatusFilter('')} className="ml-2 font-semibold text-slate-700 underline">
            hammasini ko‘rsatish
          </button>
        )}
      </p>
      <SortableTable
        rows={rows}
        rowKey={(r) => r.owner_key}
        onRowClick={(r) => { if (r.schedule_linked !== false) setOpenKey((k) => (k === r.owner_key ? '' : r.owner_key)); }}
        expandedKey={openKey}
        renderExpanded={(r) => <TeacherDetailPanel ownerKey={r.owner_key} filters={filters} />}
        initialSort={{ key: 'name', dir: 'asc' }}
        cardSubtitle="status"
        columns={[
          {
            key: 'name',
            label: 'F.I.Sh.',
            value: (r) => r.display_name,
            render: (r) => (
              <span className="flex items-center gap-1.5">
                <ChevronRight
                  size={13}
                  className={`shrink-0 text-slate-300 transition ${openKey === r.owner_key ? 'rotate-90' : ''}`}
                />
                <StatusDot status={teacherStatus(r)} title={teacherStatusText(r)} />
                <span>
                  {r.schedule_linked === false ? <span className="block font-medium text-slate-900">{r.display_name}</span> : <TeacherName teacherKey={r.owner_key} name={r.display_name} className="block font-medium text-slate-900" />}
                  <span className="block text-[11px] text-slate-400">{r.department || '—'}</span>
                </span>
              </span>
            ),
          },
          {
            key: 'status',
            label: 'Holat',
            value: (r) => STATUS_ORDER[teacherStatus(r)],
            render: (r) => {
              const st = teacherStatus(r);
              return (
                <StatusChip status={st} title={teacherStatusText(r)}>
                  {teacherStatusShort(r)}
                </StatusChip>
              );
            },
          },
          {
            key: 'minutes',
            label: 'Vaqt',
            align: 'right',
            value: (r) => r.minutes,
            render: (r) =>
              r.schedule_linked === false ? <span className="text-slate-400">—</span> : r.minutes ? (
                fmtMinutes(r.minutes)
              ) : (
                <StatusChip status="bad">kirmagan</StatusChip>
              ),
          },
          { key: 'active_days', label: 'Faol kun', align: 'right', value: (r) => r.active_days },
          ...MODULES.map((m) => ({
            key: `mod_${m.key}`,
            label: `${m.label}, daq`,
            align: 'right' as const,
            value: (r: TeacherRow) => moduleMinutes(r.pages)[m.key],
            render: (r: TeacherRow) => minutesCell(moduleMinutes(r.pages)[m.key]),
          })),
          {
            key: 'mod_other',
            label: 'Boshqa, daq',
            align: 'right',
            value: (r) => moduleMinutes(r.pages).other,
            render: (r) => minutesCell(moduleMinutes(r.pages).other),
          },
          { key: 'cases', label: 'Masala', align: 'right', value: (r) => r.cases_created },
          { key: 'tests', label: 'Test', align: 'right', value: (r) => r.tests_created },
          { key: 'handouts', label: 'Tarqatma', align: 'right', value: (r) => r.handouts_created },
          { key: 'videos', label: 'Video', align: 'right', value: (r) => r.videos_created },
          {
            key: 'presentations',
            label: 'Taqdimot',
            align: 'right',
            value: (r) => r.presentations_created,
          },
          {
            key: 'lessons',
            label: 'Dars',
            align: 'right',
            value: (r) => r.lessons_total,
            render: (r) => (
              <span title={`Jonli test: ${r.live_sessions}, online: ${r.online_lessons}`}>
                {r.lessons_total}
              </span>
            ),
          },
          { key: 'students', label: 'Talaba', align: 'right', value: (r) => r.students_taught },
          {
            key: 'score',
            label: 'O‘rtacha ball',
            align: 'right',
            value: (r) => r.avg_student_score,
            render: (r) =>
              r.avg_student_score === null ? (
                <span className="text-slate-300">—</span>
              ) : (
                <StatusChip status={statusOf(r.avg_student_score, 71, 56)}>
                  {r.avg_student_score}%
                </StatusChip>
              ),
          },
        ]}
      />
    </div>
  );
}

/* ==================== Kafedralar (foydalanish) ==================== */

type DeptUsage = {
  department: string;
  teachers: TeacherRow[];
  good: number;
  warn: number;
  bad: number;
  minutes: number;
  modules: Record<string, number>;
  lessons: number;
  created: number;
  students: number;
  workedPercent: number | null;
};

function aggregateDepartments(rows: TeacherRow[]): DeptUsage[] {
  const map = new Map<string, DeptUsage>();
  for (const r of rows) {
    const name = r.department || 'Kafedrasi ko‘rsatilmagan';
    let d = map.get(name);
    if (!d) {
      d = { department: name, teachers: [], good: 0, warn: 0, bad: 0, minutes: 0, modules: moduleMinutes([]), lessons: 0, created: 0, students: 0, workedPercent: null };
      map.set(name, d);
    }
    d.teachers.push(r);
    const st = teacherStatus(r);
    if (st !== 'none') d[st] += 1;
    d.minutes += r.minutes;
    const mm = moduleMinutes(r.pages);
    for (const k of Object.keys(mm)) d.modules[k] = (d.modules[k] || 0) + mm[k];
    d.lessons += r.lessons_total;
    d.created += r.created_total;
    d.students += r.students_taught;
  }
  for (const d of map.values()) d.workedPercent = share(d.good, d.good + d.warn + d.bad);
  return [...map.values()];
}

/**
 * Har kafedra bo'yicha: nechta o'qituvchi ishlagan (yashil), faqat kirgan
 * (sariq), umuman kirmagan (qizil), jami va modullar bo'yicha daqiqa.
 * Kafedra qatorini bosganda uning o'qituvchilari familiya bo'yicha ochiladi.
 */
export function DepartmentsUsageSection({ filters, onUnauthorized }: SectionProps) {
  const { data, loading, error } = useReport<{ count: number; results: TeacherRow[] }>(
    fetchTeachers,
    filters,
    onUnauthorized,
  );
  const [openDept, setOpenDept] = useState('');
  const depts = useMemo(() => aggregateDepartments(data?.results || []), [data]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox text={error} />;
  if (!depts.length) return <Empty text="Bu shartlarga mos kafedra topilmadi." />;

  const teachers = depts.reduce((n, d) => n + d.teachers.length, 0);
  const good = depts.reduce((n, d) => n + d.good, 0);
  const linked = depts.reduce((n, d) => n + d.good + d.warn + d.bad, 0);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Kafedra" value={depts.length} />
        <Stat label="O‘qituvchi" value={teachers} />
        <Stat label="Ishlagan" value={`${share(good, linked) ?? 0}%`} hint={`${good} ta o‘qituvchi`} status={statusOf(share(good, linked))} />
        <Stat label="Jami vaqt" value={fmtMinutes(depts.reduce((n, d) => n + d.minutes, 0))} />
      </div>
      <p className="px-1 text-[12.5px] text-slate-500">
        Faqat monitor jadvalidagi o‘qituvchilar. Hisob biriktirilmaganlar baholanmaydi. Rang — hisobi biriktirilganlardan ishlaganlar ulushi: 70% va undan ko‘p — yashil, 40–69% — sariq, 40% dan kam — qizil. Qatorni bosing — o‘qituvchilari ochiladi.
      </p>
      <SortableTable
        rows={depts}
        rowKey={(d) => d.department}
        onRowClick={(d) => setOpenDept((k) => (k === d.department ? '' : d.department))}
        expandedKey={openDept}
        renderExpanded={(d) => <DeptTeachers rows={d.teachers} />}
        initialSort={{ key: 'worked', dir: 'asc' }}
        cardSubtitle="worked"
        columns={[
          {
            key: 'name',
            label: 'Kafedra',
            value: (d) => d.department,
            render: (d) => (
              <span className="flex items-center gap-1.5">
                <ChevronRight size={13} className={`shrink-0 text-slate-300 transition ${openDept === d.department ? 'rotate-90' : ''}`} />
                <StatusDot status={statusOf(d.workedPercent)} />
                <span className="font-medium text-slate-900">{d.department}</span>
              </span>
            ),
          },
          {
            key: 'worked',
            label: 'Ishlagan',
            align: 'right',
            value: (d) => d.workedPercent,
            render: (d) => <StatusChip status={statusOf(d.workedPercent)}>{d.workedPercent ?? 0}%</StatusChip>,
          },
          { key: 'teachers', label: 'O‘qituvchi', align: 'right', value: (d) => d.teachers.length },
          { key: 'good', label: 'Yashil', align: 'right', value: (d) => d.good, render: (d) => <StatusChip status="good">{d.good}</StatusChip> },
          { key: 'warn', label: 'Sariq', align: 'right', value: (d) => d.warn, render: (d) => <StatusChip status="warn">{d.warn}</StatusChip> },
          { key: 'bad', label: 'Qizil', align: 'right', value: (d) => d.bad, render: (d) => <StatusChip status="bad">{d.bad}</StatusChip> },
          { key: 'minutes', label: 'Jami vaqt', align: 'right', value: (d) => d.minutes, render: (d) => fmtMinutes(d.minutes) },
          {
            key: 'avg',
            label: 'O‘rtacha',
            align: 'right',
            value: (d) => Math.round(d.minutes / Math.max(1, d.teachers.length)),
            render: (d) => fmtMinutes(Math.round(d.minutes / Math.max(1, d.teachers.length))),
          },
          ...MODULES.map((m) => ({
            key: `mod_${m.key}`,
            label: `${m.label}, daq`,
            align: 'right' as const,
            value: (d: DeptUsage) => d.modules[m.key] || 0,
            render: (d: DeptUsage) => minutesCell(d.modules[m.key] || 0),
          })),
          { key: 'lessons', label: 'Dars', align: 'right', value: (d) => d.lessons },
          { key: 'created', label: 'Material', align: 'right', value: (d) => d.created },
          { key: 'students', label: 'Talaba', align: 'right', value: (d) => d.students },
        ]}
      />
    </div>
  );
}

function DeptTeachers({ rows }: { rows: TeacherRow[] }) {
  const [q, setQ] = useState('');
  const shown = rows.filter((r) => !q || r.display_name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-2">
      <label className="flex max-w-xs items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2">
        <Search size={13} className="text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Familiya bo‘yicha qidirish" className="w-full bg-transparent py-1 text-[12px] outline-none" />
      </label>
      <SortableTable
        rows={shown}
        rowKey={(r) => r.owner_key}
        initialSort={{ key: 'name', dir: 'asc' }}
        cardSubtitle="status"
        columns={[
          {
            key: 'name',
            label: 'F.I.Sh.',
            value: (r) => r.display_name,
            render: (r) => (
              <span className="flex items-center gap-1.5">
                <StatusDot status={teacherStatus(r)} title={teacherStatusText(r)} />
                {r.schedule_linked === false ? <span>{r.display_name}</span> : <TeacherName teacherKey={r.owner_key} name={r.display_name} className="font-medium text-slate-900" />}
              </span>
            ),
          },
          {
            key: 'status',
            label: 'Holat',
            value: (r) => STATUS_ORDER[teacherStatus(r)],
            render: (r) => <StatusChip status={teacherStatus(r)} title={teacherStatusText(r)}>{teacherStatusShort(r)}</StatusChip>,
          },
          { key: 'minutes', label: 'Vaqt', align: 'right', value: (r) => r.minutes, render: (r) => fmtMinutes(r.minutes) },
          ...MODULES.map((m) => ({
            key: `mod_${m.key}`,
            label: `${m.label}, daq`,
            align: 'right' as const,
            value: (r: TeacherRow) => moduleMinutes(r.pages)[m.key],
            render: (r: TeacherRow) => minutesCell(moduleMinutes(r.pages)[m.key]),
          })),
          { key: 'lessons', label: 'Dars', align: 'right', value: (r) => r.lessons_total },
          { key: 'created', label: 'Material', align: 'right', value: (r) => r.created_total },
          { key: 'last', label: 'Oxirgi kirish', align: 'right', value: (r) => r.last_login || '', render: (r) => <span className="text-slate-500">{fmtDate(r.last_login)}</span> },
        ]}
      />
    </div>
  );
}

/* ==================== 3. Talabalar ==================== */

/** Baho svetofor rangida: a'lo va yaxshi — yashil, qoniqarli — sariq, qoniqarsiz — qizil. */
export const BAND_LABEL: Record<string, { label: string; status: Status }> = {
  alo: { label: "A'lo", status: 'good' },
  yaxshi: { label: 'Yaxshi', status: 'good' },
  qoniqarli: { label: 'Qoniqarli', status: 'warn' },
  qoniqarsiz: { label: 'Qoniqarsiz', status: 'bad' },
};

export function StudentsSection({ filters, onUnauthorized }: SectionProps) {
  const { data, loading, error } = useReport<{ count: number; results: StudentRow[] }>(
    fetchStudents,
    filters,
    onUnauthorized,
  );

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox text={error} />;
  const rows = data?.results || [];
  if (!rows.length) {
    return <Empty text="Bu oraliqda test topshirgan talaba topilmadi." />;
  }

  const avg =
    rows.reduce((n, r) => n + (r.score_total || 0), 0) > 0
      ? Math.round(
          (rows.reduce((n, r) => n + r.score_sum, 0) / rows.reduce((n, r) => n + r.score_total, 0)) * 1000,
        ) / 10
      : null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricStat label="Talaba" value={rows.length} />
        <MetricStat label="Urinishlar" value={rows.reduce((n, r) => n + r.attempts, 0)} />
        <MetricStat
          label="O‘rtacha ball"
          value={avg === null ? '—' : `${avg}%`}
          status={statusOf(avg, 71, 56)}
        />
        <MetricStat
          label="Qoniqarsiz"
          value={rows.filter((r) => r.band === 'qoniqarsiz').length}
          hint={`${share(rows.filter((r) => r.band === 'qoniqarsiz').length, rows.length) ?? 0}% — 56% dan past`}
          status={statusOfLow(
            share(rows.filter((r) => r.band === 'qoniqarsiz').length, rows.length),
            15,
            35,
          )}
        />
      </div>

      <SortableTable
        rows={rows}
        rowKey={(r) => r.student_id}
        initialSort={{ key: 'name', dir: 'asc' }}
        cardSubtitle="score"
        columns={[
          {
            key: 'name',
            label: 'Talaba',
            value: (r) => r.display_name,
            render: (r) => (
              <span>
                <StudentName studentKey={r.student_id} name={r.display_name} className="block font-medium text-slate-900" />
                <span className="block font-mono text-[11px] text-slate-400">{r.student_id.startsWith('name:') ? 'ID kiritilmagan' : r.student_id}</span>
              </span>
            ),
          },
          { key: 'attempts', label: 'Test', align: 'right', value: (r) => r.attempts },
          { key: 'subjects', label: 'Fan', align: 'right', value: (r) => r.subjects },
          {
            key: 'correct',
            label: 'To‘g‘ri javob',
            align: 'right',
            value: (r) => r.score_sum,
            render: (r) => `${r.score_sum}/${r.score_total}`,
          },
          {
            key: 'score',
            label: 'O‘rtacha',
            align: 'right',
            value: (r) => r.avg_percent,
            render: (r) =>
              r.avg_percent === null ? (
                <span className="text-slate-300">—</span>
              ) : (
                <StatusChip status={statusOf(r.avg_percent, 71, 56)}>{r.avg_percent}%</StatusChip>
              ),
          },
          {
            key: 'band',
            label: 'Baho',
            value: (r) => r.band,
            render: (r) => {
              const b = BAND_LABEL[r.band];
              if (!b) return <span className="text-slate-300">—</span>;
              return <StatusChip status={b.status}>{b.label}</StatusChip>;
            },
          },
          {
            key: 'minutes',
            label: 'Testda vaqt',
            align: 'right',
            value: (r) => r.minutes,
            render: (r) => fmtMinutes(r.minutes),
          },
          {
            key: 'last',
            label: 'Oxirgi test',
            align: 'right',
            value: (r) => r.last_at || '',
            render: (r) => <span className="text-slate-500">{fmtDate(r.last_at)}</span>,
          },
        ]}
      />
    </div>
  );
}

/* ==================== 4. Darslar ==================== */

export function LessonsSection({ filters, onUnauthorized }: SectionProps) {
  const { data, loading, error } = useReport<{ count: number; results: LessonRow[] }>(
    fetchLessons,
    filters,
    onUnauthorized,
  );

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox text={error} />;
  const rows = data?.results || [];
  if (!rows.length) return <Empty text="Bu oraliqda dars o‘tilmagan." />;

  const live = rows.filter((r) => r.kind === 'live_test').length;
  const online = rows.length - live;
  const students = rows.reduce((n, r) => n + r.students, 0);
  // Talabasi yo'q dars — o'tkazilmagan yoki QR ulashilmagan dars belgisi.
  const empty = rows.filter((r) => r.students === 0).length;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricStat label="Jami dars" value={rows.length} />
        <MetricStat label="Jonli (QR) test" value={live} />
        <MetricStat label="Online video dars" value={online} />
        <MetricStat
          label="Talabasiz dars"
          value={empty}
          hint={`${students} ta qatnashuv (takroriy hisobda)`}
          status={statusOfLow(share(empty, rows.length), 10, 30)}
        />
      </div>

      <SortableTable
        rows={rows}
        rowKey={(r) => r.id}
        cardPrimary="teacher"
        cardSubtitle="subject"
        initialSort={{ key: 'held', dir: 'desc' }}
        columns={[
          {
            key: 'held',
            label: 'Sana',
            value: (r) => r.held_at || '',
            render: (r) => <span className="whitespace-nowrap text-slate-600">{fmtDate(r.held_at)}</span>,
          },
          {
            key: 'teacher',
            label: "O'qituvchi",
            value: (r) => r.teacher_name,
            render: (r) => (
              <span>
                <TeacherName teacherKey={r.teacher_key} name={r.teacher_name} className="block font-medium text-slate-900" />
                <span className="block text-[11px] text-slate-400">{r.department || '—'}</span>
              </span>
            ),
          },
          {
            key: 'kind',
            label: 'Turi',
            value: (r) => r.kind_label,
            render: (r) => (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-600">
                {r.kind === 'live_test' ? (
                  <ClipboardList size={13} className="text-emerald-600" />
                ) : (
                  <Radio size={13} className="text-sky-600" />
                )}
                {r.kind_label}
              </span>
            ),
          },
          {
            key: 'subject',
            label: 'Fan / mavzu',
            value: (r) => r.subject_name || r.topic,
            render: (r) => (
              <span>
                <span className="block text-slate-800">{r.topic || '—'}</span>
                <span className="block text-[11px] text-slate-400">
                  {r.subject_name || 'fan biriktirilmagan'}
                  {r.group_name ? ` · ${r.group_name}` : ''}
                </span>
              </span>
            ),
          },
          {
            key: 'students',
            label: 'Talaba',
            align: 'right',
            value: (r) => r.students,
            render: (r) =>
              r.students ? (
                r.students
              ) : (
                <StatusChip status="bad" title="Darsga birorta ham talaba qatnashmagan">
                  0
                </StatusChip>
              ),
          },
          {
            key: 'score',
            label: 'O‘rtacha ball',
            align: 'right',
            value: (r) => r.avg_score,
            render: (r) =>
              r.avg_score === null ? (
                <span className="text-slate-300">—</span>
              ) : (
                <StatusChip status={statusOf(r.avg_score, 71, 56)}>{r.avg_score}%</StatusChip>
              ),
          },
        ]}
      />
    </div>
  );
}
