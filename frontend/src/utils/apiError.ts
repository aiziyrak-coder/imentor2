import { HttpError } from '../api/httpClient';

/**
 * Backend xato javobidan foydalanuvchiga ko'rsatiladigan matn ajratadi.
 * `{"detail": "..."}` yoki DRF field xatolari (`{"file": ["..."]}`) qo'llab-quvvatlanadi.
 */
export function backendErrorMessage(err: unknown): string {
    if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') {
    return "So'rov vaqti tugadi. Biroz kutib qayta urinib ko'ring.";
  }
  if (err instanceof Error && (err.message === 'request-timeout' || err.message === 'AbortError')) {
    return "So'rov vaqti tugadi. Biroz kutib qayta urinib ko'ring.";
  }
  if (err instanceof HttpError && err.status === 413) {
    return 'Fayl hajmi juda katta.';
  }
  if (err instanceof HttpError && err.body && typeof err.body === 'object') {
    const body = err.body as Record<string, unknown>;
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail) && body.detail.length) {
      const first = body.detail[0];
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object') {
        const rec = first as Record<string, unknown>;
        if (typeof rec.msg === 'string') return rec.msg;
        if (typeof rec.detail === 'string') return rec.detail;
      }
    }
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
  if (err instanceof HttpError && err.status) {
    return `Server xatosi (${err.status}). Qayta urinib ko'ring.`;
  }
  return '';
}
