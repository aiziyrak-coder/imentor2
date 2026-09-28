import { useOpenStudent } from './StudentProfileContext';

/** Talaba ismi — bosilsa to'liq hisoboti ochiladi; provider yo'q joyda oddiy matn. */
export default function StudentName({ studentKey, name, className = '' }: { studentKey: string; name: string; className?: string }) {
  const open = useOpenStudent();
  if (!open || !studentKey) return <span className={className}>{name}</span>;
  return (
    <button
      type="button"
      title="To‘liq hisobotni ochish"
      onClick={(e) => {
        e.stopPropagation();
        open({ key: studentKey, name });
      }}
      className={`text-left underline decoration-slate-300 decoration-dotted underline-offset-2 hover:text-sky-700 hover:decoration-sky-500 ${className}`}
    >
      {name}
    </button>
  );
}
