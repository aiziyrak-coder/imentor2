import { HttpError } from '../api/httpClient';

/**
 * Backend xato javobidan foydalanuvchiga ko'rsatiladigan matn ajratadi.
 * `{"detail": "..."}` yoki DRF field xatolari (`{"file": ["..."]}`) qo'llab-quvvatlanadi.
 */
export function backendErrorMessage(err: unknown): string {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') {
    return "So'rov vaqti tugadi. Biroz kutib qayta urinib ko'ring.";
  }
  if (err instanceof HttpError && err.body && typeof err.body === 'object') {
    const body = err.body as Record<string, unknown>;
    if (typeof body.detail === 'string') return body.detail;
    for (const value of Object.values(body)) {
      if (typeof value === 'string') return value;
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    }
  }
  if (err instanceof Error) {
    if (err.message === 'handout-poster-missing' || err.message === 'handout-png-empty') {
      return "Poster rasmga o'tkazilmadi. Sahifani yangilab qayta urinib ko'ring.";
    }
    if (err.message === 'syllabus-id-required') {
      return 'Avval kafedra, fan va mavzuni tanlang.';
    }
    if (err.message === 'no-backend-token') {
      return 'Sessiya tugagan. Qayta kiring.';
    }
  }
  return '';
}
