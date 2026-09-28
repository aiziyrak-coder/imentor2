import { useEffect, useRef } from 'react';
import { pushAppNotification } from '../../utils/notifications';
import { useUiText } from '../../i18n/useUiText';

type Props = {
  message: string;
  /** Xatoni bartaraf etuvchi amal (masalan "Qayta saqlash"). */
  actionLabel?: string;
  onAction?: () => void;
  actionBusy?: boolean;
};

/**
 * Sahifa ichidagi xato xabari.
 *
 * Bundan tashqari xatoni GLOBAL alert sifatida ham yuboradi (yuqori o'ng
 * burchak). Shu tufayli barcha mavjud `setError(...)` chaqiruvlarini
 * bittalab o'zgartirmasdan, hamma xato o'qituvchiga ko'rinadigan bo'ladi —
 * u sahifaning pastida bo'lsa ham.
 */
export default function StaffErrorAlert({ message, actionLabel, onAction, actionBusy }: Props) {
  const { t } = useUiText();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    const text = message?.trim();
    if (!text || lastSent.current === text) return;
    lastSent.current = text;
    pushAppNotification({ title: t('common.errorTitle'), body: text, level: 'error' });
  }, [message, t]);

  return (
    <div className="flex flex-col justify-center gap-3 rounded-xl bg-rose-50 px-4 py-3 sm:flex-row sm:items-center">
      <p className="text-[13px] text-rose-700 font-medium text-center sm:text-left">{message}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          disabled={actionBusy}
          className="shrink-0 self-center text-[12.5px] font-semibold text-rose-700 underline underline-offset-2 transition-colors hover:text-rose-900 disabled:opacity-50"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
