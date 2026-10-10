import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import ControlReport from './ControlReport';
import { fetchPlatforms, type PlatformsReport, type ReportFilters } from './rectorApi';

/**
 * Bitta tanlangan platformaning hisoboti — o'z sahifasida.
 *
 * iMentor uchun bu to'liq nazorat hisoboti; qolgan tizimlar uchun ularning
 * o'z ko'rsatkichlari. Hamma tizim bitta sahifaga jamlanmaydi (2026-10-08).
 */
export default function PlatformPage({
  platform,
  filters,
  onUnauthorized,
  onBack,
}: {
  platform: string;
  filters: ReportFilters;
  onUnauthorized: () => void;
  onBack: () => void;
}) {
  const [data, setData] = useState<PlatformsReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetchPlatforms(filters)
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (/401|403/.test(String(e))) onUnauthorized();
        else if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [filters, onUnauthorized]);

  const found = data?.platforms.find((p) => p.key === platform);

  const back = (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-800"
    >
      <ArrowLeft size={15} />
      Tizimlar
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {back}
        <h2 className="text-[15px] font-bold text-slate-900">
          {found?.label || (platform === 'imentor' ? 'Darsga tayyorgarlik (iMentor)' : platform)}
        </h2>
        {found?.link && (
          <a
            href={found.link}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-medium text-sky-700 hover:underline"
          >
            Saytni ochish <ExternalLink size={13} />
          </a>
        )}
      </div>

      {/* iMentor — to'liq nazorat hisoboti; u o'z ma'lumotini o'zi oladi. */}
      {platform === 'imentor' ? (
        <ControlReport filters={filters} onUnauthorized={onUnauthorized} />
      ) : error ? (
        <p className="rounded-2xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700 ring-1 ring-rose-200">
          Ma’lumot kelmadi: {error}
        </p>
      ) : !data ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : !found ? (
        <p className="rounded-2xl bg-slate-50 px-4 py-5 text-center text-[13px] text-slate-500 ring-1 ring-slate-900/[0.06]">
          Bu tizim hali ulanmagan.
        </p>
      ) : found.cards.length === 0 ? (
        <p className="rounded-2xl bg-slate-50 px-4 py-5 text-center text-[13px] text-slate-500 ring-1 ring-slate-900/[0.06]">
          {found.note || 'Ma’lumot yo‘q'}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {found.cards.map((c) => (
              <div key={c.metric} className="rounded-2xl bg-white px-4 py-3.5 ring-1 ring-slate-900/[0.07]">
                <p className="text-[12px] text-slate-500">{c.title}</p>
                <p className="text-[26px] font-bold tabular-nums leading-tight text-slate-900">{c.value}</p>
                <p className="text-[11.5px] text-slate-400">{c.hint}</p>
              </div>
            ))}
          </div>
          {!found.ok && found.note && (
            <p className="rounded-xl bg-amber-50 px-4 py-2 text-[12px] text-amber-800 ring-1 ring-amber-200">
              Oxirgi yangilash o‘tmadi ({found.note}) — raqamlar eski bo‘lishi mumkin.
            </p>
          )}
        </>
      )}
    </div>
  );
}
