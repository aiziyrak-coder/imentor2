import type { ReactNode } from 'react';

/**
 * Bo'lim nomi — sahifa ichidagi eng tinch ajratgich.
 *
 * Ilgari har bo'lim qalin 14px sarlavha bilan boshlanardi va sahifada
 * to'rttasi bo'lsa, to'rttasi ham asosiy sarlavha bilan bir xil ovozda
 * gapirardi. Endi nom mayda va och, yonida ingichka chiziq oxirigacha
 * cho'ziladi: bo'lim boshlangani ko'rinadi, lekin e'tibor tortmaydi.
 * O'ngdagi son (masalan saqlangan versiyalar soni) shu chiziqni yopadi.
 */
export default function StaffSectionLabel({
  children,
  count,
}: {
  children: ReactNode;
  count?: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {children}
      </h3>
      <span className="h-px flex-1 bg-slate-900/[0.07]" />
      {count !== undefined && (
        <span className="text-[11px] tabular-nums text-slate-400">{count}</span>
      )}
    </div>
  );
}
