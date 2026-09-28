/**
 * Portaldagi xato matni.
 *
 * Har komponentda o'z nusxasi bor edi va hammasi bir xil ish qilardi:
 * server javobidan `detail` ni sug'urib olardi. Topa olmasa esa ekranga
 * `HTTP 401` deb yozardi — foydalanuvchi uchun bu hech narsa anglatmaydi
 * va nima qilishni ham aytmaydi.
 */

import { HttpError } from '../api/httpClient';

const BY_STATUS: Record<number, string> = {
  400: "So'rov noto'g'ri. Kiritilgan ma'lumotni tekshiring.",
  401: 'Seans muddati tugadi. Qaytadan kiring.',
  403: 'Bunga ruxsatingiz yo‘q.',
  404: 'Topilmadi.',
  409: 'Bu amal allaqachon bajarilgan.',
  413: 'Fayl juda katta.',
  429: "Juda ko'p urinish. Bir oz kutib, qayta urinib ko'ring.",
  500: 'Serverda xatolik. Birozdan keyin qayta urinib ko‘ring.',
  502: 'Server javob bermayapti. Birozdan keyin qayta urinib ko‘ring.',
  503: 'Server band. Birozdan keyin qayta urinib ko‘ring.',
};

export function errText(e: unknown): string {
  if (e instanceof HttpError) {
    const detail = (e.body as { detail?: string } | null)?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail.trim();
    return BY_STATUS[e.status] || `Xatolik (${e.status}).`;
  }

  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/"detail"\s*:\s*"([^"]+)"/);
  if (m) return m[1];

  // `fetch` tarmoq uzilganda shunday deydi — bu server xatosi emas.
  if (/Failed to fetch|NetworkError|aborted|abort/i.test(msg)) {
    return "Internetga ulanib bo'lmadi. Aloqani tekshirib, qayta urinib ko'ring.";
  }

  const code = msg.match(/^HTTP (\d{3})$/);
  if (code) return BY_STATUS[Number(code[1])] || `Xatolik (${code[1]}).`;

  return msg || 'Xatolik';
}
