import type { LucideIcon } from 'lucide-react';
import { staffBtnPrimary } from './staffUi';

type Props = {
  icon: LucideIcon;
  title: string;
  hint: string;
  actionLabel?: string;
  onAction?: () => void;
};

/**
 * Bo'sh holat.
 *
 * Ilgari bu 40px li belgi bilan oq quti edi va bo'sh sahifada eng ko'zga
 * tashlanadigan narsa "hozircha hech narsa yo'q" degan quti bo'lardi.
 * Endi quti yo'q — belgi kichik va och, matn markazda, keyingi qadam esa
 * bitta tugmada. Bo'sh joy o'zi ham xabar beradi.
 */
export default function StaffEmptyState({
  icon: Icon,
  title,
  hint,
  actionLabel,
  onAction,
}: Props) {
  return (
    <div className="mx-auto max-w-sm px-4 py-16 text-center">
      <Icon size={22} className="mx-auto mb-3 text-slate-300" />
      <p className="text-[14px] font-semibold text-slate-700">{title}</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-500">{hint}</p>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className={`${staffBtnPrimary} mt-5`}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
