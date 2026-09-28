import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Award, BookOpen, CalendarDays, ClipboardList, Clock, Loader2, Radio, Trophy, Users, X } from 'lucide-react';
import { HttpError } from '../api/httpClient';
import { fetchStudentDetail, type ReportFilters, type StudentDetail } from './rectorApi';
import { BAND_LABEL } from './RectorSections';
import { StatusChip, fmtDate, statusOf, type Status } from './RectorUi';
import { StudentProfileContext, type OpenStudent } from './StudentProfileContext';
import TeacherName from './TeacherName';

/**
 * Bitta talabaning to'liq hisoboti — ism bosilganda ochiladi: umumiy natija va
 * reyting, fanlar bo'yicha, o'qituvchilar bo'yicha, kunma-kun va har bir testi.
 */

type Target = { key: string; name: string };

const BAR: Record<Status, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-rose-500',
  none: 'bg-slate-300',
};

/** Institut baho shkalasi: 71%+ yashil, 56–70% sariq, pasti qizil. */
const scoreStatus = (p: number | null | undefined): Status => statusOf(p, 71, 56);

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

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <h3 className="mb-3 flex items-center gap-1.5 text-[14px] font-bold text-slate-900">
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}

function BandChip({ band, percent }: { band: string; percent: number | null }) {
  const b = BAND_LABEL[band];
  if (percent === null) return <span className="text-slate-300">—</span>;
  return (
    <span className="whitespace-nowrap">
      <StatusChip status={b?.status ?? scoreStatus(percent)}>
        {percent}%{b ? ` · ${b.label}` : ''}
      </StatusChip>
    </span>
  );
}

function ScoreBars({ items, renderName }: { items: StudentDetail['subjects']; renderName?: (item: StudentDetail['subjects'][number]) => ReactNode }) {
  return (
    <ul className="space-y-2.5">
      {items.map((it) => {
        const st = scoreStatus(it.percent);
        return (
          <li key={it.key || it.name}>
            <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="min-w-0 truncate font-medium text-slate-800" title={it.name}>
                {renderName ? renderName(it) : it.name}
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {it.attempts} test · <b className="text-slate-900">{it.percent ?? '—'}%</b>
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${BAR[st]}`} style={{ width: `${Math.max(2, it.percent ?? 0)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DaysChart({ days }: { days: StudentDetail['days'] }) {
  return (
    <div className="flex h-36 items-end gap-1.5 overflow-x-auto pb-5">
      {days.map((d) => {
        const st = scoreStatus(d.percent);
        return (
          <div key={d.key} className="group relative flex h-full min-w-[28px] flex-1 flex-col items-center justify-end">
            <span className="mb-0.5 text-[10px] font-semibold tabular-nums text-slate-500">{d.percent ?? '—'}%</span>
            <div
              title={`${d.key}: ${d.attempts} test, o‘rtacha ${d.percent}%`}
              className={`w-full rounded-t-md ${BAR[st]}`}
              style={{ height: `${Math.max(4, d.percent ?? 0)}%` }}
            />
            <span className="absolute -bottom-4 text-[9.5px] text-slate-400">
              {d.key.slice(8)}.{d.key.slice(5, 7)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ProfileDialog({ target, filters, onClose, onUnauthorized }: { target: Target; filters: ReportFilters; onClose: () => void; onUnauthorized: () => void }) {
  const [data, setData] = useState<StudentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [subject, setSubject] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    fetchStudentDetail(target.key, filters)
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (!alive) return;
        if (e instanceof HttpError && (e.status === 401 || e.status === 403)) onUnauthorized();
        else if (e instanceof HttpError && e.status === 404) setError('Tanlangan oraliqda bu talabaning test natijasi yo‘q.');
        else setError('Talaba hisobotini yuklab bo‘lmadi.');
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [target.key, filters.from, filters.to, filters.refreshKey, onUnauthorized]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Ustida o'qituvchi oynasi ochilishi mumkin — u o'z Escape'ini o'zi to'xtatadi.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const attempts = useMemo(() => (data?.attempts || []).filter((a) => !subject || a.subject_code === subject), [data, subject]);
  const name = data?.display_name || target.name;
  const status = scoreStatus(data?.avg_percent);
  const topShare = data && data.rank_total ? Math.round((data.rank * 100) / data.rank_total) : null;

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
          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-[20px] font-black text-white ${data ? BAR[status] : 'bg-slate-300'}`}>
            {name.trim().charAt(0).toUpperCase() || '?'}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-black leading-tight text-slate-950">{name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px] text-slate-500">
              {data && <BandChip band={data.band} percent={data.avg_percent} />}
              <span className="font-mono text-slate-400">{data?.has_id === false ? 'ID kiritilmagan' : target.key}</span>
              <span>
                {filters.from} — {filters.to}
              </span>
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
          {error && <p className="rounded-xl bg-amber-50 p-3 text-[13px] text-amber-800">{error}</p>}

          {data && !loading && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Kpi icon={<Award size={12} />} label="O‘rtacha ball" value={data.avg_percent == null ? '—' : `${data.avg_percent}%`} hint={`${data.score_sum}/${data.score_total} to‘g‘ri javob`} status={status} />
                <Kpi icon={<ClipboardList size={12} />} label="Testlar" value={data.attempts_count} hint={`eng yaxshi ${data.best_percent}% · eng past ${data.worst_percent}%`} />
                <Kpi
                  icon={<Trophy size={12} />}
                  label="Reyting"
                  value={`${data.rank}-o‘rin`}
                  hint={`${data.rank_total} talaba ichida${topShare !== null ? ` · top ${topShare}%` : ''}`}
                  status={topShare === null ? undefined : topShare <= 30 ? 'good' : topShare <= 70 ? 'warn' : 'bad'}
                />
                <Kpi icon={<BookOpen size={12} />} label="Fanlar" value={data.subjects.length} />
                <Kpi icon={<Users size={12} />} label="O‘qituvchilar" value={data.teachers.length} />
                <Kpi icon={<Clock size={12} />} label="Testda vaqt" value={`${data.minutes} daq`} hint={`oxirgi test ${fmtDate(data.last_at)}`} />
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <Section icon={<BookOpen size={15} />} title="Fanlar bo‘yicha natija">
                  <ScoreBars items={data.subjects} />
                </Section>
                <Section icon={<Users size={15} />} title="O‘qituvchilar bo‘yicha">
                  <ScoreBars
                    items={data.teachers}
                    renderName={(t) => (t.key ? <TeacherName teacherKey={t.key} name={t.name} /> : t.name || '—')}
                  />
                </Section>
              </div>

              <Section icon={<CalendarDays size={15} />} title="Kunma-kun natija">
                <DaysChart days={data.days} />
              </Section>

              {(data.online.lessons > 0 || data.online.tests > 0) && (
                <Section icon={<Radio size={15} />} title="Online ta’lim">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Kpi icon={<Radio size={12} />} label="Online dars" value={data.online.lessons} />
                    <Kpi icon={<Clock size={12} />} label="Darsda vaqt" value={`${data.online.minutes} daq`} />
                    <Kpi icon={<ClipboardList size={12} />} label="Mavzu testi" value={data.online.tests} />
                    <Kpi
                      icon={<Award size={12} />}
                      label="O‘rtacha"
                      value={data.online.avg_percent == null ? '—' : `${data.online.avg_percent}%`}
                      status={data.online.avg_percent == null ? undefined : scoreStatus(data.online.avg_percent)}
                    />
                  </div>
                </Section>
              )}

              <Section icon={<ClipboardList size={15} />} title={`Barcha testlari (${attempts.length})`}>
                {data.subjects.length > 1 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {[{ key: '', name: 'Hammasi' }, ...data.subjects].map((s) => (
                      <button
                        key={s.key || 'all'}
                        type="button"
                        onClick={() => setSubject(s.key)}
                        title={s.name}
                        className={`max-w-[18rem] truncate rounded-full px-3 py-1 text-[12px] font-semibold ${subject === s.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-[12.5px]">
                    <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="py-1.5 pr-3">Sana</th>
                        <th className="pr-3">Fan / mavzu</th>
                        <th className="pr-3">O‘qituvchi</th>
                        <th className="pr-3 text-right">To‘g‘ri</th>
                        <th className="pr-3 text-right">Vaqt</th>
                        <th className="text-right">Natija</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {attempts.map((a) => (
                        <tr key={a.id}>
                          <td className="whitespace-nowrap py-2 pr-3 text-slate-500">{fmtDate(a.submitted_at)}</td>
                          <td className="pr-3">
                            <span className="block text-slate-900">{a.topic || '—'}</span>
                            <span className="block text-[11px] text-slate-400">
                              {a.subject_name}
                              {a.variant ? ` · ${a.variant}` : ''}
                            </span>
                          </td>
                          <td className="pr-3">{a.teacher_key ? <TeacherName teacherKey={a.teacher_key} name={a.teacher_name} /> : '—'}</td>
                          <td className="pr-3 text-right tabular-nums">
                            {a.score}/{a.total}
                          </td>
                          <td className="pr-3 text-right tabular-nums text-slate-500">{a.minutes} daq</td>
                          <td className="text-right">
                            <BandChip band={a.band} percent={a.percent} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function StudentProfileProvider({ filters, onUnauthorized, children }: { filters: ReportFilters; onUnauthorized: () => void; children: ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null);
  const open = useCallback<OpenStudent>((t) => setTarget(t), []);
  const close = useCallback(() => setTarget(null), []);
  return (
    <StudentProfileContext.Provider value={open}>
      {children}
      {target && <ProfileDialog target={target} filters={filters} onClose={close} onUnauthorized={onUnauthorized} />}
    </StudentProfileContext.Provider>
  );
}
