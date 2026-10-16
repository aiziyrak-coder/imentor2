import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpenCheck,
  Camera,
  ClipboardCheck,
  HeartPulse,
  LayoutGrid,
  Lock,
  type LucideIcon,
} from 'lucide-react';
import { fetchPlatformNames, type PlatformsReport, type ReportFilters } from './rectorApi';
import { Skeleton } from './RectorViz';

/**
 * Rektor kirgandan keyingi BOSH SAHIFA: faqat platformalar nomi.
 *
 * Raqamlar bu yerda ko'rsatilmaydi — rektor avval platformani tanlaydi,
 * hisobot esa o'sha platformaning o'z sahifasida chiqadi (2026-10-08).
 * Ilgari hamma tizim raqamlari bilan birga bitta sahifaga jamlangandi va
 * aralashib ketgandi.
 *
 * 2026-10-15 qayta dizayn: har tizimning o'z rangi, ikonkasi va bir
 * qatorli vazifasi — raqamsiz, lekin bir qarashda tanib olinadi.
 */
const LOOK: Record<string, { icon: LucideIcon; gradient: string; glow: string; about: string }> = {
  imentor: {
    icon: BookOpenCheck,
    gradient: 'from-indigo-500 via-violet-500 to-fuchsia-500',
    glow: 'shadow-indigo-500/30',
    about: 'Darsga tayyorgarlik, dars vaqtida foydalanish va talabalar testlari',
  },
  itest: {
    icon: ClipboardCheck,
    gradient: 'from-sky-400 via-blue-500 to-indigo-500',
    glow: 'shadow-sky-500/30',
    about: 'Online imtihonlar va ularning natijalari',
  },
  icam: {
    icon: Camera,
    gradient: 'from-teal-400 via-cyan-500 to-sky-500',
    glow: 'shadow-teal-500/30',
    about: 'Auditoriya kameralari orqali davomat nazorati',
  },
  ishifo: {
    icon: HeartPulse,
    gradient: 'from-rose-400 via-pink-500 to-fuchsia-500',
    glow: 'shadow-rose-500/30',
    about: 'Teletibbiyot maslahatlari va klinik faoliyat',
  },
};

const FALLBACK = {
  icon: LayoutGrid,
  gradient: 'from-slate-500 to-slate-700',
  glow: 'shadow-slate-500/30',
  about: '',
};

export default function PlatformHome({
  filters,
  onUnauthorized,
  onOpen,
}: {
  filters: ReportFilters;
  onUnauthorized: () => void;
  onOpen: (key: string) => void;
}) {
  const [data, setData] = useState<PlatformsReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetchPlatformNames(filters)
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (/401|403/.test(String(e))) onUnauthorized();
        else if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [filters, onUnauthorized]);

  if (error) {
    return (
      <p className="rounded-2xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700 ring-1 ring-rose-200">
        Platformalar ro‘yxati kelmadi: {error}
      </p>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pt-2">
      <div className="rx-rise px-1 text-center">
        <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-indigo-500">Institut tizimlari</p>
        <h2 className="mt-1 text-[24px] font-extrabold tracking-tight text-slate-900 sm:text-[28px]">
          Qaysi tizim bo‘yicha hisobot kerak?
        </h2>
        <p className="mt-1 text-[13.5px] text-slate-500">Tanlang — hisobot shundan keyin ochiladi.</p>
      </div>

      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[132px]" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.platforms.map((p, i) => {
            const look = LOOK[p.key] || FALLBACK;
            const Icon = look.icon;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => onOpen(p.key)}
                className="rx-card rx-lift rx-rise group relative flex items-center gap-4 overflow-hidden p-5 text-left"
                style={{ ['--rx-delay' as string]: `${i * 70}ms` } as React.CSSProperties}
              >
                {/* Burchakdagi rangli nur — kartani jonlantiradi. */}
                <span
                  aria-hidden
                  className={`pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-gradient-to-br opacity-15 blur-2xl transition-opacity group-hover:opacity-30 ${look.gradient}`}
                />
                <span
                  className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-xl ${look.gradient} ${look.glow}`}
                >
                  <Icon size={26} strokeWidth={2.1} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-bold leading-snug text-slate-900 sm:truncate">{p.label}</span>
                  {look.about && (
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-slate-500">{look.about}</span>
                  )}
                  {!p.ok && (
                    <span className="mt-1.5 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-700 ring-1 ring-amber-200">
                      Ma’lumot eskirgan bo‘lishi mumkin
                    </span>
                  )}
                </span>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 transition group-hover:bg-slate-900 group-hover:text-white">
                  <ArrowRight size={17} />
                </span>
              </button>
            );
          })}
        </div>
      )}

      {data && data.missing.length > 0 && (
        <div className="rx-rise rounded-3xl border border-dashed border-slate-300 bg-white/60 px-5 py-4">
          <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-slate-600">
            <Lock size={14} className="text-slate-400" /> Hali ulanmagan
          </p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {data.missing.map((p) => (
              <li key={p.key} className="text-[12.5px] text-slate-500">
                <span className="font-semibold text-slate-600">{p.label}</span> — {p.note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
