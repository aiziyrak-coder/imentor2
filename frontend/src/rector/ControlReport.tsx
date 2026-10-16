import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Building2,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  DoorOpen,
  Hourglass,
  Link2Off,
  MapPin,
  Monitor,
  MonitorCheck,
  MonitorOff,
  Palmtree,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserCheck,
  UserX,
  Users,
  Wrench,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { HttpError } from '../api/httpClient';
import {
  fetchControlReport,
  fetchControlTrend,
  type ControlTrend,
  type ControlReport as Report,
  type ControlTeacher,
  type ControlAttention,
  type ReportFilters,
} from './rectorApi';
import { ErrorBox, Spinner } from './RectorUi';
import PersonPanel, { type Person } from './PersonPanel';
import StatDrill, { type DrillTarget } from './StatDrill';
import {
  Avatar,
  Columns,
  CountUp,
  Delta,
  Insights,
  Legend,
  Meter,
  Panel,
  Pill,
  Ring,
  Skeleton,
  StackBar,
  TONE,
  TrendChart,
  uzDay,
  type Insight,
  type Tone,
} from './RectorViz';

/**
 * Rektor nazorat paneli (2026-09-25).
 *
 * Ikki qatlam:
 *   1. MONITORLI xonada dars o'tadigan o'qituvchi shu darsda iMentor'ni
 *      ochdimi — monitor aynan shuning uchun qo'yilgan.
 *   2. Ochgani yetarli emas: qaysi bo'limda necha daqiqa turdi, nima
 *      YARATDI (test, keys, ma'ruza, taqdimot, tarqatma, video), profili
 *      to'liqmi, fan biriktirganmi, mavzulari material bilan yopilganmi.
 *
 * 2026-10-15 qayta dizayn (rektor: "oddiy, ko'rimsiz — zamonaviy qiling"):
 * asosiy foiz qorong'i "hero" kartada halqa diagramma bilan, taqsimotlar
 * rangli chiziqlar, kafedralar reyting, o'qituvchilar avatar bilan. Pastdagi
 * "Talabalar" bloki olib tashlandi — talabalar endi headerdagi surmaning
 * o'zining sahifasida, to'liqroq tahlil bilan.
 */

type Props = { filters: ReportFilters; onUnauthorized: () => void };

/**
 * Raqam bosilishi (2026-09-28). Sahifadagi HAR BIR statistika raqami shu
 * orqali ochiladi: `metric` — serverdagi ro'yxat kaliti, `label` — oynacha
 * sarlavhasi. Kontekst ishlatilgan: raqamlar sahifaning har joyida.
 */
const DrillContext = createContext<(t: DrillTarget) => void>(() => {});

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
      key: 'full', value: buckets.full, tone: 'emerald',
      label: `To‘liq o‘tilgan (${minMinutes}+ daq)`, metric: 'monitor_used',
      drill: 'Monitorli darsni to‘liq iMentor’da o‘tganlar', note: '',
    },
    {
      key: 'near', value: buckets.near, tone: 'amber',
      label: `Ishlatgan, lekin ${minMinutes} daqiqaga yetmagan (${nearMinutes}–${minMinutes - 1} daq)`,
      metric: 'short_near', drill: `Ishlatgan, lekin ${minMinutes} daqiqaga yetmagan`,
      note: `${nearTeachers} o‘qituvchi`,
    },
    {
      key: 'brief', value: buckets.brief, tone: 'orange',
      label: `Kirib chiqqan (${nearMinutes} daqiqadan kam)`, metric: 'short_brief',
      drill: `Kirib chiqqan (${nearMinutes} daqiqadan kam)`, note: `${briefTeachers} o‘qituvchi`,
    },
    {
      key: 'none', value: buckets.none, tone: 'rose',
      label: 'Dars vaqtida umuman ochilmagan', metric: 't_none',
      drill: 'Dars vaqtida iMentor’ni umuman ochmaganlar', note: '',
    },
  ];
  return (
    <BucketStrip title="Monitorli darslar — dars vaqtida qancha ishlangan" unit="dars" parts={parts} total={total} />
  );
}

type BucketPart = {
  key: string; value: number; tone: Tone; label: string; metric: string; drill: string; note: string;
};

/** Toifa ikonkasi — kalit bo'yicha, ikkala chiziqda ham bir xil ma'noda. */
const BUCKET_ICON: Record<string, LucideIcon> = {
  full: CheckCircle2,
  near: Hourglass,
  brief: DoorOpen,
  opened: DoorOpen,
  partial: Hourglass,
  none: XCircle,
  on_leave: Palmtree,
  unlinked: Link2Off,
};

/** Bir-birini qoplamaydigan toifalar chizig'i: yig'indisi `total` ga teng. */
function BucketStrip({ title, unit, parts, total }: { title: string; unit: string; parts: BucketPart[]; total: number }) {
  const pct = (n: number) => (total ? Math.round((100 * n) / total) : 0);
  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-bold text-slate-800">{title}</p>
        <p className="text-[11.5px] text-slate-400 rx-num">
          jami {total} {unit}
        </p>
      </div>
      <StackBar
        height={14}
        parts={parts.map((p) => ({
          key: p.key,
          value: p.value,
          tone: p.tone,
          title: `${p.label}: ${p.value} ${unit} (${pct(p.value)}%)`,
        }))}
      />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {parts.map((p) => {
          const body = (
            <span className="flex h-full items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100 transition hover:bg-white hover:ring-slate-200">
              {(() => {
                const Icon = BUCKET_ICON[p.key] || CheckCircle2;
                return (
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ${TONE[p.tone].soft}`}>
                    <Icon size={14} />
                  </span>
                );
              })()}
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] leading-snug text-slate-600">{p.label}</span>
                {p.note && p.value ? <span className="block text-[11px] text-slate-400">{p.note}</span> : null}
              </span>
              <span className="shrink-0 text-right">
                <b className="block text-[16px] leading-tight text-slate-900 rx-num">{p.value}</b>
                <span className={`text-[11px] font-semibold rx-num ${TONE[p.tone].text}`}>{pct(p.value)}%</span>
              </span>
            </span>
          );
          return (
            <div key={p.key}>
              {p.metric && p.value ? (
                <Stat metric={p.metric} label={p.drill} plain className="block h-full w-full text-left">
                  {body}
                </Stat>
              ) : (
                body
              )}
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
      key: 'full', value: b.full, tone: 'emerald',
      label: 'Hamma darsini o‘tgan', metric: 't_full', drill: 'Hamma darsini iMentor’da o‘tganlar', note: '',
    },
    {
      key: 'partial', value: b.partial, tone: 'amber',
      label: 'Qisman: ba’zi darsini o‘tgan, qolganini o‘tmagan', metric: 't_partial',
      drill: 'Ba’zi darsini o‘tgan, qolganini o‘tmaganlar',
      note: `${h.partial_missed_lessons ?? 0} dars o‘tilmay qolgan`,
    },
    {
      key: 'opened', value: b.opened, tone: 'orange',
      label: `Kirgan, lekin birorta darsni to‘liq (${h.min_lesson_minutes} daq) o‘tmagan`, metric: 't_opened',
      drill: 'Kirgan, lekin birorta darsni to‘liq o‘tmaganlar', note: '',
    },
    {
      key: 'none', value: b.none, tone: 'rose',
      label: 'Dars vaqtida umuman ochmagan', metric: 't_none',
      drill: 'Dars vaqtida iMentor’ni umuman ochmaganlar', note: '',
    },
    {
      key: 'on_leave', value: b.on_leave, tone: 'slate',
      label: 'Ta’tilda (HEMIS)', metric: 'on_leave', drill: 'HEMIS bo‘yicha ta’tilda', note: '',
    },
    {
      key: 'unlinked', value: b.unlinked, tone: 'slate',
      label: 'iMentor hisobi bog‘lanmagan', metric: 'unlinked', drill: 'HEMIS jadvalida bor, iMentor hisobi yo‘q', note: '',
    },
  ].filter((p) => p.value > 0 || ['full', 'partial', 'opened', 'none'].includes(p.key)) as BucketPart[];
  return (
    <BucketStrip
      title="Darsi bor o‘qituvchilar — nechtasi darsini iMentor’da o‘tgan"
      unit="o‘qituvchi"
      parts={parts}
      total={h.watched_teachers}
    />
  );
}

/** Bosiladigan raqam: bosilganda shu raqam ortidagi ro'yxat ochiladi. */
function Stat({
  metric,
  label,
  children,
  className = '',
  title,
  plain = false,
  dark = false,
}: {
  metric: string;
  label: string;
  children: React.ReactNode;
  className?: string;
  title?: string;
  /** Butun qator yoki karta bosiladi — tagiga chizilmaydi. */
  plain?: boolean;
  /** Qorong'i fonda. */
  dark?: boolean;
}) {
  const drill = useContext(DrillContext);
  const hover = plain
    ? ''
    : dark
      ? 'rounded-md underline-offset-4 hover:bg-white/10 hover:underline'
      : 'rounded-md underline-offset-4 hover:bg-slate-900/[0.05] hover:underline';
  return (
    <button
      type="button"
      onClick={() => drill({ metric, label })}
      title={title || `${label} — ro‘yxatini ochish`}
      className={`cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${hover} ${className}`}
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

const BAND_TONE: Record<string, Tone> = { good: 'emerald', warn: 'amber', bad: 'rose', none: 'slate' };

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

/* ==================================================== o'qituvchilar ro'yxati */

const DEPTH: Record<string, { label: string; tone: Tone }> = {
  worked: { label: 'material yaratgan', tone: 'emerald' },
  viewed: { label: 'ko‘rgan, yaratmagan', tone: 'amber' },
  visit: { label: 'kirib chiqqan', tone: 'orange' },
  none: { label: 'kirish qaydi yo‘q', tone: 'rose' },
};

/** Qatordagi kichik raqam ustuni — sarlavhasi bilan, shunda nima ekani aniq. */
function Cell({
  label,
  value,
  tone = 'text-slate-800',
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  icon?: LucideIcon;
}) {
  return (
    <span className="hidden w-[78px] shrink-0 text-right md:block">
      <span className="flex items-center justify-end gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {Icon && <Icon size={10} aria-hidden />}
        {label}
      </span>
      <span className={`block text-[13px] font-bold rx-num ${tone}`}>{value}</span>
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
        className="group flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-indigo-50/40 disabled:cursor-default disabled:hover:bg-transparent sm:px-5"
        title={r.teacher_key ? 'Batafsil hisobotini ochish' : 'iMentor hisobi yo‘q'}
      >
        <Avatar name={r.teacher_name} size={38} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold text-slate-900">{r.teacher_name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-500">
            <span className="inline-flex max-w-[18rem] items-center gap-1 truncate"><Building2 size={11} className="shrink-0 text-slate-400" />{r.department || '—'}</span>
            {r.linked ? (
              <Pill tone={depth.tone}>{depth.label}</Pill>
            ) : (
              <Pill tone="slate">hisobi yo‘q</Pill>
            )}
            {r.linked && r.subjects_linked === 0 && <Pill tone="rose">fan biriktirilmagan</Pill>}
            {r.linked && (r.profile_percent ?? 0) < 100 && <Pill tone="amber">profil {r.profile_percent ?? 0}%</Pill>}
            {r.state === 'partial' && <Pill tone="amber">{r.monitor_missed} darsini o‘tmagan</Pill>}
            {r.state === 'opened' && <Pill tone="orange">kirgan, to‘liq o‘tmagan</Pill>}
            {(r.pending_lessons ?? 0) > 0 && <Pill tone="sky">yana {r.pending_lessons} dars oldinda</Pill>}
          </span>
        </span>
        <Cell icon={CalendarCheck} label="dars" value={r.monitor_lessons ? `${r.monitor_used}/${r.monitor_lessons}` : '—'} />
        <Cell icon={Clock3} label="vaqt" value={minutesText(r.minutes)} tone={r.minutes ? 'text-slate-800' : 'text-rose-600'} />
        <Cell
          icon={Sparkles}
          label="yaratgan"
          value={r.created_total}
          tone={r.created_total ? 'text-emerald-700' : 'text-rose-600'}
        />
        <Cell icon={BookOpen} label="material" value={r.material_percent === null ? '—' : `${r.material_percent}%`} />
        <span className="w-[136px] shrink-0">
          {r.monitor_percent === null ? (
            <span className="block text-right text-[12px] text-slate-400">nazoratda emas</span>
          ) : (
            <Meter value={r.monitor_percent} tone={BAND_TONE[r.band] || 'slate'} label={`${r.monitor_percent}%`} />
          )}
        </span>
        <ChevronRight
          size={16}
          className={`shrink-0 transition group-hover:translate-x-0.5 ${r.teacher_key ? 'text-slate-300' : 'text-transparent'}`}
        />
      </button>
    </li>
  );
}

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
    <section className="rx-card rx-rise overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50 sm:px-5"
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-md ${TONE.teal.chip}`}>
          <MapPin size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-bold text-slate-900">Monitorsiz joyda dars o‘tadiganlar</span>
          <span className="block text-[12px] text-slate-500 rx-num">
            {o.count} o‘qituvchi · {o.lessons} dars
          </span>
        </span>
        <ChevronRight
          size={18}
          className={`ml-auto shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      <p className="border-t border-slate-100 bg-teal-50/40 px-4 py-2.5 text-[12px] leading-relaxed text-slate-600 sm:px-5">
        Klinika bazasi, dispanser va masofaviy darslar. Bu xonalarda monitor yo‘q, shuning uchun
        ular yuqoridagi foizga KIRMAYDI — aks holda ko‘rsatkich asossiz pasayardi.
      </p>

      {open && (
        <>
          <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Qayerda dars o‘tilmoqda
            </p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {o.places.slice(0, 12).map((p) => (
                <li key={p.place} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
                  <MapPin size={13} className="shrink-0 text-teal-500" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-slate-700" title={p.place}>
                    {p.place}
                  </span>
                  <span className="shrink-0 text-[11.5px] font-semibold text-slate-600 rx-num">{p.lessons} dars</span>
                  <span className="w-[78px] shrink-0 text-right text-[11.5px] text-slate-400 rx-num">
                    {p.teachers} o‘qituvchi
                  </span>
                </li>
              ))}
            </ul>
            {o.places_total > 12 && (
              <p className="pt-2 text-[11.5px] text-slate-400">yana {o.places_total - 12} ta joy</p>
            )}
          </div>

          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {o.teachers.slice(0, 60).map((r) => (
              <li key={r.teacher_key || r.employee_id}>
                <button
                  type="button"
                  onClick={() => onOpen({ kind: 'teacher', key: r.teacher_key, name: r.teacher_name })}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-indigo-50/40 sm:px-5"
                >
                  <Avatar name={r.teacher_name} size={30} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-800">{r.teacher_name}</span>
                  <span className="hidden min-w-0 flex-1 truncate text-[12px] text-slate-400 sm:block">
                    {r.department}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-slate-500 rx-num">{r.other_lessons} dars</span>
                  <span className="w-[86px] shrink-0 text-right text-[11.5px] text-slate-400 rx-num">
                    {minutesText(r.minutes)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {o.teachers.length > 60 && (
            <p className="px-5 py-2 text-[11.5px] text-slate-400">yana {o.teachers.length - 60} o‘qituvchi</p>
          )}
        </>
      )}
    </section>
  );
}

/** Tepasida aqlli filtr, qidiruv va tartib — rektor kerakli ro'yxatni bir bosishda oladi. */
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
    <Panel
      icon={Users}
      tone="indigo"
      title="Monitorli xonada dars o‘tadiganlar"
      hint={<span className="rx-num">{rows.length} ta o‘qituvchi — bosilsa batafsil hisoboti ochiladi</span>}
      actions={
        <>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ism, kafedra yoki Xodim ID"
              className="h-9 w-[220px] rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-2 text-[12.5px] outline-none transition focus:border-indigo-400 focus:bg-white"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-9 rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-[12.5px] text-slate-700 outline-none focus:border-indigo-400"
          >
            {SORTS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </>
      }
    >
      <div className="flex flex-wrap gap-1.5 border-b border-slate-100 bg-slate-50/50 px-4 py-3 sm:px-5">
        {CHIPS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setFlag(key);
              setLimit(60);
            }}
            className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
              flag === key
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-slate-300'
            }`}
          >
            {label} <span className="rx-num opacity-70">{all.filter((r) => matches(r, key)).length}</span>
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-slate-400">Bu shartga mos o‘qituvchi yo‘q.</p>
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
          className="w-full border-t border-slate-100 py-3 text-[12.5px] font-bold text-indigo-600 transition hover:bg-indigo-50/50"
        >
          Yana ko‘rsatish ({rows.length - limit} ta qoldi)
        </button>
      )}
      {data.headline.unlinked_teachers > 0 && (
        <p className="border-t border-slate-100 bg-amber-50/50 px-4 py-2.5 text-[12px] text-amber-800 sm:px-5">
          HEMIS jadvalida bor, lekin iMentor hisobi topilmagan {data.headline.unlinked_teachers} o‘qituvchi
          «Hammasi» ro‘yxatida ko‘rinadi — ularning faolligini o‘lchab bo‘lmaydi.
        </p>
      )}
    </Panel>
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
    <div className="rx-rise flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl bg-white/70 px-4 py-2.5 text-[11.5px] text-slate-600 ring-1 ring-slate-200/70 backdrop-blur">
      <span className="inline-flex items-center gap-1.5 font-bold text-slate-700">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
          <Database size={13} />
        </span>
        Manba: HEMIS dars jadvali
      </span>
      <span className="inline-flex items-center gap-1">
        <Clock3 size={12} className="text-slate-400" /> oxirgi yangilanish {dayText(src.synced_at)}
      </span>
      <span className="rx-num">
        {src.lessons} dars ·{' '}
        <Stat metric="total_lessons" label="Jadvalda darsi bor barcha o‘qituvchilar" className="px-1">
          {src.teachers} o‘qituvchi
        </Stat>
      </span>
      <span className="rx-num">
        {rs.rooms} monitor xonasi ({rs.ok} faollik qaydi bor, {rs.suspect} tekshirish kerak)
      </span>
      {src.unlinked_teachers > 0 && (
        <Stat metric="unlinked" label="iMentor hisobi topilmaganlar" className="px-1">
          <span className="font-semibold text-amber-700">{src.unlinked_teachers} ta hisobi bog‘lanmagan</span>
        </Stat>
      )}
    </div>
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
  const Icon = tone === 'rose' ? AlertTriangle : Wrench;
  const edge = tone === 'rose' ? 'from-rose-500 to-pink-500' : 'from-amber-400 to-orange-500';
  const head = tone === 'rose' ? 'text-rose-900' : 'text-amber-900';
  const wash = tone === 'rose' ? 'bg-rose-50/60' : 'bg-amber-50/60';
  return (
    <section className="rx-card rx-rise relative overflow-hidden">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b ${edge}`} />
      <div className={`flex flex-wrap items-center gap-3 px-5 py-3.5 ${wash}`}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-md ${TONE[tone].chip}`}>
          <Icon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={`text-[14.5px] font-bold ${head}`}>
            {title} — {Math.max(total ?? 0, rows.length)} o‘qituvchi
            {(total ?? 0) > rows.length && (
              <span className="ml-1 text-[11.5px] font-normal text-slate-500">(birinchi {rows.length} tasi)</span>
            )}
          </h2>
          <p className="text-[11.5px] text-slate-600">{hint}</p>
        </div>
      </div>
      <ul className="grid border-t border-slate-100 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.teacher_key} className="border-b border-slate-100 sm:odd:border-r">
            <button
              type="button"
              onClick={() => onOpen({ kind: 'teacher', key: r.teacher_key, name: r.teacher_name })}
              className="flex h-full w-full items-center gap-3 px-5 py-2.5 text-left transition hover:bg-slate-50"
            >
              <Avatar name={r.teacher_name} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-slate-900">
                  {r.teacher_name} <span className="font-normal text-slate-400">#{r.employee_id}</span>
                </span>
                <span className="block truncate text-[11.5px] text-slate-500">
                  {r.department} {r.rooms.length > 0 && `· ${r.rooms.slice(0, 3).join(', ')}`}
                </span>
                {tone === 'rose' && (
                  <span className="block text-[11px] text-slate-500">
                    shundan {r.proven_lessons} tasi dars vaqtida boshqa hisobda faollik qayd etilgan xonada
                  </span>
                )}
                {r.other_used > 0 && (
                  <span className="block text-[11px] text-slate-400">monitorsiz dars vaqtida {r.other_used} faollik qaydi</span>
                )}
              </span>
              <span className="shrink-0 text-right">
                <b className={`block text-[17px] leading-tight rx-num ${TONE[tone].text}`}>{r.monitor_lessons}</b>
                <span className="text-[11px] text-slate-500 rx-num">dars · {r.days} kun</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const ROOM_TONE: Record<string, Tone> = {
  ok: 'emerald',
  suspect: 'rose',
  quiet: 'slate',
};

export function RoomTable({ rows, compact = false }: { rows: Report['rooms']; compact?: boolean }) {
  const [only, setOnly] = useState<'suspect' | 'all'>(rows.some((r) => r.status === 'suspect') ? 'suspect' : 'all');
  const shown = only === 'all' ? rows : rows.filter((r) => r.status !== 'ok');
  return (
    <Panel
      icon={Monitor}
      tone="sky"
      title="Monitor xonalari"
      actions={
        !compact && (
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-[12px]">
            {([
              ['suspect', 'Tekshirish kerak'],
              ['all', 'Hammasi'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setOnly(key)}
                className={`rounded-lg px-3 py-1 font-semibold transition ${only === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )
      }
    >
      {shown.length === 0 ? (
        <p className="flex items-center justify-center gap-2 px-4 py-6 text-center text-[12.5px] text-emerald-700">
          <CheckCircle2 size={15} />
          Shubhali xona yo‘q — hamma monitorda kamida bitta dars ishlatilgan.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.slice(0, compact ? 8 : 60).map((r) => (
            <li key={r.monitor_id}>
              <Stat
                metric={`room:${r.monitor_id}`}
                label={`${r.room || r.monitor_id} — dars o‘tadiganlar`}
                plain
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-slate-50 sm:px-5"
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                    r.status === 'suspect' ? 'bg-rose-50 text-rose-500' : r.status === 'ok' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {r.status === 'suspect' ? <MonitorOff size={15} /> : <Monitor size={15} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-800">
                    {r.room || r.hemis_rooms[0] || r.monitor_id}
                    <span className="ml-1.5 font-normal text-slate-400">{r.monitor_id}</span>
                  </span>
                  <span className="block truncate text-[11.5px] text-slate-500">
                    {r.department || r.departments.join(', ')}
                    {r.hemis_rooms.length > 0 && ` · HEMIS: ${r.hemis_rooms.join(' / ')}`}
                  </span>
                </span>
                <Pill tone={ROOM_TONE[r.status] || 'slate'}>{r.status_label}</Pill>
                <span className="w-[92px] shrink-0 text-right text-[12px] font-semibold text-slate-600 rx-num">
                  {r.used}/{r.lessons} dars
                </span>
                <span className="w-[92px] shrink-0 text-right text-[11.5px] text-slate-400 rx-num">
                  {r.used_teachers}/{r.teachers} o‘qituvchi
                </span>
              </Stat>
            </li>
          ))}
        </ul>
      )}
      {!compact && (
        <p className="border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-[11.5px] text-slate-500 sm:px-5">
          «Tekshirish kerak» — xonada {8}+ dars va 3+ o‘qituvchi bo‘lgan, lekin birortasi ham iMentor
          ochmagan. Bu odatda o‘qituvchining emas, jihozning muammosi: monitorni tekshirib, keyin talab qilinadi.
        </p>
      )}
    </Panel>
  );
}

/* ==================================================== kafedralar reytingi */

function Departments({ data }: { data: Report }) {
  if (!data.departments.length) return null;
  const rankTone = (i: number, total: number) =>
    i < 3 ? 'bg-rose-500 text-white' : i >= total - 3 ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500';
  return (
    <Panel
      icon={Building2}
      tone="violet"
      title="Kafedralar — eng past ko‘rsatkichdan"
      hint="Bosilsa kafedra o‘qituvchilari ro‘yxati ochiladi"
    >
      <ul className="divide-y divide-slate-100">
        {data.departments.map((d, i) => (
          <li key={d.department}>
            <Stat
              metric={`department:${d.department}`}
              label={`${d.department} — o‘qituvchilari`}
              plain
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left hover:bg-violet-50/30 sm:px-5"
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11.5px] font-extrabold rx-num ${rankTone(
                  i,
                  data.departments.length,
                )}`}
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-slate-800" title={d.department}>
                  {d.department}
                </span>
                <span className="flex flex-wrap items-center gap-x-3 text-[11.5px] text-slate-400 rx-num">
                  <span className="inline-flex items-center gap-1"><Users size={11} />{d.active_teachers}/{d.teachers} o‘qituvchi</span>
                  <span className="inline-flex items-center gap-1"><CalendarCheck size={11} />{d.monitor_used}/{d.monitor_lessons} dars</span>
                </span>
              </span>
              <span className="w-full shrink-0 sm:w-[200px]">
                {d.monitor_lessons ? (
                  <Meter value={d.percent} tone={BAND_TONE[d.band] || 'slate'} height={10} delay={i * 30} label={`${d.percent}%`} />
                ) : (
                  <span className="block text-right text-[12px] text-slate-400">monitorsiz</span>
                )}
              </span>
            </Stat>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ==================================================== dinamika va xulosalar */

/**
 * Ma'lumoti bor haftalar. Boshidagi bo'sh yoki deyarli bo'sh haftalar
 * (HEMIS ulanmasdan oldin; 7-sentabr haftasida bitta dars bo'lgan)
 * tashlanadi — aks holda grafik "0% dan boshlangan" deb yolg'on aytardi.
 */
const MIN_WEEK_LESSONS = 20;

export function filledWeeks(trend: ControlTrend | null) {
  const weeks = trend?.weeks || [];
  const first = weeks.findIndex((w) => w.lessons >= MIN_WEEK_LESSONS);
  return first < 0 ? [] : weeks.slice(first);
}

/** Haftalar bo'yicha grafik: ishlatilgan va to'liq o'tilgan darslar ulushi. */
function Trend({ trend, loading }: { trend: ControlTrend | null; loading: boolean }) {
  const weeks = filledWeeks(trend);
  if (!weeks.length) {
    return loading ? (
      <section className="rx-card p-5">
        <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-slate-500">
          <TrendingUp size={15} /> Haftalar bo‘yicha dinamika hisoblanmoqda — bu bir necha soniya olishi mumkin
        </p>
        <Skeleton className="h-[200px]" />
      </section>
    ) : null;
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
          Monitorli darslarda iMentor ishlatilishi har hafta.{' '}
          {first.touched_percent !== null && last.touched_percent !== null && weeks.length > 1 && (
            <>
              {uzDay(first.week_start)} haftasidan beri:{' '}
              <b className="text-slate-800 rx-num">
                {first.touched_percent}% → {last.touched_percent}%
              </b>
            </>
          )}
        </>
      }
      actions={
        prev && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500">
            o‘tgan haftaga nisbatan <Delta now={last.touched_percent} before={prev.touched_percent} unit="%" />
          </span>
        )
      }
      bodyClassName="px-3 pb-4 pt-3 sm:px-5"
    >
      <div className="mb-2 px-1">
        <Legend
          items={[
            { label: 'Ishlatilgan (to‘liq + qisqa)', tone: 'indigo', value: last.touched_percent === null ? '—' : `${last.touched_percent}%` },
            { label: 'To‘liq o‘tilgan', tone: 'emerald', value: last.percent === null ? '—' : `${last.percent}%` },
          ]}
        />
      </div>
      <TrendChart
        labels={weeks.map((w) => uzDay(w.week_start))}
        series={[
          { key: 'touched', label: 'Ishlatilgan', tone: 'indigo', values: weeks.map((w) => w.touched_percent) },
          { key: 'full', label: 'To‘liq o‘tilgan', tone: 'emerald', values: weeks.map((w) => w.percent) },
        ]}
      />
      <p className="mt-1 px-1 text-[11.5px] text-slate-400 rx-num">
        Har nuqta — dushanbadan yakshanbagacha; oxirgi hafta tanlangan kun bilan tugaydi. Darslar soni:{' '}
        {weeks.map((w) => w.lessons).join(' · ')}
      </p>
    </Panel>
  );
}

/** Sahifa tepasidagi xulosalar — hisobot ma'lumotining o'zidan, raqam bilan. */
export function teacherInsights(data: Report, trend: ControlTrend | null, drill: (t: DrillTarget) => void): Insight[] {
  const h = data.headline;
  const out: Insight[] = [];
  const b = h.teacher_buckets;
  if (b?.none) {
    out.push({
      key: 'none', tone: 'rose', icon: UserX, action: 'Ro‘yxat',
      text: <><b className="rx-num">{b.none}</b> o‘qituvchi dars vaqtida iMentor’ni umuman ochmagan</>,
      onClick: () => drill({ metric: 't_none', label: 'Dars vaqtida iMentor’ni umuman ochmaganlar' }),
    });
  }
  if (b?.partial) {
    out.push({
      key: 'partial', tone: 'amber', icon: Hourglass, action: 'Ro‘yxat',
      text: (
        <>
          <b className="rx-num">{b.partial}</b> o‘qituvchi darslarining bir qismini o‘tmagan —{' '}
          <b className="rx-num">{h.partial_missed_lessons ?? 0}</b> dars
        </>
      ),
      onClick: () => drill({ metric: 't_partial', label: 'Ba’zi darsini o‘tgan, qolganini o‘tmaganlar' }),
    });
  }
  const weeks = filledWeeks(trend);
  if (weeks.length > 1) {
    const last = weeks[weeks.length - 1];
    const prev = weeks[weeks.length - 2];
    if (last.touched_percent !== null && prev.touched_percent !== null) {
      const diff = last.touched_percent - prev.touched_percent;
      out.push({
        key: 'trend', tone: diff >= 0 ? 'emerald' : 'rose', icon: diff >= 0 ? TrendingUp : TrendingDown,
        text: (
          <>
            Bu hafta <b className="rx-num">{last.touched_percent}%</b> — o‘tgan haftadan{' '}
            <b className="rx-num">{diff >= 0 ? `+${diff}` : diff}</b> foiz punkt
            {weeks[0].touched_percent !== null && weeks.length > 2 && (
              <> ({weeks[0].touched_percent}% dan boshlangan)</>
            )}
          </>
        ),
      });
    }
  }
  const ranked = data.departments.filter((d) => d.monitor_lessons >= 10);
  if (ranked.length > 1) {
    const worst = ranked.reduce((a, c) => (c.percent < a.percent ? c : a));
    const best = ranked.reduce((a, c) => (c.percent > a.percent ? c : a));
    out.push({
      key: 'worst', tone: 'rose', icon: Building2, action: 'O‘qituvchilar',
      text: <>Eng past kafedra: <b>{worst.department}</b> — <b className="rx-num">{worst.percent}%</b></>,
      onClick: () => drill({ metric: `department:${worst.department}`, label: `${worst.department} — o‘qituvchilari` }),
    });
    out.push({
      key: 'best', tone: 'emerald', icon: Trophy, action: 'O‘qituvchilar',
      text: <>Eng yaxshi kafedra: <b>{best.department}</b> — <b className="rx-num">{best.percent}%</b></>,
      onClick: () => drill({ metric: `department:${best.department}`, label: `${best.department} — o‘qituvchilari` }),
    });
  }
  if (data.room_summary?.suspect) {
    out.push({
      key: 'rooms', tone: 'amber', icon: MonitorOff,
      text: <><b className="rx-num">{data.room_summary.suspect}</b> ta monitor xonasini tekshirish kerak — birorta o‘qituvchi ham ochmagan</>,
    });
  }
  const noMaterial = data.teachers.filter((r) => r.linked && r.monitor_lessons > 0 && r.created_total === 0).length;
  if (noMaterial) {
    out.push({
      key: 'material', tone: 'orange', icon: Sparkles,
      text: <><b className="rx-num">{noMaterial}</b> nazoratdagi o‘qituvchi shu davrda birorta material yaratmagan</>,
    });
  }
  if (h.unlinked_teachers) {
    out.push({
      key: 'unlinked', tone: 'slate', icon: Link2Off, action: 'Ro‘yxat',
      text: <><b className="rx-num">{h.unlinked_teachers}</b> o‘qituvchining iMentor hisobi bog‘lanmagan — faolligini o‘lchab bo‘lmaydi</>,
      onClick: () => drill({ metric: 'unlinked', label: 'iMentor hisobi topilmaganlar' }),
    });
  }
  return out.slice(0, 6);
}

/** Qorong'i kartadagi kichik ko'rsatkich. */
function HeroTile({
  label,
  children,
  hint,
  icon: Icon,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="rx-glass rounded-2xl px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-indigo-100/80">
        {Icon && (
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/10 text-indigo-100">
            <Icon size={12} />
          </span>
        )}
        {label}
      </p>
      {children}
      {hint && <p className="text-[10.5px] text-indigo-200/60">{hint}</p>}
    </div>
  );
}

/** Sof ko'rinish — tarmoqqa bormaydi, shuning uchun uni namuna ma'lumot bilan ham ko'rish mumkin. */
export function ControlReportView({
  data,
  onOpen,
  onDrill,
  department = '',
  trend = null,
  trendLoading = false,
}: {
  data: Report;
  onOpen?: (p: Person) => void;
  onDrill?: (t: DrillTarget) => void;
  /** Yuqoridagi kafedra filtri — bo'sh natija sababini to'g'ri aytish uchun. */
  department?: string;
  /** Haftalar bo'yicha dinamika — alohida, sekinroq so'rov. */
  trend?: ControlTrend | null;
  trendLoading?: boolean;
}) {
  // Namuna ma'lumot bilan ko'rilganda (harness) hech narsa ochilmaydi.
  const open = onOpen ?? (() => {});
  const drill = onDrill ?? (() => {});
  const h = data.headline;
  // Dars bo'lmagan kun (yakshanba, bayram) sahifani BO'SH qoldirmaydi — ilgari
  // shu yerda butun mazmun, jumladan talabalar bo'limi ham yo'qolardi (2026-09-28).
  const noLessons = !h.total_lessons;
  // Baholangan dars yo'qligining UCH sababi bor va ularni adashtirmaslik kerak.
  // 2026-10-13 shikoyati: ertalab jadvalda darslar bor edi, lekin biri ham
  // tugamagandi — baho faqat tugagan darsga qo'yiladi — sahifa esa "dam olish
  // kuni bo'lishi mumkin" deb yozib, butun hisobotni yashirardi.
  const waiting = h.pending && h.pending.lessons > 0 ? h.pending : null;
  const notOverYet = noLessons && !!waiting;
  const tone = BAND_TEXT[h.band] || BAND_TEXT.none;
  const touched = h.monitor_touched_percent ?? h.monitor_percent;
  const ringTone = BAND_TONE[h.touch_band || h.band] || 'indigo';

  return (
    <DrillContext.Provider value={drill}>
    <div className="space-y-5">
      <Source data={data} />

      {/* Birinchi navbatda vaqt tekshiriladi: `pending` tanlangan kafedra
          bo'yicha hisoblanadi, shuning uchun unda dars bo'lsa sabab filtr ham,
          dam olish kuni ham emas — dars hali tugamagan. */}
      {notOverYet && (
        <p className="rx-rise flex items-start gap-3 rounded-2xl bg-sky-50 px-4 py-3.5 text-[13px] text-sky-900 ring-1 ring-sky-200">
          <Clock3 size={18} className="mt-0.5 shrink-0 text-sky-500" />
          <span>
            Jadvalda {department ? <b>«{department}»</b> : 'bugun'} bo‘yicha <b>{waiting!.lessons}</b> ta dars
            bor, lekin soat {(waiting!.as_of || '').slice(11, 16)} holatiga biri ham tugamagan — shuning uchun
            baho hali yo‘q.{' '}
            {waiting!.next_at
              ? `Birinchi dars ${waiting!.next_at.slice(11, 16)} da tugaydi, raqamlar shundan keyin to‘la boshlaydi.`
              : 'Raqamlar darslar tugagach to‘la boshlaydi.'}{' '}
            Tugagan darslarni ko‘rish uchun kechagi sanani tanlang.
          </span>
        </p>
      )}

      {/* Kafedra tanlangan bo'lsa "dars yo'q" ko'pincha shu filtrdan: ilgari
          xabar "dam olish kuni" derdi va rektor hisobot buzilgan deb o'ylardi
          (2026-10-12: "Lotin tili" tanlangan, dushanba kuni 0 dars). */}
      {noLessons && !notOverYet && department && (
        <p className="rx-rise rounded-2xl bg-amber-50 px-4 py-3.5 text-[13px] text-amber-900 ring-1 ring-amber-200">
          <b>«{department}»</b> kafedrasida tanlangan davrda HEMIS jadvali bo‘yicha dars yo‘q. Butun institutni
          ko‘rish uchun yuqorida «Barcha kafedralar»ni tanlang yoki «Filtrlarni tozalash»ni bosing.
          Quyidagi talabalar ko‘rsatkichlari kafedra bo‘yicha filtrlanmaydi.
        </p>
      )}
      {noLessons && !notOverYet && !department && (
        <p className="rx-rise rounded-2xl bg-amber-50 px-4 py-3.5 text-[13px] text-amber-900 ring-1 ring-amber-200">
          Tanlangan davrda HEMIS jadvalida dars yo‘q (dam olish kuni yoki bayram bo‘lishi mumkin).
          Quyidagi talabalar va material ko‘rsatkichlari baribir ko‘rsatilmoqda — boshqa sanani tanlang.
        </p>
      )}

      {/* ---------------------------------------------------- asosiy ko'rsatkich */}
      {!noLessons && (
      <section className="rx-hero rx-rise p-5 sm:p-7">
        <div className="grid items-center gap-6 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,360px)]">
          {/* BITTA foiz: iMentor ishlatilgan darslar ulushi — to'liq
              o'tilganlar va vaqti yetmaganlar birgalikda (rektor talabi,
              2026-10-12). "To'liq o'tilgan" ulushi pastdagi jumlada. */}
          <Stat metric="watched" label="Nazoratdagi o‘qituvchilar" plain className="mx-auto rounded-full">
            <Ring value={touched} size={176} stroke={16} tone={ringTone} track="rgba(255,255,255,0.12)">
              <p className="text-[44px] font-extrabold leading-none text-white rx-num">
                <CountUp value={touched ?? 0} suffix="%" />
              </p>
              <span className="mt-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em] text-indigo-200/80">
                ishlatilgan
              </span>
            </Ring>
          </Stat>

          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.16em] text-indigo-200/90">
              <MonitorCheck size={15} className="shrink-0" />
              Monitorli xonadagi darslarda iMentor ishlatilishi
            </p>
            <p className="mt-2 text-[19px] font-bold leading-snug text-white sm:text-[21px]">
              <Stat metric="monitor_lessons" label="Shu darslarni o‘tadigan o‘qituvchilar" dark className="px-1">
                {h.monitor_lessons}
              </Stat>{' '}
              ta darsdan{' '}
              <Stat metric="monitor_used" label="Shu darslarni iMentor’da o‘tgan o‘qituvchilar" dark className="px-1">
                <b className="text-emerald-300">{h.monitor_used}</b>
              </Stat>{' '}
              tasida to‘liq o‘tilgan
              {h.work_buckets && h.work_buckets.near + h.work_buckets.brief > 0 && (
                <>
                  ,{' '}
                  <Stat
                    metric="short"
                    label={`Kirgan, lekin ${h.min_lesson_minutes} daqiqadan kam ishlagan`}
                    dark
                    className="px-1"
                  >
                    <b className="text-amber-300">{h.work_buckets.near + h.work_buckets.brief}</b>
                  </Stat>{' '}
                  tasida ishlatilgan, lekin {h.min_lesson_minutes} daqiqaga yetmagan
                </>
              )}
            </p>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-indigo-100/75">
              Foiz — iMentor <b className="text-white">ishlatilgan</b> darslar ulushi:
              to‘liq o‘tilganlar va vaqti yetmaganlar birgalikda. Dars
              “to‘liq o‘tilgan” deb faqat kamida{' '}
              <b className="text-white">{h.min_lesson_minutes} daqiqa</b> ishlangan bo‘lsa sanaladi.
            </p>
            <p className="mt-1 text-[11.5px] text-indigo-200/60">
              Bir vaqtda bir nechta guruhga o‘tilgan dars bitta dars sifatida sanaladi.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <HeroTile icon={Users} label="Darsi bor o‘qituvchi">
              <Stat metric="watched" label="Nazoratdagi o‘qituvchilar" dark className="-mx-1 px-1">
                <p className="text-[24px] font-extrabold text-white rx-num">{h.watched_teachers}</p>
              </Stat>
            </HeroTile>
            <HeroTile icon={UserCheck} label="Darsini iMentor’da o‘tgan" hint="kamida bitta darsini">
              <Stat metric="t_used" label="Kamida bitta darsini iMentor’da o‘tganlar" dark className="-mx-1 px-1">
                <p className="text-[24px] font-extrabold text-white rx-num">
                  {h.teachers_used ?? 0}{' '}
                  <span className={`text-[14px] ${h.band === 'good' ? 'text-emerald-300' : h.band === 'warn' ? 'text-amber-300' : h.band === 'bad' ? 'text-rose-300' : 'text-slate-300'}`}>
                    {h.teacher_percent ?? 0}%
                  </span>
                </p>
              </Stat>
            </HeroTile>
            <HeroTile icon={UserX} label="Umuman ochmagan">
              <Stat metric="t_none" label="Dars vaqtida iMentor’ni umuman ochmaganlar" dark className="-mx-1 px-1">
                <p className={`text-[24px] font-extrabold rx-num ${h.teacher_buckets?.none ? 'text-rose-300' : 'text-emerald-300'}`}>
                  {h.teacher_buckets?.none ?? h.idle_teachers}
                </p>
              </Stat>
            </HeroTile>
            <HeroTile icon={MonitorOff} label="Monitorsiz darslar" hint="o‘z qurilmasidan">
              <p className="text-[24px] font-extrabold text-white rx-num">
                <Stat metric="other_used" label="Monitorsiz darsda ishlagan o‘qituvchilar" dark className="px-0.5">
                  {h.other_used}
                </Stat>
                <span className="text-indigo-300/70">/</span>
                <Stat metric="other_lessons" label="Monitorsiz xonada darsi bor o‘qituvchilar" dark className="px-0.5">
                  {h.other_lessons}
                </Stat>
              </p>
            </HeroTile>
          </div>
        </div>
        {h.pending && h.pending.monitor_lessons > 0 && (
          <p className="rx-glass mt-5 flex items-center gap-2 rounded-xl px-3.5 py-2 text-[12px] text-sky-100">
            <Clock3 size={14} className="shrink-0 text-sky-300" />
            <span>
              Soat {(h.pending.as_of || '').slice(11, 16)} holatiga: hali tugamagan{' '}
              <b className="text-white">{h.pending.monitor_lessons}</b> ta monitorli dars ({h.pending.teachers} o‘qituvchi) hisobga
              olinmagan — foizlar faqat tugagan darslar bo‘yicha.
            </span>
          </p>
        )}
      </section>
      )}

      {/* ------------------------------------------ xulosalar va dinamika */}
      {!noLessons && <Insights items={teacherInsights(data, trend, drill)} />}
      <Trend trend={trend} loading={trendLoading} />

      {/* ------------------------------------------ taqsimotlar va kunlar */}
      {!noLessons && (h.teacher_buckets || h.work_buckets || data.daily.length > 1) && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Panel icon={UserCheck} tone="emerald" title="Taqsimot" hint="Har o‘qituvchi va har dars faqat bitta toifada — bosilsa ro‘yxati ochiladi" bodyClassName="divide-y divide-slate-100">
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
          </Panel>
          {data.daily.length > 1 && (
            <Panel
              icon={BarChart3}
              tone="sky"
              title="Kunlar bo‘yicha ishlatilish ulushi"
              hint={<>Ustun balandligi — o‘sha kuni iMentor ishlatilgan monitorli darslar ulushi. <span className={tone.text}>Bosilsa — o‘sha kun ro‘yxati.</span></>}
              bodyClassName="px-4 pb-4 pt-5 sm:px-5"
            >
              <Columns
                height={150}
                items={data.daily.map((d) => ({
                  key: d.date,
                  label: d.weekday.slice(0, 3),
                  value: d.percent,
                  caption: `${d.percent}%`,
                  sub: `${d.used}/${d.lessons}`,
                  title: `${d.date}: ${d.used} / ${d.lessons} dars`,
                  tone: d.percent >= 70 ? 'emerald' : d.percent >= 40 ? 'amber' : 'rose',
                  muted: !d.lessons,
                }))}
                onPick={(date) => drill({ metric: `day:${date}`, label: `${date} — monitorli darsi bo‘lganlar` })}
              />
            </Panel>
          )}
        </div>
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

      <div className="grid gap-5 xl:grid-cols-2">
        <Departments data={data} />
        <RoomTable rows={data.rooms} />
      </div>

      {/* ---------------------------------------------------- o'qituvchilar */}
      <Teachers data={data} onOpen={open} />

      {/* --------------------------------- monitorsiz joyda dars o'tadiganlar */}
      <Offsite data={data} onOpen={open} />

      <p className="flex items-start gap-2 px-1 text-[12px] leading-relaxed text-slate-400">
        <ShieldAlert size={14} className="mt-0.5 shrink-0" />
        <span>
          Jadval HEMIS’dan har kuni yangilanadi, toq va juft haftalar (surat/maxraj) o‘z holicha hisobga olinadi.
          «Ishlatgan» — o‘qituvchi dars vaqtida (boshlanishidan 15 daqiqa oldin — tugagach 5 daqiqa) jonli test
          ochgan yoki QR bilan kompyuterga kirgan. Vaqt esa haqiqiy ishlangan vaqt: varaq yashirilsa yoki 5 daqiqa
          tegilmasa sanoq to‘xtaydi. Talabalar bo‘yicha to‘liq tahlil — yuqoridagi «Talabalar» tomonida.
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
  // Dinamika sekin (8 hafta) — har daqiqalik yangilanishga bog'lanmaydi,
  // faqat sana va kafedra o'zgarganda qayta so'raladi.
  const trend = useLoad<ControlTrend>(
    () => fetchControlTrend(filters),
    [filters.to, filters.department],
    onUnauthorized,
  );
  const [person, setPerson] = useState<Person | null>(null);
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  if (report.loading && !report.data) return <Spinner />;
  if (report.error) return <ErrorBox text={report.error} />;
  if (!report.data) return null;
  return (
    <>
      <ControlReportView
        data={report.data}
        onOpen={setPerson}
        onDrill={setDrill}
        department={filters.department}
        trend={trend.data}
        trendLoading={trend.loading}
      />
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
