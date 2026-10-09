import { HttpError } from '../api/httpClient';
import type { AppLanguage } from '../i18n/language';
import { translate } from '../i18n/translations';
import { textFitsLanguage } from './outputLanguage';

/** API / AI xatolaridan foydalanuvchiga ko‘rinadigan qisqa matn. */
function formatDrfBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  if (typeof obj.detail === 'string' && obj.detail.trim()) return obj.detail.trim();
  if (Array.isArray(obj.detail)) {
    const parts = obj.detail.map((x) => String(x)).filter(Boolean);
    if (parts.length) return parts.join(' ');
  }
  const fieldMsgs: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (key === 'detail') continue;
    if (typeof val === 'string' && val.trim()) fieldMsgs.push(`${key}: ${val.trim()}`);
    else if (Array.isArray(val)) {
      const joined = val.map((x) => String(x)).filter(Boolean).join(' ');
      if (joined) fieldMsgs.push(`${key}: ${joined}`);
    }
  }
  return fieldMsgs.length ? fieldMsgs.join(' ') : null;
}

/**
 * @param lang Xabar foydalanuvchi tilida chiqishi uchun — berilmasa o'zbekcha.
 */
export function apiErrorMessage(err: unknown, fallback: string, lang: AppLanguage = 'uz'): string {
  if (err instanceof HttpError) {
    const fromBody = formatDrfBody(err.body);
    // Server xabari faqat interfeys tilida bo'lsa (aks holda tarjima qilingan umumiy matn).
    if (fromBody && textFitsLanguage(fromBody, lang)) return fromBody;
    if (err.status === 503) return translate(lang, 'api.error.openaiKey');
    if (err.status === 504) return translate(lang, 'api.error.timeout');
    if (err.status === 502) return translate(lang, 'api.error.unavailable');
    if (err.message?.trim() && textFitsLanguage(err.message, lang) && !/^HTTP \d+$/.test(err.message.trim())) {
      return err.message.trim();
    }
    return fallback;
  }
  if (err instanceof Error) {
    const msg = err.message.trim();
    if (msg === 'no-backend-token') return translate(lang, 'api.error.reauth');
    // Ichki kodlar ("empty-pptx") va boshqa tildagi matn ko'rsatilmaydi.
    if (msg && textFitsLanguage(msg, lang) && /\s/.test(msg)) return msg;
  }
  return fallback;
}
