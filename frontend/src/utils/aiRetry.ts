import { HttpError } from '../api/httpClient';

/**
 * Taqdimot generatsiyasi uchun qayta urinish (2026-10-20).
 *
 * gpt-5.4 bitta taqdimotga 2–2.5 daqiqa sarflaydi. OpenAI sekinlashsa yoki
 * tarmoq uzilsa, o'qituvchi shu vaqtni kutib xato oladi va hammasini qaytadan
 * bosishi kerak edi. Endi vaqtinchalik xatoda 3 marta qayta urinamiz.
 */
export const AI_RETRY_DELAYS_MS = [3_000, 8_000, 15_000] as const;

/** Qayta urinishga arziydigan xatomi: vaqt tugashi, tarmoq, 429 va 5xx. */
export function isRetryableAiError(err: unknown): boolean {
  if (err instanceof HttpError) {
    if (err.status === 0 || err.status === 429 || err.status >= 500) {
      // Backend OpenAI xatosini 502 bilan qaytaradi. Javob formati
      // qo'llab-quvvatlanmasa — qayta urinish yordam bermaydi (alohida zaxira bor).
      const detail = JSON.stringify(err.body ?? '');
      return !/json_schema|response_format|unsupported/i.test(detail);
    }
    return false;
  }
  if (err instanceof TypeError) return true; // fetch: "Failed to fetch" — tarmoq uzildi
  const msg = String((err as { message?: unknown })?.message ?? err);
  return /timed? ?out|timeout|vaqti tugadi|HTTP 5\d\d|HTTP 429|rate limit|network|kesildi/i.test(msg);
}

/**
 * `run(attempt)` ni bajaradi; vaqtinchalik xatoda `delays` bo'yicha kutib
 * qayta chaqiradi (attempt = 0, 1, 2, 3). Oxirgi urinishda chaqiruvchi
 * tezkorroq modelni tanlashi mumkin (`attempt === delays.length`).
 */
export async function withAiRetry<T>(
  run: (attempt: number) => Promise<T>,
  opts: {
    delays?: readonly number[];
    onRetry?: (attempt: number, err: unknown) => void;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const delays = opts.delays ?? AI_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run(attempt);
    } catch (err) {
      if (attempt >= delays.length || !isRetryableAiError(err)) throw err;
      opts.onRetry?.(attempt + 1, err);
      await sleep(delays[attempt]);
    }
  }
}
