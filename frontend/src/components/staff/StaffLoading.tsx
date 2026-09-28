import { Loader2 } from 'lucide-react';

type Props = {
  label: string;
  hint?: string;
};

export default function StaffLoading({ label, hint }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 py-20">
      <Loader2 size={22} className="animate-spin text-slate-300" />
      <p className="text-[13.5px] font-medium text-slate-500">{label}</p>
      {hint && (
        <p className="max-w-md px-4 text-center text-[12.5px] leading-relaxed text-slate-400">
          {hint}
        </p>
      )}
    </div>
  );
}
