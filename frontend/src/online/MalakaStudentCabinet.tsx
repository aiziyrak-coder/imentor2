import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileText,
  ListChecks,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Presentation,
  Video,
} from 'lucide-react';
import { errText } from './onlineError';
import { Bar, MaterialBlock, gradeTone } from './OnlineStudentCabinet';
import MalakaTestRunner, { percentTone } from './MalakaTestRunner';
import { markViewed, type StudentMaterial, type StudentSubject } from './onlineStudentApi';
import {
  ENTRY_CODE,
  EXIT_CODE,
  fetchMalakaSubjects,
  fetchMalakaTopic,
  fetchMalakaTopics,
  fetchSubjectTest,
  type AttemptSummary,
  type MalakaMaterial,
  type MalakaMaterialKind,
  type MalakaSubject,
  type MalakaTopic,
  type MalakaTopicDetail,
  type SubjectTestCode,
  type SubjectTestDetail,
  type SubjectTestStatus,
} from './malakaApi';

/**
 * Tinglovchi kabineti (malaka oshirish): fan → mavzular → bo'limlar.
 *
 * Online kabinetdan farqi: jonli dars va davomat yo'q, mavzu o'qituvchi
 * material joylashi bilan ochiladi — lekin fan kirish testidan boshlanadi.
 * Har mavzuda beshta bo'lim: ma'ruza matni, taqdimot, video darslar,
 * amaliy mashg'ulot va test.
 */

type Section = {
  kind: MalakaMaterialKind;
  label: string;
  short: string;
  icon: typeof FileText;
  tint: string;
};

/** Mavzu bo'limlari — tinglovchi shu tartibda yuradi. */
const SECTIONS: Section[] = [
  { kind: 'lecture', label: "Ma'ruza matni", short: "Ma'ruza", icon: FileText, tint: 'bg-indigo-50 text-indigo-600' },
  { kind: 'presentation', label: 'Taqdimot', short: 'Taqdimot', icon: Presentation, tint: 'bg-amber-50 text-amber-600' },
  { kind: 'video', label: 'Video darslar', short: 'Video', icon: Video, tint: 'bg-rose-50 text-rose-600' },
  { kind: 'practical', label: 'Amaliy mashg‘ulot', short: 'Amaliy', icon: ClipboardCheck, tint: 'bg-cyan-50 text-cyan-600' },
  { kind: 'test', label: 'Test', short: 'Test', icon: ListChecks, tint: 'bg-emerald-50 text-emerald-600' },
];

/** "Ko'rilgan" belgisi shu uchtasiga qo'yiladi; testlarda — urinish. */
const VIEWABLE: MalakaMaterialKind[] = ['lecture', 'presentation', 'video'];

type View = { kind: 'topic'; code: string } | { kind: 'test'; code: SubjectTestCode } | null;

function emptyAttempts(kind: 'test' | 'practical'): AttemptSummary {
  return {
    kind,
    max_attempts: 4,
    used: 0,
    left: 4,
    finished: false,
    best_percent: null,
    best_score: null,
    best_total: null,
    last_score: null,
    last_total: null,
    last_submitted_at: null,
  };
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-800"
    >
      <ArrowLeft size={15} />
      {label}
    </button>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-12 text-slate-400">
      <Loader2 size={20} className="animate-spin" />
    </div>
  );
}

export default function MalakaStudentCabinet() {
  const [subjects, setSubjects] = useState<MalakaSubject[]>([]);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [view, setView] = useState<View>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const autoOpened = useRef(false);

  const loadSubjects = useCallback(async () => {
    try {
      const rows = await fetchMalakaSubjects();
      setSubjects(rows);
      setError('');
      // Tinglovchida odatda bitta fan — ro'yxatni ko'rsatib o'tirmasdan ochamiz.
      if (!autoOpened.current && rows.length === 1) {
        autoOpened.current = true;
        setSubjectId(rows[0].syllabus_id);
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  const subject = subjects.find((s) => s.syllabus_id === subjectId) || null;
  // Test yoki mavzudan qaytganda fan kartochkasi yangilanadi: kirish testi
  // topshirilgach mavzular ochiladi.
  const back = () => {
    setView(null);
    void loadSubjects();
  };

  if (loading && !subjects.length) return <Spinner />;

  if (subject && view?.kind === 'test') {
    return <SubjectTestPage subject={subject} code={view.code} onBack={back} />;
  }
  if (subject && view?.kind === 'topic') {
    return <TopicPage subject={subject} code={view.code} onBack={back} />;
  }
  if (subject) {
    return (
      <SubjectPage
        subject={subject}
        canGoBack={subjects.length > 1}
        onBack={() => setSubjectId(null)}
        onOpenTopic={(code) => setView({ kind: 'topic', code })}
        onOpenTest={(code) => setView({ kind: 'test', code })}
      />
    );
  }

  return (
    <div className="space-y-3">
      <header>
        <h2 className="text-[20px] font-bold text-slate-900">Fanlarim</h2>
        <p className="text-[12.5px] text-slate-500">Malaka oshirish va qayta tayyorlash</p>
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
            Guruhingizga fan qo‘shilgach shu yerda ko‘rinadi.
          </p>
        </div>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2">
        {subjects.map((s) => {
          const entryPending = s.entry.available && s.entry.used === 0;
          return (
            <button
              key={s.syllabus_id}
              type="button"
              onClick={() => setSubjectId(s.syllabus_id)}
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
                {entryPending ? (
                  <span className="rounded-md bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700">
                    kirish testi kutilmoqda
                  </span>
                ) : s.average_grade !== null ? (
                  <span
                    className={`rounded-md px-1.5 py-0.5 font-semibold tabular-nums ${gradeTone(s.average_grade)}`}
                  >
                    o‘rtacha {s.average_grade}
                  </span>
                ) : (
                  <span className="text-slate-400">baho hali yo‘q</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ==================== Fan sahifasi ==================== */

function SubjectPage({
  subject,
  canGoBack,
  onBack,
  onOpenTopic,
  onOpenTest,
}: {
  subject: MalakaSubject;
  canGoBack: boolean;
  onBack: () => void;
  onOpenTopic: (code: string) => void;
  onOpenTest: (code: SubjectTestCode) => void;
}) {
  const [topics, setTopics] = useState<MalakaTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetchMalakaTopics(subject.syllabus_id)
      .then((rows) => {
        if (alive) setTopics(rows);
      })
      .catch((e) => {
        if (alive) setError(errText(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [subject.syllabus_id]);

  const entryPending = subject.entry.available && subject.entry.used === 0;

  return (
    <div className="space-y-3">
      {canGoBack && <BackButton label="Fanlarim" onClick={onBack} />}

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
            <strong className="text-slate-800 tabular-nums">{subject.done_count}</strong> mavzuda test
            topshirilgan
          </span>
          {subject.average_grade !== null && (
            <span>
              o‘rtacha baho{' '}
              <strong className="text-slate-800 tabular-nums">{subject.average_grade}</strong>
            </span>
          )}
        </div>
      </header>

      {subject.entry.available &&
        (entryPending ? (
          <GateCard status={subject.entry} kind="entry" onStart={() => onOpenTest('entry')} />
        ) : (
          <DoneRow status={subject.entry} kind="entry" onOpen={() => onOpenTest('entry')} />
        ))}

      {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}

      {loading ? (
        <Spinner />
      ) : topics.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-10 text-center">
          <FileText size={20} className="mx-auto mb-2 text-slate-300" />
          <p className="text-[13px] text-slate-500">O‘qituvchilar hali mavzu kiritmagan.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {topics.map((t) => (
            <TopicRow key={t.topic_code} topic={t} onOpen={() => onOpenTopic(t.topic_code)} />
          ))}
        </div>
      )}

      {subject.exit.available &&
        (subject.exit.used === 0 ? (
          <GateCard
            status={subject.exit}
            kind="exit"
            disabled={entryPending}
            onStart={() => onOpenTest('exit')}
          />
        ) : (
          <DoneRow status={subject.exit} kind="exit" onOpen={() => onOpenTest('exit')} />
        ))}
    </div>
  );
}

/** Topshirilmagan kirish yoki chiqish testi — ko'zga tashlanadigan kartochka. */
function GateCard({
  status,
  kind,
  disabled = false,
  onStart,
}: {
  status: SubjectTestStatus;
  kind: SubjectTestCode;
  disabled?: boolean;
  onStart: () => void;
}) {
  const entry = kind === 'entry';
  const Icon = entry ? LogIn : LogOut;
  return (
    <section
      className={`rounded-2xl border px-3.5 py-3.5 sm:px-4 ${
        entry ? 'border-amber-200 bg-amber-50/70' : 'border-violet-200 bg-violet-50/60'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${
            entry ? 'bg-amber-500' : 'bg-violet-600'
          }`}
        >
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-[14.5px] font-bold ${entry ? 'text-amber-950' : 'text-violet-950'}`}>
            {status.title}
          </p>
          <p
            className={`mt-0.5 text-[12.5px] leading-relaxed ${
              entry ? 'text-amber-900/80' : 'text-violet-900/80'
            }`}
          >
            {entry
              ? `Fan shu testdan boshlanadi — mavzular undan keyin ochiladi. ${status.question_count} savol, bir marta topshiriladi.`
              : disabled
                ? 'Avval kirish testini topshiring.'
                : `Kurs yakunidagi test. ${status.question_count} savol, bir marta topshiriladi.`}
          </p>
        </div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onStart}
        className={`mt-3 w-full rounded-xl py-2.5 text-[13.5px] font-bold text-white transition disabled:opacity-50 ${
          entry ? 'bg-amber-600 hover:bg-amber-700' : 'bg-violet-600 hover:bg-violet-700'
        }`}
      >
        {entry ? 'Kirish testini boshlash' : 'Chiqish testini boshlash'}
      </button>
    </section>
  );
}

/** Topshirilgan kirish yoki chiqish testi — ixcham qator, bosilsa tahlil ochiladi. */
function DoneRow({
  status,
  kind,
  onOpen,
}: {
  status: SubjectTestStatus;
  kind: SubjectTestCode;
  onOpen: () => void;
}) {
  const Icon = kind === 'entry' ? LogIn : LogOut;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-left transition hover:border-slate-300 sm:px-4"
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          kind === 'entry' ? 'bg-amber-50 text-amber-600' : 'bg-violet-50 text-violet-600'
        }`}
      >
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-slate-900">{status.title}</span>
        <span className="block text-[12px] text-slate-500">
          Topshirilgan · {status.best_score}/{status.best_total}
        </span>
      </span>
      <span
        className={`shrink-0 rounded-lg px-2 py-1 text-[12.5px] font-bold tabular-nums ${percentTone(
          status.best_percent,
        )}`}
      >
        {status.best_percent}%
      </span>
      <ChevronRight size={16} className="shrink-0 text-slate-300" />
    </button>
  );
}

function ResultChip({ label, summary }: { label: string; summary: AttemptSummary | null }) {
  if (!summary) return null;
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums ${
        summary.used ? percentTone(summary.best_percent) : 'bg-violet-50 text-violet-700'
      }`}
    >
      {label}{' '}
      {summary.used
        ? `${summary.best_percent}% · ${summary.used}/${summary.max_attempts}`
        : 'topshirilmagan'}
    </span>
  );
}

function TopicRow({ topic, onOpen }: { topic: MalakaTopic; onOpen: () => void }) {
  const reading = SECTIONS.filter((s) => VIEWABLE.includes(s.kind) && topic.has?.[s.kind]);
  const done = topic.grade !== null;

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
            {reading.map((s) => (
              <span key={s.kind} className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${s.tint}`}>
                {s.short}
              </span>
            ))}
            <ResultChip label="Amaliy" summary={topic.practical} />
            <ResultChip label="Test" summary={topic.test} />
          </span>
        ) : (
          <span className="mt-0.5 block text-[12px] text-slate-400">
            {topic.locked_reason === 'entry'
              ? 'Kirish testidan keyin ochiladi'
              : 'O‘qituvchi hali material joylamagan'}
          </span>
        )}
      </span>

      {done ? (
        <span
          className={`shrink-0 rounded-lg px-2 py-1 text-[12.5px] font-bold tabular-nums ${gradeTone(topic.grade)}`}
        >
          {topic.grade}
        </span>
      ) : topic.is_open ? (
        <ChevronRight size={16} className="mt-2 shrink-0 text-slate-300" />
      ) : null}
    </button>
  );
}

/* ==================== Mavzu ==================== */

function MissingRow({ section }: { section: Section }) {
  const Icon = section.icon;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-300">
        <Icon size={15} />
      </span>
      <span className="text-[13px] text-slate-400">{section.label} — hali joylanmagan</span>
    </div>
  );
}

function TopicPage({
  subject,
  code,
  onBack,
}: {
  subject: MalakaSubject;
  code: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<MalakaTopicDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [seen, setSeen] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    try {
      const d = await fetchMalakaTopic(subject.syllabus_id, code);
      setData(d);
      setSeen(d.viewed || {});
      setError('');
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [subject.syllabus_id, code]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) return <Spinner />;

  if (error || !data) {
    return (
      <div className="space-y-3">
        <BackButton label="Mavzular" onClick={onBack} />
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          {error || 'Mavzu topilmadi.'}
        </p>
      </div>
    );
  }

  const byKind = new Map<MalakaMaterialKind, MalakaMaterial[]>();
  for (const m of data.materials) {
    const list = byKind.get(m.kind);
    if (list) list.push(m);
    else byKind.set(m.kind, [m]);
  }

  const reading = VIEWABLE.filter((k) => byKind.has(k));
  const tests = (['practical', 'test'] as const).filter((k) => byKind.has(k));
  const steps = reading.length + tests.length;
  const stepsDone =
    reading.filter((k) => seen[k]).length +
    tests.filter((k) => (data.result[k]?.used || 0) > 0).length;

  // MaterialBlock online kabinetdan olingan — u fandan faqat ID ni ishlatadi.
  const asSubject = { syllabus_id: subject.syllabus_id, variant_label: '' } as unknown as StudentSubject;

  const onOpened = (kind: MalakaMaterialKind) => {
    if (!VIEWABLE.includes(kind) || seen[kind]) return;
    setSeen((s) => ({ ...s, [kind]: true }));
    void markViewed(subject.syllabus_id, '', code, kind as 'lecture' | 'presentation' | 'video').catch(
      () => {},
    );
  };

  let index = 0;

  return (
    <div className="space-y-3">
      <BackButton label="Mavzular" onClick={onBack} />

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
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-500">
              {stepsDone === steps ? (
                <span className="font-semibold text-emerald-700">Mavzu to‘liq o‘zlashtirildi.</span>
              ) : (
                <span>
                  <strong className="text-slate-800 tabular-nums">
                    {stepsDone}/{steps}
                  </strong>{' '}
                  bosqich bajarildi
                </span>
              )}
              {data.result.grade !== null && (
                <span>
                  mavzu bahosi{' '}
                  <span
                    className={`rounded-md px-1.5 py-0.5 font-bold tabular-nums ${gradeTone(data.result.grade)}`}
                  >
                    {data.result.grade}
                  </span>
                </span>
              )}
            </p>
          </>
        )}
      </header>

      <div className="space-y-2.5">
        {SECTIONS.map((section) => {
          const items = byKind.get(section.kind) || [];
          if (!items.length) return <MissingRow key={section.kind} section={section} />;

          if (section.kind === 'practical' || section.kind === 'test') {
            const m = items[0];
            return (
              <MalakaTestRunner
                key={section.kind}
                syllabusId={subject.syllabus_id}
                topicCode={code}
                kind={section.kind}
                title={section.kind === 'test' ? 'Test' : undefined}
                questions={m.questions || []}
                myAnswers={m.my_answers}
                attempts={m.attempts ?? emptyAttempts(section.kind)}
                onDone={reload}
              />
            );
          }

          return items.map((m) => {
            index += 1;
            return (
              <MaterialBlock
                key={m.id}
                index={index}
                material={m as unknown as StudentMaterial}
                showTitle={items.length > 1}
                viewed={Boolean(seen[m.kind])}
                onOpen={() => onOpened(m.kind)}
                subject={asSubject}
                topicCode={code}
                onReload={reload}
              />
            );
          });
        })}
      </div>
    </div>
  );
}

/* ==================== Kirish va chiqish testi ==================== */

function SubjectTestPage({
  subject,
  code,
  onBack,
}: {
  subject: MalakaSubject;
  code: SubjectTestCode;
  onBack: () => void;
}) {
  const [data, setData] = useState<SubjectTestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await fetchSubjectTest(subject.syllabus_id, code));
      setError('');
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [subject.syllabus_id, code]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <BackButton label="Orqaga" onClick={onBack} />
      {loading ? (
        <Spinner />
      ) : error || !data ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          {error || 'Test topilmadi.'}
        </p>
      ) : (
        <>
          <header className="px-1">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">
              {data.subject_name}
            </p>
            <h2 className="text-[19px] font-bold leading-tight text-slate-900">{data.title}</h2>
          </header>
          <MalakaTestRunner
            syllabusId={subject.syllabus_id}
            topicCode={code === 'entry' ? ENTRY_CODE : EXIT_CODE}
            kind={code}
            title={data.title}
            questions={data.questions}
            myAnswers={data.my_answers}
            attempts={data.attempts}
            onDone={load}
          />
          {code === 'entry' && data.attempts.used > 0 && (
            <button
              type="button"
              onClick={onBack}
              className="w-full rounded-xl bg-slate-800 py-3 text-[14px] font-bold text-white transition hover:bg-slate-700"
            >
              Mavzularga o‘tish
            </button>
          )}
        </>
      )}
    </div>
  );
}
