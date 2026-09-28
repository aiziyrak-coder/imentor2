import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpJson } from './httpClient';

afterEach(() => vi.unstubAllGlobals());

describe('httpJson timeout', () => {
  it('gives up when the body never arrives (stalled connection)', async () => {
    // Sarlavhalar keldi, lekin tana hech qachon kelmaydi — uzilgan aloqa.
    const stalledBody = (signal: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      return Promise.resolve({ ok: true, status: 200, text: () => stalledBody(signal) } as unknown as Response);
    });
    // Ochiq sabab bilan (ilgari "signal is aborted without reason" edi).
    await expect(httpJson('/api/test', { timeoutMs: 30 })).rejects.toMatchObject({
      status: 0,
      message: expect.stringMatching(/vaqti tugadi/),
    });
  });

  it('returns the body when it arrives in time', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"a":1}') } as unknown as Response),
    );
    await expect(httpJson('/api/test', { timeoutMs: 1000 })).resolves.toEqual({ a: 1 });
  });
});
