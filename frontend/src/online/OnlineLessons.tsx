import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Lock,
  LockOpen,
  Play,
  Plus,
  Square,
  Users,
  Video,
  X,
} from 'lucide-react';
import JitsiRoom from './JitsiRoom';
import {
  closeTopic,
  createLesson,
  endLesson,
  fetchAttendance,
  fetchLessons,
  fetchMyGroups,
  markAttendance,
  openTopic,
  startLesson,
  type Attendance,
  type Lesson,
} from './onlineLessonApi';
import type { TeacherCourse, TeacherTopic } from './onlineTeacherApi';

/**
 * Video darslar: yaratish → boshlash → o'tkazish → tugatish → mavzuni ochish.
 *
 * Mavzu talabaga faqat oxirgi qadamdan keyin ochiladi — bu butun modulning
 * qulfi va u ataylab o'qituvchining qo'lida.
 */

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/"detail"\s*:\s*"([^"]+)"/);
  return m ? m[1] : msg || 'Xatolik';
}

function fmt(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('uz-UZ', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function minutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m > 0 ? `${m} daq` : '<1 daq';
}

export default function OnlineLessons({
  course,
  topics,
  teacherName,
}: {
  course: TeacherCourse;
  topics: TeacherTopic[];
  teacherName: string;
}) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [groups, setGroups] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [live, setLive] = useState<Lesson | null>(null);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [showAttendanceFor, setShowAttendanceFor] = useState<number | null>(null);

  const [topicCode, setTopicCode] = useState('');
  const [groupId, setGroupId] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ls, gs] = await Promise.all([
        fetchLessons(course.syllabus_id),
        fetchMyGroups(),
      ]);
      setLessons(ls.filter((l) => l.variant_label === course.variant_label));
      setGroups(gs);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [course]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const showAttendance = async (lesson: Lesson) => {
    setShowAttendanceFor(lesson.id);
    try {
      setAttendance(await fetchAttendance(lesson.id));
    } catch (e) {
      setError(errText(e));
    }
  };

  if (live) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">
              {live.group_name}
            </p>
            <h3 className="text-[15px] font-bold text-slate-900">
              {live.topic_code}. {live.topic_title || live.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              setLive(null);
              void reload();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50"
          >
            <X size={14} />
            Xonadan chiqish
          </button>
        </div>

        <JitsiRoom roomName={live.room_name} displayName={teacherName} height={560} />

        <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-600">
          Dars tugagach xonadan chiqing va ro'yxatdan <strong>"Tugatish"</strong>,
          so'ng <strong>"Mavzuni ochish"</strong> tugmalarini bosing — mavzu shundan
          keyin guruh talabalariga ko'rinadi.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Yopish">
            <X size={14} />
          </button>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-3">
        <h3 className="mb-2 text-[13.5px] font-bold text-slate-900">Yangi dars</h3>
        <div className="flex flex-wrap gap-2">
          <select
            value={topicCode}
            onChange={(e) => setTopicCode(e.target.value)}
            className="min-w-[12rem] flex-1 rounded-lg border border-slate-200 px-2.5 py-2 text-[13px]"
          >
            <option value="">Mavzu tanlang…</option>
            {topics.map((t) => (
              <option key={t.code} value={t.code}>
                {t.code}. {t.title}
              </option>
            ))}
          </select>
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="min-w-[9rem] rounded-lg border border-slate-200 px-2.5 py-2 text-[13px]"
          >
            <option value="">Guruh…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !topicCode || !groupId}
            onClick={() =>
              void run(async () => {
                await createLesson({
                  syllabus_id: course.syllabus_id,
                  variant_label: course.variant_label,
                  topic_code: topicCode,
                  group_id: Number(groupId),
                });
                setTopicCode('');
                setGroupId('');
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-[13px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            <Plus size={14} />
            Yaratish
          </button>
        </div>
        {groups.length === 0 && !loading && (
          <p className="mt-2 text-[12.5px] text-amber-700">
            Bu fanga hali guruh biriktirilmagan — administrator admin panelidan
            biriktirishi kerak.
          </p>
        )}
      </section>

      {loading ? (
        <div className="flex justify-center py-8 text-slate-400">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : lessons.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center text-[13px] text-slate-500">
          Hali dars yaratilmagan.
        </div>
      ) : (
        <div className="space-y-2">
          {lessons.map((l) => {
            const running = Boolean(l.started_at) && !l.ended_at;
            return (
              <div key={l.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold text-slate-800">
                      {l.topic_code}. {l.topic_title || l.title}
                    </p>
                    <p className="text-[12px] text-slate-500">
                      {l.group_name} · boshlandi {fmt(l.started_at)} · tugadi {fmt(l.ended_at)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${
                      l.is_opened
                        ? 'bg-emerald-100 text-emerald-700'
                        : running
                          ? 'bg-sky-100 text-sky-700'
                          : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {l.is_opened ? 'Mavzu ochiq' : running ? 'Davom etyapti' : 'Yopiq'}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {!l.started_at && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => startLesson(l.id))}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      <Play size={13} />
                      Boshlash
                    </button>
                  )}
                  {running && (
                    <>
                      <button
                        type="button"
                        onClick={() => setLive(l)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-sky-500"
                      >
                        <Video size={13} />
                        Xonaga kirish
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run(() => endLesson(l.id))}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Square size={13} />
                        Tugatish
                      </button>
                    </>
                  )}
                  {l.started_at && !l.is_opened && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => openTopic(l.id))}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      <LockOpen size={13} />
                      Mavzuni ochish
                    </button>
                  )}
                  {l.is_opened && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => closeTopic(l.id))}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Lock size={13} />
                      Yopish
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void showAttendance(l)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Users size={13} />
                    Davomat ({l.attendance_count})
                  </button>
                </div>

                {showAttendanceFor === l.id && (
                  <AttendancePanel
                    lesson={l}
                    rows={attendance}
                    onClose={() => setShowAttendanceFor(null)}
                    onChanged={async () => {
                      setAttendance(await fetchAttendance(l.id));
                      await reload();
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AttendancePanel({
  lesson,
  rows,
  onClose,
  onChanged,
}: {
  lesson: Lesson;
  rows: Attendance[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [sid, setSid] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[12.5px] font-semibold text-slate-700">
          Davomat — {rows.length} talaba
        </p>
        <button type="button" onClick={onClose} aria-label="Yopish">
          <X size={14} className="text-slate-400" />
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-[12.5px] text-slate-500">Hali hech kim qatnashmagan.</p>
      ) : (
        <ul className="mb-2 space-y-1">
          {rows.map((a) => (
            <li
              key={a.student_id}
              className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5 text-[12.5px]"
            >
              <CheckCircle2 size={13} className="shrink-0 text-emerald-500" />
              <span className="min-w-0 flex-1 truncate text-slate-800">
                {a.student_name || a.student_id}
                <span className="ml-1.5 font-mono text-[11px] text-slate-400">
                  {a.student_id}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {minutes(a.total_seconds)}
              </span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10.5px] ${
                  a.source === 'manual'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {a.source === 'manual' ? "qo'lda" : 'avto'}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await markAttendance(lesson.id, a.student_id, false);
                    await onChanged();
                  } finally {
                    setBusy(false);
                  }
                }}
                className="shrink-0 rounded p-0.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                aria-label="Olib tashlash"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-1.5">
        <input
          value={sid}
          onChange={(e) => setSid(e.target.value)}
          placeholder="Talaba ID"
          className="w-28 rounded-md border border-slate-200 px-2 py-1 text-[12.5px]"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ismi (ixtiyoriy)"
          className="min-w-[8rem] flex-1 rounded-md border border-slate-200 px-2 py-1 text-[12.5px]"
        />
        <button
          type="button"
          disabled={busy || !sid.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await markAttendance(lesson.id, sid.trim(), true, name.trim());
              setSid('');
              setName('');
              await onChanged();
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-md bg-slate-700 px-2.5 py-1 text-[12.5px] font-medium text-white hover:bg-slate-600 disabled:opacity-50"
        >
          Qo'shish
        </button>
      </div>
      <p className="mt-1.5 text-[11.5px] text-slate-500">
        Qo'lda qo'shish — interneti uzilib qolgan talaba uchun.
      </p>
    </div>
  );
}
