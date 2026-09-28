import type { ComponentType, ReactNode } from 'react';
import { PAGE_ROOT } from '../../layout/pageContainer';

/**
 * O'qituvchi sahifalarining tashqi qobig'i.
 *
 * `title` berilsa, sahifa sarlavha bilan boshlanadi.
 *
 * Ilgari sarlavha alohida kartochka edi: yumaloq oq quti, chegara, soya,
 * tepasida rangli gradient chiziq va 44px li rangli plitka ichida belgi.
 * Sahifaning eng baland ovozli qismi mazmun emas, shu lenta bo'lib qolgan
 * edi.
 *
 * Endi sarlavha — shunchaki sarlavha: quti yo'q, plitka yo'q. Bo'lim nomi
 * mayda harflarda tepada turadi, yonida bo'lim rangidagi kichkina nuqta —
 * yon menyudagi belgi bilan bir xil rang. Sarlavhani mazmundan ingichka
 * chiziq ajratadi.
 */

type Accent = 'indigo' | 'blue' | 'amber' | 'rose' | 'teal' | 'violet' | 'emerald' | 'slate';

/**
 * Bo'lim imzosi — sahifadagi yagona rangli element.
 *
 * Belgi bo'lsa RANG BELGIDA bo'ladi; belgisi yo'q sahifada esa kichkina
 * nuqta qoladi. Ilgari ikkalasi ham chizilardi va sarlavha oldida ikkita
 * mayda dog' turardi — o'qituvchi ularni nosozlik deb o'ylardi.
 */
const ACCENT_TEXT: Record<Accent, string> = {
  indigo: 'text-indigo-500',
  blue: 'text-blue-500',
  amber: 'text-amber-500',
  rose: 'text-rose-500',
  teal: 'text-teal-500',
  violet: 'text-violet-500',
  emerald: 'text-emerald-500',
  slate: 'text-slate-400',
};

const ACCENT_DOT: Record<Accent, string> = {
  indigo: 'bg-indigo-500',
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  teal: 'bg-teal-500',
  violet: 'bg-violet-500',
  emerald: 'bg-emerald-500',
  slate: 'bg-slate-400',
};

type Props = {
  children: ReactNode;
  className?: string;
  /** Test/case kabi uzoq sahifalar uchun */
  spacious?: boolean;
  /** Sarlavha — berilmasa chiqmaydi (eski sahifalar buzilmaydi). */
  title?: string;
  subtitle?: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  accent?: Accent;
  actions?: ReactNode;
};

export default function StaffPageLayout({
  children,
  className = '',
  spacious,
  title,
  subtitle,
  icon: Icon,
  accent = 'slate',
  actions,
}: Props) {
  return (
    <div
      className={`${PAGE_ROOT} py-6 ${spacious ? 'pb-20' : 'pb-12'} space-y-7 ${className}`}
    >
      {title && (
        <header className="print:hidden">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-slate-900/10 pb-4">
            <div className="min-w-0">
              <h1 className="flex items-center gap-2.5 text-[19px] font-semibold leading-tight tracking-tight text-slate-900 sm:text-[21px]">
                {Icon ? (
                  <Icon size={18} className={`shrink-0 ${ACCENT_TEXT[accent]}`} />
                ) : (
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ACCENT_DOT[accent]}`} />
                )}
                <span className="min-w-0 truncate">{title}</span>
              </h1>
              {subtitle && (
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-500">{subtitle}</p>
              )}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
          </div>
        </header>
      )}
      {children}
    </div>
  );
}
