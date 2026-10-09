import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppLanguage } from './language';
import { translatePreparedContent } from '../utils/preparedContentStore';

/**
 * Saqlangan materialni (ma'ruza, taqdimot, keys, test) INTERFEYS TILIDA ko'rsatish.
 *
 * Qoida: o'qituvchiga hech qachon tarjimasiz yoki yarim tarjima matn
 * ko'rsatilmaydi. Material saqlanganda server uni qolgan tillarga fonda
 * o'giradi; til almashganda tarjima odatda tayyor turadi. Tayyor bo'lmasa —
 * "Tarjima qilinmoqda…" holati chiqadi va shu til serverdan so'raladi
 * (server fon ishini kutadi, ikkinchi marta AI chaqirmaydi).
 */

export type I18nPayload = {
  primaryLanguage?: AppLanguage;
  translations?: Partial<Record<AppLanguage, object>>;
  i18nSourceHash?: string;
};

/** `ready` — ko'rsatish mumkin; `translating` — kutilmoqda; `failed` — qayta urinish
 *  kerak; `unsaved` — material bazaga saqlanmagan, tarjima qilib bo'lmaydi. */
export type TranslationStatus = 'ready' | 'translating' | 'failed' | 'unsaved';

/** Payload shu tilda ko'rsatilishi mumkinmi — bo'lsa, ko'rinishini qaytaradi. */
export function translatedView<T extends I18nPayload>(payload: T | null, lang: AppLanguage): T | null {
  if (!payload) return null;
  if (payload.primaryLanguage === lang) return payload;
  const block = payload.translations?.[lang];
  return block ? ({ ...payload, ...block } as T) : null;
}

/** Bir xil (yozuv, til) uchun parallel so'rovlar bitta bo'ladi. */
const inflight = new Map<string, Promise<unknown>>();

export function requestTranslation<T>(versionId: string, lang: AppLanguage): Promise<T> {
  const key = `${versionId}:${lang}`;
  let promise = inflight.get(key) as Promise<T> | undefined;
  if (!promise) {
    promise = translatePreparedContent<T>(versionId, lang).finally(() => inflight.delete(key));
    inflight.set(key, promise);
  }
  return promise;
}

export function useTranslatedPayload<T extends I18nPayload>(
  payload: T | null,
  versionId: string | null,
  lang: AppLanguage,
  /** Server tarjimani qo'shgan YANGI payload — chaqiruvchi o'z holatini yangilaydi. */
  onPayload: (next: T, versionId: string) => void,
): { view: T | null; status: TranslationStatus; retry: () => void } {
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onPayloadRef = useRef(onPayload);
  onPayloadRef.current = onPayload;
  const versionRef = useRef(versionId);
  versionRef.current = versionId;

  const view = translatedView(payload, lang);
  const key = versionId ? `${versionId}:${lang}` : null;
  const needed = Boolean(payload && !view && key);

  useEffect(() => {
    if (!needed || !versionId || failedKey === key) return;
    let alive = true;
    requestTranslation<T>(versionId, lang)
      .then((next) => {
        if (!alive || versionRef.current !== versionId) return;
        if (translatedView(next, lang)) onPayloadRef.current(next, versionId);
        else setFailedKey(key);
      })
      .catch(() => {
        if (alive && versionRef.current === versionId) setFailedKey(key);
      });
    return () => {
      alive = false;
    };
    // `attempt` — "Qayta urinish" bosilganda effekt qayta ishga tushsin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed, versionId, lang, attempt]);

  const retry = useCallback(() => {
    setFailedKey(null);
    setAttempt((n) => n + 1);
  }, []);

  let status: TranslationStatus = 'ready';
  if (payload && !view) {
    if (!versionId) status = 'unsaved';
    else status = failedKey === key ? 'failed' : 'translating';
  }
  return { view, status, retry };
}
