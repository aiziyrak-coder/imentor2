import { httpJson } from '../api/httpClient';
import { getBackendAccessToken } from './backendAuth';

/**
 * Slayd rasmining odob tekshiruvi (2026-10-20). O'qituvchilar taqdimotda
 * odobsiz rasm chiqqanini aytdi: nom/kategoriya filtri rasmning o'zini
 * ko'rmaydi, shuning uchun har rasm slaydga qo'yilishidan OLDIN serverda
 * (OpenAI moderatsiya) tekshiriladi.
 *
 * Tekshirib bo'lmasa (tarmoq, server, kirish yo'q) — rasm QO'YILMAYDI,
 * slayd matnli chiqadi. Odobsiz rasm chiqishidan ko'ra rasmsiz slayd yaxshi.
 */

const CHECK_PX = 512;

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

/** Tekshiruvga yuboriladigan nusxa — 512px JPEG (~50 KB), asl rasm emas. */
async function smallCopy(dataUrl: string): Promise<string> {
  try {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return dataUrl;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image'));
      img.src = dataUrl;
    });
    const scale = Math.min(1, CHECK_PX / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    if (scale >= 1 && dataUrl.length < 400_000) return dataUrl;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    return dataUrl;
  }
}

/** true — faqat server "xavfsiz" degan bo'lsa. */
export async function isImageSafe(dataUrl: string, context = ''): Promise<boolean> {
  if (!dataUrl.startsWith('data:image/')) return false;
  try {
    const token = await getBackendAccessToken();
    if (!token) return false;
    const data = await httpJson<{ results?: { safe?: boolean }[] }>(
      `${apiBaseUrl()}/v1/education-ai/image-safety/`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: { images: [await smallCopy(dataUrl)], context: context.slice(0, 200) },
        timeoutMs: 40_000,
      },
    );
    return data.results?.[0]?.safe === true;
  } catch {
    return false;
  }
}
