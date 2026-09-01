import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  Radio,
  Video,
  X,
} from 'lucide-react';
import JitsiRoom from './JitsiRoom';
import {
  fetchLiveLesson,
  fetchSubjects,
  fetchTopicDetail,
  fetchTopics,
  markViewed,
  submitTest,
  type LiveLesson,
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

const KIND_LABEL: Record<string, string> = {
  lecture: "Ma'ruza matni",
  presentation: 'Taqdimot',
  video: 'Video dars',
  handout: 'Tarqatma material',
  case: 'Vaziyatli masala',
  test: 'Test',
};

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/"detail"\s*:\s*"([^"]+)"/);
  return m ? m[1] : msg || 'Xatolik';
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
      className="flex w-full items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-left hover:bg-emerald-100"
    >
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600">
        <Radio size={16} className="text-white" />
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-bold text-emerald-900">
          Hozir dars ketyapti — qo'shiling
        </span>
        <span className="block truncate text-[12px] text-emerald-800">
          {live.subject_name} · {live.topic_code}. {live.topic_title}
        </span>
      </span>
      <Video size={16} className="shrink-0 text-emerald-700" />
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

  if (subject) {
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

        <header>
          <h2 className="text-lg font-bold text-slate-900">{subject.subject_name}</h2>
          <p className="text-[12.5px] text-slate-500">
            {subject.open_count} / {subject.topic_count} mavzu ochiq
          </p>
        </header>

        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
        )}

        <div className="space-y-1.5">
          {topics.map((t) => {
            const done = t.test_submitted_at !== null;
            return (
              <button
                key={t.topic_code}
                type="button"
                disabled={!t.is_open}
                onClick={() => setTopicCode(t.topic_code)}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                  t.is_open
                    ? 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    : 'cursor-not-allowed border-slate-100 bg-slate-50/60'
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    done
                      ? 'bg-emerald-50 text-emerald-600'
                      : t.is_open
                        ? 'bg-slate-100 text-slate-500'
                        : 'bg-slate-100 text-slate-300'
                  }`}
                >
                  {done ? (
                    <CheckCircle2 size={15} />
                  ) : t.is_open ? (
                    <BookOpen size={15} />
                  ) : (
                    <Lock size={14} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-[13.5px] font-medium ${
                      t.is_open ? 'text-slate-800' : 'text-slate-400'
                    }`}
                  >
                    {t.topic_code}. {t.title}
                  </span>
                  <span className="text-[11.5px] text-slate-400">
                    {t.is_open
                      ? done
                        ? `Test topshirilgan — ${t.test_score}/${t.test_total}`
                        : 'Ochiq'
                      : "O'qituvchi dars o'tkazgach ochiladi"}
                  </span>
                </span>
                {t.is_open && <ChevronRight size={16} className="shrink-0 text-slate-300" />}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {liveBanner}
      <header>
        <h2 className="text-lg font-bold text-slate-900">Fanlarim</h2>
        <p className="text-[12.5px] text-slate-500">6-kurs davomida o'tiladigan fanlar</p>
      </header>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center">
          <p className="text-[13.5px] font-semibold text-amber-900">{error}</p>
        </div>
      )}

      {!error && subjects.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-10 text-center text-[13px] text-slate-500">
          Sizning guruhingizga hali fan biriktirilmagan.
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {subjects.map((s) => (
          <button
            key={`${s.syllabus_id}-${s.variant_label}`}
            type="button"
            onClick={() => setSubject(s)}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left hover:border-slate-300 hover:bg-slate-50"
          >
            <BookOpen size={18} className="shrink-0 text-slate-400" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold text-slate-800">
                {s.subject_name}
              </span>
              <span className="text-[12px] text-slate-500">
                {s.open_count}/{s.topic_count} mavzu ochiq · {s.done_count} test topshirilgan
              </span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-slate-300" />
          </button>
        ))}
      </div>
    </div>
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

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchTopicDetail(subject.syllabus_id, subject.variant_label, topicCode));
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
  const others = data.materials.filter((m) => m.kind !== 'test');

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
          {data.subject_name}
        </p>
        <h2 className="text-lg font-bold text-slate-900">
          {data.topic_code}. {data.title}
        </h2>
      </header>

      {others.length === 0 && !test && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center text-[13px] text-slate-500">
          O'qituvchi hali material joylamagan.
        </div>
      )}

      {others.map((m) => (
        <MaterialBlock
          key={m.kind}
          material={m}
          onOpen={() => {
            const k = m.kind;
            if (k === 'lecture' || k === 'presentation' || k === 'video' || k === 'handout') {
              void markViewed(subject.syllabus_id, subject.variant_label, topicCode, k).catch(
                () => {},
              );
            }
          }}
        />
      ))}

      {test?.questions?.length ? (
        <TestBlock
          subject={subject}
          topicCode={topicCode}
          questions={test.questions}
          submitted={data.test_submitted}
          score={data.test_score}
          total={data.test_total}
          onDone={reload}
        />
      ) : null}
    </div>
  );
}

function MaterialBlock({
  material,
  onOpen,
}: {
  material: StudentMaterial;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const label = KIND_LABEL[material.kind] || material.kind;

  const toggle = () => {
    if (!open) onOpen();
    setOpen((v) => !v);
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <FileText size={16} className="shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-slate-800">{label}</span>
        <ChevronRight
          size={16}
          className={`shrink-0 text-slate-300 transition ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-slate-100 px-3 py-3">
          {material.text && (
            <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-slate-700">
              {material.text}
            </div>
          )}
          {material.file && (
            <a
              href={material.file}
              target="_blank"
              rel="noreferrer"
              onClick={onOpen}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-200"
            >
              <Download size={14} />
              {material.file_name || 'Faylni ochish'}
            </a>
          )}
          {material.external_url && (
            <a
              href={material.external_url}
              target="_blank"
              rel="noreferrer"
              onClick={onOpen}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-200"
            >
              <ExternalLink size={14} />
              Videoni ochish
            </a>
          )}
          {!material.text && !material.file && !material.external_url && (
            <p className="text-[13px] text-slate-500">Material bo'sh.</p>
          )}
        </div>
      )}
    </section>
  );
}

function TestBlock({
  subject,
  topicCode,
  questions,
  submitted,
  score,
  total,
  onDone,
}: {
  subject: StudentSubject;
  topicCode: string;
  questions: Array<{ question: string; options: string[] }>;
  submitted: boolean;
  score: number | null;
  total: number | null;
  onDone: () => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (submitted) {
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
        <CheckCircle2 size={24} className="mx-auto text-emerald-600" />
        <p className="mt-1.5 text-[15px] font-bold text-emerald-900">
          Test topshirilgan: {score} / {total}
        </p>
        <p className="text-[12.5px] text-emerald-800">
          Test bir marta topshiriladi — natija o'zgarmaydi.
        </p>
      </section>
    );
  }

  const answered = Object.keys(answers).length;
  const ready = answered === questions.length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[14px] font-bold text-slate-900">Test</h3>
        <span className="text-[12px] text-slate-500 tabular-nums">
          {answered} / {questions.length}
        </span>
      </div>

      <div className="space-y-3">
        {questions.map((q, qi) => (
          <div key={qi} className="rounded-lg bg-slate-50 p-3">
            <p className="mb-2 text-[13.5px] font-medium text-slate-800">
              {qi + 1}. {q.question}
            </p>
            <div className="space-y-1">
              {q.options.map((opt, oi) => (
                <label
                  key={oi}
                  className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-[13px] transition ${
                    answers[qi] === oi ? 'bg-slate-800 text-white' : 'bg-white hover:bg-slate-100'
                  }`}
                >
                  <input
                    type="radio"
                    name={`q${qi}`}
                    checked={answers[qi] === oi}
                    onChange={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                    className="mt-0.5"
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
      )}

      <p className="mt-3 text-[12.5px] text-amber-700">
        Diqqat: test <strong>bir marta</strong> topshiriladi. Yuborishdan oldin
        javoblarni tekshiring.
      </p>

      <button
        type="button"
        disabled={busy || !ready}
        onClick={async () => {
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
          } finally {
            setBusy(false);
          }
        }}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-3 text-[14px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {busy && <Loader2 size={16} className="animate-spin" />}
        {ready ? 'Testni topshirish' : `Yana ${questions.length - answered} ta savol qoldi`}
      </button>
    </section>
  );
}
