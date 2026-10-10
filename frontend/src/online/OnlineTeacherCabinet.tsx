import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  FileText,
  GraduationCap,
  ListChecks,
  Loader2,
  Paperclip,
  Plus,
  Presentation,
  Stethoscope,
  Save,
  Sparkles,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { errText } from './onlineError';
import {
  deleteMaterial,
  fetchCatalog,
  fetchMaterials,
  fetchTeacherMe,
  fetchTeacherTopics,
  kindLabel,
  kindsFor,
  leaveCourse,
  saveMaterial,
  takeCourse,
  uploadMaterial,
  type CatalogSubject,
  type Material,
  type MaterialKind,
  type TeacherCourse,
  type TeacherTopic,
} from './onlineTeacherApi';
import OnlineLessons from './OnlineLessons';
import OnlineProgress from './OnlineProgress';
import MalakaProgress from './MalakaProgress';
import MalakaSubjectTests from './MalakaSubjectTests';
import MalakaTestEditor from './MalakaTestEditor';
import MalakaTopicList from './MalakaTopicList';
import { BRAND, type Program } from './program';
import { caseToText, generateCase, generateLecture, generateTest } from './onlineGenerate';

/**
 * O'qituvchi kabineti: fan → mavzu → material.
 *
 * Har mavzu oltita materialni talab qiladi (ma'ruza, taqdimot, video,
 * tarqatma, keys, 10 ta test). Ro'yxatda har mavzuning nechtasi tayyor ekani
 * darrov ko'rinadi — o'qituvchi qayerda to'xtaganini eslab o'tirmasin.
 */

const TEXT_KINDS: MaterialKind[] = ['lecture', 'case'];

type CabinetSection = 'materials' | 'lessons' | 'tests' | 'progress';

export default function OnlineTeacherCabinet({
  onUnauthorized,
  program = 'online',
}: {
  onUnauthorized: () => void;
  program?: Program;
}) {
  // Malakada: mavzularni o'qituvchi o'zi kiritadi, jonli dars yo'q, fanning
  // kirish va chiqish testi bor.
  const malaka = program === 'malaka';
  const kinds = kindsFor(program);
  const tabs: CabinetSection[] = malaka
    ? ['materials', 'tests', 'progress']
    : ['materials', 'lessons', 'progress'];
  const tabLabel: Record<CabinetSection, [string, string]> = {
    materials: ['Materiallar', 'Mavzular va materiallar'],
    lessons: ['Darslar', 'Video darslar'],
    tests: ['Testlar', 'Kirish va chiqish testi'],
    progress: ['Natijalar', malaka ? 'Tinglovchilar natijasi' : 'Talabalar natijasi'],
  };
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [notTeacher, setNotTeacher] = useState(false);
  const [course, setCourse] = useState<TeacherCourse | null>(null);
  const [topics, setTopics] = useState<TeacherTopic[]>([]);
  const [topic, setTopic] = useState<TeacherTopic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [section, setSection] = useState<CabinetSection>('materials');
  const [fullName, setFullName] = useState('');

  const [picking, setPicking] = useState(false);

  const loadMe = useCallback(
    (autoOpen: boolean) =>
      fetchTeacherMe(program)
        .then((me) => {
          setNotTeacher(!me.is_online_teacher || me.courses.length === 0);
          setFullName(me.full_name || '');
          setCourses(me.courses);
          if (autoOpen && me.courses.length === 1) setCourse(me.courses[0]);
        })
        .catch((e) => {
          if (/401/.test(String(e))) onUnauthorized();
          else setError(errText(e));
        })
        .finally(() => setLoading(false)),
    [onUnauthorized, program],
  );

  useEffect(() => {
    void loadMe(true);
  }, [loadMe]);

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

  if (notTeacher || picking) {
    return (
      <CoursePicker
        program={program}
        first={notTeacher}
        onBack={notTeacher ? undefined : () => setPicking(false)}
        onChanged={() => loadMe(false)}
      />
    );
  }

  if (topic && course) {
    return (
      <TopicMaterials
        program={program}
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
        {/* Ortga qaytish HAR DOIM ochiq. Ilgari bitta fani bor o'qituvchi shu
            fanning ichiga tushib qolardi: dastur uni avtomatik ochardi, tugma
            esa `disabled` va ko'rinmas edi — natijada u "Fanlarim" ro'yxatiga
            ham, "Fan qo'shish" tugmasiga ham yeta olmasdi va boshqa
            yo'nalishlarni umuman ko'rmasdi (2026-09-29). */}
        <button
          type="button"
          onClick={() => setCourse(null)}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-800"
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

        <nav className="online-tabs border-b border-slate-200 pb-2">
          {tabs.map((s2) => (
            <button
              key={s2}
              type="button"
              onClick={() => setSection(s2)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                section === s2 ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="sm:hidden">{tabLabel[s2][0]}</span>
              <span className="hidden sm:inline">{tabLabel[s2][1]}</span>
            </button>
          ))}
        </nav>

        {section === 'lessons' && !malaka && (
          <OnlineLessons course={course} topics={topics} teacherName={fullName} />
        )}

        {section === 'tests' && malaka && <MalakaSubjectTests course={course} />}

        {section === 'progress' &&
          (malaka ? <MalakaProgress course={course} /> : <OnlineProgress course={course} />)}

        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
        )}

        {section === 'materials' && malaka && (
          <MalakaTopicList
            course={course}
            topics={topics}
            kinds={kinds}
            onOpen={setTopic}
            onChanged={() => loadTopics(course)}
          />
        )}

        {section === 'materials' && !malaka && (
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
                  {kinds.map((k) => (
                    <span
                      key={k}
                      title={kindLabel(k, program)}
                      className={`h-1.5 w-6 rounded-full ${
                        t.has[k] ? 'bg-emerald-500' : 'bg-slate-200'
                      }`}
                    />
                  ))}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${
                  t.ready === kinds.length
                    ? 'bg-emerald-100 text-emerald-700'
                    : t.ready > 0
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {t.ready}/{kinds.length}
              </span>
              <ChevronRight size={16} className="shrink-0 text-slate-300" />
            </button>
          ))}
        </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Fanlarim</h2>
          <p className="text-[12.5px] text-slate-500">
            {BRAND[program].title} bo'yicha sizga biriktirilgan fanlar
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-[13px] font-semibold text-white hover:bg-slate-700"
        >
          <Plus size={15} />
          Fan qo‘shish
        </button>
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
/* ==================== Fanni o'zi tanlash ==================== */

/**
 * O'qituvchi o'tadigan fanini o'zi belgilaydi.
 *
 * Ilgari buni faqat administrator qilardi va o'qituvchi portalga kirib
 * "fan biriktirilmagan" deb to'xtab qolardi.
 */
function CoursePicker({
  program,
  first,
  onBack,
  onChanged,
}: {
  program: Program;
  first: boolean;
  onBack?: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const [subjects, setSubjects] = useState<CatalogSubject[] | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(
    () =>
      fetchCatalog(program)
        .then(setSubjects)
        .catch((e) => setError(errText(e))),
    [program],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggle = async (s: CatalogSubject, label: string, mine: boolean) => {
    const key = `${s.syllabus_id}-${label}`;
    setBusy(key);
    setError('');
    try {
      if (mine) await leaveCourse(s.syllabus_id, label);
      else await takeCourse(s.syllabus_id, label);
      await reload();
      await onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
    }
  };

  const needle = query.trim().toLowerCase();
  const shown = (subjects || []).filter(
    (s) =>
      !needle ||
      s.subject_name.toLowerCase().includes(needle) ||
      s.department_name.toLowerCase().includes(needle),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={15} />
          Fanlarim
        </button>
      )}

      <header className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50">
            <GraduationCap size={20} className="text-amber-600" />
          </span>
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">
              {first ? 'O‘tadigan faningizni tanlang' : 'Fan qo‘shish'}
            </h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-slate-600">
              {program === 'malaka' ? 'Malaka oshirish' : 'Online ta‘lim'} bo‘yicha o‘zingiz
              o‘tadigan fanni belgilang — u darhol “Fanlarim” ro‘yxatida paydo bo‘ladi.
            </p>
          </div>
        </div>
        {(subjects?.length || 0) > 6 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Fan yoki kafedra nomi bo‘yicha qidirish"
            className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px]"
          />
        )}
      </header>

      {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}

      {subjects === null ? (
        <div className="flex justify-center py-10 text-slate-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center text-[13px] text-slate-500">
          {subjects.length === 0
            ? 'Hozircha portalda fan yo‘q. Fan administrator tomonidan qo‘shilgach shu yerda chiqadi.'
            : 'Qidiruv bo‘yicha fan topilmadi.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((s) => (
            <li key={s.syllabus_id} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <p className="text-[13.5px] font-semibold text-slate-800">{s.subject_name}</p>
              {s.department_name && (
                <p className="text-[12px] text-slate-500">{s.department_name}</p>
              )}
              <div className="mt-2 space-y-1.5">
                {s.variants.map((v) => {
                  const key = `${s.syllabus_id}-${v.label}`;
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-600">
                        {v.label ? `${v.label} · ` : ''}
                        {v.topic_count} mavzu
                      </span>
                      <button
                        type="button"
                        disabled={busy === key}
                        onClick={() => void toggle(s, v.label, v.mine)}
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition disabled:opacity-50 ${
                          v.mine
                            ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'bg-slate-800 text-white hover:bg-slate-700'
                        }`}
                      >
                        {busy === key ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : v.mine ? (
                          <Check size={13} />
                        ) : (
                          <Plus size={13} />
                        )}
                        {v.mine ? 'Tanlangan' : 'Tanlash'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!first && (
        <p className="text-center text-[11.5px] text-slate-400">
          “Tanlangan” tugmasini bossangiz fan ro‘yxatingizdan olinadi — materiallar o‘chmaydi.
        </p>
      )}
    </div>
  );
}

/* ==================== Bitta mavzu materiallari ==================== */

/**
 * Har material turining o'z qiyofasi bor.
 *
 * Ilgari oltalasi bir xil oq qator edi: bir xil belgi, bir xil tugma va
 * "Saqlangan" degan foydasiz izoh. O'qituvchi qaysi qator nima ekanini
 * o'qib chiqishi va ichida nima borligini bilish uchun har birini
 * ochib ko'rishi kerak edi.
 */
const KIND_STYLE: Record<MaterialKind, { icon: typeof FileText; tint: string }> = {
  lecture: { icon: FileText, tint: 'bg-indigo-50 text-indigo-600' },
  presentation: { icon: Presentation, tint: 'bg-amber-50 text-amber-600' },
  video: { icon: Video, tint: 'bg-rose-50 text-rose-600' },
  handout: { icon: Paperclip, tint: 'bg-teal-50 text-teal-600' },
  case: { icon: Stethoscope, tint: 'bg-violet-50 text-violet-600' },
  test: { icon: ListChecks, tint: 'bg-emerald-50 text-emerald-600' },
  practical: { icon: ClipboardCheck, tint: 'bg-cyan-50 text-cyan-600' },
};

/**
 * Bitta mavzuda bir nechta bo'lishi mumkin bo'lgan turlar.
 *
 * Ma'ruza, keys va test bitta bo'lishi kerak — ikkitasi bo'lsa talaba
 * qaysi biri haqiqiy ekanini bilmaydi. Video va tarqatma esa to'planib
 * boradi: bir mavzuga bir nechta yozuv va qo'llanma to'g'ri keladi, va
 * ularni shu fanni o'tadigan barcha o'qituvchilar birga to'ldiradi.
 */
const MULTI_KINDS: MaterialKind[] = ['video', 'handout'];

const MULTI_LABEL: Partial<Record<MaterialKind, string>> = {
  video: 'Video darslar',
  handout: 'Tarqatma materiallar',
};

/** Markdown belgilarini olib tashlab, bir qatorlik ko'rinish qoldiradi. */
function plainText(value: string, max = 160): string {
  const flat = value.replace(/[#*_`>]/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() + '…' : flat;
}

function humanSize(bytes: number): string {
  if (!bytes) return '';
  // 1 KB dan kichik fayl "0 KB" bo'lib ko'rinmasin.
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}

/** Ro'yxatdagi bitta yozuvning qisqa nomi. */
function itemLabel(m: Material): string {
  if (m.external_url) return m.title?.trim() || hostOf(m.external_url);
  return m.file_name || m.title?.trim() || 'Nomsiz';
}

/**
 * Kartochkada ko'rsatiladigan qisqacha mazmun.
 *
 * Maqsad: o'qituvchi ochmasdan turib material bor-yo'qligini EMAS, ichida
 * NIMA borligini ko'rsin — matnning boshi, savollar soni va birinchi savol,
 * faylning nomi va hajmi.
 */
function materialPreview(
  kind: MaterialKind,
  items: Material[],
): { badge: string; body: string } | null {
  const m = items[0];
  if (!m) return null;

  if (MULTI_KINDS.includes(kind)) {
    const names = items.map(itemLabel);
    const shown = names.slice(0, 2).join(' · ');
    return {
      badge: `${items.length} ta`,
      body: names.length > 2 ? `${shown} · +${names.length - 2}` : shown,
    };
  }

  if (kind === 'test' || kind === 'practical') {
    const qs = ((m.payload as { questions?: Array<{ question?: string }> })?.questions ||
      []) as Array<{ question?: string }>;
    return {
      badge: `${qs.length} savol`,
      body: qs.length ? plainText(String(qs[0].question || ''), 110) : 'Savollar bo‘sh',
    };
  }

  if (kind === 'presentation') {
    return {
      badge: humanSize(m.file_size) || 'fayl',
      body: m.file_name || m.title || '',
    };
  }

  const text = String((m.payload as { text?: string })?.text || '');
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return { badge: `${words} so‘z`, body: plainText(text) };
}

function TopicMaterials({
  program,
  course,
  topic,
  onBack,
}: {
  program: Program;
  course: TeacherCourse;
  topic: TeacherTopic;
  onBack: () => void;
}) {
  const kinds = kindsFor(program);
  const [items, setItems] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKind, setBusyKind] = useState<MaterialKind | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const byKind = useMemo(() => {
    const m = new Map<MaterialKind, Material[]>();
    for (const it of items) {
      const list = m.get(it.kind);
      if (list) list.push(it);
      else m.set(it.kind, [it]);
    }
    return m;
  }, [items]);

  const ready = kinds.filter((k) => (byKind.get(k)?.length || 0) > 0).length;
  const missing = kinds.filter((k) => !(byKind.get(k)?.length || 0));

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
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} />
        Mavzular
      </button>

      <header className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
        <p className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">
          {course.subject_name}
        </p>
        <h2 className="mt-0.5 text-[19px] font-bold leading-tight text-slate-900">
          <span className="text-slate-400">{topic.code}.</span> {topic.title}
        </h2>

        {/* Har bo'lak — bitta material turi. Nima yetishmayotgani shu yerda
            ko'rinadi, pastdagi kartochkalarni sanab chiqish shart emas. */}
        <div className="mt-3 flex items-center gap-3">
          <div className="flex flex-1 gap-1">
            {kinds.map((k) => (
              <span
                key={k}
                title={kindLabel(k, program)}
                className={`h-1.5 flex-1 rounded-full ${
                  (byKind.get(k)?.length || 0) > 0 ? 'bg-emerald-500' : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold tabular-nums ${
              ready === kinds.length
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            {ready}/{kinds.length}
          </span>
        </div>

        <p className="mt-2 text-[12.5px] text-slate-500">
          {ready === kinds.length
            ? program === 'malaka'
              ? 'Hammasi tayyor — mavzu tinglovchilarga ochiq.'
              : 'Hammasi tayyor. Mavzuni ochish uchun video dars o‘tkazing.'
            : `${program === 'malaka' && ready > 0 ? 'Mavzu tinglovchilarga ochiq. ' : ''}Yetishmayapti: ${missing
                .map((k) => kindLabel(k, program))
                .join(', ')}`}
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Yopish">
            <X size={14} />
          </button>
        </div>
      )}
      {notice && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">
          {notice}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-12 text-slate-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {kinds.map((kind) => (
            <MaterialCard
              key={kind}
              kind={kind}
              course={course}
              topicCode={topic.code}
              topicTitle={topic.title}
              items={byKind.get(kind) || []}
              allMaterials={items}
              busy={busyKind === kind}
              onSave={(fn, ok) => void run(kind, fn, ok)}
              program={program}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Ko'p nusxali turdagi bitta yozuv: ochish va o'chirish. */
function MaterialRow({
  item,
  index,
  busy,
  onDelete,
}: {
  item: Material;
  index: number;
  busy: boolean;
  onDelete: () => void;
}) {
  const href = item.file ? `/media/${item.file}` : item.external_url;
  const meta = item.external_url
    ? hostOf(item.external_url)
    : humanSize(item.file_size) || 'fayl';
  return (
    <li className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <span className="w-4 shrink-0 text-[11px] font-bold text-slate-300 tabular-nums">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-slate-800">
          {itemLabel(item)}
        </span>
        <span className="block truncate text-[11.5px] text-slate-400">
          {meta}
          {/* Kim qo'shgani — boshqa o'qituvchi yuklagani ko'rinib tursin. */}
          {item.author_name ? ` · ${item.author_name}` : ''}
        </span>
      </span>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="tap-tight shrink-0 rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label="Ochish"
        >
          <ExternalLink size={14} />
        </a>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={onDelete}
        className="tap-tight shrink-0 rounded-md p-2 text-rose-500 transition hover:bg-rose-50 disabled:opacity-50"
        aria-label="O‘chirish"
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

function MaterialCard({
  kind,
  course,
  topicCode,
  topicTitle,
  items,
  allMaterials,
  busy,
  onSave,
  program,
}: {
  program: Program;
  kind: MaterialKind;
  course: TeacherCourse;
  topicCode: string;
  topicTitle: string;
  items: Material[];
  /** Mavzudagi BARCHA materiallar — AI kontekstini yig'ish uchun. */
  allMaterials: Material[];
  busy: boolean;
  onSave: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState('');

  const multi = MULTI_KINDS.includes(kind);
  const existing = items[0];
  const genInput = {
    subjectName: course.subject_name,
    subjectCode: course.subject_code,
    departmentName: course.department_name,
    topicTitle: `${topicCode}. ${topicTitle}`,
    language: (course.instruction_language || 'uz') as 'uz' | 'ru' | 'en',
    // Test va keys mavzu NOMIDAN emas, shu mavzuga yuklangan ma'ruza,
    // tarqatma va taqdimot mazmunidan chiqsin.
    materials: allMaterials,
  };
  const style = KIND_STYLE[kind];
  const Icon = style.icon;
  const done = items.length > 0;
  const preview = materialPreview(kind, items);
  const label = (multi && MULTI_LABEL[kind]) || kindLabel(kind, program);

  useEffect(() => {
    if (!open || multi) return;
    setText(String((existing?.payload as { text?: string })?.text || ''));
    setUrl(existing?.external_url || '');
  }, [open, existing, multi]);

  const base = {
    syllabus_id: course.syllabus_id,
    variant_label: course.variant_label,
    topic_code: topicCode,
  };

  const testCount = Array.isArray((existing?.payload as { questions?: unknown[] })?.questions)
    ? ((existing?.payload as { questions: unknown[] }).questions || []).length
    : 0;

  return (
    <div
      className={`rounded-xl border bg-white transition ${
        open ? 'border-slate-300 shadow-sm lg:col-span-2' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start gap-2.5 px-3 py-3 sm:gap-3 sm:px-3.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${style.tint}`}>
          <Icon size={17} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold text-slate-800">{label}</span>
            {done ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                <Check size={10} />
                {preview?.badge}
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-500">
                yo‘q
              </span>
            )}
          </div>

          {/* Ichidagi mazmun — kartochkani ochmasdan ko'rinadi. */}
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-slate-500">
            {preview?.body || 'Hali tayyorlanmagan'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition ${
            open
              ? 'bg-slate-800 text-white hover:bg-slate-700'
              : done
                ? 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                : 'bg-slate-800 text-white hover:bg-slate-700'
          }`}
        >
          {open ? 'Yopish' : done ? 'Ochish' : 'Qo‘shish'}
        </button>
      </div>

      {open && (
        <div className="space-y-2.5 border-t border-slate-100 px-3 py-3 sm:px-3.5">
          {/* ---------- Ko'p nusxali turlar: ro'yxat + qo'shish ---------- */}
          {multi && (
            <>
              {items.length > 0 && (
                <ul className="space-y-1.5">
                  {items.map((m, i) => (
                    <MaterialRow
                      key={m.id}
                      item={m}
                      index={i}
                      busy={busy}
                      onDelete={() =>
                        onSave(() => deleteMaterial(m.id), 'O‘chirildi.')
                      }
                    />
                  ))}
                </ul>
              )}

              {kind === 'video' ? (
                <div className="space-y-2 rounded-lg bg-slate-50 p-2.5">
                  <input
                    value={urlTitle}
                    onChange={(e) => setUrlTitle(e.target.value)}
                    placeholder="Nomi (masalan: Amaliy ko‘rsatma)"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px]"
                  />
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://youtube.com/watch?v=..."
                      className="w-full min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[13px] sm:w-auto sm:min-w-[14rem]"
                    />
                    <button
                      type="button"
                      disabled={busy || !url.trim()}
                      onClick={() =>
                        onSave(async () => {
                          await saveMaterial({
                            ...base,
                            kind,
                            title: urlTitle.trim() || 'Video dars',
                            external_url: url.trim(),
                          });
                          setUrl('');
                          setUrlTitle('');
                        }, 'Video qo‘shildi.')
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-[13px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      <Save size={14} />
                      Qo‘shish
                    </button>
                  </div>
                </div>
              ) : (
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-[13px] text-slate-600 hover:bg-slate-100">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                  <span>Yana fayl qo‘shish — PDF, JPG, PNG (40 MB gacha)</span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      e.target.value = '';
                      onSave(
                        () => uploadMaterial(f, { ...base, kind: 'handout' }),
                        'Fayl qo‘shildi.',
                      );
                    }}
                  />
                </label>
              )}

              <p className="text-[11.5px] text-slate-400">
                Bu ro‘yxat mavzuga biriktirilgan — shu fanni o‘tadigan boshqa
                o‘qituvchilarda ham shu holda ko‘rinadi.
              </p>
            </>
          )}

          {/* ---------- Taqdimot: bitta fayl ---------- */}
          {kind === 'presentation' && (
            <>
              {existing?.file && (
                <a
                  href={`/media/${existing.file}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-200"
                >
                  <ExternalLink size={14} />
                  Hozirgi faylni ochish
                </a>
              )}
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-[13px] text-slate-600 hover:bg-slate-100">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                <span>
                  {existing ? 'Boshqa fayl yuklash' : 'Fayl tanlang'} — PDF, JPG, PNG (40 MB gacha)
                </span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    e.target.value = '';
                    onSave(
                      () => uploadMaterial(f, { ...base, kind: 'presentation' }),
                      'Fayl yuklandi.',
                    );
                  }}
                />
              </label>
            </>
          )}

          {TEXT_KINDS.includes(kind) && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={aiBusy || busy}
                  onClick={async () => {
                    setAiBusy(true);
                    setAiNote(
                      kind === 'lecture'
                        ? 'Darsliklardan o‘qib, ma‘ruza yozilmoqda…'
                        : 'Mavzu materiallari va darsliklar o‘qilmoqda, vaziyatli masala tuzilmoqda…',
                    );
                    try {
                      const out =
                        kind === 'lecture'
                          ? await generateLecture(genInput, (soFar) => setText(soFar))
                          : caseToText(await generateCase(genInput));
                      setText(out);
                      setAiNote('Tayyor. O‘qib chiqing va saqlang.');
                    } catch (e) {
                      setAiNote(errText(e));
                    } finally {
                      setAiBusy(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-[13px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  AI bilan yozdirish
                </button>
                {text.trim() && (
                  <span className="text-[12px] text-slate-400 tabular-nums">
                    {text.trim().split(/\s+/).length} so‘z
                  </span>
                )}
              </div>
              {aiNote && <p className="text-[12.5px] text-slate-500">{aiNote}</p>}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                placeholder={
                  kind === 'lecture'
                    ? 'Ma‘ruza matni. AI yozdirgach shu yerda ko‘rinadi — tahrirlash mumkin.'
                    : 'Vaziyatli masala: bemor kartasi, savol va yechim.'
                }
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed"
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

          {/* Malakada test va amaliy mashg'ulot: fayldan (AI o'qiydi),
              matndan, AI bilan yoki qo'lda — o'qituvchi ko'rib chiqib saqlaydi. */}
          {program === 'malaka' && (kind === 'test' || kind === 'practical') && (
            <MalakaTestEditor
              course={course}
              topicCode={topicCode}
              topicTitle={`${topicCode}. ${topicTitle}`}
              kind={kind}
              existing={existing}
              allMaterials={allMaterials}
              busy={busy}
              onSave={onSave}
            />
          )}

          {kind === 'test' && program !== 'malaka' && (
            <div className="space-y-2">
              <button
                type="button"
                disabled={aiBusy || busy}
                onClick={() => {
                  setAiBusy(true);
                  setAiNote('Mavzu materiallari va darsliklar asosida 10 ta savol tuzilmoqda…');
                  onSave(async () => {
                    try {
                      const session = await generateTest(genInput, 10);
                      const questions = (session.questions || []).map((q) => ({
                        question: q.question,
                        options: q.options,
                        correctOptionIndex: q.correctOptionIndex,
                        explanation: q.explanation || '',
                      }));
                      if (questions.length === 0) {
                        throw new Error('AI savol qaytarmadi. Qayta urinib ko‘ring.');
                      }
                      return saveMaterial({
                        ...base,
                        kind: 'test',
                        title: `${questions.length} ta test`,
                        payload: { questions },
                      });
                    } finally {
                      setAiBusy(false);
                      setAiNote('');
                    }
                  }, 'Testlar yaratildi va saqlandi.');
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-[13px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {existing ? 'Qaytadan yozdirish' : 'AI bilan 10 ta test'}
              </button>
              {aiNote && <p className="text-[12.5px] text-slate-500">{aiNote}</p>}

              {existing && testCount > 0 && (
                <ol className="space-y-2">
                  {((existing.payload as {
                    questions?: Array<{
                      question?: string;
                      options?: string[];
                      correctOptionIndex?: number;
                    }>;
                  }).questions || []).map((q, i) => (
                    <li key={i} className="rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-[12.5px] font-medium text-slate-800">
                        {i + 1}. {q.question}
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {(q.options || []).map((o, j) => (
                          <li
                            key={j}
                            className={`text-[12px] ${
                              j === q.correctOptionIndex
                                ? 'font-semibold text-emerald-700'
                                : 'text-slate-500'
                            }`}
                          >
                            {String.fromCharCode(65 + j)}) {o}
                            {j === q.correctOptionIndex ? ' ✓' : ''}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {/* Bitta nusxali turlarda o'chirish — ko'p nusxalilarda har
              yozuvning o'z tugmasi bor. */}
          {!multi && existing && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onSave(() => deleteMaterial(existing.id), 'O‘chirildi.')}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            >
              <Trash2 size={13} />
              O‘chirish
            </button>
          )}
        </div>
      )}
    </div>
  );
}
