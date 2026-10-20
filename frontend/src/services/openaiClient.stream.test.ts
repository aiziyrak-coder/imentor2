import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/backendAuth', () => ({
  ensureBackendAccessToken: vi.fn(async () => 'tok'),
  getBackendAccessToken: vi.fn(async () => 'tok'),
}));
vi.mock('../utils/pdfjsSetup', () => ({ pdfjsLib: {} }));

import { isTransientStreamError, openaiTextStream } from './openaiClient';

function sseResponse(events: object[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(body));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('isTransientStreamError', () => {
  it('uzilish, 429/5xx va yakunlanmagan oqim — qayta urinadi', () => {
    expect(isTransientStreamError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransientStreamError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true);
    expect(isTransientStreamError(Object.assign(new Error('bad gateway'), { status: 502 }))).toBe(true);
    expect(isTransientStreamError(new Error('AI stream ended before completion. Please retry.'))).toBe(true);
  });

  it("mablag', 4xx, kesilgan javob — qayta urinmaydi", () => {
    expect(isTransientStreamError(new Error("OpenAI hisobidagi mablag' tugagan"))).toBe(false);
    expect(isTransientStreamError(Object.assign(new Error('bad'), { status: 400 }))).toBe(false);
    expect(isTransientStreamError(new Error('AI response was incomplete. Please retry with a smaller section.'))).toBe(false);
  });
});

describe('openaiTextStream qayta urinish', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubEnv('VITE_AI_VIA_BACKEND', 'true');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("o'rtada uzilgan oqimdan keyin chala matnni tozalab, to'liq javob qaytaradi", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse([{ delta: 'Chala ' }, { error: 'AI stream ended before completion. Please retry.' }]))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(sseResponse([{ delta: "To'liq ma'ruza" }, { done: true }]));
    vi.stubGlobal('fetch', fetchMock);
    const seen: string[] = [];
    const p = openaiTextStream({ system: 's', user: 'u', purpose: 'lecture_generate', onDelta: (t) => seen.push(t) });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("To'liq ma'ruza");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(seen).toContain('');
  });

  it('3 urinishdan keyin xatoni chiqaradi', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const p = openaiTextStream({ system: 's', user: 'u', onDelta: () => {} });
    const check = expect(p).rejects.toThrow('Failed to fetch');
    await vi.runAllTimersAsync();
    await check;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
