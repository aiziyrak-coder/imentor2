import type { UiTextKey } from '../i18n/translations';

export type AppNotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface AppNotificationEventDetail {
  title: string;
  body: string;
  level?: AppNotificationLevel;
  /**
   * Tarjima kalitlari — berilsa, qo'ng'iroq panelidagi TARIX shu kalitlar
   * bo'yicha JORIY tilda ko'rsatiladi. Aks holda xabar yozilgan paytdagi
   * tilda muzlab qoladi (til almashtirilsa ham o'zgarmaydi).
   */
  titleKey?: UiTextKey;
  bodyKey?: UiTextKey;
  /** `bodyKey` matnidagi o'rinlar ({title}, {subject}...). */
  bodyParams?: Record<string, string | number>;
  /** Berilsa — `{title}`/`{subject}` shu fanning tarjimasi bilan JORIY tilda ko'rsatiladi. */
  topicSyllabusId?: number;
}

export function pushAppNotification(detail: AppNotificationEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AppNotificationEventDetail>('app:notify', { detail }));
}
