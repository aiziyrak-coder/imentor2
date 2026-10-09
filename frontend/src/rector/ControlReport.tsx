import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Database, MapPin, Monitor, Search, Users, Wrench } from 'lucide-react';
import { HttpError } from '../api/httpClient';
import {
  fetchControlReport,
  fetchControlStudents,
  type ControlReport as Report,
  type ControlStudents,
  type ControlTeacher,
  type ControlAttention,
  type ControlStudentRow,
  type ReportFilters,
} from './rectorApi';
import { ErrorBox, Spinner } from './RectorUi';
import PersonPanel, { type Person } from './PersonPanel';
import StatDrill, { type DrillTarget } from './StatDrill';

/**
 * Rektor nazorat paneli (2026-09-25).
 *
 * Ikki qatlam:
 *   1. MONITORLI xonada dars o'tadigan o'qituvchi shu darsda iMentor'ni
 *      ochdimi — monitor aynan shuning uchun qo'yilgan.
 *   2. Ochgani yetarli emas: qaysi bo'limda necha daqiqa turdi, nima
 *      YARATDI (test, keys, ma'ruza, taqdimot, tarqatma, video), profili
 *      to'liqmi, fan biriktirganmi, mavzulari material bilan yopilganmi.
 */

type Props = { filters: ReportFilters; onUnauthorized: () => void };

/**
 * Raqam bosilishi (2026-09-28). Sahifadagi HAR BIR statistika raqami shu
 * orqali ochiladi: `metric` — serverdagi ro'yxat kaliti, `label` — oynacha
 * sarlavhasi. Kontekst ishlatilgan: raqamlar sahifaning har joyida.
 */
const DrillContext = createContext<(t: DrillTarget) => void>(() => {});

/** Bosiladigan raqam. Ko'rinishi o'zgarmaydi — faqat bosilganda ro'yxat ochiladi. */
/**
 * Monitorli darslar ishlangan vaqt bo'yicha: to'liq o'tilgan, chegaraga yaqin,
 * kirib chiqqan, umuman ochilmagan. Rektor "ishlatgan, lekin 50 daqiqa emas"
 * darslarni alohida ko'rishni so'radi (2026-10-09): bitta foiz ularni
 * "ishlatmagan" bilan bir qopga solib qo'yardi.
 */
function WorkBuckets({
  buckets,
  total,
  minMinutes,
  nearMinutes,
  nearTeachers,
  briefTeachers,
}: {
  buckets: { full: number; near: number; brief: number; none: number };
  total: number;
  minMinutes: number;
  nearMinutes: number;
  nearTeachers: number;
  briefTeachers: number;
}) {
  const parts: BucketPart[] = [
    {
      key: 'full', value: buckets.full, bar: 'bg-emerald-500', dot: 'bg-emerald-500',
      label: `To‘liq o‘tilgan (${minMinutes}+ daq)`, metric: 'monitor_used',
      drill: 'Monitorli darsni to‘liq iMentor’da o‘tganlar', note: '',
    },
    {
      key: 'near', value: buckets.near, bar: 'bg-amber-400', dot: 'bg-amber-400',
      label: `Ishlatgan, lekin ${minMinutes} daqiqaga yetmagan (${nearMinutes}–${minMinutes - 1} daq)`,
      metric: 'short_near', drill: `Ishlatgan, lekin ${minMinutes} daqiqaga yetmagan`,
      note: `${nearTeachers} o‘qituvchi`,
    },
    {
      key: 'brief', value: buckets.brief, bar: 'bg-orange-300', dot: 'bg-orange-300',
      label: `Kirib chiqqan (${nearMinutes} daqiqadan kam)`, metric: 'short_brief',
      drill: `Kirib chiqqan (${nearMinutes} daqiqadan kam)`, note: `${briefTeachers} o‘qituvchi`,
    },
    {
      key: 'none', value: buckets.none, bar: 'bg-slate-200', dot: 'bg-slate-300',
      label: 'Dars vaqtida umuman ochilmagan', metric: '', drill: '', note: '',
    },
  ];
  return (
    <BucketStrip title="Monitorli darslar — dars vaqtida qancha ishlangan" unit="dars" parts={parts} total={total} />
  );
}

type BucketPart = {
  key: string; value: number; bar: string; dot: string; label: string; metric: string; drill: string; note: string;
};

/** Bir-birini qoplamaydigan toifalar chizig'i: yig'indisi `total` ga teng. */
function BucketStrip({ title, unit, parts, total }: { title: string; unit: string; parts: BucketPart[]; total: number }) {
  const pct = (n: number) => (total ? Math.round((100 * n) / total) : 0);
  return (
    <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
      <p className="mb-2 text-[11.5px] text-slate-400">{title}</p>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        {parts.map((p) =>
          p.value ? (
            <div
              key={p.key}
              className={p.bar}
              style={{ width: `${(100 * p.value) / total}%` }}
              title={`${p.label}: ${p.value} ${unit} (${pct(p.value)}%)`}
            />
          ) : null,
        )}
      </div>
      <div className="mt-2 grid gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
        {parts.map((p) => {
          const body = (
            <span className="flex items-baseline gap-2">
              <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${p.dot}`} />
              <span className="text-slate-600">{p.label}</span>
              <b className="ml-auto tabular-nums text-slate-900">{p.value}</b>
              <span className="w-9 text-right tabular-nums text-slate-400">{pct(p.value)}%</span>
            </span>
          );
          return (
            <div key={p.key}>
              {p.metric && p.value ? (
                <Stat metric={p.metric} label={p.drill} className="block w-full px-0 text-left">
                  {body}
                </Stat>
              ) : (
                body
              )}
              {p.note && p.value ? <p className="pl-4 text-[11px] text-slate-400">{p.note}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * O'qituvchilar kesimi: darsi borlardan kim hamma darsini o'tgan, kim faqat
 * ba'zisini, kim kirib chiqqan, kim umuman ochmagan. Har o'qituvchi FAQAT
 * bitta toifada — yig'indi nazoratdagilar soniga teng (2026-10-09).
 */
function TeacherBuckets({ h }: { h: Report['headline'] }) {
  const b = h.teacher_buckets;
  if (!b || !h.watched_teachers) return null;
  const parts: BucketPart[] = [
    {
      key: 'full', value: b.full, bar: 'bg-emerald-500', dot: 'bg-emerald-500',
      label: 'Hamma darsini o‘tgan', metric: 't_full', drill: 'Hamma darsini iMentor’da o‘tganlar', note: '',
    },
    {
      key: 'partial', value: b.partial, bar: 'bg-amber-400', dot: 'bg-amber-400',
      label: 'Qisman: ba’zi darsini o‘tgan, qolganini o‘tmagan', metric: 't_partial',
      drill: 'Ba’zi darsini o‘tgan, qolganini o‘tmaganlar',
      note: `${h.partial_missed_lessons ?? 0} dars o‘tilmay qolgan`,
    },
    {
      key: 'opened', value: b.opened, bar: 'bg-orange-300', dot: 'bg-orange-300',
      label: `Kirgan, lekin birorta darsni to‘liq (${h.min_lesson_minutes} daq) o‘tmagan`, metric: 't_opened',
      drill: 'Kirgan, lekin birorta darsni to‘liq o‘tmaganlar', note: '',
    },
    {
      key: 'none', value: b.none, bar: 'bg-rose-400', dot: 'bg-rose-400',
      label: 'Dars vaqtida umuman ochmagan', metric: 't_none',
      drill: 'Dars vaqtida iMentor’ni umuman ochmaganlar', note: '',
    },
    {
      key: 'on_leave', value: b.on_leave, bar: 'bg-slate-300', dot: 'bg-slate-300',
      label: 'Ta’tilda (HEMIS)', metric: 'on_leave', drill: 'HEMIS bo‘yicha ta’tilda', note: '',
    },
    {
      key: 'unlinked', value: b.unlinked, bar: 'bg-slate-200', dot: 'bg-slate-200',
      label: 'iMentor hisobi bog‘lanmagan', metric: 'unlinked', drill: 'HEMIS jadvalida bor, iMentor hisobi yo‘q', note: '',
    },
  ].filter((p) => p.value > 0 || ['full', 'partial', 'opened', 'none'].includes(p.key));
  return (
    <BucketStrip
      title="Darsi bor o‘qituvchilar — nechtasi darsini iMentor’da o‘tgan"
      unit="o‘qituvchi"
      parts={parts}
      total={h.watched_teachers}
    />
  );
}

function Stat({
  metric,
  label,
  children,
  className = '',
  title,
}: {
  metric: string;
  label: string;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  const drill = useContext(DrillContext);
  return (
    <button
      type="button"
      onClick={() => drill({ metric, label })}
      title={title || `${label} — ro‘yxatini ochish`}
      className={`cursor-pointer rounded-md underline-offset-4 transition-colors hover:bg-slate-900/[0.05] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${className}`}
    >
      {children}
    </button>
  );
}

const BAND_TEXT: Record<string, { bg: string; text: string; label: string }> = {
  good: { bg: 'bg-emerald-500', text: 'text-emerald-700', label: 'yaxshi' },
  warn: { bg: 'bg-amber-500', text: 'text-amber-700', label: 'o‘rtacha' },
  bad: { bg: 'bg-rose-500', text: 'text-rose-700', label: 'past' },
  none: { bg: 'bg-slate-300', text: 'text-slate-500', label: '—' },
};

function useLoad<T>(load: () => Promise<T>, deps: unknown[], onUnauthorized: () => void) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const run = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError('');
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) onUnauthorized();
      setError(err instanceof Error ? err.message : 'Yuklab bo‘lmadi');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void run();
  }, [run]);
  return { data, loading, error };
}

export function minutesText(m: number): string {
  if (!m) return '0 daq';
  if (m < 60) return `${m} daq`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} s ${m % 60} daq` : `${h} soat`;
}

/** Foizli yo'lakcha — rangi darajaga qarab. */
function Bar({ percent, band }: { percent: number; band: string }) {
  const tone = BAND_TEXT[band] || BAND_TEXT.none;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-full min-w-[60px] overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone.bg}`} style={{ width: `${Math.max(2, percent)}%` }} />
      </div>
      <span className={`w-10 shrink-0 text-right text-[13px] font-bold tabular-nums ${tone.text}`}>{percent}%</span>
    </div>
  );
}

/* ==================================================== o'qituvchilar ro'yxati */

const DEPTH: Record<string, { label: string; cls: string }> = {
  worked: { label: 'material yaratgan', cls: 'bg-emerald-100 text-emerald-800' },
  viewed: { label: 'ko‘rgan, yaratmagan', cls: 'bg-amber-100 text-amber-800' },
  visit: { label: 'kirib chiqqan', cls: 'bg-orange-100 text-orange-800' },
  none: { label: 'kirish qaydi yo‘q', cls: 'bg-rose-100 text-rose-800' },
};

/** Qatordagi kichik raqam ustuni — sarlavhasi bilan, shunda nima ekani aniq. */
function Cell({ label, value, tone = 'text-slate-700' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <span className="hidden w-[74px] shrink-0 text-right md:block">
      <span className="block text-[10.5px] text-slate-400">{label}</span>
      <span className={`block text-[12.5px] font-semibold tabular-nums ${tone}`}>{value}</span>
    </span>
  );
}

export type Flag = 'watched' | 'partial' | 'opened' | 'idle' | 'nothing' | 'profile' | 'nosubject' | 'nomaterial' | 'all';
export type Sort = 'percent' | 'minutes' | 'created' | 'lessons' | 'name';

const SORTS: Array<[Sort, string]> = [
  ['percent', 'Eng past foiz'],
  ['minutes', 'Eng kam vaqt'],
  ['created', 'Eng kam material'],
  ['lessons', 'Eng ko‘p dars'],
  ['name', 'Ism bo‘yicha'],
];

const CHIPS: Array<[Flag, string]> = [
  ['watched', 'Monitorda dars o‘tadiganlar'],
  ['partial', 'Qisman o‘tganlar'],
  ['opened', 'Kirgan, o‘tmagan'],
  ['idle', 'Umuman ochmaganlar'],
  ['nothing', 'Material yaratmaganlar'],
  ['nosubject', 'Fan biriktirmaganlar'],
  ['profile', 'Profili to‘liq emas'],
  ['nomaterial', 'Mavzusi bo‘sh fanlar'],
  ['all', 'Hammasi'],
];

export function matches(r: ControlTeacher, flag: Flag): boolean {
  switch (flag) {
    case 'watched':
      return r.monitor_lessons > 0;
    case 'partial':
      return r.state === 'partial';
    case 'opened':
      return r.state === 'opened';
    case 'idle':
      // Eski javobda `state` yo'q — o'shanda avvalgi qoida.
      return r.state ? r.state === 'none' : r.monitor_lessons > 0 && r.monitor_used === 0 && r.linked;
    case 'nothing':
      return r.linked && r.created_total === 0;
    case 'profile':
      return r.linked && (r.profile_percent ?? 0) < 100;
    case 'nosubject':
      return r.linked && r.subjects_linked === 0;
    case 'nomaterial':
      return r.material_empty > 0;
    default:
      return true;
  }
}

export function sortRows(rows: ControlTeacher[], sort: Sort): ControlTeacher[] {
  const out = [...rows];
  if (sort === 'name') out.sort((a, b) => a.teacher_name.localeCompare(b.teacher_name, 'uz'));
  else if (sort === 'minutes') out.sort((a, b) => a.minutes - b.minutes || b.monitor_lessons - a.monitor_lessons);
  else if (sort === 'created')
    out.sort((a, b) => a.created_total - b.created_total || b.monitor_lessons - a.monitor_lessons);
  else if (sort === 'lessons') out.sort((a, b) => b.lessons - a.lessons);
  else
    out.sort(
      (a, b) => (a.monitor_percent ?? 999) - (b.monitor_percent ?? 999) || b.monitor_lessons - a.monitor_lessons,
    );
  return out;
}

function TeacherRow({ r, onOpen }: { r: ControlTeacher; onOpen: (p: Person) => void }) {
  const depth = DEPTH[r.depth] || DEPTH.none;
  return (
    <li>
      <button
        type="button"
        disabled={!r.teacher_key}
        onClick={() => r.teacher_key && onOpen({ kind: 'teacher', key: r.teacher_key, name: r.teacher_name })}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
        title={r.teacher_key ? 'Batafsil hisobotini ochish' : 'iMentor hisobi yo‘q'}
      >
        <ChevronRight size={15} className={`shrink-0 ${r.teacher_key ? 'text-slate-400' : 'text-transparent'}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-slate-900">{r.teacher_name}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-slate-500">
            <span className="truncate">{r.department || '—'}</span>
            {r.linked ? (
              <span className={`rounded px-1.5 py-px text-[10.5px] font-medium ${depth.cls}`}>{depth.label}</span>
            ) : (
              <span className="rounded bg-slate-100 px-1.5 py-px text-[10.5px] text-slate-500">hisobi yo‘q</span>
            )}
            {r.linked && r.subjects_linked === 0 && (
              <span className="rounded bg-rose-50 px-1.5 py-px text-[10.5px] text-rose-700">fan biriktirilmagan</span>
            )}
            {r.linked && (r.profile_percent ?? 0) < 100 && (
              <span className="rounded bg-amber-50 px-1.5 py-px text-[10.5px] text-amber-800">
                profil {r.profile_percent ?? 0}%
              </span>
            )}
            {r.state === 'partial' && (
              <span className="rounded bg-amber-50 px-1.5 py-px text-[10.5px] font-medium text-amber-800">
                {r.monitor_missed} darsini o‘tmagan
              </span>
            )}
            {r.state === 'opened' && (
              <span className="rounded bg-orange-50 px-1.5 py-px text-[10.5px] font-medium text-orange-800">
                kirgan, to‘liq o‘tmagan
              </span>
            )}
            {(r.pending_lessons ?? 0) > 0 && (
              <span className="rounded bg-sky-50 px-1.5 py-px text-[10.5px] text-sky-800">
                yana {r.pending_lessons} dars oldinda
              </span>
            )}
          </span>
        </span>
        <Cell label="dars" value={r.monitor_lessons ? `${r.monitor_used}/${r.monitor_lessons}` : '—'} />
        <Cell label="vaqt" value={minutesText(r.minutes)} tone={r.minutes ? 'text-slate-700' : 'text-rose-600'} />
        <Cell
          label="yaratgan"
          value={r.created_total}
          tone={r.created_total ? 'text-emerald-700' : 'text-rose-600'}
        />
        <Cell label="material" value={r.material_percent === null ? '—' : `${r.material_percent}%`} />
        <span className="w-[118px] shrink-0">
          {r.monitor_percent === null ? (
            <span className="block text-right text-[12px] text-slate-400">nazoratda emas</span>
          ) : (
            <Bar percent={r.monitor_percent} band={r.band} />
          )}
        </span>
      </button>
    </li>
  );
}

/** Tepasida aqlli filtr, qidiruv va tartib — rektor kerakli ro'yxatni bir bosishda oladi. */
/**
 * Monitorli xonada darsi UMUMAN yo'q o'qituvchilar: klinika bazasi,
 * dispanser, masofaviy dars. Ularni monitor bo'yicha baholab bo'lmaydi,
 * shuning uchun asosiy ro'yxatda emas — lekin ko'rinmay ham qolmasin
 * (2026-10-06 da rektor aynan shuni so'radi).
 */
function Offsite({ data, onOpen }: { data: Report; onOpen: (p: Person) => void }) {
  const [open, setOpen] = useState(false);
  const o = data.offsite;
  if (!o || !o.count) return null;
  return (
    <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-900/[0.07]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-slate-50"
      >
        <MapPin size={15} className="shrink-0 text-slate-400" />
        <span className="text-[13.5px] font-bold text-slate-800">Monitorsiz joyda dars o‘tadiganlar</span>
        <span className="text-[12px] text-slate-400">{o.count} o‘qituvchi · {o.lessons} dars</span>
        <ChevronRight
          size={16}
          className={`ml-auto shrink-0 text-slate-300 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      <p className="border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-[12px] leading-relaxed text-slate-500">
        Klinika bazasi, dispanser va masofaviy darslar. Bu xonalarda monitor yo‘q, shuning uchun
        ular yuqoridagi foizga KIRMAYDI — aks holda ko‘rsatkich asossiz pasayardi.
      </p>

      {open && (
        <>
          <div className="border-t border-slate-100 px-4 py-2">
            <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">
              Qayerda dars o‘tilmoqda
            </p>
            <ul className="divide-y divide-slate-100">
              {o.places.slice(0, 12).map((p) => (
                <li key={p.place} className="flex items-center gap-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-700" title={p.place}>
                    {p.place}
                  </span>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-slate-500">
                    {p.lessons} dars
                  </span>
                  <span className="w-[74px] shrink-0 text-right text-[11.5px] tabular-nums text-slate-400">
                    {p.teachers} o‘qituvchi
                  </span>
                </li>
              ))}
            </ul>
            {o.places_total > 12 && (
              <p className="pt-1.5 text-[11.5px] text-slate-400">yana {o.places_total - 12} ta joy</p>
            )}
          </div>

          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {o.teachers.slice(0, 60).map((r) => (
              <li key={r.teacher_key || r.employee_id}>
                <button
                  type="button"
                  onClick={() => onOpen({ kind: 'teacher', key: r.teacher_key, name: r.teacher_name })}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800">{r.teacher_name}</span>
                  <span className="hidden min-w-0 flex-1 truncate text-[12px] text-slate-400 sm:block">
                    {r.department}
                  </span>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-slate-500">
                    {r.other_lessons} dars
                  </span>
                  <span className="w-[86px] shrink-0 text-right text-[11.5px] tabular-nums text-slate-400">
                    {minutesText(r.minutes)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {o.teachers.length > 60 && (
            <p className="px-4 py-2 text-[11.5px] text-slate-400">yana {o.teachers.length - 60} o‘qituvchi</p>
          )}
        </>
      )}
    </section>
  );
}

function Teachers({ data, onOpen }: { data: Report; onOpen: (p: Person) => void }) {
  const [flag, setFlag] = useState<Flag>('watched');
  const [sort, setSort] = useState<Sort>('percent');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(60);

  const all = data.teachers;
  const needle = q.trim().toLowerCase();
  const rows = sortRows(
    all
      .filter((r) => matches(r, flag))
      .filter((r) => !needle || `${r.teacher_name} ${r.department} ${r.employee_id}`.toLowerCase().includes(needle)),
    sort,
  );

  return (
    <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-900/[0.07]">
      <div className="space-y-2 border-b border-slate-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[13.5px] font-bold text-slate-800">
            Monitorli xonada dars o‘tadiganlar
          </h2>
          <span className="text-[12px] text-slate-400">{rows.length} ta</span>
          <div className="relative ml-auto">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ism, kafedra yoki Xodim ID"
              className="h-8 w-[220px] rounded-lg border border-slate-200 pl-7 pr-2 text-[12.5px] outline-none focus:border-sky-400"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-8 rounded-lg border border-slate-200 px-2 text-[12.5px] text-slate-700 outline-none focus:border-sky-400"
          >
            {SORTS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CHIPS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setFlag(key);
                setLimit(60);
              }}
              className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${
                flag === key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {label} <span className="tabular-nums opacity-70">{all.filter((r) => matches(r, key)).length}</span>
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-slate-400">Bu shartga mos o‘qituvchi yo‘q.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.slice(0, limit).map((r) => (
            <TeacherRow key={r.teacher_key || `name:${r.teacher_name}`} r={r} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {rows.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + 120)}
          className="w-full border-t border-slate-100 py-2 text-[12.5px] font-medium text-sky-700 hover:bg-slate-50"
        >
          Yana ko‘rsatish ({rows.length - limit} ta qoldi)
        </button>
      )}
      {data.headline.unlinked_teachers > 0 && (
        <p className="border-t border-slate-100 px-4 py-2 text-[12px] text-amber-700">
          HEMIS jadvalida bor, lekin iMentor hisobi topilmagan {data.headline.unlinked_teachers} o‘qituvchi
          «Hammasi» ro‘yxatida ko‘rinadi — ularning faolligini o‘lchab bo‘lmaydi.
        </p>
      )}
    </section>
  );
}

/* ==================================================== dalil va monitor xonalari */

function dayText(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Hisobot qayerdan olingani — bahs hisobot bilan emas, HEMIS bilan bo'lsin. */
function Source({ data }: { data: Report }) {
  const src = data.source;
  const rs = data.room_summary;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-slate-100 px-3 py-2 text-[11.5px] text-slate-600">
      <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
        <Database size={13} /> Manba: HEMIS dars jadvali
      </span>
      <span>oxirgi yangilanish {dayText(src.synced_at)}</span>
      <span>
        {src.lessons} dars ·{' '}
        <Stat metric="total_lessons" label="Jadvalda darsi bor barcha o‘qituvchilar" className="px-1">
          {src.teachers} o‘qituvchi
        </Stat>
      </span>
      <span>{rs.rooms} monitor xonasi ({rs.ok} faollik qaydi bor, {rs.suspect} tekshirish kerak)</span>
      {src.unlinked_teachers > 0 && (
        <Stat metric="unlinked" label="iMentor hisobi topilmaganlar" className="px-1">
          <span className="text-amber-700">{src.unlinked_teachers} ta hisobi bog‘lanmagan</span>
        </Stat>
      )}
    </p>
  );
}

function AttentionList({
  rows,
  tone,
  title,
  hint,
  onOpen,
  total,
}: {
  total?: number;
  rows: ControlAttention[];
  tone: 'rose' | 'amber';
  title: string;
  hint: string;
  onOpen: (p: Person) => void;
}) {
  if (!rows.length) return null;
  const ring = tone === 'rose' ? 'bg-rose-50 ring-rose-200' : 'bg-amber-50 ring-amber-200';
  const head = tone === 'rose' ? 'text-rose-900' : 'text-amber-900';
  const icon = tone === 'rose' ? <AlertTriangle size={17} className="text-rose-600" /> : <Wrench size={17} className="text-amber-600" />;
  return (
    <section className={`overflow-hidden rounded-2xl ring-1 ${ring}`}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        {icon}
        <h2 className={`text-[14px] font-bold ${head}`}>
          {title} — {Math.max(total ?? 0, rows.length)} o‘qituvchi
          {(total ?? 0) > rows.length && (
            <span className="ml-1 text-[11.5px] font-normal text-slate-500">(birinchi {rows.length} tasi)</span>
          )}
        </h2>
        <span className="w-full text-[11.5px] text-slate-600 sm:w-auto">{hint}</span>
      </div>
      <ul className="divide-y divide-white/70 bg-white/70">
        {rows.map((r) => (
          <li key={r.teacher_key}>
            <button
              type="button"
              onClick={() => onOpen({ kind: 'teacher', key: r.teacher_key, name: r.teacher_name })}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-left hover:bg-white"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-slate-900">
                  {r.teacher_name} <span className="font-normal text-slate-400">#{r.employee_id}</span>
                </span>
                <span className="block truncate text-[11.5px] text-slate-500">
                  {r.department} {r.rooms.length > 0 && `· ${r.rooms.slice(0, 3).join(', ')}`}
                </span>
              </span>
              <span className="shrink-0 text-right text-[12.5px]">
                <b className={tone === 'rose' ? 'text-rose-700' : 'text-amber-700'}>{r.monitor_lessons}</b>{' '}
                <span className="text-slate-500">dars · {r.days} kun</span>
                {tone === 'rose' && (
                  <span className="block text-[11px] text-slate-500">
                    shundan {r.proven_lessons} tasi dars vaqtida boshqa hisobda faollik qayd etilgan xonada
                  </span>
                )}
                {r.other_used > 0 && (
                  <span className="block text-[11px] text-slate-400">monitorsiz dars vaqtida {r.other_used} faollik qaydi</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const ROOM_TONE: Record<string, string> = {
  ok: 'bg-emerald-100 text-emerald-800',
  suspect: 'bg-rose-100 text-rose-800',
  quiet: 'bg-slate-100 text-slate-600',
};

export function RoomTable({ rows, compact = false }: { rows: Report['rooms']; compact?: boolean }) {
  const [only, setOnly] = useState<'suspect' | 'all'>(rows.some((r) => r.status === 'suspect') ? 'suspect' : 'all');
  const shown = only === 'all' ? rows : rows.filter((r) => r.status !== 'ok');
  return (
    <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-900/[0.07]">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13.5px] font-bold text-slate-800">
          <Monitor size={15} className="text-slate-400" /> Monitor xonalari
        </h2>
        {!compact && (
          <div className="ml-auto flex gap-1 rounded-lg bg-slate-100 p-0.5 text-[12px]">
            {([
              ['suspect', 'Tekshirish kerak'],
              ['all', 'Hammasi'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setOnly(key)}
                className={`rounded-md px-2.5 py-1 font-medium ${only === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="px-4 py-5 text-center text-[12.5px] text-slate-400">
          Shubhali xona yo‘q — hamma monitorda kamida bitta dars ishlatilgan.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.slice(0, compact ? 8 : 60).map((r) => (
            <li key={r.monitor_id}>
              <Stat
                metric={`room:${r.monitor_id}`}
                label={`${r.room || r.monitor_id} — dars o‘tadiganlar`}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-left"
              >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-slate-800">
                  {r.room || r.hemis_rooms[0] || r.monitor_id}
                  <span className="ml-1.5 font-normal text-slate-400">{r.monitor_id}</span>
                </span>
                <span className="block truncate text-[11.5px] text-slate-500">
                  {r.department || r.departments.join(', ')}
                  {r.hemis_rooms.length > 0 && ` · HEMIS: ${r.hemis_rooms.join(' / ')}`}
                </span>
              </span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${ROOM_TONE[r.status]}`}>
                {r.status_label}
              </span>
              <span className="w-[92px] shrink-0 text-right text-[12px] tabular-nums text-slate-600">
                {r.used}/{r.lessons} dars
              </span>
              <span className="w-[92px] shrink-0 text-right text-[11.5px] tabular-nums text-slate-400">
                {r.used_teachers}/{r.teachers} o‘qituvchi
              </span>
              </Stat>
            </li>
          ))}
        </ul>
      )}
      {!compact && (
        <p className="border-t border-slate-100 px-4 py-2 text-[11.5px] text-slate-500">
          «Tekshirish kerak» — xonada {8}+ dars va 3+ o‘qituvchi bo‘lgan, lekin birortasi ham iMentor
          ochmagan. Bu odatda o‘qituvchining emas, jihozning muammosi: monitorni tekshirib, keyin talab qilinadi.
        </p>
      )}
    </section>
  );
}

/* ============================================================== talabalar */

function Students({ data, onOpen }: { data: ControlStudents | null; onOpen: (p: Person) => void }) {
  const [q, setQ] = useState('');
  if (!data) return <Spinner />;
  const t = data.totals;
  const needle = q.trim().toLowerCase();
  const rows = (data.students || []).filter((r) => !needle || `${r.name} ${r.group}`.toLowerCase().includes(needle));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ['Test topshirgan talaba', t.matched_to_contingent, `${t.contingent} talabadan`, 'students_tested'],
            ['Qamrov', `${t.coverage}%`, 'kontingentdan', 'students_tested'],
            ['Urinishlar', t.attempts, `o‘rtacha ball ${t.avg_score}%`, 'students_attempts'],
            ['Faol guruh', t.groups_active, `${t.groups_total} guruhdan`, 'groups_active'],
          ] as Array<[string, string | number, string, string]>
        ).map(([label, value, hint, metric]) => (
          <Stat
            key={label}
            metric={metric}
            label={label}
            className="rounded-xl bg-white p-3 text-left ring-1 ring-slate-900/[0.06]"
          >
            <p className="text-[11.5px] text-slate-500">{label}</p>
            <p className="text-[19px] font-bold tabular-nums text-slate-900">{value}</p>
            <p className="text-[11px] text-slate-400">{hint}</p>
          </Stat>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-900/[0.06]">
          <h3 className="border-b border-slate-100 px-3 py-2 text-[12.5px] font-bold text-slate-700">
            Guruhlar — eng faolidan
          </h3>
          <table className="w-full text-[12.5px]">
            <thead className="text-slate-500">
              <tr className="text-left">
                <th className="px-3 py-1.5 font-medium">Guruh</th>
                <th className="px-3 py-1.5 text-right font-medium">Qamrov</th>
                <th className="px-3 py-1.5 text-right font-medium">Urinish</th>
                <th className="px-3 py-1.5 text-right font-medium">Ball</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.slice(0, 14).map((g) => (
                <GroupRow key={g.group} group={g} />
              ))}
            </tbody>
          </table>
        </section>

        <section className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-900/[0.06]">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <h3 className="text-[12.5px] font-bold text-slate-700">Talabalar</h3>
            <div className="relative ml-auto">
              <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ism yoki guruh"
                className="h-7 w-[170px] rounded-lg border border-slate-200 pl-7 pr-2 text-[12px] outline-none focus:border-sky-400"
              />
            </div>
          </div>
          <ul className="max-h-[320px] divide-y divide-slate-100 overflow-y-auto">
            {rows.slice(0, 120).map((r: ControlStudentRow) => (
              <li key={r.student_key}>
                <button
                  type="button"
                  onClick={() => onOpen({ kind: 'student', key: r.student_key, name: r.name })}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-slate-800">{r.name}</span>
                    <span className="block truncate text-[11px] text-slate-400">
                      {r.group || 'kontingentda yo‘q'}
                      {r.course ? ` · ${r.course}-kurs` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-[12px] tabular-nums text-slate-500">{r.attempts} urinish</span>
                  <span
                    className={`w-10 shrink-0 text-right text-[12.5px] font-bold tabular-nums ${
                      r.avg_score >= 60 ? 'text-emerald-700' : r.avg_score >= 40 ? 'text-amber-700' : 'text-rose-700'
                    }`}
                  >
                    {r.avg_score}%
                  </span>
                </button>
              </li>
            ))}
            {rows.length === 0 && <li className="px-3 py-4 text-center text-[12.5px] text-slate-400">Topilmadi.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

/** Guruh qatori — bosilsa shu guruhning test topshirgan talabalari chiqadi. */
function GroupRow({ group: g }: { group: ControlStudents['groups'][number] }) {
  const drill = useContext(DrillContext);
  return (
    <tr
      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
      onClick={() => drill({ metric: `group:${g.group}`, label: `${g.group} — test topshirgan talabalar` })}
      title="Guruh talabalarini ochish"
    >
      <td className="px-3 py-1.5 font-medium text-slate-800">{g.group}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
        {g.tested_students}/{g.group_size}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{g.attempts}</td>
      <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-800">{g.avg_score}%</td>
    </tr>
  );
}

/** Sof ko'rinish — tarmoqqa bormaydi, shuning uchun uni namuna ma'lumot bilan ham ko'rish mumkin. */
export function ControlReportView({
  data,
  students,
  onOpen,
  onDrill,
}: {
  data: Report;
  students: ControlStudents | null;
  onOpen?: (p: Person) => void;
  onDrill?: (t: DrillTarget) => void;
}) {
  // Namuna ma'lumot bilan ko'rilganda (harness) hech narsa ochilmaydi.
  const open = onOpen ?? (() => {});
  const drill = onDrill ?? (() => {});
  const h = data.headline;
  // Dars bo'lmagan kun (yakshanba, bayram) sahifani BO'SH qoldirmaydi — ilgari
  // shu yerda butun mazmun, jumladan talabalar bo'limi ham yo'qolardi (2026-09-28).
  const noLessons = !h.total_lessons;
  const tone = BAND_TEXT[h.band] || BAND_TEXT.none;
  const peak = Math.max(5, ...data.daily.map((d) => d.percent));

  return (
    <DrillContext.Provider value={drill}>
    <div className="space-y-5">
      <Source data={data} />

      {noLessons && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-[13px] text-amber-900 ring-1 ring-amber-200">
          Tanlangan davrda HEMIS jadvalida dars yo‘q (dam olish kuni yoki bayram bo‘lishi mumkin).
          Quyidagi talabalar va material ko‘rsatkichlari baribir ko‘rsatilmoqda — boshqa sanani tanlang.
        </p>
      )}

      {/* ---------------------------------------------------- asosiy ko'rsatkich */}
      {!noLessons && (
      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-900/[0.07]">
        <div className="flex flex-wrap items-end justify-between gap-4 p-4 sm:p-5">
          <div>
            <p className="text-[12.5px] font-semibold uppercase tracking-wide text-slate-500">
              Monitorli xonadagi darslarda iMentor ishlatilishi
            </p>
            <Stat metric="watched" label="Nazoratdagi o‘qituvchilar" className="-mx-1 px-1">
              <p className={`mt-1 text-[44px] font-bold leading-none tabular-nums ${tone.text}`}>{h.monitor_percent}%</p>
            </Stat>
            <p className="text-[12px] text-slate-500">
              Dars “o‘tilgan” deb faqat kamida{' '}
              <b className="text-slate-700">{h.min_lesson_minutes} daqiqa</b> ishlangan bo‘lsa sanaladi —
              qisqa kirib chiqish hisoblanmaydi.
            </p>
            <p className="mt-1 text-[13px] text-slate-500">
              <Stat metric="monitor_lessons" label="Monitorli xonada darsi bor o‘qituvchilar" className="px-1">
                {h.monitor_lessons}
              </Stat>{' '}
              ta darsdan{' '}
              <Stat metric="monitor_used" label="Monitorli darsda iMentor ochganlar" className="px-1">
                <b className="text-slate-700">{h.monitor_used}</b>
              </Stat>{' '}
              tasida to‘liq o‘tilgan
              {h.work_buckets && h.work_buckets.near + h.work_buckets.brief > 0 && (
                <>
                  ,{' '}
                  <Stat
                    metric="short"
                    label={`Kirgan, lekin ${h.min_lesson_minutes} daqiqadan kam ishlagan`}
                    className="px-1"
                  >
                    <b className="text-amber-600">{h.work_buckets.near + h.work_buckets.brief}</b>
                  </Stat>{' '}
                  tasida ishlatilgan, lekin {h.min_lesson_minutes} daqiqaga yetmagan
                </>
              )}
            </p>
            <p className="mt-0.5 text-[11.5px] text-slate-400">
              Bir vaqtda bir nechta guruhga o‘tilgan dars bitta dars sifatida sanaladi.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
            <div>
              <p className="text-slate-500">Darsi bor o‘qituvchi</p>
              <Stat metric="watched" label="Nazoratdagi o‘qituvchilar" className="px-1">
                <p className="text-[19px] font-bold tabular-nums text-slate-900">{h.watched_teachers}</p>
              </Stat>
            </div>
            <div>
              <p className="text-slate-500">Darsini iMentor’da o‘tgan</p>
              <Stat metric="t_used" label="Kamida bitta darsini iMentor’da o‘tganlar" className="px-1">
                <p className="text-[19px] font-bold tabular-nums text-slate-900">
                  {h.teachers_used ?? 0}{' '}
                  <span className={`text-[14px] ${tone.text}`}>{h.teacher_percent ?? 0}%</span>
                </p>
              </Stat>
              <p className="text-[11px] text-slate-400">kamida bitta darsini</p>
            </div>
            <div>
              <p className="text-slate-500">Umuman ochmagan</p>
              <Stat metric="t_none" label="Dars vaqtida iMentor’ni umuman ochmaganlar" className="px-1">
                <p className={`text-[19px] font-bold tabular-nums ${h.teacher_buckets?.none ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {h.teacher_buckets?.none ?? h.idle_teachers}
                </p>
              </Stat>
            </div>
            <div>
              <p className="text-slate-500">Monitorsiz darslar</p>
              <p className="text-[19px] font-bold tabular-nums text-slate-900">
                <Stat metric="other_used" label="Monitorsiz darsda iMentor ochganlar" className="px-1">
                  {h.other_used}
                </Stat>
                /
                <Stat metric="other_lessons" label="Monitorsiz xonada darsi bor" className="px-1">
                  {h.other_lessons}
                </Stat>
              </p>
              <p className="text-[11px] text-slate-400">o‘z qurilmasidan</p>
            </div>
          </div>
        </div>
        {h.pending && h.pending.monitor_lessons > 0 && (
          <p className="border-t border-slate-100 bg-sky-50/60 px-4 py-2 text-[12px] text-sky-900 sm:px-5">
            Soat {(h.pending.as_of || '').slice(11, 16)} holatiga: hali tugamagan{' '}
            <b>{h.pending.monitor_lessons}</b> ta monitorli dars ({h.pending.teachers} o‘qituvchi) hisobga
            olinmagan — foizlar faqat tugagan darslar bo‘yicha.
          </p>
        )}
        <TeacherBuckets h={h} />
        {h.work_buckets && h.monitor_lessons > 0 && (
          <WorkBuckets
            buckets={h.work_buckets}
            total={h.monitor_lessons}
            minMinutes={h.min_lesson_minutes}
            nearMinutes={h.near_minutes ?? 30}
            nearTeachers={h.short_near_teachers ?? 0}
            briefTeachers={h.short_brief_teachers ?? 0}
          />
        )}
        {data.daily.length > 1 && (
          <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
            <p className="mb-2 text-[11.5px] text-slate-400">
              Kunlar bo‘yicha ishlatilish ulushi <span className="text-slate-300">· eng baland ustun {peak}%</span>
            </p>
            <div className="flex items-end gap-1.5">
              {data.daily.map((d) => {
                const band = d.percent >= 70 ? 'bg-emerald-500' : d.percent >= 40 ? 'bg-amber-500' : 'bg-rose-400';
                return (
                  <Stat
                    key={d.date}
                    metric={`day:${d.date}`}
                    label={`${d.date} — monitorli darsi bo‘lganlar`}
                    className="flex flex-1 flex-col items-center gap-1 px-0"
                  >
                    <div className="flex h-16 w-full items-end justify-center">
                      <div
                        className={`w-full max-w-[36px] rounded-t ${d.lessons ? band : 'bg-slate-200'}`}
                        // Balandlik eng yuqori kunga nisbatan — past foizlarda ham kunlar taqqoslansin.
                        style={{ height: `${Math.max(4, (d.percent / peak) * 100)}%` }}
                        title={`${d.used} / ${d.lessons} dars`}
                      />
                    </div>
                    <span className="text-[10.5px] text-slate-400">{d.weekday.slice(0, 3)}</span>
                    <span className="text-[11.5px] font-bold tabular-nums text-slate-700">{d.percent}%</span>
                    <span className="text-[10px] tabular-nums text-slate-400">
                      {d.used}/{d.lessons}
                    </span>
                  </Stat>
                );
              })}
            </div>
          </div>
        )}
      </section>
      )}

      {/* ------------------------------------------ bahonasi yo'qlar va xonasi shubhalilar */}
      <AttentionList
        rows={data.attention}
        tone="rose"
        title="HEMIS jadvalida monitorli xona: foydalanish qaydi topilmadi"
        hint="Boshqa hisoblar faolligi monitor ishlaganini yoki dars o‘tilganini tasdiqlamaydi."
        onOpen={open}
      />
      <AttentionList
        rows={data.check_room}
        total={h.check_room_teachers}
        tone="amber"
        title="Avval xonasini tekshirish kerak"
        hint="Dars vaqtida iMentor umuman ochilmagan. Xona va qayd tizimi holati tekshirilishi kerak."
        onOpen={open}
      />
      <RoomTable rows={data.rooms} />

      {/* ---------------------------------------------------- kafedralar */}
      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-900/[0.07]">
        <h2 className="border-b border-slate-100 px-4 py-3 text-[13.5px] font-bold text-slate-800">
          Kafedralar — eng past ko‘rsatkichdan
        </h2>
        <ul className="divide-y divide-slate-100">
          {data.departments.map((d) => (
            <li key={d.department}>
              <Stat
                metric={`department:${d.department}`}
                label={`${d.department} — o‘qituvchilari`}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-left"
              >
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-slate-800" title={d.department}>
                {d.department}
              </span>
              <span className="shrink-0 text-[12px] text-slate-500">
                {d.active_teachers}/{d.teachers} o‘qituvchi
              </span>
              <span className="w-[86px] shrink-0 text-right text-[12.5px] tabular-nums text-slate-600">
                {d.monitor_used}/{d.monitor_lessons}
              </span>
              <span className="w-[130px] shrink-0">
                {d.monitor_lessons ? (
                  <Bar percent={d.percent} band={d.band} />
                ) : (
                  <span className="block text-right text-[12px] text-slate-400">monitorsiz</span>
                )}
              </span>
              </Stat>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------------------------------------------- o'qituvchilar */}
      <Teachers data={data} onOpen={open} />

      {/* --------------------------------- monitorsiz joyda dars o'tadiganlar */}
      <Offsite data={data} onOpen={open} />

      {/* ---------------------------------------------------- talabalar */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 px-1 text-[13.5px] font-bold text-slate-800">
          <Users size={16} className="text-slate-400" /> Talabalar
        </h2>
        <Students data={students} onOpen={open} />
      </section>

      <p className="flex items-start gap-2 px-1 text-[12px] leading-relaxed text-slate-400">
        <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
        <span>
          Jadval HEMIS’dan har kuni yangilanadi, toq va juft haftalar (surat/maxraj) o‘z holicha hisobga olinadi.
          «Ishlatgan» — o‘qituvchi dars vaqtida (boshlanishidan 15 daqiqa oldin — tugagach 5 daqiqa) jonli test
          ochgan yoki QR bilan kompyuterga kirgan. Vaqt esa haqiqiy ishlangan vaqt: varaq yashirilsa yoki 5 daqiqa
          tegilmasa sanoq to‘xtaydi.
        </span>
      </p>
    </div>
    </DrillContext.Provider>
  );
}

export default function ControlReport({ filters, onUnauthorized }: Props) {
  const report = useLoad<Report>(
    () => fetchControlReport(filters),
    [filters.from, filters.to, filters.department, filters.q, filters.refreshKey],
    onUnauthorized,
  );
  const students = useLoad<ControlStudents>(
    () => fetchControlStudents(filters),
    [filters.from, filters.to, filters.refreshKey],
    onUnauthorized,
  );
  const [person, setPerson] = useState<Person | null>(null);
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  if (report.loading && !report.data) return <Spinner />;
  if (report.error) return <ErrorBox text={report.error} />;
  if (!report.data) return null;
  return (
    <>
      <ControlReportView data={report.data} students={students.data} onOpen={setPerson} onDrill={setDrill} />
      {drill && (
        <StatDrill
          target={drill}
          filters={filters}
          // Ro'yxatdan odam tanlansa: oynacha yopiladi, batafsil hisobot ochiladi.
          onOpenPerson={(p) => {
            setDrill(null);
            setPerson(p);
          }}
          onClose={() => setDrill(null)}
        />
      )}
      {person && <PersonPanel person={person} filters={filters} onClose={() => setPerson(null)} />}
    </>
  );
}
