import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ListChecks } from 'lucide-react';
import { HttpError } from '../api/httpClient';
import {
  fetchDepartments,
  fetchOverview,
  fetchTeachers,
  type DepartmentRow,
  type DepartmentsResponse,
  type Overview,
  type ReportFilters,
  type TeacherRow,
} from './rectorApi';
import { isDormant } from './RectorCoverage';
import { useOpenMetric } from './RectorMetric';
import {
  ErrorBox,
  SortableTable,
  Spinner,
  STATUS_BAR,
  STATUS_CHIP,
  STATUS_LABEL,
  STATUS_VALUE,
  StatusChip,
  StatusDot,
  statusOf,
  statusOfLow,
  type Status,
} from './RectorUi';

/**
 * Institut holati — rektor sahifani ochganda birinchi ko'radigan narsa.
 *
 * Raqamlar ro'yxati rektorga savol qoldiradi: "37 — bu yaxshimi?". Bu
 * bo'lim o'sha savolga o'zi javob beradi: har bir yo'nalish bo'yicha
 * bitta rang, bitta raqam va ODDIY TILDAGI xulosa, qizildan boshlab. Har
 * xulosa ortidagi ro'yxat bir bosishda ochiladi.
 *
 * Chegaralar (masalan faollik 60% dan yuqori — yashil) shu faylda turadi:
 * ular hisob emas, baho — o'zgartirish kerak bo'lsa, bitta joyda.
 */

export type HealthTab = 'departments' | 'gaps' | 'teachers' | 'students' | 'lessons' | 'trend';

export type Verdict = {
  key: string;
  area: string;
  title: string;
  figure: string;
  status: Status;
  sentence: string;
  advice?: string;
  metric?: string;
  tab?: HealthTab;
};

const ORDER: Record<Status, number> = { bad: 0, warn: 1, good: 2, none: 3 };

export const HEADLINE: Record<Status, string> = {
  bad: 'Jiddiy e’tibor talab qilinadi',
  warn: 'Ayrim yo‘nalishlarda e’tibor kerak',
  good: 'Institut bo‘yicha holat yaxshi',
  none: 'Baholash uchun ma’lumot yetarli emas',
};

function share(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part * 100) / whole) : null;
}

function pctText(v: number | null): string {
  return v === null ? '—' : `${v}%`;
}

/** Ikki holatdan yomonrog'i; "ma'lumot yo'q" boshqasini bosib ketmaydi. */
function worst(a: Status, b: Status): Status {
  if (a === 'none') return b;
  if (b === 'none') return a;
  return ORDER[a] <= ORDER[b] ? a : b;
}

export function buildVerdicts(ov: Overview, teachers: TeacherRow[], departments: DepartmentRow[]): Verdict[] {
  const t = ov.teachers;
  const s = ov.students;
  const o = ov.online;
  const out: Verdict[] = [];

  // ---------- O'qituvchilar ----------
  const activePct = share(t.active, t.total);
  out.push({
    key: 'activity',
    area: 'O‘qituvchilar',
    title: 'iMentordan foydalanish',
    figure: pctText(activePct),
    status: statusOf(activePct, 60, 30),
    sentence: `${t.total} o‘qituvchidan ${t.active} tasi shu oraliqda iMentorda ishladi, ${t.inactive} tasi umuman kirmadi.`,
    advice: 'Kirmaganlar ro‘yxatini oching va kafedra mudirlariga yuboring.',
    metric: 'teachers_inactive',
  });

  const lessonTeachers = teachers.filter((x) => x.lessons_total > 0).length;
  const lessons = t.live_sessions + t.online_lessons;
  const lessonPct = share(lessonTeachers, t.total);
  out.push({
    key: 'lessons',
    area: 'O‘qituvchilar',
    title: 'iMentor orqali dars o‘tish',
    figure: pctText(lessonPct),
    status: statusOf(lessonPct, 40, 15),
    sentence: `${lessonTeachers} o‘qituvchi kamida bitta dars o‘tdi (QR test yoki online dars) — jami ${lessons} ta dars.`,
    advice: 'Darsni iMentorsiz o‘tayotganlarni “O‘qituvchilar” bo‘limida “Dars” ustuni bo‘yicha saralab toping.',
    metric: 'lessons_total',
    tab: 'teachers',
  });

  const creators = teachers.filter((x) => x.created_total > 0).length;
  const creatorPct = share(creators, t.total);
  out.push({
    key: 'materials',
    area: 'O‘qituvchilar',
    title: 'Material yaratish',
    figure: pctText(creatorPct),
    status: statusOf(creatorPct, 40, 15),
    sentence:
      `${creators} o‘qituvchi material qo‘shdi: ${t.cases_created} vaziyatli masala, ${t.tests_created} test, ` +
      `${t.handouts_created} tarqatma, ${t.videos_created} video, ${t.presentations_created} taqdimot.`,
    advice: 'Material qo‘shmagan kafedralardan har bir mavzu uchun reja so‘rang.',
    tab: 'teachers',
  });

  // ---------- Talabalar ----------
  if (!s.total) {
    out.push({
      key: 'grades',
      area: 'Talabalar',
      title: 'O‘zlashtirish',
      figure: '—',
      status: 'none',
      sentence: 'Bu oraliqda iMentor orqali test topshirgan talaba yo‘q — natijani baholab bo‘lmaydi.',
    });
  } else {
    const failing = s.bands.find((b) => b.key === 'qoniqarsiz')?.count ?? 0;
    const failPct = share(failing, s.total);
    out.push({
      key: 'grades',
      area: 'Talabalar',
      title: 'O‘zlashtirish',
      figure: pctText(s.avg_percent === null ? null : Math.round(s.avg_percent)),
      status: statusOf(s.avg_percent, 71, 56),
      sentence: `${s.total} talaba ${s.attempts} marta test topshirdi, o‘rtacha natija ${s.avg_percent ?? '—'}%.`,
      advice: 'Natijasi past fanlarni “Talabalar” bo‘limida fan filtri bilan toping.',
      metric: 'students_avg',
      tab: 'students',
    });
    out.push({
      key: 'failing',
      area: 'Talabalar',
      title: 'Qoniqarsiz baho olganlar',
      figure: pctText(failPct),
      status: statusOfLow(failPct, 15, 35),
      sentence: `${failing} talaba (${failPct ?? 0}%) 56% dan past natija ko‘rsatdi.`,
      advice: 'Ro‘yxatni oching — qayta topshirish yoki qo‘shimcha mashg‘ulot kerak.',
      metric: 'band_qoniqarsiz',
    });
  }

  // ---------- Materiallar va kafedralar ----------
  const live = departments.filter((d) => !isDormant(d));
  const topics = live.reduce((n, d) => n + d.topics, 0);
  const covered = live.reduce((n, d) => n + d.topics_covered, 0);
  const kind = (k: string) => live.reduce((n, d) => n + (d.coverage[k] || 0), 0);

  const coverPct = share(covered, topics);
  out.push({
    key: 'coverage',
    area: 'Materiallar',
    title: 'Mavzular material bilan ta’minlangani',
    figure: pctText(coverPct),
    status: statusOf(coverPct, 70, 30),
    sentence: `${topics} mavzudan ${covered} tasida kamida bitta material bor, ${topics - covered} tasi bo‘m-bo‘sh.`,
    advice: 'Bo‘sh mavzular ro‘yxati “Kamchiliklar” bo‘limida kafedrasi bilan turibdi.',
    tab: 'gaps',
  });

  const lecture = kind('lecture');
  const lecturePct = share(lecture, topics);
  out.push({
    key: 'lecture',
    area: 'Materiallar',
    title: 'Ma’ruza matni',
    figure: pctText(lecturePct),
    status: statusOf(lecturePct, 60, 20),
    sentence: `Ma’ruza matni ${topics} mavzudan faqat ${lecture} tasida bor.`,
    advice: 'Kafedralarga ma’ruza matnlarini iMentorga yuklash muddatini belgilang.',
    tab: 'departments',
  });

  const video = kind('video');
  const videoPct = share(video, topics);
  out.push({
    key: 'video',
    area: 'Materiallar',
    title: 'Video darslar',
    figure: pctText(videoPct),
    status: statusOf(videoPct, 40, 10),
    sentence: `Video dars ${topics} mavzudan ${video} tasida bor.`,
    advice: 'Qaysi kafedrada video umuman yo‘qligini “Kafedralar” bo‘limidagi “Video yo‘q” tugmasi ko‘rsatadi.',
    tab: 'departments',
  });

  const test = kind('test');
  const testPct = share(test, topics);
  out.push({
    key: 'test',
    area: 'Materiallar',
    title: 'Testlar bilan ta’minlanish',
    figure: pctText(testPct),
    status: statusOf(testPct, 50, 15),
    sentence: `Test ${topics} mavzudan ${test} tasida tayyorlangan.`,
    advice: 'Test yo‘q mavzular uchun AI yordamida test yaratishni tavsiya qiling.',
    tab: 'departments',
  });

  const noSyllabus = live.filter((d) => !d.has_syllabus);
  out.push({
    key: 'syllabus',
    area: 'Kafedralar',
    title: 'Sillabusi yo‘q faol kafedralar',
    figure: live.length ? String(noSyllabus.length) : '—',
    status: live.length ? statusOfLow(noSyllabus.length, 0, 3) : 'none',
    sentence: !live.length
      ? 'Faol kafedralar haqida ma’lumot yo‘q — sillabus holatini baholab bo‘lmaydi.'
      : noSyllabus.length
      ? `${noSyllabus.length} ta kafedrada birorta ham sillabus kiritilmagan: ` +
        `${noSyllabus.slice(0, 4).map((d) => d.name).join(', ')}${noSyllabus.length > 4 ? ' va boshqalar' : ''}.`
      : 'Har bir faol kafedrada sillabus kiritilgan.',
    advice: 'Sillabussiz kafedrada mavzu ham, material ham bo‘lmaydi — birinchi navbatda shu.',
    tab: 'gaps',
  });

  // ---------- Online ta'lim va malaka ----------
  if (!o.attendance_visits && !o.online_tests_submitted) {
    out.push({
      key: 'online',
      area: 'Online ta’lim',
      title: 'Online darslar',
      figure: '—',
      status: 'none',
      sentence: 'Bu oraliqda online dars ham, online test ham bo‘lmadi.',
    });
  } else {
    out.push({
      key: 'online',
      area: 'Online ta’lim',
      title: 'Online darslar',
      figure: String(o.attendance_students),
      status: o.online_avg_percent === null ? 'good' : statusOf(o.online_avg_percent, 71, 56),
      sentence:
        `${o.attendance_students} talaba online darsga ${o.attendance_visits} marta qatnashdi; ` +
        `${o.online_tests_submitted} ta online test topshirildi` +
        `${o.online_avg_percent === null ? '' : `, o‘rtacha ${o.online_avg_percent}%`}.`,
      metric: 'online_attendance_students',
    });
  }

  if (!o.malaka_attempts) {
    out.push({
      key: 'malaka',
      area: 'Malaka oshirish',
      title: 'Tinglovchilar natijasi',
      figure: '—',
      status: 'none',
      sentence: 'Bu oraliqda malaka oshirish testlari topshirilmadi.',
    });
  } else {
    out.push({
      key: 'malaka',
      area: 'Malaka oshirish',
      title: 'Tinglovchilar natijasi',
      figure: pctText(o.malaka_avg_percent === null ? null : Math.round(o.malaka_avg_percent)),
      status: statusOf(o.malaka_avg_percent, 71, 56),
      sentence: `${o.malaka_listeners} tinglovchi ${o.malaka_attempts} marta test topshirdi, o‘rtacha ${o.malaka_avg_percent ?? '—'}%.`,
      metric: 'malaka_attempts',
    });
  }

  return out.sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}

export type DepartmentHealth = {
  id: number;
  name: string;
  teachers: number;
  active: number;
  activePct: number | null;
  activity: Status;
  ready: number | null;
  readiness: Status;
  overall: Status;
  missing: string[];
  hasSyllabus: boolean;
};

export function departmentHealth(departments: DepartmentRow[], only: string): DepartmentHealth[] {
  return departments
    .filter((d) => !isDormant(d) && (d.teachers > 0 || d.syllabuses > 0))
    .filter((d) => !only || d.name === only)
    .map((d) => {
      const activePct = share(d.teachers_active, d.teachers);
      const activity: Status = d.teachers ? statusOf(activePct, 60, 30) : 'none';
      const readiness: Status = !d.has_syllabus
        ? 'bad'
        : d.topics
          ? statusOf(d.ready_percent, 70, 30)
          : 'none';
      return {
        id: d.id,
        name: d.name,
        teachers: d.teachers,
        active: d.teachers_active,
        activePct,
        activity,
        ready: d.topics ? d.ready_percent : null,
        readiness,
        overall: worst(readiness, activity),
        missing: d.missing_kinds,
        hasSyllabus: d.has_syllabus,
      };
    });
}

export function countStatuses(items: Array<{ status: Status }>): Record<Status, number> {
  const counts: Record<Status, number> = { bad: 0, warn: 0, good: 0, none: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

/** Umumiy holat: 3+ qizil — qizil; 1+ qizil yoki 3+ sariq — sariq. Ekran va PDF uchun bitta qoida. */
export function overallStatus(counts: Record<Status, number>): Status {
  if (counts.bad >= 3) return 'bad';
  if (counts.bad >= 1 || counts.warn >= 3) return 'warn';
  return counts.good ? 'good' : 'none';
}

type Loaded = { ov: Overview; teachers: TeacherRow[]; deps: DepartmentsResponse };

export function HealthSection({
  filters,
  onUnauthorized,
  onGoTab,
}: {
  filters: ReportFilters;
  onUnauthorized: () => void;
  onGoTab: (tab: HealthTab) => void;
}) {
  const openMetric = useOpenMetric();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const { from, to, department, refreshKey } = filters;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      fetchOverview({ from, to, department }),
      fetchTeachers({ from, to, department }),
      fetchDepartments({ from, to }),
    ])
      .then(([ov, t, deps]) => {
        if (!alive) return;
        setData({ ov, teachers: t.results, deps });
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
  }, [from, to, department, refreshKey, onUnauthorized]);

  const verdicts = useMemo(
    () => (data ? buildVerdicts(data.ov, data.teachers, data.deps.results) : []),
    [data],
  );
  const league = useMemo(
    () => (data ? departmentHealth(data.deps.results, department || '') : []),
    [data, department],
  );

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox text={error} />;
  if (!data) return null;

  const counts = countStatuses(verdicts);
  const overall = overallStatus(counts);

  const leagueCounts: Record<Status, number> = { bad: 0, warn: 0, good: 0, none: 0 };
  for (const d of league) leagueCounts[d.overall] += 1;

  return (
    <div className="space-y-4">
      {/* ---------- Umumiy xulosa ---------- */}
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white py-4 pl-6 pr-4">
        <span className={`absolute inset-y-0 left-0 w-2 ${STATUS_BAR[overall]}`} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Institut umumiy holati · {from} — {to}
              {department ? ` · ${department}` : ''}
            </p>
            <p className={`mt-1 text-[22px] font-bold leading-tight ${STATUS_VALUE[overall]}`}>
              {HEADLINE[overall]}
            </p>
            <p className="mt-1 text-[13px] text-slate-600">
              {verdicts.length} ta yo‘nalishdan {counts.bad} tasi qizil, {counts.warn} tasi sariq,{' '}
              {counts.good} tasi yashil
              {counts.none ? `, ${counts.none} tasida ma’lumot yo‘q` : ''}. Pastda — eng muhimidan
              boshlab.
            </p>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {(['bad', 'warn', 'good', 'none'] as Status[]).map((st) => (
              <div key={st} className={`min-w-[4.5rem] rounded-xl px-2 py-2 text-center ${STATUS_CHIP[st]}`}>
                <p className="text-[22px] font-bold leading-none tabular-nums">{counts[st]}</p>
                <p className="mt-1 text-[10.5px] font-semibold">{STATUS_LABEL[st]}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Yo'nalishlar bo'yicha xulosalar ---------- */}
      <section>
        <h2 className="mb-2 px-1 text-[13px] font-bold uppercase tracking-wide text-slate-500">
          Yo‘nalishlar bo‘yicha xulosa
        </h2>
        <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
          {verdicts.map((v) => {
            const metric = v.metric;
            const tab = v.tab;
            const needsAction = v.status === 'bad' || v.status === 'warn';
            return (
              <article
                key={v.key}
                className="relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white py-3 pl-5 pr-3.5"
              >
                <span className={`absolute inset-y-0 left-0 w-1.5 ${STATUS_BAR[v.status]}`} />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                      {v.area}
                    </p>
                    <p className="text-[14.5px] font-bold text-slate-900">{v.title}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-[26px] font-bold leading-none tabular-nums ${STATUS_VALUE[v.status]}`}>
                      {v.figure}
                    </p>
                    <span className="mt-1 inline-block">
                      <StatusChip status={v.status}>{STATUS_LABEL[v.status]}</StatusChip>
                    </span>
                  </div>
                </div>

                <p className="mt-2 text-[13px] leading-relaxed text-slate-700">{v.sentence}</p>

                {needsAction && v.advice && (
                  <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12.5px] leading-relaxed text-slate-600">
                    <span className="font-semibold text-slate-700">Nima qilish kerak: </span>
                    {v.advice}
                  </p>
                )}

                {(metric || tab) && (
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-2.5">
                    {metric && (
                      <button
                        type="button"
                        onClick={() => openMetric(metric)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <ListChecks size={13} />
                        Ro‘yxatni ko‘rish
                      </button>
                    )}
                    {tab && (
                      <button
                        type="button"
                        onClick={() => onGoTab(tab)}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-100"
                      >
                        Batafsil
                        <ArrowRight size={13} />
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* ---------- Kafedralar reytingi ---------- */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2 px-1">
          <div>
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-500">
              Kafedralar holati — qizildan boshlab
            </h2>
            <p className="text-[12px] text-slate-500">
              Rang ikki narsaning yomonrog‘i: o‘qituvchilar iMentorda ishlayaptimi va mavzular material
              bilan ta’minlanganmi.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['bad', 'warn', 'good', 'none'] as Status[]).map((st) => (
              <StatusChip key={st} status={st}>
                {STATUS_LABEL[st]}: {leagueCounts[st]}
              </StatusChip>
            ))}
          </div>
        </div>

        <SortableTable<DepartmentHealth>
          rows={league}
          rowKey={(r) => String(r.id)}
          initialSort={{ key: 'status', dir: 'asc' }}
          columns={[
            {
              key: 'name',
              label: 'Kafedra',
              value: (r) => r.name,
              render: (r) => (
                <span className="flex items-center gap-2">
                  <StatusDot status={r.overall} />
                  <span>
                    <span className="block font-medium text-slate-900">{r.name}</span>
                    <span className="block text-[11px] text-slate-400">{r.teachers} o‘qituvchi</span>
                  </span>
                </span>
              ),
            },
            {
              key: 'status',
              label: 'Holat',
              value: (r) => ORDER[r.overall],
              render: (r) => <StatusChip status={r.overall}>{STATUS_LABEL[r.overall]}</StatusChip>,
            },
            {
              key: 'activity',
              label: 'Faol o‘qituvchi',
              align: 'right',
              value: (r) => r.activePct,
              render: (r) =>
                r.teachers ? (
                  <StatusChip status={r.activity} title={`${r.activePct ?? 0}%`}>
                    {r.active} / {r.teachers}
                  </StatusChip>
                ) : (
                  <span className="text-slate-300">—</span>
                ),
            },
            {
              key: 'ready',
              label: 'Material bilan ta’minlangan',
              align: 'right',
              value: (r) => r.ready,
              render: (r) =>
                !r.hasSyllabus ? (
                  <StatusChip status="bad">sillabus yo‘q</StatusChip>
                ) : r.ready === null ? (
                  <span className="text-slate-300">—</span>
                ) : (
                  <StatusChip status={r.readiness}>{r.ready}%</StatusChip>
                ),
            },
            {
              key: 'missing',
              label: 'Umuman yo‘q',
              value: (r) => (r.missing.length ? r.missing.length : null),
              render: (r) =>
                r.missing.length ? (
                  <span className="text-[12px] text-rose-700">{r.missing.join(', ')}</span>
                ) : (
                  <span className="text-slate-300">—</span>
                ),
            },
          ]}
        />
      </section>
    </div>
  );
}
