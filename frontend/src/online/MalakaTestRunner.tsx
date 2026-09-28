import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  ListChecks,
  Loader2,
  LogIn,
  LogOut,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { errText } from './onlineError';
import {
  submitAttempt,
  type AttemptKind,
  type AttemptSummary,
  type TestQuestionView,
} from './malakaApi';

/**
 * Malaka testi: mashg'ulot testi, amaliy mashg'ulot, kirish va chiqish testi.
 *
 * Online'dagi testdan farqi — urinishlar. Mashg'ulot testi va amaliy
 * mashg'ulot 4 marta topshiriladi va eng yaxshi natija hisoblanadi.
 * To'g'ri javoblar urinishlar tugagach ochiladi: har urinishdan keyin
 * ochilsa, ikkinchisi javobni ko'chirib yozish bo'lib qolardi.
 */

export const ATTEMPT_TITLE: Record<AttemptKind, string> = {
  test: 'Nazorat testi',
  practical: 'Amaliy mashg‘ulot',
  entry: 'Kirish testi',
  exit: 'Chiqish testi',
};

const ATTEMPT_ICON = {
  test: ListChecks,
  practical: ClipboardCheck,
  entry: LogIn,
  exit: LogOut,
} as const;

export const ATTEMPT_TINT: Record<AttemptKind, string> = {
  test: 'bg-emerald-50 text-emerald-600',
  practical: 'bg-cyan-50 text-cyan-600',
  entry: 'bg-amber-50 text-amber-600',
  exit: 'bg-violet-50 text-violet-600',
};

/** Foiz rangi: 86+ a'lo, 71+ yaxshi, 56+ qoniqarli, pastda — qayta ishlash kerak. */
export function percentTone(p: number | null | undefined): string {
  if (p === null || p === undefined) return 'bg-slate-100 text-slate-500';
  if (p >= 86) return 'bg-emerald-50 text-emerald-700';
  if (p >= 71) return 'bg-sky-50 text-sky-700';
  if (p >= 56) return 'bg-amber-50 text-amber-700';
  return 'bg-rose-50 text-rose-700';
}

function introText(kind: AttemptKind, max: number): string {
  if (kind === 'entry') {
    return 'Kirish testi boshlang‘ich bilimingizni o‘lchaydi. Bir marta topshiriladi — mavzular undan keyin ochiladi.';
  }
  if (kind === 'exit') return 'Kurs yakunidagi test. Bir marta topshiriladi, natija o‘zgarmaydi.';
  return `${max} ta urinish bor, eng yaxshi natija hisoblanadi. To‘g‘ri javoblar urinishlar tugagach ko‘rsatiladi.`;
}

function AttemptDots({ attempts }: { attempts: AttemptSummary }) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <div className="flex flex-1 gap-1">
        {Array.from({ length: attempts.max_attempts }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${i < attempts.used ? 'bg-slate-800' : 'bg-slate-200'}`}
          />
        ))}
      </div>
      <span className="shrink-0 text-[12px] font-semibold tabular-nums text-slate-500">
        urinish {attempts.used}/{attempts.max_attempts}
      </span>
    </div>
  );
}

function Review({ questions, myAnswers }: { questions: TestQuestionView[]; myAnswers?: number[] }) {
  return (
    <ol className="mt-3 space-y-3">
      {questions.map((q, qi) => {
        const mine = myAnswers?.[qi];
        const right = q.correct_index;
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
                    {isRight && <span className="ml-1.5 font-bold">— to‘g‘ri javob</span>}
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
  );
}

export default function MalakaTestRunner({
  syllabusId,
  topicCode,
  kind,
  title,
  questions,
  myAnswers,
  attempts,
  onDone,
}: {
  syllabusId: number;
  topicCode: string;
  kind: AttemptKind;
  title?: string;
  questions: TestQuestionView[];
  myAnswers?: number[];
  attempts: AttemptSummary;
  /** Topshirilgandan keyin — ota komponent ma'lumotni qayta yuklaydi. */
  onDone: () => Promise<void>;
}) {
  const [solving, setSolving] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [last, setLast] = useState<{ score: number; total: number } | null>(null);
  const [showReview, setShowReview] = useState(false);
  const firstMissing = useRef<HTMLDivElement | null>(null);

  const Icon = ATTEMPT_ICON[kind];
  const heading = title?.trim() || ATTEMPT_TITLE[kind];
  const single = attempts.max_attempts === 1;
  const answered = Object.keys(answers).length;
  const ready = questions.length > 0 && answered === questions.length;
  const missingIndex = useMemo(
    () => questions.findIndex((_, i) => answers[i] === undefined),
    [answers, questions],
  );
  const reviewable = questions.some((q) => typeof q.correct_index === 'number');

  const start = () => {
    setAnswers({});
    setConfirming(false);
    setError('');
    setLast(null);
    setShowReview(false);
    setSolving(true);
  };

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await submitAttempt({
        syllabus_id: syllabusId,
        topic_code: topicCode,
        kind,
        answers: questions.map((_, i) => answers[i] ?? -1),
      });
      setLast({ score: r.score, total: r.total });
      setSolving(false);
      setConfirming(false);
      await onDone();
    } catch (e) {
      setError(errText(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="flex items-center gap-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${ATTEMPT_TINT[kind]}`}>
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold text-slate-900">{heading}</p>
        <p className="text-[12px] text-slate-500">
          {questions.length} savol ·{' '}
          {single ? 'bir marta topshiriladi' : `${attempts.max_attempts} ta urinish, eng yaxshisi hisoblanadi`}
        </p>
      </div>
      {attempts.used > 0 && !solving && (
        <span
          className={`shrink-0 rounded-lg px-2.5 py-1 text-[14px] font-bold tabular-nums ${percentTone(
            attempts.best_percent,
          )}`}
        >
          {attempts.best_percent}%
        </span>
      )}
    </div>
  );

  /* ---------- Natija yoki boshlash ---------- */
  if (!solving) {
    const lastScore = last?.score ?? attempts.last_score;
    const lastTotal = last?.total ?? attempts.last_total;
    return (
      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="px-3.5 py-3.5 sm:px-4">
          {header}

          {attempts.used === 0 ? (
            <>
              <p className="mt-3 text-[12.5px] leading-relaxed text-slate-600">
                {introText(kind, attempts.max_attempts)}
              </p>
              <button
                type="button"
                onClick={start}
                disabled={questions.length === 0}
                className="mt-3 w-full rounded-xl bg-slate-800 py-2.5 text-[14px] font-bold text-white transition hover:bg-slate-700 disabled:opacity-50"
              >
                Boshlash
              </button>
            </>
          ) : (
            <>
              {!single && <AttemptDots attempts={attempts} />}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-slate-200 px-3 py-2">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                    Eng yaxshi natija
                  </p>
                  <p className="mt-0.5 text-[16px] font-bold tabular-nums text-slate-900">
                    {attempts.best_score}/{attempts.best_total}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 px-3 py-2">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                    {last ? 'Hozirgi urinish' : 'Oxirgi urinish'}
                  </p>
                  <p className="mt-0.5 text-[16px] font-bold tabular-nums text-slate-900">
                    {lastScore}/{lastTotal}
                  </p>
                </div>
              </div>

              {attempts.left > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={start}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white py-2.5 text-[13.5px] font-semibold text-slate-800 transition hover:bg-slate-50"
                  >
                    <RotateCcw size={15} />
                    Qayta topshirish · {attempts.left} ta urinish qoldi
                  </button>
                  {!reviewable && (
                    <p className="mt-2 text-[11.5px] leading-relaxed text-slate-400">
                      To‘g‘ri javoblar urinishlar tugagach yoki 100% olganingizda ko‘rsatiladi.
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-3 text-[12.5px] text-slate-500">
                  {single ? 'Test topshirilgan.' : 'Urinishlar tugadi.'} Hisobga olingan natija —{' '}
                  <strong className="text-slate-800">{attempts.best_percent}%</strong>.
                </p>
              )}
            </>
          )}
        </div>

        {reviewable && attempts.used > 0 && (
          <div className="border-t border-slate-100 px-3.5 py-3 sm:px-4">
            <button
              type="button"
              onClick={() => setShowReview((v) => !v)}
              className="text-[13px] font-semibold text-slate-700 hover:text-slate-900"
            >
              {showReview ? 'Tahlilni yopish' : 'Javoblar tahlilini ko‘rish'}
            </button>
            {showReview && <Review questions={questions} myAnswers={myAnswers} />}
          </div>
        )}
      </section>
    );
  }

  /* ---------- Yechish ---------- */
  return (
    <section className="rounded-2xl border border-slate-300 bg-white shadow-sm">
      <div className="sticky top-[46px] z-10 rounded-t-2xl border-b border-slate-100 bg-white/95 px-3.5 py-3 backdrop-blur sm:top-[53px] sm:px-4">
        <div className="flex items-center gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${ATTEMPT_TINT[kind]}`}>
            <Icon size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold text-slate-900">{heading}</p>
            <p className="text-[12px] text-slate-500">
              {single ? 'Bir marta topshiriladi' : `${attempts.used + 1}-urinish (${attempts.max_attempts} tadan)`}
            </p>
          </div>
          <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[12.5px] font-bold text-slate-700 tabular-nums">
            {answered}/{questions.length}
          </span>
        </div>
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80">
          <div
            className={`h-full rounded-full transition-all ${ready ? 'bg-emerald-500' : 'bg-slate-800'}`}
            style={{ width: `${questions.length ? Math.round((answered / questions.length) * 100) : 0}%` }}
          />
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
                        name={`${topicCode}-${kind}-q${qi}`}
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
                  {single
                    ? 'Test bir marta topshiriladi — yuborilgach o‘zgartirib bo‘lmaydi.'
                    : `Bu ${attempts.used + 1}-urinish. Keyin yana ${attempts.left - 1} ta urinish qoladi; eng yaxshi natija hisoblanadi.`}
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
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (ready) {
                  setConfirming(true);
                  return;
                }
                firstMissing.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-bold transition ${
                ready
                  ? 'bg-slate-800 text-white hover:bg-slate-700'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {ready ? 'Topshirish' : `Yana ${questions.length - answered} ta savol qoldi — ko‘rsatish`}
            </button>
            <button
              type="button"
              onClick={() => setSolving(false)}
              className="rounded-xl border border-slate-200 px-4 text-[13px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              Bekor
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
