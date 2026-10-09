import { HttpError } from '../api/httpClient';
import { getAppLanguage, type AppLanguage } from '../i18n/language';
import { translate } from '../i18n/translations';
import { textFitsLanguage } from './outputLanguage';

/**
 * Backend xato javobidan foydalanuvchiga ko'rsatiladigan matn ajratadi.
 * `{"detail": "..."}` yoki DRF field xatolari (`{"file": ["..."]}`) qo'llab-quvvatlanadi.
 */
export function backendErrorMessage(err: unknown, lang: AppLanguage = getAppLanguage()): string {
  const fits = (text: string) => (textFitsLanguage(text, lang) ? text : '');
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') {
    return translate(lang, 'api.error.requestTimeout');
  }
  if (err instanceof Error && (err.message === 'request-timeout' || err.message === 'AbortError')) {
    return translate(lang, 'api.error.requestTimeout');
  }
  // Tarmoq/vaqt xatosi (status 0): httpClient matnni o'zi yozadi — tilida bo'lsa.
  if (err instanceof HttpError && err.status === 0) return fits(err.message) || translate(lang, 'api.error.network');
  if (err instanceof HttpError && err.status === 413) {
    return translate(lang, 'api.error.fileTooLarge');
  }
  // Server xabari faqat interfeys tilida bo'lsa ko'rsatiladi (aks holda — chaqiruvchining
  // tarjima qilingan umumiy matni). Ilgari rus/ingliz interfeysida o'zbekcha xabar chiqardi.
  if (err instanceof HttpError && err.body && typeof err.body === 'object') {
    const body = err.body as Record<string, unknown>;
    if (typeof body.detail === 'string') return fits(body.detail);
    if (Array.isArray(body.detail) && body.detail.length) {
      const first = body.detail[0];
      if (typeof first === 'string') return fits(first);
      if (first && typeof first === 'object') {
        const rec = first as Record<string, unknown>;
        if (typeof rec.msg === 'string') return fits(rec.msg);
        if (typeof rec.detail === 'string') return fits(rec.detail);
      }
    }
    for (const value of Object.values(body)) {
      if (typeof value === 'string') return fits(value);
      if (Array.isArray(value) && typeof value[0] === 'string') return fits(value[0]);
    }
  }
  if (err instanceof Error) {
    if (err.message === 'handout-poster-missing' || err.message === 'handout-png-empty') {
      return translate(lang, 'api.error.posterRender');
    }
    if (err.message === 'syllabus-id-required') {
      return translate(lang, 'api.error.pickTopicFirst');
    }
    if (err.message === 'no-backend-token') {
      return translate(lang, 'api.error.reauth');
    }
  }
  if (err instanceof HttpError && err.status) {
    return translate(lang, 'api.error.server', { status: err.status });
  }
  return '';
}
