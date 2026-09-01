import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  Loader2,
  Presentation,
  Save,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import {
  deleteMaterial,
  fetchMaterials,
  fetchTeacherMe,
  fetchTeacherTopics,
  KIND_LABEL,
  MATERIAL_KINDS,
  saveMaterial,
  uploadMaterial,
  type Material,
  type MaterialKind,
  type TeacherCourse,
  type TeacherTopic,
} from './onlineTeacherApi';

/**
 * O'qituvchi kabineti: fan → mavzu → material.
 *
 * Har mavzu oltita materialni talab qiladi (ma'ruza, taqdimot, video,
 * tarqatma, keys, 10 ta test). Ro'yxatda har mavzuning nechtasi tayyor ekani
 * darrov ko'rinadi — o'qituvchi qayerda to'xtaganini eslab o'tirmasin.
 */

const FILE_KINDS: MaterialKind[] = ['handout', 'presentation'];
const TEXT_KINDS: MaterialKind[] = ['lecture', 'case'];

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/"detail"\s*:\s*"([^"]+)"/);
  return m ? m[1] : msg || 'Xatolik';
}

function kindIcon(kind: MaterialKind) {
  if (kind === 'presentation') return Presentation;
  if (kind === 'video') return Video;
  if (kind === 'handout') return Upload;
  return FileText;
}

export default function OnlineTeacherCabinet({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [notTeacher, setNotTeacher] = useState(false);
  const [course, setCourse] = useState<TeacherCourse | null>(null);
  const [topics, setTopics] = useState<TeacherTopic[]>([]);
  const [topic, setTopic] = useState<TeacherTopic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTeacherMe()
      .then((me) => {
        if (!me.is_online_teacher) {
          setNotTeacher(true);
          return;
        }
        setCourses(me.courses);
        if (me.courses.length === 1) setCourse(me.courses[0]);
      })
      .catch((e) => {
        if (/401/.test(String(e))) onUnauthorized();
        else setError(errText(e));
      })
      .finally(() => setLoading(false));
  }, [onUnauthorized]);

  const loadTopics = useCallback(async (c: TeacherCourse) => {
    setLoading(true);
    setError('');
    try {
      setTopics(await fetchTeacherTopics(c.syllabus_id, c.variant_label));
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (course) void loadTopics(course);
  }, [course, loadTopics]);

  if (loading && !courses.length && !notTeacher) {
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Loader2 size={22} className="animate-spin" />
      </div>
    );
  }

  if (notTeacher) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
        <p className="text-[14px] font-semibold text-amber-900">
          Siz online ta'lim o'qituvchisi sifatida belgilanmagansiz.
        </p>
        <p className="mt-1 text-[13px] text-amber-800">
          Administrator sizni iMentor admin panelidagi "Online ta'lim" bo'limidan
          qo'shishi kerak.
        </p>
      </div>
    );
  }

  if (topic && course) {
    return (
      <TopicMaterials
        course={course}
        topic={topic}
        onBack={() => {
          setTopic(null);
          void loadTopics(course);
        }}
      />
    );
  }

  if (course) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setCourse(null)}
          disabled={courses.length <= 1}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-800 disabled:opacity-0"
        >
          <ArrowLeft size={15} />
          Fanlar
        </button>

        <header>
          <h2 className="text-lg font-bold text-slate-900">{course.subject_name}</h2>
          <p className="text-[12.5px] text-slate-500">
            {course.variant_label ? `${course.variant_label} · ` : ''}
            {topics.length} ta mavzu
          </p>
        </header>

        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
        )}

        <div className="space-y-1.5">
          {topics.map((t) => (
            <button
              key={t.code}
              type="button"
              onClick={() => setTopic(t)}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-slate-300 hover:bg-slate-50"
            >
              <span className="w-8 shrink-0 text-center font-mono text-[12px] font-semibold text-slate-400">
                {t.code}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-slate-800">
                  {t.title}
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {MATERIAL_KINDS.map((k) => (
                    <span
                      key={k}
                      title={KIND_LABEL[k]}
                      className={`h-1.5 w-6 rounded-full ${
                        t.has[k] ? 'bg-emerald-500' : 'bg-slate-200'
                      }`}
                    />
                  ))}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${
                  t.ready === MATERIAL_KINDS.length
                    ? 'bg-emerald-100 text-emerald-700'
                    : t.ready > 0
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {t.ready}/{MATERIAL_KINDS.length}
              </span>
              <ChevronRight size={16} className="shrink-0 text-slate-300" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <header>
        <h2 className="text-lg font-bold text-slate-900">Fanlarim</h2>
        <p className="text-[12.5px] text-slate-500">
          Online ta'lim bo'yicha sizga biriktirilgan fanlar
        </p>
      </header>

      {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}

      {courses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-10 text-center text-[13px] text-slate-500">
          Sizga hali fan biriktirilmagan.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {courses.map((c) => (
            <button
              key={`${c.syllabus_id}-${c.variant_label}`}
              type="button"
              onClick={() => setCourse(c)}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left hover:border-slate-300 hover:bg-slate-50"
            >
              <BookOpen size={18} className="shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-slate-800">
                  {c.subject_name}
                </span>
                <span className="text-[12px] text-slate-500">
                  {c.variant_label ? `${c.variant_label} · ` : ''}
                  {c.topic_count} mavzu
                </span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-slate-300" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ==================== Bitta mavzu materiallari ==================== */

function TopicMaterials({
  course,
  topic,
  onBack,
}: {
  course: TeacherCourse;
  topic: TeacherTopic;
  onBack: () => void;
}) {
  const [items, setItems] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKind, setBusyKind] = useState<MaterialKind | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const byKind = useMemo(() => {
    const m = new Map<MaterialKind, Material>();
    for (const it of items) m.set(it.kind, it);
    return m;
  }, [items]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchMaterials(course.syllabus_id, course.variant_label, topic.code));
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [course, topic]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((n) => (n === text ? '' : n)), 2500);
  };

  const run = async (kind: MaterialKind, fn: () => Promise<unknown>, ok: string) => {
    setBusyKind(kind);
    setError('');
    try {
      await fn();
      await reload();
      flash(ok);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusyKind(null);
    }
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Mavzular
      </button>

      <header>
        <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">
          {course.subject_name}
        </p>
        <h2 className="text-lg font-bold text-slate-900">
          {topic.code}. {topic.title}
        </h2>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Yopish">
            <X size={14} />
          </button>
        </div>
      )}
      {notice && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">{notice}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-10 text-slate-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {MATERIAL_KINDS.map((kind) => (
            <MaterialCard
              key={kind}
              kind={kind}
              course={course}
              topicCode={topic.code}
              existing={byKind.get(kind)}
              busy={busyKind === kind}
              onSave={(fn, ok) => void run(kind, fn, ok)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MaterialCard({
  kind,
  course,
  topicCode,
  existing,
  busy,
  onSave,
}: {
  kind: MaterialKind;
  course: TeacherCourse;
  topicCode: string;
  existing?: Material;
  busy: boolean;
  onSave: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const Icon = kindIcon(kind);
  const done = Boolean(existing);

  useEffect(() => {
    if (!open) return;
    setText(String((existing?.payload as { text?: string })?.text || ''));
    setUrl(existing?.external_url || '');
  }, [open, existing]);

  const base = {
    syllabus_id: course.syllabus_id,
    variant_label: course.variant_label,
    topic_code: topicCode,
  };

  const testCount = Array.isArray((existing?.payload as { questions?: unknown[] })?.questions)
    ? ((existing?.payload as { questions: unknown[] }).questions || []).length
    : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            done ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'
          }`}
        >
          {done ? <Check size={16} /> : <Icon size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold text-slate-800">
            {KIND_LABEL[kind]}
          </span>
          <span className="block truncate text-[12px] text-slate-500">
            {existing
              ? kind === 'test'
                ? `${testCount} ta savol`
                : existing.file_name || existing.title || existing.external_url || 'Saqlangan'
              : 'Hali tayyorlanmagan'}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
        >
          {open ? 'Yopish' : existing ? "O'zgartirish" : "Qo'shish"}
        </button>
      </div>

      {open && (
        <div className="space-y-2 border-t border-slate-100 px-3 py-3">
          {FILE_KINDS.includes(kind) && (
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-[13px] text-slate-600 hover:bg-slate-100">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              <span>Fayl tanlang (PDF, JPG, PNG — 40 MB gacha)</span>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  onSave(
                    () => uploadMaterial(f, { ...base, kind: kind as 'handout' | 'presentation' }),
                    'Fayl yuklandi.',
                  );
                }}
              />
            </label>
          )}

          {kind === 'video' && (
            <div className="flex flex-wrap gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="min-w-[14rem] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[13px]"
              />
              <button
                type="button"
                disabled={busy || !url.trim()}
                onClick={() =>
                  onSave(
                    () => saveMaterial({ ...base, kind, external_url: url.trim() }),
                    'Video havolasi saqlandi.',
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-[13px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                <Save size={14} />
                Saqlash
              </button>
            </div>
          )}

          {TEXT_KINDS.includes(kind) && (
            <div className="space-y-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder={
                  kind === 'lecture'
                    ? "Ma'ruza matnini yozing yoki iMentor'da AI bilan tayyorlab, shu yerga qo'ying."
                    : 'Vaziyatli masala matni va yechimi.'
                }
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] leading-relaxed"
              />
              <button
                type="button"
                disabled={busy || !text.trim()}
                onClick={() =>
                  onSave(
                    () => saveMaterial({ ...base, kind, payload: { text: text.trim() } }),
                    'Saqlandi.',
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-[13px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                <Save size={14} />
                Saqlash
              </button>
            </div>
          )}

          {kind === 'test' && (
            <p className="rounded-lg bg-slate-50 px-3 py-3 text-[12.5px] text-slate-600">
              Testlar iMentor'da AI bilan tayyorlanadi va shu yerga ko'chiriladi.
              Keyingi bosqichda bu tugma to'g'ridan-to'g'ri AI'ga ulanadi.
              {existing ? ` Hozir ${testCount} ta savol saqlangan.` : ''}
            </p>
          )}

          {existing && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onSave(() => deleteMaterial(existing.id), "O'chirildi.")}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            >
              <Trash2 size={13} />
              O'chirish
            </button>
          )}
        </div>
      )}
    </div>
  );
}
