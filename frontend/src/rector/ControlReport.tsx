import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Database, Monitor, Search, Sparkles, Users, Wrench } from 'lucide-react';
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
  none: { label: 'umuman kirmagan', cls: 'bg-rose-100 text-rose-800' },
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

export type Flag = 'watched' | 'idle' | 'nothing' | 'profile' | 'nosubject' | 'nomaterial' | 'all';
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
  ['idle', 'iMentor ochmaganlar'],
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
    case 'idle':
      return r.monitor_lessons > 0 && r.monitor_used === 0 && r.linked;
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
          <h2 className="text-[13.5px] font-bold text-slate-800">O‘qituvchilar</h2>
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

/* =================================================== modul va material kesimi */

function Modules({ data }: { data: Report }) {
  const q = data.quality;
  const top = Math.max(1, ...data.modules.map((m) => m.minutes));
  const created = Object.entries(data.created_labels).filter(([key]) => (data.created[key] ?? 0) >= 0);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-900/[0.07]">
        <h2 className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-[13.5px] font-bold text-slate-800">
          <Clock size={15} className="text-slate-400" /> Qaysi bo‘limda qancha ishlagan
          <Stat metric="minutes" label="iMentor’da ishlagan vaqt bo‘yicha" className="ml-auto px-1">
            <span className="text-[12px] font-medium text-slate-500">jami {minutesText(q.minutes)}</span>
          </Stat>
        </h2>
        {data.modules.length === 0 ? (
          <p className="px-4 py-5 text-center text-[12.5px] text-slate-400">Bu davrda hech kim bo‘limlarda ishlamagan.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.modules.slice(0, 12).map((m) => (
              <li key={m.page}>
                <Stat
                  metric={`module:${m.page}`}
                  label={`${m.label} — shu bo‘limda ishlaganlar`}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left"
                >
                <span className="w-[150px] shrink-0 truncate text-[12.5px] text-slate-700" title={m.label}>
                  {m.label}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full bg-sky-500"
                    style={{ width: `${Math.max(2, (m.minutes / top) * 100)}%` }}
                  />
                </span>
                <span className="w-[74px] shrink-0 text-right text-[12.5px] font-semibold tabular-nums text-slate-700">
                  {minutesText(m.minutes)}
                </span>
                <span className="hidden w-[68px] shrink-0 text-right text-[11.5px] tabular-nums text-slate-400 sm:block">
                  {m.people} kishi
                </span>
                </Stat>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-900/[0.07]">
        <h2 className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-[13.5px] font-bold text-slate-800">
          <Sparkles size={15} className="text-slate-400" /> Shu davrda yaratilgan material
        </h2>
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
          {created.map(([key, label]) => (
            <Stat
              key={key}
              metric={`created:${key}`}
              label={`${label} — yaratganlar`}
              className="rounded-xl bg-slate-50 p-2.5 text-left"
            >
              <p className="text-[11px] text-slate-500">{label}</p>
              <p className="text-[19px] font-bold tabular-nums text-slate-900">{data.created[key] ?? 0}</p>
            </Stat>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-3 text-[12px] sm:grid-cols-4">
          {(
            [
              ['Material yaratgan', q.worked, 'text-emerald-700', 'worked'],
              ['Ko‘rgan, yaratmagan', q.viewed, 'text-amber-700', 'viewed'],
              ['Kirib chiqqan', q.visit, 'text-orange-700', 'visit'],
              ['Umuman kirmagan', q.never, 'text-rose-700', 'never'],
            ] as Array<[string, number, string, string]>
          ).map(([label, value, tone, metric]) => (
            <Stat key={label} metric={metric} label={label} className="text-left">
              <p className="text-slate-500">{label}</p>
              <p className={`text-[17px] font-bold tabular-nums ${tone}`}>{value}</p>
            </Stat>
          ))}
        </div>
        <p className="border-t border-slate-100 px-4 py-2 text-[11.5px] text-slate-500">
          Fan biriktirmagan{' '}
          <Stat metric="no_subject" label="Fan biriktirmaganlar" className="px-1">
            <b className="text-rose-700">{q.no_subject}</b>
          </Stat>{' '}
          · profili to‘liq emas{' '}
          <Stat metric="profile_incomplete" label="Profili to‘liq emas" className="px-1">
            <b className="text-amber-700">{q.profile_incomplete}</b>
          </Stat>{' '}
          · jami nazoratdagi hisob{' '}
          <Stat metric="teachers" label="Nazoratdagi hisoblar" className="px-1">
            {q.teachers}
          </Stat>
        </p>
      </section>
    </div>
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
      <span>{rs.rooms} monitor xonasi ({rs.ok} ishlayapti, {rs.suspect} tekshirish kerak)</span>
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
}: {
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
          {title} — {rows.length} o‘qituvchi
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
                    shundan {r.proven_lessons} tasi monitori ISHLAYOTGANI isbotlangan xonada
                  </span>
                )}
                {r.other_used > 0 && (
                  <span className="block text-[11px] text-slate-400">o‘z qurilmasidan {r.other_used} marta kirgan</span>
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
            <p className="mt-1 text-[13px] text-slate-500">
              <Stat metric="monitor_lessons" label="Monitorli xonada darsi bor o‘qituvchilar" className="px-1">
                {h.monitor_lessons}
              </Stat>{' '}
              ta darsdan{' '}
              <Stat metric="monitor_used" label="Monitorli darsda iMentor ochganlar" className="px-1">
                <b className="text-slate-700">{h.monitor_used}</b>
              </Stat>{' '}
              tasida ishlatilgan
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
            <div>
              <p className="text-slate-500">Nazoratdagi o‘qituvchi</p>
              <Stat metric="watched" label="Nazoratdagi o‘qituvchilar" className="px-1">
                <p className="text-[19px] font-bold tabular-nums text-slate-900">{h.watched_teachers}</p>
              </Stat>
            </div>
            <div>
              <p className="text-slate-500">Umuman ishlatmagan</p>
              <Stat metric="idle" label="Monitorli darsda iMentor ochmaganlar" className="px-1">
                <p className={`text-[19px] font-bold tabular-nums ${h.idle_teachers ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {h.idle_teachers}
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

      {/* ---------------------------------------------------- nima qilgani */}
      <Modules data={data} />

      {/* ------------------------------------------ bahonasi yo'qlar va xonasi shubhalilar */}
      <AttentionList
        rows={data.attention}
        tone="rose"
        title="Monitori ishlayotgan xonada dars o‘tgan, lekin iMentor ochmagan"
        hint="Bu xonalarda boshqa o‘qituvchilar o‘sha kunlari iMentor ochgan — jihoz ishlagan."
        onOpen={open}
      />
      <AttentionList
        rows={data.check_room}
        tone="amber"
        title="Avval xonasini tekshirish kerak"
        hint="Bu xonalarda hech kim iMentor ocha olmagan — talab qilishdan oldin monitor tekshiriladi."
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
