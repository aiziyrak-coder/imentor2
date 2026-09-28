import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Loader2, Users } from 'lucide-react';
import { errText } from './onlineError';
import {
  fetchMalakaProgress,
  type AttemptSummary,
  type ProgressReport,
  type ProgressStudent,
} from './malakaApi';
import { percentTone } from './MalakaTestRunner';
import type { TeacherCourse } from './onlineTeacherApi';

/**
 * Tinglovchilar natijasi (o'qituvchi, malaka oshirish).
 *
 * Ro'yxat farmoyish bo'yicha: portalga hali kirmagan tinglovchi ham
 * ko'rinadi — o'qituvchi kim orqada qolganini aynan shu yerdan biladi.
 */

const VIEW_LABEL: Record<string, string> = {
  lecture: "Ma'ruza",
  presentation: 'Taqdimot',
  video: 'Video',
};

function Chip({ label, summary, title }: { label: string; summary: AttemptSummary | null; title: string }) {
  const done = Boolean(summary && summary.used > 0);
  return (
    <span
      title={title}
      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
        done ? percentTone(summary?.best_percent) : 'bg-white text-slate-300 ring-1 ring-slate-100'
      }`}
    >
      {label} {done ? `${summary?.best_percent}%` : '—'}
    </span>
  );
}

export default function MalakaProgress({ course }: { course: TeacherCourse }) {
  const [groupId, setGroupId] = useState<number | undefined>(undefined);
  const [data, setData] = useState<ProgressReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchMalakaProgress(course.syllabus_id, groupId));
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [course, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const students = data?.students || [];
    const graded = students.filter((s) => s.average_grade !== null);
    return {
      count: students.length,
      entered: students.filter((s) => s.entry.used > 0).length,
      exited: students.filter((s) => s.exit.used > 0).length,
      avg: graded.length
        ? Math.round(graded.reduce((n, s) => n + (s.average_grade || 0), 0) / graded.length)
        : null,
      absent: students.filter((s) => !s.last_seen).length,
    };
  }, [data]);

  const groups = data?.groups || [];
  const students = data?.students || [];

  return (
    <div className="space-y-2.5">
      {groups.length > 1 && (
        <div className="online-tabs">
          {[{ id: undefined as number | undefined, name: 'Hammasi', count: groups.reduce((n, g) => n + g.count, 0) }, ...groups].map((g) => (
            <button
              key={g.id ?? 'all'}
              type="button"
              onClick={() => setGroupId(g.id)}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
                groupId === g.id ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {g.name} <span className="opacity-60">{g.count}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12 text-slate-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
      ) : students.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-12 text-center">
          <Users size={22} className="mx-auto mb-2 text-slate-300" />
          <p className="text-[13.5px] font-semibold text-slate-700">Tinglovchi yo‘q</p>
          <p className="mt-1 text-[12.5px] text-slate-500">
            Bu fanga hali guruh biriktirilmagan.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Tinglovchi', value: String(summary.count), hint: summary.absent ? `${summary.absent} tasi hali kirmagan` : 'hammasi kirgan' },
              { label: 'Kirish testi', value: data?.has_entry ? `${summary.entered}/${summary.count}` : '—', hint: !data?.has_entry ? 'qo‘yilmagan' : data.entry_published ? 'topshirgan' : 'e’lon qilinmagan' },
              { label: 'Chiqish testi', value: data?.has_exit ? `${summary.exited}/${summary.count}` : '—', hint: !data?.has_exit ? 'qo‘yilmagan' : data.exit_published ? 'topshirgan' : 'e’lon qilinmagan' },
              { label: "O'rtacha baho", value: summary.avg === null ? '—' : String(summary.avg), hint: 'mavzular bo‘yicha' },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{c.label}</p>
                <p className="mt-0.5 text-[17px] font-bold text-slate-900 tabular-nums">{c.value}</p>
                <p className="text-[11px] text-slate-400">{c.hint}</p>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            {students.map((s) => (
              <StudentRow
                key={s.student_id}
                student={s}
                expanded={open === s.student_id}
                onToggle={() => setOpen((v) => (v === s.student_id ? '' : s.student_id))}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StudentRow({
  student,
  expanded,
  onToggle,
}: {
  student: ProgressStudent;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`rounded-xl border bg-white transition ${
        expanded ? 'border-slate-300 shadow-sm' : 'border-slate-200'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-slate-900">
            {student.student_name}
          </span>
          <span className="block truncate text-[11.5px] text-slate-400">
            {student.group_name}
            {!student.last_seen && (
              <span className="ml-1.5 rounded bg-slate-100 px-1 py-px font-semibold text-slate-500">
                hali kirmagan
              </span>
            )}
          </span>
        </span>
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          <Chip label="Kirish" summary={student.entry} title="Kirish testi" />
          <Chip label="Chiqish" summary={student.exit} title="Chiqish testi" />
        </span>
        <span
          className={`shrink-0 rounded-lg px-2 py-1 text-[12.5px] font-bold tabular-nums ${percentTone(
            student.average_grade,
          )}`}
          title="Mavzular bo'yicha o'rtacha baho"
        >
          {student.average_grade === null ? '—' : student.average_grade}
        </span>
        <ChevronRight
          size={16}
          className={`shrink-0 text-slate-300 transition ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-slate-100 px-3.5 py-3">
          <div className="flex flex-wrap gap-1 sm:hidden">
            <Chip label="Kirish" summary={student.entry} title="Kirish testi" />
            <Chip label="Chiqish" summary={student.exit} title="Chiqish testi" />
          </div>
          {student.topics.length === 0 ? (
            <p className="text-[12.5px] text-slate-500">Fanda hali mavzu yo‘q.</p>
          ) : (
            <ul className="space-y-1.5">
              {student.topics.map((t, i) => (
                <li key={t.topic_code} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-slate-800">
                      <span className="text-slate-400">{i + 1}.</span> {t.topic_title || '—'}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {t.practical && (
                        <Chip
                          label="A"
                          summary={t.practical}
                          title={`Amaliy mashg‘ulot · urinish ${t.practical.used}/${t.practical.max_attempts}`}
                        />
                      )}
                      {t.test && (
                        <Chip label="T" summary={t.test} title={`Test · urinish ${t.test.used}/${t.test.max_attempts}`} />
                      )}
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11.5px] font-bold tabular-nums ${percentTone(t.grade)}`}
                        title="Mavzu bahosi"
                      >
                        {t.grade === null ? '—' : t.grade}
                      </span>
                    </span>
                  </div>
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {Object.entries(VIEW_LABEL).map(([kind, label]) => (
                      <span
                        key={kind}
                        className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${
                          t.viewed[kind] ? 'bg-emerald-50 text-emerald-700' : 'bg-white text-slate-300'
                        }`}
                      >
                        {t.viewed[kind] && <Check size={9} />}
                        {label}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
