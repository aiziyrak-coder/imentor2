/**
 * Headerdagi surma: USTOZLAR ↔ TALABALAR (rektor talabi, 2026-10-15).
 *
 * Ilgari yuqorida olti tugmalik tasma turardi ("Umumiy hisobot", "Kun
 * bo'yicha", "Monitor xonalari", …). Rektor: tasma kerak emas, headerda
 * suriladigan narsa bo'lsin — chapga sursa ustozlar bo'yicha, o'ngga
 * sursa talabalar bo'yicha ma'lumot chiqsin. Asosiy hisobot nomini
 * yozib o'tirish ham shart emas.
 *
 * Header to'q rangli (2026-10-15 qayta dizayn), shuning uchun surma
 * shisha uslubida: oq belgi tanlangan tomonga siljiydi.
 */
import { GraduationCap, Users } from 'lucide-react';

export type Audience = 'teachers' | 'students';

export default function AudienceSwitch({
  value,
  onChange,
}: {
  value: Audience;
  onChange: (value: Audience) => void;
}) {
  const sides: Array<{ key: Audience; label: string; icon: typeof Users }> = [
    { key: 'teachers', label: 'Ustozlar', icon: Users },
    { key: 'students', label: 'Talabalar', icon: GraduationCap },
  ];
  return (
    <div
      role="tablist"
      aria-label="Kim bo‘yicha hisobot"
      className="relative flex items-center rounded-2xl bg-white/10 p-1 ring-1 ring-white/15 backdrop-blur"
    >
      {/* Suriladigan belgi: tanlangan tomonga siljiydi. */}
      <span
        aria-hidden
        className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-xl bg-white shadow-lg shadow-indigo-950/40 transition-transform duration-300 ease-out ${
          value === 'students' ? 'translate-x-full' : 'translate-x-0'
        }`}
      />
      {sides.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={`relative z-[1] flex min-w-[7.5rem] items-center justify-center gap-2 rounded-xl px-4 py-2 text-[13px] font-bold transition-colors duration-300 ${
            value === key ? 'text-indigo-950' : 'text-indigo-100/80 hover:text-white'
          }`}
        >
          <Icon size={15} strokeWidth={2.4} />
          {label}
        </button>
      ))}
    </div>
  );
}
