import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../api/httpClient';
import { isRetryableAiError, withAiRetry } from './aiRetry';

const noSleep = () => Promise.resolve();

describe('withAiRetry', () => {
  it('vaqtinchalik xatoda 3 marta qayta urinadi va natijani qaytaradi', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new HttpError("So'rov vaqti tugadi", 0, null))
      .mockRejectedValueOnce(new HttpError('HTTP 504', 504, null))
      .mockRejectedValueOnce(new HttpError('HTTP 502', 502, { detail: 'Read timed out' }))
      .mockResolvedValueOnce('ok');
    const onRetry = vi.fn();
    await expect(withAiRetry(run, { sleep: noSleep, onRetry })).resolves.toBe('ok');
    expect(run.mock.calls.map((c) => c[0])).toEqual([0, 1, 2, 3]);
    expect(onRetry).toHaveBeenCalledTimes(3);
  });

  it('3 ta qayta urinishdan keyin xatoni chiqaradi', async () => {
    const run = vi.fn().mockRejectedValue(new HttpError('HTTP 503', 503, null));
    await expect(withAiRetry(run, { sleep: noSleep })).rejects.toThrow('HTTP 503');
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('doimiy xatoda (400, 401, format) darhol to\'xtaydi', async () => {
    for (const err of [
      new HttpError('HTTP 400', 400, null),
      new HttpError('HTTP 502', 502, { detail: 'Invalid schema for response_format' }),
      new Error('Presentation has no usable slides.'),
    ]) {
      const run = vi.fn().mockRejectedValue(err);
      await expect(withAiRetry(run, { sleep: noSleep })).rejects.toBe(err);
      expect(run).toHaveBeenCalledTimes(1);
    }
  });

  it('tarmoq uzilishi (TypeError) qayta urinishga arziydi', () => {
    expect(isRetryableAiError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryableAiError(new HttpError('HTTP 429', 429, null))).toBe(true);
  });
});
