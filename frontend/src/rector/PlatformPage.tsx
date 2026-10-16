import { useEffect, useState } from 'react';
import { ArrowLeft, Bot, CalendarRange, ExternalLink, ListChecks, Loader2, MonitorSmartphone } from 'lucide-react';
import ControlReport from './ControlReport';
import MonitorDay from './MonitorDay';
import MonitorReport from './MonitorReport';
import LessonReport from './LessonReport';
import RectorIntelligence from './RectorIntelligence';
import { fetchPlatforms, type PlatformsReport, type ReportFilters } from './rectorApi';
import './rector.css';

/**
 * Bitta tanlangan platformaning hisoboti — o'z sahifasida.
 *
 * iMentor uchun bu to'liq nazorat hisoboti; qolgan tizimlar uchun ularning
 * o'z ko'rsatkichlari. Hamma tizim bitta sahifaga jamlanmaydi (2026-10-08).
 */
/** iMentor sahifasining bo'limlari.
 *
 * `0f0f6a8` da tab paneli olib tashlanganda monitor xonalari, dars jadvali
 * va AI tahlili sahifalari kodda qolgan, lekin HECH KIM ko'rmaydigan bo'lib
 * qolgandi. Bosh sahifa oldingidek faqat platforma kartalari — bo'limlar
 * esa tanlangan platformaning O'Z sahifasi ichida (2026-10-11).
 */
const VIEWS = [
  ['umumiy', 'Umumiy hisobot', false],
  ['kun', 'Kun bo‘yicha (har dars alohida)', false],
  ['xonalar', 'Monitor xonalari', true],
  ['jadval', 'Dars jadvali', false],
  ['tahlil', 'AI tahlil', true],
] as const;

/** Ikkinchi darajali bo'limlar ikonkasi (2026-10-15 qayta dizayn). */
const VIEW_ICON = {
  kun: ListChecks,
  xonalar: MonitorSmartphone,
  jadval: CalendarRange,
  tahlil: Bot,
} as const;

type ViewKey = (typeof VIEWS)[number][0];

export default function PlatformPage({
  platform,
  filters,
  wide = true,
  onUnauthorized,
  onBack,
}: {
  platform: string;
  filters: ReportFilters;
  /** Butun institut kesimida ko'ra oladimi. Guruh bilan cheklangan dekan
   *  uchun kafedra kesimidagi bo'limlar 403 — tugmasi ko'rsatilmaydi. */
  wide?: boolean;
  onUnauthorized: () => void;
  onBack: () => void;
}) {
  const [data, setData] = useState<PlatformsReport | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<ViewKey>('umumiy');

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
      className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-900 hover:ring-slate-300"
    >
      <ArrowLeft size={15} />
      Tizimlar
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {back}
        <h2 className="text-[18px] font-extrabold tracking-tight text-slate-900">
          {found?.label || (platform === 'imentor' ? 'Darsga tayyorgarlik (iMentor)' : platform)}
        </h2>
        {found?.link && (
          <a
            href={found.link}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[12.5px] font-semibold text-indigo-600 hover:bg-indigo-50"
          >
            Saytni ochish <ExternalLink size={13} />
          </a>
        )}
      </div>

      {/* iMentor ikki ko'rinishda: umumiy hisobot va KUN bo'yicha individual
          tahlil (har dars alohida qator, sababi bilan) — rektor talabi
          (2026-10-09): "umumiy ma'lumotlar emas, individual yondashuv". */}
      {platform === 'imentor' ? (
        <div className="space-y-3">
          {/* Olti tugmalik tasma olib tashlandi (rektor, 2026-10-15): asosiy
              tanlov headerdagi surmada — ustozlar yoki talabalar. Asosiy
              hisobot nomsiz, darhol ochiladi.

              Qolgan uchta ko'rinish (kun bo'yicha, monitor xonalari, dars
              jadvali, AI tahlil) KERAK bo'lib qoladi va ular ilgari bir
              marta shunday yo'qolgan (`0f0f6a8`), shuning uchun kichik
              ikkinchi darajali qator sifatida saqlanadi. */}
          <div className="flex flex-wrap items-center gap-2">
            {VIEWS.filter(([key, , wideOnly]) => key !== 'umumiy' && (wide || !wideOnly)).map(([key, label]) => {
              const Icon = VIEW_ICON[key as keyof typeof VIEW_ICON];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(view === key ? 'umumiy' : key)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition ${
                    view === key
                      ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25'
                      : 'bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 hover:text-slate-900 hover:ring-slate-300'
                  }`}
                >
                  {Icon && <Icon size={14} aria-hidden />}
                  {label}
                </button>
              );
            })}
          </div>
          {view === 'umumiy' && <ControlReport filters={filters} onUnauthorized={onUnauthorized} />}
          {view === 'kun' && <MonitorDay day={filters.to} onUnauthorized={onUnauthorized} />}
          {view === 'xonalar' && <MonitorReport filters={filters} onUnauthorized={onUnauthorized} />}
          {view === 'jadval' && <LessonReport filters={filters} onUnauthorized={onUnauthorized} />}
          {view === 'tahlil' && <RectorIntelligence filters={filters} onUnauthorized={onUnauthorized} />}
        </div>
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
            {found.cards.map((c, i) => (
              <div
                key={c.metric}
                className="rx-card rx-rise relative overflow-hidden px-5 py-4"
                style={{ ['--rx-delay' as string]: `${i * 60}ms` } as React.CSSProperties}
              >
                <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500" />
                <p className="text-[12px] font-semibold text-slate-500">{c.title}</p>
                <p className="mt-1 text-[30px] font-extrabold leading-tight text-slate-900 rx-num">{c.value}</p>
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
