import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownWideNarrow, CalendarClock, ChevronDown, LayoutGrid, Rows3, Search, Users, X } from 'lucide-react';
import type { MonitorReport, MonitorRow, MonitorSlot } from './rectorApi';
import { StatusDot, statusOf, type Status } from './RectorUi';
import TeacherName, { TeacherNames } from './TeacherName';
import { keyByName } from './MonitorDrill';

/**
 * "Barcha monitorlar" — jadval o'rniga kartochkalar.
 *
 * Har kartada: monitor qanchalik ishlatilgani (halqa), reja/ishlatildi/bo'sh
 * va hafta xaritasi (kun × para). Bosilsa — o'sha monitorning haftalik
 * jadvali: qaysi parada kim, qaysi fan, ishlatildimi.
 */

const WEEKDAYS = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma'];
const WEEKDAY_SHORT: Record<string, string> = { Dushanba: 'Du', Seshanba: 'Se', Chorshanba: 'Ch', Payshanba: 'Pa', Juma: 'Ju' };
const PARAS = ['1-para', '2-para', '3-para', '4-para', '5-para', '6-para'];

type Group = 'all' | Exclude<Status, 'none'> | 'empty';
type Sort = 'worst' | 'best' | 'planned' | 'id';

const GROUPS: Array<{ key: Group; label: string; hint: string; dot?: Status }> = [
  { key: 'all', label: 'Hammasi', hint: '' },
  { key: 'good', label: 'Yaxshi', hint: '70% va undan yuqori', dot: 'good' },
  { key: 'warn', label: 'O‘rtacha', hint: '40–69%', dot: 'warn' },
  { key: 'bad', label: 'Past', hint: '40% dan past', dot: 'bad' },
  { key: 'empty', label: 'Rejasiz', hint: 'tanlangan oraliqda reja yo‘q: jadval yuklanmagan yoki keyinroq kuchga kiradi', dot: 'none' },
];

const SORTS: Array<{ key: Sort; label: string }> = [
  { key: 'worst', label: 'Avval eng kam ishlatilgan' },
  { key: 'best', label: 'Avval eng ko‘p ishlatilgan' },
  { key: 'planned', label: 'Avval eng band' },
  { key: 'id', label: 'Monitor ID bo‘yicha' },
];

function monitorGroup(m: MonitorRow): Group {
  if (!m.planned_slots) return 'empty';
  return statusOf(m.usage_percent ?? 0) as Group;
}

const RING: Record<Status, string> = {
  good: 'stroke-emerald-500',
  warn: 'stroke-amber-500',
  bad: 'stroke-rose-500',
  none: 'stroke-slate-300',
};

const TEXT: Record<Status, string> = {
  good: 'text-emerald-600',
  warn: 'text-amber-600',
  bad: 'text-rose-600',
  none: 'text-slate-400',
};

const ACCENT: Record<Status, string> = {
  good: 'from-emerald-500/15',
  warn: 'from-amber-500/15',
  bad: 'from-rose-500/15',
  none: 'from-slate-400/10',
};

function UsageRing({ percent, status, size = 64 }: { percent: number | null; status: Status; size?: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="stroke-slate-100" />
        {percent !== null && (
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${(value / 100) * c} ${c}`}
            className={`${RING[status]} transition-all duration-700`}
          />
        )}
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-[13px] font-black tabular-nums ${TEXT[status]}`}>
        {percent === null ? '—' : `${Math.round(value)}%`}
      </span>
    </div>
  );
}

/** Bitta kun×para katagi holati (oraliqdagi barcha sanalar bo'yicha). */
type Cell = { planned: number; used: number; past: number; slots: MonitorSlot[] };

function cellTone(cell: Cell | undefined): { cls: string; label: string } {
  if (!cell || !cell.planned) return { cls: 'bg-slate-100', label: 'Bo‘sh' };
  if (cell.used >= cell.planned) return { cls: 'bg-emerald-500', label: 'Ishlatilgan' };
  if (!cell.past) return { cls: 'bg-sky-300', label: 'Rejada (hali vaqti kelmagan)' };
  if (cell.used > 0) return { cls: 'bg-amber-400', label: `${cell.used}/${cell.planned} marta ishlatilgan` };
  return { cls: 'bg-rose-500', label: 'Rejada edi, ishlatilmagan' };
}

/** Para tugagan bo'lsa — endi "ishlatilmadi" deyish mumkin. `now` = "YYYY-MM-DD HH:MM". */
function isOver(s: MonitorSlot, now: string): boolean {
  return `${s.date} ${s.end_time}` <= now;
}

function buildCells(slots: MonitorSlot[], today: string, key: (s: MonitorSlot) => string): Map<string, Cell> {
  const map = new Map<string, Cell>();
  for (const s of slots) {
    const k = `${key(s)}|${s.para}`;
    let c = map.get(k);
    if (!c) {
      c = { planned: 0, used: 0, past: 0, slots: [] };
      map.set(k, c);
    }
    c.slots.push(s);
    if (!s.planned) continue;
    c.planned += 1;
    if (s.used) c.used += 1;
    if (s.used || isOver(s, today)) c.past += 1;
  }
  return map;
}

function Heatmap({ cells }: { cells: Map<string, Cell> }) {
  return (
    <div className="grid grid-cols-[auto_repeat(6,minmax(0,1fr))] gap-[3px] text-[9px] text-slate-400">
      <span />
      {PARAS.map((p) => (
        <span key={p} className="text-center">{p[0]}</span>
      ))}
      {WEEKDAYS.map((d) => (
        <div key={d} className="contents">
          <span className="pr-1 leading-[14px]">{WEEKDAY_SHORT[d]}</span>
          {PARAS.map((p) => {
            const tone = cellTone(cells.get(`${d}|${p}`));
            return <span key={p} title={`${d}, ${p}: ${tone.label}`} className={`h-3.5 rounded-[3px] ${tone.cls}`} />;
          })}
        </div>
      ))}
    </div>
  );
}

function Legend() {
  const items = [
    ['bg-emerald-500', 'Ishlatilgan'],
    ['bg-amber-400', 'Qisman'],
    ['bg-rose-500', 'Ishlatilmagan'],
    ['bg-sky-300', 'Kutilmoqda'],
    ['bg-slate-100 ring-1 ring-slate-200', 'Bo‘sh'],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-500">
      {items.map(([cls, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-[3px] ${cls}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

function MonitorCard({ m, cells, onOpen }: { m: MonitorRow; cells: Map<string, Cell>; onOpen: () => void }) {
  const group = monitorGroup(m);
  const status: Status = group === 'empty' || group === 'all' ? 'none' : group;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br ${ACCENT[status]} to-white to-60% p-4 pb-7 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-slate-900 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-white">{m.monitor_id}</span>
            {m.teacher_count > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                <Users size={11} /> {m.teacher_count}
              </span>
            )}
          </div>
          <p className="mt-1.5 line-clamp-2 text-[13.5px] font-semibold leading-snug text-slate-900">{m.room_full || m.room}</p>
          <p className="mt-0.5 line-clamp-1 text-[11.5px] text-slate-500" title={m.department}>{m.department}</p>
        </div>
        <UsageRing percent={m.planned_slots ? m.usage_percent ?? 0 : null} status={status} />
      </div>

      {group === 'empty' ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/60 px-3 py-5 text-center text-[12px] text-slate-400">
          {m.schedule_from ? `Jadval ${fmtDay(m.schedule_from)} dan kuchga kiradi` : 'Bandlik jadvali yuklanmagan'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5 text-center">
            {[
              ['Reja', m.planned_slots, 'text-slate-900'],
              ['Ishlatildi', m.used_slots, 'text-emerald-600'],
              ['Ishlatilmadi', Math.max(0, m.planned_slots - m.used_slots), m.planned_slots - m.used_slots ? 'text-rose-600' : 'text-slate-400'],
            ].map(([label, value, cls]) => (
              <div key={label as string} className="rounded-lg bg-white/80 px-1 py-1.5 ring-1 ring-slate-100">
                <p className={`text-[16px] font-black tabular-nums ${cls}`}>{value}</p>
                <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
              </div>
            ))}
          </div>
          <Heatmap cells={cells} />
        </>
      )}
      <span className="absolute bottom-2 right-3 text-[10.5px] font-semibold text-slate-300 transition group-hover:text-slate-500">Batafsil →</span>
    </button>
  );
}

function fmtDay(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

function groupByDepartment(items: MonitorRow[]) {
  return [...new Set(items.map((m) => m.department))]
    .sort((a, b) => a.localeCompare(b, 'uz'))
    .map((d) => ({ title: d, items: items.filter((m) => m.department === d) }));
}

/** Rejasi yo'q monitorlar — katta karta emas, kafedralar bo'yicha ixcham ro'yxat. */
function CompactMonitors({
  items,
  tone,
  title,
  subtitle,
  open,
  onToggle,
  onPick,
}: {
  items: MonitorRow[];
  tone: 'sky' | 'slate';
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  onPick: (id: string) => void;
}) {
  const groups = groupByDepartment(items);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={open}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-black ${tone === 'sky' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'}`}>
          {items.length}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold text-slate-800">{title}</span>
          <span className="block text-[12px] text-slate-500">
            {groups.length} ta kafedra · {subtitle}
          </span>
        </span>
        <ChevronDown size={18} className={`shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="grid gap-3 border-t border-slate-100 p-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((d) => (
            <div key={d.title} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
              <p className="mb-2 line-clamp-2 text-[12.5px] font-semibold text-slate-700">
                {d.title} <span className="font-normal text-slate-400">· {d.items.length}</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {d.items.map((m) => (
                  <button
                    key={m.monitor_id}
                    type="button"
                    onClick={() => onPick(m.monitor_id)}
                    title={m.room_full}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-white px-2 py-1 text-[11.5px] text-slate-600 ring-1 ring-slate-200 hover:ring-slate-400"
                  >
                    <b className="text-slate-900">{m.monitor_id}</b>
                    <span className="truncate">{m.room || m.room_full}</span>
                    {m.schedule_from && <span className="rounded bg-sky-50 px-1 text-[10.5px] font-semibold text-sky-700">{fmtDay(m.schedule_from)} dan</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function slotBadge(s: MonitorSlot, today: string): { cls: string; text: string } {
  if (s.used) return { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', text: 'Ishlatildi' };
  if (!isOver(s, today)) return { cls: 'bg-sky-50 text-sky-700 ring-sky-200', text: 'Kutilmoqda' };
  return { cls: 'bg-rose-50 text-rose-700 ring-rose-200', text: 'Ishlatilmadi' };
}

function MonitorDetail({ m, slots, today, names, onClose }: { m: MonitorRow; slots: MonitorSlot[]; today: string; names: Map<string, string>; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const dates = useMemo(() => [...new Set(slots.map((s) => s.date))].sort(), [slots]);
  // Bir haftagacha — har sana alohida ustun; uzunroq oraliqda hafta kunlari bo'yicha jamlanadi.
  const byDate = dates.length <= 7;
  const columns = byDate
    ? dates.map((d) => ({ key: d, title: slots.find((s) => s.date === d)?.weekday || '', sub: d.slice(5).split('-').reverse().join('.') }))
    : WEEKDAYS.map((d) => ({ key: d, title: d, sub: 'oraliq bo‘yicha' }));
  const cells = useMemo(() => buildCells(slots, today, (s) => (byDate ? s.date : s.weekday)), [slots, today, byDate]);
  const group = monitorGroup(m);
  const status: Status = group === 'empty' || group === 'all' ? 'none' : group;

  const teachers = useMemo(() => {
    const map = new Map<string, { name: string; planned: number; used: number }>();
    for (const s of slots) {
      if (!s.planned) continue;
      for (const name of s.teacher_name.split(' / ').filter(Boolean)) {
        const t = map.get(name) || { name, planned: 0, used: 0 };
        t.planned += 1;
        if (s.used) t.used += 1;
        map.set(name, t);
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'uz'));
  }, [slots]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${m.monitor_id} monitor jadvali`}
        className="flex max-h-[100dvh] w-full max-w-7xl flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex flex-wrap items-center gap-4 border-b border-slate-100 bg-gradient-to-r ${ACCENT[status]} to-white px-5 py-4`}>
          <UsageRing percent={m.planned_slots ? m.usage_percent ?? 0 : null} status={status} size={72} />
          <div className="min-w-0 flex-1">
            <span className="rounded-md bg-slate-900 px-1.5 py-0.5 text-[12px] font-bold text-white">{m.monitor_id}</span>
            <h2 className="mt-1 text-[18px] font-black leading-tight text-slate-950">{m.room_full || m.room}</h2>
            <p className="text-[12.5px] text-slate-500">{m.department}</p>
          </div>
          <div className="flex gap-2 text-center">
            {[
              ['Reja', m.planned_slots, 'text-slate-900'],
              ['Ishlatildi', m.used_slots, 'text-emerald-600'],
              ['Ishlatilmadi', Math.max(0, m.planned_slots - m.used_slots), 'text-rose-600'],
              ['Bo‘sh', m.free_slots, 'text-slate-500'],
            ].map(([label, value, cls]) => (
              <div key={label as string} className="min-w-[4.5rem] rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
                <p className={`text-[20px] font-black tabular-nums ${cls}`}>{value}</p>
                <p className="text-[10.5px] uppercase tracking-wide text-slate-400">{label}</p>
              </div>
            ))}
          </div>
          <button type="button" onClick={onClose} aria-label="Yopish" className="rounded-full bg-white p-2 ring-1 ring-slate-200 hover:bg-slate-50">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-700">
              <CalendarClock size={15} /> {byDate ? 'Haftalik jadval' : 'Hafta kunlari bo‘yicha (tanlangan oraliq)'}
            </p>
            <Legend />
          </div>

          <div className="overflow-x-auto rounded-2xl ring-1 ring-slate-200">
            <table className="w-full min-w-[760px] border-collapse text-[12px]">
              <thead>
                <tr className="bg-slate-50">
                  <th className="w-20 px-2 py-2 text-left text-[11px] font-semibold text-slate-400">Para</th>
                  {columns.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-left">
                      <span className={`block text-[12.5px] font-bold ${c.key === today.slice(0, 10) ? 'text-sky-700' : 'text-slate-800'}`}>{c.title}</span>
                      <span className="block text-[10.5px] font-normal text-slate-400">{c.key === today.slice(0, 10) ? 'bugun' : c.sub}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PARAS.map((p) => {
                  const time = slots.find((s) => s.para === p);
                  return (
                    <tr key={p} className="border-t border-slate-100">
                      <td className="px-2 py-2 align-top">
                        <span className="block font-bold text-slate-700">{p}</span>
                        <span className="block text-[10.5px] text-slate-400">{time ? `${time.start_time}–${time.end_time}` : ''}</span>
                      </td>
                      {columns.map((c) => {
                        const cell = cells.get(`${c.key}|${p}`);
                        const planned = cell?.slots.filter((s) => s.planned) || [];
                        if (!planned.length) {
                          return (
                            <td key={c.key} className="p-1 align-top">
                              <div className="flex h-full min-h-[64px] items-center justify-center rounded-xl bg-slate-50 text-[11px] text-slate-300">bo‘sh</div>
                            </td>
                          );
                        }
                        const tone = cellTone(cell);
                        const first = planned[0];
                        const badge = byDate ? slotBadge(first, today) : null;
                        return (
                          <td key={c.key} className="p-1 align-top">
                            <div className="relative min-h-[64px] overflow-hidden rounded-xl bg-white p-2 pl-3 ring-1 ring-slate-200">
                              <span className={`absolute inset-y-0 left-0 w-1 ${tone.cls}`} />
                              <p className="line-clamp-2 font-semibold leading-snug text-slate-900">
                                <TeacherNames names={first.teacher_name} keyByName={names} slots={slots} />
                              </p>
                              <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500" title={first.subject}>{first.subject || '—'}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {first.group && <span className="rounded bg-slate-100 px-1 text-[10.5px] text-slate-600">{first.group}</span>}
                                {badge ? (
                                  <span className={`rounded px-1 text-[10.5px] font-semibold ring-1 ${badge.cls}`}>{badge.text}</span>
                                ) : (
                                  <span className="rounded bg-slate-100 px-1 text-[10.5px] font-semibold text-slate-600">{cell!.used}/{cell!.planned} ishlatildi</span>
                                )}
                                {byDate && first.student_count > 0 && <span className="text-[10.5px] text-slate-400">{first.student_count} talaba</span>}
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {teachers.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-slate-700"><Users size={15} /> Shu monitorda dars o‘tadigan o‘qituvchilar</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {teachers.map((t) => {
                  const pctUsed = t.planned ? Math.round((t.used * 100) / t.planned) : 0;
                  const st = statusOf(pctUsed);
                  return (
                    <div key={t.name} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                      <StatusDot status={st} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-slate-900">
                          <TeacherName
                            teacherKey={names.get(t.name) || ''}
                            name={t.name}
                            slots={slots.filter((s) => s.planned && s.teacher_name.split(' / ').includes(t.name))}
                          />
                        </p>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div className={`h-full rounded-full ${st === 'good' ? 'bg-emerald-500' : st === 'warn' ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${pctUsed}%` }} />
                        </div>
                      </div>
                      <span className="text-right text-[11.5px] tabular-nums text-slate-500">
                        <b className={TEXT[st]}>{pctUsed}%</b>
                        <br />
                        {t.used}/{t.planned}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MonitorExplorer({ report, today: day }: { report: MonitorReport; today: string }) {
  // Daqiqagacha aniq: bugungi hali tugamagan para "ishlatilmadi" bo'lib ko'rinmasin.
  const today = `${day} ${new Date().toTimeString().slice(0, 5)}`;
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Group>('all');
  const [sort, setSort] = useState<Sort>('worst');
  const [byDept, setByDept] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [openId, setOpenId] = useState('');
  const closeDetail = useCallback(() => setOpenId(''), []);
  const teacherKeys = useMemo(() => keyByName(report), [report]);

  const slotsByMonitor = useMemo(() => {
    const map = new Map<string, MonitorSlot[]>();
    for (const s of report.slots) {
      const list = map.get(s.monitor_id);
      if (list) list.push(s);
      else map.set(s.monitor_id, [s]);
    }
    return map;
  }, [report.slots]);

  const cellsByMonitor = useMemo(() => {
    const map = new Map<string, Map<string, Cell>>();
    for (const [id, slots] of slotsByMonitor) map.set(id, buildCells(slots, today, (s) => s.weekday));
    return map;
  }, [slotsByMonitor, today]);

  const needle = q.trim().toLowerCase();
  const matchesSearch = (m: MonitorRow) => {
    if (!needle) return true;
    if (`${m.monitor_id} ${m.room_full} ${m.department} ${m.building}`.toLowerCase().includes(needle)) return true;
    return (slotsByMonitor.get(m.monitor_id) || []).some((s) => s.planned && `${s.teacher_name} ${s.subject} ${s.group}`.toLowerCase().includes(needle));
  };

  const searched = report.monitors.filter(matchesSearch);
  const counts = GROUPS.reduce<Record<Group, number>>(
    (acc, g) => ({ ...acc, [g.key]: g.key === 'all' ? searched.length : searched.filter((m) => monitorGroup(m) === g.key).length }),
    { all: 0, good: 0, warn: 0, bad: 0, empty: 0 },
  );

  const shown = searched
    .filter((m) => group === 'all' || monitorGroup(m) === group)
    .sort((a, b) => {
      // Jadvalsiz monitorlar har doim oxirida — ularda solishtiradigan narsa yo'q.
      const ea = a.planned_slots ? 0 : 1;
      const eb = b.planned_slots ? 0 : 1;
      if (sort !== 'id' && ea !== eb) return ea - eb;
      if (sort === 'worst') return (a.usage_percent ?? 0) - (b.usage_percent ?? 0) || b.planned_slots - a.planned_slots;
      if (sort === 'best') return (b.usage_percent ?? 0) - (a.usage_percent ?? 0) || b.planned_slots - a.planned_slots;
      if (sort === 'planned') return b.planned_slots - a.planned_slots;
      return a.monitor_id.localeCompare(b.monitor_id, 'uz', { numeric: true });
    });

  // Jadvali yuklanmagan monitorlar katta karta emas — pastda ixcham ro'yxat bo'lib turadi.
  const scheduled = shown.filter((m) => m.planned_slots > 0);
  const unscheduled = shown.filter((m) => !m.planned_slots);
  const upcoming = unscheduled.filter((m) => m.schedule_from);
  const missing = unscheduled.filter((m) => !m.schedule_from);
  const emptyOpen = showEmpty || group === 'empty' || scheduled.length === 0;
  const sections = byDept ? groupByDepartment(scheduled) : [{ title: '', items: scheduled }];

  const opened = report.monitors.find((m) => m.monitor_id === openId);

  return (
    <section className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-black text-slate-950">Barcha monitorlar</h2>
            <p className="text-[12.5px] text-slate-500">Kartani bosing — shu monitorning haftalik jadvali ochiladi: qaysi parada kim, qaysi fan va ishlatildimi.</p>
          </div>
          <Legend />
        </div>

        <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 focus-within:border-slate-400 focus-within:bg-white">
            <Search size={15} className="shrink-0 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Monitor ID, xona, kafedra, o‘qituvchi yoki fan"
              className="w-full bg-transparent py-2.5 text-[13.5px] outline-none"
            />
            {q && (
              <button type="button" onClick={() => setQ('')} aria-label="Tozalash">
                <X size={14} className="text-slate-400" />
              </button>
            )}
          </label>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-2.5 text-[12.5px] text-slate-600">
              <ArrowDownWideNarrow size={15} className="text-slate-400" />
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="bg-transparent py-2.5 outline-none" aria-label="Tartib">
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </label>
            <div className="flex rounded-xl border border-slate-200 p-0.5" role="group" aria-label="Ko‘rinish">
              <button type="button" onClick={() => setByDept(false)} title="Hammasi birga" className={`rounded-lg p-2 ${!byDept ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                <LayoutGrid size={15} />
              </button>
              <button type="button" onClick={() => setByDept(true)} title="Kafedralar bo‘yicha guruhlash" className={`rounded-lg p-2 ${byDept ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                <Rows3 size={15} />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
          {GROUPS.map((g) => {
            const active = group === g.key;
            return (
              <button
                key={g.key}
                type="button"
                title={g.hint}
                onClick={() => setGroup(g.key)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition ${active ? 'bg-slate-900 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {g.dot && <StatusDot status={g.dot} />}
                {g.label}
                <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${active ? 'bg-white/20' : 'bg-white text-slate-500'}`}>{counts[g.key]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-14 text-center text-[13px] text-slate-500">
          Bu filtrga mos monitor topilmadi.
        </div>
      ) : (
        <>
          {sections.map((sec) => (
            <div key={sec.title || 'all'} className="space-y-2">
              {sec.title && (
                <p className="px-1 pt-2 text-[13px] font-bold text-slate-700">
                  {sec.title} <span className="font-normal text-slate-400">· {sec.items.length} monitor</span>
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {sec.items.map((m) => (
                  <MonitorCard key={m.monitor_id} m={m} cells={cellsByMonitor.get(m.monitor_id) || new Map()} onOpen={() => setOpenId(m.monitor_id)} />
                ))}
              </div>
            </div>
          ))}
          {upcoming.length > 0 && (
            <CompactMonitors
              items={upcoming}
              tone="sky"
              title="Jadvali keyinroq kuchga kiradigan monitorlar"
              subtitle={`Kafedra jadvalni ${fmtDay(upcoming.map((m) => m.schedule_from!).sort()[0])} dan boshlanadigan hafta uchun topshirgan — tanlangan oraliqda hali reja yo‘q, shuning uchun ishlatilmadi deb hisoblanmaydi`}
              open={showUpcoming || scheduled.length === 0}
              onToggle={() => setShowUpcoming((v) => !v)}
              onPick={setOpenId}
            />
          )}
          {missing.length > 0 && (
            <CompactMonitors
              items={missing}
              tone="slate"
              title="Bandlik jadvali yuklanmagan monitorlar"
              subtitle="jadval kelgach, bu monitorlar ham yuqoridagi kartalarga o‘tadi"
              open={emptyOpen}
              onToggle={() => setShowEmpty((v) => !v)}
              onPick={setOpenId}
            />
          )}
        </>
      )}

      {opened && <MonitorDetail m={opened} slots={slotsByMonitor.get(opened.monitor_id) || []} today={today} names={teacherKeys} onClose={closeDetail} />}
    </section>
  );
}
