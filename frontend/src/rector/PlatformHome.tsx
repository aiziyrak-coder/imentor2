import { useEffect, useState } from 'react';
import { ChevronRight, Loader2, Lock } from 'lucide-react';
import { fetchPlatformNames, type PlatformsReport, type ReportFilters } from './rectorApi';

/**
 * Rektor kirgandan keyingi BOSH SAHIFA: faqat platformalar nomi.
 *
 * Raqamlar bu yerda ko'rsatilmaydi — rektor avval platformani tanlaydi,
 * hisobot esa o'sha platformaning o'z sahifasida chiqadi (2026-10-08).
 * Ilgari hamma tizim raqamlari bilan birga bitta sahifaga jamlangandi va
 * aralashib ketgandi.
 */
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
  if (!data) {
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Loader2 size={22} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="px-1">
        <h2 className="text-[15px] font-bold text-slate-900">Qaysi tizim bo‘yicha hisobot kerak?</h2>
        <p className="text-[12.5px] text-slate-500">Tanlang — hisobot shundan keyin ochiladi.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {data.platforms.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onOpen(p.key)}
            className="flex items-center gap-3 rounded-2xl bg-white px-5 py-5 text-left ring-1 ring-slate-900/[0.07] transition hover:bg-slate-50 hover:ring-slate-300"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold text-slate-900">{p.label}</span>
              {!p.ok && (
                <span className="mt-0.5 block text-[12px] text-amber-700">
                  Ma’lumot eskirgan bo‘lishi mumkin
                </span>
              )}
            </span>
            <ChevronRight size={18} className="shrink-0 text-slate-300" />
          </button>
        ))}
      </div>

      {data.missing.length > 0 && (
        <div className="rounded-2xl bg-slate-50 px-5 py-4 ring-1 ring-slate-900/[0.06]">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-600">
            <Lock size={14} className="text-slate-400" /> Hali ulanmagan
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {data.missing.map((p) => (
              <li key={p.key} className="text-[12.5px] text-slate-500">
                {p.label} — {p.note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
