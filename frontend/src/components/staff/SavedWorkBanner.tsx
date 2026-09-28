import { History } from 'lucide-react';
import { useUiText } from '../../i18n/useUiText';

/**
 * Ingichka eslatma qatori: "Bu mavzuda N ta saqlangan versiya bor — Bazani ochish".
 *
 * To'rt bo'lim (Ma'ruza matni, Taqdimot, Keys, Test) bir xil ishlashi uchun
 * yagona komponent: sahifa TOZA ochiladi (avtomatik oxirgi material
 * ochilmaydi), lekin shu mavzuda avval yaratilgan ish bo'lsa — yo'qolib
 * ketmasligi uchun shu qator ko'rinadi.
 */
export default function SavedWorkBanner({
  count,
  onOpen,
}: {
  count: number;
  /** Tugma faqat shu prop berilganda chiqadi — tepasida "Baza" tugmasi bor
   * bo'limlarda ikkinchi tugma takrorlanmasligi uchun. */
  onOpen?: () => void;
}) {
  const { t } = useUiText();
  if (count <= 0) return null;

  return (
    // Eslatma — quti emas, qator: mazmun tepasida turadi va uni bosmaydi.
    <div className="flex items-center justify-between gap-3 border-t border-slate-900/[0.07] pt-3">
      <p className="min-w-0 text-[12.5px] text-slate-500">
        {t('common.savedWorkBanner', { count: String(count) })}
      </p>
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold text-blue-600 transition-colors hover:text-blue-700"
        >
          <History size={14} />
          {t('common.database')}
        </button>
      )}
    </div>
  );
}
