import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, Loader2, Monitor as MonitorIcon } from 'lucide-react';
import { HttpError } from '../api/httpClient';
import {
  fetchLessonDepartments,
  fetchLessonTeachers,
  fetchScheduledLessons,
  type LessonDepartmentRow,
  type ScheduledLessonRow,
  type LessonTeacherRow,
  type LessonTeachersReport,
  type ReportFilters,
} from './rectorApi';
import { Empty, ErrorBox, SectionTitle, SortableTable, Spinner, Stat, StatusDot, statusOf } from './RectorUi';

/**
 * Dars jadvali bo'yicha nazorat — har bir xodim kesimida (2026-09-25).
 *
 * Monitor hisobotidan farqi: bu yerda HAMMA dars bor (xonasida monitor
 * bo'lmasa ham) va HEMIS jadvalidagi har bir o'qituvchi ko'rinadi, kafedra
 * Excel yuborgan-yubormaganidan qat'i nazar.
 */

type Props = { filters: ReportFilters; onUnauthorized: () => void };

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

function pct(n: number): string {
  return `${n}%`;
}

function dayText(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' });
}

/** Bitta o'qituvchining darslari — qatorni ochganda ko'rinadi. */
function TeacherLessons({ filters, teacher }: { filters: ReportFilters; teacher: string }) {
  const { data, loading } = useLoad(
    () => fetchScheduledLessons({ ...filters, teacher }),
    [filters.from, filters.to, teacher],
    () => undefined,
  );
  if (loading) return <div className="px-3 py-4 text-slate-400"><Loader2 size={16} className="animate-spin" /></div>;
  const rows = data?.results || [];
  if (!rows.length) return <p className="px-3 py-3 text-[13px] text-slate-500">Bu davrda darsi yo‘q.</p>;
  return (
    <div className="overflow-x-auto px-3 py-2">
      <table className="w-full text-[12.5px]">
        <thead className="text-slate-400">
          <tr className="text-left">
            <th className="py-1 pr-3 font-medium">Sana</th>
            <th className="py-1 pr-3 font-medium">Para</th>
            <th className="py-1 pr-3 font-medium">Fan</th>
            <th className="py-1 pr-3 font-medium">Guruh</th>
            <th className="py-1 pr-3 font-medium">Xona</th>
            <th className="py-1 pr-3 font-medium">Holat</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l: ScheduledLessonRow) => (
            <tr key={l.id} className="border-t border-slate-100">
              <td className="py-1.5 pr-3 whitespace-nowrap text-slate-600">
                {dayText(l.date)} <span className="text-slate-400">{l.weekday.slice(0, 3)}</span>
              </td>
              <td className="py-1.5 pr-3 whitespace-nowrap text-slate-500">
                {l.para} <span className="text-slate-400">{l.start_time}</span>
              </td>
              <td className="py-1.5 pr-3">
                <span className="block text-slate-800">{l.subject || '—'}</span>
                <span className="text-[11px] text-slate-400">{l.lesson_type}</span>
              </td>
              <td className="py-1.5 pr-3 text-slate-600">{l.group || '—'}</td>
              <td className="py-1.5 pr-3 text-slate-600">
                {l.room || '—'}
                {l.monitor_id && (
                  <MonitorIcon size={12} className="ml-1 inline text-sky-500" aria-label="monitorli xona" />
                )}
              </td>
              <td className="py-1.5 pr-3 whitespace-nowrap">
                {l.used ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 size={13} /> ishlatgan{l.students ? ` · ${l.students} talaba` : ''}
                  </span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LessonReport({ filters, onUnauthorized }: Props) {
  const [open, setOpen] = useState('');
  const [onlyIdle, setOnlyIdle] = useState(false);

  const teachers = useLoad<LessonTeachersReport>(
    () => fetchLessonTeachers(filters),
    [filters.from, filters.to, filters.department, filters.q, filters.refreshKey],
    onUnauthorized,
  );
  const departments = useLoad<{ results: LessonDepartmentRow[] }>(
    () => fetchLessonDepartments(filters),
    [filters.from, filters.to, filters.refreshKey],
    onUnauthorized,
  );

  if (teachers.loading && !teachers.data) return <Spinner />;
  if (teachers.error) return <ErrorBox text={teachers.error} />;
  const report = teachers.data;
  if (!report) return null;
  const all = report.results;
  if (!all.length) return <Empty text="Bu davrda HEMIS jadvalida dars topilmadi." />;
  const rows = onlyIdle ? all.filter((r) => r.used_lessons === 0) : all;
  const t = report.totals;

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[13px] leading-relaxed text-blue-900">
        Manba — HEMIS dars jadvali: xonasida monitor bor-yo‘qligidan qat’i nazar, <b>hamma dars</b> hisobga olinadi.
        «Ishlatgan» degani — o‘qituvchi shu dars vaqtida (boshlanishidan 15 daqiqa oldin — tugagach 5 daqiqa)
        iMentor’da jonli test ochgan yoki QR bilan kompyuterga kirgan.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="O‘qituvchi" value={t.teachers} hint={`${t.linked_teachers} tasi iMentor hisobiga bog‘langan`} onClick={() => setOnlyIdle(false)} />
        <Stat label="Dars" value={t.lessons} hint={`${t.with_monitor} tasi monitorli xonada`} />
        <Stat
          label="Ishlatilgan dars"
          value={t.used_lessons}
          hint={pct(t.usage_percent)}
          status={statusOf(t.usage_percent)}
        />
        <Stat
          label="Umuman ishlatmagan"
          value={t.never_used}
          hint="birorta darsida ham"
          status={t.never_used ? 'bad' : 'good'}
          onClick={() => setOnlyIdle(true)}
        />
        <Stat label="Talaba (jonli test)" value={all.reduce((n, r) => n + r.students, 0)} />
        <Stat label="Hisobi yo‘q" value={t.teachers - t.linked_teachers} hint="HEMIS’da bor, iMentor’da yo‘q" status={t.teachers - t.linked_teachers ? 'warn' : 'good'} />
      </div>

      <section className="space-y-2">
        <SectionTitle
          title="Kafedralar — eng kam ishlatgandan"
          hint="Kafedrada nechta dars bo‘lgan va nechtasida iMentor ishlatilgan."
        />
        {departments.loading && !departments.data ? (
          <Spinner />
        ) : (
          <SortableTable
            rows={departments.data?.results || []}
            rowKey={(r) => r.department}
            initialSort={{ key: 'usage', dir: 'asc' }}
            cardPrimary="department"
            columns={[
              { key: 'department', label: 'Kafedra', value: (r) => r.department },
              { key: 'lessons', label: 'Dars', align: 'right', value: (r) => r.lessons },
              { key: 'used', label: 'Ishlatilgan', align: 'right', value: (r) => r.used_lessons },
              {
                key: 'usage',
                label: 'Ulush',
                align: 'right',
                value: (r) => r.usage_percent,
                render: (r) => (
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <StatusDot status={statusOf(r.usage_percent)} />
                    {pct(r.usage_percent)}
                  </span>
                ),
              },
              {
                key: 'teachers',
                label: 'O‘qituvchi',
                align: 'right',
                value: (r) => r.teachers,
                render: (r) => (
                  <span className="tabular-nums">
                    {r.active_teachers}/{r.teachers}
                  </span>
                ),
              },
            ]}
          />
        )}
      </section>

      <section className="space-y-2">
        <SectionTitle
          title={onlyIdle ? 'Birorta darsida ishlatmagan o‘qituvchilar' : 'O‘qituvchilar — eng kam ishlatgandan'}
          hint="Qatorni bosing — o‘sha o‘qituvchining har bir darsi, qaysisida ishlatgani ko‘rinadi."
        />
        {onlyIdle && (
          <button
            type="button"
            onClick={() => setOnlyIdle(false)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
          >
            ← Hammasini ko‘rsatish
          </button>
        )}
        <SortableTable
          rows={rows}
          rowKey={(r) => r.teacher_key || `name:${r.teacher_name}`}
          initialSort={{ key: 'usage', dir: 'asc' }}
          cardPrimary="teacher"
          cardSubtitle="department"
          onRowClick={(r) => setOpen(open === (r.teacher_key || r.teacher_name) ? '' : r.teacher_key || r.teacher_name)}
          expandedKey={open}
          renderExpanded={(r) =>
            r.teacher_key ? (
              <TeacherLessons filters={filters} teacher={r.teacher_key} />
            ) : (
              <p className="px-3 py-3 text-[13px] text-amber-700">
                Bu o‘qituvchining iMentor hisobi topilmadi (HEMIS Xodim ID: {r.employee_id || '—'}), shuning uchun
                darslari bo‘yicha faollik o‘lchanmaydi.
              </p>
            )
          }
          columns={[
            {
              key: 'teacher',
              label: 'O‘qituvchi',
              value: (r) => r.teacher_name,
              render: (r) => (
                <span>
                  <span className="block font-medium text-slate-900">{r.teacher_name}</span>
                  {!r.linked && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                      <AlertTriangle size={11} /> iMentor hisobi yo‘q
                    </span>
                  )}
                </span>
              ),
            },
            { key: 'department', label: 'Kafedra', value: (r) => r.department },
            {
              key: 'lessons',
              label: 'Dars',
              align: 'right',
              value: (r) => r.lessons,
              render: (r) => (
                <span className="tabular-nums">
                  {r.lessons}
                  <span className="block text-[11px] text-slate-400">{r.days} kun</span>
                </span>
              ),
            },
            { key: 'used', label: 'Ishlatilgan', align: 'right', value: (r) => r.used_lessons },
            {
              key: 'usage',
              label: 'Ulush',
              align: 'right',
              value: (r) => r.usage_percent,
              render: (r) => (
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <StatusDot status={r.linked ? statusOf(r.usage_percent) : 'none'} />
                  {r.linked ? pct(r.usage_percent) : '—'}
                </span>
              ),
            },
            {
              key: 'last',
              label: 'Oxirgi',
              align: 'right',
              value: (r) => r.last_used || '',
              render: (r) => <span className="whitespace-nowrap text-slate-500">{dayText(r.last_used)}</span>,
            },
          ]}
        />
        <p className="flex items-center gap-1.5 text-[12px] text-slate-400">
          <CalendarDays size={13} /> {rows.length} o‘qituvchi ko‘rsatilgan
        </p>
      </section>
    </div>
  );
}
