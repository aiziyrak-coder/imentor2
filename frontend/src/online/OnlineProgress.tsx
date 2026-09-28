import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Loader2, Users } from 'lucide-react';
import { errText } from './onlineError';
import {
  fetchTeacherProgress,
  type ProgressReport,
  type StudentProgress,
  type TeacherCourse,
} from './onlineTeacherApi';

/**
 * O'qituvchi uchun talabalar holati.
 *
 * Ilgari bu ma'lumot faqat admin panelida turardi: dars o'tadigan odam
 * kim ma'ruzani ochgan, kim test topshirgan, kim umuman kirmaganini
 * ko'ra olmasdi va guruhini ko'r-ko'rona olib borardi.
 */

const VIEW_LABEL: Record<string, string> = {
  lecture: "Ma'ruza",
  presentation: 'Taqdimot',
  video: 'Video',
  handout: 'Tarqatma',
};

/** Baho rangi: 86+ a'lo, 71+ yaxshi, 56+ qoniqarli, pastda e'tibor talab qiladi. */
function toneOf(grade: number | null): string {
  if (grade === null) return 'bg-slate-100 text-slate-500';
  if (grade >= 86) return 'bg-emerald-50 text-emerald-700';
  if (grade >= 71) return 'bg-sky-50 text-sky-700';
  if (grade >= 56) return 'bg-amber-50 text-amber-700';
  return 'bg-rose-50 text-rose-700';
}

export default function OnlineProgress({ course }: { course: TeacherCourse }) {
  const [data, setData] = useState<ProgressReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchTeacherProgress(course.syllabus_id, course.variant_label));
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [course]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const students = data?.students || [];
    // Yakuniy baho — test va vaziyatli masala o'rtachasi; faqat ikkalasini
    // ham topshirgan mavzular hisobga olinadi.
    const graded = students.filter((s) => s.average_grade !== null);
    const avg = graded.length
      ? Math.round(graded.reduce((n, s) => n + (s.average_grade || 0), 0) / graded.length)
      : null;
    return {
      count: students.length,
      tested: students.filter((s) => s.tests_taken > 0).length,
      cases: students.filter((s) => s.cases_taken > 0).length,
      avg,
      behind: students.filter((s) => s.tests_taken === 0 && s.cases_taken === 0).length,
    };
  }, [data]);

  if (loading) {
    return (
      <div className="flex justify-center py-12 text-slate-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>;
  }

  const students = data?.students || [];

  if (students.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-12 text-center">
        <Users size={22} className="mx-auto mb-2 text-slate-300" />
        <p className="text-[13.5px] font-semibold text-slate-700">Hali ma'lumot yo'q</p>
        <p className="mt-1 text-[12.5px] text-slate-500">
          Talabalar mavzuni ochib material ko'rgach yoki test topshirgach shu yerda chiqadi.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Talaba', value: String(summary.count) },
          { label: 'Test topshirgan', value: `${summary.tested}/${summary.count}` },
          { label: 'Masala topshirgan', value: `${summary.cases}/${summary.count}` },
          { label: "O'rtacha baho", value: summary.avg === null ? '—' : String(summary.avg) },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {c.label}
            </p>
            <p className="mt-0.5 text-[17px] font-bold text-slate-900 tabular-nums">{c.value}</p>
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
    </div>
  );
}

function StudentRow({
  student,
  expanded,
  onToggle,
}: {
  student: StudentProgress;
  expanded: boolean;
  onToggle: () => void;
}) {
  const done = student.topics.filter((t) => t.grade !== null).length;

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
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[12px] font-bold text-slate-600">
          {(student.student_name || '?').slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-slate-900">
            {student.student_name}
          </span>
          <span className="block truncate text-[11.5px] text-slate-400">
            {student.group_name}
            <span className="ml-1.5 font-mono">{student.student_id}</span>
            <span className="ml-1.5 sm:hidden">· {done} mavzu baholangan</span>
          </span>
        </span>
        <span className="hidden shrink-0 text-[12px] text-slate-500 tabular-nums sm:inline">
          {done} mavzu
        </span>
        <span
          className={`shrink-0 rounded-lg px-2 py-1 text-[12.5px] font-bold tabular-nums ${toneOf(
            student.average_grade,
          )}`}
          title="Yakuniy o'rtacha baho"
        >
          {student.average_grade === null ? '—' : student.average_grade}
        </span>
        <ChevronRight
          size={16}
          className={`shrink-0 text-slate-300 transition ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-3.5 py-3">
          <ul className="space-y-1.5">
            {student.topics.map((t) => (
              <li
                key={t.topic_code}
                className="rounded-lg bg-slate-50 px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-slate-800">
                    <span className="text-slate-400">{t.topic_code}.</span>{' '}
                    {t.topic_title || '—'}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                        t.test_done ? 'bg-slate-200 text-slate-700' : 'bg-white text-slate-300'
                      }`}
                      title="Test bahosi"
                    >
                      T {t.test_done ? t.test_percent : '—'}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                        t.case_done ? 'bg-violet-100 text-violet-700' : 'bg-white text-slate-300'
                      }`}
                      title="Vaziyatli masala bahosi"
                    >
                      M {t.case_done ? t.case_percent : '—'}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11.5px] font-bold tabular-nums ${toneOf(
                        t.grade,
                      )}`}
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
                        t.viewed[kind]
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-white text-slate-300'
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
        </div>
      )}
    </div>
  );
}
