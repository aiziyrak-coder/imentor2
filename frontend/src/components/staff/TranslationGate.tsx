import type { ReactNode } from 'react';
import { Languages, Loader2, RefreshCw } from 'lucide-react';
import { useUiText } from '../../i18n/useUiText';
import type { TranslationStatus } from '../../i18n/useTranslatedPayload';
import { staffBtnPrimary } from './staffUi';

/**
 * Material faqat interfeys tilida ko'rsatiladi.
 *
 * Tarjima tayyor bo'lmaguncha matn o'rniga "Tarjima qilinmoqda…" turadi —
 * o'qituvchi hech qachon boshqa tildagi yoki yarim tarjima matnni ko'rmaydi.
 */
export default function TranslationGate({
  status,
  onRetry,
  children,
}: {
  status: TranslationStatus;
  onRetry: () => void;
  children: ReactNode;
}) {
  const { t, language } = useUiText();
  if (status === 'ready') return <>{children}</>;

  const langName = t(`common.languageName.${language}` as 'common.languageName.uz');

  if (status === 'translating') {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-20 text-center">
        <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
          <Languages size={20} />
          <Loader2 size={44} className="absolute inset-0 animate-spin text-sky-200" strokeWidth={1.2} />
        </span>
        <p className="text-[13.5px] font-semibold text-slate-700">{t('common.translating')}</p>
        <p className="max-w-md px-4 text-[12.5px] leading-relaxed text-slate-400">
          {t('common.translatingHint', { lang: langName })}
        </p>
      </div>
    );
  }

  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
      <Languages size={22} className="text-slate-300" />
      <p className="max-w-md px-4 text-[13.5px] font-medium text-slate-600">
        {status === 'unsaved' ? t('common.translateNeedsSave') : t('common.translateFailed', { lang: langName })}
      </p>
      {status === 'failed' && (
        <button type="button" onClick={onRetry} className={staffBtnPrimary}>
          <RefreshCw size={15} />
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}
