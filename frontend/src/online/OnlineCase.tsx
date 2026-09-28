import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Send, Sparkles, XCircle } from 'lucide-react';
import LectureMarkdown from '../components/staff/LectureMarkdown';
import { errText } from './onlineError';
import { submitCase, type CaseReview, type StudentMaterial } from './onlineStudentApi';

/**
 * Vaziyatli masala — talaba uchun.
 *
 * Ilgari masala yechimi bilan birga yuborilardi: talaba savolni o'qib,
 * pastda tayyor javobni ko'rardi. Ya'ni "vaziyatli masala" o'qib
 * chiqiladigan matn edi, o'ylab ko'riladigan topshiriq emas.
 *
 * Endi yechim server tomonda qoladi. Talaba o'z javobini yozadi, AI uni
 * etalon bilan solishtiradi va nimasi to'g'ri, nimasi yetishmayotganini
 * aytadi — so'ngina namunaviy javob ochiladi.
 */

const VERDICT: Record<
  CaseReview['verdict'],
  { label: string; icon: typeof CheckCircle2; box: string; text: string; bar: string }
> = {
  correct: {
    label: "To'g'ri javob",
    icon: CheckCircle2,
    box: 'border-emerald-200 bg-emerald-50',
    text: 'text-emerald-900',
    bar: 'bg-emerald-500',
  },
  partial: {
    label: "Qisman to'g'ri",
    icon: AlertTriangle,
    box: 'border-amber-200 bg-amber-50',
    text: 'text-amber-900',
    bar: 'bg-amber-500',
  },
  incorrect: {
    label: "Noto'g'ri",
    icon: XCircle,
    box: 'border-rose-200 bg-rose-50',
    text: 'text-rose-900',
    bar: 'bg-rose-500',
  },
};

const PROSE =
  'prose prose-slate max-w-none prose-headings:font-bold prose-headings:text-slate-900 ' +
  'prose-h1:text-[17px] prose-h2:text-[15px] prose-h3:text-[13.5px] prose-p:text-[13.5px] ' +
  'prose-p:leading-relaxed prose-li:text-[13.5px] prose-strong:text-slate-900';

export default function OnlineCase({
  material,
  syllabusId,
  variantLabel,
  topicCode,
  onSubmitted,
}: {
  material: StudentMaterial;
  syllabusId: number;
  variantLabel: string;
  topicCode: string;
  onSubmitted: () => Promise<void>;
}) {
  const [answer, setAnswer] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const review = material.review;
  const submitted = Boolean(material.submitted && review);
  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await submitCase(syllabusId, variantLabel, topicCode, answer.trim());
      await onSubmitted();
    } catch (e) {
      setError(errText(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {material.text && (
        <div className={PROSE}>
          <LectureMarkdown>{material.text}</LectureMarkdown>
        </div>
      )}

      {submitted && review ? (
        <Result review={review} myAnswer={material.my_answer || ''} />
      ) : (
        <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex items-start gap-2">
            <Sparkles size={15} className="mt-0.5 shrink-0 text-violet-500" />
            <p className="text-[12.5px] leading-relaxed text-slate-600">
              Tashxisingizni va keyingi qadamlarni o‘z so‘zlaringiz bilan yozing.
              Javobni yuborgach tahlil va namunaviy javob ochiladi.
            </p>
          </div>

          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={8}
            placeholder="Ehtimoliy tashxis, uni nimaga asoslanib qo‘ydingiz, keyingi tekshiruv va davolash qadamlari…"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13.5px] leading-relaxed focus:border-slate-400 focus:outline-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] text-slate-400 tabular-nums">{words} so‘z</span>
            {answer.trim().length > 0 && answer.trim().length < 20 && (
              <span className="text-[12px] font-medium text-amber-600">
                Javob juda qisqa
              </span>
            )}
          </div>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
          )}

          {confirming ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-[13px] font-bold text-amber-900">Javobni yuboraymi?</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-amber-800">
                Masala bir marta topshiriladi. Yuborilgach javobni o‘zgartirib
                bo‘lmaydi, lekin tahlil va namunaviy javobni ko‘rasiz.
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-600 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-amber-700 disabled:opacity-60"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
                  {busy ? 'Tahlil qilinmoqda…' : 'Ha, yuboraman'}
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
              disabled={answer.trim().length < 20}
              onClick={() => setConfirming(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-3 text-[14px] font-bold text-white transition hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-500"
            >
              <Send size={15} />
              Javobni yuborish
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Result({ review, myAnswer }: { review: CaseReview; myAnswer: string }) {
  const tone = VERDICT[review.verdict] || VERDICT.partial;
  const Icon = tone.icon;

  return (
    <div className="space-y-2.5">
      <div className={`rounded-xl border ${tone.box} p-3.5`}>
        <div className="flex items-center gap-2.5">
          <Icon size={22} className={tone.text} />
          <p className={`flex-1 text-[15px] font-bold ${tone.text}`}>{tone.label}</p>
          <span className={`text-[20px] font-bold tabular-nums ${tone.text}`}>
            {review.score}%
          </span>
        </div>
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/60">
          <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${review.score}%` }} />
        </div>
        {review.feedback && (
          <p className={`mt-2.5 text-[13px] leading-relaxed ${tone.text} opacity-90`}>
            {review.feedback}
          </p>
        )}
      </div>

      {myAnswer && (
        <details className="rounded-xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-slate-700">
            Sizning javobingiz
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600">
            {myAnswer}
          </p>
        </details>
      )}

      {(review.strengths.length > 0 || review.missed.length > 0) && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {review.strengths.length > 0 && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
              <p className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-emerald-700">
                To‘g‘ri aytgan joylaringiz
              </p>
              <ul className="space-y-1">
                {review.strengths.map((x, i) => (
                  <li key={i} className="flex gap-1.5 text-[12.5px] leading-snug text-emerald-900">
                    <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {review.missed.length > 0 && (
            <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-3">
              <p className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-rose-700">
                Yetishmagan yoki xato
              </p>
              <ul className="space-y-1">
                {review.missed.map((x, i) => (
                  <li key={i} className="flex gap-1.5 text-[12.5px] leading-snug text-rose-900">
                    <XCircle size={13} className="mt-0.5 shrink-0" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {review.ideal && (
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-500">
            Namunaviy javob
          </p>
          <div className={PROSE}>
            <LectureMarkdown>{review.ideal}</LectureMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
