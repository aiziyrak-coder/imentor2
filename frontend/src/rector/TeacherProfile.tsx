import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  BookOpen,
  CalendarDays,
  ClipboardList,
  Clock,
  GraduationCap,
  Loader2,
  Monitor,
  Radio,
  X,
} from 'lucide-react';
import { HttpError } from '../api/httpClient';
import { fetchTeacherDetail, type MonitorSlot, type ReportFilters, type TeacherDetail } from './rectorApi';
import { MODULES, moduleMinutes, pageLabel, teacherStatus, teacherStatusShort, teacherStatusText } from './RectorSections';
import { StatusChip, fmtDate, fmtMinutes, statusOf, type Status } from './RectorUi';
import { TeacherProfileContext, type OpenTeacher } from './TeacherProfileContext';
import { shiftDays } from './rectorDates';

/**
 * Bitta o'qituvchining to'liq hisoboti — hisobotning istalgan joyida ism
 * bosilganda ochiladi: vaqt va modullar, kunma-kun faollik, yaratgan
 * materiallari, o'tgan darslari va talabalari, monitor jadvali.
 */

type Target = { key: string; name: string; slots?: MonitorSlot[] };

const BAR: Record<Status, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-rose-500',
  none: 'bg-slate-300',
};

function nowKey(): string {
  return `${shiftDays(0)} ${new Date().toTimeString().slice(0, 5)}`;
}

function slotState(s: MonitorSlot, now: string): { status: Status; text: string } {
  if (s.used) return { status: 'good', text: 'Ishlatildi' };
  if (`${s.date} ${s.end_time}` > now) return { status: 'none', text: 'Kutilmoqda' };
  return { status: 'bad', text: 'Ishlatilmadi' };
}

function Kpi({ icon, label, value, hint, status }: { icon: ReactNode; label: string; value: ReactNode; hint?: string; status?: Status }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white p-3 ring-1 ring-slate-200">
      {status && <span className={`absolute inset-y-0 left-0 w-1 ${BAR[status]}`} />}
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {icon} {label}
      </p>
      <p className="mt-1 text-[20px] font-black tabular-nums text-slate-900">{value}</p>
      {hint && <p className="text-[11.5px] text-slate-400">{hint}</p>}
    </div>
  );
}

function Section({ icon, title, extra, children }: { icon: ReactNode; title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[14px] font-bold text-slate-900">
          {icon} {title}
        </h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

function MonitorSlots({ slots }: { slots: MonitorSlot[] }) {
  const now = nowKey();
  const sorted = [...slots].sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
  if (!sorted.length) return <p className="text-[12.5px] text-slate-500">Bu oraliqda monitor jadvalida darsi yo‘q.</p>;
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {sorted.map((s) => {
        const st = slotState(s, now);
        return (
          <li key={`${s.monitor_id}-${s.date}-${s.para}`} className="relative flex items-center gap-3 overflow-hidden rounded-xl bg-slate-50 py-2 pl-3.5 pr-3 ring-1 ring-slate-100">
            <span className={`absolute inset-y-0 left-0 w-1 ${BAR[st.status]}`} />
            <div className="w-16 shrink-0 text-[11.5px] leading-tight">
              <b className="block text-slate-800">{s.weekday.slice(0, 2)} {s.date.slice(8)}.{s.date.slice(5, 7)}</b>
              <span className="text-slate-400">{s.start_time}</span>
            </div>
            <div className="min-w-0 flex-1 text-[12px] leading-tight">
              <p className="truncate font-semibold text-slate-900">{s.subject || '—'}</p>
              <p className="truncate text-slate-500">
                {s.monitor_id} · {s.room_full}
                {s.group ? ` · ${s.group}` : ''}
              </p>
            </div>
            <StatusChip status={st.status}>{st.text}</StatusChip>
          </li>
        );
      })}
    </ul>
  );
}

function DailyChart({ days }: { days: TeacherDetail['days'] }) {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const max = Math.max(1, ...ordered.map((d) => d.minutes));
  if (!ordered.length) return <p className="text-[12.5px] text-slate-500">Bu oraliqda iMentorga kirmagan.</p>;
  return (
    <div className="flex h-36 items-end gap-1 overflow-x-auto pb-5">
      {ordered.map((d) => (
        <div key={d.date} className="group relative flex h-full min-w-[22px] flex-1 flex-col items-center justify-end">
          <span className="mb-0.5 text-[10px] tabular-nums text-slate-500 opacity-0 transition group-hover:opacity-100">{d.minutes}</span>
          <div
            title={`${d.date}: ${d.minutes} daq`}
            className={`w-full rounded-t-md ${d.minutes ? 'bg-sky-500' : 'bg-slate-200'}`}
            style={{ height: `${Math.max(3, (d.minutes / max) * 100)}%` }}
          />
          <span className="absolute -bottom-4 text-[9.5px] text-slate-400">{d.date.slice(8)}.{d.date.slice(5, 7)}</span>
        </div>
      ))}
    </div>
  );
}

function ProfileDialog({ target, filters, onClose, onUnauthorized }: { target: Target; filters: ReportFilters; onClose: () => void; onUnauthorized: () => void }) {
  const [data, setData] = useState<TeacherDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(target.key));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!target.key) return;
    let alive = true;
    setLoading(true);
    fetchTeacherDetail(target.key, filters)
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (!alive) return;
        if (e instanceof HttpError && (e.status === 401 || e.status === 403)) onUnauthorized();
        else setError('O‘qituvchi hisobotini yuklab bo‘lmadi.');
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [target.key, filters.from, filters.to, filters.refreshKey, onUnauthorized]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Ostida monitor oynasi ochiq bo'lishi mumkin — Escape faqat shu oynani yopsin.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const modules = useMemo(() => (data ? moduleMinutes(data.pages) : null), [data]);
  const monitorSlots = data?.monitor?.slots ?? target.slots ?? [];
  const planned = data?.monitor?.planned_slots ?? monitorSlots.length;
  const used = data?.monitor?.used_slots ?? monitorSlots.filter((s) => s.used).length;
  const usage = planned ? Math.round((used * 100) / planned) : null;
  const status: Status = data ? teacherStatus(data) : 'none';
  const name = data?.display_name || target.name;

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${name} — to‘liq hisobot`}
        className="flex max-h-[100dvh] w-full max-w-6xl flex-col overflow-hidden bg-slate-50 shadow-2xl sm:max-h-[94vh] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-[20px] font-black text-white ${BAR[status]}`}>
            {name.trim().charAt(0).toUpperCase() || '?'}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-black leading-tight text-slate-950">{name}</h2>
            <p className="mt-0.5 text-[12.5px] text-slate-500">
              {[data?.department, data?.job_title].filter(Boolean).join(' · ') || (target.key ? '' : 'iMentor hisobi topilmagan — faqat monitor jadvali ko‘rsatiladi')}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px] text-slate-500">
              {data && <StatusChip status={status} title={teacherStatusText(data)}>{teacherStatusShort(data)}</StatusChip>}
              {data && <span>Oxirgi kirish: {fmtDate(data.last_login)}</span>}
              <span>
                {filters.from} — {filters.to}
              </span>
              {target.key && <span className="font-mono text-slate-400">{target.key}</span>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Yopish" className="rounded-full bg-white p-2 ring-1 ring-slate-200 hover:bg-slate-50">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-auto p-4 sm:p-5">
          {loading && (
            <div className="flex justify-center py-16 text-slate-400">
              <Loader2 size={28} className="animate-spin" />
            </div>
          )}
          {error && <p className="rounded-xl bg-rose-50 p-3 text-[13px] text-rose-700">{error}</p>}

          {!loading && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi icon={<Clock size={12} />} label="Jami vaqt" value={data ? fmtMinutes(data.minutes) || '0' : '—'} status={data ? (data.minutes ? 'good' : 'bad') : undefined} />
              <Kpi icon={<CalendarDays size={12} />} label="Faol kun" value={data?.active_days ?? '—'} />
              <Kpi icon={<ClipboardList size={12} />} label="Dars" value={data?.lessons_total ?? '—'} hint={data ? `QR test ${data.live_sessions} · online ${data.online_lessons}` : undefined} />
              <Kpi icon={<GraduationCap size={12} />} label="Talaba" value={data?.students_taught ?? '—'} hint={data ? `${data.student_attempts} urinish` : undefined} />
              <Kpi
                icon={<Activity size={12} />}
                label="O‘rtacha ball"
                value={data?.avg_student_score == null ? '—' : `${data.avg_student_score}%`}
                status={data?.avg_student_score == null ? undefined : statusOf(data.avg_student_score, 71, 56)}
              />
              <Kpi
                icon={<Monitor size={12} />}
                label="Monitor"
                value={usage === null ? '—' : `${usage}%`}
                hint={planned ? `${used}/${planned} dars ishlatildi` : 'jadvalda yo‘q'}
                status={usage === null ? undefined : statusOf(usage)}
              />
            </div>
          )}

          {!loading && (planned > 0 || !target.key) && (
            <Section icon={<Monitor size={15} />} title="Monitor jadvali" extra={<span className="text-[12px] text-slate-500">qaysi kun, qaysi para, qaysi xonada va ishlatildimi</span>}>
              <MonitorSlots slots={monitorSlots} />
            </Section>
          )}

          {data && modules && (
            <div className="grid gap-3 lg:grid-cols-2">
              <Section icon={<BookOpen size={15} />} title="Qaysi modulda necha daqiqa">
                {data.minutes === 0 ? (
                  <p className="text-[12.5px] text-slate-500">Bu oraliqda hech bir modulda ishlamagan.</p>
                ) : (
                  <ul className="space-y-2">
                    {[...MODULES.map((m) => ({ key: m.key, label: m.label, minutes: modules[m.key] })), { key: 'other', label: 'Boshqa', minutes: modules.other }]
                      .sort((a, b) => b.minutes - a.minutes)
                      .map((m) => {
                        const max = Math.max(1, ...MODULES.map((x) => modules[x.key]), modules.other);
                        return (
                          <li key={m.key} className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-2 text-[12.5px]">
                            <span className="truncate text-slate-600">{m.label}</span>
                            <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                              <span className={`block h-full rounded-full ${m.minutes ? 'bg-sky-500' : ''}`} style={{ width: `${(m.minutes / max) * 100}%` }} />
                            </span>
                            <span className={`text-right tabular-nums ${m.minutes ? 'font-semibold text-slate-900' : 'text-slate-300'}`}>{m.minutes} daq</span>
                          </li>
                        );
                      })}
                  </ul>
                )}
                {data.pages.length > 0 && (
                  <details className="mt-3 text-[12px]">
                    <summary className="cursor-pointer text-slate-500">Bo‘limlar bo‘yicha batafsil</summary>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {data.pages.map((p) => (
                        <li key={p.page} className="rounded-lg bg-slate-50 px-2 py-1 ring-1 ring-slate-200">
                          {pageLabel(p.page)} · <b>{p.minutes} daq</b> <span className="text-slate-400">({p.opens} marta)</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Section>

              <Section icon={<CalendarDays size={15} />} title="Kunma-kun faollik">
                <DailyChart days={data.days} />
              </Section>
            </div>
          )}

          {data && (
            <Section icon={<ClipboardList size={15} />} title="Yaratgan materiallari">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {[
                  ['Keys', data.cases_created],
                  ['Test', data.tests_created],
                  ['Tarqatma', data.handouts_created],
                  ['Video', data.videos_created],
                  ['Taqdimot', data.presentations_created],
                  ['Jami', data.created_total],
                ].map(([label, value]) => (
                  <div key={label as string} className={`rounded-xl px-2 py-2 text-center ring-1 ${label === 'Jami' ? 'bg-slate-900 text-white ring-slate-900' : 'bg-slate-50 ring-slate-100'}`}>
                    <p className="text-[18px] font-black tabular-nums">{value}</p>
                    <p className={`text-[10.5px] uppercase tracking-wide ${label === 'Jami' ? 'text-slate-300' : 'text-slate-400'}`}>{label}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {data && (
            <Section icon={<Radio size={15} />} title={`O‘tilgan darslar (${data.lessons.length})`}>
              {data.lessons.length === 0 ? (
                <p className="text-[12.5px] text-slate-500">Bu oraliqda QR test yoki online dars o‘tkazmagan.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-[12.5px]">
                    <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="py-1.5 pr-3">Sana</th>
                        <th className="pr-3">Turi</th>
                        <th className="pr-3">Fan / mavzu</th>
                        <th className="pr-3">Guruh</th>
                        <th className="pr-3 text-right">Talaba</th>
                        <th className="text-right">O‘rtacha ball</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.lessons.map((l) => (
                        <tr key={l.id}>
                          <td className="whitespace-nowrap py-2 pr-3 text-slate-500">{fmtDate(l.held_at)}</td>
                          <td className="pr-3">{l.kind_label}</td>
                          <td className="pr-3">
                            <span className="block text-slate-900">{l.topic || '—'}</span>
                            <span className="block text-[11px] text-slate-400">{l.subject_name}</span>
                          </td>
                          <td className="pr-3 text-slate-600">{l.group_name || '—'}</td>
                          <td className="pr-3 text-right tabular-nums">{l.students ? l.students : <StatusChip status="bad">0</StatusChip>}</td>
                          <td className="text-right">
                            {l.avg_score == null ? <span className="text-slate-300">—</span> : <StatusChip status={statusOf(l.avg_score, 71, 56)}>{l.avg_score}%</StatusChip>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

export function TeacherProfileProvider({ filters, onUnauthorized, children }: { filters: ReportFilters; onUnauthorized: () => void; children: ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null);
  const open = useCallback<OpenTeacher>((t) => setTarget(t), []);
  const close = useCallback(() => setTarget(null), []);
  return (
    <TeacherProfileContext.Provider value={open}>
      {children}
      {target && <ProfileDialog target={target} filters={filters} onClose={close} onUnauthorized={onUnauthorized} />}
    </TeacherProfileContext.Provider>
  );
}
