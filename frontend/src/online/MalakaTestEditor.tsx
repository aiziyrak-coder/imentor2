import { useMemo, useRef, useState } from 'react';
import {
  Check,
  FileUp,
  Keyboard,
  Loader2,
  Megaphone,
  PenLine,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { errText } from './onlineError';
import { generateTest } from './onlineGenerate';
import { importTest, type ImportedQuestion } from './malakaApi';
import { saveMaterial, type Material, type TeacherCourse } from './onlineTeacherApi';

/**
 * Malaka testi muharriri: mashg'ulot testi, amaliy mashg'ulot, kirish va
 * chiqish testi.
 *
 * O'qituvchilarning testlari tayyor — Word yoki PDF faylda, har kimniki
 * o'z shaklida. Shuning uchun asosiy yo'l — faylni yuklash: AI uni o'qib,
 * savol va variantlarni ajratadi, faylda to'g'ri javob ko'rsatilmagan
 * bo'lsa uni o'zi tanlaydi va shu savollarni sariq bilan belgilaydi.
 * Natija SAQLANMAYDI — o'qituvchi ko'rib chiqadi, tuzatadi va keyin saqlaydi.
 */

type Draft = {
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  /** To'g'ri javobni AI tanlagan — o'qituvchi tasdiqlashi kerak. */
  aiPicked: boolean;
};

type StoredQuestion = {
  question?: string;
  options?: string[];
  correctOptionIndex?: number;
  explanation?: string;
};

type Source = 'file' | 'text' | 'ai' | 'manual';

const SOURCE_LABEL: Record<Source, string> = {
  file: 'Fayldan',
  text: 'Matndan',
  ai: 'AI tuzsin',
  manual: 'Qo‘lda',
};

const LETTERS = 'ABCDEFGH';

function emptyQuestion(): Draft {
  return { question: '', options: ['', '', '', ''], correctOptionIndex: 0, explanation: '', aiPicked: false };
}

function fromStored(items: StoredQuestion[]): Draft[] {
  return items.map((q) => ({
    question: String(q.question || ''),
    options: Array.isArray(q.options) && q.options.length ? q.options.map(String) : ['', ''],
    correctOptionIndex: typeof q.correctOptionIndex === 'number' ? q.correctOptionIndex : 0,
    explanation: String(q.explanation || ''),
    aiPicked: false,
  }));
}

function fromImported(items: ImportedQuestion[]): Draft[] {
  return items.map((q) => ({
    question: q.question,
    options: [...q.options],
    correctOptionIndex: q.correctOptionIndex,
    explanation: q.explanation || '',
    aiPicked: q.answer_source === 'ai',
  }));
}

/** Saqlashga tayyorlaydi: bo'sh variant tashlanadi, to'g'ri javob indeksi suriladi. */
function finalize(
  draft: Draft[],
): { questions: StoredQuestion[] } | { error: string; index: number } {
  const out: StoredQuestion[] = [];
  for (let i = 0; i < draft.length; i += 1) {
    const q = draft[i];
    const question = q.question.trim();
    const kept: string[] = [];
    let correct = -1;
    q.options.forEach((option, j) => {
      const text = option.trim();
      if (!text) return;
      if (j === q.correctOptionIndex) correct = kept.length;
      kept.push(text);
    });
    if (!question) return { error: `${i + 1}-savolning matni bo‘sh.`, index: i };
    if (kept.length < 2) return { error: `${i + 1}-savolda kamida 2 ta variant bo‘lsin.`, index: i };
    if (correct < 0) {
      return { error: `${i + 1}-savolda to‘g‘ri javob belgilanmagan (yoki u bo‘sh variant).`, index: i };
    }
    out.push({ question, options: kept, correctOptionIndex: correct, explanation: q.explanation.trim() });
  }
  if (!out.length) return { error: 'Kamida bitta savol qo‘shing.', index: -1 };
  return { questions: out };
}

export default function MalakaTestEditor({
  course,
  topicCode,
  topicTitle,
  kind,
  existing,
  allMaterials,
  subjectTest,
  busy,
  onSave,
}: {
  course: TeacherCourse;
  /** Mavzu kodi yoki kirish/chiqish testining maxsus kodi. */
  topicCode: string;
  topicTitle: string;
  kind: 'test' | 'practical';
  existing?: Material;
  /** Mavzudagi materiallar — "AI tuzsin" shular asosida savol tuzadi. */
  allMaterials?: Material[];
  subjectTest?: 'entry' | 'exit';
  busy: boolean;
  onSave: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const stored = useMemo(
    () => ((existing?.payload as { questions?: StoredQuestion[] } | undefined)?.questions || []),
    [existing],
  );
  const published = (existing?.payload as { published?: boolean } | undefined)?.published !== false;

  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [source, setSource] = useState<Source>('file');
  const [pasted, setPasted] = useState('');
  const [count, setCount] = useState(10);
  const [working, setWorking] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);

  const label = subjectTest
    ? subjectTest === 'entry'
      ? 'Kirish testi'
      : 'Chiqish testi'
    : kind === 'practical'
      ? 'Amaliy mashg‘ulot'
      : 'Test';
  // Kirish/chiqish testi butun fan bo'yicha — bitta mavzu materialidan tuzib bo'lmaydi.
  const sources: Source[] = subjectTest ? ['file', 'text', 'manual'] : ['file', 'text', 'ai', 'manual'];

  const accept = (items: Draft[], message: string) => {
    setDraft(items);
    setPicking(false);
    setNote(message);
    setError('');
  };

  const runImport = async (input: { file?: File; text?: string }) => {
    setWorking(
      input.file
        ? `“${input.file.name}” o‘qilmoqda — AI savollarni ajratyapti. Katta faylda 1–2 daqiqa olishi mumkin…`
        : 'AI matndan savollarni ajratyapti…',
    );
    setError('');
    setNote('');
    try {
      const r = await importTest(course.syllabus_id, input);
      if (!r.questions.length) {
        setError(
          'Savol topilmadi. Fayl test savollaridan iboratligini tekshiring yoki matnini “Matndan” bo‘limiga joylang.',
        );
        return;
      }
      const parts = [`${r.questions.length} ta savol topildi.`];
      if (r.ai_decided) {
        parts.push(
          `${r.ai_decided} tasida faylda to‘g‘ri javob ko‘rsatilmagan edi — AI o‘zi tanladi. Ular sariq bilan belgilangan: tekshirib chiqing.`,
        );
      }
      if (r.truncated) parts.push('Fayl juda katta — faqat boshidagi qismi o‘qildi.');
      if (r.failed_chunks) parts.push(`Faylning ${r.failed_chunks} qismi o‘qilmadi — savollar sonini tekshiring.`);
      accept(fromImported(r.questions), parts.join(' '));
    } catch (e) {
      setError(errText(e));
    } finally {
      setWorking('');
    }
  };

  const runAi = async () => {
    setWorking('Mavzu materiallari asosida savollar tuzilmoqda…');
    setError('');
    setNote('');
    try {
      const session = await generateTest(
        {
          subjectName: course.subject_name,
          subjectCode: course.subject_code,
          departmentName: course.department_name,
          topicTitle: topicTitle,
          language: (course.instruction_language || 'uz') as 'uz' | 'ru' | 'en',
          materials: allMaterials,
        },
        count,
      );
      const items = (session.questions || []).map((q) => ({
        question: q.question,
        options: [...q.options],
        correctOptionIndex: q.correctOptionIndex,
        explanation: q.explanation || '',
        aiPicked: false,
      }));
      if (!items.length) throw new Error('AI savol qaytarmadi. Qayta urinib ko‘ring.');
      accept(items, `${items.length} ta savol tuzildi. O‘qib chiqing, kerak bo‘lsa tuzating va saqlang.`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setWorking('');
    }
  };

  const patchQ = (i: number, change: Partial<Draft>) =>
    setDraft((d) => (d ? d.map((q, j) => (j === i ? { ...q, ...change } : q)) : d));

  const save = () => {
    if (!draft) return;
    const result = finalize(draft);
    if ('error' in result) {
      setError(result.error);
      if (result.index >= 0) {
        itemRefs.current[result.index]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    const payload: Record<string, unknown> = { questions: result.questions };
    if (subjectTest) payload.published = existing ? published : subjectTest === 'entry';
    onSave(async () => {
      await saveMaterial({
        syllabus_id: course.syllabus_id,
        variant_label: course.variant_label,
        topic_code: topicCode,
        kind,
        title: subjectTest || kind === 'practical' ? label : `${result.questions.length} ta test`,
        payload,
      });
      setDraft(null);
      setNote('');
    }, 'Saqlandi.');
  };

  const togglePublish = () => {
    onSave(
      () =>
        saveMaterial({
          syllabus_id: course.syllabus_id,
          variant_label: course.variant_label,
          topic_code: topicCode,
          kind,
          title: existing?.title || label,
          payload: { questions: stored, published: !published },
        }),
      published ? 'Test tinglovchilardan yashirildi.' : 'E’lon qilindi — tinglovchilar endi ko‘radi.',
    );
  };

  const status = (
    <>
      {working && (
        <p className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
          <Loader2 size={14} className="shrink-0 animate-spin" />
          {working}
        </p>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Yopish">
            <X size={13} />
          </button>
        </div>
      )}
    </>
  );

  /* ---------- Muharrir ---------- */
  if (draft) {
    const aiLeft = draft.filter((q) => q.aiPicked).length;
    return (
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
          <strong className="text-slate-800">{draft.length} savol</strong>
          {aiLeft > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
              {aiLeft} tasini tekshiring
            </span>
          )}
          <span className="text-slate-400">Harfni bosing — to‘g‘ri javob shu bo‘ladi.</span>
        </div>
        {note && <p className="text-[12.5px] leading-relaxed text-slate-600">{note}</p>}

        <ol className="space-y-2">
          {draft.map((q, i) => (
            <li
              key={i}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              className={`rounded-xl border p-3 ${
                q.aiPicked ? 'border-amber-300 bg-amber-50/50' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-2 w-6 shrink-0 text-[12px] font-bold tabular-nums text-slate-400">
                  {i + 1}.
                </span>
                <textarea
                  value={q.question}
                  onChange={(e) => patchQ(i, { question: e.target.value })}
                  rows={2}
                  placeholder="Savol matni"
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-2 text-[13px] leading-snug"
                />
                <button
                  type="button"
                  onClick={() => setDraft((d) => (d ? d.filter((_, j) => j !== i) : d))}
                  className="tap-tight shrink-0 rounded-md p-2 text-rose-500 hover:bg-rose-50"
                  aria-label="Savolni o‘chirish"
                  title="Savolni o‘chirish"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="mt-2 space-y-1.5 pl-8">
                {q.options.map((option, j) => {
                  const right = j === q.correctOptionIndex;
                  return (
                    <div key={j} className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => patchQ(i, { correctOptionIndex: j, aiPicked: false })}
                        className={`tap-tight flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11.5px] font-bold transition ${
                          right ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                        title="To‘g‘ri javob deb belgilash"
                        aria-label={`${LETTERS[j]} — to‘g‘ri javob`}
                      >
                        {LETTERS[j]}
                      </button>
                      <input
                        value={option}
                        onChange={(e) =>
                          patchQ(i, { options: q.options.map((o, k) => (k === j ? e.target.value : o)) })
                        }
                        placeholder={`${LETTERS[j]} variant`}
                        className={`min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-[12.5px] ${
                          right ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-200'
                        }`}
                      />
                      {q.options.length > 2 && (
                        <button
                          type="button"
                          onClick={() =>
                            patchQ(i, {
                              options: q.options.filter((_, k) => k !== j),
                              correctOptionIndex:
                                j === q.correctOptionIndex
                                  ? 0
                                  : j < q.correctOptionIndex
                                    ? q.correctOptionIndex - 1
                                    : q.correctOptionIndex,
                            })
                          }
                          className="tap-tight shrink-0 rounded-md p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                          aria-label="Variantni olib tashlash"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {q.options.length < LETTERS.length && (
                  <button
                    type="button"
                    onClick={() => patchQ(i, { options: [...q.options, ''] })}
                    className="text-[12px] font-medium text-slate-500 hover:text-slate-800"
                  >
                    + variant
                  </button>
                )}
                <input
                  value={q.explanation}
                  onChange={(e) => patchQ(i, { explanation: e.target.value })}
                  placeholder="Izoh (ixtiyoriy) — tinglovchi urinishlar tugagach ko‘radi"
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-600"
                />
                {q.aiPicked && (
                  <p className="flex flex-wrap items-center gap-2 text-[11.5px] text-amber-800">
                    Faylda javob ko‘rsatilmagan edi — to‘g‘ri javobni AI tanladi.
                    <button
                      type="button"
                      onClick={() => patchQ(i, { aiPicked: false })}
                      className="rounded-md bg-amber-100 px-2 py-0.5 font-semibold hover:bg-amber-200"
                    >
                      To‘g‘ri, tasdiqlayman
                    </button>
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={() => setDraft((d) => [...(d || []), emptyQuestion()])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[12.5px] font-medium text-slate-600 hover:bg-slate-50"
        >
          <Plus size={14} />
          Savol qo‘shish
        </button>

        {status}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Saqlash
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              setNote('');
              setError('');
            }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Bekor qilish
          </button>
        </div>
        {existing && (
          <p className="text-[11.5px] text-slate-400">
            Saqlangach yangi urinishlar yangi savollar bo‘yicha bo‘ladi; oldingi natijalar saqlanib qoladi.
          </p>
        )}
      </div>
    );
  }

  /* ---------- Saqlangan test ---------- */
  if (existing && !picking) {
    const shown = showAll ? stored : stored.slice(0, 3);
    return (
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-slate-600">
            <strong className="text-slate-900">{stored.length}</strong> savol
          </span>
          {subjectTest && (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                published ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {published ? 'e’lon qilingan' : 'e’lon qilinmagan'}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setDraft(fromStored(stored));
              setNote('');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            <PenLine size={14} />
            Tahrirlash
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setPicking(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Upload size={14} />
            Boshqasiga almashtirish
          </button>
          {subjectTest && (
            <button
              type="button"
              disabled={busy}
              onClick={togglePublish}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold disabled:opacity-50 ${
                published
                  ? 'border border-slate-200 text-slate-700 hover:bg-slate-50'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              <Megaphone size={14} />
              {published ? 'Yashirish' : 'E’lon qilish'}
            </button>
          )}
        </div>

        <ol className="space-y-2">
          {shown.map((q, i) => (
            <li key={i} className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-[12.5px] font-medium text-slate-800">
                {i + 1}. {q.question}
              </p>
              <ul className="mt-1 space-y-0.5">
                {(q.options || []).map((o, j) => (
                  <li
                    key={j}
                    className={`text-[12px] ${
                      j === q.correctOptionIndex ? 'font-semibold text-emerald-700' : 'text-slate-500'
                    }`}
                  >
                    {LETTERS[j]}) {o}
                    {j === q.correctOptionIndex ? ' ✓' : ''}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        {stored.length > 3 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[12.5px] font-medium text-slate-600 hover:text-slate-900"
          >
            {showAll ? 'Qisqartirish' : `Hammasini ko‘rish (${stored.length})`}
          </button>
        )}
        {status}
      </div>
    );
  }

  /* ---------- Manba tanlash ---------- */
  return (
    <div className="space-y-2.5">
      <div className="online-tabs rounded-lg bg-slate-100 p-1">
        {sources.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSource(s)}
            className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition ${
              source === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {SOURCE_LABEL[s]}
          </button>
        ))}
      </div>

      {source === 'file' && (
        <label
          className={`flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition ${
            working ? 'opacity-60' : 'cursor-pointer hover:bg-slate-100'
          }`}
        >
          <FileUp size={20} className="text-slate-400" />
          <span className="text-[13px] font-semibold text-slate-700">Test faylini tanlang</span>
          <span className="max-w-md text-[12px] leading-relaxed text-slate-500">
            Word (.docx, .doc), PDF yoki .txt — 15 MB gacha. AI faylni o‘qib, savol va variantlarni
            ajratadi; to‘g‘ri javob ko‘rsatilmagan savollarda javobni o‘zi tanlaydi.
          </span>
          <input
            type="file"
            accept=".docx,.doc,.pdf,.txt"
            className="hidden"
            disabled={Boolean(working)}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void runImport({ file: f });
            }}
          />
        </label>
      )}

      {source === 'text' && (
        <div className="space-y-2">
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={9}
            placeholder={'1. Savol matni?\nA) birinchi variant\nB) ikkinchi variant\nC) uchinchi variant\nJavob: B'}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed"
          />
          <button
            type="button"
            disabled={Boolean(working) || pasted.trim().length < 20}
            onClick={() => void runImport({ text: pasted })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-[13px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            <Sparkles size={14} />
            Savollarni ajratish
          </button>
        </div>
      )}

      {source === 'ai' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px]"
            >
              {[10, 15, 20, 25].map((n) => (
                <option key={n} value={n}>
                  {n} ta savol
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={Boolean(working)}
              onClick={() => void runAi()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-[13px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              <Sparkles size={14} />
              AI bilan tuzish
            </button>
          </div>
          <p className="text-[12px] text-slate-500">
            Savollar shu mavzuga joylangan ma‘ruza va taqdimot asosida tuziladi — avval ularni joylang.
          </p>
        </div>
      )}

      {source === 'manual' && (
        <button
          type="button"
          onClick={() => accept([emptyQuestion()], '')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-[13px] font-semibold text-white hover:bg-slate-700"
        >
          <Keyboard size={14} />
          Savollarni qo‘lda yozish
        </button>
      )}

      {status}

      {existing && picking && (
        <button
          type="button"
          onClick={() => setPicking(false)}
          className="text-[12.5px] font-medium text-slate-500 hover:text-slate-800"
        >
          Bekor qilish
        </button>
      )}
    </div>
  );
}
