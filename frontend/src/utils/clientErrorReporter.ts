/**
 * Brauzerdagi xatolarni serverga yozish (2026-09-24).
 *
 * O'qituvchilar "a.replaceAll is not a function" kabi xatolarni skrinshot
 * qilib yuborardi, ko'pi esa umuman yetib kelmasdi. Endi xato o'zi yoziladi va
 * admin panelida «Sayt xatolari» bo'limida ko'rinadi.
 *
 * Ehtiyot choralari: bitta sahifada bir xil xato bir marta, jami 15 tadan
 * ko'p emas; yuborish yiqilsa jim o'tadi (xato ustiga xato chiqmasin).
 */
import { peekBackendAccessToken } from './backendAuth';

const MAX_PER_PAGE = 15;
const sent = new Set<string>();
let installed = false;

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

/** Qaysi build ekanini bilish uchun — asosiy skript nomidagi hash (index-AbC123.js). */
function appVersion(): string {
  try {
    const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
    return script?.src.split('/').pop() || '';
  } catch {
    return '';
  }
}

export function reportClientError(error: unknown, extra: { source?: string; stack?: string } = {}): void {
  try {
    const err = error as { message?: unknown; stack?: unknown } | null;
    const message = String(err?.message ?? error ?? '').slice(0, 500);
    if (!message) return;
    const stack = String(extra.stack || err?.stack || '').slice(0, 4000);
    const source = (extra.source || '').slice(0, 300);
    const key = `${message}|${source}`;
    if (sent.has(key) || sent.size >= MAX_PER_PAGE) return;
    sent.add(key);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = peekBackendAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    void fetch(`${apiBaseUrl()}/v1/client-errors/`, {
      method: 'POST',
      headers,
      keepalive: true,
      body: JSON.stringify({
        message,
        source,
        stack,
        page: `${location.pathname}${location.hash}`.slice(0, 300),
        app_version: appVersion(),
      }),
    }).catch(() => undefined);
  } catch {
    /* hisobot yuborishning o'zi xato bermasin */
  }
}

export function installClientErrorReporter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    // Rasm/skript yuklanmagani (resurs xatosi) — ErrorEvent emas, o'tkazib yuboramiz.
    if (!(e instanceof ErrorEvent)) return;
    const source = e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '';
    reportClientError(e.error ?? e.message, { source, stack: (e.error as Error | undefined)?.stack });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as unknown;
    // HTTP xatolari (401, 404 ...) sahifaning o'zi ko'rsatadi — bular kod xatosi emas.
    if (reason && typeof reason === 'object' && 'status' in (reason as object)) return;
    reportClientError(reason);
  });
}
