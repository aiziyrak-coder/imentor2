import { useCallback, useEffect, useState } from 'react';
import { Loader2, LogIn, LogOut, Trash2, X } from 'lucide-react';
import { errText } from './onlineError';
import MalakaTestEditor from './MalakaTestEditor';
import { ENTRY_CODE, EXIT_CODE } from './malakaApi';
import {
  deleteMaterial,
  fetchMaterials,
  type Material,
  type TeacherCourse,
} from './onlineTeacherApi';

/**
 * Fanning kirish va chiqish testi (o'qituvchi).
 *
 * Ikkalasi ham bir marta topshiriladi. Kirish testi e'lon qilingach
 * mavzular tinglovchiga faqat shu testdan keyin ochiladi; chiqish testini
 * esa oldindan tayyorlab, kurs oxirida e'lon qilish mumkin.
 */

const CARDS = [
  {
    key: 'entry' as const,
    code: ENTRY_CODE,
    title: 'Kirish testi',
    icon: LogIn,
    tint: 'bg-amber-50 text-amber-600',
    text: 'Kurs boshida tinglovchining boshlang‘ich darajasini o‘lchaydi. E’lon qilingach, mavzular faqat shu testdan keyin ochiladi. Bir marta topshiriladi.',
  },
  {
    key: 'exit' as const,
    code: EXIT_CODE,
    title: 'Chiqish testi',
    icon: LogOut,
    tint: 'bg-violet-50 text-violet-600',
    text: 'Kurs yakunidagi test. Oldindan tayyorlab qo‘ying va kurs oxirida e’lon qiling. Bir marta topshiriladi.',
  },
];

export default function MalakaSubjectTests({ course }: { course: TeacherCourse }) {
  const [items, setItems] = useState<Partial<Record<'entry' | 'exit', Material>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'entry' | 'exit' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [entry, exit] = await Promise.all([
        fetchMaterials(course.syllabus_id, course.variant_label, ENTRY_CODE),
        fetchMaterials(course.syllabus_id, course.variant_label, EXIT_CODE),
      ]);
      setItems({
        entry: entry.find((m) => m.kind === 'test'),
        exit: exit.find((m) => m.kind === 'test'),
      });
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [course]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: 'entry' | 'exit', fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setError('');
    try {
      await fn();
      await load();
      setNotice(ok);
      window.setTimeout(() => setNotice((n) => (n === ok ? '' : n)), 2500);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12 text-slate-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
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

      {CARDS.map((card) => {
        const item = items[card.key];
        const count = ((item?.payload as { questions?: unknown[] } | undefined)?.questions || []).length;
        const published = (item?.payload as { published?: boolean } | undefined)?.published !== false;
        const Icon = card.icon;
        return (
          <section key={card.key} className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-start gap-3 px-3.5 py-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${card.tint}`}>
                <Icon size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-slate-800">{card.title}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ${
                      !item
                        ? 'bg-slate-100 text-slate-500'
                        : published
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {!item ? 'yo‘q' : published ? `${count} savol · e’lon qilingan` : `${count} savol · e’lon qilinmagan`}
                  </span>
                </div>
                <p className="mt-0.5 text-[12.5px] leading-snug text-slate-500">{card.text}</p>
              </div>
            </div>
            <div className="space-y-2.5 border-t border-slate-100 px-3.5 py-3">
              <MalakaTestEditor
                course={course}
                topicCode={card.code}
                topicTitle={card.title}
                kind="test"
                existing={item}
                subjectTest={card.key}
                busy={busy === card.key}
                onSave={(fn, ok) => void run(card.key, fn, ok)}
              />
              {item && (
                <button
                  type="button"
                  disabled={busy === card.key}
                  onClick={() => {
                    if (window.confirm(`${card.title}ni o‘chirasizmi? Tinglovchilarning natijalari saqlanib qoladi.`)) {
                      void run(card.key, () => deleteMaterial(item.id), 'O‘chirildi.');
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 size={13} />
                  O‘chirish
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
