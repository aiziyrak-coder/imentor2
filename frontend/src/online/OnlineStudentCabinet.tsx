import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  ListChecks,
  Loader2,
  Lock,
  Paperclip,
  Presentation,
  CalendarCheck,
  Radio,
  Stethoscope,
  Video,
  X,
  XCircle,
} from 'lucide-react';
import { errText } from './onlineError';
import LectureMarkdown from '../components/staff/LectureMarkdown';
import JitsiRoom from './JitsiRoom';
import OnlineCase from './OnlineCase';
import {
  fetchLiveLesson,
  fetchMyAttendance,
  fetchSubjects,
  fetchTopicDetail,
  fetchTopics,
  markViewed,
  submitTest,
  type LiveLesson,
  type MyAttendance,
  type StudentMaterial,
  type StudentSubject,
  type StudentTopic,
  type StudentTopicDetail,
} from './onlineStudentApi';

/**
 * Talaba kabineti: fanlar → mavzular → material va test.
 *
 * Mavzu o'qituvchi video dars o'tkazib ochmaguncha yopiq turadi. Yopiq
 * mavzuda material bor-yo'qligi ham ko'rsatilmaydi — server uni umuman
 * yubormaydi.
 */

type Kind = 'lecture' | 'presentation' | 'video' | 'handout' | 'case' | 'test';

/** O'qish tartibi: talaba shu ketma-ketlikda yurishi kutiladi. */
const KIND_ORDER: Kind[] = ['lecture', 'presentation', 'video', 'handout', 'case', 'test'];

const KIND_META: Record<
  Kind,
  { label: string; short: string; icon: typeof FileText; tint: string }
> = {
  lecture: {
    label: "Ma'ruza matni",
    short: "Ma'ruza",
    icon: FileText,
    tint: 'bg-indigo-50 text-indigo-600',
  },
  presentation: {
    label: 'Taqdimot',
    short: 'Taqdimot',
    icon: Presentation,
    tint: 'bg-amber-50 text-amber-600',
  },
  video: { label: 'Video dars', short: 'Video', icon: Video, tint: 'bg-rose-50 text-rose-600' },
  handout: {
    label: 'Tarqatma material',
    short: 'Tarqatma',
    icon: Paperclip,
    tint: 'bg-teal-50 text-teal-600',
  },
  case: {
    label: 'Vaziyatli masala',
    short: 'Keys',
    icon: Stethoscope,
    tint: 'bg-violet-50 text-violet-600',
  },
  test: { label: 'Test', short: 'Test', icon: ListChecks, tint: 'bg-emerald-50 text-emerald-600' },
};

/** `viewed` faqat shu to'rttasi uchun yuritiladi. */
const VIEWABLE: Kind[] = ['lecture', 'presentation', 'video', 'handout'];

/** YouTube havolasini sahifa ichida ochiladigan ko'rinishga o'tkazadi. */
function youtubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    if (host.endsWith('youtube.com')) {
      const id = u.searchParams.get('v');
      if (id) return `https://www.youtube.com/embed/${id}`;
      if (u.pathname.startsWith('/embed/')) return url;
    }
    return null;
  } catch {
    return null;
  }
}

/** Baho rangi: 86+ a'lo, 71+ yaxshi, 56+ qoniqarli, pastda — qayta ishlash kerak. */
export function gradeTone(grade: number | null): string {
  if (grade === null) return 'bg-slate-100 text-slate-500';
  if (grade >= 86) return 'bg-emerald-50 text-emerald-700';
  if (grade >= 71) return 'bg-sky-50 text-sky-700';
  if (grade >= 56) return 'bg-amber-50 text-amber-700';
  return 'bg-rose-50 text-rose-700';
}

/** Yupqa gorizontal progress chizig'i. */
export function Bar({
  done,
  total,
  tone = 'slate',
}: {
  done: number;
  total: number;
  tone?: 'slate' | 'emerald';
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80">
      <div
        className={`h-full rounded-full transition-all ${
          tone === 'emerald' ? 'bg-emerald-500' : 'bg-slate-800'
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function OnlineStudentCabinet({ displayName }: { displayName: string }) {
  const [subjects, setSubjects] = useState<StudentSubject[]>([]);
  const [subject, setSubject] = useState<StudentSubject | null>(null);
  const [topics, setTopics] = useState<StudentTopic[]>([]);
  const [topicCode, setTopicCode] = useState('');
  const [live, setLive] = useState<LiveLesson>(null);
  const [inRoom, setInRoom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchSubjects()
      .then(setSubjects)
      .catch((e) => setError(errText(e)))
      .finally(() => setLoading(false));
  }, []);

  // Jonli darsni vaqti-vaqti bilan tekshiramiz — o'qituvchi darsni
  // boshlaganda talaba sahifani yangilamasdan ham ko'rsin.
  useEffect(() => {
    let stop = false;
    const check = () => {
      fetchLiveLesson()
        .then((l) => {
          if (!stop) setLive(l);
        })
        .catch(() => {});
    };
    check();
    const t = window.setInterval(check, 45_000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, []);

  const loadTopics = useCallback(async (s: StudentSubject) => {
    setLoading(true);
    try {
      setTopics(await fetchTopics(s.syllabus_id, s.variant_label));
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (subject) void loadTopics(subject);
  }, [subject, loadTopics]);

  if (loading && !subjects.length && !error) {
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Loader2 size={22} className="animate-spin" />
      </div>
    );
  }

  if (inRoom && live) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">
              {live.subject_name}
            </p>
            <h3 className="text-[15px] font-bold text-slate-900">
              {live.topic_code}. {live.topic_title}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setInRoom(false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50"
          >
            <X size={14} />
            Chiqish
          </button>
        </div>
        <JitsiRoom
          roomName={live.room_name}
          displayName={displayName}
          reportJoin
          height={560}
          onLeave={() => setInRoom(false)}
        />
      </div>
    );
  }

  const liveBanner = live && !inRoom && (
    <button
      type="button"
      onClick={() => setInRoom(true)}
      className="flex w-full items-center gap-2.5 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-3 py-3 text-left transition hover:border-emerald-300 hover:shadow-sm sm:gap-3 sm:px-4 sm:py-3.5"
    >
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600">
        <Radio size={18} className="text-white" />
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500 ring-2 ring-white" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-bold text-emerald-900">
          Hozir dars ketyapti — qo'shiling
        </span>
        <span className="block truncate text-[12.5px] text-emerald-800">
          {live.subject_name} · {live.topic_code}. {live.topic_title}
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-2 text-[12.5px] font-semibold text-white sm:px-3">
        <Video size={14} />
        <span className="hidden sm:inline">Kirish</span>
      </span>
    </button>
  );

  if (topicCode && subject) {
    return (
      <div className="space-y-3">
        {liveBanner}
        <TopicView
          subject={subject}
          topicCode={topicCode}
          onBack={() => {
            setTopicCode('');
            void loadTopics(subject);
          }}
        />
      </div>
    );
  }

  /* ---------- 2-daraja: fandagi mavzular ---------- */
  if (subject) {
    const doneCount = topics.filter((t) => t.test_submitted_at !== null).length;
    return (
      <div className="space-y-3">
        {liveBanner}
        <button
          type="button"
          onClick={() => setSubject(null)}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={15} />
          Fanlarim
        </button>

        <header className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3.5 sm:px-4">
          {subject.department_name && (
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">
              {subject.department_name}
            </p>
          )}
          <h2 className="mt-0.5 text-[19px] font-bold leading-tight text-slate-900">
            {subject.subject_name}
          </h2>
          <div className="mt-3">
            <Bar done={subject.open_count} total={subject.topic_count} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-slate-500">
            <span>
              <strong className="text-slate-800 tabular-nums">
                {subject.open_count}/{subject.topic_count}
              </strong>{' '}
              mavzu ochiq
            </span>
            <span>
              <strong className="text-slate-800 tabular-nums">{doneCount}</strong> test topshirilgan
            </span>
            {subject.average_grade !== null && (
              <span>
                o&lsquo;rtacha baho{' '}
                <strong className="text-slate-800 tabular-nums">{subject.average_grade}</strong>
                <span className="text-slate-400"> ({subject.graded_count} mavzu)</span>
              </span>
            )}
          </div>
        </header>

        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
        )}

        <div className="space-y-2">
          {topics.map((t) => (
            <TopicRow key={t.topic_code} topic={t} onOpen={() => setTopicCode(t.topic_code)} />
          ))}
        </div>
      </div>
    );
  }

  /* ---------- 1-daraja: fanlar ---------- */
  const totalOpen = subjects.reduce((n, s) => n + s.open_count, 0);
  const totalDone = subjects.reduce((n, s) => n + s.done_count, 0);

  return (
    <div className="space-y-3">
      {liveBanner}

      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[20px] font-bold text-slate-900">Fanlarim</h2>
          <p className="text-[12.5px] text-slate-500">6-kurs masofaviy ta'lim</p>
        </div>
        {subjects.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-700">
              {subjects.length} fan
            </span>
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-700 tabular-nums">
              {totalOpen} mavzu ochiq
            </span>
            <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-700 tabular-nums">
              {totalDone} test
            </span>
          </div>
        )}
      </header>

      {error && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-center">
          <AlertTriangle size={20} className="mx-auto mb-1.5 text-amber-600" />
          <p className="text-[13.5px] font-semibold text-amber-900">{error}</p>
        </div>
      )}

      {!error && subjects.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-12 text-center">
          <BookOpen size={22} className="mx-auto mb-2 text-slate-300" />
          <p className="text-[13.5px] font-semibold text-slate-700">Hali fan biriktirilmagan</p>
          <p className="mt-1 text-[12.5px] text-slate-500">
            Guruhingizga fan qo'shilgach shu yerda ko'rinadi.
          </p>
        </div>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2">
        {subjects.map((s) => (
          <button
            key={`${s.syllabus_id}-${s.variant_label}`}
            type="button"
            onClick={() => setSubject(s)}
            className="group rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:shadow-sm"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition group-hover:bg-slate-800 group-hover:text-white">
                <BookOpen size={18} />
              </span>
              <span className="min-w-0 flex-1">
                {s.department_name && (
                  <span className="block truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {s.department_name}
                  </span>
                )}
                <span className="block text-[14.5px] font-bold leading-snug text-slate-900">
                  {s.subject_name}
                </span>
              </span>
              <ChevronRight size={16} className="mt-1 shrink-0 text-slate-300" />
            </div>

            <div className="mt-3">
              <Bar done={s.open_count} total={s.topic_count} />
            </div>
            <div className="mt-2 flex items-center justify-between text-[12px]">
              <span className="text-slate-500 tabular-nums">
                {s.open_count}/{s.topic_count} mavzu ochiq
              </span>
              {s.average_grade !== null ? (
                <span
                  className={`rounded-md px-1.5 py-0.5 font-semibold tabular-nums ${gradeTone(
                    s.average_grade,
                  )}`}
                >
                  o‘rtacha {s.average_grade}
                </span>
              ) : (
                <span className="text-slate-400">baho hali yo‘q</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {subjects.length > 0 && <MyAttendancePanel />}
    </div>
  );
}

/**
 * Talabaning o'z davomati.
 *
 * Davomat baholashga ta'sir qiladi, shuning uchun talaba uni ko'ra olishi
 * kerak. Ilgari bu yozuv faqat admin panelida turardi va talaba o'zi
 * haqidagi ma'lumotni ko'ra olmasdi.
 */
function MyAttendancePanel() {
  const [rows, setRows] = useState<MyAttendance[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    fetchMyAttendance()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoaded(true));
  }, [open, loaded]);

  const been = rows.filter((r) => r.was_present).length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left sm:px-4"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
          <CalendarCheck size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-slate-900">Davomatim</span>
          <span className="text-[12px] text-slate-500">
            {loaded
              ? rows.length === 0
                ? 'Hali dars o‘tilmagan'
                : `${rows.length} darsdan ${been} tasida qatnashgansiz`
              : 'Video darslardagi qatnashuvingiz'}
          </span>
        </span>
        <ChevronRight
          size={17}
          className={`shrink-0 text-slate-300 transition ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          {!loaded ? (
            <div className="flex justify-center py-4 text-slate-400">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-2 text-[13px] text-slate-500">
              O‘qituvchi hali video dars o‘tkazmagan.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((r) => (
                <li
                  key={r.lesson_id}
                  className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2"
                >
                  {r.was_present ? (
                    <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
                  ) : (
                    <XCircle size={15} className="shrink-0 text-rose-400" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-slate-800">
                      <span className="text-slate-400">{r.topic_code}.</span> {r.topic_title}
                    </span>
                    <span className="text-[11.5px] text-slate-400">{r.subject_name}</span>
                  </span>
                  <span className="shrink-0 text-[12px] tabular-nums text-slate-500">
                    {r.was_present ? `${r.minutes} daq` : 'qatnashmagan'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/* ==================== Mavzular ro'yxatidagi bitta qator ==================== */

function TopicRow({ topic, onOpen }: { topic: StudentTopic; onOpen: () => void }) {
  const done = topic.grade !== null;

  // Baho ikkala ish bajarilgach chiqadi, shuning uchun qatorda nima
  // qolganini aytamiz — talaba qidirib yurmasin.
  const pending: string[] = [];
  if (topic.is_open && !topic.test_done) pending.push('test');
  if (topic.is_open && !topic.case_done) pending.push('masala');
  const has = topic.has || {};
  const ready = KIND_ORDER.filter((k) => has[k]);

  return (
    <button
      type="button"
      disabled={!topic.is_open}
      onClick={onOpen}
      className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition ${
        topic.is_open
          ? 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
          : 'cursor-not-allowed border-slate-200 bg-slate-50/70'
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold ${
          done
            ? 'bg-emerald-500 text-white'
            : topic.is_open
              ? 'bg-slate-100 text-slate-600'
              : 'bg-slate-100 text-slate-300'
        }`}
      >
        {done ? <Check size={16} /> : topic.is_open ? topic.topic_code : <Lock size={14} />}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={`block text-[14px] font-semibold leading-snug ${
            topic.is_open ? 'text-slate-900' : 'text-slate-400'
          }`}
        >
          {topic.title}
        </span>

        {topic.is_open ? (
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            {ready.length === 0 ? (
              <span className="text-[12px] text-slate-400">
                O'qituvchi hali material joylamagan
              </span>
            ) : (
              ready.map((k) => (
                <span
                  key={k}
                  className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${KIND_META[k].tint}`}
                >
                  {KIND_META[k].short}
                </span>
              ))
            )}
          </span>
        ) : (
          <span className="mt-0.5 block text-[12px] text-slate-400">
            O'qituvchi dars o'tkazgach ochiladi
          </span>
        )}

        {topic.is_open && !done && pending.length > 0 && (
          <span className="mt-1 block text-[11.5px] font-medium text-violet-600 sm:hidden">
            {pending.join(' + ')} topshirilmagan
          </span>
        )}
      </span>

      {done ? (
        <span
          className={`shrink-0 rounded-lg px-2 py-1 text-[12.5px] font-bold tabular-nums ${gradeTone(
            topic.grade,
          )}`}
        >
          {topic.grade}
        </span>
      ) : topic.is_open ? (
        <span className="flex shrink-0 items-center gap-1.5">
          {pending.length > 0 && (
            <span className="hidden rounded-md bg-violet-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-violet-700 sm:inline">
              {pending.join(' + ')} qoldi
            </span>
          )}
          <ChevronRight size={16} className="text-slate-300" />
        </span>
      ) : null}
    </button>
  );
}

/* ==================== Bitta mavzu ==================== */

function TopicView({
  subject,
  topicCode,
  onBack,
}: {
  subject: StudentSubject;
  topicCode: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<StudentTopicDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [seen, setSeen] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchTopicDetail(subject.syllabus_id, subject.variant_label, topicCode);
      setData(d);
      setSeen(d.viewed || {});
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [subject, topicCode]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) {
    return (
      <div className="flex justify-center py-12 text-slate-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500"
        >
          <ArrowLeft size={15} />
          Mavzular
        </button>
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
      </div>
    );
  }

  const test = data.materials.find((m) => m.kind === 'test');

  // Bir mavzuda bir nechta video va tarqatma bo'lishi mumkin, shuning uchun
  // har turdan bittasini olmaymiz — hammasini o'qish tartibida joylaymiz.
  const others = data.materials
    .filter((m) => m.kind !== 'test')
    .sort((a, b) => KIND_ORDER.indexOf(a.kind as Kind) - KIND_ORDER.indexOf(b.kind as Kind));

  // Nechta yozuv borligidan qat'i nazar, bosqich — bu material TURI:
  // "ko'rilgan" belgisi turga qo'yiladi, alohida faylga emas.
  const trackableKinds = VIEWABLE.filter((k) => others.some((m) => m.kind === k));
  const seenCount = trackableKinds.filter((k) => seen[k]).length;
  const steps = trackableKinds.length + (test ? 1 : 0);
  const stepsDone = seenCount + (data.test_submitted ? 1 : 0);

  // Turdan bittadan ortiq bo'lsa, sarlavhada material nomi ko'rsatiladi —
  // aks holda uchta "Video dars" qatori bir xil ko'rinardi.
  const perKind = new Map<string, number>();
  for (const m of others) perKind.set(m.kind, (perKind.get(m.kind) || 0) + 1);

  const onOpened = (kind: string) => {
    if (!VIEWABLE.includes(kind as Kind) || seen[kind]) return;
    setSeen((s) => ({ ...s, [kind]: true }));
    void markViewed(
      subject.syllabus_id,
      subject.variant_label,
      topicCode,
      kind as 'lecture' | 'presentation' | 'video' | 'handout',
    ).catch(() => {});
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

      <header className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3.5 sm:px-4">
        <p className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">
          {data.subject_name}
        </p>
        <h2 className="mt-0.5 text-[19px] font-bold leading-tight text-slate-900">
          <span className="text-slate-400">{data.topic_code}.</span> {data.title}
        </h2>
        {steps > 0 && (
          <>
            <div className="mt-3">
              <Bar done={stepsDone} total={steps} tone={stepsDone === steps ? 'emerald' : 'slate'} />
            </div>
            <p className="mt-2 text-[12.5px] text-slate-500">
              {stepsDone === steps ? (
                <span className="font-semibold text-emerald-700">Mavzu to'liq o'zlashtirildi.</span>
              ) : (
                <>
                  <strong className="text-slate-800 tabular-nums">
                    {stepsDone}/{steps}
                  </strong>{' '}
                  bosqich bajarildi
                </>
              )}
            </p>
          </>
        )}
      </header>

      <GradeCard grade={data.grade} />

      {others.length === 0 && !test && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-10 text-center">
          <FileText size={20} className="mx-auto mb-2 text-slate-300" />
          <p className="text-[13px] text-slate-500">O'qituvchi hali material joylamagan.</p>
        </div>
      )}

      <div className="space-y-2.5">
        {others.map((m, i) => (
          <MaterialBlock
            key={m.id}
            index={i + 1}
            material={m}
            showTitle={(perKind.get(m.kind) || 0) > 1}
            viewed={Boolean(seen[m.kind])}
            onOpen={() => onOpened(m.kind)}
            subject={subject}
            topicCode={topicCode}
            onReload={reload}
          />
        ))}
      </div>

      {test?.questions?.length ? (
        <TestBlock
          subject={subject}
          topicCode={topicCode}
          questions={test.questions}
          myAnswers={test.my_answers}
          submitted={data.test_submitted}
          score={data.test_score}
          total={data.test_total}
          onDone={reload}
        />
      ) : null}
    </div>
  );
}

/**
 * Mavzu bahosi.
 *
 * Baho — testning foizi va vaziyatli masalaga AI qo'ygan bahoning
 * o'rtachasi, ikkalasi ham 100 ballik. Yakuniy raqam faqat IKKALASI
 * topshirilgach chiqadi, shuning uchun kartochka nima qolganini aniq
 * aytadi — talaba nimadan boshlashini bilsin.
 */
function GradeCard({ grade }: { grade: StudentTopicDetail['grade'] }) {
  if (!grade || (!grade.test_done && !grade.case_done)) return null;

  const cell = (label: string, value: number | null, done: boolean) => (
    <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2.5 sm:px-3">
      <p className="truncate text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 sm:text-[11px]">
        {label}
      </p>
      {done ? (
        <p className="mt-0.5 text-[17px] font-bold tabular-nums text-slate-900">{value}</p>
      ) : (
        <p className="mt-0.5 text-[12px] font-medium text-violet-600">topshirilmagan</p>
      )}
    </div>
  );

  return (
    <section className="space-y-2">
      <div className="flex gap-2">
        {cell('Test', grade.test_percent, grade.test_done)}
        {cell('Masala', grade.case_percent, grade.case_done)}
        <div className={`min-w-0 flex-1 rounded-xl px-2.5 py-2.5 sm:px-3 ${gradeTone(grade.grade)}`}>
          <p className="truncate text-[10.5px] font-semibold uppercase tracking-wide opacity-70 sm:text-[11px]">
            Mavzu bahosi
          </p>
          <p className="mt-0.5 text-[17px] font-bold tabular-nums">
            {grade.grade === null ? '—' : grade.grade}
          </p>
        </div>
      </div>
      {grade.grade === null && (
        <p className="px-1 text-[12px] leading-relaxed text-slate-500">
          Mavzu bahosi — test va vaziyatli masala bahosining o&lsquo;rtachasi. Ikkalasini
          ham topshirganingizdan keyin chiqadi.
        </p>
      )}
    </section>
  );
}

export function MaterialBlock({
  index,
  material,
  showTitle,
  viewed,
  onOpen,
  subject,
  topicCode,
  onReload,
}: {
  index: number;
  material: StudentMaterial;
  /** Shu turdan bir nechta bo'lsa — sarlavhada material nomi turadi. */
  showTitle: boolean;
  viewed: boolean;
  onOpen: () => void;
  subject: StudentSubject;
  topicCode: string;
  onReload: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const meta = KIND_META[material.kind as Kind] || KIND_META.lecture;
  const Icon = meta.icon;
  const embed = material.external_url ? youtubeEmbed(material.external_url) : null;

  const toggle = () => {
    if (!open) onOpen();
    setOpen((v) => !v);
  };

  const ownName = (material.title || '').trim() || material.file_name;
  const heading = showTitle && ownName ? ownName : meta.label;

  const hint = material.text
    ? `${material.text.trim().split(/\s+/).length} so'z`
    : showTitle
      ? material.external_url
        ? material.external_url
        : material.file_name
      : material.file_name || (material.external_url ? 'Video havolasi' : '');

  return (
    <section
      className={`overflow-hidden rounded-2xl border bg-white transition ${
        open ? 'border-slate-300 shadow-sm' : 'border-slate-200'
      }`}
    >
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${meta.tint}`}>
          <Icon size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[10.5px] font-bold text-slate-300 tabular-nums">{index}</span>
            <span className="text-[14px] font-semibold text-slate-900">{heading}</span>
            {showTitle && (
              <span className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${meta.tint}`}>
                {meta.short}
              </span>
            )}
            {viewed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                <Check size={10} />
                ko'rilgan
              </span>
            )}
            {material.kind === 'case' && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ${
                  material.submitted
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-violet-50 text-violet-700'
                }`}
              >
                {material.submitted ? 'javob berilgan' : 'javob kutilmoqda'}
              </span>
            )}
          </span>
          {hint && <span className="mt-0.5 block truncate text-[12px] text-slate-500">{hint}</span>}
        </span>
        <ChevronRight
          size={17}
          className={`shrink-0 text-slate-300 transition ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-slate-100 px-3.5 py-4 sm:px-4">
          {material.kind === 'case' ? (
            <OnlineCase
              material={material}
              syllabusId={subject.syllabus_id}
              variantLabel={subject.variant_label}
              topicCode={topicCode}
              onSubmitted={onReload}
            />
          ) : (
            material.text && (
              <div className="prose prose-slate max-w-none prose-headings:font-bold prose-headings:text-slate-900 prose-h1:text-[18px] prose-h2:text-[15.5px] prose-h3:text-[14px] prose-p:text-[13.5px] prose-p:leading-relaxed prose-li:text-[13.5px] prose-strong:text-slate-900">
                <LectureMarkdown>{material.text}</LectureMarkdown>
              </div>
            )
          )}

          {embed && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-black">
              <iframe
                src={embed}
                title={meta.label}
                allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                className="aspect-video w-full"
              />
            </div>
          )}

          {material.file && (
            <a
              href={material.file}
              target="_blank"
              rel="noreferrer"
              onClick={onOpen}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              <Download size={15} />
              {material.file_name || 'Faylni ochish'}
            </a>
          )}

          {material.external_url && !embed && (
            <a
              href={material.external_url}
              target="_blank"
              rel="noreferrer"
              onClick={onOpen}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              <ExternalLink size={15} />
              Videoni ochish
            </a>
          )}

          {material.kind !== 'case' &&
            !material.text &&
            !material.file &&
            !material.external_url && (
              <p className="text-[13px] text-slate-500">Material bo'sh.</p>
            )}
        </div>
      )}
    </section>
  );
}

/* ==================== Test ==================== */

type TestQuestion = {
  question: string;
  options: string[];
  correct_index?: number;
  explanation?: string;
};

function TestBlock({
  subject,
  topicCode,
  questions,
  myAnswers,
  submitted,
  score,
  total,
  onDone,
}: {
  subject: StudentSubject;
  topicCode: string;
  questions: TestQuestion[];
  myAnswers?: number[];
  submitted: boolean;
  score: number | null;
  total: number | null;
  onDone: () => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const firstMissing = useRef<HTMLDivElement | null>(null);

  const answered = Object.keys(answers).length;
  const ready = answered === questions.length;
  const missingIndex = useMemo(
    () => questions.findIndex((_, i) => answers[i] === undefined),
    [answers, questions],
  );

  /* ---------- Topshirilgan: natija va xatolar tahlili ---------- */
  if (submitted) {
    const pct = total ? Math.round(((score || 0) / total) * 100) : 0;
    const tone =
      pct >= 80
        ? {
            bg: 'bg-emerald-50',
            border: 'border-emerald-200',
            text: 'text-emerald-900',
            bar: 'bg-emerald-500',
          }
        : pct >= 55
          ? {
              bg: 'bg-amber-50',
              border: 'border-amber-200',
              text: 'text-amber-900',
              bar: 'bg-amber-500',
            }
          : {
              bg: 'bg-rose-50',
              border: 'border-rose-200',
              text: 'text-rose-900',
              bar: 'bg-rose-500',
            };
    const reviewable = questions.some((q) => typeof q.correct_index === 'number');

    return (
      <section className="space-y-2.5">
        <div className={`rounded-2xl border ${tone.border} ${tone.bg} px-4 py-4`}>
          <div className="flex items-center gap-3">
            <CheckCircle2 size={26} className={tone.text} />
            <div className="min-w-0 flex-1">
              <p className={`text-[17px] font-bold ${tone.text}`}>
                Natija: {score} / {total}
              </p>
              <p className={`text-[12.5px] ${tone.text} opacity-80`}>
                Test bir marta topshiriladi — natija o'zgarmaydi.
              </p>
            </div>
            <span className={`shrink-0 text-[26px] font-bold tabular-nums ${tone.text}`}>
              {pct}%
            </span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/60">
            <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {reviewable && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-[14px] font-bold text-slate-900">Xatolar tahlili</h3>
            <ol className="space-y-3">
              {questions.map((q, qi) => {
                const mine = myAnswers?.[qi];
                const right = q.correct_index;
                // Javoblar tarixi bo'lmasa (eski yozuv) xato deb belgilamaymiz —
                // faqat to'g'ri javobni ko'rsatamiz.
                const known = typeof mine === 'number' && mine >= 0;
                const ok = known && mine === right;
                return (
                  <li key={qi} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <div className="flex items-start gap-2">
                      {!known ? (
                        <ListChecks size={16} className="mt-0.5 shrink-0 text-slate-400" />
                      ) : ok ? (
                        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                      ) : (
                        <XCircle size={16} className="mt-0.5 shrink-0 text-rose-500" />
                      )}
                      <p className="flex-1 text-[13.5px] font-semibold text-slate-900">
                        {qi + 1}. {q.question}
                      </p>
                    </div>
                    <ul className="mt-2 space-y-1 pl-6">
                      {q.options.map((opt, oi) => {
                        const isRight = oi === right;
                        const isMine = known && oi === mine;
                        return (
                          <li
                            key={oi}
                            className={`rounded-lg px-2.5 py-1.5 text-[12.5px] ${
                              isRight
                                ? 'bg-emerald-50 font-semibold text-emerald-800'
                                : isMine
                                  ? 'bg-rose-50 text-rose-800'
                                  : 'text-slate-500'
                            }`}
                          >
                            <span className="mr-1.5 font-bold">{String.fromCharCode(65 + oi)})</span>
                            {opt}
                            {isRight && <span className="ml-1.5 font-bold">— to'g'ri javob</span>}
                            {isMine && !isRight && (
                              <span className="ml-1.5 font-semibold">— sizning javobingiz</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {q.explanation && (
                      <p className="mt-2 rounded-lg bg-white px-3 py-2 text-[12.5px] leading-relaxed text-slate-600 ring-1 ring-slate-100">
                        {q.explanation}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </section>
    );
  }

  /* ---------- Topshirilmagan: savollar ---------- */
  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await submitTest(
        subject.syllabus_id,
        subject.variant_label,
        topicCode,
        questions.map((_, i) => answers[i] ?? -1),
      );
      await onDone();
    } catch (e) {
      setError(errText(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="sticky top-[46px] z-10 rounded-t-2xl border-b border-slate-100 bg-white/95 px-3.5 py-3 backdrop-blur sm:top-[53px] sm:px-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <ListChecks size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold text-slate-900">Nazorat testi</p>
            <p className="text-[12px] text-slate-500">
              {questions.length} savol · bir marta topshiriladi
            </p>
          </div>
          <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[12.5px] font-bold text-slate-700 tabular-nums">
            {answered}/{questions.length}
          </span>
        </div>
        <div className="mt-2.5">
          <Bar done={answered} total={questions.length} tone={ready ? 'emerald' : 'slate'} />
        </div>
      </div>

      <div className="space-y-3 px-3.5 py-4 sm:px-4">
        {questions.map((q, qi) => {
          const unanswered = answers[qi] === undefined;
          return (
            <div
              key={qi}
              ref={qi === missingIndex ? firstMissing : undefined}
              className={`rounded-xl border p-3.5 transition ${
                unanswered ? 'border-slate-200 bg-slate-50/60' : 'border-emerald-200 bg-white'
              }`}
            >
              <p className="mb-2.5 flex gap-2 text-[13.5px] font-semibold text-slate-900">
                <span className="text-slate-400 tabular-nums">{qi + 1}.</span>
                <span className="flex-1">{q.question}</span>
              </p>
              <div className="space-y-1.5">
                {q.options.map((opt, oi) => {
                  const picked = answers[qi] === oi;
                  return (
                    <label
                      key={oi}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] transition ${
                        picked
                          ? 'border-slate-800 bg-slate-800 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`q${qi}`}
                        checked={picked}
                        onChange={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                        className="sr-only"
                      />
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${
                          picked ? 'bg-white text-slate-900' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {String.fromCharCode(65 + oi)}
                      </span>
                      <span className="flex-1 leading-snug">{opt}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-100 px-3.5 py-3.5 sm:px-4">
        {error && (
          <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
        )}

        {confirming ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
            <div className="flex items-start gap-2">
              <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-600" />
              <div className="flex-1">
                <p className="text-[13.5px] font-bold text-amber-900">Javoblarni yuboraymi?</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-amber-800">
                  Test bir marta topshiriladi. Yuborilgach javoblarni o'zgartirib bo'lmaydi, lekin
                  to'g'ri javoblar va izohlarni ko'rasiz.
                </p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void send()}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-600 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-amber-700 disabled:opacity-60"
              >
                {busy && <Loader2 size={15} className="animate-spin" />}
                Ha, topshiraman
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
                className="rounded-lg border border-amber-300 bg-white px-4 py-2.5 text-[13.5px] font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
              >
                Orqaga
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (ready) {
                setConfirming(true);
                return;
              }
              firstMissing.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-bold transition ${
              ready
                ? 'bg-slate-800 text-white hover:bg-slate-700'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {ready
              ? 'Testni topshirish'
              : `Yana ${questions.length - answered} ta savol qoldi — ko'rsatish`}
          </button>
        )}
      </div>
    </section>
  );
}
