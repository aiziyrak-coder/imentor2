import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronRight, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { errText } from './onlineError';
import { createTopic, deleteTopic, moveTopic, renameTopic } from './malakaApi';
import {
  kindLabel,
  type MaterialKind,
  type TeacherCourse,
  type TeacherTopic,
} from './onlineTeacherApi';

/**
 * Malaka fanining mavzulari — o'qituvchi o'zi kiritadi.
 *
 * Online fanda mavzular sillabusdan keladi va o'zgarmaydi. Malakada
 * sillabus yo'q: mavzularni shu fanni o'tadigan o'qituvchilar qo'shadi,
 * nomini tuzatadi va tartibini o'zgartiradi. Ro'yxat hammasida umumiy.
 */
export default function MalakaTopicList({
  course,
  topics,
  kinds,
  onOpen,
  onChanged,
}: {
  course: TeacherCourse;
  topics: TeacherTopic[];
  kinds: MaterialKind[];
  onOpen: (topic: TeacherTopic) => void;
  onChanged: () => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ code: string; title: string } | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState('');

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = title.trim();
    if (value.length < 2) return;
    setAdding(true);
    setError('');
    try {
      await createTopic(course.syllabus_id, value);
      setTitle('');
      await onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setAdding(false);
    }
  };

  const act = async (code: string, fn: () => Promise<unknown>) => {
    setBusyCode(code);
    setError('');
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusyCode(null);
    }
  };

  const saveRename = () => {
    if (!editing) return;
    const { code } = editing;
    const value = editing.title.trim();
    if (value.length < 2) return;
    void act(code, async () => {
      await renameTopic(course.syllabus_id, code, value);
      setEditing(null);
    });
  };

  return (
    <div className="space-y-2">
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Yopish">
            <X size={14} />
          </button>
        </div>
      )}

      {topics.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center">
          <p className="text-[13.5px] font-semibold text-slate-700">Hali mavzu yo‘q</p>
          <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-slate-500">
            Birinchi mavzuni pastda qo‘shing. Mavzu tinglovchilarga unga material joylaganingizdan
            keyin ochiladi.
          </p>
        </div>
      ) : (
        <ol className="space-y-1.5">
          {topics.map((t, i) => {
            const busy = busyCode === t.code;
            const current = editing?.code === t.code ? editing : null;
            return (
              <li
                key={t.code}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-2 sm:gap-2 sm:px-3"
              >
                <span className="w-6 shrink-0 text-center font-mono text-[12px] font-semibold text-slate-400">
                  {i + 1}
                </span>

                {current ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveRename();
                    }}
                  >
                    <input
                      autoFocus
                      value={current.title}
                      onChange={(e) => setEditing({ code: t.code, title: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditing(null);
                      }}
                      maxLength={1024}
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[13.5px]"
                    />
                    <IconButton label="Saqlash" submit disabled={busy || current.title.trim().length < 2}>
                      {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                    </IconButton>
                    <IconButton label="Bekor qilish" onClick={() => setEditing(null)}>
                      <X size={15} />
                    </IconButton>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onOpen(t)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left sm:gap-3"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-slate-800">
                          {t.title}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {kinds.map((k) => (
                            <span
                              key={k}
                              title={kindLabel(k, 'malaka')}
                              className={`h-1.5 w-6 rounded-full ${t.has[k] ? 'bg-emerald-500' : 'bg-slate-200'}`}
                            />
                          ))}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums ${
                          t.ready === kinds.length
                            ? 'bg-emerald-100 text-emerald-700'
                            : t.ready > 0
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {t.ready}/{kinds.length}
                      </span>
                      <ChevronRight size={16} className="hidden shrink-0 text-slate-300 sm:block" />
                    </button>

                    <span className="flex shrink-0 items-center border-l border-slate-100 pl-1">
                      <IconButton
                        label="Nomini o‘zgartirish"
                        disabled={busy}
                        onClick={() => setEditing({ code: t.code, title: t.title })}
                      >
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton
                        label="Yuqoriga"
                        wide
                        disabled={busy || i === 0}
                        onClick={() => void act(t.code, () => moveTopic(course.syllabus_id, t.code, 'up'))}
                      >
                        <ArrowUp size={14} />
                      </IconButton>
                      <IconButton
                        label="Pastga"
                        wide
                        disabled={busy || i === topics.length - 1}
                        onClick={() => void act(t.code, () => moveTopic(course.syllabus_id, t.code, 'down'))}
                      >
                        <ArrowDown size={14} />
                      </IconButton>
                      <IconButton
                        label={t.ready > 0 ? 'Materiali bor mavzu o‘chirilmaydi' : 'O‘chirish'}
                        danger
                        disabled={busy || t.ready > 0}
                        onClick={() => {
                          if (window.confirm(`“${t.title}” mavzusini o‘chirasizmi?`)) {
                            void act(t.code, () => deleteTopic(course.syllabus_id, t.code));
                          }
                        }}
                      >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </IconButton>
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <form
        onSubmit={add}
        className="flex flex-wrap gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-2"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Yangi mavzu nomi"
          maxLength={1024}
          className="min-w-0 flex-1 basis-48 rounded-lg px-2.5 py-2 text-[13.5px] outline-none"
        />
        <button
          type="submit"
          disabled={adding || title.trim().length < 2}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-[13px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Mavzu qo‘shish
        </button>
      </form>
      <p className="px-1 text-[11.5px] leading-relaxed text-slate-400">
        Mavzular shu fanni o‘tadigan barcha o‘qituvchilarda umumiy. Mavzu tinglovchilarga unga
        material joylanganidan keyin ochiladi.
      </p>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  wide,
  submit,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Telefonda yashiriladi — qator sig'masin. */
  wide?: boolean;
  submit?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type={submit ? 'submit' : 'button'}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`tap-tight shrink-0 items-center justify-center rounded-md p-2 transition disabled:opacity-30 ${
        wide ? 'hidden sm:inline-flex' : 'inline-flex'
      } ${danger ? 'text-rose-500 hover:bg-rose-50' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
    >
      {children}
    </button>
  );
}
